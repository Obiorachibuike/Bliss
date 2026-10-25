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
import { AGNES_BASE_URL, AGNES_IMAGE_MODEL, AGNES_LIMITS, API_LIMITATIONS, RATIOS } from "@/lib/api/config";
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
    super("The Agnes fallback provider isn't enabled on this deployment (set AGNES_API_KEY).");
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
  signal?: AbortSignal
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
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new Error(lastError);
        }
        continue;
      }
      const trimmed = text.trim();
      if (!trimmed) throw new Error("The fallback provider returned an empty response.");
      if (trimmed.startsWith("<")) {
        throw new Error("The fallback provider returned an HTML page instead of JSON.");
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

  if (typeof obj.error === "string" && obj.error.trim()) throw new Error(obj.error.trim());
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
  const message = (first.message ?? first.delta) as Record<string, unknown> | undefined;
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
  if (!text) throw new Error("The fallback provider returned an empty completion.");
  return text;
}

export interface AgnesChatOptions {
  model: string;
  messages: AgnesMessage[];
  signal?: AbortSignal;
}

export async function agnesChat({ model, messages, signal }: AgnesChatOptions): Promise<string> {
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
    signal
  );
  return parseAgnesCompletion(payload);
}

export interface AgnesImageOptions {
  prompt: string;
  /** Public http(s) references for image-to-image; omitted for pure generation. */
  imageUrls?: string[];
  ratio?: string;
  /** Documented output tier: 1K | 2K | 3K | 4K. */
  size?: "1K" | "2K" | "3K" | "4K";
  signal?: AbortSignal;
}

/** Returns `data[0].url`. `b64_json` output is intentionally not requested: Bliss
 *  hands URLs to the browser and to the image→video endpoint, and inline base64
 *  would break both. */
export async function agnesImage({
  prompt,
  imageUrls = [],
  ratio,
  size = "1K",
  signal,
}: AgnesImageOptions): Promise<string> {
  if (!isAgnesConfigured()) throw new AgnesNotConfiguredError();
  const clean = prompt.trim();
  if (!clean) throw new Error("Describe the image you want to create.");
  if (clean.length > API_LIMITATIONS.maxPromptLength) {
    throw new Error("Image prompt is too long for the fallback provider.");
  }
  const refs = imageUrls.filter((u) => isValidUrl(u) || u.startsWith("data:image/"));

  const extraBody: Record<string, unknown> = { response_format: "url" };
  if (refs.length > 0) extraBody.image = refs;

  const body: Record<string, unknown> = {
    model: AGNES_IMAGE_MODEL,
    prompt: clean,
    size,
    extra_body: extraBody,
  };
  if (ratio && (RATIOS as readonly string[]).includes(ratio)) body.ratio = ratio;

  const timeout = refs.length > 0 ? AGNES_LIMITS.imageEditTimeout : AGNES_LIMITS.imageTimeout;
  const { payload } = await callAgnes("/images/generations", body, timeout, signal);
  return parseAgnesImage(payload);
}

export function parseAgnesImage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("The fallback image service returned an unexpected response.");
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string" && obj.error.trim()) throw new Error(obj.error.trim());
  const data = obj.data;
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== "object") {
    throw new Error("The fallback image service returned no image data.");
  }
  const record = first as Record<string, unknown>;
  const url = record.url;
  if (typeof url === "string" && isValidUrl(url)) return url;
  if (typeof url === "string" && url.trim()) {
    throw new Error("The fallback image service returned an unusable image URL.");
  }
  if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
    throw new Error("The fallback provider returned base64 output, which Bliss can't host — try again.");
  }
  throw new Error("The fallback image service did not return a usable URL.");
}
