import { NextResponse } from "next/server";
import { generateVideo } from "@/lib/api/media";
import { agnesCreateVideo, agnesPollVideo } from "@/lib/api/agnes";
import { hasAgnesKeys } from "@/lib/api/agnesKeys";
import { isAgnesVideoModel } from "@/lib/api/config";

export const maxDuration = 300;

function isSafeImageUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
function isDataUri(s: string) {
  return s.startsWith("data:image/");
}
function isValidImageInput(s: string) {
  return isSafeImageUrl(s) || isDataUri(s);
}

function normalizeImages(body: Record<string, unknown>): string[] | undefined {
  const out: string[] = [];
  const keys = ["imageUrl", "image_url", "image", "images", "referenceImages", "sourceImages"];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const el of v) if (typeof el === "string" && el.trim()) out.push(el.trim());
  }
  if (body.extra_body && typeof body.extra_body === "object") {
    const eb = body.extra_body as Record<string, unknown>;
    const im = eb.image;
    if (typeof im === "string" && im.trim()) out.push(im.trim());
    else if (Array.isArray(im)) for (const el of im) if (typeof el === "string" && el.trim()) out.push(el.trim());
  }
  return out.length ? out : undefined;
}

function snapFrames(n: number): number {
  const valid = [81, 121, 161, 201, 241, 281, 321, 361, 401, 441];
  if (valid.includes(n)) return n;
  let best = valid[0];
  let bestDist = Math.abs(n - best);
  for (const v of valid) {
    const d = Math.abs(n - v);
    if (d < bestDist) { best = v; bestDist = d; }
  }
  return best;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  let model = typeof body.model === "string" ? (body.model as string).trim() : typeof body.videoModel === "string" ? (body.videoModel as string).trim() : "";
  if (!model) model = hasAgnesKeys() ? "agnes-video-v2.0" : "wan-2.2";

  const width = typeof body.width === "number" ? body.width : typeof body.w === "number" ? body.w : undefined;
  const height = typeof body.height === "number" ? body.height : typeof body.h === "number" ? body.h : undefined;
  const num_frames = typeof body.num_frames === "number" ? body.num_frames : typeof body.numFrames === "number" ? body.numFrames : typeof body.frames === "number" ? body.frames : undefined;
  const frame_rate = typeof body.frame_rate === "number" ? body.frame_rate : typeof body.frameRate === "number" ? body.frameRate : typeof body.fps === "number" ? body.fps : undefined;
  const negative_prompt = typeof body.negative_prompt === "string" ? body.negative_prompt : typeof body.negativePrompt === "string" ? body.negativePrompt : undefined;
  const seed = typeof body.seed === "number" ? body.seed : undefined;

  const images = normalizeImages(body);

  if (!prompt) return NextResponse.json({ error: "Describe the motion you want." }, { status: 400 });

  // Agnes path
  if (isAgnesVideoModel(model) || hasAgnesKeys() && model.startsWith("agnes-video")) {
    if (!hasAgnesKeys()) {
      return NextResponse.json({ success: false, error: "Agnes AI not configured. Add AGNES_API_KEY_1." }, { status: 503 });
    }
    // Validate images if provided, but Agnes supports text-to-video without image
    if (images) {
      for (const img of images) {
        if (!isValidImageInput(img)) {
          return NextResponse.json({ error: "Image must be a valid http(s) URL or data URI." }, { status: 400 });
        }
      }
    }

    // Normalize num_frames per 8n+1 rule: server snaps automatically
    const snapped = num_frames ? snapFrames(Math.round(num_frames)) : 121;

    try {
      const result = await agnesCreateVideo(
        {
          prompt,
          images,
          model,
          width,
          height,
          num_frames: snapped,
          frame_rate: frame_rate ? Math.round(frame_rate) : 24,
          negative_prompt,
          seed,
        },
        req.signal
      );
      return NextResponse.json({
        success: true,
        videoId: result.videoId,
        taskId: result.videoId,
        id: result.videoId,
        status: "queued",
        model,
        provider: "agnes",
        // For backward compat, also return polling URL hint
        pollUrl: `/api/video/${encodeURIComponent(result.videoId)}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Video creation failed.";
      console.error("[Agnes] video create error:", msg);
      return NextResponse.json(
        {
          success: false,
          error: msg.includes("not configured") ? msg : "Video generation failed. Please try again or switch model.",
          detail: process.env.NODE_ENV === "development" ? msg : undefined,
        },
        { status: /not configured/i.test(msg) ? 503 : 502 }
      );
    }
  }

  // CVRON path (legacy wan22 image-to-video, sync)
  const imageUrl = images?.[0] ?? (typeof body.imageUrl === "string" ? (body.imageUrl as string).trim() : "");
  if (!isSafeImageUrl(imageUrl)) {
    return NextResponse.json(
      { error: "WAN 2.2 is image-to-video only — a valid public source image URL is required." },
      { status: 400 }
    );
  }

  try {
    const { videoUrl } = await generateVideo(prompt, imageUrl);
    return NextResponse.json({ success: true, videoUrl, model: "wan-2.2", provider: "cvron" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Video generation failed.";
    return NextResponse.json(
      {
        success: false,
        error: "Video generation failed or timed out. Long jobs can take several minutes — please try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 502 }
    );
  }
}

// GET polling for Agnes: ?id=xxx or ?video_id=xxx
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || url.searchParams.get("video_id") || url.searchParams.get("task_id");
  if (!id) {
    return NextResponse.json({ error: "Missing video id. Provide ?id=<video_id>." }, { status: 400 });
  }
  if (!hasAgnesKeys()) {
    return NextResponse.json({ success: false, error: "Agnes not configured." }, { status: 503 });
  }
  try {
    const status = await agnesPollVideo(id, req.signal);
    const isDone = status.status === "completed" || status.status === "success";
    const videoUrl = status.video_url || status.videoUrl || status.url;
    if (isDone && videoUrl) {
      return NextResponse.json({ success: true, status: "completed", videoUrl, video_url: videoUrl, raw: status.raw });
    }
    if (status.status === "failed") {
      return NextResponse.json({ success: false, status: "failed", error: status.error || "Video generation failed.", raw: status.raw }, { status: 502 });
    }
    return NextResponse.json({ success: true, status: status.status, progress: status.progress, raw: status.raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Polling failed";
    return NextResponse.json({ success: false, error: msg, detail: process.env.NODE_ENV === "development" ? msg : undefined }, { status: 502 });
  }
}
