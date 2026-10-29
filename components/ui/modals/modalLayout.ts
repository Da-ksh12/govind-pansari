const STACK_BUTTONS_LABEL_LENGTH = 14;

/**
 * True when both modal buttons are shown and at least one label is too long to
 * stay on a single line in a half-width button (QA TC-12: "Change Payment
 * Method" wrapped onto two lines). Kept free of React Native so it can be
 * unit-tested.
 */
export function shouldStackModalButtons(primaryLabel?: string, secondaryLabel?: string): boolean {
  if (!primaryLabel || !secondaryLabel) return false;
  return primaryLabel.length > STACK_BUTTONS_LABEL_LENGTH || secondaryLabel.length > STACK_BUTTONS_LABEL_LENGTH;
}
