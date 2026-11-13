import Image from 'next/image';

/**
 * A phone showing a real screen of the Govind Pansari app: the product-page screenshot published with the app on the App Store (public/app/
 * app-screenshot.webp, 1179 x 2556). Only the frame is drawn here; the screen is the app's own picture, uncropped and unedited.
 * All sizes are in container-width units (cqw) so the phone scales as one piece inside its stage (see .gp-stage in globals.css).
 */
export function PhoneMockup({ className = '' }: { className?: string }) {
  return (
    <div className={`gp-phone ${className}`}>
      <span className="gp-phone-button gp-phone-button--volume" aria-hidden />
      <span className="gp-phone-button gp-phone-button--power" aria-hidden />
      <div className="gp-phone-screen">
        <Image
          src="/app/app-screenshot.webp"
          alt="The Govind Pansari app: a product page with photo, price, pack sizes and Add and Buy Now buttons"
          fill
          sizes="(min-width: 1024px) 260px, 60vw"
          quality={85}
          priority
          className="object-cover"
        />
        <span className="gp-phone-island" aria-hidden />
        <span className="gp-phone-glare" aria-hidden />
      </div>
    </div>
  );
}
