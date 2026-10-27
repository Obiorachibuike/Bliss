// Text generation service — wraps the CVRON LLM endpoints.
// Docs: https://github.com/cvroon-api/FreeAiAPIs
// All chat endpoints are GET with a single `prompt` query param.
import { ENDPOINTS, API_LIMITATIONS } from "@/lib/api/config";
import type { ModelId } from "@/lib/types";
import { fetchJson, validatePrompt } from "@/lib/api/client";

export interface TextResponse {
  response: string;
  raw: unknown;
}

/** Only the key-less CVRON models are addressable here; `agnes-*` ids are served by
 *  the fallback provider (see provider.ts) and intentionally have no endpoint. */
const MODEL_ENDPOINT: Partial<Record<ModelId, string>> = {
  llama: ENDPOINTS.chat.llama,
  "gpt-5-nano": ENDPOINTS.chat.gpt5nano,
  "gemini-2.5-flash-lite": ENDPOINTS.chat.gemini,
  "deepseek-v3.2": ENDPOINTS.chat.deepseek,
};

export function resolveEndpoint(model: ModelId): string {
  const url = MODEL_ENDPOINT[model];
  if (!url) {
    throw new Error(
      `Model "${model}" is not served by the key-less upstream — it belongs to the fallback provider.`,
    );
  }
  return url;
}

/** Upstream responses are documented as { success, response, prompt, author } but
 *  must never be trusted blindly — we validate every field. */
export function parseChatPayload(payload: unknown): string {
  if (typeof payload === "string") {
    const s = payload.trim();
    // Some gateways answer 200 with an HTML error page — never render that as an answer.
    if (!s || s.startsWith("<")) {
      throw new Error(
        "The AI service returned HTML instead of JSON. It may be rate-limited or offline.",
      );
    }
    return s;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("The AI service returned an unexpected response.");
  }
  const obj = payload as Record<string, unknown>;

  if (obj.success === false) {
    const msg =
      typeof obj.message === "string"
        ? obj.message
        : "The model reported a failure.";
    throw new Error(msg);
  }

  const candidates = [
    obj.response,
    obj.text,
    obj.output,
    obj.result,
    obj.answer,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }

  throw new Error(
    "The AI service returned no usable response. Please try again.",
  );
}

export async function generateText(
  model: ModelId,
  prompt: string,
  signal?: AbortSignal,
): Promise<TextResponse> {
  const invalid = validatePrompt(prompt, API_LIMITATIONS.maxPromptLength);
  if (invalid) throw new Error(invalid);

  const url = `${resolveEndpoint(model)}?prompt=${encodeURIComponent(prompt)}`;

  let lastError = "Unknown error";
  for (let attempt = 0; attempt <= API_LIMITATIONS.retries; attempt++) {
    if (signal?.aborted) throw new Error("Request cancelled.");
    try {
      const res = await fetchJson<unknown>(
        url,
        { cache: "no-store" },
        API_LIMITATIONS.timeout,
      );
      if (!res.success) {
        lastError = res.error || "Request failed";
        // Only retry on transient network failures, not on 4xx
        if (/4\d\d/.test(lastError)) break;
        continue;
      }
      const text = parseChatPayload(res.data);
      return { response: text, raw: res.raw };
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (lastError.includes("cancel")) throw new Error("Request cancelled.");
    }
  }
  throw new Error(lastError);
}
