import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, View, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { androidKeyboardTop, keyboardOverlap } from '../services/keyboardOverlap';

/**
 * Keeps a screen's content clear of the on-screen keyboard. Put `ref` and `onLayout` on the screen's root View and give that View
 * `paddingBottom: overlap`: scrollable content shrinks and a bar pinned to the bottom rides up above the keyboard.
 * Works with the edge-to-edge window this app uses on Android, where KeyboardAvoidingView does not (see services/keyboardOverlap.ts).
 */
export function useKeyboardOverlap() {
  const ref = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const [overlap, setOverlap] = useState(0);
  // The latest keyboard, as the platform reported it. null = hidden.
  const keyboard = useRef<{ top: number } | null>(null);

  const measure = useCallback(() => {
    const current = keyboard.current;
    if (!current) {
      setOverlap(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _width, height) => {
      setOverlap(keyboardOverlap(y + height, current.top));
    });
  }, []);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const onShow = (event: KeyboardEvent) => {
      const { height, screenY } = event.endCoordinates;
      keyboard.current = {
        top: ios ? screenY : androidKeyboardTop(Dimensions.get('screen').height, height, insets.bottom),
      };
      measure();
    };
    const onHide = () => {
      keyboard.current = null;
      setOverlap(0);
    };
    const subscriptions = [
      Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', onShow),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', onHide),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [insets.bottom, measure]);

  return { ref, overlap, keyboardVisible: overlap > 0, onLayout: measure };
}
