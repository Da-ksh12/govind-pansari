import React from 'react';
import * as Sentry from '@sentry/react-native';

interface Props {
  name: string;
  children: React.ReactNode;
}

/**
 * For root-level UI that is a convenience, not a requirement (offline
 * banner, toasts, notification overlays). An uncaught error in one of
 * these used to unmount the entire React tree, which in a release build
 * closes the app. This renders nothing for the failed piece instead,
 * while still logging and reporting the real error — it hides the UI,
 * not the failure.
 */
export class OptionalBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[OptionalBoundary:${this.props.name}] disabled after error:`, error, info.componentStack);
    Sentry.captureException(error, { tags: { optionalComponent: this.props.name } });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
