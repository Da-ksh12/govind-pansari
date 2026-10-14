import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Store } from 'lucide-react-native';
import { colors, radius, shadows } from '../../theme';
import { ICON_STROKE } from '../../theme/icons';

/** Static store marker (section 29). */
export function StoreMapMarker() {
  return (
    <View style={styles.badge}>
      <Store size={16} color={colors.white} strokeWidth={ICON_STROKE} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    borderWidth: 2.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
});
