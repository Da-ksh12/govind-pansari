import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, CheckCircle2, LocateFixed, MapPin } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { locationService, describeLocationError, type LocationFix } from '../../services/location/locationService';
import { classifyPrecision, zoomForAccuracy } from '../../services/location/fixRefinement';
import { describeGpsAccuracy, describeLocationFailure, describeServiceability, describeServiceabilityFailure, isValidCoordinate, type ServiceabilityMessage } from '../../services/serviceability';
import { addressSearch } from '../../services/location/addressSearch';
import { describeLocalPlace } from '../../services/location/placeEnrichment';
import { GOOGLE_ADDRESS_ENABLED } from '../../services/location/addressProvider';
import { describeLookupFailure, metersBetween, shouldReverseGeocode, type ResolvedAddress } from '../../services/location/addressTypes';
import { storeRepository, type ServiceabilityResult } from '../../services/repositories/storeRepository';
import { AddressSearchBox, type AddressSearchBoxRef } from '../../components/address/AddressSearchBox';
import { PickerMap, type PickerMapRef } from '../../components/address/PickerMap';
import { BrandedLoader } from '../../components/ui/BrandedLoader';
import { useAddressDraftStore } from '../../store/addressDraftStore';
import { useLocationStore } from '../../store/locationStore';
import type { LatLng } from '../../types/models';

/** Only used when neither the customer's location nor any active store is known yet (offline on first open). Never saved: Confirm stays off until the pin is placed. */
const LAST_RESORT_CENTER: LatLng = { lat: 27.1767, lng: 78.0081 };
/** The map settling within this distance of where it opened is not "the customer placed the pin". */
const PIN_MOVED_METERS = 8;
const SERVICEABILITY_DEBOUNCE_MS = 500;
const PIN_HEIGHT = 40;
/** The address text is looked up once the pin has rested this long (the phone's GPS reading refines in several steps). */
const LOOKUP_REST_MS = 500;
/** Dragging the pin further than this from the GPS reading makes it the customer's own choice, not the phone's. */
const GPS_PIN_MOVED_METERS = 25;
/** Street level when the picker opens on a pin the customer already has (the first-visit zoom is the wider default). */
const STREET_ZOOM = 17;

export default function MapPickScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string; locate?: string }>();
  const mapRef = useRef<PickerMapRef>(null);
  const searchRef = useRef<AddressSearchBoxRef>(null);
  // Set right before moving the map to a search result: the move itself settles and would otherwise immediately
  // reverse-geocode and overwrite the (richer) result that was just chosen with a plainer lookup of the same spot.
  const skipNextLookup = useRef(false);
  const lastLookup = useRef<LatLng | null>(null);
  const lookupToken = useRef(0);

  // A position Add Address already holds (GPS or an earlier pick) is a real choice; a default centre is not.
  const hasInitialPosition = !!params.lat && !!params.lng && isValidCoordinate(Number(params.lat), Number(params.lng));
  const browsing = useLocationStore((s) => s.selected?.position);
  const [openAt, setOpenAt] = useState<LatLng>(
    hasInitialPosition ? { lat: Number(params.lat), lng: Number(params.lng) } : browsing ?? LAST_RESORT_CENTER,
  );

  const [centre, setCentre] = useState<LatLng | null>(null);
  const [pinPlaced, setPinPlaced] = useState(hasInitialPosition);
  const pinPlacedRef = useRef(pinPlaced);
  pinPlacedRef.current = pinPlaced;

  // No pin and no browsing location yet: open on a real store of ours (from the database) instead of a made-up spot —
  // unless the customer has already started moving the map.
  useEffect(() => {
    if (hasInitialPosition || browsing) return;
    let cancelled = false;
    storeRepository
      .list()
      .then((stores) => {
        const first = stores.find((s) => isValidCoordinate(s.lat, s.lng));
        if (!cancelled && first && !pinPlacedRef.current) {
          setOpenAt({ lat: first.lat, lng: first.lng });
          mapRef.current?.flyTo({ lat: first.lat, lng: first.lng });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const center = centre ?? openAt;
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [gpsPosition, setGpsPosition] = useState<LatLng | null>(null);
  // How exact the phone says the pin is, while the pin is still where the phone put it.
  const [gpsFix, setGpsFix] = useState<{ meters: number | null; precise: boolean } | null>(null);
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const locatingRef = useRef(false);
  locatingRef.current = locating;
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(180);
  const [rootHeight, setRootHeight] = useState(0);
  const [service, setService] = useState<{ status: 'idle' | 'checking' | 'done' | 'failed'; result?: ServiceabilityResult }>({ status: 'idle' });

  // The address text follows the pin, but only once it has RESTED for a moment: while the phone is still refining its GPS
  // reading (or the customer is nudging the map) the pin moves several times, and each lookup is a request.
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lookupAddress = useCallback((position: LatLng) => {
    if (!shouldReverseGeocode(lastLookup.current, position)) return; // barely moved: don't pay for the same answer twice
    lookupToken.current += 1;
    const mine = lookupToken.current;
    setResolving(true);
    setLookupMessage(null);
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(() => {
      lastLookup.current = position;
      addressSearch
        .reverse(position)
        .then(({ address, error }) => {
          if (mine !== lookupToken.current) return; // a newer pin position superseded this answer
          setResolved(address);
          setLookupMessage(error ? describeLookupFailure(error.kind) : null);
          if (error) lastLookup.current = null; // let the next move try again
        })
        .catch(() => {
          if (mine !== lookupToken.current) return;
          setResolved(null);
          lastLookup.current = null;
        })
        .finally(() => {
          if (mine === lookupToken.current) setResolving(false);
        });
    }, LOOKUP_REST_MS);
  }, []);
  useEffect(() => () => clearTimeout(lookupTimer.current), []);

  // Delivery check for the pin as it stands, shortly after it settles — the same server function the location screen,
  // Add Address and Checkout use. A failed check says nothing about the area, so it is never shown as "not delivering here".
  useEffect(() => {
    if (!pinPlaced || !isValidCoordinate(center.lat, center.lng)) {
      setService({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setService({ status: 'checking' });
    const handle = setTimeout(() => {
      storeRepository
        .checkServiceability(center)
        .then((result) => !cancelled && setService({ status: 'done', result }))
        .catch(() => !cancelled && setService({ status: 'failed' }));
    }, SERVICEABILITY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pinPlaced, center.lat, center.lng]);

  const handleCenterSettled = useCallback(
    (position: LatLng) => {
      // The coordinates follow the pin immediately — whatever is under the pin now is what Confirm will use.
      setCentre(position);
      // Once the customer moves the pin away from the GPS fix it is their choice, not the phone's reading.
      if (!locatingRef.current && gpsPosition && metersBetween(position, gpsPosition) > GPS_PIN_MOVED_METERS) setGpsFix(null);
      if (!hasInitialPosition && metersBetween(position, openAt) > PIN_MOVED_METERS) setPinPlaced(true);
      if (skipNextLookup.current) {
        skipNextLookup.current = false;
        lastLookup.current = position;
        return;
      }
      // Don't look anything up for the resting position the map opened at: nothing has been chosen yet.
      if (!hasInitialPosition && metersBetween(position, openAt) <= PIN_MOVED_METERS) return;
      lookupAddress(position);
    },
    [hasInitialPosition, openAt, lookupAddress, gpsPosition],
  );

  const handleTap = useCallback((position: LatLng) => {
    setPinPlaced(true);
    setCentre(position);
  }, []);

  /** Puts the pin on a GPS reading and zooms to street level (closer for a precise reading, wider when it is only approximate). */
  const applyGpsFix = (fix: LocationFix, final: boolean) => {
    const position = { lat: fix.lat, lng: fix.lng };
    setGpsPosition(position);
    setGpsFix({ meters: fix.accuracyMeters, precise: fix.precise });
    setPinPlaced(true);
    setCentre(position);
    mapRef.current?.flyTo(position, zoomForAccuracy(fix.accuracyMeters));
    lookupAddress(position);
    if (final) setGpsMessage(describeGpsAccuracy(fix.accuracyMeters, fix.precise).message);
  };

  /**
   * Finds the customer's exact spot. The phone keeps refining for a few seconds; the pin moves to each better reading and
   * settles on the best one. `auto` is the quiet attempt when the picker opens: it never asks for permission and stays
   * silent if it cannot get a reading (the map is still there to use).
   */
  const locate = async (auto = false) => {
    setLocating(true);
    try {
      let permission = await locationService.getPermissionState();
      if (permission !== 'granted') {
        if (auto) return;
        if (permission === 'not_requested' || permission === 'denied') permission = await locationService.requestPermission();
      }
      if (permission !== 'granted') {
        setGpsMessage(describeLocationFailure('PERMISSION_DENIED'));
        return;
      }
      setGpsMessage(null);
      const fix = await locationService.getCurrentFix({ onProgress: (f) => applyGpsFix(f, false) });
      applyGpsFix(fix, true);
    } catch (e) {
      // No fix: say so (the map still works by panning) — and never move the pin to a guessed place.
      if (!auto) setGpsMessage(describeLocationError(e));
    } finally {
      setLocating(false);
    }
  };
  const handleUseMyLocation = () => locate(false);

  // Like Blinkit / Zepto: opening the picker with no pin already chosen goes straight to where the customer is — but only
  // if location permission was already granted (this never pops a permission dialog by itself).
  useEffect(() => {
    if (params.locate === '1') void locate(false); // the customer tapped "Use current location": asking for permission is expected
    else if (!hasInitialPosition) void locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPlace = (place: ResolvedAddress) => {
    skipNextLookup.current = true;
    lastLookup.current = place.position;
    lookupToken.current += 1; // drop any reverse lookup still in flight for the old pin
    setResolving(false);
    setLookupMessage(null);
    setPinPlaced(true);
    setCentre(place.position);
    setResolved(place);
    mapRef.current?.flyTo(place.position);
  };

  const handleConfirm = () => {
    if (!pinPlaced || !isValidCoordinate(center.lat, center.lng)) return;
    useAddressDraftStore.getState().setPickedLocation({ position: center, address: resolved });
    router.back();
  };

  const serviceInfo: ServiceabilityMessage | null =
    service.status === 'failed' ? describeServiceabilityFailure() : service.status === 'done' && service.result ? describeServiceability(service.result) : null;
  const serviceGood = serviceInfo?.tone === 'ok';

  // With Google's map the panel sits over `mapPadding`, so the map's visual centre is the middle of what is left above it.
  const pinCentreY = GOOGLE_ADDRESS_ENABLED ? (rootHeight - panelHeight) / 2 : rootHeight / 2;

  return (
    <View style={styles.flex} onLayout={(e) => setRootHeight(e.nativeEvent.layout.height)}>
      <PickerMap
        ref={mapRef}
        initialCenter={openAt}
        initialZoom={hasInitialPosition ? STREET_ZOOM : undefined}
        onCenterSettled={handleCenterSettled}
        onTap={handleTap}
        bottomInset={panelHeight}
      />

      {/* Fixed on screen, not bound to a map coordinate — the map moves underneath it, so its tip always marks the exact centre, which is what gets saved. */}
      {rootHeight > 0 && (
        <View style={[styles.pinAnchor, { top: pinCentreY - PIN_HEIGHT }]} pointerEvents="none">
          <MapPin size={PIN_HEIGHT} color={colors.primary} strokeWidth={2} fill={colors.gold} />
        </View>
      )}

      <View style={[styles.topRow, { top: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.circleBtn} hitSlop={8} accessibilityLabel="Go back">
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>

        <AddressSearchBox ref={searchRef} bias={gpsPosition ?? (pinPlaced ? center : openAt)} onSelect={handleSelectPlace} onOpenChange={setSearchOpen} />

        <Pressable onPress={handleUseMyLocation} style={styles.circleBtn} disabled={locating} hitSlop={8} accessibilityLabel="Use my current location">
          {locating ? <BrandedLoader /> : <LocateFixed size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />}
        </Pressable>
      </View>

      {/* Dismisses the results dropdown when tapping the map itself. */}
      {searchOpen && <Pressable style={[StyleSheet.absoluteFill, { top: insets.top + 70 }]} onPress={() => searchRef.current?.dismiss()} />}

      <View
        style={[styles.panel, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
        onLayout={(e) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
      >
        {locating && (
          <View style={styles.serviceRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.serviceChecking}>Finding your exact location…</Text>
          </View>
        )}
        {!locating && gpsFix && <AccuracyChip meters={gpsFix.meters} precise={gpsFix.precise} />}
        {gpsMessage && (
          <View style={{ marginBottom: spacing.sm }}>
            <Text style={styles.gpsMessage}>{gpsMessage}</Text>
            {gpsFix && !gpsFix.precise && (
              <Pressable onPress={() => Linking.openSettings().catch(() => {})} hitSlop={8} accessibilityRole="button">
                <Text style={styles.settingsLink}>Open app settings</Text>
              </Pressable>
            )}
          </View>
        )}
        {pinPlaced ? (
          <View style={styles.addressRow}>
            <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addressText} numberOfLines={3}>
                {resolving ? 'Finding this address…' : resolved?.formattedAddress || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`}
              </Text>
              {/* Where the pin is in plain words: the closest colony / sector and a landmark, from Agra's own place data. */}
              {!resolving && !!resolved?.local && !!describeLocalPlace(resolved.local) && <Text style={styles.localHint}>{describeLocalPlace(resolved.local)}</Text>}
              {!resolving && !resolved && !lookupMessage && <Text style={styles.addressHint}>No street address found for this exact spot. You can type it on the next screen.</Text>}
              {!!lookupMessage && <Text style={[styles.addressHint, { color: colors.warning }]}>{lookupMessage}</Text>}
              {!resolving && resolved && !resolved.parts.street && !resolved.formattedAddress.includes(',') && <Text style={styles.addressHint}>Check the exact spot — this address is approximate.</Text>}
            </View>
          </View>
        ) : (
          <Text style={styles.placeHint}>Move the map so the pin sits on your exact spot, tap the map, search for a place, or use your location.</Text>
        )}

        {pinPlaced && service.status === 'checking' && (
          <View style={styles.serviceRow}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.serviceChecking}>Checking delivery to this spot…</Text>
          </View>
        )}
        {pinPlaced && serviceInfo && (
          <View style={[styles.serviceBanner, serviceGood ? styles.serviceOk : styles.serviceWarn]} accessibilityRole="alert">
            {serviceGood ? <CheckCircle2 size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} /> : <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.serviceTitle, { color: serviceGood ? colors.success : colors.warning }]}>{serviceInfo.title}</Text>
              <Text style={styles.serviceText}>{serviceInfo.message}</Text>
            </View>
          </View>
        )}

        <Pressable style={[styles.confirmBtn, !pinPlaced && styles.confirmBtnDisabled]} onPress={handleConfirm} disabled={!pinPlaced} accessibilityRole="button">
          <Text style={styles.confirmBtnText}>{pinPlaced ? 'Confirm Location' : 'Place the pin first'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "Exact location · ±12 m" / "Check the pin · ±80 m" / "Approximate area" — what the phone says about the pin it placed. */
function AccuracyChip({ meters, precise }: { meters: number | null; precise: boolean }) {
  const level = precise ? classifyPrecision(meters) : 'approximate';
  const good = level === 'exact' || level === 'good';
  const label =
    level === 'exact' ? 'Exact location' : level === 'good' ? 'Good location' : level === 'check' ? 'Check the pin' : level === 'approximate' ? 'Approximate area only' : 'Location found';
  return (
    <View style={[styles.chip, good ? styles.chipGood : styles.chipWarn]} accessibilityLabel={`${label}${meters != null ? `, accurate to ${Math.round(meters)} metres` : ''}`}>
      {good ? <CheckCircle2 size={14} color={colors.success} strokeWidth={ICON_STROKE} /> : <AlertTriangle size={14} color={colors.warning} strokeWidth={ICON_STROKE} />}
      <Text style={[styles.chipText, { color: good ? colors.success : colors.warning }]}>
        {label}
        {meters != null && precise ? ` · ±${Math.round(meters)} m` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, marginBottom: spacing.sm },
  chipGood: { backgroundColor: colors.successTint },
  chipWarn: { backgroundColor: colors.warningTint },
  chipText: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },
  settingsLink: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 4 },
  pinAnchor: { position: 'absolute', left: '50%', marginLeft: -PIN_HEIGHT / 2 },
  topRow: { position: 'absolute', left: spacing.base, right: spacing.base, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, zIndex: 10 },
  circleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.sm },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.base, ...shadows.lg },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  addressText: { ...textStyles.body, color: colors.textPrimary },
  addressHint: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  localHint: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: 3 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  serviceChecking: { ...textStyles.caption, color: colors.textSecondary },
  serviceBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  serviceOk: { backgroundColor: colors.successTint },
  serviceWarn: { backgroundColor: colors.warningTint },
  serviceTitle: { ...textStyles.bodySmall, fontFamily: 'PlusJakartaSans_700Bold' },
  serviceText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  confirmBtn: { height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { backgroundColor: colors.textMuted },
  confirmBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
  gpsMessage: { ...textStyles.bodySmall, color: colors.error, marginBottom: spacing.sm },
  placeHint: { ...textStyles.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
});
