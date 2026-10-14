import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, ArrowLeft, Briefcase, CheckCircle2, Home, LocateFixed, Map as MapIcon, MapPin } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { addressRepository } from '../../services/repositories/addressRepository';
import { storeRepository } from '../../services/repositories/storeRepository';
import { locationService, LocationError } from '../../services/location/locationService';
import { geocodingService } from '../../services/location/geocodingService';
import { useAddressDraftStore } from '../../store/addressDraftStore';
import type { LatLng } from '../../types/models';

const LABELS = [
  { value: 'home' as const, title: 'Home', icon: Home },
  { value: 'work' as const, title: 'Work', icon: Briefcase },
  { value: 'other' as const, title: 'Other', icon: MapPin },
];

export default function AddAddressScreen() {
  const [label, setLabel] = useState<'home' | 'work' | 'other'>('home');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [position, setPosition] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const phoneDigits = receiverPhone.replace(/\D/g, '');
  const phoneValid = phoneDigits.length === 10;
  const pincodeValid = /^\d{6}$/.test(pincode.trim());

  const canSave =
    !!position &&
    receiverName.trim().length > 0 &&
    phoneValid &&
    line1.trim().length > 0 &&
    city.trim().length > 0 &&
    state.trim().length > 0 &&
    pincodeValid &&
    !saving;

  // Picks up whatever "Pin on Map" (app/address/map-pick.tsx) left in
  // the shared draft store when it calls router.back() — see that
  // store's own comment for why a store, not route params, carries the
  // result back here without losing whatever the customer already typed.
  useFocusEffect(
    useCallback(() => {
      const picked = useAddressDraftStore.getState().pickedLocation;
      if (!picked) return;
      useAddressDraftStore.getState().clear();
      setPosition(picked.position);
      // A named place (search result) makes a better line 1 than a
      // plain reverse-geocoded street line, e.g. "Taj Mahal" over
      // "Dharmapuri, Agra" — only set when the pick actually came from
      // search, never invented for a plain manual pin drop. The full
      // formatted address still matters for a rider, so it goes in
      // line 2 (only if the customer hasn't already typed one).
      if (picked.placeName) {
        setLine1(picked.placeName);
        // Functional update — reads the current value at call time,
        // not whatever line2 was when this effect was first created
        // (useFocusEffect's useCallback has an empty dep array by
        // design, so a direct closure read here would be stale).
        if (picked.addressLine) setLine2((current) => current || picked.addressLine!);
      } else if (picked.addressLine) {
        setLine1(picked.addressLine);
      }
      if (picked.city) setCity(picked.city);
      if (picked.state) setState(picked.state);
      if (picked.postalCode) setPincode(picked.postalCode);
    }, []),
  );

  const handlePinOnMap = () => {
    router.push({
      pathname: '/address/map-pick' as never,
      params: position ? { lat: String(position.lat), lng: String(position.lng) } : {},
    });
  };

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      let permission = await locationService.getPermissionState();
      if (permission === 'not_requested' || permission === 'denied') {
        permission = await locationService.requestPermission();
      }
      if (permission !== 'granted') {
        setLocateError('Location permission was denied — you can still fill this in manually.');
        return;
      }
      const pos = await locationService.getCurrentPosition();
      setPosition(pos);
      const geocoded = await geocodingService.reverseGeocode(pos);
      if (geocoded) {
        if (!line1) setLine1(geocoded.addressLine);
        if (!city && geocoded.city) setCity(geocoded.city);
        if (!state && geocoded.state) setState(geocoded.state);
        if (!pincode && geocoded.postalCode) setPincode(geocoded.postalCode);
      }
    } catch (e) {
      setLocateError(e instanceof LocationError ? e.message : "We couldn't get your location.");
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async () => {
    if (!canSave || !position) return;
    setSaving(true);
    try {
      const serviceability = await storeRepository.checkServiceability(position);
      if (!serviceability.serviceable) {
        Alert.alert(
          'Currently unavailable for delivery',
          "We don't deliver to this location yet. You can still save it, or choose a different location.",
          [
            { text: 'Choose Another Location', style: 'cancel' },
            {
              text: 'Save Anyway',
              onPress: async () => {
                await saveAddress();
              },
            },
          ],
        );
        return;
      }
      await saveAddress();
    } catch {
      Alert.alert('Something went wrong', "Couldn't check delivery availability. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveAddress = async () => {
    if (!position) return;
    try {
      await addressRepository.create({
        label,
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        lat: position.lat,
        lng: position.lng,
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

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.locateRow} onPress={handleUseCurrentLocation} disabled={locating}>
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
              <Text style={styles.locateSubtitle}>
                {position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Required to save an address'}
              </Text>
            </View>
          </Pressable>

          {/* MapLibre React Native has no web build (same reason
              LiveTrackingMap is native-only) — the picker only makes
              sense as a real interactive map, so it's simply not offered
              on web rather than shown broken. GPS + manual entry below
              still work everywhere. */}
          {Platform.OS !== 'web' && (
            <Pressable style={styles.pinRow} onPress={handlePinOnMap}>
              <View style={[styles.locateIcon, { backgroundColor: colors.primaryTint }]}>
                <MapIcon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locateTitle}>Pin on Map</Text>
                <Text style={styles.locateSubtitle}>Drop a pin for the exact spot</Text>
              </View>
              <MapPin size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            </Pressable>
          )}
          {locateError && (
            <View style={styles.errorRow}>
              <AlertTriangle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
              <Text style={styles.errorText}>{locateError}</Text>
            </View>
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

          <Field label="Recipient name" value={receiverName} onChangeText={setReceiverName} />
          <Field label="Phone number" value={receiverPhone} onChangeText={setReceiverPhone} keyboardType="phone-pad" maxLength={10} />
          {receiverPhone.trim().length > 0 && !phoneValid && <Text style={styles.fieldHint}>Enter a valid 10-digit phone number.</Text>}
          <Field label="Address line 1" value={line1} onChangeText={setLine1} />
          <Field label="Address line 2 (optional)" value={line2} onChangeText={setLine2} />
          <View style={styles.row2}>
            <Field label="City" value={city} onChangeText={setCity} style={styles.flex1} />
            <Field label="State" value={state} onChangeText={setState} style={styles.flex1} />
          </View>
          <Field label="Postal code" value={pincode} onChangeText={setPincode} keyboardType="number-pad" maxLength={6} />
          {pincode.trim().length > 0 && !pincodeValid && <Text style={styles.fieldHint}>Enter a valid 6-digit postal code.</Text>}

          <Pressable style={[styles.saveBtn, { opacity: canSave ? 1 : 0.5 }]} onPress={handleSave} disabled={!canSave}>
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
}) {
  return (
    <View style={[styles.field, props.style]}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        maxLength={props.maxLength}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl },
  locateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
  },
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
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  errorText: { ...textStyles.bodySmall, color: colors.error, flex: 1 },
  sectionLabel: { ...textStyles.sectionTitle, fontSize: 14, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  labelRow: { flexDirection: 'row', gap: spacing.sm },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  labelChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  labelChipText: { ...textStyles.bodySmall, color: colors.textPrimary },
  labelChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  row2: { flexDirection: 'row', gap: spacing.md },
  field: { marginTop: spacing.md },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  fieldHint: { ...textStyles.caption, color: colors.error, marginTop: -spacing.sm, marginBottom: spacing.sm },
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
  saveBtn: {
    marginTop: spacing.xxl,
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
