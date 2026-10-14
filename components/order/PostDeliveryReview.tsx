import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AppImage } from '../ui/AppImage';
import { AnimatedPressable } from '../motion/AnimatedPressable';
import { BrandedLoader } from '../ui/BrandedLoader';
import { StarRatingInput } from '../product/StarRatingInput';
import { reviewRepository } from '../../services/repositories/reviewRepository';
import { useUIStore } from '../../store/uiStore';
import type { OrderItem } from '../../types/models';

interface RatableItem {
  productId: string;
  name: string;
  image: string;
}

function Row({ item }: { item: RatableItem }) {
  const showToast = useUIStore((s) => s.showToast);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ rating: number } | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    reviewRepository
      .getMyReviews([item.productId])
      .then((map) => {
        if (cancelled) return;
        const existing = map.get(item.productId);
        if (existing) setSubmitted({ rating: existing.rating });
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [item.productId]);

  const submit = async () => {
    if (stars === 0) return;
    setSubmitting(true);
    try {
      // add_review() itself re-verifies this was a delivered purchase —
      // this call can genuinely fail (already reviewed elsewhere, order
      // not actually delivered server-side yet), and that has to reach
      // the customer as a real message, not a silent no-op.
      await reviewRepository.submitReview(item.productId, stars, comment);
      setSubmitted({ rating: stars });
      showToast('Thanks for your review!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't submit your review. Please try again.", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <View style={styles.row}>
        <AppImage uri={item.image} style={styles.thumb} contentFit="cover" kind="product" />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BrandedLoader />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <AppImage uri={item.image} style={styles.thumb} contentFit="cover" kind="product" />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {submitted ? (
          <View style={styles.doneRow}>
            <View style={styles.doneBadge}>
              <Check size={11} color={colors.white} strokeWidth={3} />
            </View>
            <Text style={styles.doneText}>You rated this {submitted.rating}/5 — thank you!</Text>
          </View>
        ) : (
          <>
            <StarRatingInput value={stars} onChange={setStars} size={22} />
            {stars > 0 && (
              <>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Add a comment (optional)"
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.primary}
                  value={comment}
                  onChangeText={setComment}
                  multiline
                />
                <AnimatedPressable style={styles.submitBtn} pressScale={0.96} onPress={submit} disabled={submitting}>
                  {submitting ? <BrandedLoader color={colors.white} /> : <Text style={styles.submitBtnText}>Submit Review</Text>}
                </AnimatedPressable>
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Lets a customer actually rate/review what they bought once an order
 * is delivered — the missing frontend for a review pipeline (reviews
 * table, add_review() verified-purchase RPC, product_ratings aggregate)
 * that already existed end-to-end on the backend but had no screen
 * calling it. One row per distinct product in the order (the reviews
 * table's own unique constraint is per user+product, not per order
 * item, so two variants of the same product still get one shared row).
 */
export function PostDeliveryReview({ items }: { items: OrderItem[] }) {
  const ratable = useMemo<RatableItem[]>(() => {
    const seen = new Set<string>();
    const out: RatableItem[] = [];
    for (const item of items) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      out.push({ productId: item.productId, name: item.name, image: item.image });
    }
    return out;
  }, [items]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Rate Your Order</Text>
      <Text style={styles.cardSubtitle}>Your feedback helps us and other customers.</Text>
      {ratable.map((item, i) => (
        <View key={item.productId} style={[styles.rowWrap, i === ratable.length - 1 && { borderBottomWidth: 0 }]}>
          <Row item={item} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md },
  cardTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  cardSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 52, height: 52, borderRadius: radius.sm },
  name: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold', marginBottom: spacing.xs },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  doneBadge: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  doneText: { ...textStyles.caption, color: colors.textSecondary },
  commentInput: {
    ...textStyles.bodySmall, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginTop: spacing.sm, minHeight: 44, textAlignVertical: 'top',
  },
  submitBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.sm, height: 40, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.lg },
  submitBtnText: { ...textStyles.bodySmall, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
