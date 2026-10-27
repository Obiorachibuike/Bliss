import { NextResponse } from "next/server";
import { MODELS_WITH_FALLBACK } from "@/lib/api/config";
import { generateChatWithFallback, isFallbackModel } from "@/lib/api/provider";
import { isAgnesConfigured } from "@/lib/api/agnes";
import { clientIp, createLimiter } from "@/lib/api/rate-limit";
import type { ModelId } from "@/lib/types";

export const maxDuration = 90;

const VALID_MODELS = new Set<string>(MODELS_WITH_FALLBACK.map((m) => m.id));
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 900;
const MAX_BODY_CHARS = 24_000;
/** Documented upstream budget for a single `prompt` parameter. */
const PROMPT_BUDGET = 4000;

/* A free upstream must not become an open endpoint: 20 requests / minute / IP. */
const limiter = createLimiter(20);

interface HistoryTurn {
  role: unknown;
  content: unknown;
}

/** The upstream is single-turn, so recent turns are folded into one prompt.
 *  Anything that isn't a plain user/assistant string is dropped, and the total is
 *  kept inside the documented prompt budget so long threads degrade gracefully. */
export function buildContextPrompt(
  prompt: string,
  history: HistoryTurn[] | undefined,
): string {
  const turns = (Array.isArray(history) ? history : []).filter(
    (t): t is { role: string; content: string } =>
      !!t &&
      (t.role === "user" || t.role === "assistant") &&
      typeof t.content === "string" &&
      t.content.trim().length > 0,
  );

  if (turns.length === 0) return prompt.slice(0, PROMPT_BUDGET);

  const header =
    "You are Bliss, a helpful AI assistant. Continue the conversation below and answer only the final user message.";
  const footer = "Assistant:";
  const current = `User: ${prompt.slice(0, PROMPT_BUDGET)}`;
  let used = header.length + footer.length + current.length + turns.length + 8;

  // Walk backwards from the newest turn so the most recent context survives truncation.
  const kept: string[] = [];
  for (const turn of [...turns].reverse().slice(0, MAX_TURNS)) {
    const line = `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content.trim().slice(0, MAX_TURN_CHARS)}`;
    if (used + line.length + 1 > PROMPT_BUDGET) break;
    kept.unshift(line);
    used += line.length + 1;
  }

  return [header, "", ...kept, current, footer].join("\n");
}

/** Models sometimes echo the scaffold we appended — strip it. */
export function stripScaffold(text: string): string {
  return text
    .replace(/^\s*Assistant:\s*/i, "")
    .replace(/^\s*Bliss:\s*/i, "")
    .trim();
}

/** The composer inserts pasted images as `![reference image](url)`; the fallback
 *  provider can actually look at that URL, so pull it back out for analysis. */
export function extractImageUrl(text: string): string | undefined {
  const match = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i.exec(text);
  return match?.[1];
}

export async function POST(req: Request) {
  let body: { model?: unknown; prompt?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const { model, prompt, history } = body ?? {};

  if (typeof model !== "string" || !VALID_MODELS.has(model)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This model isn't supported. Choose one of the verified Bliss models.",
      },
      { status: 400 },
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { success: false, error: "A prompt is required." },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { success: false, error: "Your message is too long." },
      { status: 413 },
    );
  }

  // A fallback-only model must never be silently answered by the primary provider.
  if (isFallbackModel(model) && !isAgnesConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This model needs the optional Agnes fallback provider, which isn't enabled on this deployment. Set AGNES_API_KEY to switch it on.",
      },
      { status: 400 },
    );
  }

  const ip = clientIp(req);
  if (limiter.isLimited(ip)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You're sending messages quickly. Please wait a minute and try again.",
      },
      { status: 429 },
    );
  }

  const trimmedPrompt = prompt.trim();
  const turns = (Array.isArray(history) ? history : []) as HistoryTurn[];
  const composed = buildContextPrompt(trimmedPrompt, turns);
  const visionUrl = extractImageUrl(trimmedPrompt);

  try {
    const result = await generateChatWithFallback({
      model: model as ModelId,
      composedPrompt: composed,
      userPrompt: trimmedPrompt,
      // When the fallback answers it receives the real turns, not the flattened digest.
      history: turns,
      ...(visionUrl ? { imageUrl: visionUrl } : {}),
      signal: req.signal,
    });

    if (result.error) throw new Error(result.error);

    const clean = stripScaffold(result.text);
    if (!clean) throw new Error("empty response");

    return NextResponse.json({
      success: true,
      response: clean,
      // `model` stays what the user asked for; `answeredBy` names what actually replied.
      model,
      answeredBy: result.model,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    if (/cancel/i.test(message) || req.signal.aborted) {
      return NextResponse.json(
        { success: false, error: "Request cancelled." },
        { status: 499 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: /timed out/i.test(message)
          ? "The model took too long to answer. Try a shorter prompt."
          : "Bliss couldn't reach the AI service. Please try again.",
        // Raw upstream detail is dev-only: never leak internals or prompts to clients.
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 502 },
    );
  }
}
