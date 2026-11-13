import { notFound } from 'next/navigation';

// Any address that matches no page lands here, so an unknown URL gets the shop's own "not found" page with its header and footer.
export default function NoSuchPage() {
  notFound();
}
