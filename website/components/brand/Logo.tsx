import Image from 'next/image';
import { BRAND } from '@/lib/site';

/** The official circular seal (GP monogram, "Est. 1950 · Agra"). It is artwork from the owner, used as-is and never redrawn. */
export function Seal({ size = 44, className = '' }: { size?: number; className?: string }) {
  return <Image src="/brand/seal.webp" alt="" width={size} height={size} className={`rounded-full ${className}`} unoptimized />;
}

export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Seal size={compact ? 36 : 44} />
      <span className="flex flex-col leading-none">
        <span className={`font-display text-[1.15rem] font-semibold tracking-tight ${light ? 'text-ivory' : 'text-maroon'}`}>{BRAND.name}</span>
        {!compact && <span className={`eyebrow mt-1 text-[0.58rem] ${light ? '!text-gold' : ''}`}>Since {BRAND.since} · {BRAND.city}</span>}
      </span>
    </span>
  );
}
