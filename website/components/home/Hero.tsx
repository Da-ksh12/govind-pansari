'use client';

import { ArrowDown, Clock, Leaf, Users } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Seal } from '../brand/Logo';
import { ProductImage } from '../ui/ProductImage';

export interface HeroProduct {
  slug: string;
  name: string;
  image: string | null;
  category: string | null;
}

// Three arches (the jharokha shape of Agra's windows) holding real product photographs. They drift at different speeds as the page scrolls,
// and lean a little toward the pointer on desktop. All of the motion is on wrapper elements; the pictures themselves are ordinary images.
const ARCHES = [
  { cls: 'left-0 top-[22%] h-[62%] w-[34%]', speed: 0.35, delay: '0.5s' },
  { cls: 'left-[31%] top-0 h-[92%] w-[40%]', speed: 0.0, delay: '0.3s' },
  { cls: 'right-0 top-[34%] h-[56%] w-[30%]', speed: 0.55, delay: '0.7s' },
] as const;

export function Hero({ products, deliveryMinutes }: { products: HeroProduct[]; deliveryMinutes: number | null }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-speed]').forEach((node) => {
        const speed = Number(node.dataset.speed ?? 0);
        if (!speed) return;
        gsap.to(node, { y: speed * 160, ease: 'none', scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: 0.6 } });
      });
      gsap.to('[data-glow]', { y: 120, scale: 1.2, ease: 'none', scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: 1 } });

      // pointer lean: desktop with a real mouse only
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        const moveX = gsap.quickTo('[data-lean]', 'x', { duration: 0.9, ease: 'power3.out' });
        const moveY = gsap.quickTo('[data-lean]', 'y', { duration: 0.9, ease: 'power3.out' });
        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          moveX(((e.clientX - r.left) / r.width - 0.5) * -18);
          moveY(((e.clientY - r.top) / r.height - 0.5) * -12);
        };
        el.addEventListener('pointermove', onMove);
        return () => el.removeEventListener('pointermove', onMove);
      }
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative isolate overflow-hidden bg-maroon-darker text-ivory" aria-labelledby="hero-title">
      <div className="jaali pointer-events-none absolute inset-0 -z-10 opacity-[0.07]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_72%_38%,rgb(122_28_46)_0%,transparent_58%)]" aria-hidden />
      <div data-glow className="pointer-events-none absolute -left-24 top-1/3 -z-10 h-96 w-96 rounded-full bg-gold/15 blur-3xl" aria-hidden />

      <div className="container-x grid min-h-[100svh] items-center gap-6 pb-20 pt-32 lg:grid-cols-[1.02fr_1fr] lg:gap-10">
        <div className="relative z-10">
          <p className="eyebrow rise !text-gold" style={{ '--d': '0.1s' } as React.CSSProperties}>Since 1950 · Agra</p>
          <h1 id="hero-title" className="rise mt-5 font-display text-[clamp(3.1rem,8.2vw,6.6rem)] font-medium leading-[0.98] tracking-tight" style={{ '--d': '0.2s' } as React.CSSProperties}>
            A <em className="font-normal italic text-gold">Finer</em> Taste of Nature.
          </h1>
          <p className="rise mt-7 max-w-xl text-lg leading-relaxed text-ivory/80" style={{ '--d': '0.35s' } as React.CSSProperties}>
            Handpicked dry fruits, freshly ground spices and gift hampers from the family shop Agra has trusted for three generations — packed with care and brought to your door.
          </p>
          <div className="rise mt-9 flex flex-wrap gap-3" style={{ '--d': '0.5s' } as React.CSSProperties}>
            <Link href="/shop" className="btn btn-gold">Shop the collection</Link>
            <Link href="/about" className="btn border-[1.5px] border-ivory/40 text-ivory hover:bg-ivory hover:text-maroon">Our story</Link>
          </div>
          <ul className="rise mt-12 flex flex-wrap gap-x-8 gap-y-3 text-sm text-ivory/75" style={{ '--d': '0.65s' } as React.CSSProperties}>
            <li className="flex items-center gap-2.5"><Users size={17} className="text-gold" aria-hidden /> Three generations of one family</li>
            <li className="flex items-center gap-2.5"><Leaf size={17} className="text-gold" aria-hidden /> Packed fresh at our Agra shops</li>
            {deliveryMinutes && <li className="flex items-center gap-2.5"><Clock size={17} className="text-gold" aria-hidden /> Delivery in about {deliveryMinutes} minutes*</li>}
          </ul>
          {deliveryMinutes && <p className="rise mt-2 text-xs text-ivory/50" style={{ '--d': '0.7s' } as React.CSSProperties}>*Within our delivery area; the exact estimate is shown at checkout.</p>}
        </div>

        <div className="relative mx-auto h-[26rem] w-full max-w-xl sm:h-[34rem] lg:h-[40rem]" data-lean aria-hidden={products.length === 0}>
          {products.slice(0, 3).map((p, i) => {
            const arch = ARCHES[i]!;
            return (
              <div key={p.slug} data-speed={arch.speed} className={`absolute ${arch.cls}`}>
                <Link
                  href={`/product/${p.slug}`}
                  className="arch-in group relative block h-full w-full overflow-hidden border-2 border-gold/35 bg-maroon shadow-[0_30px_70px_-20px_rgb(0_0_0/0.6)]"
                  style={{ '--d': arch.delay, borderRadius: '999px 999px 22px 22px' } as React.CSSProperties}
                  aria-label={`${p.name}${p.category ? `, ${p.category}` : ''}`}
                >
                  <ProductImage src={p.image} alt="" sizes="(min-width: 1024px) 22vw, 40vw" eager className="transition duration-[1.4s] ease-[var(--ease-premium)] group-hover:scale-105" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-maroon-darker/90 to-transparent px-3 pb-3 pt-10 text-center text-xs font-semibold tracking-wide text-ivory">{p.name}</span>
                </Link>
              </div>
            );
          })}
          <div data-speed="0.8" className="absolute -bottom-2 left-[8%] z-10 hidden sm:block">
            <div className="rise rounded-full bg-maroon-darker p-1.5 shadow-lift ring-1 ring-gold/50" style={{ '--d': '0.9s' } as React.CSSProperties}>
              <div style={{ animation: 'spin-slow 40s linear infinite' }}><Seal size={92} /></div>
            </div>
          </div>
        </div>
      </div>

      <a href="#categories" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.25em] text-ivory/60 transition hover:text-gold md:flex">
        Explore <ArrowDown size={16} className="animate-bounce" aria-hidden />
      </a>
    </section>
  );
}
