"use client";
import { useState } from "react";
import { Clapperboard, Film, Loader2, Download, Clock, Info, Menu, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Lightbox } from "@/components/ui/Lightbox";
import { toast } from "@/components/ui/Toast";
import { useSavedStore } from "@/lib/store/savedStore";
import { cn } from "@/lib/utils/cn";

const MOTIONS = [
  "Slow cinematic push in, gentle parallax",
  "Clouds drifting across the sky, soft light shifting",
  "Hair and fabric moving in the wind",
  "Camera orbiting around the subject",
  "Rain falling, reflections rippling",
  "Waves rolling onto the shore",
];

export function VideoStudio({
  onOpenMobileNav,
  prefillImageUrl,
}: {
  onOpenMobileNav: () => void;
  prefillImageUrl?: string;
}) {
  const [prompt, setPrompt] = useState("Subtle cinematic motion, drifting clouds, gentle parallax");
  const [imageUrl, setImageUrl] = useState(prefillImageUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const { videos, addVideo } = useSavedStore();

  const run = async () => {
    setError(null);
    setVideoUrl(null);
    setProviderNote(null);
    if (!prompt.trim()) return setError("Describe the motion you want.");
    if (!imageUrl.trim()) return setError("WAN 2.2 animates a still image: a public source image URL is required.");

    setBusy(true);
    setElapsed(0);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    const abort = AbortSignal.timeout(290_000);
    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), imageUrl: imageUrl.trim() }),
        signal: abort,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || typeof data.videoUrl !== "string") {
        throw new Error(data?.error ?? "The video service did not return a finished video.");
      }
      setVideoUrl(data.videoUrl);
      setProviderNote(
        "Animated by WAN 2.2 (key-less provider). This route has no fallback provider, so a failure means the video service is down."
      );
      addVideo({ id: String(Date.now()), prompt: prompt.trim(), imageUrl: imageUrl.trim(), videoUrl: data.videoUrl, createdAt: Date.now() });
      toast.success("Video ready");
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.name === "TimeoutError"
          ? "The video job exceeded the 5-minute limit. Try a simpler motion prompt."
          : e instanceof Error
          ? e.message
          : "Video generation failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-5">
        <button onClick={onOpenMobileNav} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard className="h-4 w-4 text-[#2563EB]" /> Video Studio
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">WAN 2.2 · image-to-video</p>
        </div>
        <Badge className="hidden border-[#F59E0B]/25 bg-[#F59E0B]/10 text-amber-600 dark:text-amber-400 sm:inline-flex">
          Image → video only
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Source & motion</CardTitle>
                <CardDescription>Uploads aren&rsquo;t supported by the endpoint — paste a public image URL.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <ImagePlus className="h-3.5 w-3.5" /> Source image URL
                  </label>
                  <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/image.jpg" />
                  {imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="Source" className="mt-2 aspect-video w-full rounded-xl border object-cover" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Motion prompt</label>
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
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

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">Duration</p>
                    <p className="text-xs font-semibold">Provider-defined</p>
                  </div>
                  <div className="rounded-xl border px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-[#94A3B8]">Aspect ratio</p>
                    <p className="text-xs font-semibold">From source image</p>
                  </div>
                </div>

                <Button onClick={run} disabled={busy} className="w-full gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                  {busy ? `Rendering · ${elapsed}s` : "Generate video"}
                </Button>

                <div className="flex items-start gap-2 rounded-xl bg-[#EFF6FF] px-3 py-2 text-[11px] leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>The upstream returns the finished file in a single long request — there is no job ID or polling API, so this tab must stay open.</span>
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
                <CardDescription>{busy ? "WAN 2.2 is rendering — long jobs are normal." : videoUrl ? "Render complete" : "The finished clip appears here"}</CardDescription>
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
                        <Clock className="h-4 w-4 text-[#2563EB]" /> {elapsed}s elapsed
                      </p>
                      <p className="text-xs text-[#94A3B8]">Usually 30–180 seconds</p>
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
                    {providerNote && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" /> {providerNote}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                    <Clapperboard className="h-8 w-8 text-[#94A3B8]" />
                    <p className="max-w-xs text-xs leading-relaxed text-[#94A3B8]">No clip yet. Generate an image in Image Studio first, then animate it here.</p>
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
                      <img src={v.imageUrl} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
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
          </div>
        </div>
      </div>

      <Lightbox open={preview} onClose={() => setPreview(false)} src={videoUrl ?? ""} kind="video" caption="Generated clip" />
    </div>
  );
}
