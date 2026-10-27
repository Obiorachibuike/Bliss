"use client";
import { useState } from "react";
import {
  Code2,
  Copy,
  Check,
  ChevronDown,
  ExternalLink,
  Circle,
  Zap,
  Server,
  ShieldAlert,
  Menu,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/Toast";
import {
  API_HOST,
  MODELS,
  AGNES_BASE_URL,
  AGNES_LIMITS,
  RATIOS,
} from "@/lib/api/config";
import { useFallbackStatus } from "@/lib/hooks/useModelCatalog";

interface Param {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}
interface EndpointDoc {
  key: string;
  name: string;
  method: "GET" | "POST";
  path: string;
  group: "Upstream · CVRON" | "Upstream · Agnes" | "Bliss internal";
  params: Param[];
  example: string;
  response: string;
  capabilities: readonly string[];
  limitation?: string;
}

/* The Agnes status poll lives on the API host root, not under /v1. */
const AGNES_ORIGIN = new URL(AGNES_BASE_URL).origin;

/* Documented Agnes AI surface — Bliss only lists the endpoints it actually calls.
 * Every field below is taken from the provider docs; nothing here is speculative. */
const AGNES_DOCS: EndpointDoc[] = [
  {
    key: "agnes-chat",
    name: "Agnes chat completions",
    method: "POST",
    path: `${AGNES_BASE_URL}/chat/completions`,
    group: "Upstream · Agnes",
    params: [
      {
        name: "model",
        type: "string",
        required: true,
        desc: "agnes-2.5-flash (Bliss' default) | agnes-3.0-flash | agnes-2.5-pro | agnes-2.5-pro-beta",
      },
      {
        name: "messages",
        type: "{role, content}[]",
        required: true,
        desc: "Real multi-turn array: system, user and assistant turns are forwarded unflattened.",
      },
      {
        name: "temperature",
        type: "number",
        required: false,
        desc: `Bliss pins ${AGNES_LIMITS.temperature}`,
      },
      {
        name: "max_tokens",
        type: "number",
        required: false,
        desc: `Bliss pins ${AGNES_LIMITS.maxOutputTokens}`,
      },
      {
        name: "stream",
        type: "boolean",
        required: false,
        desc: "Documented, but Bliss sends stream: false and renders whole responses",
      },
    ],
    example: `curl ${AGNES_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"agnes-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}'`,
    response: `{\n  "id": "chatcmpl_xxx",\n  "choices": [{ "message": { "role": "assistant", "content": "Hi!" }, "finish_reason": "stop" }],\n  "usage": { "prompt_tokens": 24, "completion_tokens": 18, "total_tokens": 42 }\n}`,
    capabilities: ["Bearer key", "Multi-turn", "Vision via image_url"],
    limitation:
      "Requires a server-side AGNES_API_KEY. Free tier is documented around 20 executable requests/minute, so Bliss retries once and never probes it from /api/health.",
  },
  {
    key: "agnes-image",
    name: "Agnes image generations",
    method: "POST",
    path: `${AGNES_BASE_URL}/images/generations`,
    group: "Upstream · Agnes",
    params: [
      {
        name: "model",
        type: "string",
        required: true,
        desc: "agnes-image-2.0-flash | agnes-image-2.1-flash (default) | agnes-image-2.5-flash",
      },
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Generation or edit instruction",
      },
      {
        name: "size",
        type: "string",
        required: true,
        desc: "Tier: 1K | 2K | 3K | 4K — chosen in Image Studio, 1K by default",
      },
      {
        name: "ratio",
        type: "string",
        required: false,
        desc: `One of ${RATIOS.join(", ")} — Bliss forwards the studio's aspect ratio`,
      },
      {
        name: "extra_body.image",
        type: "string[]",
        required: false,
        desc: "Public URLs or data-URI images for image-to-image edits",
      },
      {
        name: "extra_body.response_format",
        type: "string",
        required: false,
        desc: `url`,
      },
    ],
    example: `curl ${AGNES_BASE_URL}/images/generations \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"agnes-image-2.1-flash","prompt":"A blue planet","size":"1K","ratio":"16:9","extra_body":{"response_format":"url"}}'`,
    response: `{\n  "created": 1780000000,\n  "data": [{ "url": "https://storage…/xxx.png", "b64_json": null }]\n}`,
    capabilities: ["Text-to-Image", "Image-to-Image", "Aspect ratios"],
    limitation:
      "response_format must live inside extra_body; Bliss reads only data[0].url and rejects base64 output rather than pasting it into an <img> tag.",
  },
  {
    key: "agnes-video",
    name: "Agnes video generation",
    method: "POST",
    path: `${AGNES_BASE_URL}/videos`,
    group: "Upstream · Agnes",
    params: [
      {
        name: "model",
        type: "string",
        required: true,
        desc: "agnes-video-2.5-flash (720P only) | agnes-video-2.5 (720P/1080P/1K/2K, one video reference)",
      },
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Scene and camera direction",
      },
      {
        name: "mode",
        type: "string",
        required: false,
        desc: "text (default) | keyframe | reference",
      },
      {
        name: "seconds",
        type: "string",
        required: false,
        desc: '4-12, default "5" — a string, not a number',
      },
      {
        name: "size / aspect_ratio",
        type: "string",
        required: false,
        desc: "720P|1080P|1K|2K and 16:9 | 21:9 | 4:3 | 1:1 | 3:4 | 9:16",
      },
      {
        name: "first_frame / last_frame",
        type: "string",
        required: false,
        desc: "keyframe mode only; images/audios/videos must stay empty",
      },
      {
        name: "images / audios / videos",
        type: "array",
        required: false,
        desc: "reference mode only; video references need agnes-video-2.5",
      },
      {
        name: "n",
        type: "number",
        required: false,
        desc: "Fixed at 1 — the provider rejects other values",
      },
    ],
    example: `const body = {\n  model: "agnes-video-2.5-flash",\n  prompt: "Macro shot of coffee being poured",\n  mode: "text",\n  seconds: "8",\n  size: "720P",\n  aspect_ratio: "16:9",\n  n: 1,\n};\nawait fetch(\`${AGNES_BASE_URL}/videos\`, {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.AGNES_API_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(body),\n});`,
    response: `{\n  "id": "task_01abc",\n  "video_id": "video_02def",\n  "object": "video",\n  "model": "agnes-video-2.5-flash",\n  "status": "queued",\n  "progress": 0,\n  "seconds": "8"\n}`,
    capabilities: [
      "Returns a job — never the video itself",
      "Bearer auth, server-side only",
      "width/height/fps/num_frames/quality/steps are rejected",
    ],
    limitation:
      "Agnes bills agnes-video-2.5 per second of output ($0.025/s at 720P up to $0.055/s at 2K, plus $0.005 per image from the sixth, and input-video seconds count towards billable duration); agnes-video-2.5-flash at 720P is listed at $0 for a limited time. Bliss passes your key through and stores nothing.",
  },
  {
    key: "agnes-video-status",
    name: "Agnes video status poll",
    method: "GET",
    path: `${AGNES_ORIGIN}/agnesapi?video_id=…&model_name=…`,
    group: "Upstream · Agnes",
    params: [
      {
        name: "video_id",
        type: "string",
        required: true,
        desc: "video_id from the create response, falling back to id",
      },
      {
        name: "model_name",
        type: "string",
        required: true,
        desc: "Required for keyframe/reference jobs; Bliss always sends it",
      },
    ],
    example: `const url = new URL("https://apihub.agnes-ai.com/agnesapi");\nurl.searchParams.set("video_id", job.jobId);\nurl.searchParams.set("model_name", job.model);\nconst poll = await fetch(url, {\n  headers: { Authorization: \`Bearer \${process.env.AGNES_API_KEY}\` },\n});`,
    response: `{\n  "status": "in_progress",\n  "progress": 42,\n  "url": null,\n  "error": null\n} → { "status": "completed", "url": "https://…/clip.mp4" }`,
    capabilities: [
      "GET with no body, on the host root — not under /v1",
      "Read the top-level url; ignore internal_* fields",
      "Poll every 1-2s until completed or failed",
    ],
    limitation:
      "Bliss proxies this poll so the key stays server-side and lets the browser drive the loop — a platform timeout can't strand a job at 90 seconds.",
  },
];

const BASE = API_HOST;

const DOCS: EndpointDoc[] = [
  ...AGNES_DOCS,
  ...MODELS.map((m) => ({
    key: `chat-${m.id}`,
    name: `${m.name} completion`,
    method: "GET" as const,
    path: m.endpoint,
    group: "Upstream · CVRON" as const,
    params: [
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "The full prompt. The endpoint is single-turn — it has no messages array.",
      },
    ],
    example: `curl "${m.endpoint}?prompt=Explain%20gravity%20simply"`,
    response: `{\n  "success": true,\n  "response": "Gravity is the pull between masses…",\n  "prompt": "Explain gravity simply",\n  "author": "@cvroon"\n}`,
    capabilities: m.capabilities,
    limitation:
      "No streaming, no native conversation context, no system message. Bliss compresses your last 6 turns into the prompt.",
  })),
  {
    key: "image-flux",
    name: "Flux Dev image generation",
    method: "GET",
    path: `${BASE}/cvronai/flux-dev.php`,
    group: "Upstream · CVRON",
    params: [
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Image description. Bliss appends style and aspect-ratio hints.",
      },
    ],
    example: `curl "${BASE}/cvronai/flux-dev.php?prompt=A%20cinematic%20futuristic%20city%20at%20dusk"`,
    response: `{\n  "success": true,\n  "image_url": "https://dbuzz-assets.s3.amazonaws.com/wcimage/gi/image-1788019211294.jpg",\n  "author": "@cvroon"\n}`,
    capabilities: ["Text-to-Image"],
    limitation:
      "One image per call, no seed, no size parameter. Returned URLs are temporary third-party hosting.",
  },
  {
    key: "image-edit",
    name: "Image to image editing",
    method: "GET",
    path: `${BASE}/cvronai/image2image.php`,
    group: "Upstream · CVRON",
    params: [
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "The edit to apply",
      },
      {
        name: "image_url",
        type: "url",
        required: true,
        desc: "A publicly reachable source image URL — binary uploads are not accepted",
      },
    ],
    example: `curl "${BASE}/cvronai/image2image.php?prompt=Make%20it%20watercolor&image_url=https://example.com/a.jpg"`,
    response: `{\n  "success": true,\n  "image_url": "https://…/edited-1788019211294.jpg",\n  "author": "@cvroon"\n}`,
    capabilities: ["Image Editing"],
    limitation:
      "Source must already be public. Bliss cannot upload local files for the upstream to fetch.",
  },
  {
    key: "image-host",
    name: "FileBin image host",
    method: "GET",
    path: `${BASE}/cvronai/up.php`,
    group: "Upstream · CVRON",
    params: [
      {
        name: "url",
        type: "url",
        required: true,
        desc: "Image URL to re-host",
      },
    ],
    example: `curl "${BASE}/cvronai/up.php?url=https://example.com/a.jpg"`,
    response: `// Response shape is not documented; Bliss parses url | image_url | link | data,\n// falling back to a plain-text URL body.`,
    capabilities: ["Hosting"],
    limitation:
      "Undocumented response format — Bliss validates the parsed URL before using it.",
  },
  {
    key: "video-wan",
    name: "WAN 2.2 image to video",
    method: "GET",
    path: `${BASE}/cvronai/wan22.php`,
    group: "Upstream · CVRON",
    params: [
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Motion description",
      },
      { name: "image", type: "url", required: true, desc: "Source frame URL" },
    ],
    example: `curl "${BASE}/cvronai/wan22.php?prompt=Moving%20clouds&image=https://example.com/sky.jpg"`,
    response: `{\n  "success": true,\n  "videoUrl": "https://strshrt.xyz/videos/60f3c5eb-3d75-4d8d-83b3-f1a723fd239e.mp4",\n  "author": "@cvroon"\n}`,
    capabilities: ["Image-to-Video"],
    limitation:
      "Synchronous only: there is no job id, no status endpoint and no callback. Long requests can hit the platform timeout, so Bliss caps them at 290s and reports failures truthfully.",
  },
  {
    key: "chat-route",
    name: "Bliss chat proxy",
    method: "POST",
    path: "/api/chat",
    group: "Bliss internal",
    params: [
      {
        name: "model",
        type: "ModelId",
        required: true,
        desc: "llama | gpt-5-nano | gemini-2.5-flash-lite | deepseek-v3.2, or an Agnes id (agnes-2.5-flash, agnes-3.0-flash, agnes-2.5-pro, agnes-2.5-pro-beta) — validated against a fixed allow-list",
      },
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "User message, max 8000 chars",
      },
      {
        name: "history",
        type: "Message[]",
        required: false,
        desc: "Prior turns; the last 6 are folded into a single prompt",
      },
    ],
    example: `fetch("/api/chat", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    model: "llama",\n    prompt: "Hello!",\n    history: [{ role: "user", content: "Hi" }],\n  }),\n})`,
    response: `{\n  "success": true,\n  "response": "Hey! What can I help you build?",\n  "model": "llama",\n  "answeredBy": "agnes-2.5-flash",\n  "provider": "agnes",\n  "fallbackUsed": true\n}`,
    capabilities: [
      "Rate limited",
      "Input validation",
      "Retries",
      "Timeouts",
      "Automatic fallback",
    ],
    limitation:
      "20 requests / minute / IP. On primary failure the route retries the same turn against Agnes AI with a real messages array (and the pasted image as image_url when vision is on). Successes carry provider + fallbackUsed; failures return 502 with a friendly message and the raw error only in development.",
  },
  {
    key: "image-route",
    name: "Bliss image route",
    method: "POST",
    path: "/api/image",
    group: "Bliss internal",
    params: [
      {
        name: "mode",
        type: '"generate" | "edit"',
        required: false,
        desc: "Defaults to generate",
      },
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Max 1000 characters",
      },
      {
        name: "imageUrl",
        type: "url",
        required: false,
        desc: "Required for edit; http/https only",
      },
    ],
    example: `fetch("/api/image", {\n  method: "POST",\n  body: JSON.stringify({ mode: "generate", prompt: "A blue planet" }),\n})`,
    response: `{ "success": true, "imageUrl": "https://…/image.jpg", "model": "flux-dev", "provider": "cvron", "fallbackUsed": false }`,
    capabilities: [
      "SSRF-safe URL checks",
      "Timeout 90s / 120s",
      "Automatic fallback",
    ],
    limitation:
      "Accepts an optional model (flux-dev | agnes-image-2.1-flash) and ratio. An explicit Agnes choice is never answered by the key-less provider.",
  },
  {
    key: "video-route",
    name: "Bliss video route",
    method: "POST",
    path: "/api/video",
    group: "Bliss internal",
    params: [
      {
        name: "prompt",
        type: "string",
        required: true,
        desc: "Motion or scene description",
      },
      {
        name: "model",
        type: "string",
        required: false,
        desc: "wan-2.2 (default, synchronous image-to-video) | agnes-video-2.5-flash | agnes-video-2.5",
      },
      {
        name: "imageUrl",
        type: "url",
        required: false,
        desc: "Required for wan-2.2; http/https only",
      },
      {
        name: "mode",
        type: "string",
        required: false,
        desc: "Agnes only: text (default) | keyframe | reference — derived from the media you send if omitted",
      },
      {
        name: "seconds / size / aspectRatio / seed",
        type: "string",
        required: false,
        desc: "Agnes only: 4-12s, 720P/1080P/1K/2K, 16:9 · 21:9 · 4:3 · 1:1 · 3:4 · 9:16",
      },
      {
        name: "firstFrameUrl / lastFrameUrl",
        type: "url",
        required: false,
        desc: "Agnes keyframe mode",
      },
      {
        name: "images / audios / referenceVideoUrl",
        type: "url[]",
        required: false,
        desc: "Agnes reference mode; the video reference needs agnes-video-2.5",
      },
    ],
    example: `fetch("/api/video", {\n  method: "POST",\n  body: JSON.stringify({\n    prompt: "Camera drifts over a neon city at night",\n    model: "agnes-video-2.5-flash",\n    seconds: "8",\n    size: "720P",\n    aspectRatio: "16:9",\n  }),\n})`,
    response: `Synchronous (wan-2.2):\n{ "success": true, "async": false, "videoUrl": "https://…/clip.mp4", "provider": "cvron" }\n\nAsynchronous (Agnes):\n{ "success": true, "async": true, "jobId": "video_8f1c…", "model": "agnes-video-2.5-flash", "status": "queued", "progress": 0, "pollIntervalMs": 2000 }`,
    capabilities: [
      "Two shapes on purpose: key-less providers are synchronous, Agnes is a job",
      "maxDuration 300s",
      "6 create requests / min / IP",
    ],
    limitation:
      "An Agnes video is never answered by the key-less provider, so choosing an Agnes model without a key is a clear error rather than a silent downgrade.",
  },
  {
    key: "video-status-route",
    name: "Bliss video status poll",
    method: "GET",
    path: "/api/video?jobId=…&model=…",
    group: "Bliss internal",
    params: [
      {
        name: "jobId",
        type: "string",
        required: true,
        desc: "The video_id returned by POST /api/video",
      },
      {
        name: "model",
        type: "string",
        required: true,
        desc: "The model the job was created with — the provider requires it when polling",
      },
    ],
    example: `const job = await res.json();\nlet out;\ndo {\n  await new Promise((r) => setTimeout(r, job.pollIntervalMs));\n  out = await fetch(\n    \`/api/video?jobId=\${job.jobId}&model=\${job.model}\`,\n  ).then((r) => r.json());\n} while (out.success && !["completed", "failed"].includes(out.status));`,
    response: `{ "success": true, "jobId": "video_8f1c…", "status": "in_progress", "progress": 42 } → { "success": true, "status": "completed", "videoUrl": "https://…/clip.mp4" }`,
    capabilities: [
      "The browser owns the loop",
      "90 polls / min / IP",
      "No server timer, no webhook",
    ],
  },
  {
    key: "health-route",
    name: "Bliss health probe",
    method: "GET",
    path: "/api/health",
    group: "Bliss internal",
    params: [],
    example: `fetch("/api/health").then(r => r.json())`,
    response: `{ "status": "operational", "services": { "text": { "reachable": true, "latency": 812 }, "image": { "reachable": true, "latency": 2140 } } }`,
    capabilities: ["Diagnostics"],
  },
  {
    key: "models-route",
    name: "Bliss model catalogue",
    method: "GET",
    path: "/api/models",
    group: "Bliss internal",
    params: [],
    example: `fetch("/api/models").then(r => r.json())`,
    response: `{ "success": true, "text": [...], "image": [...], "video": [...], "limitations": {...} }`,
    capabilities: ["Discovery"],
    limitation:
      "A static verified configuration — the provider exposes no model-list endpoint of its own.",
  },
];

export function ApiExplorer({
  onOpenMobileNav,
}: {
  onOpenMobileNav: () => void;
}) {
  const [open, setOpen] = useState<string | null>("chat-llama");
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "Upstream · CVRON" | "Upstream · Agnes" | "Bliss internal"
  >("all");
  // Read from /api/models at runtime: the key itself never reaches the browser bundle.
  const fallback = useFallbackStatus();

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 1400);
  };

  const list = DOCS.filter((d) => filter === "all" || d.group === filter);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button
          onClick={onOpenMobileNav}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Code2 className="h-4 w-4 text-[#2563EB]" /> API Explorer
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">
            Every integration Bliss uses, verified against the source repo
          </p>
        </div>
        <a
          href="https://github.com/cvroon-api/FreeAiAPIs"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="sm" variant="outline" className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />{" "}
            <span className="hidden sm:inline">Source repo</span>
          </Button>
        </a>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
          <div className="flex items-start gap-2 rounded-xl border border-[#2563EB]/20 bg-[#EFF6FF] px-3.5 py-3 text-xs leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              The primary provider is free and key-less — no credential of yours
              is ever sent to it. Bliss still keeps every call on the server so
              the browser never talks to an upstream directly, and adds
              validation, timeouts, retries and per-IP rate limits.{" "}
              {fallback.enabled
                ? "The Agnes provider is enabled: its key stays in the server environment and never reaches the client bundle. Chat, image and video models from this provider are selectable in the UI."
                : "Set AGNES_API_KEY to enable the documented Agnes AI provider — chat, vision, image editing and asynchronous video — as a fallback when the free upstream fails or when you pick one of its models."}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                "all",
                "Upstream · CVRON",
                "Upstream · Agnes",
                "Bliss internal",
              ] as const
            ).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  filter === f
                    ? "border-transparent brand-gradient text-white"
                    : "hover:bg-slate-50 dark:hover:bg-white/5",
                )}
              >
                {f === "Upstream · CVRON" ? (
                  <Zap className="h-3 w-3" />
                ) : f === "Bliss internal" ? (
                  <Server className="h-3 w-3" />
                ) : f === "Upstream · Agnes" ? (
                  <Layers className="h-3 w-3" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                {f}
                {f === "Upstream · Agnes" && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                      fallback.enabled
                        ? "bg-[#22C55E]/15 text-[#16A34A]"
                        : "bg-slate-100 text-[#94A3B8] dark:bg-white/10",
                    )}
                  >
                    {fallback.enabled ? "on" : "needs key"}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {list.map((d) => {
              const isOpen = open === d.key;
              return (
                <Card
                  key={d.key}
                  className={cn(
                    "overflow-hidden transition",
                    isOpen &&
                      "border-[#2563EB]/25 shadow-[0_16px_44px_-24px_rgba(37,99,235,0.55)]",
                  )}
                >
                  <button
                    onClick={() => setOpen(isOpen ? null : d.key)}
                    className="flex w-full items-center gap-3 p-3.5 text-left"
                  >
                    <span
                      className={cn(
                        "rounded-lg px-2 py-1 font-mono text-[10px] font-bold",
                        d.method === "GET"
                          ? "bg-[#22C55E]/12 text-[#16A34A]"
                          : "bg-[#2563EB]/12 text-[#2563EB]",
                      )}
                    >
                      {d.method}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{d.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#94A3B8]">
                        {d.path}
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        "hidden shrink-0 sm:inline-flex",
                        d.group === "Bliss internal" &&
                          "border-[#2563EB]/20 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]",
                      )}
                    >
                      {d.group}
                    </Badge>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-[#94A3B8] transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {isOpen && (
                    <CardContent className="space-y-3 border-t border-[rgba(148,163,184,0.1)] pt-4">
                      {d.params.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                                <th className="py-1.5 pr-3 font-semibold">
                                  Parameter
                                </th>
                                <th className="py-1.5 pr-3 font-semibold">
                                  Type
                                </th>
                                <th className="py-1.5 pr-3 font-semibold">
                                  Required
                                </th>
                                <th className="py-1.5 font-semibold">
                                  Description
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.params.map((p) => (
                                <tr
                                  key={p.name}
                                  className="border-t border-[rgba(148,163,184,0.1)] align-top"
                                >
                                  <td className="py-2 pr-3 font-mono text-[#2563EB] dark:text-[#60A5FA]">
                                    {p.name}
                                  </td>
                                  <td className="py-2 pr-3 font-mono text-[11px] text-[#94A3B8]">
                                    {p.type}
                                  </td>
                                  <td className="py-2 pr-3">
                                    {p.required ? (
                                      <span className="text-[#16A34A]">
                                        yes
                                      </span>
                                    ) : (
                                      <span className="text-[#94A3B8]">no</span>
                                    )}
                                  </td>
                                  <td className="py-2 text-[#94A3B8]">
                                    {p.desc}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <CodeBlock
                        title="Example request"
                        code={d.example}
                        onCopy={() => copy(d.example, `${d.key}-req`)}
                        copied={copied === `${d.key}-req`}
                      />
                      <CodeBlock
                        title="Example response"
                        code={d.response}
                        onCopy={() => copy(d.response, `${d.key}-res`)}
                        copied={copied === `${d.key}-res`}
                      />

                      <div className="flex flex-wrap gap-1.5">
                        {d.capabilities.map((c) => (
                          <Badge key={c}>{c}</Badge>
                        ))}
                      </div>

                      {d.limitation && (
                        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                          <Circle className="mt-1 h-2.5 w-2.5 shrink-0 text-[#F59E0B]" />
                          <span>
                            <strong className="font-semibold">
                              Known limitation:
                            </strong>{" "}
                            {d.limitation}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="border-dashed">
            <CardContent className="text-xs leading-relaxed text-[#94A3B8]">
              <strong className="text-slate-700 dark:text-slate-200">
                Not implemented because it isn&rsquo;t documented:
              </strong>{" "}
              vision / image analysis, streaming responses, video-to-video on
              the key-less provider, embeddings and function calling. Bliss
              shows these as unavailable rather than simulating them. Text-to-
              video is supported, but only through the asynchronous Agnes
              models.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({
  title,
  code,
  onCopy,
  copied,
}: {
  title: string;
  code: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 dark:bg-white/[0.04]">
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {title}
        </span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#2563EB]"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-[#0B1220] dark:text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
