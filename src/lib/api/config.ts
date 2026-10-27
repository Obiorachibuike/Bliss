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
  capabilities: string[];
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
 * OpenAI-compatible gateway used when the primary free API can't answer.
 * Unlike CVRON it needs an API key, so it is strictly optional: with no key
 * configured Bliss behaves exactly as before and every fallback capability
 * reports itself as unavailable (never silently faked).
 *
 * Verified request/response contract (docs/quickstart + model pages):
 *   POST https://apihub.agnes-ai.com/v1/chat/completions
 *        { model, messages[], temperature?, max_tokens?, stream? }
 *        -> { choices: [{ message: { role, content } }], usage }
 *   POST https://apihub.agnes-ai.com/v1/images/generations
 *        { model, prompt, size, ratio?, extra_body: { image?[], response_format } }
 *        -> { data: [{ url | b64_json }] }
 *
 * Deliberately NOT wired up: video. Agnes documents several video models whose
 * request bodies and polling semantics Bliss has not verified, so image→video
 * stays on the single documented WAN 2.2 endpoint.
 * ──────────────────────────────────────────────────────────────────────── */

/** The key itself lives in `src/lib/api/fallback-env.ts`, which only server modules
 *  import. Nothing here depends on it: `enabled` is resolved at request time by
 *  /api/models and /api/health, so the client bundle can never read a secret. */
export const AGNES_BASE_URL = (process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");

export const AGNES_LIMITS = {
  /** Free tier is documented at ~20 executable requests/minute. */
  rpm: 20,
  /** Chat Completions caps output at 65.5K tokens; we ask for far less. */
  maxOutputTokens: 2048,
  temperature: 0.7,
  timeout: 30_000,
  imageTimeout: 150_000,
  /** Docs recommend a 60–360s client timeout for image jobs. */
  imageEditTimeout: 200_000,
} as const;

/** Documented chat models of the fallback provider (server-side only — the key never leaves it). */
export const AGNES_CHAT_MODELS = [
  { id: "agnes-2.5-flash", vision: true },
  { id: "agnes-3.0-flash", vision: true },
] as const;

/** Model used when Bliss falls back. Any documented id can be selected with
 *  AGNES_CHAT_MODEL; an unknown value is ignored rather than passed upstream. */
export const AGNES_FALLBACK_CHAT_MODEL: string =
  (AGNES_CHAT_MODELS as readonly { id: string }[]).find((m) => m.id === process.env.AGNES_CHAT_MODEL)?.id ??
  AGNES_CHAT_MODELS[0].id;

/** Image model for text-to-image and edits. Overridable with AGNES_IMAGE_MODEL. */
export const AGNES_IMAGE_MODEL: string =
  process.env.AGNES_IMAGE_MODEL?.trim() || "agnes-image-2.1-flash";

/** Text models offered in the picker. `fallback: true` entries are routed to
 *  Agnes directly (they skip the CVRON chain entirely). */
export const MODELS_WITH_FALLBACK = [
  ...MODELS,
  {
    id: "agnes-2.5-flash" as const,
    name: "Agnes 2.5 Flash",
    provider: "Agnes AI",
    description: "Fallback provider — 512K context, native multi-turn, coding and vision via public image URLs.",
    capabilities: ["General chat", "Coding", "Vision"],
    endpoint: `${AGNES_BASE_URL}/chat/completions`,
    color: "#0EA5E9",
    icon: "🛡️",
    available: true,
    fallback: true,
  },
];

export const TEXT_MODEL_CATALOG = MODELS_WITH_FALLBACK;

export const IMAGE_MODELS_WITH_FALLBACK = [
  ...IMAGE_MODELS,
  {
    id: "agnes-image-2.1-flash",
    name: "Agnes Image 2.1 Flash",
    provider: "Agnes AI",
    description: "Fallback image model — text-to-image plus composition-preserving edits with aspect-ratio control.",
    endpoint: `${AGNES_BASE_URL}/images/generations`,
    capabilities: ["Text-to-Image", "Image-to-Image"],
    available: true,
    fallback: true,
  },
];

export const RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;

/** What the fallback provider changes, independent of whether it is configured.
 *  `enabled`, `vision` and `nativeConversationContext` are added at request time
 *  by the routes that can see the environment. */
export const FALLBACK_CAPABILITIES = {
  provider: "Agnes AI",
  docs: "https://www.agnes-ai.com/en/docs",
  // Documented by Agnes, but Bliss renders whole responses, so it stays off.
  streaming: false,
  // Agnes documents video models Bliss has not verified end to end — not wired up.
  textToVideo: false,
  requiresKey: true,
  keyEnvVar: "AGNES_API_KEY",
  chatModels: AGNES_CHAT_MODELS.map((m) => m.id),
  imageModel: AGNES_IMAGE_MODEL,
} as const;

