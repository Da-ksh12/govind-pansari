'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Seal } from '../brand/Logo';

interface Props {
  src: string | null | undefined;
  alt: string;
  sizes: string;
  /** Above-the-fold pictures load first; everything else is lazy. */
  eager?: boolean;
  className?: string;
  fit?: 'cover' | 'contain';
}

/**
 * A product picture that is always honest: the real photo when there is one; otherwise (no photo uploaded, or the file fails to load) a quiet
 * brand tile with the seal. A different product's photo is never borrowed as a stand-in.
 */
export function ProductImage({ src, alt, sizes, eager = false, className = '', fit = 'cover' }: Props) {
  const [failed, setFailed] = useState(false);
  const url = src?.trim();
  if (!url || failed) {
    return (
      <div className={`grid place-items-center bg-gradient-to-br from-sand to-ivory-deep ${className}`} {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}>
        <Seal size={64} className="opacity-60" />
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes={sizes}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => setFailed(true)}
      className={`${fit === 'cover' ? 'object-cover' : 'object-contain'} ${className}`}
    />
  );
}
