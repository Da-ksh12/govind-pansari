import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { describeUnanswered, type RiderAttempt } from '../../services/riderAssignment';

interface Props {
  attempt: RiderAttempt;
  /** Opens the rider list so a new rider can be chosen right away. Leave out when the list is already on screen. */
  onChooseAnother?: () => void;
  disabled?: boolean;
}

/** "Ramesh declined this order" — shown until another rider is chosen, with the button that does it. */
export function RiderDidNotAcceptNotice({ attempt, onChooseAnother, disabled }: Props) {
  const { title, detail } = describeUnanswered(attempt);
  return (
    <View style={styles.box} accessibilityRole="alert">
      <View style={styles.head}>
        <AlertTriangle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </View>
      {onChooseAnother && (
        <Pressable style={[styles.btn, disabled && styles.btnDisabled]} onPress={onChooseAnother} disabled={disabled}>
          <Text style={styles.btnText}>Choose another rider</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.errorTint, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...textStyles.bodySmall, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  detail: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { ...textStyles.button, fontSize: 14, color: colors.white },
});
