'use client';

import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { currentPosition, describePlace, searchPlaces, type Place } from '@/lib/location';
import { describeBrowserLocationFailure } from '@/lib/serviceability';

interface Props {
  onPick: (place: Place) => void;
  placeholder?: string;
  /** Text to show in the box when a place is already chosen. */
  value?: string;
  autoFocus?: boolean;
}

/** Search for an area or pincode, or use the browser's location. Calls onPick with a position; it never decides whether delivery is possible. */
export function PlaceSearch({ onPick, placeholder = 'Area, colony or pincode in Agra', value = '', autoFocus }: Props) {
  const listId = useId();
  const [text, setText] = useState(value);
  // what the visitor has TYPED (as opposed to text filled in from a chosen place); only typing starts a search
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState<'idle' | 'search' | 'locate'>('idle');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  // a place chosen elsewhere (e.g. restored from a previous visit) shows in the box
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value);
    setSearchTerm('');
  }

  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchPlaces(q, controller.signal);
        setResults(found);
        setOpen(true);
        if (found.length === 0) setMessage('No place found. Try the colony name or the 6-digit pincode.');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setMessage('Address search is unavailable right now. Please try again, or use your location.');
      } finally {
        setBusy('idle');
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchTerm]);

  function onType(next: string) {
    setText(next);
    setSearchTerm(next);
    setMessage('');
    if (next.trim().length < 3) {
      setResults([]);
      setBusy('idle');
    } else {
      setBusy('search');
    }
  }

  async function locate() {
    setBusy('locate');
    setMessage('');
    try {
      const position = await currentPosition();
      const place = await describePlace(position.coords.latitude, position.coords.longitude);
      setText(place.label);
      setSearchTerm('');
      setResults([]);
      setOpen(false);
      onPick(place);
    } catch (error) {
      setMessage(describeBrowserLocationFailure((error as { code?: number }).code));
    } finally {
      setBusy('idle');
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone" aria-hidden />
          <input
            value={text}
            onChange={(e) => onType(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            type="search"
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder={placeholder}
            aria-label="Search your delivery area or pincode"
            aria-controls={listId}
            aria-expanded={open && results.length > 0}
            role="combobox"
            className="field !pl-11"
          />
          {busy === 'search' && <Loader2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-stone" aria-hidden />}
        </div>
        <button type="button" onClick={locate} disabled={busy === 'locate'} className="btn btn-ghost btn-sm !min-h-12 shrink-0 !px-4" aria-label="Use my location">
          {busy === 'locate' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Crosshair size={17} aria-hidden />}
          <span className="hidden sm:inline">Use my location</span>
        </button>
      </div>

      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-line-strong bg-paper p-1.5 shadow-lift">
          {results.map((p) => (
            <li key={`${p.lat},${p.lng}`} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  setText(p.label);
                  setSearchTerm('');
                  setOpen(false);
                  setResults([]);
                  onPick(p);
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-sand"
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-maroon" aria-hidden />
                <span>{p.label}{p.postcode ? <span className="text-taupe"> · {p.postcode}</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="mt-2 text-sm text-danger" role="alert">{message}</p>}
    </div>
  );
}
