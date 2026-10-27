"use client";
import { useState } from "react";
import {
  Wand2,
  Download,
  Link2,
  RefreshCw,
  Bookmark,
  Trash2,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  Eraser,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/ui/Lightbox";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";
import { useFallbackStatus, useImageModels } from "@/lib/hooks/useModelCatalog";
import { AGNES_IMAGE_SIZES, isAgnesImageModel } from "@/lib/api/config";
import { ProviderBadge } from "@/components/chat/ProviderBadge";
import { cn } from "@/lib/utils/cn";

type Mode = "generate" | "edit";

const RATIOS = [
  { id: "1:1", label: "Square", w: 1, h: 1 },
  { id: "16:9", label: "Wide", w: 16, h: 9 },
  { id: "9:16", label: "Tall", w: 9, h: 16 },
  { id: "4:3", label: "Classic", w: 4, h: 3 },
];

const STYLES = [
  { id: "none", label: "None" },
  {
    id: "cinematic",
    label: "Cinematic",
    suffix: ", cinematic lighting, 35mm film, dramatic composition",
  },
  {
    id: "3d",
    label: "3D Render",
    suffix: ", octane render, 3d, subsurface scattering, studio light",
  },
  {
    id: "anime",
    label: "Anime",
    suffix: ", anime key visual, cel shading, clean lineart",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    suffix: ", watercolor illustration, soft washes, textured paper",
  },
  {
    id: "photo",
    label: "Photoreal",
    suffix: ", photorealistic, natural light, 50mm lens, high detail",
  },
];

export function ImageStudio({
  onOpenMobileNav,
  initialPrompt,
}: {
  onOpenMobileNav: () => void;
  initialPrompt?: string;
}) {
  const imageModels = useImageModels();
  const fallback = useFallbackStatus();
  const [model, setModel] = useState("flux-dev");
  /** Documented Agnes output tier — the key-less Flux endpoint has no size control. */
  const [size, setSize] = useState<(typeof AGNES_IMAGE_SIZES)[number]>("1K");
  const usesAgnesModel = isAgnesImageModel(model);
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [ratio, setRatio] = useState(RATIOS[0].id);
  const [style, setStyle] = useState(STYLES[0].id);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  type Result = {
    id: string;
    url: string;
    prompt: string;
    provider?: string;
    model?: string;
    fallbackUsed?: boolean;
  };
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    caption: string;
  } | null>(null);
  const { images, addImage, removeImage } = useSavedStore();

  const run = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt ?? prompt;
    setError(null);
    if (!activePrompt.trim()) {
      setError("Describe the image you'd like to create.");
      return;
    }
    if (mode === "edit" && !sourceUrl.trim()) {
      setError("Image editing needs a publicly accessible source image URL.");
      return;
    }
    const styleSuffix = STYLES.find((s) => s.id === style)?.suffix ?? "";
    const usesRatio = model !== "flux-dev";
    const finalPrompt = `${activePrompt.trim()}${styleSuffix}${!usesRatio && ratio !== "1:1" ? `, ${ratio} aspect ratio composition` : ""}`;

    setBusy(true);
    const started: Result[] = [];
    try {
      for (let i = 0; i < (mode === "generate" ? count : 1); i++) {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            prompt: finalPrompt,
            imageUrl: sourceUrl.trim() || undefined,
            model,
            ratio,
            ...(usesAgnesModel ? { size } : {}),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || typeof data.imageUrl !== "string") {
          throw new Error(
            data?.error ?? "The image service did not return a result.",
          );
        }
        const item: Result = {
          id: `${Date.now()}-${i}`,
          url: data.imageUrl,
          prompt: finalPrompt,
          provider: data.provider,
          model: data.model,
          fallbackUsed: !!data.fallbackUsed,
        };
        started.push(item);
        setResults((r) => [item, ...r]);
        addImage({
          id: item.id,
          prompt: finalPrompt,
          imageUrl: data.imageUrl,
          modelId: data.model ?? model,
          createdAt: Date.now(),
          aspectRatio: ratio,
        });
      }
      const viaFallback = started.some((r) => r.fallbackUsed);
      toast.success(
        started.length > 1
          ? `${started.length} images generated${viaFallback ? " via the fallback provider" : ""}`
          : viaFallback
            ? "Image ready — generated by the Agnes fallback"
            : "Image ready",
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Your image couldn't be generated.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const loadIntoCanvas = (url: string, p: string) => {
    setResults((r) => [{ id: `h-${Date.now()}`, url, prompt: p }, ...r]);
    if (mode === "edit") setSourceUrl(url);
    toast.info("Loaded into the canvas");
  };

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
            <ImageIcon className="h-4 w-4 text-[#2563EB]" /> Image Studio
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">
            {imageModels.find((m) => m.id === model)?.name ?? "Flux Dev"} ·
            text-to-image and AI editing
          </p>
        </div>
        <Badge className="hidden border-[#22C55E]/25 bg-[#22C55E]/10 text-[#16A34A] sm:inline-flex">
          {usesAgnesModel
            ? `Agnes Image · ${size} tier, ratio-aware`
            : "Flux Dev · ~3s"}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          {/* Controls */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="inline-flex rounded-xl border border-[rgba(148,163,184,0.16)] bg-slate-50 p-0.5 dark:bg-white/5">
                  {(["generate", "edit"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium transition",
                        mode === m
                          ? "brand-gradient text-white shadow-sm"
                          : "text-[#94A3B8] hover:text-slate-700 dark:hover:text-white",
                      )}
                    >
                      {m === "generate" ? (
                        <Sparkles className="h-3.5 w-3.5" />
                      ) : (
                        <Eraser className="h-3.5 w-3.5" />
                      )}
                      {m === "generate" ? "Generate" : "Edit"}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Model
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {imageModels.map((m) => {
                      const needsKey = m.fallback && !fallback.enabled;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setModel(m.id)}
                          className={cn(
                            "rounded-xl border p-2 text-left text-[11px] font-medium transition",
                            model === m.id
                              ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
                              : "hover:bg-slate-50 dark:hover:bg-white/5",
                            needsKey && "opacity-60",
                          )}
                        >
                          <span className="block truncate">{m.name}</span>
                          <span className="mt-0.5 block text-[10px] text-[#94A3B8]">
                            {needsKey
                              ? "needs AGNES_API_KEY"
                              : m.fallback
                                ? "fallback provider"
                                : "primary · key-less"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
                    Flux Dev runs first; if it fails and a fallback key is
                    configured, the same prompt is retried on Agnes Image 2.1
                    Flash.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Prompt
                  </label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder={
                      mode === "generate"
                        ? "A serene alpine lake at blue hour, mirrored peaks, volumetric fog…"
                        : "Make this image look cinematic, warm rim light…"
                    }
                  />
                  <p className="mt-1 text-right text-[10px] text-[#94A3B8]">
                    {prompt.length}/1000
                  </p>
                </div>

                {mode === "edit" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Source image URL
                    </label>
                    <Input
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://…/photo.jpg"
                    />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
                      The editing endpoint accepts only a public URL — it cannot
                      receive an uploaded binary file. Generate an image first,
                      then use its URL.
                    </p>
                    {sourceUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sourceUrl}
                        alt="Source preview"
                        className="mt-2 h-24 w-full rounded-xl border object-cover"
                        onError={(e) =>
                          ((e.target as HTMLImageElement).style.opacity =
                            "0.25")
                        }
                      />
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Aspect ratio
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {RATIOS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRatio(r.id)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[10px] font-medium transition",
                          ratio === r.id
                            ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
                            : "hover:bg-slate-50 dark:hover:bg-white/5",
                        )}
                      >
                        <span
                          className="rounded-[3px] border border-current"
                          style={{
                            width: Math.max(10, Math.min(22, r.w * 1.4)),
                            height: Math.max(10, Math.min(22, r.h * 1.4)),
                          }}
                        />
                        {r.id}
                      </button>
                    ))}
                  </div>

                  {usesAgnesModel && (
                    <div>
                      <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <span>Output tier</span>
                        <span className="text-[10px] font-normal text-[#94A3B8]">
                          Agnes normalises exact pixels to these tiers
                        </span>
                      </label>
                      <div className="grid grid-cols-4 gap-2">
                        {AGNES_IMAGE_SIZES.map((tier) => (
                          <button
                            key={tier}
                            onClick={() => setSize(tier)}
                            className={cn(
                              "rounded-xl border py-1.5 text-[11px] font-medium transition",
                              size === tier
                                ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
                                : "hover:bg-slate-50 dark:hover:bg-white/5",
                            )}
                          >
                            {tier}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Style
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStyle(s.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                          style === s.id
                            ? "border-[#2563EB]/40 bg-[#2563EB] text-white"
                            : "hover:bg-slate-50 dark:hover:bg-white/5",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === "generate" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Number of images
                    </label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map((c) => (
                        <button
                          key={c}
                          onClick={() => setCount(c)}
                          className={cn(
                            "h-8 flex-1 rounded-lg border text-xs font-semibold transition",
                            count === c
                              ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
                              : "hover:bg-slate-50 dark:hover:bg-white/5",
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#94A3B8]">
                      One request per image — each is generated separately.
                    </p>
                  </div>
                )}

                <Button
                  onClick={() => void run()}
                  disabled={busy}
                  className="w-full gap-2"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {busy
                    ? "Generating…"
                    : mode === "generate"
                      ? "Generate image"
                      : "Apply edit"}
                </Button>

                {error && (
                  <div className="rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/5 px-3 py-2.5 text-xs text-[#EF4444]">
                    {error}
                    <button
                      onClick={() => void run()}
                      className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                    >
                      <RefreshCw className="h-3 w-3" /> Retry
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="space-y-4">
            <Card className="min-h-[280px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Results</CardTitle>
                <CardDescription>
                  {busy
                    ? `Rendering with ${imageModels.find((m) => m.id === model)?.name ?? "Flux Dev"}…`
                    : results.length
                      ? `${results.length} generated this session`
                      : "Your generated images appear here"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {busy && results.length === 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Array.from({ length: count }).map((_, i) => (
                      <div
                        key={i}
                        className="skeleton aspect-square rounded-xl"
                      />
                    ))}
                  </div>
                )}
                {!busy && results.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15">
                      <Upload className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-medium">Nothing generated yet</p>
                    <p className="max-w-xs text-xs leading-relaxed text-[#94A3B8]">
                      Write a prompt and press generate. Results are hosted by
                      the provider — copy or download them right away, as URLs
                      may expire.
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {results.map((r) => (
                    <div
                      key={r.id}
                      className="group animate-pop overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]"
                    >
                      <button
                        onClick={() =>
                          setPreview({ url: r.url, caption: r.prompt })
                        }
                        className="block w-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          loading="lazy"
                          src={r.url}
                          alt={r.prompt}
                          className="aspect-square w-full bg-slate-50 object-cover transition duration-500 group-hover:scale-[1.03] dark:bg-white/5"
                        />
                      </button>
                      <div className="flex items-center justify-between gap-1 bg-white px-2 py-1.5 dark:bg-[#101827]">
                        <p className="line-clamp-1 flex-1 text-[10px] text-[#94A3B8]">
                          {r.prompt}
                        </p>
                        {r.fallbackUsed && (
                          <ProviderBadge
                            provider={r.provider}
                            model={r.model}
                            fallbackUsed
                          />
                        )}
                        <div className="flex items-center gap-0.5">
                          <IconBtn
                            label="Copy URL"
                            onClick={() => {
                              navigator.clipboard.writeText(r.url);
                              toast.success("Image URL copied");
                            }}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </IconBtn>
                          <a
                            href={r.url}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <IconBtn label="Download">
                              <Download className="h-3.5 w-3.5" />
                            </IconBtn>
                          </a>
                          <IconBtn
                            label="Save to library"
                            onClick={() => {
                              useSavedStore.getState().addItem({
                                id: crypto.randomUUID?.() ?? String(Date.now()),
                                type: "image",
                                title: r.prompt.slice(0, 40),
                                content: r.url,
                                preview: r.url,
                                createdAt: Date.now(),
                              });
                              toast.success("Saved");
                            }}
                          >
                            <Bookmark className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn
                            label="Regenerate"
                            onClick={() => {
                              setPrompt(r.prompt);
                              void run(r.prompt);
                            }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </IconBtn>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {images.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recent generations</CardTitle>
                  <CardDescription>
                    Persisted locally — click to reuse
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {images.slice(0, 10).map((im) => (
                      <div
                        key={im.id}
                        className="group relative overflow-hidden rounded-lg border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          loading="lazy"
                          src={im.imageUrl}
                          alt={im.prompt}
                          className="aspect-square w-full cursor-pointer object-cover transition group-hover:scale-105"
                          onClick={() => loadIntoCanvas(im.imageUrl, im.prompt)}
                        />
                        <button
                          onClick={() => removeImage(im.id)}
                          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Lightbox
        open={!!preview}
        onClose={() => setPreview(null)}
        src={preview?.url ?? ""}
        caption={preview?.caption}
      />
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-md text-[#94A3B8] transition hover:bg-slate-100 hover:text-[#2563EB] dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}
