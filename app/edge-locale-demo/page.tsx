import { getHomepage } from "@/lib/contentstack";

type Props = {
  searchParams: Promise<{ locale?: string }>;
};

/**
 * Demo: `locale` from the query string for the SDK. On Cloudflare, the edge
 * worker rewrites bare `/edge-locale-demo` to the origin with `?locale=…`.
 * `CF-Cache-Status` may stay BYPASS on devcontentstackapps.com; the worker
 * uses caches.default and sets `X-Edge-Locale-Demo-Cache: HIT | MISS`.
 * Local dev: add `?locale=` yourself.
 */
export default async function EdgeLocaleDemoPage({ searchParams }: Props) {
  const { locale: raw } = await searchParams;
  const locale = (raw && raw.trim()) || "en-us";

  const homepage = await getHomepage(locale);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8 font-mono text-sm">
      <h1 className="text-xl font-semibold mb-4">/edge-locale-demo</h1>
      <p className="text-zinc-400 mb-6">
        Locale from query: <code className="text-emerald-400">{locale}</code>
      </p>
      {homepage ? (
        <pre className="rounded-lg bg-zinc-900 p-4 overflow-auto text-xs">
          {JSON.stringify(
            { title: homepage.title, uid: homepage.uid, locale },
            null,
            2,
          )}
        </pre>
      ) : (
        <p className="text-amber-400">
          No homepage for this locale (or CMS error). Try{" "}
          <code>?locale=en-us</code>.
        </p>
      )}
    </div>
  );
}
