// Central API configuration — CVRON FreeAiAPIs + Agnes AI
// CVRON host is key-less public; Agnes requires AGNES_API_KEY_n (server-only).
const HOST =
  process.env.NEXT_PUBLIC_AI_API_HOST ||
  (process.env as Record<string, string | undefined>).BLESS_API_BASE ||
  "https://cvron.alwaysdata.net";

export const API_BASE = `${HOST.replace(/\/+$/, "")}/cvronai`;
export const API_HOST = HOST.replace(/\/+$/, "");

// Agnes AI — OpenAI-compatible gateway
const AGNES_HOST_RAW =
  process.env.AGNES_API_BASE ||
  process.env.AGNES_API_HOST ||
  process.env.NEXT_PUBLIC_AGNES_API_HOST ||
  "https://apihub.agnes-ai.com/v1";

export const AGNES_API_BASE = AGNES_HOST_RAW.replace(/\/+$/, "");
export const AGNES_HOST = AGNES_API_BASE.replace(/\/v1\/?$/, "");

export const ENDPOINTS = {
  chat: {
    llama: `${API_BASE}/llama.php`,
    gpt5nano: `${API_BASE}/gpt-5-nano.php`,
    gemini: `${API_BASE}/gemini-2.5-flash-lite.php`,
    deepseek: `${API_BASE}/deepseek-v3.2.php`,
    // Agnes chat (OpenAI-compatible)
    agnesChat: `${AGNES_API_BASE}/chat/completions`,
  },
  image: {
    fluxDev: `${API_BASE}/flux-dev.php`,
    image2image: `${API_BASE}/image2image.php`,
    up: `${API_BASE}/up.php`,
    agnesImage: `${AGNES_API_BASE}/images/generations`,
  },
  video: {
    wan22: `${API_BASE}/wan22.php`,
    agnesVideo: `${AGNES_API_BASE}/videos`,
    agnesVideoPoll: `${AGNES_HOST}/agnesapi`,
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
    provider: "Meta · CVRON",
    description: "Versatile open model for general conversation and reasoning.",
    capabilities: ["General chat", "Coding", "Reasoning"],
    endpoint: ENDPOINTS.chat.llama,
    color: "#2563EB",
    icon: "🦙",
    available: true,
    streaming: false,
    vision: false,
  },
  {
    id: "gpt-5-nano" as const,
    name: "GPT-5 Nano",
    provider: "OpenAI · CVRON",
    description: "Compact GPT-5 variant — fast, efficient responses.",
    capabilities: ["General chat", "Coding", "Reasoning"],
    endpoint: ENDPOINTS.chat.gpt5nano,
    color: "#0EA5E9",
    icon: "🤖",
    available: true,
    streaming: false,
    vision: false,
  },
  {
    id: "gemini-2.5-flash-lite" as const,
    name: "Gemini 2.5 Flash Lite",
    provider: "Google · CVRON",
    description: "Lightweight Gemini for quick, high-quality answers.",
    capabilities: ["General chat", "Vision", "Reasoning"],
    endpoint: ENDPOINTS.chat.gemini,
    color: "#3B82F6",
    icon: "🌟",
    available: true,
    streaming: false,
    vision: false,
  },
  {
    id: "deepseek-v3.2" as const,
    name: "DeepSeek V3.2",
    provider: "DeepSeek · CVRON",
    description: "Advanced reasoning and code generation model.",
    capabilities: ["Coding", "Reasoning", "General chat"],
    endpoint: ENDPOINTS.chat.deepseek,
    color: "#6366F1",
    icon: "🔍",
    available: true,
    streaming: false,
    vision: false,
  },
  {
    id: "agnes-2.0-flash" as const,
    name: "Agnes 2.0 Flash",
    provider: "Agnes AI · Pesles",
    description: "Free ChatGPT-style streaming chat — fast, vision-capable, $0 promo pricing.",
    capabilities: ["Streaming", "Vision", "General chat", "Coding", "Reasoning"],
    endpoint: ENDPOINTS.chat.agnesChat,
    color: "#7C3AED",
    icon: "✨",
    available: true,
    streaming: true,
    vision: true,
  },
  {
    id: "agnes-2.5-flash" as const,
    name: "Agnes 2.5 Flash",
    provider: "Agnes AI · Pesles",
    description: "Newer Agnes flagship — 512K context, reasoning + tool calling.",
    capabilities: ["Streaming", "Vision", "Reasoning", "Tool calling"],
    endpoint: ENDPOINTS.chat.agnesChat,
    color: "#8B5CF6",
    icon: "⚡",
    available: true,
    streaming: true,
    vision: true,
  },
  {
    id: "agnes-3.0-flash" as const,
    name: "Agnes 3.0 Flash",
    provider: "Agnes AI · Pesles",
    description: "Latest Agnes generation — 512K context, strongest reasoning.",
    capabilities: ["Streaming", "Vision", "Reasoning", "Coding"],
    endpoint: ENDPOINTS.chat.agnesChat,
    color: "#A855F7",
    icon: "🚀",
    available: true,
    streaming: true,
    vision: true,
  },
];

export const IMAGE_MODELS = [
  {
    id: "flux-dev",
    name: "Flux Dev",
    provider: "Black Forest Labs · CVRON",
    description: "Lightning-fast image generation (~3s) with high fidelity.",
    endpoint: ENDPOINTS.image.fluxDev,
    capabilities: ["Text-to-Image"],
    available: true,
  },
  {
    id: "agnes-image-2.1-flash",
    name: "Agnes Image 2.1 Flash",
    provider: "Agnes AI · Pesles",
    description: "High-density image generation & editing — free tier $0, URL or Base64 output.",
    endpoint: ENDPOINTS.image.agnesImage,
    capabilities: ["Text-to-Image", "Image-to-Image", "Multi-image compose"],
    available: true,
  },
  {
    id: "agnes-image-2.5-flash",
    name: "Agnes Image 2.5 Flash",
    provider: "Agnes AI · Pesles",
    description: "Next-gen 4K text-to-image with flexible ratios — 1K–4K tiers.",
    endpoint: ENDPOINTS.image.agnesImage,
    capabilities: ["Text-to-Image", "Image-to-Image", "4K"],
    available: true,
  },
];

export const VIDEO_MODELS = [
  {
    id: "wan-2.2",
    name: "WAN 2.2",
    provider: "Alibaba · CVRON",
    description: "Image-to-video generation with dynamic motion.",
    endpoint: ENDPOINTS.video.wan22,
    capabilities: ["Image-to-Video"],
    available: true,
  },
  {
    id: "agnes-video-v2.0",
    name: "Agnes Video V2.0",
    provider: "Agnes AI · Pesles",
    description: "Async text/image/keyframe video — 18s max @24fps, $0 promo, streaming poll.",
    endpoint: ENDPOINTS.video.agnesVideo,
    capabilities: ["Text-to-Video", "Image-to-Video", "Keyframe"],
    available: true,
  },
  {
    id: "agnes-video-2.5",
    name: "Agnes Video 2.5",
    provider: "Agnes AI · Pesles",
    description: "Latest video model — 12s reference/keyframe, 720P/1080P/1K/2K.",
    endpoint: ENDPOINTS.video.agnesVideo,
    capabilities: ["Text-to-Video", "Image-to-Video", "Reference"],
    available: true,
  },
];

export const API_LIMITATIONS = {
  streaming: true, // supported via Agnes; CVRON still non-streaming
  conversationContext: true, // Agnes has native messages array; CVRON via adapter
  vision: true, // Agnes chat supports image_url
  textToVideo: true, // Agnes video supports text-to-video
  maxPromptLength: 4000,
  timeout: 30000,
  retries: 2,
};

// Helpers
export function isAgnesModel(id: string): boolean {
  return id.startsWith("agnes-");
}
export function isAgnesChatModel(id: string): boolean {
  return id === "agnes-2.0-flash" || id === "agnes-2.5-flash" || id === "agnes-3.0-flash" || id.startsWith("agnes-2") || id.startsWith("agnes-3");
}
export function isAgnesImageModel(id: string): boolean {
  return id.startsWith("agnes-image-");
}
export function isAgnesVideoModel(id: string): boolean {
  return id.startsWith("agnes-video-");
}
