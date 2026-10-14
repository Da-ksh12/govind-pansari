import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { AlertTriangle, CheckCircle2, Home, LocateFixed, MapPin, Search, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { useLocationStore } from '../store/locationStore';
import { addressRepository } from '../services/repositories/addressRepository';
import { storeRepository, type ServiceabilityResult } from '../services/repositories/storeRepository';
import { locationService, LocationError } from '../services/location/locationService';
import { geocodingService } from '../services/location/geocodingService';
import { BrandedLoader } from '../components/ui/BrandedLoader';
import { LocationPinDrop } from '../components/location/LocationPinDrop';
import { bannerImg } from '../data/images';
import { Image } from 'expo-image';
import type { Address, LatLng } from '../types/models';

type Resolved = { label: string; position: LatLng; result: ServiceabilityResult };

export default function LocationScreen() {
  const [query, setQuery] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const setLocation = useLocationStore((s) => s.setLocation);

  useEffect(() => {
    addressRepository.list().then(setAddresses).catch(() => setAddresses([]));
  }, []);

  const filteredAddresses = useMemo(() => {
    if (!query.trim()) return addresses;
    const q = query.trim().toLowerCase();
    return addresses.filter((a) => `${a.line1} ${a.city}`.toLowerCase().includes(q));
  }, [addresses, query]);

  const resolveLocation = async (label: string, position: LatLng) => {
    setResolving(true);
    setLocateError(null);
    try {
      const result = await storeRepository.checkServiceability(position);
      setResolved({ label, position, result });
    } catch {
      setLocateError("Couldn't check delivery availability. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  const chooseAddress = (addr: Address) => resolveLocation(`${addr.line1}, ${addr.city}`, { lat: addr.lat, lng: addr.lng });

  const handleUseCurrentLocation = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      let state = await locationService.getPermissionState();
      if (state === 'not_requested' || state === 'denied') {
        state = await locationService.requestPermission();
      }
      if (state === 'denied' || state === 'denied_permanently') {
        setLocateError('Location permission was denied. You can still choose a saved address or enter one manually.');
        return;
      }
      const position = await locationService.getCurrentPosition();
      const geocoded = await geocodingService.reverseGeocode(position);
      await resolveLocation(geocoded?.label ?? 'Current location', position);
    } catch (e) {
      setLocateError(e instanceof LocationError ? e.message : "We couldn't get your location.");
    } finally {
      setLocating(false);
    }
  };

  const handleContinue = () => {
    if (!resolved) return;
    setLocation(
      { label: resolved.label, addressLine: resolved.label, position: resolved.position },
      resolved.result,
    );
    router.replace('/(tabs)');
  };

  if (resolved) {
    const serviceable = resolved.result.serviceable;
    return (
      <SafeScreen>
        <View style={styles.resultWrap}>
          <Animated.View entering={FadeIn.duration(400)} style={styles.mapPreviewWrap}>
            <Image source={{ uri: bannerImg('agra street map illustration', 41) }} style={styles.mapPreview} contentFit="cover" />
            <LocationPinDrop />
          </Animated.View>
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={styles.resultCard}>
            {serviceable ? (
              <CheckCircle2 size={ICON_SIZE.xxl} color={colors.success} strokeWidth={ICON_STROKE} />
            ) : (
              <XCircle size={ICON_SIZE.xxl} color={colors.error} strokeWidth={ICON_STROKE} />
            )}
            <Text style={styles.resultTitle}>
              {serviceable ? 'Good news! We deliver to your area.' : "We're not delivering here yet."}
            </Text>
            <Text style={styles.resultAddress}>{resolved.label}</Text>
            {serviceable ? (
              <View style={styles.etaChip}>
                <Text style={styles.etaChipText}>Estimated delivery: {resolved.result.estimatedDeliveryMinutes} min</Text>
              </View>
            ) : (
              <Text style={styles.resultSubtitle}>We're expanding fast — check back soon.</Text>
            )}
            <Pressable style={styles.cta} onPress={serviceable ? handleContinue : () => setResolved(null)}>
              <Text style={styles.ctaText}>{serviceable ? 'Continue' : 'Choose Another Location'}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Where should we deliver?</Text>
        <Text style={styles.subtitle}>We'll show you delivery times & availability for your area.</Text>

        <View style={styles.searchRow}>
          <Search size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your saved addresses..."
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
          />
        </View>

        <Pressable style={styles.currentLocationRow} onPress={handleUseCurrentLocation} disabled={locating || resolving}>
          <View style={styles.currentLocationIcon}>
            {locating || resolving ? (
              <BrandedLoader />
            ) : (
              <LocateFixed size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.currentLocationTitle}>Use Current Location</Text>
            <Text style={styles.currentLocationSubtitle}>
              {locating ? 'Getting your location...' : resolving ? 'Checking availability...' : 'Using GPS for accurate delivery'}
            </Text>
          </View>
        </Pressable>

        {locateError && (
          <View style={styles.errorRow}>
            <AlertTriangle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
            <Text style={styles.errorText}>{locateError}</Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Saved Addresses</Text>
          <Pressable onPress={() => router.push('/address/add')}>
            <Text style={styles.addNewText}>+ Add New</Text>
          </Pressable>
        </View>
        {filteredAddresses.length === 0 && (
          <Text style={styles.emptyText}>{addresses.length === 0 ? 'No saved addresses yet.' : 'No matches.'}</Text>
        )}
        {filteredAddresses.map((addr) => (
          <Pressable key={addr.id} style={styles.addressRow} onPress={() => chooseAddress(addr)} disabled={resolving}>
            <View style={styles.addressIcon}>
              {addr.label === 'home' ? (
                <Home size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              ) : (
                <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.addressLabel}>{addr.label === 'home' ? 'Home' : addr.label === 'work' ? 'Work' : 'Other'}</Text>
              <Text numberOfLines={1} style={styles.addressLine}>
                {addr.line1}, {addr.city}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxl },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.xs },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    height: 50,
    marginTop: spacing.xl,
  },
  searchInput: { flex: 1, ...textStyles.body, color: colors.textPrimary },
  currentLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.base,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
  },
  currentLocationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  currentLocationSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  errorText: { ...textStyles.bodySmall, color: colors.error, flex: 1 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.sm },
  sectionLabel: { ...textStyles.sectionTitle, fontSize: 15, color: colors.textPrimary },
  addNewText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  emptyText: { ...textStyles.bodySmall, color: colors.textMuted, paddingVertical: spacing.md },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  addressIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  addressLabel: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 14 },
  addressLine: { ...textStyles.caption, color: colors.textSecondary },

  resultWrap: { flex: 1 },
  mapPreviewWrap: { width: '100%', height: 260 },
  mapPreview: { width: '100%', height: 260 },
  resultCard: {
    flex: 1,
    marginTop: -radius.xxl,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.lg,
  },
  resultTitle: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  resultAddress: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  resultSubtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  etaChip: {
    marginTop: spacing.md,
    backgroundColor: colors.successTint,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  etaChipText: { ...textStyles.bodySmall, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  cta: {
    marginTop: spacing.xxl,
    width: '100%',
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
