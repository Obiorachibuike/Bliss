/* Minimal client for the Agnes AI gateway — Bliss' optional fallback provider.
 * Docs: https://www.agnes-ai.com/en/docs (quickstart, model pages, error codes)
 *
 * Everything here is server-only: the bearer key is read from the environment and
 * never leaves the process. Two documented endpoints are used:
 *   POST {base}/chat/completions   (OpenAI-compatible)
 *   POST {base}/images/generations
 *
 * Nothing is simulated: if the key is missing the calls throw a clear error, and if
 * a response is not a usable completion the error propagates instead of becoming a
 * placeholder answer.
 */
import {
  AGNES_BASE_URL,
  AGNES_IMAGE_MODEL,
  AGNES_LIMITS,
  AGNES_VIDEO_MODEL,
  AGNES_VIDEO_MODELS,
  AGNES_IMAGE_SIZES,
  AGNES_VIDEO_SECONDS,
  API_LIMITATIONS,
  RATIOS,
  agnesVideoModel,
  isAgnesImageModel,
  isAgnesVideoModel,
  type AgnesImageSize,
  type AgnesVideoMode,
} from "@/lib/api/config";
import { AGNES_API_KEY, AGNES_FALLBACK_ENABLED } from "@/lib/api/fallback-env";
import { isValidUrl } from "@/lib/api/client";

export interface AgnesMessage {
  role: "system" | "user" | "assistant";
  content: string | AgnesContentPart[];
}

export interface AgnesContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export class AgnesNotConfiguredError extends Error {
  constructor() {
    super(
      "The Agnes fallback provider isn't enabled on this deployment (set AGNES_API_KEY).",
    );
    this.name = "AgnesNotConfiguredError";
  }
}

export function isAgnesConfigured(): boolean {
  return AGNES_FALLBACK_ENABLED;
}

/** Docs publish ~20 executable RPM on the free tier, so a single request is retried once. */
const RETRIES = 1;

function friendlyHttpError(status: number): string {
  switch (status) {
    case 400:
      return "The fallback provider rejected the request.";
    case 401:
    case 403:
      return "The fallback provider rejected its API key.";
    case 402:
      return "The fallback provider account has no remaining quota.";
    case 408:
      return "The fallback provider took too long to answer.";
    case 413:
      return "The conversation is too long for the fallback provider.";
    case 422:
      return "The fallback provider couldn't process those parameters.";
    case 429:
      return "The fallback provider is rate limited. Try again shortly.";
    default:
      return status >= 500
        ? "The fallback provider is unavailable right now."
        : `The fallback provider returned HTTP ${status}.`;
  }
}

interface RawCall {
  ok: boolean;
  status: number;
  payload: unknown;
  bodyText: string;
}

/** A 200 response is not proof of success: gateways return HTML pages, error
 *  envelopes and truncated JSON. Every body is therefore read as text, parsed
 *  defensively and validated by the caller. */
async function callAgnes(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawCall> {
  let lastError = "The fallback provider could not be reached.";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("Request cancelled.");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${AGNES_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AGNES_API_KEY}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = friendlyHttpError(res.status);
        // 4xx (except 408/429) will not improve on retry.
        if (
          res.status >= 400 &&
          res.status < 500 &&
          res.status !== 408 &&
          res.status !== 429
        ) {
          throw new Error(lastError);
        }
        continue;
      }
      const trimmed = text.trim();
      if (!trimmed)
        throw new Error("The fallback provider returned an empty response.");
      if (trimmed.startsWith("<")) {
        throw new Error(
          "The fallback provider returned an HTML page instead of JSON.",
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        throw new Error("The fallback provider returned malformed JSON.");
      }
      return { ok: true, status: res.status, payload, bodyText: trimmed };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(message)) throw new Error("Request cancelled.");
      if (/AbortError|TimeoutError/.test(message)) {
        lastError = "The fallback provider timed out.";
      } else if (!/fallback provider/i.test(message)) {
        lastError = "The fallback provider could not be reached.";
      } else {
        throw e;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new Error(lastError);
}

/** Extract assistant text from an OpenAI-compatible completion. Content may be a
 *  string or a block array, and reasoning models can prefix thinking blocks. */
export function parseAgnesCompletion(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("The fallback provider returned no usable response.");
  }
  const obj = payload as Record<string, unknown>;

  if (typeof obj.error === "string" && obj.error.trim())
    throw new Error(obj.error.trim());
  const err = obj.error;
  if (err && typeof err === "object") {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) throw new Error(m.trim());
  }

  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("The fallback provider returned no completion choices.");
  }
  const first = choices[0] as Record<string, unknown>;
  const message = (first.message ?? first.delta) as
    Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    throw new Error("The fallback provider returned an empty message.");
  }

  const fromBlocks = (value: unknown): string => {
    if (!Array.isArray(value)) return "";
    return value
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const b = block as Record<string, unknown>;
        if (b.type === "text" || b.type === "output_text") {
          return typeof b.text === "string" ? b.text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  };

  const content = message.content;
  let text = "";
  if (typeof content === "string") text = content.trim();
  else if (Array.isArray(content)) text = fromBlocks(content);
  if (!text) text = fromBlocks(message.content);
  if (!text && typeof message.reasoning_content === "string") {
    text = message.reasoning_content.trim();
  }
  if (!text)
    throw new Error("The fallback provider returned an empty completion.");
  return text;
}

export interface AgnesChatOptions {
  model: string;
  messages: AgnesMessage[];
  signal?: AbortSignal;
}

export async function agnesChat({
  model,
  messages,
  signal,
}: AgnesChatOptions): Promise<string> {
  if (!isAgnesConfigured()) throw new AgnesNotConfiguredError();
  if (messages.length === 0) throw new Error("A prompt is required.");

  const { payload } = await callAgnes(
    "/chat/completions",
    {
      model,
      messages,
      temperature: AGNES_LIMITS.temperature,
      max_tokens: AGNES_LIMITS.maxOutputTokens,
      stream: false,
    },
    AGNES_LIMITS.timeout,
    signal,
  );
  return parseAgnesCompletion(payload);
}

export interface AgnesImageOptions {
  prompt: string;
  /** Documented Agnes image model; defaults to the configured fallback model. */
  model?: string;
  /** Public http(s) references for image-to-image; omitted for pure generation. */
  imageUrls?: string[];
  ratio?: string;
  /** Documented output tier: 1K | 2K | 3K | 4K. */
  size?: AgnesImageSize;
  signal?: AbortSignal;
}

/** Returns `data[0].url`. `b64_json` output is intentionally not requested: Bliss
 *  hands URLs to the browser and to the image→video endpoint, and inline base64
 *  would break both. */
export async function agnesImage({
  prompt,
  model,
  imageUrls = [],
  ratio,
  size = "1K",
  signal,
}: AgnesImageOptions): Promise<string> {
  if (!isAgnesConfigured()) throw new AgnesNotConfiguredError();
  if (model !== undefined && !isAgnesImageModel(model)) {
    throw new Error("That image model isn't a documented Agnes model.");
  }
  if (!(AGNES_IMAGE_SIZES as readonly string[]).includes(size)) {
    throw new Error(
      "Image size must be one of the documented tiers: 1K, 2K, 3K or 4K.",
    );
  }
  const clean = prompt.trim();
  if (!clean) throw new Error("Describe the image you want to create.");
  if (clean.length > API_LIMITATIONS.maxPromptLength) {
    throw new Error("Image prompt is too long for the fallback provider.");
  }
  const refs = imageUrls.filter(
    (u) => isValidUrl(u) || u.startsWith("data:image/"),
  );

  const extraBody: Record<string, unknown> = { response_format: "url" };
  if (refs.length > 0) extraBody.image = refs;

  const body: Record<string, unknown> = {
    model: model ?? AGNES_IMAGE_MODEL,
    prompt: clean,
    size,
    extra_body: extraBody,
  };
  if (ratio && (RATIOS as readonly string[]).includes(ratio))
    body.ratio = ratio;

  const timeout =
    refs.length > 0 ? AGNES_LIMITS.imageEditTimeout : AGNES_LIMITS.imageTimeout;
  const { payload } = await callAgnes(
    "/images/generations",
    body,
    timeout,
    signal,
  );
  return parseAgnesImage(payload);
}

export function parseAgnesImage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error(
      "The fallback image service returned an unexpected response.",
    );
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim())
    throw new Error(obj.error.trim());
  const data = obj.data;
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== "object") {
    throw new Error("The fallback image service returned no image data.");
  }
  const record = first as Record<string, unknown>;
  const url = record.url;
  if (typeof url === "string" && isValidUrl(url)) return url;
  if (typeof url === "string" && url.trim()) {
    throw new Error(
      "The fallback image service returned an unusable image URL.",
    );
  }
  if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
    throw new Error(
      "The fallback provider returned base64 output, which Bliss can't host — try again.",
    );
  }
  throw new Error("The fallback image service did not return a usable URL.");
}

/* ── Video · asynchronous tasks ───────────────────────────────────────────
 * Docs (https://wiki.agnes-ai.com/en/docs/agnes-video-25.md): create a task with
 * POST {base}/videos, then poll GET {origin}/agnesapi?video_id=…&model_name=…
 * until `status` is `completed` or `failed`, and read the result from the top-level
 * `url`. `internal_status` / `internal_progress` are explicitly NOT authoritative.
 *
 * Every documented validation rule is checked locally first: the docs guarantee
 * that invalid video requests never create a task and are never billed, so failing
 * early saves the account's (very small) free-tier quota.
 */
export type { AgnesVideoMode };

export interface AgnesVideoRequest {
  model?: string;
  prompt: string;
  /** Omitted = "text", the provider's own default. */
  mode?: AgnesVideoMode;
  /** Seconds of output; documented range "4"–"12", default "5". */
  seconds?: number;
  size?: string;
  aspectRatio?: string;
  firstFrame?: string;
  lastFrame?: string;
  images?: string[];
  audios?: string[];
  referenceVideo?: {
    url: string;
    startSeconds?: number;
    requireAudio?: boolean;
  };
  seed?: number;
  signal?: AbortSignal;
}

export interface AgnesVideoTask {
  videoId: string;
  taskId: string;
  model: string;
  status: string;
  progress: number;
}

export interface AgnesVideoStatusResult {
  status: string;
  progress: number;
  /** Present only when status is `completed`. */
  videoUrl?: string;
  /** Provider-reported failure, already flattened to a sentence. */
  error?: string;
}

const publicUrl = (value: string | undefined): value is string =>
  typeof value === "string" && isValidUrl(value.trim());

/** A request Bliss refused on its own — the documented contract says the provider
 *  answers these with HTTP 400, so there is no point spending a request (or quota). */
export class AgnesRequestRejectedError extends Error {
  readonly rejected = true;
  constructor(message: string) {
    super(message);
    this.name = "AgnesRequestRejectedError";
  }
}

/** Build the documented request body, throwing on anything the provider would 400 on. */
export function buildAgnesVideoBody(
  req: AgnesVideoRequest,
): Record<string, unknown> {
  const model = req.model ?? AGNES_VIDEO_MODEL;
  const spec = agnesVideoModel(model);
  if (!spec)
    throw new Error("That video model isn't a documented Agnes model.");

  const prompt = req.prompt.trim();
  if (!prompt) throw new Error("Describe the motion you want in the video.");
  if (prompt.length > API_LIMITATIONS.maxPromptLength) {
    throw new Error("The video prompt is too long for the fallback provider.");
  }

  const seconds = req.seconds ?? AGNES_VIDEO_SECONDS.default;
  if (
    !Number.isInteger(seconds) ||
    seconds < AGNES_VIDEO_SECONDS.min ||
    seconds > AGNES_VIDEO_SECONDS.max
  ) {
    throw new Error(
      `Video duration must be a whole number of seconds between ${AGNES_VIDEO_SECONDS.min} and ${AGNES_VIDEO_SECONDS.max}.`,
    );
  }

  const size = req.size ?? spec.sizes[0];
  if (!spec.sizes.includes(size)) {
    throw new Error(`${spec.name} supports ${spec.sizes.join(", ")} only.`);
  }

  const aspectRatio = req.aspectRatio ?? "16:9";
  if (!spec.ratios.includes(aspectRatio)) {
    throw new Error(
      `${spec.name} supports these aspect ratios: ${spec.ratios.join(", ")}.`,
    );
  }

  const images = (req.images ?? []).map((u) => u.trim()).filter(Boolean);
  const audios = (req.audios ?? []).map((u) => u.trim()).filter(Boolean);
  const firstFrame = req.firstFrame?.trim() ?? "";
  const lastFrame = req.lastFrame?.trim() ?? "";
  const videoUrl = req.referenceVideo?.url?.trim() ?? "";

  for (const candidate of [
    ...images,
    ...audios,
    firstFrame,
    lastFrame,
    videoUrl,
  ]) {
    if (candidate && !publicUrl(candidate)) {
      throw new Error(
        "Every media reference must be a publicly reachable http(s) URL.",
      );
    }
  }

  if (images.length > spec.maxImages) {
    throw new Error(
      `${spec.name} accepts at most ${spec.maxImages} reference images.`,
    );
  }
  if (audios.length > spec.maxAudios) {
    throw new Error(
      `${spec.name} accepts at most ${spec.maxAudios} reference audio clips.`,
    );
  }
  if (images.length + audios.length + (videoUrl ? 1 : 0) > 12) {
    throw new Error(
      "Agnes accepts at most 12 reference media files in one request.",
    );
  }

  const body: Record<string, unknown> = {
    model,
    prompt,
    seconds: String(seconds),
    size,
    aspect_ratio: aspectRatio,
  };
  if (
    typeof req.seed === "number" &&
    Number.isInteger(req.seed) &&
    req.seed >= 0
  )
    body.seed = req.seed;

  /* `mode` is optional upstream and defaults to "text"; anything else must be an
   * explicit choice, so an omitted mode can never turn into a reference request. */
  const mode = req.mode ?? "text";
  if (mode === "text") {
    if (images.length || audios.length || firstFrame || lastFrame || videoUrl) {
      throw new Error(
        "Text mode takes a prompt only — remove the media references or switch mode.",
      );
    }
    body.mode = "text";
    return body;
  }

  if (mode === "keyframe") {
    if (!firstFrame && !lastFrame)
      throw new Error(
        "Keyframe mode needs a first frame, a last frame, or both.",
      );
    if (images.length || audios.length || videoUrl) {
      throw new Error(
        "Keyframe mode accepts first_frame/last_frame only — use Reference mode for media sets.",
      );
    }
    body.mode = "keyframe";
    if (firstFrame) body.first_frame = firstFrame;
    if (lastFrame) body.last_frame = lastFrame;
    return body;
  }

  // reference
  if (!images.length && !audios.length && !videoUrl) {
    throw new Error(
      "Reference mode needs at least one image, audio or video URL.",
    );
  }
  if (firstFrame || lastFrame) {
    throw new Error(
      "Reference mode doesn't take first/last frames — use Keyframe mode for those.",
    );
  }
  if (videoUrl && !spec.videoReference) {
    throw new Error(
      `${spec.name} doesn't accept reference videos — use ${AGNES_VIDEO_MODELS[1].id}.`,
    );
  }
  body.mode = "reference";
  if (images.length) body.images = images;
  if (audios.length) body.audios = audios;
  if (videoUrl) {
    body.videos = [
      {
        url: videoUrl,
        ...(typeof req.referenceVideo?.startSeconds === "number"
          ? { start_seconds: req.referenceVideo.startSeconds }
          : {}),
        ...(req.referenceVideo?.requireAudio === true
          ? { require_audio: true }
          : {}),
      },
    ];
  }
  return body;
}

/** Create an asynchronous video task. Returns the ids needed for polling. */
export async function createAgnesVideo(
  req: AgnesVideoRequest,
): Promise<AgnesVideoTask> {
  if (!isAgnesConfigured()) throw new AgnesNotConfiguredError();
  if (!isAgnesVideoModel(req.model ?? AGNES_VIDEO_MODEL))
    throw new Error("Unknown Agnes video model.");
  /* Anything the provider would answer with a 400 is rejected here, before a request
   * leaves the server: no quota is spent, and the caller can tell "your input is
   * invalid" apart from "the service is down". */
  let body: Record<string, unknown>;
  try {
    body = buildAgnesVideoBody(req);
  } catch (e: unknown) {
    throw new AgnesRequestRejectedError(
      e instanceof Error ? e.message : "That video request isn't valid.",
    );
  }

  let raw: RawCall;
  try {
    raw = await callAgnes(
      "/videos",
      body,
      AGNES_LIMITS.videoCreateTimeout,
      req.signal,
    );
  } catch (e: unknown) {
    // A create failure is reported verbatim: no polling starts without a task.
    throw e instanceof Error
      ? e
      : new Error("The fallback video service could not be reached.");
  }
  return parseAgnesVideoTask(raw.payload, String(body.model));
}

export function parseAgnesVideoTask(
  payload: unknown,
  model: string,
): AgnesVideoTask {
  if (!payload || typeof payload !== "object") {
    throw new Error(
      "The fallback video service returned an unexpected response.",
    );
  }
  const obj = payload as Record<string, unknown>;
  const err = obj.error;
  if (err && typeof err === "object") {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) throw new Error(m.trim());
  }
  if (typeof err === "string" && err.trim()) throw new Error(err.trim());

  const videoId =
    typeof obj.video_id === "string" && obj.video_id.trim()
      ? obj.video_id.trim()
      : "";
  const taskId =
    typeof obj.task_id === "string" && obj.task_id.trim()
      ? obj.task_id.trim()
      : "";
  const fallbackId =
    typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : "";
  // Docs: `video_id` is the retrieval key; `id`/`task_id` identify the task. The
  // Python sample falls back to `id`, so Bliss mirrors that rather than inventing one.
  const resolved = videoId || fallbackId;
  if (!resolved)
    throw new Error(
      "The fallback video service didn't return a task id — nothing to poll.",
    );

  const progress =
    typeof obj.progress === "number" && Number.isFinite(obj.progress)
      ? obj.progress
      : 0;
  const status =
    typeof obj.status === "string" && obj.status.trim()
      ? obj.status.trim()
      : "queued";
  return {
    videoId: resolved,
    taskId: taskId || fallbackId || resolved,
    model,
    status,
    progress,
  };
}

/** The retrieval endpoint sits on the API origin, not under /v1. */
export function agnesVideoStatusUrl(videoId: string, model: string): string {
  const origin = new URL(AGNES_BASE_URL).origin;
  const params = new URLSearchParams({ video_id: videoId, model_name: model });
  return `${origin}/agnesapi?${params.toString()}`;
}

/** One poll. Bliss keeps the loop on the client so a serverless function never has to
 *  sit idle for minutes (and a page reload can resume watching the same task). */
export async function getAgnesVideoStatus(opts: {
  videoId: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<AgnesVideoStatusResult> {
  if (!isAgnesConfigured()) throw new AgnesNotConfiguredError();
  const videoId = opts.videoId.trim();
  if (!/^[A-Za-z0-9_.:-]{4,120}$/.test(videoId))
    throw new Error("That video task id isn't valid.");
  const model = opts.model ?? AGNES_VIDEO_MODEL;
  if (!isAgnesVideoModel(model)) throw new Error("Unknown Agnes video model.");

  let res: Response;
  try {
    res = await fetch(agnesVideoStatusUrl(videoId, model), {
      method: "GET",
      headers: { Authorization: `Bearer ${AGNES_API_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(AGNES_LIMITS.videoPollTimeout),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    // Transient by design: the task keeps running, the client just polls again.
    return {
      status: "in_progress",
      progress: 0,
      error: "Couldn't reach the video service — retrying.",
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      status: "in_progress",
      progress: 0,
      error: `${friendlyHttpError(res.status)} (HTTP ${res.status})`,
    };
  }
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) {
    return {
      status: "in_progress",
      progress: 0,
      error: "The video service returned a non-JSON response — retrying.",
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return {
      status: "in_progress",
      progress: 0,
      error: "The video service returned malformed JSON — retrying.",
    };
  }
  return parseAgnesVideoStatus(payload);
}

export function parseAgnesVideoStatus(
  payload: unknown,
): AgnesVideoStatusResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("The video service returned an unexpected response.");
  }
  const obj = payload as Record<string, unknown>;
  const status =
    typeof obj.status === "string" && obj.status.trim()
      ? obj.status.trim()
      : "in_progress";
  const progress =
    typeof obj.progress === "number" && Number.isFinite(obj.progress)
      ? Math.max(0, Math.min(100, obj.progress))
      : 0;

  const err = obj.error;
  const errorMessage =
    typeof err === "string" && err.trim()
      ? err.trim()
      : err && typeof err === "object"
        ? typeof (err as Record<string, unknown>).message === "string"
          ? String((err as Record<string, unknown>).message)
          : "The video task failed."
        : undefined;

  if (status === "failed") {
    return {
      status,
      progress,
      error: errorMessage ?? "The video task failed.",
    };
  }
  if (status === "completed") {
    const url = obj.url;
    if (typeof url === "string" && isValidUrl(url.trim()))
      return { status, progress: 100, videoUrl: url.trim() };
    return {
      status,
      progress,
      error:
        "The video service reported completion without a usable URL. The task may still be finalising — try again shortly.",
    };
  }
  return { status, progress, ...(errorMessage ? { error: errorMessage } : {}) };
}
