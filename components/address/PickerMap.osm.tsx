import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { osmMapStyle } from '../../services/map/osmStyle';
import type { PickerMapProps, PickerMapRef } from './PickerMap.types';

/**
 * The OpenStreetMap-tile picker (MapLibre) — the app's original map and still the one used while Google address search
 * is not switched on. OpenStreetMap results on an OpenStreetMap map: no third-party data policy is crossed.
 */
export const OsmPickerMap = forwardRef<PickerMapRef, PickerMapProps>(function OsmPickerMap(
  { initialCenter, initialZoom = 15, onCenterSettled, onMoveStart, onTap },
  ref,
) {
  const cameraRef = useRef<CameraRef>(null);

  useImperativeHandle(ref, () => ({
    flyTo: (position, zoom) => cameraRef.current?.flyTo({ center: [position.lng, position.lat], ...(zoom ? { zoom } : {}), duration: 700 }),
  }));

  return (
    <Map
      mapStyle={osmMapStyle}
      style={StyleSheet.absoluteFill}
      logo={false}
      attribution={false}
      compass={false}
      onRegionWillChange={onMoveStart}
      onRegionDidChange={(e) => onCenterSettled({ lat: e.nativeEvent.center[1], lng: e.nativeEvent.center[0] })}
      onPress={onTap ? (e) => onTap({ lat: e.nativeEvent.lngLat[1], lng: e.nativeEvent.lngLat[0] }) : undefined}
    >
      <Camera ref={cameraRef} initialViewState={{ center: [initialCenter.lng, initialCenter.lat], zoom: initialZoom }} />
    </Map>
  );
});
