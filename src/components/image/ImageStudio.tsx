"use client";
import { useState, useRef, useCallback } from "react";
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
  Paperclip,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/ui/Lightbox";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { cn } from "@/lib/utils/cn";
import { IMAGE_MODELS } from "@/lib/api/config";
import { imageFileToDataUri, toThumbnail } from "@/lib/utils/fileHandling";

type Mode = "generate" | "edit";

const RATIOS = [
  { id: "1:1", label: "Square", w: 1, h: 1 },
  { id: "16:9", label: "Wide", w: 16, h: 9 },
  { id: "9:16", label: "Tall", w: 9, h: 16 },
  { id: "4:3", label: "Classic", w: 4, h: 3 },
  { id: "3:4", label: "Portrait", w: 3, h: 4 },
  { id: "2:3", label: "Tall", w: 2, h: 3 },
  { id: "3:2", label: "Wide", w: 3, h: 2 },
  { id: "21:9", label: "UltraWide", w: 21, h: 9 },
];

const SIZES_TIERS = [
  { id: "1K", label: "1K (fast)", desc: "~1024px" },
  { id: "2K", label: "2K", desc: "~2048px" },
  { id: "3K", label: "3K", desc: "~3072px" },
  { id: "4K", label: "4K", desc: "~4096px" },
];

const STYLES = [
  { id: "none", label: "None" },
  { id: "cinematic", label: "Cinematic", suffix: ", cinematic lighting, 35mm film, dramatic composition" },
  { id: "3d", label: "3D Render", suffix: ", octane render, 3d, subsurface scattering, studio light" },
  { id: "anime", label: "Anime", suffix: ", anime key visual, cel shading, clean lineart" },
  { id: "watercolor", label: "Watercolor", suffix: ", watercolor illustration, soft washes, textured paper" },
  { id: "photo", label: "Photoreal", suffix: ", photorealistic, natural light, 50mm lens, high detail" },
];

export function ImageStudio({
  onOpenMobileNav,
  initialPrompt,
}: {
  onOpenMobileNav: () => void;
  initialPrompt?: string;
}) {
  const defaultImageModel = useSettingsStore((s) => s.defaultImageModel);
  const [model, setModel] = useState(defaultImageModel || "agnes-image-2.1-flash");
  const [mode, setMode] = useState<Mode>("generate");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [size, setSize] = useState("1K");
  const [style, setStyle] = useState(STYLES[0].id);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ id: string; url: string; prompt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; caption: string } | null>(null);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { images, addImage, removeImage } = useSavedStore();

  const isAgnes = model.startsWith("agnes-image");
  const selectedModel = IMAGE_MODELS.find((m) => m.id === model) ?? IMAGE_MODELS[0];

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`Only images supported for image-to-image: ${file.name}`);
        continue;
      }
      try {
        const dataUri = await imageFileToDataUri(file, 2048);
        setAttachedImages((prev) => [...prev, dataUri].slice(0, 4));
        toast.success(`Image attached: ${file.name}`);
      } catch {
        toast.error(`Failed to process ${file.name}`);
      }
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const run = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt ?? prompt;
    setError(null);
    if (!activePrompt.trim()) {
      setError("Describe the image you'd like to create.");
      return;
    }

    // For Agnes edit without images, fallback to sourceUrl
    const imageList = attachedImages.length
      ? attachedImages
      : sourceUrl.trim()
        ? [sourceUrl.trim()]
        : undefined;

    if (mode === "edit" && (!imageList || imageList.length === 0)) {
      setError("Image editing needs a source — upload an image or paste a public URL.");
      return;
    }

    const styleSuffix = STYLES.find((s) => s.id === style)?.suffix ?? "";
    const finalPrompt = `${activePrompt.trim()}${styleSuffix}${ratio !== "1:1" && isAgnes ? `, ${ratio} aspect ratio` : ""}`;

    setBusy(true);
    const started: { id: string; url: string; prompt: string }[] = [];
    try {
      const iterations = mode === "generate" ? count : 1;
      for (let i = 0; i < iterations; i++) {
        const payload: Record<string, unknown> = {
          prompt: finalPrompt,
          model,
          size: isAgnes ? size : undefined,
          ratio: isAgnes ? ratio : undefined,
        };
        if (imageList && imageList.length) {
          payload.images = imageList;
          payload.imageUrl = imageList[0];
        } else if (sourceUrl.trim()) {
          payload.imageUrl = sourceUrl.trim();
        }
        if (mode === "edit") payload.mode = "edit";
        else payload.mode = "generate";

        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || typeof data.imageUrl !== "string") {
          throw new Error(data?.error ?? "The image service did not return a result.");
        }
        const item = { id: `${Date.now()}-${i}`, url: data.imageUrl, prompt: finalPrompt };
        started.push(item);
        setResults((r) => [item, ...r]);
        // Persist tiny thumbnail to avoid localStorage bloat (but keep original URL for display)
        // For data URI outputs, thumbnail it
        let persistPreview = data.imageUrl;
        if (data.imageUrl.startsWith("data:image/")) {
          try {
            persistPreview = await toThumbnail(data.imageUrl);
          } catch {}
        }
        addImage({ id: item.id, prompt: finalPrompt, imageUrl: data.imageUrl, modelId: model, createdAt: Date.now(), aspectRatio: ratio });
      }
      toast.success(started.length > 1 ? `${started.length} images generated` : "Image ready");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Your image couldn't be generated.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const loadIntoCanvas = (url: string, p: string) => {
    setResults((r) => [{ id: `h-${Date.now()}`, url, prompt: p }, ...r]);
    if (mode === "edit") {
      if (url.startsWith("data:image/")) setAttachedImages([url]);
      else setSourceUrl(url);
    }
    toast.info("Loaded into the canvas");
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-white/70 dark:bg-[#080D18]/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[#2563EB] bg-white px-8 py-6 text-center dark:bg-[#101827]">
            <Upload className="mx-auto h-8 w-8 text-[#2563EB]" />
            <p className="mt-2 text-sm font-semibold">Drop image to transform</p>
            <p className="text-xs text-[#94A3B8]">Images downsized to 2048px, sent as base64</p>
          </div>
        </div>
      )}
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <ImageIcon className="h-4 w-4 text-[#2563EB]" /> Image Studio
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">{selectedModel.name} · {selectedModel.provider}</p>
        </div>
        <Badge className={cn("hidden sm:inline-flex", isAgnes ? "border-[#7C3AED]/25 bg-[#7C3AED]/10 text-[#7C3AED]" : "border-[#22C55E]/25 bg-[#22C55E]/10 text-[#16A34A]")}>
          {isAgnes ? `${size} · ${ratio}` : "Flux Dev · ~3s"}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          {/* Controls */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-xl border border-[rgba(148,163,184,0.16)] bg-slate-50 p-0.5 dark:bg-white/5">
                    {(["generate", "edit"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium transition",
                          mode === m ? "brand-gradient text-white shadow-sm" : "text-[#94A3B8] hover:text-slate-700 dark:hover:text-white"
                        )}
                      >
                        {m === "generate" ? <Sparkles className="h-3.5 w-3.5" /> : <Eraser className="h-3.5 w-3.5" />}
                        {m === "generate" ? "Generate" : "Edit"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Model</label>
                  <select
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      useSettingsStore.setState({ defaultImageModel: e.target.value });
                    }}
                    className="w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white px-3 py-2 text-sm dark:bg-[#0B1220]"
                  >
                    {IMAGE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} — {m.provider}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] text-[#94A3B8]">{selectedModel.description}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Prompt</label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={4}
                    placeholder={mode === "generate" ? "A serene alpine lake at blue hour, mirrored peaks, volumetric fog…" : "Make this image look cinematic, warm rim light…"}
                  />
                  <p className="mt-1 text-right text-[10px] text-[#94A3B8]">{prompt.length}/2000</p>
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <Paperclip className="h-3.5 w-3.5" /> Attach images {isAgnes ? "(image-to-image)" : ""}
                  </label>
                  <div className="rounded-xl border border-dashed border-[rgba(148,163,184,0.16)] bg-slate-50 p-3 dark:bg-white/5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                        <Upload className="h-3.5 w-3.5" /> Upload
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5 hidden sm:flex">
                        <Paperclip className="h-3.5 w-3.5" /> Paste / Drop
                      </Button>
                      <span className="self-center text-[11px] text-[#94A3B8]">Max 2048px, base64</span>
                    </div>
                    {attachedImages.length > 0 && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {attachedImages.map((src, i) => (
                          <div key={i} className="group relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`attached ${i}`} className="h-20 w-20 rounded-xl border object-cover" />
                            <button onClick={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-[#94A3B8]">For Agnes: 1 image = transform, multiple = composition. Images downscaled client-side, sent as data URIs.</p>
                  </div>
                </div>

                {mode === "edit" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Or public URL {isAgnes ? "(also supported)" : ""}
                    </label>
                    <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…/photo.jpg" />
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
                      {isAgnes ? "Agnes accepts URLs or base64 — uploads preferred." : "Flux editing needs a public URL — generate an image first, then use its URL."}
                    </p>
                    {sourceUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sourceUrl} alt="Source preview" className="mt-2 h-24 w-full rounded-xl border object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.25")} />
                    )}
                  </div>
                )}

                {isAgnes && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Size tier</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {SIZES_TIERS.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setSize(s.id)}
                            className={cn(
                              "rounded-xl border p-2.5 text-left transition",
                              size === s.id ? "border-[#7C3AED]/40 bg-[#F5F3FF] dark:bg-[#7C3AED]/15" : "hover:bg-slate-50 dark:hover:bg-white/5"
                            )}
                          >
                            <p className={cn("text-xs font-semibold", size === s.id && "text-[#7C3AED]")}>{s.id}</p>
                            <p className="text-[10px] text-[#94A3B8]">{s.desc}</p>
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-[#94A3B8]">Uses extra_body.response_format correctly nested per Agnes docs.</p>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Aspect ratio</label>
                      <div className="grid grid-cols-4 gap-2">
                        {RATIOS.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => setRatio(r.id)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[10px] font-medium transition",
                              ratio === r.id ? "border-[#7C3AED]/40 bg-[#F5F3FF] text-[#7C3AED] dark:bg-[#7C3AED]/15" : "hover:bg-slate-50 dark:hover:bg-white/5"
                            )}
                          >
                            <span className="rounded-[3px] border border-current" style={{ width: Math.max(10, Math.min(22, r.w * 1.4)), height: Math.max(10, Math.min(22, r.h * 1.4)) }} />
                            {r.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {!isAgnes && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Aspect ratio</label>
                    <div className="grid grid-cols-4 gap-2">
                      {RATIOS.slice(0, 4).map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setRatio(r.id)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[10px] font-medium transition",
                            ratio === r.id ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]" : "hover:bg-slate-50 dark:hover:bg-white/5"
                          )}
                        >
                          <span className="rounded-[3px] border border-current" style={{ width: Math.max(10, Math.min(22, r.w * 1.4)), height: Math.max(10, Math.min(22, r.h * 1.4)) }} />
                          {r.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Style</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStyle(s.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                          style === s.id ? "border-[#2563EB]/40 bg-[#2563EB] text-white" : "hover:bg-slate-50 dark:hover:bg-white/5"
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === "generate" && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Number of images</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map((c) => (
                        <button
                          key={c}
                          onClick={() => setCount(c)}
                          className={cn(
                            "h-8 flex-1 rounded-lg border text-xs font-semibold transition",
                            count === c ? "border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]" : "hover:bg-slate-50 dark:hover:bg-white/5"
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#94A3B8]">One request per image — each is generated separately.</p>
                  </div>
                )}

                <Button onClick={() => void run()} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {busy ? "Generating…" : mode === "generate" ? "Generate image" : "Apply edit"}
                </Button>

                {error && (
                  <div className="rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/5 px-3 py-2.5 text-xs text-[#EF4444]">
                    {error}
                    <button onClick={() => void run()} className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
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
                <CardDescription>{busy ? `Rendering with ${selectedModel.name}…` : results.length ? `${results.length} generated this session` : "Your generated images appear here"}</CardDescription>
              </CardHeader>
              <CardContent>
                {busy && results.length === 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Array.from({ length: count }).map((_, i) => (
                      <div key={i} className="skeleton aspect-square rounded-xl" />
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
                      Write a prompt and press generate. {isAgnes ? "Results hosted by Agnes — URLs expire, download promptly." : "Results are hosted by the provider — copy or download them right away, as URLs may expire."}
                    </p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {results.map((r) => (
                    <div key={r.id} className="group animate-pop overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
                      <button onClick={() => setPreview({ url: r.url, caption: r.prompt })} className="block w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img loading="lazy" src={r.url} alt={r.prompt} className="aspect-square w-full bg-slate-50 object-cover transition duration-500 group-hover:scale-[1.03] dark:bg-white/5" />
                      </button>
                      <div className="flex items-center justify-between gap-1 bg-white px-2 py-1.5 dark:bg-[#101827]">
                        <p className="line-clamp-1 flex-1 text-[10px] text-[#94A3B8]">{r.prompt}</p>
                        <div className="flex items-center gap-0.5">
                          <IconBtn label="Copy URL" onClick={() => { navigator.clipboard.writeText(r.url); toast.success("Image URL copied"); }}><Link2 className="h-3.5 w-3.5" /></IconBtn>
                          <a href={r.url} download target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                            <IconBtn label="Download"><Download className="h-3.5 w-3.5" /></IconBtn>
                          </a>
                          <IconBtn label="Save to library" onClick={() => { useSavedStore.getState().addItem({ id: crypto.randomUUID?.() ?? String(Date.now()), type: "image", title: r.prompt.slice(0, 40), content: r.url, preview: r.url, createdAt: Date.now() }); toast.success("Saved"); }}>
                            <Bookmark className="h-3.5 w-3.5" />
                          </IconBtn>
                          <IconBtn label="Regenerate" onClick={() => { setPrompt(r.prompt); void run(r.prompt); }}>
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
                  <CardDescription>Persisted locally — click to reuse</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {images.slice(0, 10).map((im) => (
                      <div key={im.id} className="group relative overflow-hidden rounded-lg border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img loading="lazy" src={im.imageUrl} alt={im.prompt} className="aspect-square w-full cursor-pointer object-cover transition group-hover:scale-105" onClick={() => loadIntoCanvas(im.imageUrl, im.prompt)} />
                        <button onClick={() => removeImage(im.id)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white opacity-0 transition group-hover:opacity-100" aria-label="Delete">
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

      <Lightbox open={!!preview} onClose={() => setPreview(null)} src={preview?.url ?? ""} caption={preview?.caption} />
    </div>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="grid h-6 w-6 place-items-center rounded-md text-[#94A3B8] transition hover:bg-slate-100 hover:text-[#2563EB] dark:hover:bg-white/10 dark:hover:text-white">
      {children}
    </button>
  );
}
