'use client';

import { useEffect } from 'react';
import { Seal } from '../brand/Logo';

/**
 * A short welcome (about a second) shown once per visit. The markup is in the server HTML and hidden by CSS; a tiny inline script in <head>
 * (see app/layout.tsx) switches it on only when this is the first page of the visit and the visitor has not asked for reduced motion.
 * If JavaScript never loads, the CSS animation in globals.css still removes it — a visitor can never be stuck behind it.
 */
export function SplashScreen() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.splash !== 'on') return;
    try {
      window.sessionStorage.setItem('gp.splash', '1');
    } catch {
      // private mode: the splash may show again on the next page load, which is harmless
    }
    const leave = window.setTimeout(() => root.setAttribute('data-splash', 'leaving'), 1100);
    const gone = window.setTimeout(() => root.setAttribute('data-splash', 'off'), 1650);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, []);

  return (
    <div id="splash" aria-hidden="true">
      <div className="splash-inner">
        <Seal size={112} />
        <p className="font-display mt-5 text-2xl tracking-wide text-ivory">Govind Pansari</p>
        <p className="eyebrow mt-1 !text-gold">Since 1950 · Agra</p>
        <span className="splash-line" />
      </div>
    </div>
  );
}
