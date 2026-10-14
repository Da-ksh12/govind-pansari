import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banknote, Building2, CheckCircle2, CreditCard, Smartphone, Wallet } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import type { PaymentInfo } from '../../types/models';

const METHODS: { key: PaymentInfo['method']; label: string; icon: typeof Smartphone; recommended?: boolean }[] = [
  { key: 'upi', label: 'UPI', icon: Smartphone, recommended: true },
  { key: 'card', label: 'Credit / Debit Card', icon: CreditCard },
  { key: 'netbanking', label: 'Net Banking', icon: Building2 },
  { key: 'wallet', label: 'Wallets', icon: Wallet },
  { key: 'cod', label: 'Cash on Delivery', icon: Banknote },
];

interface PaymentMethodRowProps {
  selected: PaymentInfo['method'];
  onSelect: (method: PaymentInfo['method']) => void;
  /** Methods rendered greyed-out and unselectable — e.g. gateway methods before Phase 06 wires up a real payment provider. */
  disabledKeys?: PaymentInfo['method'][];
}

export function PaymentMethodRow({ selected, onSelect, disabledKeys }: PaymentMethodRowProps) {
  return (
    <View style={styles.row}>
      {METHODS.map((m) => {
        const active = selected === m.key;
        const disabled = disabledKeys?.includes(m.key) ?? false;
        return (
          <Pressable
            key={m.key}
            style={[styles.card, active && styles.cardActive, disabled && styles.cardDisabled]}
            onPress={() => !disabled && onSelect(m.key)}
            disabled={disabled}
          >
            {active && (
              <View style={styles.check}>
                <CheckCircle2 size={14} color={colors.white} fill={colors.primary} strokeWidth={2} />
              </View>
            )}
            <View style={styles.cardBody}>
              <m.icon size={ICON_SIZE.lg} color={disabled ? colors.textMuted : active ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={[styles.label, active && styles.labelActive, disabled && styles.labelDisabled]} numberOfLines={1}>{m.label}</Text>
            </View>
            {/* Fixed-height slot, always reserved (section 14: "consistent
                badge position") so a tagged card never grows taller than
                an untagged one, and the tag lives inside its own card's
                bounds instead of overhanging into the row below. */}
            <View style={styles.tagSlot}>
              {disabled ? (
                <View style={styles.comingSoonTag}>
                  <Text style={styles.comingSoonText}>Coming Soon</Text>
                </View>
              ) : (
                m.recommended && (
                  <View style={styles.recommendedTag}>
                    <Text style={styles.recommendedText}>Recommended</Text>
                  </View>
                )
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const CARD_WIDTH = 96;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    width: CARD_WIDTH,
    height: 100,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    paddingHorizontal: 6,
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },
  cardActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  cardDisabled: { opacity: 0.5 },
  check: { position: 'absolute', top: 6, right: 6 },
  cardBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center', fontSize: 11 },
  labelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  labelDisabled: { color: colors.textMuted },
  // Always reserves the same height whether or not a tag renders inside
  // it, so every card in the row stays the same height (section 14).
  tagSlot: { height: 16, alignItems: 'center', justifyContent: 'center' },
  recommendedTag: { backgroundColor: colors.error, paddingHorizontal: 6, borderRadius: radius.pill },
  recommendedText: { fontSize: 8.5, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  comingSoonTag: { backgroundColor: colors.textMuted, paddingHorizontal: 6, borderRadius: radius.pill },
  comingSoonText: { fontSize: 8.5, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
