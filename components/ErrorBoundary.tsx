import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { RefreshCw, TriangleAlert } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Root-level crash net. Before this, ANY uncaught render error on ANY
 * screen (a bad API response shape, a null field, anything) took down
 * the entire JS instance with no recovery — the user saw the whole
 * app close and land back on the splash/home screen. This catches it
 * once, here, and shows a real recovery screen instead. It does not
 * fix the underlying bug that threw — it makes that bug non-fatal.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error:', error, info.componentStack);
    // Also surfaced on-screen below, and — when EXPO_PUBLIC_SENTRY_DSN is
    // configured (services/monitoring/sentry.ts) — reported to Sentry
    // with the component stack attached, so a real device's crash is no
    // longer only a screenshot someone has to manually send back.
    Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  goHome = () => {
    this.setState({ error: null, componentStack: null });
    router.replace('/');
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <TriangleAlert size={ICON_SIZE.xxl} color={colors.error} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>An unexpected error occurred. Your data is safe — this screen just needs a fresh start.</Text>
          <Pressable style={styles.primaryBtn} onPress={this.reset}>
            <RefreshCw size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={this.goHome}>
            <Text style={styles.secondaryBtnText}>Go to Home</Text>
          </Pressable>
          <View style={styles.detailBox}>
            <Text style={styles.detailText} numberOfLines={4}>{this.state.error.message}</Text>
            {this.state.componentStack && (
              <Text style={styles.detailText} numberOfLines={3}>{this.state.componentStack.trim().split('\n')[0]}</Text>
            )}
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.background },
  iconCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.errorTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 20, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, maxWidth: 320 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primary,
    borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.xxl,
  },
  primaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  secondaryBtn: { marginTop: spacing.md, paddingVertical: spacing.sm },
  secondaryBtnText: { ...textStyles.bodySmall, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  detailBox: { marginTop: spacing.xxl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, maxWidth: 340 },
  detailText: { ...textStyles.caption, color: colors.textMuted, fontSize: 10.5, fontFamily: 'PlusJakartaSans_400Regular' },
});
