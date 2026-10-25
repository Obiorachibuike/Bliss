import { NextResponse } from "next/server";
import { ENDPOINTS, API_HOST } from "@/lib/api/config";

export const dynamic = "force-dynamic";

async function probe(url: string, timeout = 12_000) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    const latency = Date.now() - start;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON */
    }
    const ok = res.ok && !!json && typeof json === "object";
    return { reachable: res.ok, http: res.status, latency, valid: ok };
  } catch (e: unknown) {
    return {
      reachable: false,
      latency: Date.now() - start,
      valid: false,
      error: e instanceof Error ? e.message : "unreachable",
    };
  }
}

export async function GET() {
  const [llama, flux] = await Promise.all([
    probe(`${ENDPOINTS.chat.llama}?prompt=ping`),
    probe(`${ENDPOINTS.image.fluxDev}?prompt=a%20blue%20dot`),
  ]);

  const up = llama.reachable || flux.reachable;
  return NextResponse.json({
    success: true,
    provider: new URL(API_HOST).host,
    status: up ? "operational" : "degraded",
    checkedAt: new Date().toISOString(),
    services: {
      text: llama,
      image: flux,
    },
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
