// The branded loading state: almonds, a pistachio and a cashew drifting across a gold line. Pure SVG + CSS, so it costs nothing to load and
// stops moving (but still shows) for people who prefer reduced motion.

function Almond() {
  return (
    <svg viewBox="0 0 24 28" width="26" height="30" aria-hidden>
      <path d="M12 1.5c5 3.6 8.2 9.3 8.2 14.6 0 5.2-3.5 9.4-8.2 9.4s-8.2-4.2-8.2-9.4C3.8 10.800 7 5.100 12 1.500z" fill="#b98852" />
      <path d="M12 4.500c-2.400 4-3.200 8.600-1.800 15.500" stroke="#8f6330" strokeWidth="1.100" fill="none" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
function Pistachio() {
  return (
    <svg viewBox="0 0 24 28" width="24" height="28" aria-hidden>
      <ellipse cx="12" cy="14" rx="8.200" ry="11" fill="#dccfa4" />
      <path d="M12 3.200c-3.200 3-4.200 9-1 20.600" stroke="#a89a68" strokeWidth="1.200" fill="none" strokeLinecap="round" />
      <ellipse cx="14.500" cy="14.500" rx="3.300" ry="6.500" fill="#8ca35a" />
    </svg>
  );
}
function Cashew() {
  return (
    <svg viewBox="0 0 28 26" width="30" height="28" aria-hidden>
      <path d="M4 9.500C8 2.500 20 1.800 24 9c2.500 4.600 0 11.200-5.200 13.400-2.400 1-5 .6-6.200-1.200 3.200-.1 6.200-1.800 6.600-5C19.800 11 11 8.400 4 12.600z" fill="#e3c58e" />
      <path d="M6.500 9.800c5-3.300 12-2.400 14.600 2.200" stroke="#c49d5f" strokeWidth="1.100" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function NutLoader({ label = 'Loading' }: { label?: string }) {
  const nuts = [Almond, Pistachio, Cashew, Almond, Cashew];
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
      <div className="relative h-11 w-56 overflow-hidden" aria-hidden>
        <div className="absolute inset-x-0 bottom-1.5 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
        {nuts.map((Nut, i) => (
          <span key={i} className="absolute bottom-2.5 left-0 block" style={{ animation: 'almond-flow 2.6s linear infinite', animationDelay: `${i * -0.52}s` }}>
            <Nut />
          </span>
        ))}
      </div>
      <p className="eyebrow">{label}</p>
    </div>
  );
}

/** A small inline spinner for buttons. */
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" fill="none" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
