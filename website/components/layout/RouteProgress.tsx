'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

// A thin gold bar across the top while the next page loads, so a click always feels acknowledged. It starts when an internal link is clicked and
// finishes when the address changes. Honest: it only moves while a navigation is actually pending, and never gets stuck (it gives up after 8s).
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const address = `${pathname}?${search}`;
  const [width, setWidth] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const guard = useRef<number | undefined>(undefined);

  // the address changed: complete the bar (state adjusted while rendering, the pattern React recommends for "react to a changed value")
  const [shown, setShown] = useState(address);
  if (address !== shown) {
    setShown(address);
    setWidth((w) => (w > 0 ? 100 : 0));
  }

  useEffect(() => {
    window.clearInterval(timer.current);
    window.clearTimeout(guard.current);
    const hide = window.setTimeout(() => setWidth(0), 350);
    return () => window.clearTimeout(hide);
  }, [address]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!link || link.getAttribute('target') === '_blank' || link.hasAttribute('download')) return;
      const url = new URL((link as HTMLAnchorElement).href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      window.clearInterval(timer.current);
      setWidth(12);
      // creep towards 90%, slower the nearer it gets
      timer.current = window.setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w)), 200);
      guard.current = window.setTimeout(() => {
        window.clearInterval(timer.current);
        setWidth(0);
      }, 8000);
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      window.clearInterval(timer.current);
      window.clearTimeout(guard.current);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] h-[3px]" aria-hidden>
      <div className="h-full bg-gradient-to-r from-gold to-gold-dark shadow-[0_0_8px_rgb(198_154_76/0.7)] transition-[width,opacity] duration-300 ease-out" style={{ width: `${width}%`, opacity: width > 0 && width < 100 ? 1 : width === 100 ? 0.6 : 0 }} />
    </div>
  );
}

export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
