import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { ChevronDown, LucideIcon } from 'lucide-react-native';
import { colors, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AccordionItemProps {
  icon: LucideIcon;
  title: string;
  body: string;
  defaultOpen?: boolean;
}

export function AccordionItem({ icon: Icon, title, body, defaultOpen = false }: AccordionItemProps) {
  const [open, setOpen] = useState(defaultOpen);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={toggle}>
        <Icon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
        <Text style={styles.title}>{title}</Text>
        <ChevronDown
          size={ICON_SIZE.sm}
          color={colors.textSecondary}
          strokeWidth={ICON_STROKE}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {open && <Text style={styles.body}>{body}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  title: { ...textStyles.cardTitle, color: colors.textPrimary, flex: 1 },
  body: { ...textStyles.bodySmall, color: colors.textSecondary, paddingBottom: spacing.md, lineHeight: 20 },
});
