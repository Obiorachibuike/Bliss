"use client";
/* Video Studio.
 *
 * Two execution models, both honest about themselves:
 *   · WAN 2.2 (key-less primary) — one long synchronous request, live elapsed timer.
 *   · Agnes Video 2.5 / 2.5 Flash — documented async task: create, then poll the
 *     status endpoint from the browser (so no server function sits idle, and a page
 *     reload can resume watching the same task id).
 *
 * Neither is silently swapped for the other: an Agnes model is never answered by the
 * key-less provider, and a WAN failure is reported as a failure.
 */
import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Film,
  Loader2,
  Download,
  Clock,
  Info,
  Menu,
  ImagePlus,
  Ban,
  Sparkles,
  RefreshCw,
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
import { useFallbackStatus, useVideoModels } from "@/lib/hooks/useModelCatalog";
import {
  AGNES_VIDEO_POLL,
  AGNES_VIDEO_SECONDS,
  agnesVideoModel,
  isAgnesVideoModel,
} from "@/lib/api/config";
import { cn } from "@/lib/utils/cn";

const MOTIONS = [
  "Slow cinematic push in, gentle parallax",
  "Clouds drifting across the sky, soft light shifting",
  "Hair and fabric moving in the wind",
  "Camera orbiting around the subject",
  "Rain falling, reflections rippling",
  "Waves rolling onto the shore",
];

const MODES = [
  {
    id: "text",
    label: "Text → video",
    hint: "Prompt only. No media references.",
  },
  {
    id: "keyframe",
    label: "Keyframes",
    hint: "Animate from a first frame, a last frame, or both.",
  },
  {
    id: "reference",
    label: "References",
    hint: "Guide subject, style or rhythm with images (and audio).",
  },
] as const;

type Mode = (typeof MODES)[number]["id"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toList = (value: string) =>
  value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function VideoStudio({
  onOpenMobileNav,
  prefillImageUrl,
}: {
  onOpenMobileNav: () => void;
  prefillImageUrl?: string;
}) {
  const videoModels = useVideoModels();
  const fallback = useFallbackStatus();

  const [model, setModel] = useState<string>("wan-2.2");
  const [prompt, setPrompt] = useState(
    "Subtle cinematic motion, drifting clouds, gentle parallax",
  );
  const [imageUrl, setImageUrl] = useState(prefillImageUrl ?? "");

  /* Agnes-only controls, driven by the documented per-model spec. "text" is the
   * provider's own default, so an untouched form sends a plain text-to-video task. */
  const [mode, setMode] = useState<Mode>("text");
  const [seconds, setSeconds] = useState<number>(AGNES_VIDEO_SECONDS.default);
  const [size, setSize] = useState<string>("720P");
  const [ratio, setRatio] = useState<string>("16:9");
  const [firstFrame, setFirstFrame] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [imagesText, setImagesText] = useState("");
  const [audiosText, setAudiosText] = useState("");
  const [refVideoUrl, setRefVideoUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  /* The status endpoint needs the model the task was created with, and a resumed
   * watch must keep using it even if the picker moved on meanwhile. */
  const [jobModel, setJobModel] = useState<string | null>(null);
  const pollInterval = useRef<number>(AGNES_VIDEO_POLL.intervalMs);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const { videos, addVideo } = useSavedStore();

  const watching = useRef(true);
  const isAgnes = isAgnesVideoModel(model);
  const spec = isAgnes ? agnesVideoModel(model) : undefined;

  /* A model that doesn't support the currently selected option simply ignores it:
   * derived here (never written back in an effect) so the request body can't contain
   * a combination the provider would answer with HTTP 400. */
  const effSize = spec && !spec.sizes.includes(size) ? spec.sizes[0] : size;
  const effRatio =
    spec && !spec.ratios.includes(ratio) ? spec.ratios[0] : ratio;
  const effMode = (
    spec && !spec.modes.includes(mode) ? spec.modes[0] : mode
  ) as Mode;
  const effRefVideo = spec?.videoReference ? refVideoUrl.trim() : "";

  useEffect(() => {
    watching.current = true;
    return () => {
      watching.current = false;
    };
  }, []);

  const save = (clipUrl: string, thumb: string) =>
    addVideo({
      id: String(Date.now()),
      prompt: prompt.trim(),
      imageUrl: thumb,
      videoUrl: clipUrl,
      createdAt: Date.now(),
    });

  /* ── key-less primary: one long synchronous request ─────────────────────── */
  const runWan = async () => {
    if (!imageUrl.trim()) {
      setError(
        "WAN 2.2 animates a still image: a public source image URL is required.",
      );
      return;
    }
    try {
      const res = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          imageUrl: imageUrl.trim(),
          model: "wan-2.2",
        }),
        signal: AbortSignal.timeout(290_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || typeof data.videoUrl !== "string") {
        throw new Error(
          data?.error ?? "The video service did not return a finished video.",
        );
      }
      setVideoUrl(data.videoUrl);
      setProviderNote(
        "Animated by WAN 2.2 (key-less provider). This route has no fallback provider, so a failure means the video service is down.",
      );
      save(data.videoUrl, imageUrl.trim());
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
    }
  };

  /* Polling lives in the browser on purpose: a video can take minutes, and no
   * serverless timeout should be the reason a paid task is lost. The loop is shared
   * by "Generate" and "Keep watching", so a stopped task can be resumed. */
  const watchTask = async (id: string, modelOfJob: string) => {
    const startedAt = Date.now();
    let wait = pollInterval.current;
    watching.current = true;
    while (watching.current) {
      if (Date.now() - startedAt > AGNES_VIDEO_POLL.maxWaitMs) {
        throw new Error(
          `Still rendering after ${Math.round(AGNES_VIDEO_POLL.maxWaitMs / 60_000)} minutes. Task ${id} is untouched — press "Keep watching" to carry on.`,
        );
      }
      await sleep(wait);
      if (!watching.current) return;
      const res = await fetch(
        `/api/video?jobId=${encodeURIComponent(id)}&model=${encodeURIComponent(modelOfJob)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // A 429/5xx from the status endpoint is not a failed render: back off, keep the task.
        wait = Math.min(wait * 2, AGNES_VIDEO_POLL.maxWaitMs / 20);
        setError(
          data?.error ??
            "Couldn't read the task status — backing off and retrying.",
        );
        continue;
      }
      setError(null);
      setProgress(typeof data.progress === "number" ? data.progress : 0);
      if (data.status === "completed" && typeof data.videoUrl === "string") {
        setProgress(100);
        setVideoUrl(data.videoUrl);
        save(data.videoUrl, firstFrame.trim() || toList(imagesText)[0] || "");
        setProviderNote(
          `Task ${id} finished on ${spec?.name ?? "Agnes"}. Provider URLs are temporary — download anything you want to keep.`,
        );
        toast.success("Video ready");
        return;
      }
      if (data.status === "failed") {
        throw new Error(data.error ?? "The video task failed upstream.");
      }
    }
  };

  const runAgnes = async () => {
    const images = toList(imagesText);
    const audios = toList(audiosText);
    const body = {
      model,
      prompt: prompt.trim(),
      mode: effMode,
      seconds,
      size: effSize,
      aspectRatio: effRatio,
      ...(effMode === "keyframe"
        ? { firstFrameUrl: firstFrame.trim(), lastFrameUrl: lastFrame.trim() }
        : {}),
      ...(effMode === "reference"
        ? {
            ...(images.length ? { images } : {}),
            ...(audios.length ? { audios } : {}),
            ...(effRefVideo ? { referenceVideoUrl: effRefVideo } : {}),
          }
        : {}),
    };

    const createRes = await fetch("/api/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const created = await createRes.json().catch(() => null);
    if (
      !createRes.ok ||
      !created?.success ||
      typeof created.jobId !== "string"
    ) {
      throw new Error(
        created?.error ?? "The video service couldn't start the task.",
      );
    }

    const modelOfJob =
      typeof created.model === "string" ? created.model : model;
    pollInterval.current =
      typeof created.pollIntervalMs === "number" && created.pollIntervalMs > 0
        ? created.pollIntervalMs
        : AGNES_VIDEO_POLL.intervalMs;
    setJobId(created.jobId);
    setJobModel(modelOfJob);
    setProgress(typeof created.progress === "number" ? created.progress : 0);
    setProviderNote(
      `Task ${created.jobId} queued on ${spec?.name ?? "Agnes"}. The browser checks its status every ${Math.round(pollInterval.current / 1000)}s — closing this tab stops watching, not the render.`,
    );
    await watchTask(created.jobId, modelOfJob);
  };

  /** Resume watching a task this tab already started (or restart after a reload). */
  const resumeWatching = async () => {
    if (!jobId) return;
    setError(null);
    setBusy(true);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      await watchTask(jobId, jobModel ?? model);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Couldn't read the task status.";
      setError(msg);
      toast.error(msg);
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  const run = async () => {
    setError(null);
    setVideoUrl(null);
    setProviderNote(null);
    setJobId(null);
    setJobModel(null);
    setProgress(0);
    setElapsed(0);
    if (!prompt.trim()) {
      setError(
        isAgnes
          ? "Describe the video you want."
          : "Describe the motion you want.",
      );
      return;
    }
    if (isAgnes && !fallback.enabled) {
      setError(
        `${spec?.name ?? "Agnes video"} needs the optional Agnes provider: set AGNES_API_KEY on the server, or pick WAN 2.2.`,
      );
      return;
    }

    setBusy(true);
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    try {
      if (isAgnes) await runAgnes();
      else await runWan();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Video generation failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  const stopWatching = () => {
    watching.current = false;
    setBusy(false);
    setProviderNote(
      jobId
        ? `Stopped watching task ${jobId}. It keeps rendering upstream — press "Keep watching" to check again, or call /api/video?jobId=${jobId}.`
        : "Stopped watching.",
    );
    toast.info("Stopped watching — the task may still finish upstream");
  };

  const label = isAgnes ? (spec?.name ?? "Agnes") : "WAN 2.2";

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
            <Clapperboard className="h-4 w-4 text-[#2563EB]" /> Video Studio
          </h1>
          <p className="hidden text-[11px] text-[#94A3B8] sm:block">
            {label}
            {isAgnes
              ? " · text, keyframe and reference modes"
              : " · image-to-video"}
          </p>
        </div>
        <Badge
          className={cn(
            "hidden sm:inline-flex",
            isAgnes
              ? "border-[#2563EB]/20 bg-[#EFF6FF] text-[#2563EB] dark:bg-[#2563EB]/15 dark:text-[#60A5FA]"
              : "border-[#F59E0B]/25 bg-[#F59E0B]/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {isAgnes ? "Async task · polling" : "Image → video only"}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Engine</CardTitle>
                <CardDescription>
                  Only the documented video endpoints are offered — nothing is
                  emulated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  {videoModels.map((m) => {
                    const specFor = isAgnesVideoModel(m.id)
                      ? agnesVideoModel(m.id)
                      : undefined;
                    const active = model === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setModel(m.id)}
                        className={cn(
                          "rounded-xl border p-2.5 text-left transition",
                          active
                            ? "border-[#2563EB]/40 bg-[#EFF6FF] dark:bg-[#2563EB]/10"
                            : "hover:bg-slate-50 dark:hover:bg-white/5",
                        )}
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold">
                          {m.name}
                          {specFor?.billed && (
                            <Badge className="border-[#F59E0B]/25 bg-[#F59E0B]/10 text-amber-600 dark:text-amber-400">
                              billed
                            </Badge>
                          )}
                          {specFor && !specFor.billed && (
                            <Badge className="border-[#22C55E]/25 bg-[#22C55E]/10 text-[#16A34A]">
                              $0 promo
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-[#94A3B8]">
                          {m.description}
                        </span>
                        {specFor && !fallback.enabled && (
                          <span className="mt-1 block text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Needs AGNES_API_KEY on the server — this deployment
                            doesn&rsquo;t have one.
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {isAgnes ? "Task settings" : "Source & motion"}
                </CardTitle>
                <CardDescription>
                  {isAgnes
                    ? "Media must be publicly reachable URLs — the endpoint takes no uploads."
                    : "Uploads aren’t supported by the endpoint — paste a public image URL."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isAgnes && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <ImagePlus className="h-3.5 w-3.5" /> Source image URL
                    </label>
                    <Input
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://…/image.jpg"
                    />
                    {imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt="Source"
                        className="mt-2 aspect-video w-full rounded-xl border object-cover"
                        onError={(e) =>
                          ((e.target as HTMLImageElement).style.opacity = "0.2")
                        }
                      />
                    )}
                  </div>
                )}

                {isAgnes && spec && (
                  <>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Mode
                      </p>
                      <div className="grid gap-1.5">
                        {MODES.filter((m) => spec.modes.includes(m.id)).map(
                          (m) => (
                            <button
                              key={m.id}
                              onClick={() => setMode(m.id)}
                              className={cn(
                                "rounded-xl border px-2.5 py-1.5 text-left transition",
                                effMode === m.id
                                  ? "border-[#2563EB]/40 bg-[#EFF6FF] dark:bg-[#2563EB]/10"
                                  : "hover:bg-slate-50 dark:hover:bg-white/5",
                              )}
                            >
                              <span className="block text-[11px] font-semibold">
                                {m.label}
                              </span>
                              <span className="block text-[10px] text-[#94A3B8]">
                                {m.hint}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    </div>

                    {effMode === "keyframe" && (
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            First frame URL
                          </label>
                          <Input
                            value={firstFrame}
                            onChange={(e) => setFirstFrame(e.target.value)}
                            placeholder="https://…/first.png"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Last frame URL (optional)
                          </label>
                          <Input
                            value={lastFrame}
                            onChange={(e) => setLastFrame(e.target.value)}
                            placeholder="https://…/last.png"
                          />
                        </div>
                      </div>
                    )}

                    {effMode === "reference" && (
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Reference images (max {spec.maxImages})
                          </label>
                          <Textarea
                            value={imagesText}
                            onChange={(e) => setImagesText(e.target.value)}
                            rows={2}
                            placeholder="https://…/a.png, https://…/b.png"
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Reference audio URLs (max {spec.maxAudios})
                          </label>
                          <Textarea
                            value={audiosText}
                            onChange={(e) => setAudiosText(e.target.value)}
                            rows={1}
                            placeholder="https://…/music.mp3"
                          />
                        </div>
                        {spec.videoReference ? (
                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                              Reference video URL
                            </label>
                            <Input
                              value={refVideoUrl}
                              onChange={(e) => setRefVideoUrl(e.target.value)}
                              placeholder="https://…/clip.mp4"
                            />
                          </div>
                        ) : (
                          <p className="rounded-lg border border-[rgba(148,163,184,0.2)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[#94A3B8]">
                            {spec.name} rejects reference videos (HTTP 400) —
                            use Agnes Video 2.5 for motion transfer.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border px-2.5 py-2">
                        <label
                          className="block text-[10px] uppercase tracking-wider text-[#94A3B8]"
                          htmlFor="video-seconds"
                        >
                          Seconds
                        </label>
                        <input
                          id="video-seconds"
                          type="range"
                          min={AGNES_VIDEO_SECONDS.min}
                          max={AGNES_VIDEO_SECONDS.max}
                          value={seconds}
                          onChange={(e) => setSeconds(Number(e.target.value))}
                          className="mt-1 w-full accent-[#2563EB]"
                        />
                        <p className="text-[11px] font-semibold">{seconds}s</p>
                      </div>
                      <div className="rounded-xl border px-2.5 py-2">
                        <label
                          className="mb-1 block text-[10px] uppercase tracking-wider text-[#94A3B8]"
                          htmlFor="video-size"
                        >
                          Resolution
                        </label>
                        <select
                          id="video-size"
                          value={effSize}
                          onChange={(e) => setSize(e.target.value)}
                          className="w-full bg-transparent text-[11px] font-semibold outline-none"
                        >
                          {spec.sizes.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-xl border px-2.5 py-2">
                        <label
                          className="mb-1 block text-[10px] uppercase tracking-wider text-[#94A3B8]"
                          htmlFor="video-ratio"
                        >
                          Ratio
                        </label>
                        <select
                          id="video-ratio"
                          value={effRatio}
                          onChange={(e) => setRatio(e.target.value)}
                          className="w-full bg-transparent text-[11px] font-semibold outline-none"
                        >
                          {spec.ratios.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label
                    htmlFor="video-prompt"
                    className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {isAgnes ? "Prompt" : "Motion prompt"}
                  </label>
                  <Textarea
                    id="video-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    aria-describedby="video-prompt-hint"
                  />
                </div>

                {!isAgnes && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Quick motions
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {MOTIONS.map((m) => (
                        <button
                          key={m}
                          onClick={() => setPrompt(m)}
                          className="rounded-full border px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          {m.split(",")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Button onClick={run} disabled={busy} className="w-full gap-2">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4" />
                  )}
                  {busy
                    ? isAgnes
                      ? `Rendering · ${elapsed}s`
                      : `Rendering · ${elapsed}s`
                    : "Generate video"}
                </Button>

                {busy && isAgnes && jobId && (
                  <Button
                    onClick={stopWatching}
                    variant="outline"
                    className="w-full gap-2"
                  >
                    <Ban className="h-4 w-4" /> Stop watching
                  </Button>
                )}

                <div className="flex items-start gap-2 rounded-xl bg-[#EFF6FF] px-3 py-2 text-[11px] leading-relaxed text-[#1D4ED8] dark:bg-[#2563EB]/10 dark:text-[#93C5FD]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {isAgnes
                      ? "Agnes video is asynchronous: Bliss starts the task, then polls its status in the browser. Only the documented controls are exposed."
                      : "The upstream returns the finished file in a single long request — there is no job ID or polling API, so this tab must stay open."}
                  </span>
                </div>

                {error && (
                  <div className="rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/5 px-3 py-2.5 text-xs text-[#EF4444]">
                    {error}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card
              className={cn("overflow-hidden", busy && "border-[#2563EB]/30")}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Preview</CardTitle>
                <CardDescription>
                  {busy
                    ? isAgnes
                      ? `${label} is rendering — ${progress}% reported`
                      : "WAN 2.2 is rendering — long jobs are normal."
                    : videoUrl
                      ? "Render complete"
                      : "The finished clip appears here"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {busy ? (
                  <div className="relative flex aspect-video flex-col items-center justify-center gap-4 rounded-xl bg-slate-50 dark:bg-[#0B1220]">
                    <div className="skeleton absolute inset-0 rounded-xl" />
                    <div className="relative grid h-14 w-14 place-items-center rounded-2xl brand-gradient text-white">
                      {isAgnes ? (
                        <Sparkles className="h-6 w-6" />
                      ) : (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      )}
                    </div>
                    <div className="relative w-full max-w-xs text-center">
                      <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                        <Clock className="h-4 w-4 text-[#2563EB]" /> {elapsed}s
                        elapsed
                      </p>
                      {isAgnes ? (
                        <>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                            <div
                              className="h-full rounded-full brand-gradient transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-[#94A3B8]">
                            {jobId ? `task ${jobId} · ` : "queueing…"}
                            {progress}% reported by the provider
                          </p>
                          {providerNote && (
                            <p className="mx-auto mt-2 max-w-xs text-[10px] leading-relaxed text-[#94A3B8]">
                              {providerNote}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-[#94A3B8]">
                          Usually 30–180 seconds
                        </p>
                      )}
                    </div>
                  </div>
                ) : videoUrl ? (
                  <div>
                    <video
                      src={videoUrl}
                      controls
                      className="aspect-video w-full rounded-xl bg-black"
                      onClick={() => setPreview(true)}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={videoUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <Download className="h-3.5 w-3.5" /> Download
                        </Button>
                      </a>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText(videoUrl);
                          toast.success("Video URL copied");
                        }}
                      >
                        Copy URL
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreview(true)}
                      >
                        Fullscreen
                      </Button>
                      <Button size="sm" variant="outline" onClick={run}>
                        Regenerate
                      </Button>
                    </div>
                    {providerNote && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#94A3B8]">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />{" "}
                        {providerNote}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
                    <Clapperboard className="h-8 w-8 text-[#94A3B8]" />
                    <p className="max-w-xs text-xs leading-relaxed text-[#94A3B8]">
                      {isAgnes
                        ? "Agnes can start from text alone — describe the scene, then press Generate."
                        : "No clip yet. Generate an image in Image Studio first, then animate it here."}
                    </p>
                    {isAgnes && jobId && (
                      <div className="flex max-w-xs flex-col items-center gap-2">
                        <p className="text-[11px] leading-relaxed text-[#94A3B8]">
                          {providerNote}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={resumeWatching}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Keep watching task {jobId}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {videos.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Saved clips</CardTitle>
                  <CardDescription>
                    Temporary provider URLs — download anything you want to keep
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {videos.slice(0, 5).map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center gap-3 rounded-xl border p-2"
                    >
                      {v.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.imageUrl}
                          alt=""
                          className="h-12 w-20 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="grid h-12 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-[10px] text-[#94A3B8] dark:bg-white/5">
                          text →
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-xs font-medium">
                          {v.prompt}
                        </p>
                        <p className="text-[10px] text-[#94A3B8]">
                          {new Date(v.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-white/5"
                      >
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

      <Lightbox
        open={preview}
        onClose={() => setPreview(false)}
        src={videoUrl ?? ""}
        kind="video"
        caption="Generated clip"
      />
    </div>
  );
}
