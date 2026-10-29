import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MapPin, Search, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { addressSearch } from '../../services/location/addressSearch';
import { AddressLookupError, describeLookupFailure, newSessionToken, type AddressSuggestion, type ResolvedAddress } from '../../services/location/addressTypes';
import type { LatLng } from '../../types/models';

const DEBOUNCE_MS = 350;
const MIN_CHARS = 3;

export interface AddressSearchBoxRef {
  dismiss: () => void;
}

interface Props {
  /** Where to bias results: the customer's own position when known, otherwise the area the map is showing. */
  bias: LatLng | null;
  onSelect: (address: ResolvedAddress) => void;
  /** The dropdown opened/closed — the screen uses it to put a tap-away layer over the map. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Type-ahead place search. Each keystroke pause (350 ms, 3+ characters) is one request; results from a slow, older
 * request are ignored; one session token groups the typing and the final pick (Google bills that as one unit); every failure has its own
 * words and none of them blocks the customer from moving the pin instead.
 */
export const AddressSearchBox = forwardRef<AddressSearchBoxRef, Props>(function AddressSearchBox({ bias, onSelect, onOpenChange }, ref) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const session = useRef(newSessionToken());
  const requestId = useRef(0);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useImperativeHandle(ref, () => ({
    dismiss: () => {
      setOpenState(false);
      Keyboard.dismiss();
    },
  }));

  useEffect(() => {
    const query = text.trim();
    requestId.current += 1;
    const mine = requestId.current;
    if (query.length < MIN_CHARS) {
      setSuggestions([]);
      setSearching(false);
      setSearched(false);
      setFailure(null);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      addressSearch
        .suggest(query, session.current, bias)
        .then((list) => {
          if (mine !== requestId.current) return;
          setSuggestions(list);
          setFailure(null);
          setSearched(true);
        })
        .catch((e) => {
          if (mine !== requestId.current) return;
          setSuggestions([]);
          setSearched(false);
          setFailure(describeLookupFailure(e instanceof AddressLookupError ? e.kind : 'unavailable'));
        })
        .finally(() => {
          if (mine === requestId.current) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // The bias only matters for the next search; re-running on every map move would fire a request per pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const choose = async (item: AddressSuggestion) => {
    setResolvingId(item.id);
    setFailure(null);
    try {
      const resolved = await addressSearch.resolve(item, session.current);
      session.current = newSessionToken(); // the session ended with this selection
      Keyboard.dismiss();
      setOpenState(false);
      setText('');
      setSuggestions([]);
      setSearched(false);
      onSelect(resolved);
    } catch (e) {
      setFailure(e instanceof AddressLookupError && e.kind !== 'unavailable' ? describeLookupFailure(e.kind) : "Couldn't load that place. Try another result.");
    } finally {
      setResolvingId(null);
    }
  };

  const showCard = open && text.trim().length >= MIN_CHARS;
  const source = suggestions[0]?.source;

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Search size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        <TextInput
          style={styles.input}
          placeholder="Search for area, street, landmark…"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          value={text}
          onChangeText={(t) => {
            setText(t);
            setOpenState(true);
          }}
          onFocus={() => setOpenState(true)}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search for a place"
        />
        {searching ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          !!text && (
            <Pressable
              onPress={() => {
                setText('');
                session.current = newSessionToken();
              }}
              hitSlop={10}
              accessibilityLabel="Clear search"
            >
              <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            </Pressable>
          )
        )}
      </View>

      {showCard && (
        <View style={styles.card}>
          {failure ? (
            <Text style={[styles.note, { color: colors.error }]} accessibilityRole="alert">
              {failure}
            </Text>
          ) : searched && suggestions.length === 0 && !searching ? (
            <Text style={styles.note}>No places found for "{text.trim()}". Try a nearby landmark, or move the pin on the map.</Text>
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => choose(item)} disabled={!!resolvingId} accessibilityRole="button">
                  <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={1}>
                      {item.primary}
                    </Text>
                    {!!item.secondary && (
                      <Text style={styles.subtitle} numberOfLines={2}>
                        {item.secondary}
                      </Text>
                    )}
                  </View>
                  {resolvingId === item.id && <ActivityIndicator size="small" color={colors.primary} />}
                </Pressable>
              )}
              ListFooterComponent={source ? <Text style={styles.attribution}>{addressSearch.attribution(source)}</Text> : null}
            />
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 44,
    paddingHorizontal: spacing.base,
    ...shadows.sm,
  },
  input: { flex: 1, height: '100%', ...textStyles.bodySmall, color: colors.textPrimary, padding: 0 },
  card: { marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, maxHeight: 300, overflow: 'hidden', ...shadows.lg },
  note: { ...textStyles.bodySmall, color: colors.textMuted, padding: spacing.base, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  subtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  // Google asks for plain "Google Maps" text, in a legible grey, near the results it supplied.
  attribution: { ...textStyles.caption, color: '#5E5E5E', fontSize: 12, textAlign: 'right', paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
});
