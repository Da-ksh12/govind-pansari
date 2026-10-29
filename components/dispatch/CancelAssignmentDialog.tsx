import React, { useEffect, useState } from 'react';
import { GPConfirmModal } from '../ui/modals/GPModal';
import { cancelPrompt, nextCancelStep, type CancelStep } from '../../services/riderAssignment';

interface Props {
  /** Open the dialog (starts at the first question). */
  visible: boolean;
  riderName: string;
  orderNumber: string;
  /** The assignment's current status ('assigned' = rider has not answered yet). */
  deliveryStatus: string;
  /** Called after the second "yes". It reports its own failures (the dialog closes either way). */
  onConfirm: () => Promise<void>;
  /** Dismissed at either step, or finished. */
  onClose: () => void;
}

/**
 * Cancelling a rider's assignment needs two separate "yes" answers — a manager who taps the wrong button never
 * takes a delivery away from a rider by accident. Built on GPConfirmModal so it works the same on the phone apps
 * and on the admin web panel (Alert.alert does nothing on web).
 */
export function CancelAssignmentDialog({ visible, riderName, orderNumber, deliveryStatus, onConfirm, onClose }: Props) {
  const [step, setStep] = useState<CancelStep>('closed');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStep(visible ? nextCancelStep('closed', 'open') : 'closed');
    setSaving(false);
  }, [visible]);

  if (step === 'closed') return null;
  const prompt = cancelPrompt(step, riderName, orderNumber, deliveryStatus);

  const close = () => {
    setStep(nextCancelStep(step, 'back'));
    onClose();
  };

  const confirm = async () => {
    if (step === 'first') {
      setStep(nextCancelStep(step, 'continue'));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
      setStep(nextCancelStep(step, 'finished'));
      onClose();
    }
  };

  return (
    <GPConfirmModal
      visible
      destructive
      title={prompt.title}
      message={prompt.message}
      primaryLabel={saving ? 'Cancelling…' : prompt.primaryLabel}
      primaryDisabled={saving}
      onPressPrimary={confirm}
      secondaryLabel={prompt.secondaryLabel}
      onPressSecondary={saving ? undefined : close}
      onClose={saving ? () => undefined : close}
    />
  );
}
