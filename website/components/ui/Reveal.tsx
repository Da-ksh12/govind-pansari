'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Seconds to wait before this element animates in — use small steps (0.08) to stagger siblings. */
  delay?: number;
  /** Pixels to travel; 0 for a plain fade. */
  y?: number;
}

/**
 * Eases content in as it scrolls into view. The content is fully visible in the server HTML and until JavaScript runs; only elements that are
 * still below the fold at that moment are hidden and then revealed, so nothing flashes and nothing is lost for crawlers or no-JS visitors.
 */
export function Reveal({ children, as: Tag = 'div', className, delay = 0, y = 26 }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // already on screen: leave it alone

    el.style.opacity = '0';
    el.style.transform = `translateY(${y}px)`;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        const animation = el.animate(
          [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 800, delay: delay * 1000, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' },
        );
        animation.onfinish = () => {
          el.style.opacity = '';
          el.style.transform = '';
          animation.cancel();
        };
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.style.opacity = '';
      el.style.transform = '';
    };
  }, [delay, y]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
