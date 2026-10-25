import { NextResponse } from "next/server";
import { ENDPOINTS, API_HOST } from "@/lib/api/config";

export const dynamic = "force-dynamic";

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 12_000;

type Probe = { reachable: boolean; http?: number; latency: number; valid: boolean; error?: string };
let cache: { at: number; text: Probe; image: Probe } | null = null;
type ProbeResult = { text: Probe; image: Probe; cached: boolean };
let inflight: Promise<ProbeResult> | null = null;

async function probe(url: string): Promise<Probe> {
  const start = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latency = Date.now() - start;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { reachable: res.ok, http: res.status, latency, valid: !!json && typeof json === "object" };
  } catch (e: unknown) {
    return { reachable: false, latency: Date.now() - start, valid: false, error: e instanceof Error ? e.message : "unreachable" };
  }
}

/**
 * Lightweight live check of the two most important upstream capabilities.
 * Results are cached for a minute and concurrent callers share one probe, so a
 * busy app never turns into a load test against a free third-party service.
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
  const up = text.reachable || image.reachable;

  return NextResponse.json({
    success: true,
    provider: new URL(API_HOST).host,
    status: up ? "operational" : "degraded",
    checkedAt: new Date(cache?.at ?? Date.now()).toISOString(),
    cached,
    services: { text, image },
    capabilities: {
      chat: true,
      imageGeneration: true,
      imageEditing: true,
      imageToVideo: true,
      textToVideo: false,
      vision: false,
      streaming: false,
      nativeConversationContext: false,
    },
  });
}
