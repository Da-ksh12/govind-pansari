import Image from 'next/image';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/app-links';

// The official "Get it on Google Play" and "Download on the App Store" badges, exactly as Google and Apple supply them (unaltered, same height).
// Both open the real store listing in a new tab.
export function StoreBadges({ className = '' }: { className?: string }) {
  const link = 'inline-block rounded-lg transition duration-300 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-offset-4';
  return (
    <div id="download" className={`flex flex-wrap items-center gap-3 scroll-mt-24 ${className}`}>
      <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Get it on Google Play" className={link} data-store="play">
        <Image src="/app/badge-google-play.png" alt="" width={564} height={168} className="h-12 w-auto" unoptimized />
      </a>
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download on the App Store" className={link} data-store="apple">
        <Image src="/app/badge-app-store.svg" alt="" width={120} height={40} className="h-12 w-auto" unoptimized />
      </a>
    </div>
  );
}
