import { BadgeCheck, ShieldCheck, ShoppingCart, Truck } from 'lucide-react';

const BENEFITS = [
  { icon: BadgeCheck, title: 'Premium Quality', text: 'Only the best for you' },
  { icon: ShoppingCart, title: 'Easy Shopping', text: 'Anytime, Anywhere' },
  { icon: ShieldCheck, title: 'Safe & Secure', text: 'Shop with Confidence' },
  { icon: Truck, title: 'Fast Delivery', text: 'At Your Doorstep' },
] as const;

/** Four short promises in one soft card that overlaps the hero's bottom edge. */
export function Benefits() {
  return (
    <section aria-label="Why use the app" className="relative z-10 mx-auto -mt-9 w-full max-w-6xl px-5 sm:px-8">
      <ul className="grid grid-cols-2 gap-y-8 rounded-[2rem] border border-white/80 bg-[#fdf7ee] px-4 py-8 shadow-[0_24px_50px_-22px_rgb(61_36_24/0.35)] md:grid-cols-4 md:gap-y-0 md:py-9">
        {BENEFITS.map((b, i) => (
          <li key={b.title} className={`flex flex-col items-center px-3 text-center ${i > 0 ? 'md:border-l md:border-maroon/15' : ''} ${i % 2 === 1 ? 'max-md:border-l max-md:border-maroon/15' : ''}`}>
            <b.icon size={44} strokeWidth={1.4} className="text-maroon" aria-hidden />
            <h2 className="mt-3 font-sans text-[1.02rem] font-extrabold text-maroon-dark">{b.title}</h2>
            <p className="mt-1 text-sm text-taupe">{b.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
