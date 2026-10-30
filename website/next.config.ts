import type { NextConfig } from 'next';
import path from 'node:path';

// Product, category and banner pictures live in the same Supabase Storage the mobile app uses (plus a few older Unsplash links). Only those hosts
// are allowed through the image optimiser; anything else would be an open proxy.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    return 'localhost';
  }
})();

const config: NextConfig = {
  poweredByHeader: false,
  // the repository root also holds the mobile app's lockfile; this site's own folder is the project root
  turbopack: { root: path.resolve(process.cwd()) },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'plus.unsplash.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // location is used only for "check delivery here"; camera, microphone and payment sheets are Razorpay's own and open in its window
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default config;
