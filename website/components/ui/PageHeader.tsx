import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { JsonLd } from '../seo/JsonLd';
import { absoluteUrl } from '@/lib/site';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ trail, onDark = false }: { trail: Crumb[]; onDark?: boolean }) {
  const linked = trail.filter((c) => c.href);
  return (
    <>
      <nav aria-label="Breadcrumb">
        <ol className={`flex flex-wrap items-center gap-1.5 text-sm ${onDark ? 'text-ivory/70' : 'text-taupe'}`}>
          {trail.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} aria-hidden className="opacity-60" />}
              {c.href ? <Link href={c.href} className="font-semibold hover:text-maroon hover:underline">{c.label}</Link> : <span aria-current="page" className="font-semibold text-espresso">{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, ...(c.href ? { item: absoluteUrl(c.href) } : {}) })),
        }}
      />
      {linked.length === 0 && null}
    </>
  );
}

/** The top of every inner page: a calm band under the floating header with breadcrumbs, the page's one H1 and an optional introduction. */
export function PageHeader({ title, intro, eyebrow, trail, children }: { title: ReactNode; intro?: string; eyebrow?: string; trail?: Crumb[]; children?: ReactNode }) {
  return (
    <header className="page-top relative overflow-hidden bg-sand pb-10 sm:pb-14">
      <div className="jaali pointer-events-none absolute inset-0 opacity-[0.05]" aria-hidden />
      <div className="container-x relative">
        {trail && <Breadcrumbs trail={trail} />}
        {eyebrow && <p className="eyebrow mt-6">{eyebrow}</p>}
        <h1 className={`${eyebrow ? 'mt-2' : 'mt-6'} max-w-3xl font-display text-[clamp(2.3rem,5.4vw,4rem)] font-semibold leading-[1.05] text-maroon`}>{title}</h1>
        {intro && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-taupe">{intro}</p>}
        {children}
      </div>
    </header>
  );
}
