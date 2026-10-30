import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface Props {
  eyebrow?: string;
  title: ReactNode;
  intro?: string;
  link?: { href: string; label: string };
  align?: 'left' | 'center';
  onDark?: boolean;
  as?: 'h1' | 'h2';
}

export function SectionHeading({ eyebrow, title, intro, link, align = 'left', onDark = false, as: Tag = 'h2' }: Props) {
  const center = align === 'center';
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${center ? 'items-center text-center sm:flex-col sm:items-center' : ''}`}>
      <div className={`max-w-2xl ${center ? 'mx-auto' : ''}`}>
        {eyebrow && <p className={`eyebrow ${onDark ? '!text-gold' : ''}`}>{eyebrow}</p>}
        <Tag className={`mt-3 font-display text-[clamp(2rem,4.6vw,3.4rem)] font-semibold leading-[1.08] ${onDark ? 'text-ivory' : 'text-maroon'}`}>{title}</Tag>
        {intro && <p className={`mt-4 text-base leading-relaxed ${onDark ? 'text-ivory/75' : 'text-taupe'}`}>{intro}</p>}
      </div>
      {link && (
        <Link href={link.href} className={`group inline-flex shrink-0 items-center gap-2 text-sm font-bold ${onDark ? 'text-gold' : 'text-maroon'}`}>
          {link.label}
          <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden />
        </Link>
      )}
    </div>
  );
}
