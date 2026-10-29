import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, ArrowLeft, Briefcase, CheckCircle2, Home, LocateFixed, Map as MapIcon, MapPin } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { addressRepository } from '../../services/repositories/addressRepository';
import { storeRepository, type ServiceabilityResult } from '../../services/repositories/storeRepository';
import { locationService, describeLocationError } from '../../services/location/locationService';
import { addressSearch } from '../../services/location/addressSearch';
import { describeLookupFailure, type ResolvedAddress } from '../../services/location/addressTypes';
import { useAddressDraftStore } from '../../store/addressDraftStore';
import {
  EMPTY_FIELDS,
  applyGeoParts,
  composeLine1,
  composeLine2,
  geocodeSourceFor,
  problemsInOrder,
  validateFields,
  type AddressFieldKey,
  type AddressFields,
} from '../../services/addressForm';
import { describeGpsAccuracy, describeLocationFailure, describeServiceability, describeServiceabilityFailure, isValidCoordinate, type ServiceabilityMessage } from '../../services/serviceability';
import type { LatLng } from '../../types/models';

const LABELS = [
  { value: 'home' as const, title: 'Home', icon: Home },
  { value: 'work' as const, title: 'Work', icon: Briefcase },
  { value: 'other' as const, title: 'Other', icon: MapPin },
];

function geoPartsOf(address: ResolvedAddress | null) {
  return address
    ? { street: address.parts.street, locality: address.parts.locality, city: address.parts.city, state: address.parts.state, postalCode: address.parts.postalCode }
    : { street: null, locality: null, city: null, state: null, postalCode: null };
}

export default function AddAddressScreen() {
  const [label, setLabel] = useState<'home' | 'work' | 'other'>('home');
  const [fields, setFields] = useState<AddressFields>(EMPTY_FIELDS);
  // Fields the customer has typed in. A map pick or search result may refresh the OTHER fields, never these.
  const touched = useRef<Set<AddressFieldKey>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  // Where each part of the form sits, so a failed Save can scroll to the first thing that needs attention.
  const scrollRef = useRef<ScrollView>(null);
  const anchors = useRef<Record<string, number>>({});
  const anchor = (key: string) => (e: LayoutChangeEvent) => {
    anchors.current[key] = e.nativeEvent.layout.y;
  };
  const [position, setPosition] = useState<LatLng | null>(null);
  // What the provider last said about the pin (display + place id + where the coordinates came from).
  const [address, setAddress] = useState<ResolvedAddress | null>(null);
  const [positionSource, setPositionSource] = useState<'google' | 'osm' | 'device' | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The server's answer for the pin as it stands now (same function the location screen, Home and Checkout use).
  const [serviceCheck, setServiceCheck] = useState<{ status: 'idle' | 'checking' | 'done' | 'failed'; result?: ServiceabilityResult }>({ status: 'idle' });

  useEffect(() => {
    if (!position) {
      setServiceCheck({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setServiceCheck({ status: 'checking' });
    storeRepository
      .checkServiceability(position)
      .then((result) => !cancelled && setServiceCheck({ status: 'done', result }))
      .catch(() => !cancelled && setServiceCheck({ status: 'failed' }));
    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng]);

  const setField = (key: AddressFieldKey) => (value: string) => {
    touched.current.add(key);
    setFields((f) => ({ ...f, [key]: value }));
  };

  /** A new pin: take its coordinates, remember what the provider said, refresh only the fields the customer has not typed. */
  const applyPin = useCallback((pos: LatLng, resolved: ResolvedAddress | null, source: 'google' | 'osm' | 'device' | null) => {
    setPosition(pos);
    setAddress(resolved);
    setPositionSource(resolved?.source ?? source);
    setFields((f) => applyGeoParts(f, touched.current, geoPartsOf(resolved)));
  }, []);

  // Picks up whatever the map picker (app/address/map-pick.tsx) left in the shared draft store when it calls
  // router.back() — a store, not route params, so nothing the customer already typed is lost.
  useFocusEffect(
    useCallback(() => {
      const picked = useAddressDraftStore.getState().pickedLocation;
      if (!picked) return;
      useAddressDraftStore.getState().clear();
      setLocateError(null);
      applyPin(picked.position, picked.address, null);
    }, [applyPin]),
  );

  const handlePinOnMap = () => {
    router.push({
      pathname: '/address/map-pick' as never,
      params: position ? { lat: String(position.lat), lng: String(position.lng) } : {},
    });
  };

  // On the phone, "use current location" opens the map already centred on the customer's exact spot, so the pin can be
  // checked and nudged before it is saved — the way Blinkit and Zepto do it. (Web has no map picker: it reads the GPS inline.)
  const handleUseCurrentLocation = () => {
    if (Platform.OS === 'web') return readGpsInline();
    // Already have a confirmed pin: reopen the map where it is — never re-locate over the spot the customer just adjusted.
    if (position) return handlePinOnMap();
    router.push({ pathname: '/address/map-pick' as never, params: { locate: '1' } });
  };

  const readGpsInline = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      let permission = await locationService.getPermissionState();
      if (permission === 'not_requested' || permission === 'denied') {
        permission = await locationService.requestPermission();
      }
      if (permission !== 'granted') {
        setLocateError(describeLocationFailure('PERMISSION_DENIED'));
        return;
      }
      const fix = await locationService.getCurrentFix();
      const here = { lat: fix.lat, lng: fix.lng };
      // A weak fix is still used (it is the real reading) but the customer is told to check it on the map.
      const accuracy = describeGpsAccuracy(fix.accuracyMeters, fix.precise).message;
      const { address: found, error } = await addressSearch.reverse(here);
      applyPin(here, found, 'device');
      setLocateError(error ? describeLookupFailure(error.kind) : accuracy);
    } catch (e) {
      // No fix: nothing is substituted (no last-known or default position) — the map is offered instead.
      setLocateError(describeLocationError(e));
    } finally {
      setLocating(false);
    }
  };

  const validation = validateFields(fields, !!position);
  const showError = (key: AddressFieldKey | 'position') => (submitted || (key !== 'position' && touched.current.has(key as AddressFieldKey)) ? validation.errors[key] : undefined);

  const handleSave = async () => {
    setSubmitted(true);
    if (!validation.ok || !position) {
      // Never a silent no-op: say what is missing and take the customer to the first thing to fix.
      const problems = problemsInOrder(validation.errors);
      const first = problems[0];
      if (first) {
        const y = anchors.current[first.key === 'state' ? 'city' : first.key] ?? 0;
        scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.base), animated: true });
        Alert.alert('Almost there', `Please fill in:\n\n${problems.map((p) => `• ${p.label}`).join('\n')}`);
      }
      return;
    }
    if (!isValidCoordinate(position.lat, position.lng)) {
      Alert.alert("We couldn't read this location", 'Move the pin on the map, or use your current location.');
      return;
    }
    setSaving(true);
    try {
      // The server decides. Saving an address never makes it deliverable — checkout checks again on its own.
      const serviceability = await storeRepository.checkServiceability(position);
      if (!serviceability.serviceable) {
        const info = describeServiceability(serviceability);
        if (!info.addressStillValid) {
          Alert.alert(info.title, info.message);
          return;
        }
        Alert.alert(info.title, info.message, [
          { text: 'Choose Another Location', style: 'cancel' },
          { text: 'Save Anyway', onPress: () => saveAddress() },
        ]);
        return;
      }
      await saveAddress();
    } catch {
      // The check itself failed (offline, server error): that says nothing about the area, so don't call it "unsupported".
      const info = describeServiceabilityFailure();
      Alert.alert(info.title, info.message, [
        { text: 'Try Again', style: 'cancel', onPress: () => handleSave() },
        { text: 'Save Anyway', onPress: () => saveAddress() },
      ]);
    } finally {
      setSaving(false);
    }
  };

  const saveAddress = async () => {
    if (!position) return;
    try {
      await addressRepository.create({
        label,
        receiverName: fields.receiverName.trim(),
        receiverPhone: fields.receiverPhone.trim(),
        // address_line_1/2 stay the human-readable address every existing screen shows, now composed from the parts.
        line1: composeLine1(fields),
        line2: composeLine2(fields),
        landmark: fields.landmark,
        city: fields.city.trim(),
        state: fields.state.trim(),
        pincode: fields.pincode.trim(),
        lat: position.lat,
        lng: position.lng,
        houseNo: fields.houseNo,
        building: fields.building,
        floor: fields.floor,
        street: fields.street,
        locality: fields.locality,
        deliveryInstructions: fields.instructions,
        formattedAddress: address?.formattedAddress,
        placeId: address?.placeId ?? undefined,
        geocodeSource: geocodeSourceFor(positionSource),
      });
      router.back();
    } catch {
      Alert.alert('Something went wrong', "Couldn't save this address. Please try again.");
    }
  };

  return (
    <SafeScreen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
            <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          </Pressable>
          <Text style={styles.headerTitle}>Add New Address</Text>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.locateRow} onPress={handleUseCurrentLocation} disabled={locating} onLayout={anchor('position')}>
            <View style={styles.locateIcon}>
              {locating ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : position ? (
                <CheckCircle2 size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
              ) : (
                <LocateFixed size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locateTitle}>{position ? 'Location captured' : 'Use Current Location'}</Text>
              <Text style={styles.locateSubtitle} numberOfLines={3}>
                {position ? address?.formattedAddress || `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Required to save an address'}
              </Text>
              {position && address?.source === 'google' && <Text style={styles.attribution}>{addressSearch.attribution('google')}</Text>}
            </View>
          </Pressable>

          {/* The map picker is native-only (no web build of either map library): it is simply not offered on web.
              GPS + manual entry below still work everywhere. */}
          {Platform.OS !== 'web' && (
            <Pressable style={styles.pinRow} onPress={handlePinOnMap}>
              <View style={[styles.locateIcon, { backgroundColor: colors.primaryTint }]}>
                <MapIcon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locateTitle}>{position ? 'Change on map' : 'Search or pin on map'}</Text>
                <Text style={styles.locateSubtitle}>Search an area or drop a pin on the exact spot</Text>
              </View>
              <MapPin size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            </Pressable>
          )}
          {!!showError('position') && <Text style={styles.fieldError}>{showError('position')}</Text>}
          {locateError && (
            <View style={styles.errorRow}>
              <AlertTriangle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
              <Text style={styles.errorText}>{locateError}</Text>
            </View>
          )}
          {serviceCheck.status === 'checking' && <Text style={styles.serviceChecking}>Checking delivery to this spot…</Text>}
          {(serviceCheck.status === 'failed' || (serviceCheck.status === 'done' && serviceCheck.result)) && (
            <ServiceStatusBanner info={serviceCheck.status === 'failed' ? describeServiceabilityFailure() : describeServiceability(serviceCheck.result!)} />
          )}

          <Text style={styles.sectionLabel}>Label</Text>
          <View style={styles.labelRow}>
            {LABELS.map((l) => {
              const active = l.value === label;
              return (
                <Pressable key={l.value} onPress={() => setLabel(l.value)} style={[styles.labelChip, active && styles.labelChipActive]}>
                  <l.icon size={ICON_SIZE.sm} color={active ? colors.white : colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={[styles.labelChipText, active && styles.labelChipTextActive]}>{l.title}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>Who will receive it</Text>
          <Field label="Recipient name" onLayout={anchor('receiverName')} value={fields.receiverName} onChangeText={setField('receiverName')} error={showError('receiverName')} autoCapitalize="words" />
          <Field label="Contact number" onLayout={anchor('receiverPhone')} value={fields.receiverPhone} onChangeText={setField('receiverPhone')} keyboardType="phone-pad" maxLength={10} error={showError('receiverPhone')} />

          <Text style={styles.sectionLabel}>Where to deliver</Text>
          <View style={styles.row2} onLayout={anchor('houseNo')}>
            <Field label="House / flat no." value={fields.houseNo} onChangeText={setField('houseNo')} style={styles.flex1} error={showError('houseNo')} placeholder="e.g. 12-B" />
            <Field label="Floor (optional)" value={fields.floor} onChangeText={setField('floor')} style={styles.flex1} placeholder="e.g. 2nd" />
          </View>
          <Field label="Building / apartment (optional)" value={fields.building} onChangeText={setField('building')} autoCapitalize="words" />
          <Field label="Street / road" onLayout={anchor('street')} value={fields.street} onChangeText={setField('street')} error={showError('street')} autoCapitalize="words" />
          <Field label="Area / locality (optional)" value={fields.locality} onChangeText={setField('locality')} autoCapitalize="words" />
          <Field label="Landmark (optional)" value={fields.landmark} onChangeText={setField('landmark')} placeholder="e.g. Opposite the temple" autoCapitalize="sentences" error={showError('landmark')} />
          {/* A landmark from Agra's place data, offered — never filled in for the customer. */}
          {!!address?.local?.landmark && !fields.landmark.trim() && (
            <Pressable style={styles.suggestChip} onPress={() => setField('landmark')(`Near ${address.local!.landmark!.name}`)} accessibilityRole="button">
              <Text style={styles.suggestChipText}>Use “Near {address.local.landmark.name}” · about {Math.max(10, Math.round(address.local.landmark.distanceM / 10) * 10)} m</Text>
            </Pressable>
          )}
          <View style={styles.row2} onLayout={anchor('city')}>
            <Field label="City" value={fields.city} onChangeText={setField('city')} style={styles.flex1} error={showError('city')} autoCapitalize="words" />
            <Field label="State" value={fields.state} onChangeText={setField('state')} style={styles.flex1} error={showError('state')} autoCapitalize="words" />
          </View>
          <Field label="Postal code" onLayout={anchor('pincode')} value={fields.pincode} onChangeText={setField('pincode')} keyboardType="number-pad" maxLength={6} error={showError('pincode')} />
          {!!address?.local?.pin && fields.pincode.trim() === address.local.pin.value && (
            <Text style={styles.fieldNote}>
              {address.local.pin.basis === 'area-name' ? `From India Post: ${address.local.pin.from} area` : address.local.pin.basis === 'nearby-addresses' ? `From ${address.local.pin.from}` : `From ${address.local.pin.from}`} — check it is right.
            </Text>
          )}
          <Field
            label="Delivery instructions (optional)"
            value={fields.instructions}
            onChangeText={setField('instructions')}
            placeholder="e.g. Call when you reach the gate"
            multiline
            maxLength={500}
            error={showError('instructions')}
          />

          {submitted && !validation.ok && <Text style={styles.fieldError}>Please fix the fields marked above.</Text>}
          <Pressable style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleSave} disabled={saving} accessibilityRole="button">
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveBtnText}>Save Address</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  maxLength?: number;
  style?: object;
  error?: string;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <View style={[styles.field, props.style]} onLayout={props.onLayout}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={[styles.fieldInput, props.multiline && styles.fieldInputMulti, !!props.error && styles.fieldInputError]}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        multiline={props.multiline}
        autoCapitalize={props.autoCapitalize ?? 'none'}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
        accessibilityLabel={props.label}
      />
      {!!props.error && <Text style={styles.fieldError}>{props.error}</Text>}
    </View>
  );
}

/** The server's delivery verdict for the chosen pin, in the shared wording. Saving is still allowed; checkout checks again. */
function ServiceStatusBanner({ info }: { info: ServiceabilityMessage }) {
  const good = info.tone === 'ok';
  return (
    <View style={[styles.serviceBanner, good ? styles.serviceBannerOk : styles.serviceBannerWarn]} accessibilityRole="alert">
      {good ? (
        <CheckCircle2 size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />
      ) : (
        <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.serviceTitle, { color: good ? colors.success : colors.warning }]}>{info.title}</Text>
        <Text style={styles.serviceText}>{info.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  serviceChecking: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.md },
  serviceBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  serviceBannerOk: { backgroundColor: colors.successTint },
  serviceBannerWarn: { backgroundColor: colors.warningTint },
  serviceTitle: { ...textStyles.bodySmall, fontFamily: 'PlusJakartaSans_700Bold' },
  serviceText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  flex: { flex: 1 },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl },
  locateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base, backgroundColor: colors.primaryTint, borderRadius: radius.md },
  locateIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  locateTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  locateSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  // Google asks for plain "Google Maps" text, in a legible grey, wherever its address text is shown without its map.
  attribution: { ...textStyles.caption, color: '#5E5E5E', fontSize: 12, marginTop: 2 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  errorText: { ...textStyles.bodySmall, color: colors.error, flex: 1 },
  sectionLabel: { ...textStyles.sectionTitle, fontSize: 14, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.xs },
  labelRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  labelChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  labelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  labelChipText: { ...textStyles.bodySmall, color: colors.textPrimary },
  labelChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  row2: { flexDirection: 'row', gap: spacing.md },
  field: { marginTop: spacing.md },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  fieldError: { ...textStyles.caption, color: colors.error, marginTop: spacing.xs },
  fieldNote: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.xs },
  suggestChip: { alignSelf: 'flex-start', marginTop: spacing.sm, backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  suggestChipText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    height: 48,
    ...textStyles.body,
    color: colors.textPrimary,
  },
  fieldInputMulti: { height: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  fieldInputError: { borderColor: colors.error },
  saveBtn: { marginTop: spacing.xxl, height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
