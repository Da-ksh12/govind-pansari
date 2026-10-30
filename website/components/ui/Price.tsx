import { formatINR } from '@/lib/format';

interface Props {
  price: number;
  mrp?: number;
  /** Prefix such as "From" when several pack sizes have different prices. */
  prefix?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = { sm: 'text-base', md: 'text-lg', lg: 'text-3xl' } as const;

/** The MRP is shown struck through only when it is genuinely higher than the selling price. */
export function Price({ price, mrp, prefix, size = 'md', className = '' }: Props) {
  const showMrp = mrp !== undefined && mrp > price;
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${className}`}>
      {prefix && <span className="text-xs font-semibold uppercase tracking-wider text-taupe">{prefix}</span>}
      <span className={`font-display font-semibold text-maroon ${SIZES[size]}`}>{formatINR(price)}</span>
      {showMrp && (
        <>
          <s className="text-sm text-stone" aria-label={`MRP ${formatINR(mrp)}`}>{formatINR(mrp)}</s>
        </>
      )}
    </p>
  );
}
