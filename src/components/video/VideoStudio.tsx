"use client";
import { useState, useRef, useCallback } from "react";
import { Clapperboard, Film, Loader2, Download, Clock, Info, Menu, ImagePlus, Upload, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/ui/Lightbox";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { cn } from "@/lib/utils/cn";
import { VIDEO_MODELS, isAgnesVideoModel } from "@/lib/api/config";
import { imageFileToDataUri, toThumbnail } from "@/lib/utils/fileHandling";

const MOTIONS = [
  "Slow cinematic push in, gentle parallax",
  "Clouds drifting across the sky, soft light shifting",
  "Hair and fabric moving in the wind",
  "Camera orbiting around the subject",
  "Rain falling, reflections rippling",
  "Waves rolling onto the shore",
];

const FRAME_OPTIONS = [
  { value: 81, label: "3s (81f)" },
  { value: 121, label: "5s (121f)" },
  { value: 161, label: "~6.5s" },
  { value: 241, label: "10s (241f)" },
  { value: 441, label: "18s max" },
];

export function VideoStudio({
  onOpenMobileNav,
  prefillImageUrl,
}: {
  onOpenMobileNav: () => void;
  prefillImageUrl?: string;
}) {
  const defaultVideoModel = useSettingsStore((s) => s.defaultVideoModel);
  const [model, setModel] = useState(defaultVideoModel || "agnes-video-v2.0");
  const [prompt, setPrompt] = useState("Subtle cinematic motion, drifting clouds, gentle parallax");
  const [imageUrl, setImageUrl] = useState(prefillImageUrl ?? "");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [numFrames, setNumFrames] = useState(121);
  const [frameRate, setFrameRate] = useState(24);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const { videos, addVideo } = useSavedStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAgnes = isAgnesVideoModel(model);
  const selectedModel = VIDEO_MODELS.find((m) => m.id === model) ?? VIDEO_MODELS[0];

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`Only images for video: ${file.name}`);
        continue;
      }
      try {
        const dataUri = await imageFileToDataUri(file, 2048);
        setAttachedImages((prev) => [...prev, dataUri].slice(0, 4));
        if (!imageUrl) setImageUrl(dataUri);
        toast.success(`Image attached: ${file.name}`);
      } catch {
        toast.error(`Failed ${file.name}`);
      }
    }
  }, [imageUrl]);

  const run = async () => {
    setError(null);
    setVideoUrl(null);
    setProgress(0);
    setStatus(null);
    if (!prompt.trim()) return setError("Describe the motion you want.");

    const imageList = attachedImages.length ? attachedImages : imageUrl.trim() ? [imageUrl.trim()] : [];
    // WAN requires image
    if (!isAgnes && imageList.length === 0) return setError("WAN 2.2 animates a still image: a public source image URL is required.");
    // Agnes allows text-to-video (no image) or image-to-video or keyframe
    if (isAgnes && imageList.length > 0) {
      for (const img of imageList) {
        if (!img.startsWith("http") && !img.startsWith("data:image/")) {
          return setError("Images must be URLs or data URIs.");
        }
      }
    }

    setBusy(true);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);

    try {
      if (isAgnes) {
        // Create async task
        setStatus("Creating task…");
        const createRes = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            images: imageList.length ? imageList : undefined,
            imageUrl: imageList[0],
            image: imageList[0],
            model,
            num_frames: numFrames,
            frame_rate: frameRate,
            width: 1152,
            height: 768,
          }),
        });
        const createData = await createRes.json().catch(() => null);
        if (!createRes.ok || !createData?.success || !createData.videoId) {
          throw new Error(createData?.error ?? "Failed to create video task.");
        }
        const videoId: string = createData.videoId;
        setStatus("Queued… polling every 5s");
        // Poll every 5s until completed
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes
        while (attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, 5000));
          if (!busy && attempts === 1) {} // placeholder
          setStatus(`Rendering… attempt ${attempts} · ${elapsed}s elapsed`);
          const pollRes = await fetch(`/api/video/${encodeURIComponent(videoId)}`, { cache: "no-store" });
          const pollData = await pollRes.json().catch(() => null);
          if (pollRes.ok && pollData?.success && pollData.status === "completed" && pollData.videoUrl) {
            setVideoUrl(pollData.videoUrl);
            addVideo({ id: String(Date.now()), prompt: prompt.trim(), imageUrl: imageList[0] || "", videoUrl: pollData.videoUrl, createdAt: Date.now() });
            toast.success("Video ready");
            setProgress(100);
            setStatus("Completed");
            break;
          }
          if (pollData?.status === "failed") {
            throw new Error(pollData.error || "Video generation failed upstream.");
          }
          if (pollData?.progress) setProgress(pollData.progress);
          else setProgress(Math.min(90, Math.round((attempts / 20) * 100)));
          if (attempts >= maxAttempts) throw new Error("Video polling timed out after 10 minutes.");
          // Check if component still busy (not cancelled)
        }
      } else {
        // WAN sync path (single long request)
        setStatus("Rendering… (WAN single request, up to 5 min)");
        const abort = AbortSignal.timeout(290_000);
        const res = await fetch("/api/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim(), imageUrl: imageList[0], model }),
          signal: abort,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || typeof data.videoUrl !== "string") {
          throw new Error(data?.error ?? "The video service did not return a finished video.");
        }
        setVideoUrl(data.videoUrl);
        addVideo({ id: String(Date.now()), prompt: prompt.trim(), imageUrl: imageList[0] || "", videoUrl: data.videoUrl, createdAt: Date.now() });
        toast.success("Video ready");
        setProgress(100);
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.name === "TimeoutError"
          ? "The video job exceeded the 5-minute limit. Try a simpler motion prompt."
          : e instanceof Error
            ? e.message
            : "Video generation failed.";
      setError(msg);
      toast.error(msg);
      setStatus("Failed");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="flex min-w-0 flex-1 flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard className="h-4 w-4 text-[#2563EB]" /> Video Studio
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">{selectedModel.name} · {selectedModel.provider}</p>
        </div>
        <Badge className={cn("hidden sm:inline-flex", isAgnes ? "border-[#7C3AED]/25 bg-[#7C3AED]/10 text-[#7C3AED]" : "border-[#F59E0B]/25 bg-[#F59E0B]/10 text-amber-600 dark:text-amber-400")}>
          {isAgnes ? (attachedImages.length >= 2 ? "Keyframe" : attachedImages.length === 1 || imageUrl ? "Image → video" : "Text → video") : "Image → video only"}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Source & motion</CardTitle>
                <CardDescription>{isAgnes ? "Text-to-video, image-to-video or 2+ images for keyframe animation (Agnes)." : "Uploads aren't supported by the endpoint — paste a public image URL."}</CardDescription>
                <div className="mt-2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Model</label>
                  <select
                    value={model}
                    onChange={(e) => { setModel(e.target.value); useSettingsStore.setState({ defaultVideoModel: e.target.value }); }}
                    className="w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white px-3 py-2 text-sm dark:bg-[#0B1220]"
                  >
                    {VIDEO_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} — {m.provider}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11px] text-[#94A3B8]">{selectedModel.description}</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <ImagePlus className="h-3.5 w-3.5" /> Source images {isAgnes ? "(0-4, drag & drop)" : "(public URL)"}
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
                  />
                  <div className="rounded-xl border border-dashed border-[rgba(148,163,184,0.16)] bg-slate-50 p-3 dark:bg-white/5">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                        <Upload className="h-3.5 w-3.5" /> Upload
                      </Button>
                      <span className="self-center text-[11px] text-[#94A3B8]">{isAgnes ? "Max 2048px, base64 — 1 = image-to-video, 2+ = keyframes" : "Max 2048px"}</span>
                    </div>
                    {(attachedImages.length > 0 || imageUrl) && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        {attachedImages.map((src, i) => (
                          <div key={i} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`source ${i}`} className="h-20 w-20 rounded-xl border object-cover" />
                            <button onClick={() => setAttachedImages((prev) => prev.filter((_, idx) => idx !== i))} className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white">
                              <X className="h-3 w-3" />
                            </button>
                            {isAgnes && attachedImages.length >= 2 && <span className="absolute bottom-0 left-0 rounded-tl-xl rounded-br-xl bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">Key {i + 1}</span>}
                          </div>
                        ))}
                        {attachedImages.length === 0 && imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt="Source" className="h-20 w-full rounded-xl border object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
                        )}
                      </div>
                    )}
                  </div>
                  {!isAgnes && (
                    <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/image.jpg" className="mt-2" />
                  )}
                  {isAgnes && (
                    <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Or paste public URL https://…/image.jpg" className="mt-2" />
                  )}
                  {isAgnes && attachedImages.length >= 2 && (
                    <p className="mt-1.5 text-[11px] text-[#7C3AED]">Keyframe mode: Agnes will animate transition between {attachedImages.length} images.</p>
                  )}
                  {isAgnes && imageUrl && !attachedImages.length && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="Source" className="mt-2 aspect-video w-full rounded-xl border object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Motion prompt {isAgnes && !attachedImages.length && !imageUrl ? "(text-to-video)" : ""}</label>
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder={isAgnes && attachedImages.length === 0 && !imageUrl ? "A cinematic beach at sunset, waves…" : "Generate smooth cinematic motion…"} />
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Quick motions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {MOTIONS.map((m) => (
                      <button key={m} onClick={() => setPrompt(m)} className="rounded-full border px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-white/5">
                        {m.split(",")[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {isAgnes && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Duration (frames)</label>
                      <select value={numFrames} onChange={(e) => setNumFrames(Number(e.target.value))} className="w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white px-3 py-2 text-sm dark:bg-[#0B1220]">
                        {FRAME_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[10px] text-[#94A3B8]">8n+1 rule auto-snapped, max 441</p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">FPS</label>
                      <select value={frameRate} onChange={(e) => setFrameRate(Number(e.target.value))} className="w-full rounded-xl border border-[rgba(148,163,184,0.16)] bg-white px-3 py-2 text-sm dark:bg-[#0B1220]">
                        {[12, 16, 24, 30, 60].map((f) => (
                          <option key={f} value={f}>{f} FPS</option>
                        ))}
                      </select>
                      <p className="mt-1 text-[10px] text-[#94A3B8]">Seconds = frames / fps</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">Duration</p>
                    <p className="text-xs font-semibold">{isAgnes ? `${(numFrames / frameRate).toFixed(1)}s @ ${frameRate}fps` : "Provider-defined"}</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">Aspect ratio</p>
                    <p className="text-xs font-semibold">{isAgnes ? "720p/1080p tier" : "From source image"}</p>
                  </div>
                </div>

                {busy && isAgnes && (
                  <div className="space-y-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <div className="h-full bg-gradient-to-r from-[#7C3AED] to-[#2563EB] transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-center text-xs text-[#94A3B8]">{status} · {elapsed}s elapsed</p>
                  </div>
                )}

                <Button onClick={run} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                  {busy ? (isAgnes ? `Rendering · ${elapsed}s · ${progress}%` : `Rendering · ${elapsed}s`) : "Generate video"}
                </Button>

                <div className="flex items-start gap-2 rounded-xl bg-[#EFF6FF] px-3 py-2 text-[11px] leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{isAgnes ? "Agnes creates an async task, then polls every 5s until completed. Tasks are account-scoped — same key polls." : "The upstream returns the finished file in a single long request — there is no job ID or polling API, so this tab must stay open."}</span>
                </div>

                {error && (
                  <div className="rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/5 px-3 py-2.5 text-xs text-[#EF4444]">{error}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className={cn("overflow-hidden", busy && "border-[#2563EB]/30")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Preview</CardTitle>
                <CardDescription>{busy ? (isAgnes ? "Agnes Video is rendering — polling…" : "WAN 2.2 is rendering — long jobs are normal.") : videoUrl ? "Render complete" : "The finished clip appears here"}</CardDescription>
              </CardHeader>
              <CardContent>
                {busy ? (
                  <div className="relative flex aspect-video flex-col items-center justify-center gap-4 rounded-xl bg-slate-50 dark:bg-[#0B1220]">
                    <div className="skeleton absolute inset-0 rounded-xl" />
                    <div className="relative grid h-14 w-14 place-items-center rounded-2xl brand-gradient text-white">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                    <div className="relative text-center">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <Clock className="h-4 w-4 text-[#2563EB]" /> {elapsed}s elapsed {isAgnes && `· ${progress}%`}
                      </p>
                      <p className="text-xs text-[#94A3B8]">{status ?? "Usually 30–180 seconds"}</p>
                    </div>
                  </div>
                ) : videoUrl ? (
                  <div>
                    <video src={videoUrl} controls className="aspect-video w-full rounded-xl bg-black" onClick={() => setPreview(true)} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a href={videoUrl} download target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="gap-1.5"><Download className="h-3.5 w-3.5" /> Download</Button>
                      </a>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(videoUrl); toast.success("Video URL copied"); }}>
                        Copy URL
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPreview(true)}>Fullscreen</Button>
                      <Button size="sm" variant="outline" onClick={run}>Regenerate</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                    <Clapperboard className="h-8 w-8 text-[#94A3B8]" />
                    <p className="max-w-xs text-xs leading-relaxed text-[#94A3B8]">No clip yet. {isAgnes ? "Try text-to-video without an image, or animate an image." : "Generate an image in Image Studio first, then animate it here."}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {videos.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Saved clips</CardTitle>
                  <CardDescription>Temporary provider URLs — download anything you want to keep</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {videos.slice(0, 5).map((v) => (
                    <div key={v.id} className="flex items-center gap-3 rounded-xl border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v.imageUrl || v.imageUrl} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover bg-slate-100" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-xs font-medium">{v.prompt}</p>
                        <p className="text-[10px] text-[#94A3B8]">{new Date(v.createdAt).toLocaleString()}</p>
                      </div>
                      <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-white/5">
                        Open
                      </a>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {isAgnes && (
              <Card className="border-[#7C3AED]/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-[#7C3AED]" /> How Agnes video works</CardTitle>
                </CardHeader>
                <CardContent className="text-xs leading-relaxed text-[#94A3B8] space-y-1.5">
                  <p>• <b>Model:</b> agnes-video-v2.0 — POST /v1/videos + polling GET /agnesapi?video_id=</p>
                  <p>• <b>Frames:</b> max 441, 8n+1 rule (server snaps automatically)</p>
                  <p>• <b>Prompt:</b> detailed motion description; be specific about camera and subject</p>
                  <p>• <b>Keyframes:</b> upload 2+ images with mode: keyframes for transitions</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Lightbox open={preview} onClose={() => setPreview(false)} src={videoUrl ?? ""} kind="video" caption="Generated clip" />
    </div>
  );
}
