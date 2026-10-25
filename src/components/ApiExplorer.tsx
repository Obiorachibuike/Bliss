"use client";
import { useState } from "react";
import { Code2, Copy, Check, ChevronDown, ExternalLink, Circle, Zap, Server, ShieldAlert, Menu, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/Toast";
import { API_HOST, MODELS, AGNES_BASE_URL, AGNES_LIMITS, RATIOS } from "@/lib/api/config";
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
  capabilities: string[];
  limitation?: string;
}


/* Documented Agnes AI surface — Bliss only lists what it actually calls. The video
 * models of this provider are deliberately absent: their request and polling shapes
 * aren't verified here, so Bliss doesn't claim support for them. */
const AGNES_DOCS: EndpointDoc[] = [
  {
    key: "agnes-chat",
    name: "Agnes chat completions (fallback)",
    method: "POST",
    path: `${AGNES_BASE_URL}/chat/completions`,
    group: "Upstream · Agnes",
    params: [
      { name: "model", type: "string", required: true, desc: "agnes-2.5-flash (Bliss' fallback) — also agnes-3.0-flash per docs" },
      { name: "messages", type: "{role, content}[]", required: true, desc: "Real multi-turn array: system, user and assistant turns are forwarded unflattened." },
      { name: "temperature", type: "number", required: false, desc: `Bliss pins ${AGNES_LIMITS.temperature}` },
      { name: "max_tokens", type: "number", required: false, desc: `Bliss pins ${AGNES_LIMITS.maxOutputTokens}` },
      { name: "stream", type: "boolean", required: false, desc: "Documented, but Bliss sends stream: false and renders whole responses" },
    ],
    example: `curl ${AGNES_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"agnes-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}'`,
    response: `{\n  "id": "chatcmpl_xxx",\n  "choices": [{ "message": { "role": "assistant", "content": "Hi!" }, "finish_reason": "stop" }],\n  "usage": { "prompt_tokens": 24, "completion_tokens": 18, "total_tokens": 42 }\n}`,
    capabilities: ["Bearer key", "Multi-turn", "Vision via image_url"],
    limitation: "Requires a server-side AGNES_API_KEY. Free tier is documented around 20 executable requests/minute, so Bliss retries once and never probes it from /api/health.",
  },
  {
    key: "agnes-image",
    name: "Agnes image generations (fallback)",
    method: "POST",
    path: `${AGNES_BASE_URL}/images/generations`,
    group: "Upstream · Agnes",
    params: [
      { name: "model", type: "string", required: true, desc: "agnes-image-2.1-flash" },
      { name: "prompt", type: "string", required: true, desc: "Generation or edit instruction" },
      { name: "size", type: "string", required: true, desc: "Tier: 1K | 2K | 3K | 4K — Bliss uses 1K" },
      { name: "ratio", type: "string", required: false, desc: `One of ${RATIOS.join(", ")} — Bliss forwards the studio's aspect ratio` },
      { name: "extra_body.image", type: "string[]", required: false, desc: "Public URLs or data-URI images for image-to-image edits" },
      { name: "extra_body.response_format", type: "string", required: false, desc: `url` },
    ],
    example: `curl ${AGNES_BASE_URL}/images/generations \\\n  -H "Authorization: Bearer $AGNES_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"agnes-image-2.1-flash","prompt":"A blue planet","size":"1K","ratio":"16:9","extra_body":{"response_format":"url"}}'`,
    response: `{\n  "created": 1780000000,\n  "data": [{ "url": "https://storage…/xxx.png", "b64_json": null }]\n}`,
    capabilities: ["Text-to-Image", "Image-to-Image", "Aspect ratios"],
    limitation: "response_format must live inside extra_body; Bliss reads only data[0].url and rejects base64 output rather than pasting it into an <img> tag.",
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
    params: [{ name: "prompt", type: "string", required: true, desc: "The full prompt. The endpoint is single-turn — it has no messages array." }],
    example: `curl "${m.endpoint}?prompt=Explain%20gravity%20simply"`,
    response: `{\n  "success": true,\n  "response": "Gravity is the pull between masses…",\n  "prompt": "Explain gravity simply",\n  "author": "@cvroon"\n}`,
    capabilities: m.capabilities,
    limitation: "No streaming, no native conversation context, no system message. Bliss compresses your last 6 turns into the prompt.",
  })),
  {
    key: "image-flux",
    name: "Flux Dev image generation",
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
    key: "image-edit",
    name: "Image to image editing",
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
    key: "image-host",
    name: "FileBin image host",
    method: "GET",
    path: `${BASE}/cvronai/up.php`,
    group: "Upstream · CVRON",
    params: [{ name: "url", type: "url", required: true, desc: "Image URL to re-host" }],
    example: `curl "${BASE}/cvronai/up.php?url=https://example.com/a.jpg"`,
    response: `// Response shape is not documented; Bliss parses url | image_url | link | data,\n// falling back to a plain-text URL body.`,
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
    name: "Bliss chat proxy",
    method: "POST",
    path: "/api/chat",
    group: "Bliss internal",
    params: [
      { name: "model", type: "ModelId", required: true, desc: "llama | gpt-5-nano | gemini-2.5-flash-lite | deepseek-v3.2 — validated against a fixed allow-list" },
      { name: "prompt", type: "string", required: true, desc: "User message, max 8000 chars" },
      { name: "history", type: "Message[]", required: false, desc: "Prior turns; the last 6 are folded into a single prompt" },
    ],
    example: `fetch("/api/chat", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    model: "llama",\n    prompt: "Hello!",\n    history: [{ role: "user", content: "Hi" }],\n  }),\n})`,
    response: `{\n  "success": true,\n  "response": "Hey! What can I help you build?",\n  "model": "llama",\n  "answeredBy": "agnes-2.5-flash",\n  "provider": "agnes",\n  "fallbackUsed": true\n}`,
    capabilities: ["Rate limited", "Input validation", "Retries", "Timeouts", "Automatic fallback"],
    limitation: "20 requests / minute / IP. On primary failure the route retries the same turn against Agnes AI with a real messages array (and the pasted image as image_url when vision is on). Successes carry provider + fallbackUsed; failures return 502 with a friendly message and the raw error only in development.",
  },
  {
    key: "image-route",
    name: "Bliss image route",
    method: "POST",
    path: "/api/image",
    group: "Bliss internal",
    params: [
      { name: "mode", type: '"generate" | "edit"', required: false, desc: "Defaults to generate" },
      { name: "prompt", type: "string", required: true, desc: "Max 1000 characters" },
      { name: "imageUrl", type: "url", required: false, desc: "Required for edit; http/https only" },
    ],
    example: `fetch("/api/image", {\n  method: "POST",\n  body: JSON.stringify({ mode: "generate", prompt: "A blue planet" }),\n})`,
    response: `{ "success": true, "imageUrl": "https://…/image.jpg", "model": "flux-dev", "provider": "cvron", "fallbackUsed": false }`,
    capabilities: ["SSRF-safe URL checks", "Timeout 90s / 120s", "Automatic fallback"],
    limitation: "Accepts an optional model (flux-dev | agnes-image-2.1-flash) and ratio. An explicit Agnes choice is never answered by the key-less provider.",
  },
  {
    key: "video-route",
    name: "Bliss video route",
    method: "POST",
    path: "/api/video",
    group: "Bliss internal",
    params: [
      { name: "prompt", type: "string", required: true, desc: "Motion description" },
      { name: "imageUrl", type: "url", required: true, desc: "Validated http/https source image" },
    ],
    example: `fetch("/api/video", {\n  method: "POST",\n  body: JSON.stringify({ prompt: "Drifting clouds", imageUrl: "https://…/sky.jpg" }),\n})`,
    response: `{ "success": true, "videoUrl": "https://…/clip.mp4" }`,
    capabilities: ["maxDuration 300s"],
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
    limitation: "A static verified configuration — the provider exposes no model-list endpoint of its own.",
  },
];

export function ApiExplorer({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const [open, setOpen] = useState<string | null>("chat-llama");
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "Upstream · CVRON" | "Upstream · Agnes" | "Bliss internal">("all");
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
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Code2 className="h-4 w-4 text-[#2563EB]" /> API Explorer
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">Every integration Bliss uses, verified against the source repo</p>
        </div>
        <a href="https://github.com/cvroon-api/FreeAiAPIs" target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline" className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Source repo</span>
          </Button>
        </a>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
          <div className="flex items-start gap-2 rounded-xl border border-[#2563EB]/20 bg-[#EFF6FF] px-3.5 py-3 text-xs leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              The primary provider is free and key-less — no credential of yours is ever sent to it. Bliss still keeps every
              call on the server so the browser never talks to an upstream directly, and adds validation, timeouts, retries and
              per-IP rate limits.{" "}
              {fallback.enabled
                ? "The Agnes fallback is enabled: its key stays in the server environment and never reaches the client bundle."
                : "Set AGNES_API_KEY to enable the documented Agnes AI fallback (chat, vision and images) when the free upstream fails."}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "Upstream · CVRON", "Upstream · Agnes", "Bliss internal"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === f ? "border-transparent brand-gradient text-white" : "hover:bg-slate-50 dark:hover:bg-white/5")}>
                {f === "Upstream · CVRON" ? <Zap className="h-3 w-3" /> : f === "Bliss internal" ? <Server className="h-3 w-3" /> : f === "Upstream · Agnes" ? <Layers className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                {f}
                {f === "Upstream · Agnes" && (
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", fallback.enabled ? "bg-[#22C55E]/15 text-[#16A34A]" : "bg-slate-100 text-[#94A3B8] dark:bg-white/10")}>
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
                <Card key={d.key} className={cn("overflow-hidden transition", isOpen && "border-[#2563EB]/25 shadow-[0_16px_44px_-24px_rgba(37,99,235,0.55)]")}>
                  <button onClick={() => setOpen(isOpen ? null : d.key)} className="flex w-full items-center gap-3 p-3.5 text-left">
                    <span className={cn("rounded-lg px-2 py-1 font-mono text-[10px] font-bold", d.method === "GET" ? "bg-[#22C55E]/12 text-[#16A34A]" : "bg-[#2563EB]/12 text-[#2563EB]")}>
                      {d.method}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{d.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#94A3B8]">{d.path}</p>
                    </div>
                    <Badge className={cn("hidden shrink-0 sm:inline-flex", d.group === "Bliss internal" && "border-[#2563EB]/20 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]")}>
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

          <Card className="border-dashed">
            <CardContent className="text-xs leading-relaxed text-[#94A3B8]">
              <strong className="text-slate-700 dark:text-slate-200">Not implemented because it isn&rsquo;t documented:</strong> vision /
              image analysis, text-to-video, streaming responses, embeddings, function calling and model listing. Bliss shows
              these as unavailable rather than simulating them.
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
