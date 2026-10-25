/* Server-only secrets for the optional fallback provider.
 *
 * This module is imported exclusively from server code (route handlers and
 * src/lib/api/{agnes,provider}.ts). It is the only place that reads
 * AGNES_API_KEY, and it refuses to resolve a value in a browser bundle, so the
 * key can never be inlined into client JS even by accident. The public surface of
 * the app only ever sees the derived boolean from /api/models and /api/health.
 */
const mayReadSecret = typeof window === "undefined" || process.env.NODE_ENV === "test";

const KEY = mayReadSecret ? (process.env.AGNES_API_KEY || process.env.AGNES_API_KEY_FALLBACK || "").trim() : "";

/** Never re-export this from a module a client component can reach. */
export const AGNES_API_KEY = KEY;

export const AGNES_FALLBACK_ENABLED = KEY.length > 0;

export const FALLBACK_PROVIDER_LABEL = "Agnes AI";
