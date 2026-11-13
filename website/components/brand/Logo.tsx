import Image from 'next/image';

// The Govind Pansari logo exactly as supplied by the owner: white lettering on its own red ground (public/brand/logo.webp, 750 x 355).
// It is never recoloured, redrawn or cropped here; only its size changes. Every place the site shows the brand mark uses this one component,
// so replacing the logo later means replacing the files in public/brand/ (and app/icon.png, app/apple-icon.png, app/favicon.ico).
const LOGO = { src: '/brand/logo.webp', width: 750, height: 355 } as const;

interface LogoProps {
  /** Height in pixels; the width follows the logo's own proportions. */
  height?: number;
  className?: string;
  /** Pass "" when the logo is decoration next to text that already names the brand. */
  alt?: string;
  /** Above-the-fold logos load straight away. */
  eager?: boolean;
}

export function Logo({ height = 44, className = '', alt = 'Govind Pansari — Dry Fruits & Spices', eager = false }: LogoProps) {
  const width = Math.round((height * LOGO.width) / LOGO.height);
  return (
    <Image
      src={LOGO.src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      // the file is already small and sharp at any size we show it, so it is served as is
      unoptimized
      className={`block max-w-none rounded-lg ${className}`}
    />
  );
}

/** The logo for the header, the menu and other places the brand appears on its own. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return <Logo height={compact ? 38 : 48} eager />;
}
