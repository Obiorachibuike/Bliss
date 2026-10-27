/* Provider routing for Bliss.
 *
 * Primary: CVRON FreeAiAPIs (key-less, single `prompt` GET endpoints).
 * Fallback: Agnes AI (OpenAI-compatible, Bearer key) — used in two situations:
 *   1. the primary provider failed after its own retries, and a key is configured;
 *   2. the user explicitly picked an `agnes-*` model, which skips the chain.
 *
 * The fallback is a real second provider, not a cached or invented answer: if it
 * also fails, the caller gets an honest error. Because Agnes accepts a `messages`
 * array, the fallback path sends the genuine multi-turn conversation instead of the
 * flattened prompt digest the primary needs.
 */
import { generateText } from "@/lib/api/text";
import { generateImage, editImage } from "@/lib/api/media";
import {
  agnesChat,
  agnesImage,
  createAgnesVideo,
  getAgnesVideoStatus,
  isAgnesConfigured,
  type AgnesMessage,
  type AgnesVideoRequest,
} from "@/lib/api/agnes";
import {
  AGNES_CHAT_MODELS,
  AGNES_FALLBACK_CHAT_MODEL,
  AGNES_IMAGE_MODEL,
  AGNES_VIDEO_MODEL,
  API_LIMITATIONS,
  RATIOS,
  isAgnesChatModel,
  isAgnesImageModel,
  type AgnesImageSize,
} from "@/lib/api/config";
import { FALLBACK_PROVIDER_LABEL } from "@/lib/api/fallback-env";
import { isValidUrl } from "@/lib/api/client";
import type { ModelId, ProviderId } from "@/lib/types";

export interface ChatTurn {
  role: unknown;
  content: unknown;
}

export interface ChatRequest {
  model: ModelId;
  /** Flattened digest for the single-prompt primary provider. */
  composedPrompt: string;
  /** The user's actual message, used as the last turn when the fallback answers. */
  userPrompt: string;
  history?: ChatTurn[];
  imageUrl?: string;
  signal?: AbortSignal;
}

export interface ChatProviderResult {
  text: string;
  provider: ProviderId;
  model: string;
  /** True when the reply came from the fallback provider after a primary failure. */
  fallbackUsed: boolean;
  error?: string;
}

const SYSTEM_PROMPT =
  "You are Bliss, a helpful AI assistant working inside a chat workspace. Answer with clear, well-structured markdown.";
/** Agnes keeps the whole thread, so only the per-turn size cap matters. */
const MAX_TURNS = 12;
const MAX_TURN_CHARS = 4000;

export function isFallbackModel(model: string): boolean {
  return isAgnesChatModel(model);
}

/** History + the current prompt become real chat turns; non-chat roles are dropped
 *  so nothing the user didn't write can be injected as a turn. */
export function buildFallbackMessages(
  prompt: string,
  history: ChatTurn[] | undefined,
  imageUrl?: string,
): AgnesMessage[] {
  const turns = (Array.isArray(history) ? history : [])
    .filter(
      (t): t is { role: "user" | "assistant"; content: string } =>
        !!t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim().length > 0,
    )
    .slice(-MAX_TURNS)
    .map(
      (t) =>
        ({
          role: t.role,
          content: t.content.trim().slice(0, MAX_TURN_CHARS),
        }) as AgnesMessage,
    );

  const current = prompt.trim().slice(0, MAX_TURN_CHARS);
  const last: AgnesMessage =
    imageUrl && isValidUrl(imageUrl)
      ? {
          role: "user",
          content: [
            { type: "text", text: current },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }
      : { role: "user", content: current };

  return [{ role: "system", content: SYSTEM_PROMPT }, ...turns, last];
}

/** Primary first, fallback second — and never after a user cancellation. */
export async function generateChatWithFallback(
  opts: ChatRequest,
): Promise<ChatProviderResult> {
  const { model, composedPrompt, userPrompt, history, imageUrl, signal } = opts;
  const cancelled = () => !!signal?.aborted;
  const fallbackMessages = () =>
    buildFallbackMessages(userPrompt, history, imageUrl);

  if (isFallbackModel(model)) {
    try {
      const text = await agnesChat({
        model,
        messages: fallbackMessages(),
        signal,
      });
      // Chosen explicitly, so this is not a fallback in the user's eyes.
      return { text, provider: "agnes", model, fallbackUsed: false };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Generation failed.";
      if (cancelled())
        return {
          text: "",
          provider: "unknown",
          model,
          fallbackUsed: false,
          error: "Request cancelled.",
        };
      return {
        text: "",
        provider: "unknown",
        model,
        fallbackUsed: false,
        error: message,
      };
    }
  }

  let primaryError = "The AI service did not answer.";
  try {
    const { response } = await generateText(model, composedPrompt, signal);
    return { text: response, provider: "cvron", model, fallbackUsed: false };
  } catch (e: unknown) {
    primaryError = e instanceof Error ? e.message : primaryError;
  }

  if (cancelled()) {
    return {
      text: "",
      provider: "unknown",
      model,
      fallbackUsed: false,
      error: "Request cancelled.",
    };
  }
  if (!isAgnesConfigured()) {
    return {
      text: "",
      provider: "unknown",
      model,
      fallbackUsed: false,
      error: primaryError,
    };
  }

  try {
    const text = await agnesChat({
      model: AGNES_FALLBACK_CHAT_MODEL,
      messages: fallbackMessages(),
      signal,
    });
    return {
      text,
      provider: "agnes",
      model: AGNES_FALLBACK_CHAT_MODEL,
      fallbackUsed: true,
    };
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : "The fallback provider failed.";
    if (cancelled()) {
      return {
        text: "",
        provider: "unknown",
        model,
        fallbackUsed: false,
        error: "Request cancelled.",
      };
    }
    return {
      text: "",
      provider: "unknown",
      model,
      fallbackUsed: false,
      error: `${primaryError} (fallback: ${message})`,
    };
  }
}

export interface ImageProviderResult {
  imageUrl: string;
  provider: ProviderId;
  model: string;
  fallbackUsed: boolean;
  error?: string;
}

/** `1024x1024` style sizes are legacy on Agnes: only documented ratio values are
 *  forwarded, everything else falls back to the provider default (1:1). */
export function normalizeRatio(ratio: string | undefined): string | undefined {
  if (!ratio) return undefined;
  return (RATIOS as readonly string[]).includes(ratio) ? ratio : undefined;
}

export async function generateImageWithFallback(opts: {
  prompt: string;
  mode: "generate" | "edit";
  sourceImageUrl?: string;
  ratio?: string;
  size?: AgnesImageSize;
  model?: string;
  signal?: AbortSignal;
}): Promise<ImageProviderResult> {
  const { prompt, mode, sourceImageUrl, ratio, size, signal } = opts;
  const primary = mode === "edit" ? "image editing" : "image";
  // Any documented Agnes image model counts as an explicit choice.
  const chosen = isAgnesImageModel(opts.model)
    ? (opts.model as string)
    : undefined;
  const agnesModel = chosen ?? AGNES_IMAGE_MODEL;

  const callFallback = async (
    explicit: boolean,
  ): Promise<ImageProviderResult> => {
    try {
      const imageUrl = await agnesImage({
        prompt,
        model: agnesModel,
        ...(size ? { size } : {}),
        ratio: normalizeRatio(ratio),
        ...(mode === "edit" && sourceImageUrl
          ? { imageUrls: [sourceImageUrl] }
          : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        imageUrl,
        provider: "agnes",
        model: agnesModel,
        fallbackUsed: !explicit,
      };
    } catch (e: unknown) {
      return {
        imageUrl: "",
        provider: "unknown",
        model: agnesModel,
        fallbackUsed: false,
        error:
          e instanceof Error
            ? e.message
            : `The fallback ${primary} service failed.`,
      };
    }
  };

  // An explicitly chosen fallback model must never be answered by the primary provider.
  if (chosen) return callFallback(true);

  try {
    const out =
      mode === "edit" && sourceImageUrl
        ? await editImage(prompt, sourceImageUrl)
        : await generateImage(prompt);
    return {
      imageUrl: out.imageUrl,
      provider: "cvron",
      model: mode === "edit" ? "image2image" : "flux-dev",
      fallbackUsed: false,
    };
  } catch (e: unknown) {
    const primaryError =
      e instanceof Error ? e.message : `The ${primary} service failed.`;
    if (signal?.aborted) {
      return {
        imageUrl: "",
        provider: "unknown",
        model: "flux-dev",
        fallbackUsed: false,
        error: "Request cancelled.",
      };
    }
    if (!isAgnesConfigured()) {
      return {
        imageUrl: "",
        provider: "unknown",
        model: "flux-dev",
        fallbackUsed: false,
        error: primaryError,
      };
    }
    const result = await callFallback(false);
    if (result.error)
      result.error = `${primaryError} (fallback: ${result.error})`;
    return result;
  }
}

/** Static description of the routing chain, safe to render anywhere. */
export const PROVIDER_CHAIN = [
  {
    id: "cvron",
    label: "CVRON FreeAiAPIs",
    role: "primary",
    timeout: API_LIMITATIONS.timeout,
  },
  {
    id: "agnes",
    label: FALLBACK_PROVIDER_LABEL,
    role: "fallback",
    models: AGNES_CHAT_MODELS.map((m) => m.id),
    imageModel: AGNES_IMAGE_MODEL,
    videoModel: AGNES_VIDEO_MODEL,
  },
] as const;

/* ── Video · asynchronous Agnes tasks ───────────────────────────────────────
 * There is no fallback chain here: WAN 2.2 is a single synchronous request and
 * Agnes video is a task you poll. Both are honest about their own failures, and
 * choosing an Agnes video model never silently answers with the other provider.
 */
export interface VideoJob {
  jobId: string;
  model: string;
  provider: "agnes";
  status: string;
  progress: number;
  error?: string;
  /** True when Bliss refused the input itself (HTTP 400 territory), as opposed to the
   *  provider being unreachable or erroring. */
  rejected?: boolean;
}

export async function startAgnesVideo(
  req: AgnesVideoRequest,
): Promise<VideoJob> {
  const model = req.model ?? AGNES_VIDEO_MODEL;
  if (!isAgnesConfigured()) {
    return {
      jobId: "",
      model,
      provider: "agnes",
      status: "failed",
      progress: 0,
      error:
        "Agnes video needs the optional fallback provider, which isn't enabled on this deployment. Set AGNES_API_KEY to switch it on.",
    };
  }
  try {
    const task = await createAgnesVideo(req);
    return {
      jobId: task.videoId,
      model: task.model,
      provider: "agnes",
      status: task.status,
      progress: task.progress,
    };
  } catch (e: unknown) {
    const rejected = (e as { rejected?: boolean } | null)?.rejected === true;
    return {
      jobId: "",
      model,
      provider: "agnes",
      status: "failed",
      progress: 0,
      // `rejected:true` means nothing was ever sent upstream, so the route can answer 400.
      ...(rejected ? { rejected: true } : {}),
      error:
        e instanceof Error
          ? e.message
          : "The fallback video service couldn't start the task.",
    };
  }
}

export interface VideoJobStatus {
  status: string;
  progress: number;
  videoUrl?: string;
  error?: string;
}

/** One poll of a task. The loop lives in the browser so no serverless function has to
 *  sit idle for minutes, and a reload can resume watching the same task. */
export async function pollAgnesVideo(
  videoId: string,
  model?: string,
): Promise<VideoJobStatus> {
  if (!isAgnesConfigured()) {
    return {
      status: "failed",
      progress: 0,
      error: "The fallback provider isn't enabled on this deployment.",
    };
  }
  try {
    const result = await getAgnesVideoStatus({ videoId, model });
    return result;
  } catch (e: unknown) {
    return {
      status: "failed",
      progress: 0,
      error:
        e instanceof Error
          ? e.message
          : "The video service couldn't be reached.",
    };
  }
}
