import type { ReactNode } from 'react';

// Re-created on every navigation (unlike layout.tsx), which is what makes this a page transition: each new page eases in.
// Pure CSS (see .page-in in globals.css), so the page is fully visible in the server HTML and for anyone without JavaScript.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-in">{children}</div>;
}
