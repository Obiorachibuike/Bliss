/* Video Studio's server seam. Two genuinely different execution models live here:
 *
 *   WAN 2.2 (primary, key-less)  — one long synchronous GET; no job id, no polling.
 *   Agnes Video 2.5 / 2.5 Flash  — documented async task: POST /v1/videos then
 *                                  GET /agnesapi?video_id=…&model_name=… until
 *                                  `status` is completed or failed.
 *
 * There is deliberately no cross-provider fallback for video: the two endpoints take
 * different inputs (WAN needs a source image, Agnes offers text/keyframe/reference),
 * so a failure stays a failure instead of becoming a guess.
 */
import { NextResponse } from "next/server";
import { generateVideo } from "@/lib/api/media";
import { pollAgnesVideo, startAgnesVideo } from "@/lib/api/provider";
import { isAgnesConfigured } from "@/lib/api/agnes";
import {
  AGNES_VIDEO_MODEL,
  AGNES_VIDEO_POLL,
  isAgnesVideoModel,
} from "@/lib/api/config";
import { clientIp, createLimiter } from "@/lib/api/rate-limit";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_PROMPT = 1500;
const NO_STORE = { "Cache-Control": "no-store, max-age=0, s-maxage=0" };

/** Video is expensive and the free tier is small, so creation is throttled harder
 *  than chat; polling is allowed more often because the docs ask for 1–2s intervals. */
const createBucket = createLimiter(6);
const pollBucket = createLimiter(90);

const NO_KEY_ERROR =
  "Agnes video needs the optional fallback provider, which isn't enabled on this deployment. Set AGNES_API_KEY to switch it on.";

function isSafeImageUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const urls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, 12)
        .map(text)
        .filter((u) => u.length > 0)
    : [];

type VideoMode = "text" | "keyframe" | "reference";

/** `mode` is required upstream; when the client omits it we derive it from the media
 *  actually present, so the UI can stay simple without sending a contradictory body. */
function resolveMode(
  requested: string,
  images: string[],
  firstFrame: string,
  lastFrame: string,
): VideoMode {
  if (
    requested === "text" ||
    requested === "keyframe" ||
    requested === "reference"
  ) {
    return requested as VideoMode;
  }
  if (firstFrame || lastFrame) return "keyframe";
  if (images.length) return "reference";
  return "text";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const model = text(body.model);
  const prompt = text(body.prompt);
  const ip = clientIp(req);

  if (createBucket.isLimited(ip)) {
    return NextResponse.json(
      {
        error:
          "Too many video requests from this device. Wait a minute before trying again.",
      },
      { status: 429 },
    );
  }

  /* ── Agnes: create an asynchronous task ───────────────────────────────── */
  if (isAgnesVideoModel(model)) {
    if (!isAgnesConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: NO_KEY_ERROR,
          provider: "agnes",
          fallbackUsed: false,
        },
        { status: 400 },
      );
    }
    if (!prompt)
      return NextResponse.json(
        { error: "Describe the video you want." },
        { status: 400 },
      );
    if (prompt.length > MAX_PROMPT) {
      return NextResponse.json(
        { error: `Video prompts are limited to ${MAX_PROMPT} characters.` },
        { status: 413 },
      );
    }

    const images = urls(body.images);
    const audios = urls(body.audios);
    const firstFrame = text(body.firstFrameUrl);
    const lastFrame = text(body.lastFrameUrl);
    const referenceVideoUrl = text(body.referenceVideoUrl);
    /* `ratio` is the name Image Studio and the public docs use for the same idea, so
     * both spellings are accepted — but only the documented Agnes values survive. */
    const aspectRatio = text(body.aspectRatio) || text(body.ratio);
    const mode = resolveMode(
      text(body.mode),
      [...images, ...(referenceVideoUrl ? [referenceVideoUrl] : [])],
      firstFrame,
      lastFrame,
    );

    const job = await startAgnesVideo({
      model,
      prompt,
      mode,
      ...(typeof body.seconds === "number"
        ? { seconds: Math.trunc(body.seconds) }
        : {}),
      ...(text(body.size) ? { size: text(body.size) } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(images.length ? { images } : {}),
      ...(audios.length ? { audios } : {}),
      ...(firstFrame ? { firstFrame } : {}),
      ...(lastFrame ? { lastFrame } : {}),
      ...(referenceVideoUrl
        ? {
            referenceVideo: {
              url: referenceVideoUrl,
              ...(typeof body.referenceVideoStartSeconds === "number"
                ? { startSeconds: Math.trunc(body.referenceVideoStartSeconds) }
                : {}),
              ...(body.referenceVideoRequireAudio === true
                ? { requireAudio: true }
                : {}),
            },
          }
        : {}),
      ...(typeof body.seed === "number" ? { seed: Math.trunc(body.seed) } : {}),
    });

    if (!job.jobId) {
      return NextResponse.json(
        {
          success: false,
          error: job.error ?? "The video service couldn't start the task.",
          provider: "agnes",
          model,
          fallbackUsed: false,
        },
        // A rejected input is a client mistake; everything else is upstream trouble.
        { status: job.rejected ? 400 : 502 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        async: true,
        jobId: job.jobId,
        model: job.model,
        provider: job.provider,
        fallbackUsed: false,
        status: job.status,
        progress: job.progress,
        pollIntervalMs: AGNES_VIDEO_POLL.intervalMs,
        maxWaitMs: AGNES_VIDEO_POLL.maxWaitMs,
      },
      { headers: NO_STORE },
    );
  }

  /* ── WAN 2.2: single synchronous request (unchanged behaviour) ─────────── */
  if (model && model !== "wan-2.2") {
    return NextResponse.json(
      { error: "Choose WAN 2.2 or a documented Agnes video model." },
      { status: 400 },
    );
  }

  const imageUrl = text(body.imageUrl);
  if (!prompt)
    return NextResponse.json(
      { error: "Describe the motion you want." },
      { status: 400 },
    );
  if (!isSafeImageUrl(imageUrl)) {
    return NextResponse.json(
      {
        error:
          "WAN 2.2 is image-to-video only — a valid public source image URL is required.",
      },
      { status: 400 },
    );
  }

  try {
    const { videoUrl } = await generateVideo(prompt, imageUrl);
    return NextResponse.json(
      {
        success: true,
        async: false,
        videoUrl,
        model: "wan-2.2",
        provider: "cvron",
        fallbackUsed: false,
      },
      { headers: NO_STORE },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Video generation failed.";
    return NextResponse.json(
      {
        success: false,
        error:
          "Video generation failed or timed out. Long jobs can take several minutes — please try again. The key-less video endpoint has no fallback provider.",
        provider: "cvron",
        fallbackUsed: false,
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 502 },
    );
  }
}

/** One status read for a task. The browser owns the poll loop, so a reload can pick
 *  up where it left off and no serverless function sits idle waiting for a render. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const jobId = (params.get("jobId") || params.get("video_id") || "").trim();
  const model = (params.get("model") || AGNES_VIDEO_MODEL).trim();

  if (!jobId) {
    return NextResponse.json(
      { error: "A video task id is required." },
      { status: 400 },
    );
  }
  /* Same shape the client accepts, checked here too so a malformed id is a 400 rather
   * than a "successful" poll that reports a meaningless failure. */
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(jobId)) {
    return NextResponse.json(
      { error: "That video task id isn't valid." },
      { status: 400 },
    );
  }
  if (!isAgnesVideoModel(model)) {
    return NextResponse.json(
      { error: "That video model isn't a documented Agnes model." },
      { status: 400 },
    );
  }
  if (!isAgnesConfigured()) {
    return NextResponse.json(
      { success: false, error: NO_KEY_ERROR, provider: "agnes" },
      { status: 400 },
    );
  }
  if (pollBucket.isLimited(clientIp(req))) {
    return NextResponse.json(
      {
        error: "Too many status checks from this device — slow the poll down.",
      },
      { status: 429 },
    );
  }

  const result = await pollAgnesVideo(jobId, model);
  return NextResponse.json(
    {
      success: true,
      jobId,
      provider: "agnes",
      model,
      status: result.status,
      progress: result.progress,
      ...(result.videoUrl ? { videoUrl: result.videoUrl } : {}),
      ...(result.error ? { error: result.error } : {}),
    },
    { headers: NO_STORE },
  );
}
