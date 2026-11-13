import { Leaf } from 'lucide-react';

/** A deep maroon footer with a soft wave on its top edge and the one line the brand ends on. */
export function AppFooter() {
  return (
    <footer className="relative bg-maroon-dark text-ivory">
      <svg viewBox="0 0 1440 70" preserveAspectRatio="none" className="absolute inset-x-0 top-[2px] h-10 w-full -translate-y-full sm:h-[4.2rem]" aria-hidden>
        <path d="M0 70 L0 38 C 240 8, 480 8, 720 34 S 1200 66, 1440 30 L1440 70 Z" fill="#4a0d18" />
      </svg>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-9 pt-12 sm:px-8 sm:pt-14">
        <div className="flex w-full items-center justify-center gap-4 sm:gap-8">
          <span className="h-px max-w-44 flex-1 bg-gold/50" aria-hidden />
          <Leaf size={22} className="shrink-0 fill-gold/80 text-gold" aria-hidden />
          <p className="relative shrink-0 text-center font-display text-[clamp(2rem,5.6vw,3.2rem)] italic leading-none text-ivory">
            Goodness. Always.
            <svg viewBox="0 0 300 12" preserveAspectRatio="none" className="absolute -bottom-3 left-[8%] h-2.5 w-[84%]" aria-hidden>
              <path d="M2 8 C 60 2, 150 10, 298 3" fill="none" stroke="#c69a4c" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </p>
          <Leaf size={22} className="shrink-0 -scale-x-100 fill-gold/80 text-gold" aria-hidden />
          <span className="h-px max-w-44 flex-1 bg-gold/50" aria-hidden />
        </div>
        <p className="mt-12 text-center text-xs text-ivory/60">© {new Date().getFullYear()} Govind Pansari, Agra</p>
      </div>
    </footer>
  );
}
