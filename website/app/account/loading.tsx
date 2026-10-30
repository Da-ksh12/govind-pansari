import { NutLoader } from '@/components/brand/NutLoader';

export default function AccountLoading() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <NutLoader label="Opening your account" />
    </div>
  );
}
