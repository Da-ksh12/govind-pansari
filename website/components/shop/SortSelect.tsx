'use client';

import { useRouter } from 'next/navigation';

/** The sort menu. Each option already knows its URL (built on the server), so choosing one is just a navigation. */
export function SortSelect({ value, options }: { value: string; options: { key: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-taupe">
      <span className="hidden sm:inline">Sort by</span>
      <select
        value={value}
        onChange={(e) => {
          const chosen = options.find((o) => o.key === e.target.value);
          if (chosen) router.push(chosen.href, { scroll: false });
        }}
        aria-label="Sort products"
        className="field !min-h-11 !w-auto cursor-pointer !rounded-full !py-2 pr-9 text-sm font-semibold text-maroon"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
