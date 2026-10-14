import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { colors } from '../../theme';
import { osmMapStyle } from '../../services/map/osmStyle';
import { RiderMapMarker } from './RiderMapMarker';
import { StoreMapMarker } from './StoreMapMarker';
import { CustomerMapMarker } from './CustomerMapMarker';
import type { LiveTrackingMapProps, LiveTrackingMapRef } from './LiveTrackingMap.types';
import type { LatLng } from '../../types/models';

function toLineString(points: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } };
}

/** Real MapLibre rendering — iOS/Android only (see LiveTrackingMap.web.tsx for the web fallback and why one is needed). */
export const LiveTrackingMap = forwardRef<LiveTrackingMapRef, LiveTrackingMapProps>(function LiveTrackingMap(
  { storePos, destPos, riderPos, heading, stale, arrived = false, route, initialCenter },
  ref,
) {
  const cameraRef = useRef<CameraRef>(null);

  useImperativeHandle(ref, () => ({
    fitBounds: (bounds, options) => cameraRef.current?.fitBounds(bounds, options),
  }));

  return (
    <Map mapStyle={osmMapStyle} style={styles.map} logo={false} attribution={false} compass={false}>
      <Camera ref={cameraRef} initialViewState={{ center: initialCenter ? [initialCenter.lng, initialCenter.lat] : [0, 0], zoom: 13 }} />

      {route?.polyline && route.polyline.length > 1 && (
        <GeoJSONSource id="route-source" data={toLineString(route.polyline)}>
          <Layer
            id="route-line"
            type="line"
            source="route-source"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': colors.primary, 'line-width': 4, 'line-opacity': 0.85 }}
          />
        </GeoJSONSource>
      )}

      {storePos && (
        <Marker lngLat={[storePos.lng, storePos.lat]} anchor="bottom">
          <StoreMapMarker />
        </Marker>
      )}
      {destPos && (
        <Marker lngLat={[destPos.lng, destPos.lat]} anchor="bottom">
          <CustomerMapMarker />
        </Marker>
      )}
      {riderPos && (
        <Marker lngLat={[riderPos.lng, riderPos.lat]} anchor="center">
          <RiderMapMarker heading={heading} stale={stale} arrived={arrived} />
        </Marker>
      )}
    </Map>
  );
});

const styles = StyleSheet.create({
  map: { flex: 1 },
});
