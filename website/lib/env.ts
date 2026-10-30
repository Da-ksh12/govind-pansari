// Public settings, read once and checked, so a missing value fails with a readable sentence instead of an obscure "Invalid URL" deep in a request.
// Only NEXT_PUBLIC_* names are read here: they are baked into the browser bundle, so they must never hold a secret.

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(`${name} is not set. Copy website/.env.example to website/.env.local and fill it in (the same Supabase project as the mobile app).`);
  }
  return value.trim();
}

export const supabaseUrl = (): string => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = (): string => required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const siteUrl = (): string => (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
