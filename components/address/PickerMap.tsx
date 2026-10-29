import { GOOGLE_ADDRESS_ENABLED } from '../../services/location/addressProvider';
import { OsmPickerMap } from './PickerMap.osm';

export type { PickerMapProps, PickerMapRef } from './PickerMap.types';

/**
 * The Google map when Google address search is on, the OpenStreetMap map otherwise — see addressProvider.ts for why they
 * travel together. The Google component is only evaluated when it is switched on, so a build that has not been given a
 * Google Maps SDK key never runs any react-native-maps code (the module is in the bundle, but nothing executes it).
 */
export const PickerMap = GOOGLE_ADDRESS_ENABLED
  ? (require('./PickerMap.google') as typeof import('./PickerMap.google')).GooglePickerMap
  : OsmPickerMap;
