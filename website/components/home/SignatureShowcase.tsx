'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ProductImage } from '../ui/ProductImage';

export interface ShowcaseItem {
  slug: string;
  name: string;
  image: string | null;
  category: string | null;
}

const STEPS = [
  { title: 'Chosen by hand', text: 'Every batch is looked over by the family before it ever reaches a shelf.' },
  { title: 'Ground the traditional way', text: 'Spices are ground the way they were when the shop first opened in 1950.' },
  { title: 'Packed for you', text: 'Your order is packed at the nearest of our Agra shops that has everything in it.' },
];

// Where each photograph rests when the section is fully "opened" (cx/cy are the card's centre as a fraction of the stage). This is also what the
// page looks like with no JavaScript, on phones, and for visitors who prefer reduced motion. On large screens the section pins while scrolling and
// the photographs open out from one stack.
const LAYERS = [
  { cx: 0.2, cy: 0.6, w: '38%', r: -6, z: 1 },
  { cx: 0.5, cy: 0.46, w: '42%', r: 0, z: 3 },
  { cx: 0.8, cy: 0.62, w: '36%', r: 6, z: 2 },
] as const;

/**
 * "Discover the Goodness Inside" — the signature scroll moment. It is an honest layered presentation of the shop's REAL product photographs
 * (depth, parallax, a pinned reveal); it is not a 3D model, because no 3D asset of a Govind Pansari pack exists yet. When one is supplied it
 * can replace the layers here without touching the rest of the page.
 */
export function SignatureShowcase({ items }: { items: ShowcaseItem[] }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const layers = gsap.utils.toArray<HTMLElement>('[data-layer]');
      const steps = gsap.utils.toArray<HTMLElement>('[data-step]');
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: el, start: 'top top', end: '+=150%', scrub: 0.7, pin: true, anticipatePin: 1 },
      });
      const stage = el.querySelector<HTMLElement>('[data-stage]')!;
      layers.forEach((layer, i) => {
        const to = LAYERS[i]!;
        gsap.set(layer, { xPercent: -50, yPercent: -50 });
        // start: every card stacked on the centre card's spot; end: its own resting place (the CSS position)
        tl.fromTo(
          layer,
          { x: () => (0.5 - to.cx) * stage.offsetWidth, y: () => (0.46 - to.cy) * stage.offsetHeight, rotate: 0, scale: 0.88 },
          { x: 0, y: 0, rotate: to.r, scale: 1, duration: 1, immediateRender: true },
          0,
        );
      });
      steps.forEach((step, i) => {
        tl.fromTo(step, { opacity: 0.25, x: 0 }, { opacity: 1, x: 12, duration: 0.5 }, i * 0.55);
        if (i < steps.length - 1) tl.to(step, { opacity: 0.35, x: 0, duration: 0.4 }, i * 0.55 + 0.9);
      });
      return () => tl.scrollTrigger?.kill();
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={root} className="relative overflow-hidden bg-maroon-darker text-ivory" aria-labelledby="sig-title">
      <div className="jaali pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
      <div className="container-x relative grid min-h-[100svh] items-center gap-14 py-24 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="eyebrow !text-gold">The signature</p>
          <h2 id="sig-title" className="mt-3 font-display text-[clamp(2.4rem,5.4vw,4.4rem)] font-medium leading-[1.04]">
            Discover the <em className="italic text-gold">Goodness</em> Inside
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-ivory/75">Open the box and see what more than seventy years of the same family’s care puts on the shelf.</p>
          <ol className="mt-10 space-y-6">
            {STEPS.map((s, i) => (
              <li key={s.title} data-step className="flex gap-5">
                <span className="font-display text-3xl italic text-gold/80" aria-hidden>0{i + 1}</span>
                <span>
                  <span className="block font-display text-xl font-semibold">{s.title}</span>
                  <span className="mt-1 block max-w-sm text-sm leading-relaxed text-ivory/70">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <Link href="/shop" className="btn btn-gold mt-10">Explore the shelves</Link>
        </div>

        <div data-stage className="relative mx-auto aspect-[4/3.4] w-full max-w-2xl" aria-label="Photographs of products from the shop">
          {items.slice(0, 3).map((item, i) => {
            const l = LAYERS[i]!;
            return (
              <div
                key={item.slug}
                data-layer
                className="absolute"
                style={{ left: `${l.cx * 100}%`, top: `${l.cy * 100}%`, width: l.w, zIndex: l.z, transform: `translate(-50%, -50%) rotate(${l.r}deg)` }}
              >
                <Link href={`/product/${item.slug}`} className="group relative block aspect-[3/4] overflow-hidden border-2 border-gold/40 bg-maroon shadow-[0_40px_80px_-25px_rgb(0_0_0/0.7)]" style={{ borderRadius: '999px 999px 20px 20px' }}>
                  <ProductImage src={item.image} alt="" sizes="(min-width: 1024px) 24vw, 45vw" className="transition duration-[1.2s] ease-[var(--ease-premium)] group-hover:scale-105" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-maroon-darker/90 to-transparent px-3 pb-3 pt-10 text-center text-xs font-semibold text-ivory">{item.name}</span>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
