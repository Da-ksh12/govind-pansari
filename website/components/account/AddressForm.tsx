'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Clock, Info, MapPin, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldError, type Path } from 'react-hook-form';
import { Spinner } from '../brand/NutLoader';
import { PlaceSearch } from '../commerce/PlaceSearch';
import { ADDRESS_LABELS, addressSchema, toAddressRow, toSavedAddress, type AddressForm as AddressValues, type SavedAddress } from '@/lib/address';
import { checkServiceability, savePlace, type Place } from '@/lib/location';
import { describeServiceability, describeServiceabilityFailure, type ServiceabilityMessage } from '@/lib/serviceability';
import { browserClient } from '@/lib/supabase/browser';

interface Props {
  userId: string;
  defaultName: string;
  defaultPhone: string;
  /** True when the customer has no saved address yet: the new one becomes the default. */
  first: boolean;
  onSaved: (address: SavedAddress) => void;
  onCancel?: () => void;
}

const LABEL_TEXT = { home: 'Home', work: 'Work', other: 'Other' } as const;

function Field({ label, error, optional, children }: { label: string; error?: FieldError; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-bold text-espresso">{label}{optional && <span className="ml-1 font-normal text-taupe">(optional)</span>}{children}</label>
      {error && <p role="alert" className="mt-1.5 text-sm font-semibold text-danger">{error.message}</p>}
    </div>
  );
}

/** Add a delivery address: pick the spot (search or GPS), see at once whether it is deliverable (the server's own check), then fill in the door details. */
export function AddressForm({ userId, defaultName, defaultPhone, first, onSaved, onCancel }: Props) {
  const [place, setPlace] = useState<Place | null>(null);
  const [delivery, setDelivery] = useState<ServiceabilityMessage | null>(null);
  const [positionError, setPositionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const form = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: { label: 'home', receiverName: defaultName, receiverPhone: defaultPhone, houseNo: '', building: '', floor: '', street: '', locality: '', landmark: '', instructions: '', city: 'Agra', state: 'Uttar Pradesh', pincode: '' },
  });
  const { register, handleSubmit, setValue, formState: { errors, dirtyFields } } = form;

  async function choose(next: Place) {
    setPlace(next);
    setPositionError('');
    savePlace(next);
    // fill in what the map knows, but never overwrite something the customer has typed
    const fill = (key: Path<AddressValues>, value: string | null | undefined) => {
      if (value && !dirtyFields[key as keyof AddressValues]) setValue(key, value, { shouldValidate: false });
    };
    fill('street', next.street);
    fill('locality', next.locality);
    fill('city', next.city);
    fill('state', next.state);
    fill('pincode', next.postcode?.replace(/\D/g, '').slice(0, 6));
    setDelivery(null);
    try {
      setDelivery(describeServiceability(await checkServiceability(next.lat, next.lng)));
    } catch {
      setDelivery(describeServiceabilityFailure());
    }
  }

  async function save(values: AddressValues) {
    if (!place) {
      setPositionError('Search for your area or use your location first, so we know where to deliver.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const db = browserClient();
      const row = toAddressRow(userId, values, { lat: place.lat, lng: place.lng, source: place.source ?? 'manual', formatted: place.label });
      const { data, error } = await db.from('addresses').insert(row).select('*').single();
      if (error || !data) throw error ?? new Error('no row');
      if (first) await db.rpc('set_default_address', { p_address_id: data.id });
      onSaved({ ...toSavedAddress(data), isDefault: first || data.is_default });
    } catch {
      setSaveError("We couldn't save this address. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const Icon = delivery?.tone === 'ok' ? CheckCircle2 : delivery?.tone === 'closed' ? Clock : delivery?.tone === 'error' ? Info : XCircle;
  const tone = delivery?.tone === 'ok' ? 'bg-forest-tint text-forest' : delivery?.tone === 'closed' ? 'bg-gold-tint text-gold-dark' : delivery?.tone === 'error' ? 'bg-sand text-taupe' : 'bg-terracotta-tint text-terracotta';

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="font-display text-xl font-semibold text-maroon">Where should we deliver?</legend>
        <PlaceSearch onPick={choose} value={place?.label ?? ''} />
        {place && (
          <p className="flex items-start gap-2 text-sm text-espresso"><MapPin size={16} className="mt-0.5 shrink-0 text-maroon" aria-hidden /> {place.label}</p>
        )}
        {positionError && <p role="alert" className="text-sm font-semibold text-danger">{positionError}</p>}
        {delivery && (
          <div className={`flex gap-3 rounded-xl p-3.5 text-sm ${tone}`} aria-live="polite">
            <Icon size={19} className="mt-0.5 shrink-0" aria-hidden />
            <div><p className="font-bold">{delivery.title}</p><p className="mt-0.5">{delivery.message}</p></div>
          </div>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 font-display text-xl font-semibold text-maroon sm:col-span-2">Address details</legend>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-bold text-espresso">Save as</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Address label">
            {ADDRESS_LABELS.map((l) => (
              <label key={l} className="cursor-pointer">
                <input type="radio" value={l} className="peer sr-only" {...register('label')} />
                <span className="inline-block rounded-full border-2 border-line-strong px-5 py-2 text-sm font-bold text-espresso peer-checked:border-maroon peer-checked:bg-maroon peer-checked:text-ivory peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-dark">{LABEL_TEXT[l]}</span>
              </label>
            ))}
          </div>
        </div>
        <Field label="Recipient's name" error={errors.receiverName}><input autoComplete="name" className="field mt-1.5" {...register('receiverName')} /></Field>
        <Field label="Mobile number" error={errors.receiverPhone}><input type="tel" inputMode="numeric" autoComplete="tel-national" className="field mt-1.5" {...register('receiverPhone')} /></Field>
        <Field label="House / flat / shop no." error={errors.houseNo}><input autoComplete="address-line1" className="field mt-1.5" {...register('houseNo')} /></Field>
        <Field label="Building / society" optional error={errors.building}><input className="field mt-1.5" {...register('building')} /></Field>
        <Field label="Floor" optional error={errors.floor}><input className="field mt-1.5" {...register('floor')} /></Field>
        <Field label="Street / road" error={errors.street}><input autoComplete="address-line2" className="field mt-1.5" {...register('street')} /></Field>
        <Field label="Area / colony" optional error={errors.locality}><input className="field mt-1.5" {...register('locality')} /></Field>
        <Field label="Landmark" optional error={errors.landmark}><input className="field mt-1.5" {...register('landmark')} /></Field>
        <Field label="City" error={errors.city}><input autoComplete="address-level2" className="field mt-1.5" {...register('city')} /></Field>
        <Field label="State" error={errors.state}><input autoComplete="address-level1" className="field mt-1.5" {...register('state')} /></Field>
        <Field label="Pincode" error={errors.pincode}><input inputMode="numeric" maxLength={6} autoComplete="postal-code" className="field mt-1.5" {...register('pincode')} /></Field>
        <div className="sm:col-span-2">
          <Field label="Delivery instructions" optional error={errors.instructions}><textarea rows={2} placeholder="Gate code, “call on arrival”, …" className="field mt-1.5" {...register('instructions')} /></Field>
        </div>
      </fieldset>

      {saveError && <p role="alert" className="rounded-xl bg-terracotta-tint p-3 text-sm font-semibold text-danger">{saveError}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className="btn btn-primary">{saving ? <Spinner /> : null} Save address</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-ghost">Cancel</button>}
      </div>
    </form>
  );
}
