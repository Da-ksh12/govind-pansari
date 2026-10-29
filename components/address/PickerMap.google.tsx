import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import type { PickerMapProps, PickerMapRef } from './PickerMap.types';

/** ~0.006° of latitude is a screen about 650 m tall: street level, the same view the OpenStreetMap picker opens at. */
const DEFAULT_DELTA = 0.006;

/**
 * The Google map picker (Maps SDK for Android via react-native-maps, the version Expo SDK 57 pins). It is the map Google's
 * terms require when the address data comes from Google Places / Geocoding. The Google logo and legal text stay visible:
 * `mapPadding` lifts them above the confirm panel instead of letting the panel cover them.
 */
export const GooglePickerMap = forwardRef<PickerMapRef, PickerMapProps>(function GooglePickerMap(
  { initialCenter, initialZoom, onCenterSettled, onMoveStart, onTap, bottomInset },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  /** Region height in degrees for a web-mercator zoom level (zoom 15 ≈ 0.006°, each level halves it). */
  const deltaFor = (zoom?: number) => (zoom ? Math.min(0.05, Math.max(0.0005, DEFAULT_DELTA * 2 ** (15 - zoom))) : DEFAULT_DELTA);
  const delta = deltaFor(initialZoom);

  const moveTo = (position: { lat: number; lng: number }, duration = 600, zoom?: number) => {
    const d = deltaFor(zoom ?? initialZoom);
    mapRef.current?.animateToRegion({ latitude: position.lat, longitude: position.lng, latitudeDelta: d, longitudeDelta: d }, duration);
  };

  useImperativeHandle(ref, () => ({ flyTo: (position, zoom) => moveTo(position, 700, zoom) }));

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: initialCenter.lat, longitude: initialCenter.lng, latitudeDelta: delta, longitudeDelta: delta }}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomInset }}
      onPanDrag={onMoveStart}
      onRegionChangeComplete={(region) => onCenterSettled({ lat: region.latitude, lng: region.longitude })}
      onPress={
        onTap
          ? (e) => {
              const p = { lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude };
              onTap(p);
              moveTo(p, 400);
            }
          : undefined
      }
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      zoomControlEnabled={false}
      showsCompass={false}
      moveOnMarkerPress={false}
    />
  );
});
