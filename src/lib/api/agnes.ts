// Agnes AI client — chat, image, video helpers
// All calls are server-side only; keys never reach the browser.

import {
  getNextAgnesKey,
  hasAgnesKeys,
  markAgnesKeyFailure,
  markAgnesKeySuccess,
  recordVideoKey,
  getVideoKey,
  getVideoKeyState,
} from "./agnesKeys";

const AGNES_BASE =
  (process.env.AGNES_API_BASE ||
    process.env.NEXT_PUBLIC_AGNES_API_HOST ||
    process.env.AGNES_API_HOST ||
    "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");

export const AGNES_BASE_URL = AGNES_BASE;
export const AGNES_HOST = AGNES_BASE.replace(/\/v1\/?$/, "");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function snapFrames(input: number): number {
  const valid = [81, 121, 161, 201, 241, 281, 321, 361, 401, 441];
  if (valid.includes(input)) return input;
  // Find closest valid value
  let best = valid[0];
  let bestDist = Math.abs(input - best);
  for (const v of valid) {
    const d = Math.abs(input - v);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

function normalizeResolution(width?: number, height?: number): { width: number; height: number } {
  const tiers: Record<string, [number, number]> = {
    "480p": [864, 480],
    "720p": [1280, 720],
    "1080p": [1920, 1080],
  };
  if (width && height) {
    // Clamp to sane range and snap to multiples of 64/16 as needed
    const w = Math.max(256, Math.min(2048, Math.round(width / 16) * 16));
    const h = Math.max(256, Math.min(2048, Math.round(height / 16) * 16));
    return { width: w, height: h };
  }
  // Default 16:9 720p-ish
  return { width: 1152, height: 768 };
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const o = json as Record<string, unknown>;
  // Agnes errors may be { error: { message } } or { message } or { error: string }
  if (typeof o.error === "string") return o.error;
  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  if (typeof o.message === "string") return o.message;
  return fallback;
}

// ------------------------------------------------------------------
// Chat streaming
// ------------------------------------------------------------------

export interface AgnesChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export async function agnesChatStream(params: {
  model: string;
  messages: AgnesChatMessage[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  if (!hasAgnesKeys()) throw new Error("Agnes API key not configured. Set AGNES_API_KEY_1 in .env.");

  const keyState = getNextAgnesKey();
  if (!keyState) throw new Error("All Agnes API keys are temporarily unavailable (rate-limited or disabled). Try again in a minute.");

  const body = {
    model: params.model,
    messages: params.messages,
    stream: true as const,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
  };

  let res: Response;
  try {
    res = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyState.key}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(`Agnes chat unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    markAgnesKeyFailure(keyState.key, res.status);
    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try { json = JSON.parse(text); } catch {}
    const msg = extractErrorMessage(json, `Agnes chat failed (HTTP ${res.status})`);
    // Never leak key in error
    console.error(`[Agnes] chat error ${res.status}:`, msg);
    throw new Error(msg);
  }

  markAgnesKeySuccess(keyState.key);
  return res;
}

// Non-streaming fallback
export async function agnesChat(params: {
  model: string;
  messages: AgnesChatMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  if (!hasAgnesKeys()) throw new Error("Agnes API key not configured.");

  let lastError = "unknown";
  // Try up to 2 keys in case of failover
  for (let attempt = 0; attempt < 2; attempt++) {
    const keyState = getNextAgnesKey();
    if (!keyState) break;
    try {
      const res = await fetch(`${AGNES_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keyState.key}`,
        },
        body: JSON.stringify({ model: params.model, messages: params.messages, stream: false }),
        signal: params.signal,
      });
      if (!res.ok) {
        markAgnesKeyFailure(keyState.key, res.status);
        const t = await res.text().catch(() => "");
        let j: unknown = null; try { j = JSON.parse(t); } catch {}
        lastError = extractErrorMessage(j, `HTTP ${res.status}`);
        console.error(`[Agnes] chat retry ${res.status}:`, lastError);
        continue;
      }
      markAgnesKeySuccess(keyState.key);
      const json = await res.json();
      const candidates = [
        (json as Record<string, unknown>)?.choices && Array.isArray((json as Record<string, unknown>).choices)
          ? ((json as { choices: Array<{ message?: { content?: string }; delta?: { content?: string } }> }).choices[0]?.message?.content)
          : null,
        (json as Record<string, unknown>).response,
        (json as Record<string, unknown>).text,
        (json as Record<string, unknown>).output,
        (json as Record<string, unknown>).content,
      ];
      for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c.trim();
      }
      // Handle OpenAI shape
      if (json.choices?.[0]?.message?.content) return String(json.choices[0].message.content).trim();
      lastError = "No content in response";
      continue;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastError = e instanceof Error ? e.message : String(e);
      if (keyState) markAgnesKeyFailure(keyState.key, 429); // treat network as transient
      continue;
    }
  }
  throw new Error(lastError);
}

// ------------------------------------------------------------------
// Image generation
// ------------------------------------------------------------------

export interface AgnesImageParams {
  prompt: string;
  model?: string; // default agnes-image-2.1-flash
  size?: string; // 1K,2K,3K,4K or legacy
  ratio?: string; // 1:1,16:9 etc
  images?: string[]; // URLs or data URIs
  response_format?: string; // url or b64_json
}

export async function agnesGenerateImage(params: AgnesImageParams, signal?: AbortSignal): Promise<string> {
  if (!hasAgnesKeys()) throw new Error("Agnes API key not configured.");

  const keyState = getNextAgnesKey();
  if (!keyState) throw new Error("All Agnes API keys temporarily unavailable. Try again shortly.");

  const model = params.model || "agnes-image-2.1-flash";
  const size = params.size || "1K";
  const ratio = params.ratio || "1:1";

  const payload: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    size,
    ratio,
  };

  // Images go in extra_body.image per Agnes docs (some docs say top-level also works, but extra_body is canonical for 2.1)
  const extraBody: Record<string, unknown> = {
    response_format: params.response_format || "url",
  };
  if (params.images && params.images.length > 0) {
    extraBody.image = params.images;
    // Also set top-level image for compatibility with older variations
    payload.image = params.images;
  }
  payload.extra_body = extraBody;

  let res: Response;
  try {
    res = await fetch(`${AGNES_BASE}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyState.key}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e: unknown) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    markAgnesKeyFailure(keyState.key, res.status);
    const t = await res.text().catch(() => "");
    let j: unknown = null; try { j = JSON.parse(t); } catch {}
    const msg = extractErrorMessage(j, `Agnes image failed (HTTP ${res.status})`);
    console.error(`[Agnes] image error ${res.status}:`, msg);
    throw new Error(msg);
  }
  markAgnesKeySuccess(keyState.key);
  const json = await res.json().catch(async () => {
    const t = await res.text();
    try { return JSON.parse(t); } catch { return {}; }
  });

  // Response shapes: { data: [{ url }]} or { data: [{ b64_json }]} or { image_url }
  const extractUrl = (j: unknown): string | null => {
    if (!j || typeof j !== "object") return null;
    const o = j as Record<string, unknown>;
    if (typeof o.url === "string" && o.url.startsWith("http")) return o.url;
    if (typeof o.image_url === "string" && o.image_url.startsWith("http")) return o.image_url;
    if (typeof o.imageUrl === "string" && o.imageUrl.startsWith("http")) return o.imageUrl;
    if (Array.isArray(o.data) && o.data.length > 0) {
      const first = o.data[0] as Record<string, unknown>;
      if (typeof first?.url === "string" && (first.url as string).startsWith("http")) return first.url as string;
      if (typeof first?.b64_json === "string") {
        // Convert b64 to data URI
        return `data:image/png;base64,${first.b64_json as string}`;
      }
    }
    if (Array.isArray(o.images) && o.images.length > 0) {
      const first = o.images[0] as string | Record<string, unknown>;
      if (typeof first === "string" && first.startsWith("http")) return first;
    }
    return null;
  };

  const url = extractUrl(json);
  if (url) return url;
  console.error("[Agnes] image unexpected payload", JSON.stringify(json).slice(0, 500));
  throw new Error("Agnes image service returned no image URL.");
}

// ------------------------------------------------------------------
// Video generation (async)
// ------------------------------------------------------------------

export interface AgnesVideoCreateParams {
  prompt: string;
  images?: string[]; // 1 for image-to-video, 2+ for keyframes
  model?: string; // default agnes-video-v2.0
  width?: number;
  height?: number;
  num_frames?: number;
  frame_rate?: number;
  negative_prompt?: string;
  seed?: number;
}

export interface AgnesVideoCreateResult {
  video_id?: string;
  task_id?: string;
  id?: string;
  status?: string;
  videoId: string; // normalized
  key: string; // key that created task (for polling affinity)
}

export async function agnesCreateVideo(params: AgnesVideoCreateParams, signal?: AbortSignal): Promise<AgnesVideoCreateResult> {
  if (!hasAgnesKeys()) throw new Error("Agnes API key not configured.");

  const keyState = getNextAgnesKey();
  if (!keyState) throw new Error("All Agnes API keys temporarily unavailable.");

  const model = params.model || "agnes-video-v2.0";
  const { width, height } = normalizeResolution(params.width, params.height);
  const num_frames = snapFrames(params.num_frames ?? 121);
  const frame_rate = Math.max(1, Math.min(60, params.frame_rate ?? 24));

  const payload: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    width,
    height,
    num_frames,
    frame_rate,
  };
  if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
  if (params.seed !== undefined) payload.seed = params.seed;

  if (params.images && params.images.length === 1) {
    // Single image -> image-to-video
    payload.image = params.images[0];
  } else if (params.images && params.images.length >= 2) {
    // Multi-image -> keyframe animation
    payload.extra_body = {
      image: params.images,
      mode: "keyframes",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${AGNES_BASE}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyState.key}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e: unknown) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    markAgnesKeyFailure(keyState.key, res.status);
    const t = await res.text().catch(() => "");
    let j: unknown = null; try { j = JSON.parse(t); } catch {}
    const msg = extractErrorMessage(j, `Agnes video create failed (HTTP ${res.status})`);
    console.error(`[Agnes] video create ${res.status}:`, msg);
    throw new Error(msg);
  }
  markAgnesKeySuccess(keyState.key);
  const json = (await res.json().catch(async () => {
    const t = await res.text();
    try { return JSON.parse(t); } catch { return {}; }
  })) as Record<string, unknown>;

  const videoId = (json.video_id as string) || (json.task_id as string) || (json.id as string) || (json.videoId as string);
  if (!videoId) {
    console.error("[Agnes] video create missing id", json);
    throw new Error("Video task created but no video_id returned.");
  }
  recordVideoKey(videoId, keyState.key);
  return {
    video_id: videoId,
    task_id: json.task_id as string,
    id: json.id as string,
    status: json.status as string,
    videoId,
    key: keyState.key,
  };
}

export interface AgnesVideoStatus {
  status: "pending" | "processing" | "queued" | "in_progress" | "completed" | "failed" | "success" | string;
  video_url?: string;
  videoUrl?: string;
  url?: string;
  progress?: number;
  error?: string;
  raw: unknown;
}

export async function agnesPollVideo(videoId: string, signal?: AbortSignal): Promise<AgnesVideoStatus> {
  const key =
    getVideoKey(videoId) ||
    getNextAgnesKey()?.key ||
    null;
  if (!key) throw new Error("No Agnes key available for polling.");

  // Preferred polling endpoint is GET /agnesapi?video_id= on the agnesapi host
  // The base for polling is https://apihub.agnes-ai.com/agnesapi (without /v1)
  const pollingHosts = [
    `${AGNES_HOST}/agnesapi?video_id=${encodeURIComponent(videoId)}`,
    `${AGNES_BASE}/videos/${encodeURIComponent(videoId)}`,
    `${AGNES_BASE}/video/${encodeURIComponent(videoId)}`,
  ];

  let lastError = "";
  for (const url of pollingHosts) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) continue; // try next host
        if (res.status === 401 || res.status === 403) {
          markAgnesKeyFailure(key, res.status);
        } else if (res.status === 429) {
          markAgnesKeyFailure(key, res.status);
        }
        const t = await res.text().catch(() => "");
        lastError = `poll ${res.status}: ${t.slice(0, 200)}`;
        continue;
      }
      const json = await res.json().catch(async () => {
        const t = await res.text();
        try { return JSON.parse(t); } catch { return { raw: t }; }
      });
      const j = json as Record<string, unknown>;
      // Normalize status
      const statusRaw = (j.status as string) || (j.state as string) || "pending";
      const status = String(statusRaw).toLowerCase();
      const video_url =
        (j.video_url as string) ||
        (j.videoUrl as string) ||
        (j.url as string) ||
        (j.video as string) ||
        (j.result as Record<string, unknown>)?.video_url as string ||
        (j.data as Record<string, unknown>)?.video_url as string ||
        undefined;

      // Detect failure
      if (status.includes("fail") || j.error) {
        return { status: "failed", error: (j.error as string) || (j.message as string) || "Video generation failed", raw: json };
      }
      if (video_url) {
        return { status: "completed", video_url, videoUrl: video_url, url: video_url, progress: 100, raw: json };
      }
      // still processing
      const progress = typeof j.progress === "number" ? j.progress : undefined;
      return { status: status as AgnesVideoStatus["status"], progress, raw: json };
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") throw e;
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
  }
  throw new Error(lastError || "Video polling failed, no endpoint responded.");
}
