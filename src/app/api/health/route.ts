import { NextResponse } from "next/server";
import { ENDPOINTS, API_HOST, AGNES_API_BASE } from "@/lib/api/config";
import { hasAgnesKeys, getKeyPoolStats } from "@/lib/api/agnesKeys";

export const dynamic = "force-dynamic";

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 12_000;

type Probe = { reachable: boolean; http?: number; latency: number; valid: boolean; error?: string };
let cache: { at: number; text: Probe; image: Probe; agnes: Probe | null } | null = null;
type ProbeResult = { text: Probe; image: Probe; agnes: Probe | null; cached: boolean };
let inflight: Promise<ProbeResult> | null = null;

async function probe(url: string, headers?: Record<string, string>): Promise<Probe> {
  const start = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers });
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

async function runProbes(): Promise<ProbeResult> {
  if (cache && Date.now() - cache.at < PROBE_TTL_MS) {
    return { text: cache.text, image: cache.image, agnes: cache.agnes, cached: true };
  }
  if (!inflight) {
    inflight = (async () => {
      const agnesConfigured = hasAgnesKeys();
      const [text, image, agnes] = await Promise.all([
        probe(`${ENDPOINTS.chat.llama}?prompt=ping`),
        probe(`${ENDPOINTS.image.fluxDev}?prompt=a%20blue%20dot`),
        agnesConfigured ? probe(`${AGNES_API_BASE}/models`, { Authorization: `Bearer dummy` }).then((p) => ({ ...p, reachable: p.http === 401 || p.reachable })) : Promise.resolve(null as unknown as Probe),
      ]);
      // For Agnes, 401 means endpoint reachable but key invalid — still operational
      const agnesProbe = agnesConfigured ? agnes : null;
      cache = { at: Date.now(), text, image, agnes: agnesProbe };
      inflight = null;
      return { text, image, agnes: agnesProbe, cached: false };
    })();
  }
  return inflight;
}

export async function GET() {
  const { text, image, agnes, cached } = await runProbes();
  const up = text.reachable || image.reachable || (agnes?.reachable ?? false);
  const agnesStats = hasAgnesKeys() ? getKeyPoolStats() : null;

  return NextResponse.json({
    success: true,
    provider: new URL(API_HOST).host,
    agnesProvider: agnes ? new URL(AGNES_API_BASE).host : null,
    agnesConfigured: hasAgnesKeys(),
    agnesKeys: agnesStats,
    status: up ? "operational" : "degraded",
    checkedAt: new Date(cache?.at ?? Date.now()).toISOString(),
    cached,
    services: { text, image, agnes: agnes ?? { reachable: false, latency: 0, valid: false, error: "Not configured" } },
    capabilities: {
      chat: true,
      imageGeneration: true,
      imageEditing: true,
      imageToVideo: true,
      textToVideo: true,
      vision: true,
      streaming: true,
      nativeConversationContext: true,
    },
  });
}
