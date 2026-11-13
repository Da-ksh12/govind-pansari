import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { AFLIX_URL } from '@/lib/app-links';

/**
 * The technology partner, on its own white ground so the supplied logo shows in its original blue and red. The picture is the logo file exactly as
 * supplied (1080 x 1080, with white margins); the frame below only chooses which band of it is visible, so nothing is recoloured or redrawn.
 */
export function AflixSection() {
  return (
    <section aria-labelledby="aflix-title" className="bg-white py-16 sm:py-20">
      <div className="mx-auto grid w-full max-w-5xl items-center gap-10 px-5 sm:px-8 md:grid-cols-[1.15fr_auto_1fr] md:gap-12">
        <div className="text-center md:text-left">
          <h2 id="aflix-title" className="font-sans text-[1.05rem] font-bold text-espresso sm:text-lg">
            A Digital Experience Crafted by
            <span className="relative mx-auto mt-2 block aspect-[1080/330] w-full max-w-[26rem] md:mx-0">
              <Image src="/app/aflix-infotech-logo.jpg" alt="Aflix Infotech" fill sizes="(min-width: 768px) 416px, 90vw" quality={90} className="object-cover object-center" />
            </span>
          </h2>
        </div>

        <span className="hidden h-36 w-px bg-maroon/20 md:block" aria-hidden />

        <div className="text-center md:text-left">
          <p className="font-display text-[clamp(1.7rem,3.4vw,2.35rem)] font-medium leading-tight text-espresso">
            Technology that moves businesses forward.
          </p>
          <a
            href={AFLIX_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-7 inline-flex h-12 items-center gap-2.5 rounded-full border-[1.5px] border-maroon px-7 text-[0.98rem] font-bold text-maroon transition duration-300 hover:bg-maroon hover:text-ivory"
          >
            Visit aflix.co.in
            <ArrowRight size={18} className="transition duration-300 group-hover:translate-x-1" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
