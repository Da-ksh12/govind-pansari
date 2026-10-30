'use client';

import { useState } from 'react';
import { ProductImage } from '../ui/ProductImage';

/** The product's own pictures: a large image that zooms under a mouse, and thumbnails when there is more than one. With no pictures it shows the brand tile. */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const current = images[active] ?? images[0];

  return (
    <div className="space-y-4">
      <div
        className="relative aspect-square overflow-hidden rounded-3xl bg-sand shadow-soft [@media(hover:hover)]:cursor-zoom-in"
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const r = e.currentTarget.getBoundingClientRect();
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onPointerLeave={() => setZoom(null)}
      >
        <div className="absolute inset-0 transition-transform duration-200 ease-out" style={zoom ? { transform: 'scale(2)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}>
          <ProductImage key={current ?? 'none'} src={current} alt={name} sizes="(min-width: 1024px) 45vw, 100vw" eager fit="cover" />
        </div>
      </div>
      {images.length > 1 && (
        <ul className="flex gap-3" aria-label="Product pictures">
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show picture ${i + 1} of ${images.length}`}
                aria-current={i === active}
                className={`relative block h-20 w-20 overflow-hidden rounded-2xl bg-sand ring-2 transition ${i === active ? 'ring-maroon' : 'ring-transparent hover:ring-line-strong'}`}
              >
                <ProductImage src={src} alt="" sizes="80px" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
