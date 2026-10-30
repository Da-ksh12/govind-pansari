import type { ReactNode } from 'react';
import { PageHeader } from '../ui/PageHeader';

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/** A readable long-form page (policies, terms): one column, numbered headings, a "last updated" line. */
export function LegalPage({ title, intro, updated, sections, trail }: { title: string; intro?: string; updated: string; sections: LegalSection[]; trail: string }) {
  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: trail }]} title={title} intro={intro} />
      <article className="container-x py-12 sm:py-16">
        <p className="mb-10 text-sm text-taupe">Last updated {updated}</p>
        <div className="max-w-3xl space-y-9">
          {sections.map((s) => (
            <section key={s.title} aria-labelledby={`s-${s.title.replace(/\W+/g, '-')}`}>
              <h2 id={`s-${s.title.replace(/\W+/g, '-')}`} className="font-display text-2xl font-semibold text-maroon">{s.title}</h2>
              <div className="mt-3 space-y-3 leading-relaxed text-espresso/80">{s.body}</div>
            </section>
          ))}
        </div>
      </article>
    </>
  );
}
