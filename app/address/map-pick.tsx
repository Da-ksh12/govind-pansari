import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { ArrowLeft, LocateFixed, MapPin, Search, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { osmMapStyle } from '../../services/map/osmStyle';
import { locationService } from '../../services/location/locationService';
import { geocodingService, type GeocodeResult } from '../../services/location/geocodingService';
import { placesSearchService, type PlaceSearchResult } from '../../services/location/placesSearchService';
import { BrandedLoader } from '../../components/ui/BrandedLoader';
import { useAddressDraftStore } from '../../store/addressDraftStore';
import type { LatLng } from '../../types/models';

// Agra city centre — used only when Add Address hasn't already captured
// a position (GPS or a previous pick) to open the map on.
const AGRA_FALLBACK: LatLng = { lat: 27.1767, lng: 78.0081 };
const PLACE_SEARCH_DEBOUNCE_MS = 400;

export default function MapPickScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const cameraRef = useRef<CameraRef>(null);
  // Set right before flyTo-ing to a search result's coordinates — the
  // camera move itself fires onRegionDidChange once it settles, which
  // would otherwise immediately re-reverse-geocode and overwrite the
  // (already correct, already richer) place-search result with a
  // plainer on-device reverse-geocode of the same point.
  const skipNextRegionGeocode = useRef(false);

  const initialCenter: LatLng =
    params.lat && params.lng && !Number.isNaN(Number(params.lat)) && !Number.isNaN(Number(params.lng))
      ? { lat: Number(params.lat), lng: Number(params.lng) }
      : AGRA_FALLBACK;

  const [center, setCenter] = useState<LatLng>(initialCenter);
  const [geocoded, setGeocoded] = useState<GeocodeResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Debounced place search — fires PLACE_SEARCH_DEBOUNCE_MS after the
  // customer pauses typing, well inside Nominatim's usage policy.
  useEffect(() => {
    if (searchText.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      placesSearchService.search(searchText).then((results) => {
        if (!cancelled) {
          setSearchResults(results);
          setSearching(false);
        }
      });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchText]);

  // MapLibre only calls this once panning/zooming has actually settled
  // (not on every intermediate frame), so it's already the right moment
  // to reverse-geocode — no extra debounce needed on top of it.
  const handleRegionDidChange = useCallback((position: LatLng) => {
    setCenter(position);
    if (skipNextRegionGeocode.current) {
      skipNextRegionGeocode.current = false;
      return;
    }
    setResolving(true);
    geocodingService
      .reverseGeocode(position)
      .then((result) => setGeocoded(result))
      .finally(() => setResolving(false));
  }, []);

  const handleUseMyLocation = async () => {
    setLocating(true);
    try {
      let permission = await locationService.getPermissionState();
      if (permission === 'not_requested' || permission === 'denied') {
        permission = await locationService.requestPermission();
      }
      if (permission !== 'granted') return;
      const position = await locationService.getCurrentPosition();
      cameraRef.current?.flyTo({ center: [position.lng, position.lat], duration: 600 });
      handleRegionDidChange(position);
    } catch {
      // Silent — the picker still works by panning the map manually.
    } finally {
      setLocating(false);
    }
  };

  const handleSelectPlace = (place: PlaceSearchResult) => {
    Keyboard.dismiss();
    setShowResults(false);
    setSearchText('');
    setSearchResults([]);
    skipNextRegionGeocode.current = true;
    setCenter(place.position);
    setGeocoded({ label: place.label, addressLine: place.addressLine, city: place.city, state: place.state, postalCode: place.postalCode, placeName: place.placeName });
    cameraRef.current?.flyTo({ center: [place.position.lng, place.position.lat], duration: 700 });
  };

  const clearSearch = () => {
    setSearchText('');
    setSearchResults([]);
  };

  const handleConfirm = () => {
    useAddressDraftStore.getState().setPickedLocation({
      position: center,
      addressLine: geocoded?.addressLine,
      city: geocoded?.city,
      state: geocoded?.state,
      postalCode: geocoded?.postalCode,
      placeName: geocoded?.placeName,
    });
    router.back();
  };

  return (
    <View style={styles.flex}>
      <Map
        mapStyle={osmMapStyle}
        style={styles.flex}
        logo={false}
        attribution={false}
        compass={false}
        onRegionDidChange={(e) => handleRegionDidChange({ lat: e.nativeEvent.center[1], lng: e.nativeEvent.center[0] })}
      >
        <Camera ref={cameraRef} initialViewState={{ center: [initialCenter.lng, initialCenter.lat], zoom: 15 }} />
      </Map>

      {/* Fixed on screen, not bound to a map coordinate — the map moves
          underneath it, so its tip always marks the exact centre, which
          is what gets saved. */}
      <View style={styles.pinAnchor} pointerEvents="none">
        <MapPin size={40} color={colors.primary} strokeWidth={2} fill={colors.gold} />
      </View>

      <View style={[styles.topRow, { top: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.circleBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>

        <View style={styles.searchBarWrap}>
          <View style={styles.searchBar}>
            <Search size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for a place..."
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              value={searchText}
              onChangeText={(t) => {
                setSearchText(t);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              returnKeyType="search"
            />
            {searching ? (
              <BrandedLoader />
            ) : (
              !!searchText && (
                <Pressable onPress={clearSearch} hitSlop={10}>
                  <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                </Pressable>
              )
            )}
          </View>

          {showResults && searchText.trim().length >= 2 && (
            <View style={styles.resultsCard}>
              {searchResults.length === 0 && !searching ? (
                <Text style={styles.noResultsText}>No places found for "{searchText}"</Text>
              ) : (
                <FlatList
                  data={searchResults}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <Pressable style={styles.resultRow} onPress={() => handleSelectPlace(item)}>
                      <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.resultTitle} numberOfLines={1}>{item.placeName}</Text>
                        <Text style={styles.resultSubtitle} numberOfLines={2}>{item.addressLine}</Text>
                      </View>
                    </Pressable>
                  )}
                />
              )}
            </View>
          )}
        </View>

        <Pressable onPress={handleUseMyLocation} style={styles.circleBtn} disabled={locating} hitSlop={8}>
          {locating ? <BrandedLoader /> : <LocateFixed size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />}
        </Pressable>
      </View>

      {/* Dismisses the results dropdown when tapping the map itself. */}
      {showResults && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            setShowResults(false);
            Keyboard.dismiss();
          }}
        />
      )}

      <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View style={styles.addressPreviewRow}>
          <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
          <Text style={styles.addressPreviewText} numberOfLines={2}>
            {resolving ? 'Finding this address…' : geocoded?.addressLine ?? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`}
          </Text>
        </View>
        <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
          <Text style={styles.confirmBtnText}>Confirm Location</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pinAnchor: {
    position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -40,
  },
  topRow: { position: 'absolute', left: spacing.base, right: spacing.base, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, zIndex: 10 },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.sm,
  },
  searchBarWrap: { flex: 1 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.pill, height: 40,
    paddingHorizontal: spacing.base, ...shadows.sm,
  },
  searchInput: { flex: 1, height: '100%', ...textStyles.bodySmall, color: colors.textPrimary, padding: 0 },
  resultsCard: {
    marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md,
    maxHeight: 280, overflow: 'hidden', ...shadows.lg,
  },
  noResultsText: { ...textStyles.bodySmall, color: colors.textMuted, padding: spacing.base, textAlign: 'center' },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.base,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  resultTitle: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  resultSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  bottomSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.base, ...shadows.lg,
  },
  addressPreviewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.base },
  addressPreviewText: { ...textStyles.body, color: colors.textPrimary, flex: 1 },
  confirmBtn: { height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
