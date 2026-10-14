import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * OS-level "Reduce Motion" setting (iOS Accessibility, Android "Remove
 * animations"). Cinematic/decorative animations (splash sequence,
 * confetti, parallax) should check this and shorten or skip themselves
 * — functional feedback (a button press, a loading spinner) should
 * still run regardless, since motion isn't the only way to *see* it but
 * removing it entirely would remove the only feedback some of these
 * give.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => setReduced(value));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
