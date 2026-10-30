import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProductGrid } from '@/components/commerce/ProductCard';
import { getCatalogue } from '@/lib/data/catalogue';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'My wishlist' };

export default async function WishlistPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account/wishlist');

  const { data: wishlist } = await supabase.from('wishlists').select('id').eq('user_id', auth.user.id).maybeSingle();
  const { data: items } = wishlist ? await supabase.from('wishlist_items').select('product_id').eq('wishlist_id', wishlist.id) : { data: [] };
  const saved = new Set((items ?? []).map((r) => r.product_id as string));
  const { products } = await getCatalogue();
  // a saved product that has since been taken off sale simply is not listed
  const list = products.filter((p) => saved.has(p.id));

  return (
    <div>
      <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">My wishlist</h1>
      <p className="mt-2 mb-8 text-taupe">Things you’ve saved for later.</p>
      {list.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line-strong p-12 text-center">
          <p className="font-display text-2xl text-maroon">Nothing saved yet</p>
          <p className="mt-2 text-taupe">Tap the heart on any product to keep it here.</p>
          <Link href="/shop" className="btn btn-primary mt-6">Browse the shop</Link>
        </div>
      ) : (
        <ProductGrid products={list} eagerCount={0} headingLevel={2} />
      )}
    </div>
  );
}
