import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountNav } from '@/components/account/AccountNav';

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Every page under /account is behind proxy.ts (signed-in customers only) and is rendered per request with the customer's own session.
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-top container-x pb-16">
      <div className="grid gap-8 lg:grid-cols-[15rem_1fr] lg:gap-12">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
