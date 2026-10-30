// Structured data for search engines. Only ever fed facts that are on the page and true (name, price, availability from the live catalogue).
// "<" is escaped so a product name containing "</script>" can never break out of the script tag.
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
