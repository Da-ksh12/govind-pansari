import { NutLoader } from '@/components/brand/NutLoader';

export default function CheckoutLoading() {
  return (
    <div className="page-top grid min-h-[70vh] place-items-center">
      <NutLoader label="Getting your checkout ready" />
    </div>
  );
}
