import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Home } from 'lucide-react-native';
import { colors, radius, shadows } from '../../theme';
import { ICON_STROKE } from '../../theme/icons';

/** Static destination marker (section 29) — a pin-shaped badge, teardrop via rotated square + circle. */
export function CustomerMapMarker() {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Home size={16} color={colors.white} strokeWidth={ICON_STROKE} />
      </View>
      <View style={styles.point} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.forest,
    borderWidth: 2.5,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  point: {
    width: 8,
    height: 8,
    backgroundColor: colors.forest,
    transform: [{ rotate: '45deg' }],
    marginTop: -5,
  },
});
