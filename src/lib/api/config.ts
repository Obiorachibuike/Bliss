// Central API configuration - verified against https://github.com/cvroon-api/FreeAiAPIs
// The host is overridable (mirror / self-hosted gateway). It is not a secret: the upstream is a
// key-less public API, so the same value is safe to read on the client for documentation views.
import type { AIModel } from "@/lib/types";

export interface ImageModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  endpoint: string;
  capabilities: readonly string[];
  available: boolean;
  fallback: boolean;
}

const HOST =
  process.env.NEXT_PUBLIC_AI_API_HOST ||
  (process.env as Record<string, string | undefined>).BLESS_API_BASE ||
  "https://cvron.alwaysdata.net";

export const API_BASE = `${HOST.replace(/\/+$/, "")}/cvronai`;
export const API_HOST = HOST.replace(/\/+$/, "");

export const ENDPOINTS = {
  chat: {
    llama: `${API_BASE}/llama.php`,
    gpt5nano: `${API_BASE}/gpt-5-nano.php`,
    gemini: `${API_BASE}/gemini-2.5-flash-lite.php`,
    deepseek: `${API_BASE}/deepseek-v3.2.php`,
  },
  image: {
    fluxDev: `${API_BASE}/flux-dev.php`,
    image2image: `${API_BASE}/image2image.php`,
    up: `${API_BASE}/up.php`,
  },
  video: {
    wan22: `${API_BASE}/wan22.php`,
  },
  tools: {
    proxy: `${API_HOST}/cvronapi/sslproxy.php`,
    shortener: `${API_HOST}/cvronapi/url-shortener.php`,
    winKey: `${API_HOST}/cvronapi/win-key.php`,
  },
} as const;

export const MODELS: AIModel[] = [
  {
    id: "llama" as const,
    name: "Llama 3.3",
    provider: "Meta",
    description: "Versatile open model for general conversation and reasoning.",
    capabilities: ["General chat", "Coding", "Reasoning"],
    endpoint: ENDPOINTS.chat.llama,
    color: "#2563EB",
    icon: "🦙",
    available: true,
    fallback: false,
  },
  {
    id: "gpt-5-nano" as const,
    name: "GPT-5 Nano",
    provider: "OpenAI",
    description: "Compact GPT-5 variant — fast, efficient responses.",
    capabilities: ["General chat", "Coding", "Reasoning"],
    endpoint: ENDPOINTS.chat.gpt5nano,
    color: "#0EA5E9",
    icon: "🤖",
    available: true,
    fallback: false,
  },
  {
    id: "gemini-2.5-flash-lite" as const,
    name: "Gemini 2.5 Flash Lite",
    provider: "Google",
    description: "Lightweight Gemini for quick, high-quality answers.",
    capabilities: ["General chat", "Vision", "Reasoning"],
    endpoint: ENDPOINTS.chat.gemini,
    color: "#3B82F6",
    icon: "🌟",
    available: true,
    fallback: false,
  },
  {
    id: "deepseek-v3.2" as const,
    name: "DeepSeek V3.2",
    provider: "DeepSeek",
    description: "Advanced reasoning and code generation model.",
    capabilities: ["Coding", "Reasoning", "General chat"],
    endpoint: ENDPOINTS.chat.deepseek,
    color: "#6366F1",
    icon: "🔍",
    available: true,
    fallback: false,
  },
];

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: "flux-dev",
    name: "Flux Dev",
    provider: "Black Forest Labs",
    description: "Lightning-fast image generation (~3s) with high fidelity.",
    endpoint: ENDPOINTS.image.fluxDev,
    capabilities: ["Text-to-Image"],
    available: true,
    fallback: false,
  },
];

export const VIDEO_MODELS: ImageModel[] = [
  {
    id: "wan-2.2",
    name: "WAN 2.2",
    provider: "Alibaba",
    description: "Image-to-video generation with dynamic motion.",
    endpoint: ENDPOINTS.video.wan22,
    capabilities: ["Image-to-Video"],
    available: true,
    fallback: false,
  },
];

export const API_LIMITATIONS = {
  streaming: false,
  conversationContext: false, // endpoint only accepts single prompt; we use adapter
  vision: false, // no documented vision endpoint - Gemini flash lite may support but not exposed as explicit vision API
  textToVideo: false, // only image-to-video via wan22
  maxPromptLength: 4000,
  timeout: 30000,
  retries: 2,
};
/* ──────────────────────────────────────────────────────────────────────────
 * Fallback provider · Agnes AI (https://www.agnes-ai.com/en/docs)
 *
 * OpenAI-compatible gateway used when the primary free API can't answer, and
 * selectable directly. Unlike CVRON it needs an API key, so it is strictly
 * optional: with no key configured Bliss behaves exactly as before and every
 * fallback capability reports itself as unavailable (never silently faked).
 *
 * Verified contracts (docs index: https://wiki.agnes-ai.com/llms.txt):
 *   POST {base}/chat/completions   { model, messages[], temperature?, max_tokens?, stream? }
 *                                  -> { choices: [{ message: { role, content } }] }
 *   POST {base}/images/generations { model, prompt, size, ratio?, extra_body { image?[], response_format } }
 *                                  -> { data: [{ url | b64_json }] }
 *   POST {base}/videos             { model, prompt, mode, seconds, size, aspect_ratio?, ... }
 *                                  -> { video_id, status, progress }
 *   GET  {origin}/agnesapi?video_id=…&model_name=…   -> { status, progress, url?, error? }
 *
 * Deliberately not offered: `agnes-2.0-flash`. The docs deprecate it and say
 * explicitly "Do not continue using the deprecated agnes-2.0-flash model as a
 * compatibility fallback", and `agnes-3.0-pro` is listed as "coming soon".
 * ──────────────────────────────────────────────────────────────────────── */

/** The key itself lives in `src/lib/api/fallback-env.ts`, which only server modules
 *  import. Nothing here depends on it: `enabled` is resolved at request time by
 *  /api/models and /api/health, so the client bundle can never read a secret. */
export const AGNES_BASE_URL = (
  process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1"
).replace(/\/+$/, "");

export const AGNES_LIMITS = {
  /** Free tier is documented at ~20 executable requests/minute. */
  rpm: 20,
  /** Chat Completions caps output at 64K tokens; we ask for far less. */
  maxOutputTokens: 2048,
  temperature: 0.7,
  timeout: 30_000,
  imageTimeout: 150_000,
  /** Docs recommend a 60–360s client timeout for image jobs. */
  imageEditTimeout: 200_000,
  /** Video is asynchronous: one create call, then polling. */
  videoCreateTimeout: 60_000,
  videoPollTimeout: 20_000,
} as const;

export interface AgnesChatModelSpec {
  id: string;
  name: string;
  description: string;
  capabilities: readonly string[];
  /** True for the documented multimodal models (image_url content parts). */
  vision: boolean;
  /** false = currently $0 in the documented promotional pricing. */
  billed: boolean;
  color: string;
  icon: string;
}

/** Documented, generally available Agnes chat models. */
export const AGNES_CHAT_MODELS = [
  {
    id: "agnes-2.5-flash",
    name: "Agnes 2.5 Flash",
    description:
      "512K context, native multi-turn, tool calling and vision via public image URLs.",
    capabilities: ["General chat", "Coding", "Vision"],
    vision: true,
    billed: false,
    color: "#0EA5E9",
    icon: "🛡️",
  },
  {
    id: "agnes-3.0-flash",
    name: "Agnes 3.0 Flash",
    description:
      "Newer Flash generation: stronger code tasks, tool orchestration, still $0 on the published offer.",
    capabilities: ["General chat", "Coding", "Vision"],
    vision: true,
    billed: false,
    color: "#2563EB",
    icon: "⚡",
  },
  {
    id: "agnes-2.5-pro",
    name: "Agnes 2.5 Pro",
    description:
      "Commercial stable tier for agentic work and document analysis. Billed per token.",
    capabilities: ["Reasoning", "Long context", "Vision"],
    vision: true,
    billed: true,
    color: "#7C3AED",
    icon: "💎",
  },
  {
    id: "agnes-2.5-pro-beta",
    name: "Agnes 2.5 Pro Beta",
    description:
      "Advanced reasoning and long-context analysis. Billed per token — costs real credits.",
    capabilities: ["Reasoning", "Coding", "Vision"],
    vision: true,
    billed: true,
    color: "#6366F1",
    icon: "🧠",
  },
] as const satisfies readonly AgnesChatModelSpec[];

const AGNES_CHAT_IDS = AGNES_CHAT_MODELS.map((m) => m.id);

/** Model used when Bliss falls back after a primary failure. `AGNES_CHAT_MODEL`
 *  selects any documented id; an unknown value is ignored rather than sent upstream. */
export const AGNES_FALLBACK_CHAT_MODEL: string = (
  AGNES_CHAT_IDS as readonly string[]
).includes((process.env.AGNES_CHAT_MODEL ?? "").trim())
  ? (process.env.AGNES_CHAT_MODEL as string).trim()
  : AGNES_CHAT_IDS[0];

export function isAgnesChatModel(model: string | undefined): boolean {
  return !!model && (AGNES_CHAT_IDS as readonly string[]).includes(model);
}

export function agnesChatModel(model: string): AgnesChatModelSpec | undefined {
  return AGNES_CHAT_MODELS.find((m) => m.id === model);
}

/* Image models — the three documented generations share one contract, so a
 * different model is a different *choice*, not a different code path. */
export interface AgnesImageModelSpec {
  id: string;
  name: string;
  description: string;
  capabilities: readonly string[];
  billed: boolean;
}

export const AGNES_IMAGE_MODELS = [
  {
    id: "agnes-image-2.0-flash",
    name: "Agnes Image 2.0 Flash",
    description: "Fast generation, edits and multi-image composition.",
    capabilities: ["Text-to-Image", "Image-to-Image"],
    billed: false,
  },
  {
    id: "agnes-image-2.1-flash",
    name: "Agnes Image 2.1 Flash",
    description:
      "High-information-density visuals with composition-preserving edits.",
    capabilities: ["Text-to-Image", "Image-to-Image"],
    billed: false,
  },
  {
    id: "agnes-image-2.5-flash",
    name: "Agnes Image 2.5 Flash",
    description:
      "Latest generation: stronger detail and prompt alignment, same request contract.",
    capabilities: ["Text-to-Image", "Image-to-Image", "Composition"],
    billed: false,
  },
] as const satisfies readonly AgnesImageModelSpec[];

const AGNES_IMAGE_IDS = AGNES_IMAGE_MODELS.map((m) => m.id);

/** Default model for automatic fallback generations. `AGNES_IMAGE_MODEL` selects any
 *  documented id; an unknown value is ignored. */
export const AGNES_IMAGE_MODEL: string = (
  AGNES_IMAGE_IDS as readonly string[]
).includes((process.env.AGNES_IMAGE_MODEL ?? "").trim())
  ? (process.env.AGNES_IMAGE_MODEL as string).trim()
  : "agnes-image-2.1-flash";

export function isAgnesImageModel(model: string | undefined): boolean {
  return !!model && (AGNES_IMAGE_IDS as readonly string[]).includes(model);
}

/** Documented output tiers (exact pixel sizes are normalised by the provider). */
export const AGNES_IMAGE_SIZES = ["1K", "2K", "3K", "4K"] as const;
export type AgnesImageSize = (typeof AGNES_IMAGE_SIZES)[number];

/* Video models — asynchronous: create a task, then poll for `status` + `url`.
 * The two documented ids differ in resolution tiers and reference media, so the
 * UI is driven by this spec instead of hard-coded assumptions. */
export type AgnesVideoMode = "text" | "keyframe" | "reference";

export interface AgnesVideoModelSpec {
  id: string;
  name: string;
  description: string;
  capabilities: readonly string[];
  /** 720P only on Flash; 2.5 adds 1080P / 1K / 2K. */
  sizes: readonly string[];
  ratios: readonly string[];
  modes: AgnesVideoMode[];
  maxImages: number;
  maxAudios: number;
  /** Only `agnes-video-2.5` accepts a reference video; Flash returns HTTP 400. */
  videoReference: boolean;
  billed: boolean;
}

export const AGNES_VIDEO_SECONDS = { min: 4, max: 12, default: 5 } as const;

/** Docs: `WIDTHxHEIGHT` and `auto` are not supported for video. */
export const AGNES_VIDEO_RATIOS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
] as const;

export const AGNES_VIDEO_MODELS = [
  {
    id: "agnes-video-2.5-flash",
    name: "Agnes Video 2.5 Flash",
    description:
      "Free promotional tier, 720P only. Text, keyframe and image/audio reference modes.",
    capabilities: ["Text-to-Video", "Keyframes", "Image reference"],
    sizes: ["720P"],
    ratios: [...AGNES_VIDEO_RATIOS],
    modes: ["text", "keyframe", "reference"],
    maxImages: 5,
    maxAudios: 3,
    videoReference: false,
    billed: false,
  },
  {
    id: "agnes-video-2.5",
    name: "Agnes Video 2.5",
    description:
      "Up to 2K with reference-video control. Billed per second of output + input video.",
    capabilities: ["Text-to-Video", "Keyframes", "Video reference"],
    sizes: ["720P", "1080P", "1K", "2K"],
    ratios: [...AGNES_VIDEO_RATIOS],
    modes: ["text", "keyframe", "reference"],
    maxImages: 8,
    maxAudios: 3,
    videoReference: true,
    billed: true,
  },
] as const satisfies readonly AgnesVideoModelSpec[];

const AGNES_VIDEO_IDS = AGNES_VIDEO_MODELS.map((m) => m.id);

export function isAgnesVideoModel(model: string | undefined): boolean {
  return !!model && (AGNES_VIDEO_IDS as readonly string[]).includes(model);
}

export function agnesVideoModel(
  model: string,
): AgnesVideoModelSpec | undefined {
  return AGNES_VIDEO_MODELS.find((m) => m.id === model);
}

/** Pure form of the rule below, exported so the validation is testable. */
export function readAgnesVideoModel(value: string | undefined): string {
  const candidate = (value ?? "").trim();
  return (AGNES_VIDEO_IDS as readonly string[]).includes(candidate)
    ? candidate
    : AGNES_VIDEO_MODELS[0].id;
}

/** Default model for an automatic video task. `AGNES_VIDEO_MODEL` selects any documented
 *  id; an unknown value is ignored rather than sent upstream. */
export const AGNES_VIDEO_MODEL: string = readAgnesVideoModel(
  process.env.AGNES_VIDEO_MODEL,
);

/** Docs: "Poll every 1–2 seconds until status becomes completed or failed" and to use
 *  backoff for 429s. Bliss polls at 2s and gives up after the documented worst case. */
export const AGNES_VIDEO_POLL = {
  intervalMs: 2_000,
  maxWaitMs: 300_000,
  /** A 429 from the status endpoint: wait longer instead of hammering it. */
  backoffMs: 6_000,
} as const;

export const AGNES_VIDEO_STATUS = [
  "queued",
  "in_progress",
  "completed",
  "failed",
] as const;
export type AgnesVideoStatus = (typeof AGNES_VIDEO_STATUS)[number];

/** Text models offered in the picker. `fallback: true` entries are routed to
 *  Agnes directly (they skip the CVRON chain entirely). */
export const MODELS_WITH_FALLBACK = [
  ...MODELS,
  ...AGNES_CHAT_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: "Agnes AI",
    description: m.billed
      ? `${m.description} Requires a server-side AGNES_API_KEY and is billed.`
      : `${m.description} Requires a server-side AGNES_API_KEY (currently $0).`,
    capabilities: m.capabilities,
    endpoint: `${AGNES_BASE_URL}/chat/completions`,
    color: m.color,
    icon: m.icon,
    available: true,
    fallback: true,
    billed: m.billed,
  })),
];

export const TEXT_MODEL_CATALOG = MODELS_WITH_FALLBACK;

export const IMAGE_MODELS_WITH_FALLBACK = [
  ...IMAGE_MODELS,
  ...AGNES_IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: "Agnes AI",
    description: `${m.description} Fallback-provider model — needs AGNES_API_KEY.`,
    endpoint: `${AGNES_BASE_URL}/images/generations`,
    capabilities: m.capabilities,
    available: true,
    fallback: true,
  })),
];

/** Video models offered in Video Studio. The Agnes entries are asynchronous tasks;
 *  WAN 2.2 stays a single long synchronous request. */
export const VIDEO_MODELS_WITH_FALLBACK = [
  ...VIDEO_MODELS,
  ...AGNES_VIDEO_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: "Agnes AI",
    description: `${m.description} Needs AGNES_API_KEY${m.billed ? " and is billed per second" : " (currently $0)"}.`,
    endpoint: `${AGNES_BASE_URL}/videos`,
    capabilities: m.capabilities,
    available: true,
    fallback: true,
  })),
];

export const RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
] as const;

/** What the fallback provider changes, independent of whether it is configured.
 *  `enabled`, `vision` and `nativeConversationContext` are added at request time
 *  by the routes that can see the environment. */
export const FALLBACK_CAPABILITIES = {
  provider: "Agnes AI",
  docs: "https://www.agnes-ai.com/en/docs",
  // Documented by Agnes, but Bliss renders whole responses, so it stays off.
  streaming: false,
  // Wired through the documented async create + poll contract.
  textToVideo: true,
  requiresKey: true,
  keyEnvVar: "AGNES_API_KEY",
  chatModels: AGNES_CHAT_IDS,
  imageModel: AGNES_IMAGE_MODEL,
  imageModels: AGNES_IMAGE_IDS,
  videoModel: AGNES_VIDEO_MODEL,
  videoModels: AGNES_VIDEO_IDS,
} as const;
