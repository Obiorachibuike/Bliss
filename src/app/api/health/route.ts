import { NextResponse } from "next/server";
import {
  ENDPOINTS,
  API_HOST,
  AGNES_CHAT_MODELS,
  AGNES_IMAGE_MODEL,
  AGNES_BASE_URL,
  IMAGE_MODELS,
  IMAGE_MODELS_WITH_FALLBACK,
} from "@/lib/api/config";
import { isAgnesConfigured } from "@/lib/api/agnes";

export const dynamic = "force-dynamic";

/**
 * The status payload must never be served from a CDN cache: a 30-60s stale copy is
 * exactly the window in which an outage banner would lie to the user. The in-memory
 * probe cache above is what protects the free provider from being load-tested.
 */
const NO_STORE = { "Cache-Control": "no-store, max-age=0, s-maxage=0" };

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 12_000;

type Probe = {
  reachable: boolean;
  http?: number;
  latency: number;
  valid: boolean;
  error?: string;
};
let cache: { at: number; text: Probe; image: Probe } | null = null;
type ProbeResult = { text: Probe; image: Probe; cached: boolean };
let inflight: Promise<ProbeResult> | null = null;

async function probe(url: string): Promise<Probe> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - start;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return {
      reachable: res.ok,
      http: res.status,
      latency,
      valid: !!json && typeof json === "object",
    };
  } catch (e: unknown) {
    return {
      reachable: false,
      latency: Date.now() - start,
      valid: false,
      error: e instanceof Error ? e.message : "unreachable",
    };
  }
}

/**
 * Lightweight live check of the two most important upstream capabilities.
 * Results are cached for a minute and concurrent callers share one probe, so a
 * busy app never turns into a load test against a free third-party service.
 *
 * The fallback provider is never probed here: a health endpoint must not burn the
 * account's request quota, so its status is reported as configured / not configured.
 */
async function runProbes(): Promise<ProbeResult> {
  if (cache && Date.now() - cache.at < PROBE_TTL_MS) {
    return { text: cache.text, image: cache.image, cached: true };
  }
  if (!inflight) {
    inflight = Promise.all([
      probe(`${ENDPOINTS.chat.llama}?prompt=ping`),
      probe(`${ENDPOINTS.image.fluxDev}?prompt=a%20blue%20dot`),
    ]).then<ProbeResult>(([text, image]) => {
      cache = { at: Date.now(), text, image };
      inflight = null;
      return { text, image, cached: false };
    });
  }
  return inflight;
}

export async function GET() {
  const { text, image, cached } = await runProbes();
  const enabled = isAgnesConfigured();
  // With a configured fallback provider, a down primary is no longer an outage for users.
  const status =
    text.reachable || image.reachable
      ? "operational"
      : enabled
        ? "degraded-with-fallback"
        : "degraded";

  return NextResponse.json(
    {
      success: true,
      provider: new URL(API_HOST).host,
      status,
      checkedAt: new Date(cache?.at ?? Date.now()).toISOString(),
      cached,
      services: { text, image },
      fallback: {
        provider: "Agnes AI",
        enabled,
        vision: enabled,
        host: (() => {
          try {
            return new URL(AGNES_BASE_URL).host;
          } catch {
            return null;
          }
        })(),
        chatModels: enabled ? AGNES_CHAT_MODELS.map((m) => m.id) : [],
        imageModel: enabled ? AGNES_IMAGE_MODEL : null,
        note: enabled
          ? "Configured. Used automatically when the primary provider fails after its retries; never probed here to protect your quota."
          : "Not configured — set AGNES_API_KEY on the server to enable chat, vision and image fallbacks.",
      },
      capabilities: {
        chat: true,
        imageGeneration: true,
        imageEditing: true,
        imageToVideo: true,
        textToVideo: false,
        vision: enabled,
        streaming: false,
        nativeConversationContext: enabled,
      },
      catalog: {
        image: (enabled ? IMAGE_MODELS_WITH_FALLBACK : IMAGE_MODELS).map(
          (m) => ({ id: m.id, provider: m.provider }),
        ),
      },
    },
    { headers: NO_STORE },
  );
}
