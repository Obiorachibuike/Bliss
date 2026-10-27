// Image generation + editing (Flux Dev, image2image) and video (WAN 2.2) services.
// Docs: https://github.com/cvroon-api/FreeAiAPIs
import { ENDPOINTS } from "@/lib/api/config";
import { isValidUrl } from "@/lib/api/client";

const IMAGE_KEYS = ["image_url", "imageUrl", "url", "link", "image"];
const VIDEO_KEYS = ["videoUrl", "video_url", "url", "link", "video"];

/** Upstream payloads are untrusted: a 200 response may still be HTML, an error
 *  envelope, or JSON without a usable media URL. */
async function readUpstreamJson(res: Response): Promise<unknown> {
  const text = (await res.text()).trim();
  if (!text) throw new Error("The media service returned an empty response.");
  if (text.startsWith("<")) {
    throw new Error(
      "The media service returned an HTML error page instead of JSON. It may be busy — please retry.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The media service returned a malformed response.");
  }
}

function parseMediaPayload(
  payload: unknown,
  keys: string[],
  kind: string,
): string {
  if (typeof payload === "string") {
    const s = payload.trim();
    if (isValidUrl(s)) return s;
    throw new Error(
      `The ${kind} service returned plain text without a media URL.`,
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(`The ${kind} service returned an unexpected response.`);
  }

  const obj = payload as Record<string, unknown>;
  if (obj.success === false) {
    const message =
      typeof obj.message === "string"
        ? obj.message
        : `The ${kind} service reported a failure.`;
    throw new Error(message);
  }

  const scan = (record: Record<string, unknown>): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && isValidUrl(value)) return value;
    }
    return null;
  };

  const direct = scan(obj);
  if (direct) return direct;

  // Nested shapes occasionally show up: { data: { url } } / { result: { image_url } }
  for (const key of ["data", "result", "output"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object") {
      const inner = scan(nested as Record<string, unknown>);
      if (inner) return inner;
    }
  }

  throw new Error(
    `The ${kind} service did not return a usable URL — generation likely failed upstream.`,
  );
}

async function callMediaService(
  url: string,
  keys: string[],
  kind: string,
  timeoutMs: number,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    ) {
      throw new Error(
        `The ${kind} service took too long to respond. Please try again.`,
      );
    }
    throw new Error(
      `Bliss couldn't reach the ${kind} service. Please try again.`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `The ${kind} service is unavailable right now (HTTP ${res.status}).`,
    );
  }
  return parseMediaPayload(await readUpstreamJson(res), keys, kind);
}

export interface ImageResult {
  imageUrl: string;
}

export async function generateImage(prompt: string): Promise<ImageResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Describe the image you want to create.");
  if (trimmed.length > 1000)
    throw new Error("Image prompts are limited to 1000 characters.");
  const url = `${ENDPOINTS.image.fluxDev}?prompt=${encodeURIComponent(trimmed)}`;
  return {
    imageUrl: await callMediaService(url, IMAGE_KEYS, "image", 120_000),
  };
}

export async function editImage(
  prompt: string,
  imageUrl: string,
): Promise<ImageResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Describe how the image should change.");
  if (!isValidUrl(imageUrl)) {
    throw new Error(
      "The source image must be a valid http(s) URL that the provider can fetch publicly.",
    );
  }
  const params = new URLSearchParams({ prompt: trimmed, image_url: imageUrl });
  const url = `${ENDPOINTS.image.image2image}?${params.toString()}`;
  return {
    imageUrl: await callMediaService(url, IMAGE_KEYS, "image editing", 180_000),
  };
}

export interface VideoResult {
  videoUrl: string;
}

/**
 * WAN 2.2 is image-to-video only and completes inside one long HTTP request — the
 * provider documents no job id, polling endpoint or callback, so there is nothing
 * to poll and no partial progress to report.
 */
export async function generateVideo(
  prompt: string,
  imageUrl: string,
): Promise<VideoResult> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Describe the motion you want in the video.");
  if (!isValidUrl(imageUrl)) {
    throw new Error(
      "A valid, publicly accessible source image URL is required.",
    );
  }
  const params = new URLSearchParams({ prompt: trimmed, image: imageUrl });
  const url = `${ENDPOINTS.video.wan22}?${params.toString()}`;
  return {
    videoUrl: await callMediaService(url, VIDEO_KEYS, "video", 280_000),
  };
}

/** FileBin host (GET up.php?url=IMAGE_URL). The response shape is undocumented, so the
 *  parsed value is validated before it is ever handed to another endpoint. */
export async function hostImage(imageUrl: string): Promise<string> {
  if (!isValidUrl(imageUrl))
    throw new Error("Provide a valid image URL to host.");
  const url = `${ENDPOINTS.image.up}?url=${encodeURIComponent(imageUrl)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error(
      "Bliss couldn't reach the image host. Paste a public URL instead.",
    );
  }
  if (!res.ok)
    throw new Error(
      `The image host is unavailable right now (HTTP ${res.status}).`,
    );
  const text = (await res.text()).trim();
  if (isValidUrl(text)) return text;
  try {
    return parseMediaPayload(JSON.parse(text), IMAGE_KEYS, "image host");
  } catch {
    throw new Error("The image host didn't return a usable URL.");
  }
}
