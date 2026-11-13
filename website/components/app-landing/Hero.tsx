import { Smartphone } from 'lucide-react';
import Image from 'next/image';
import { DownloadButton } from './DownloadButton';
import { PhoneMockup } from './PhoneMockup';
import { StoreBadges } from './StoreBadges';

/** The deep-red cloth the photograph rests on: drawn as a shape (soft folds from two gradients), not claimed to be a photograph. */
function Cloth() {
  return (
    <svg viewBox="0 0 1000 420" preserveAspectRatio="none" className="pointer-events-none absolute bottom-0 right-0 -z-10 h-[19rem] w-full [mask-image:linear-gradient(to_right,transparent,black_42%)] lg:h-[54%] lg:w-[64%]" aria-hidden>
      <defs>
        <linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a1a2c" />
          <stop offset="0.55" stopColor="#6e1423" />
          <stop offset="1" stopColor="#3d0a14" />
        </linearGradient>
        <linearGradient id="fold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c0405a" stopOpacity="0" />
          <stop offset="0.5" stopColor="#c0405a" stopOpacity="0.45" />
          <stop offset="1" stopColor="#c0405a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 250 C 130 170, 260 110, 400 150 S 640 230, 780 150 S 940 50, 1000 70 L1000 385 C 840 418, 700 372, 520 400 S 170 412, 0 388 Z" fill="url(#cloth)" />
      <path d="M0 250 C 150 190, 300 170, 450 215 S 720 285, 1000 190" fill="none" stroke="url(#fold)" strokeWidth="5" />
      <path d="M0 320 C 200 280, 360 270, 520 305 S 800 360, 1000 290" fill="none" stroke="url(#fold)" strokeWidth="3" opacity="0.6" />
    </svg>
  );
}

export function Hero() {
  return (
    <header className="relative isolate overflow-hidden">
      <Cloth />
      {/* soft light behind the scene, like the warm shop interior in the reference */}
      <div className="pointer-events-none absolute -right-24 top-10 -z-10 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgb(248_214_170/0.85),transparent_68%)]" aria-hidden />
      <div className="pointer-events-none absolute -left-32 bottom-10 -z-10 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgb(244_205_160/0.55),transparent_68%)]" aria-hidden />

      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6 sm:px-8 sm:pt-8 lg:pb-20">
        {/* brand row: the original logo (a circle cut from the supplied logo) beside the shop's line; the Official App badge on the right */}
        <div className="gp-rise flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-5">
            <Image
              src="/app/govind-pansari-logo.png"
              alt="Govind Pansari — Dry Fruits & Spices"
              width={88}
              height={88}
              priority
              className="h-14 w-14 rounded-full shadow-[0_10px_24px_-8px_rgb(110_20_35/0.55)] ring-2 ring-white/70 sm:h-[4.5rem] sm:w-[4.5rem]"
            />
            <span className="hidden h-12 w-px bg-maroon/25 sm:block" aria-hidden />
            <span className="hidden font-display text-[1.35rem] italic text-maroon-dark sm:block">Dry Fruits &amp; Spices</span>
          </div>
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/70 bg-white/60 px-4 py-2.5 text-sm font-bold text-maroon shadow-soft backdrop-blur sm:px-5">
            <Smartphone size={19} aria-hidden /> Official App
          </span>
        </div>

        <div className="mt-10 grid items-center gap-12 lg:mt-6 lg:grid-cols-[1.16fr_1fr] lg:gap-4">
          <div className="max-w-[38rem] lg:py-10">
            <h1 className="gp-rise font-display text-[clamp(2.35rem,4.9vw,4rem)] font-semibold leading-[1.03] tracking-tight text-maroon-darker" style={{ '--d': '0.1s' } as React.CSSProperties}>
              Your Favourite Store.{' '}
              <span className="relative mt-1 block w-fit font-medium italic text-maroon">
                Now in Your Pocket.
                <svg viewBox="0 0 400 14" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full" aria-hidden>
                  <path d="M3 10 C 70 3, 150 12, 396 4" fill="none" stroke="#c69a4c" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="gp-rise mt-8 max-w-md text-[1.12rem] leading-relaxed text-espresso/80" style={{ '--d': '0.25s' } as React.CSSProperties}>
              Discover a convenient way to explore and shop premium dry fruits and spices from Agra’s family shop, trusted since 1950. Pick your pack, and have it delivered to your door.
            </p>
            <div className="gp-rise mt-9" style={{ '--d': '0.4s' } as React.CSSProperties}>
              <DownloadButton />
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-taupe">Free on Google Play and the App Store</p>
              <StoreBadges className="mt-3" />
            </div>
          </div>

          {/* the picture: the shop's own photo in a circle, the cloth beneath it, and the phone showing the real app */}
          <div className="gp-rise gp-stage relative mx-auto aspect-[1/1.12] w-full max-w-[34rem]" style={{ '--d': '0.3s' } as React.CSSProperties}>
            <div className="absolute right-[-2cqw] top-[3cqw] z-[1] aspect-square w-[82cqw] overflow-hidden rounded-full shadow-[0_5cqw_9cqw_-3cqw_rgb(51_9_15/0.4)] ring-[0.9cqw] ring-white/70">
              <Image src="/app/hero-walnuts.webp" alt="Walnuts in a wooden bowl" fill sizes="(min-width: 1024px) 460px, 90vw" quality={80} className="object-cover" priority />
            </div>
            <PhoneMockup className="absolute bottom-[-2cqw] left-[7cqw] z-[2] -rotate-[7deg]" />
          </div>
        </div>
      </div>
    </header>
  );
}
