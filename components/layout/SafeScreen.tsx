import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { colors } from '../../theme';

interface SafeScreenProps extends ViewProps {
  edges?: Edge[];
  backgroundColor?: string;
}

export function SafeScreen({
  edges = ['top'],
  backgroundColor = colors.background,
  style,
  children,
  ...rest
}: SafeScreenProps) {
  return (
    <View style={[styles.flex, { backgroundColor }]}>
      <SafeAreaView edges={edges} style={[styles.flex, style]} {...rest}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
