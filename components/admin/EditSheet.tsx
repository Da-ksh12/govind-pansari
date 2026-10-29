import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

interface EditSheetProps {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
  /** A problem with the whole form (e.g. the server refused it), shown above the buttons. */
  error?: string | null;
  children: React.ReactNode;
}

/** The admin panel's edit dialog: a titled card with scrolling fields and Cancel / Save — one look for every "edit details" screen. */
export function EditSheet({ title, onClose, onSave, saving, saveLabel = 'Save', error, children }: EditSheetProps) {
  return (
    <Modal transparent animationType="fade" onRequestClose={saving ? undefined : onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} disabled={saving} hitSlop={8} accessibilityLabel="Close">
                <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              </Pressable>
            </View>
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
            {!!error && <Text style={styles.formError}>{error}</Text>}
            <View style={styles.actions}>
              <Pressable style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={onSave} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{saveLabel}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface EditFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  /** A line of help under the box (or the parsed value, e.g. "= 9:00 PM"). Hidden while there is an error. */
  hint?: string;
}

export function EditField({ label, error, hint, ...input }: EditFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={[styles.input, !!error && styles.inputError]} placeholderTextColor={colors.textMuted} {...input} />
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

interface ChoiceChipsProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string;
}

export function ChoiceChips<T extends string>({ label, options, value, onChange, error }: ChoiceChipsProps<T>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((o) => (
          <Pressable key={o.value} style={[styles.chip, value === o.value && styles.chipActive]} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityState={{ selected: value === o.value }}>
            <Text style={[styles.chipText, value === o.value && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 460, maxHeight: '86%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadows.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  body: { flexGrow: 0, flexShrink: 1 },
  field: { marginBottom: spacing.sm },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  input: { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: 'transparent', ...textStyles.bodySmall, color: colors.textPrimary },
  inputError: { borderColor: colors.error },
  fieldError: { ...textStyles.caption, color: colors.error, marginTop: 4 },
  fieldHint: { ...textStyles.caption, color: colors.textMuted, marginTop: 4 },
  formError: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...textStyles.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  saveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
