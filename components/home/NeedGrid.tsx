import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Baby, ChefHat, Crown, Dumbbell, Gift, Leaf, Shield, Sparkles } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import type { NeedTag } from '../../types/models';

const ICONS: Record<NeedTag['icon'], React.ComponentType<{ size: number; color: string; strokeWidth: number }>> = {
  leaf: Leaf,
  dumbbell: Dumbbell,
  shield: Shield,
  gift: Gift,
  sparkles: Sparkles,
  baby: Baby,
  crown: Crown,
  cooking: ChefHat,
};

interface NeedGridProps {
  needs: NeedTag[];
}

const CARD_WIDTH = 152;
const CARD_HEIGHT = 110;

export function NeedGrid({ needs }: NeedGridProps) {
  return (
    <FlatList
      horizontal
      data={needs}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => {
        const Icon = ICONS[item.icon];
        return (
          <Pressable style={styles.card} onPress={() => router.push(`/needs/${item.slug}`)}>
            <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient
              colors={['transparent', 'rgba(36,21,18,0.75)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.iconBadge}>
              <Icon size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={styles.label}>{item.label}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, gap: spacing.md },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: spacing.sm,
  },
  iconBadge: { position: 'absolute', top: spacing.sm, left: spacing.sm },
  label: { ...textStyles.cardTitle, color: colors.white, fontSize: 14 },
});
