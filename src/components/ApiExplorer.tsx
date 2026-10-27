"use client";
import { useState } from "react";
import { Code2, Copy, Check, ChevronDown, ExternalLink, Circle, Zap, Server, ShieldAlert, Menu, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/Toast";
import { MODELS, API_HOST, AGNES_API_BASE } from "@/lib/api/config";

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
  group: "Upstream · CVRON" | "Upstream · Pesles AI" | "Bliss internal";
  params: Param[];
  example: string;
  response: string;
  capabilities: string[];
  limitation?: string;
}

const BASE = API_HOST;
const AGNES = AGNES_API_BASE;

const DOCS: EndpointDoc[] = [
  ...MODELS.map((m) => ({
    key: `chat-${m.id}`,
    name: `${m.name} completion`,
    method: (m.provider.includes("Agnes") ? "POST" : "GET") as "GET" | "POST",
    path: m.endpoint,
    group: (m.provider.includes("Agnes") ? "Upstream · Pesles AI" : "Upstream · CVRON") as EndpointDoc["group"],
    params: m.provider.includes("Agnes")
      ? [
          { name: "model", type: "string", required: true, desc: `Model ID: ${m.id}` },
          { name: "messages", type: "Message[]", required: true, desc: "OpenAI-compatible messages array; supports image_url for vision when provider is Agnes" },
          { name: "stream", type: "boolean", required: false, desc: "Set true for SSE streaming (Agnes only)" },
        ]
      : [{ name: "prompt", type: "string", required: true, desc: "The full prompt. The endpoint is single-turn — it has no messages array." }],
    example: m.provider.includes("Agnes")
      ? `curl ${AGNES}/chat/completions \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "${m.id}",\n    "messages": [{ "role": "user", "content": "Explain gravity simply" }],\n    "stream": true\n  }'`
      : `curl "${m.endpoint}?prompt=Explain%20gravity%20simply"`,
    response: m.provider.includes("Agnes")
      ? `// Streaming SSE:\ndata: {"token": "Gravity is "}\ndata: {"token": "the pull between masses…"}\ndata: [DONE]`
      : `{\n  "success": true,\n  "response": "Gravity is the pull between masses…",\n  "prompt": "Explain gravity simply",\n  "author": "@cvroon"\n}`,
    capabilities: m.capabilities,
    limitation: m.provider.includes("Agnes") ? "Agnes free tier 20 RPM; 401→perm bench, 429→60s bench, 402→1h bench." : "No streaming, no native conversation context, no system message. Bliss compresses your last 6 turns into the prompt.",
  })),
  {
    key: "image-flux",
    name: "Flux Dev image generation (CVRON)",
    method: "GET",
    path: `${BASE}/cvronai/flux-dev.php`,
    group: "Upstream · CVRON",
    params: [{ name: "prompt", type: "string", required: true, desc: "Image description. Bliss appends style and aspect-ratio hints." }],
    example: `curl "${BASE}/cvronai/flux-dev.php?prompt=A%20cinematic%20futuristic%20city%20at%20dusk"`,
    response: `{\n  "success": true,\n  "image_url": "https://dbuzz-assets.s3.amazonaws.com/wcimage/gi/image-1788019211294.jpg",\n  "author": "@cvroon"\n}`,
    capabilities: ["Text-to-Image"],
    limitation: "One image per call, no seed, no size parameter. Returned URLs are temporary third-party hosting.",
  },
  {
    key: "image-agnes",
    name: "Agnes Image 2.1 Flash generation",
    method: "POST",
    path: `${AGNES}/images/generations`,
    group: "Upstream · Pesles AI",
    params: [
      { name: "model", type: "string", required: true, desc: "agnes-image-2.1-flash or agnes-image-2.5-flash" },
      { name: "prompt", type: "string", required: true, desc: "Text instruction for generation/editing" },
      { name: "size", type: "string", required: true, desc: "1K/2K/3K/4K tier (also accepts legacy 1024x768 but normalized)" },
      { name: "ratio", type: "string", required: false, desc: "1:1,16:9,9:16,3:4,4:3,2:3,3:2,21:9 default 1:1" },
      { name: "extra_body.image", type: "string[]", required: false, desc: "Image URLs or base64 data URIs for image-to-image (must be in extra_body)" },
      { name: "extra_body.response_format", type: "string", required: false, desc: "url or b64_json — MUST be in extra_body, not top-level" },
    ],
    example: `curl ${AGNES}/images/generations \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -d '{\n    "model": "agnes-image-2.1-flash",\n    "prompt": "A luminous city above a canyon, cinematic realism",\n    "size": "2K",\n    "ratio": "16:9",\n    "extra_body": { "response_format": "url" }\n  }'\n// → { data: [{ url: "https://..." }] }`,
    response: `{\n  "data": [{ "url": "https://.../image.jpg" }]\n}`,
    capabilities: ["Text-to-Image", "Image-to-Image", "Multi-image", "4K"],
    limitation: "response_format must be nested in extra_body; size tiers normalized to exact pixels; 1/min for 3K/4K.",
  },
  {
    key: "image-edit",
    name: "Image to image editing (CVRON)",
    method: "GET",
    path: `${BASE}/cvronai/image2image.php`,
    group: "Upstream · CVRON",
    params: [
      { name: "prompt", type: "string", required: true, desc: "The edit to apply" },
      { name: "image_url", type: "url", required: true, desc: "A publicly reachable source image URL — binary uploads are not accepted" },
    ],
    example: `curl "${BASE}/cvronai/image2image.php?prompt=Make%20it%20watercolor&image_url=https://example.com/a.jpg"`,
    response: `{\n  "success": true,\n  "image_url": "https://…/edited-1788019211294.jpg",\n  "author": "@cvroon"\n}`,
    capabilities: ["Image Editing"],
    limitation: "Source must already be public. Bliss cannot upload local files for the upstream to fetch.",
  },
  {
    key: "video-agnes",
    name: "Agnes Video V2.0 async generation",
    method: "POST",
    path: `${AGNES}/videos`,
    group: "Upstream · Pesles AI",
    params: [
      { name: "model", type: "string", required: true, desc: "agnes-video-v2.0 or agnes-video-2.5" },
      { name: "prompt", type: "string", required: true, desc: "Motion description; use <Picture N> refs in reference mode" },
      { name: "image", type: "string", required: false, desc: "Single image URL for image-to-video" },
      { name: "extra_body.image", type: "string[]", required: false, desc: "Multiple URLs/base64 for keyframe animation + mode:keyframes" },
      { name: "num_frames", type: "integer", required: false, desc: "Must be ≤441 and 8n+1 (81,121,…,441) — server snaps automatically" },
      { name: "width", type: "integer", required: false, desc: "Default 1152, snapped to 480p/720p/1080p tiers" },
    ],
    example: `curl -X POST ${AGNES}/videos \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -d '{\n    "model": "agnes-video-v2.0",\n    "prompt": "Cinematic cat on beach at sunset, gentle waves",\n    "height": 768, "width": 1152, "num_frames": 121, "frame_rate": 24\n  }'\n// → { video_id: "vid_..." }\n// Poll: GET https://apihub.agnes-ai.com/agnesapi?video_id=vid_...`,
    response: `{\n  "video_id": "vid_abc123",\n  "status": "queued"\n}\n// polling GET returns: { status: "completed", video_url: "https://...mp4" }`,
    capabilities: ["Text-to-Video", "Image-to-Video", "Keyframe", "Async polling"],
    limitation: "Free tier 1/min video; tasks account-scoped — polling must use same key that created task.",
  },
  {
    key: "image-host",
    name: "FileBin image host",
    method: "GET",
    path: `${BASE}/cvronai/up.php`,
    group: "Upstream · CVRON",
    params: [{ name: "url", type: "url", required: true, desc: "Image URL to re-host" }],
    example: `curl "${BASE}/cvronai/up.php?url=https://example.com/a.jpg"`,
    response: `// Response shape is not documented; Bliss parses url | image_url | link | data,`,
    capabilities: ["Hosting"],
    limitation: "Undocumented response format — Bliss validates the parsed URL before using it.",
  },
  {
    key: "video-wan",
    name: "WAN 2.2 image to video",
    method: "GET",
    path: `${BASE}/cvronai/wan22.php`,
    group: "Upstream · CVRON",
    params: [
      { name: "prompt", type: "string", required: true, desc: "Motion description" },
      { name: "image", type: "url", required: true, desc: "Source frame URL" },
    ],
    example: `curl "${BASE}/cvronai/wan22.php?prompt=Moving%20clouds&image=https://example.com/sky.jpg"`,
    response: `{\n  "success": true,\n  "videoUrl": "https://strshrt.xyz/videos/60f3c5eb-3d75-4d8d-83b3-f1a723fd239e.mp4",\n  "author": "@cvroon"\n}`,
    capabilities: ["Image-to-Video"],
    limitation: "Synchronous only: there is no job id, no status endpoint and no callback. Long requests can hit the platform timeout, so Bliss caps them at 290s and reports failures truthfully.",
  },
  {
    key: "chat-route",
    name: "Bliss chat proxy (with streaming)",
    method: "POST",
    path: "/api/chat",
    group: "Bliss internal",
    params: [
      { name: "model", type: "ModelId", required: true, desc: "7 verified chat ids: llama | gpt-5-nano | gemini-2.5-flash-lite | deepseek-v3.2 | agnes-2.0-flash | agnes-2.5-flash | agnes-3.0-flash" },
      { name: "prompt", type: "string", required: true, desc: "User message, max 4000 chars" },
      { name: "history", type: "Message[]", required: false, desc: "Prior turns; last 8 folded or sent as messages for Agnes" },
      { name: "images", type: "string[]", required: false, desc: "Base64 data URIs or URLs for Agnes vision (max 4, 2048px)" },
      { name: "stream", type: "boolean", required: false, desc: "true → SSE streaming (Agnes only)" },
    ],
    example: `fetch("/api/chat", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },\n  body: JSON.stringify({ model: "agnes-2.0-flash", prompt: "Hello!", history: [], stream: true })\n}) // → SSE: data: {"token":"Hi"}`,
    response: `// JSON fallback:\n{ "success": true, "response": "Hey! What can I help you build?", "model": "agnes-2.0-flash" }\n// Streaming: text/event-stream with data: {"token":"..."}`,
    capabilities: ["Streaming (Agnes)", "Rate limited 20/min/IP", "Key pool rotation + bench", "Vision"],
    limitation: "Agnes requires AGNES_API_KEY_1; CVRON needs no key. Frontend never sees keys.",
  },
  {
    key: "image-route",
    name: "Bliss image route (unified)",
    method: "POST",
    path: "/api/image",
    group: "Bliss internal",
    params: [
      { name: "model", type: "string", required: false, desc: "flux-dev or agnes-image-2.1-flash/2.5-flash (default agnes when keys present)" },
      { name: "prompt", type: "string", required: true, desc: "Max 2000 chars" },
      { name: "size", type: "string", required: false, desc: "1K/2K/3K/4K for Agnes (extra_body tier)" },
      { name: "ratio", type: "string", required: false, desc: "1:1,16:9 etc for Agnes" },
      { name: "images", type: "string[]", required: false, desc: "URLs or base64 data URIs — sent as extra_body.image for Agnes" },
      { name: "imageUrl", type: "url", required: false, desc: "Single URL for edit/back-compat" },
    ],
    example: `fetch("/api/image", {\n  method: "POST",\n  body: JSON.stringify({ prompt: "A blue planet", model: "agnes-image-2.1-flash", size: "2K", ratio: "16:9", images: ["data:image/..."] })\n})`,
    response: `{ "success": true, "imageUrl": "https://…/image.jpg", "model": "agnes-image-2.1-flash", "provider": "agnes" }`,
    capabilities: ["SSRF-safe checks", "extra_body.response_format url handling"],
  },
  {
    key: "video-route",
    name: "Bliss video route (async for Agnes)",
    method: "POST",
    path: "/api/video",
    group: "Bliss internal",
    params: [
      { name: "prompt", type: "string", required: true, desc: "Motion description" },
      { name: "model", type: "string", required: false, desc: "wan-2.2 or agnes-video-v2.0/v2.5" },
      { name: "images", type: "string[]", required: false, desc: "1 = image-to-video, 2+ = keyframes (extra_body.image + mode:keyframes)" },
      { name: "num_frames", type: "integer", required: false, desc: "81,121,…,441 (8n+1 snapped)" },
    ],
    example: `fetch("/api/video", { method: "POST", body: JSON.stringify({ prompt: "Drifting clouds", imageUrl: "https://…/sky.jpg", model: "agnes-video-v2.0" }) })\n// → { success:true, videoId:"vid_...", pollUrl:"/api/video/vid_..." }`,
    response: `// POST creates task:\n{ "success": true, "videoId": "vid_123", "status": "queued" }\n// GET /api/video/:id polls:\n{ "success": true, "status": "completed", "videoUrl": "https://...mp4" }`,
    capabilities: ["Async polling every 5s", "8n+1 snap", "Same-key polling"],
  },
  {
    key: "health-route",
    name: "Bliss health probe",
    method: "GET",
    path: "/api/health",
    group: "Bliss internal",
    params: [],
    example: `fetch("/api/health").then(r => r.json())`,
    response: `{ "status": "operational", "services": { "text": { "reachable": true, "latency": 812 } } }`,
    capabilities: ["Diagnostics", "Key pool stats"],
  },
  {
    key: "models-route",
    name: "Bliss model catalogue",
    method: "GET",
    path: "/api/models",
    group: "Bliss internal",
    params: [],
    example: `fetch("/api/models").then(r => r.json())`,
    response: `{ "success": true, "text": [...7], "image": [...3], "video": [...3], "agnes": { "configured": true } }`,
    capabilities: ["Discovery"],
    limitation: "Static verified config — providers expose no list endpoint.",
  },
];

export function ApiExplorer({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const [open, setOpen] = useState<string | null>("chat-agnes-2.0-flash");
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "Upstream · CVRON" | "Upstream · Pesles AI" | "Bliss internal">("all");

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
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Code2 className="h-4 w-4 text-[#2563EB]" /> API Explorer
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">CVRON + Pesles AI (Agnes) — every integration Bliss uses</p>
        </div>
        <div className="flex gap-2">
          <a href="https://github.com/cvroon-api/FreeAiAPIs" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5 hidden sm:flex">
              <ExternalLink className="h-3.5 w-3.5" /> CVRON
            </Button>
          </a>
          <a href="https://agnes-ai.com/doc/overview" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Agnes Docs
            </Button>
          </a>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
          <div className="flex items-start gap-2 rounded-xl border border-[#2563EB]/20 bg-[#EFF6FF] px-3.5 py-3 text-xs leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>Pesles AI (Agnes):</b> Requires server-side AGNES_API_KEY_n — Bliss proxies every call so keys never reach the browser. Key pool rotates round-robin, benches 429/60s, 402/1h, 401 perm. Video polling uses same key.
              <br /><b>CVRON:</b> Free key-less public API — no secrets, but rate-limited and occasionally offline.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "Upstream · CVRON", "Upstream · Pesles AI", "Bliss internal"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === f ? "border-transparent brand-gradient text-white" : "hover:bg-slate-50 dark:hover:bg-white/5")}>
                {f === "Upstream · CVRON" ? <Zap className="h-3 w-3" /> : f === "Upstream · Pesles AI" ? <Sparkles className="h-3 w-3" /> : f === "Bliss internal" ? <Server className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                {f}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {list.map((d) => {
              const isOpen = open === d.key;
              return (
                <Card key={d.key} className={cn("overflow-hidden transition", isOpen && "border-[#2563EB]/25 shadow-[0_16px_44px_-24px_rgba(37,99,235,0.55)]")}>
                  <button onClick={() => setOpen(isOpen ? null : d.key)} className="flex w-full items-center gap-3 p-3.5 text-left">
                    <span className={cn("rounded-lg px-2 py-1 font-mono text-[10px] font-bold", d.method === "GET" ? "bg-[#22C55E]/12 text-[#16A34A]" : "bg-[#2563EB]/12 text-[#2563EB]")}>
                      {d.method}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{d.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#94A3B8]">{d.path}</p>
                    </div>
                    <Badge className={cn("hidden shrink-0 sm:inline-flex", d.group === "Bliss internal" ? "border-[#2563EB]/20 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]" : d.group === "Upstream · Pesles AI" ? "border-[#7C3AED]/20 bg-[#F5F3FF] text-[#7C3AED]" : "")}>
                      {d.group}
                    </Badge>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#94A3B8] transition-transform", isOpen && "rotate-180")} />
                  </button>

                  {isOpen && (
                    <CardContent className="space-y-3 border-t border-[rgba(148,163,184,0.1)] pt-4">
                      {d.params.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-wider text-[#94A3B8]">
                                <th className="py-1.5 pr-3 font-semibold">Parameter</th>
                                <th className="py-1.5 pr-3 font-semibold">Type</th>
                                <th className="py-1.5 pr-3 font-semibold">Required</th>
                                <th className="py-1.5 font-semibold">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.params.map((p) => (
                                <tr key={p.name} className="border-t border-[rgba(148,163,184,0.1)] align-top">
                                  <td className="py-2 pr-3 font-mono text-[#2563EB] dark:text-[#60A5FA]">{p.name}</td>
                                  <td className="py-2 pr-3 font-mono text-[11px] text-[#94A3B8]">{p.type}</td>
                                  <td className="py-2 pr-3">{p.required ? <span className="text-[#16A34A]">yes</span> : <span className="text-[#94A3B8]">no</span>}</td>
                                  <td className="py-2 text-[#94A3B8]">{p.desc}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <CodeBlock title="Example request" code={d.example} onCopy={() => copy(d.example, `${d.key}-req`)} copied={copied === `${d.key}-req`} />
                      <CodeBlock title="Example response" code={d.response} onCopy={() => copy(d.response, `${d.key}-res`)} copied={copied === `${d.key}-res`} />

                      <div className="flex flex-wrap gap-1.5">
                        {d.capabilities.map((c) => (
                          <Badge key={c}>{c}</Badge>
                        ))}
                      </div>

                      {d.limitation && (
                        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
                          <Circle className="mt-1 h-2.5 w-2.5 shrink-0 text-[#F59E0B]" />
                          <span><strong className="font-semibold">Known limitation:</strong> {d.limitation}</span>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="border-[#7C3AED]/20 bg-[#F5F3FF] dark:bg-[#7C3AED]/10">
            <CardContent className="text-xs leading-relaxed text-[#94A3B8]">
              <strong className="text-slate-700 dark:text-slate-200">Deploying — Pesles AI (Agnes) setup:</strong>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-2 font-mono text-[11px] dark:bg-[#0B1220]">{`cp .env.example .env\n# add as many as you want, server auto-detects\nAGNES_API_KEY_1=sk-...\nAGNES_API_KEY_2=sk-...\nAGNES_API_KEY_3=sk-...\n# or comma-separated / single:\nAGNES_API_KEYS=sk-...,sk-...\nAGNES_API_KEY=sk-...\n\nnpm install\nnpm start # → http://localhost:3000`}</pre>
              <p className="mt-2">Deploy anywhere Node 18+ runs (Vercel, Render, Fly.io). Set AGNES_API_KEY on host, point Pesles AI DNS at it, enable HTTPS. $0 promo pricing may change.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ title, code, onCopy, copied }: { title: string; code: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 dark:bg-white/[0.04]">
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{title}</span>
        <button onClick={onCopy} className="flex items-center gap-1 text-[11px] text-[#94A3B8] hover:text-[#2563EB]">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:bg-[#0B1220] dark:text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
