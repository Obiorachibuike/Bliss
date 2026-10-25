// Central API configuration - verified against https://github.com/cvroon-api/FreeAiAPIs
// The host is overridable (mirror / self-hosted gateway). It is not a secret: the upstream is a
// key-less public API, so the same value is safe to read on the client for documentation views.
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

export const MODELS = [
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
  },
];

export const IMAGE_MODELS = [
  {
    id: "flux-dev",
    name: "Flux Dev",
    provider: "Black Forest Labs",
    description: "Lightning-fast image generation (~3s) with high fidelity.",
    endpoint: ENDPOINTS.image.fluxDev,
    capabilities: ["Text-to-Image"],
    available: true,
  },
];

export const VIDEO_MODELS = [
  {
    id: "wan-2.2",
    name: "WAN 2.2",
    provider: "Alibaba",
    description: "Image-to-video generation with dynamic motion.",
    endpoint: ENDPOINTS.video.wan22,
    capabilities: ["Image-to-Video"],
    available: true,
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
