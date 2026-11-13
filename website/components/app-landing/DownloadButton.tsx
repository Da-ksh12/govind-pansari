'use client';

import { ArrowRight, Download } from 'lucide-react';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-links';

/**
 * The main "Download the App" button. On an Android phone it opens Google Play, on an iPhone or iPad the App Store; on a computer it brings the two
 * store badges just below it into view (a computer cannot install either app). Without JavaScript it is a plain link to those badges.
 */
export function DownloadButton({ className = '' }: { className?: string }) {
  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    if (android || ios) {
      event.preventDefault();
      window.location.assign(android ? PLAY_STORE_URL : APP_STORE_URL);
      return;
    }
    const badges = document.getElementById('download');
    if (badges) {
      event.preventDefault();
      badges.scrollIntoView({ behavior: 'smooth', block: 'center' });
      badges.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    }
  }

  return (
    <a
      href="#download"
      onClick={onClick}
      className={`group inline-flex h-14 min-w-[17rem] items-center justify-center gap-3 rounded-full bg-maroon px-8 text-[1.02rem] font-bold tracking-wide text-ivory shadow-[0_14px_30px_-10px_rgb(110_20_35/0.55)] transition duration-300 hover:-translate-y-0.5 hover:bg-maroon-dark hover:shadow-[0_18px_34px_-10px_rgb(110_20_35/0.65)] active:translate-y-0 ${className}`}
    >
      <Download size={22} aria-hidden />
      Download the App
      <ArrowRight size={20} className="transition duration-300 group-hover:translate-x-1" aria-hidden />
    </a>
  );
}
