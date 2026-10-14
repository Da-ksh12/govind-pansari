import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius } from '../../theme';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarStatus = 'online' | 'offline' | 'busy';

const SIZE_PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 44, lg: 64, xl: 96 };
const FONT_PX: Record<AvatarSize, number> = { xs: 10, sm: 13, md: 17, lg: 24, xl: 34 };
const DOT_PX: Record<AvatarSize, number> = { xs: 7, sm: 8, md: 10, lg: 14, xl: 18 };

// Deterministic per-name color so the same person always gets the same
// initials tile across every screen, instead of a random color on
// every mount — a small, on-brand set, never blue/purple.
const INITIAL_PALETTE: { bg: string; text: string }[] = [
  { bg: colors.primaryTint, text: colors.primary },
  { bg: colors.goldTint, text: colors.goldDark },
  { bg: colors.forestTint, text: colors.forest },
  { bg: colors.sageTint, text: colors.sage },
  { bg: colors.terracottaTint, text: colors.terracotta },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function paletteFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return INITIAL_PALETTE[hash % INITIAL_PALETTE.length]!;
}

const STATUS_COLOR: Record<AvatarStatus, string> = {
  online: colors.success,
  offline: colors.textMuted,
  busy: colors.warning,
};

interface AvatarProps {
  uri?: string | null;
  /** Used for the initials fallback and the deterministic tile color — always pass the real name, even when a photo is expected, so a failed load still degrades gracefully. */
  name: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  shape?: 'circle' | 'rounded';
}

/**
 * Shared identity avatar for riders/customers/staff/admins (redesign
 * section 42). A real photo is shown when it loads; any other state —
 * no uri, still loading, or a failed fetch — degrades to a stable,
 * on-brand initials tile, never a broken-image icon or blank box.
 */
export function Avatar({ uri, name, size = 'md', status, shape = 'circle' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size];
  const dot = DOT_PX[size];
  const palette = paletteFor(name || '?');
  const showPhoto = !!uri && !failed;

  return (
    <View style={{ width: px, height: px }}>
      <View
        style={[
          styles.base,
          {
            width: px,
            height: px,
            borderRadius: shape === 'circle' ? px / 2 : radius.md,
            backgroundColor: showPhoto ? colors.surfaceSunken : palette.bg,
          },
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: uri! }}
            style={{ width: px, height: px }}
            contentFit="cover"
            transition={150}
            onError={() => setFailed(true)}
          />
        ) : (
          <Text style={[styles.initials, { fontSize: FONT_PX[size], color: palette.text }]} numberOfLines={1}>
            {initialsOf(name)}
          </Text>
        )}
      </View>
      {status && (
        <View
          style={[
            styles.statusDot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: STATUS_COLOR[status],
              borderWidth: Math.max(1.5, dot * 0.15),
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontFamily: 'PlusJakartaSans_700Bold' },
  statusDot: { position: 'absolute', right: -1, bottom: -1, borderColor: colors.surface },
});
