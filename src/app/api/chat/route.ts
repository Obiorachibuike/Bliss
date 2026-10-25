import { NextResponse } from "next/server";
import { generateText } from "@/lib/api/text";
import { MODELS } from "@/lib/api/config";
import type { ModelId } from "@/lib/types";

export const maxDuration = 60;

const VALID_MODELS = new Set<string>(MODELS.map((m) => m.id));
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 900;
const MAX_BODY_CHARS = 24_000;
/** Documented upstream budget for a single `prompt` parameter. */
const PROMPT_BUDGET = 4000;

/* A free upstream must not become an open endpoint: 20 requests / minute / IP.
 * On Vercel, pair this with a KV/Upstash limiter if you need it to survive cold starts. */
const WINDOW_MS = 60_000;
const LIMIT = 20;
const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  // Opportunistic prune so the map can't grow without bound on a long-lived container.
  if (buckets.size > 5_000) {
    for (const [key, value] of buckets) if (value.reset < now) buckets.delete(key);
  }
  const bucket = buckets.get(ip);
  if (!bucket || bucket.reset < now) {
    buckets.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LIMIT;
}

interface HistoryTurn {
  role: unknown;
  content: unknown;
}

/** The upstream is single-turn, so recent turns are folded into one prompt.
 *  Anything that isn't a plain user/assistant string is dropped, and the total is
 *  kept inside the documented prompt budget so long threads degrade gracefully. */
export function buildContextPrompt(prompt: string, history: HistoryTurn[] | undefined): string {
  const turns = (Array.isArray(history) ? history : []).filter(
    (t): t is { role: string; content: string } =>
      !!t &&
      (t.role === "user" || t.role === "assistant") &&
      typeof t.content === "string" &&
      t.content.trim().length > 0
  );

  if (turns.length === 0) return prompt.slice(0, PROMPT_BUDGET);

  const header = "You are Bliss, a helpful AI assistant. Continue the conversation below and answer only the final user message.";
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

export async function POST(req: Request) {
  let body: { model?: unknown; prompt?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { model, prompt, history } = body ?? {};

  if (typeof model !== "string" || !VALID_MODELS.has(model)) {
    return NextResponse.json(
      { success: false, error: "This model isn't supported. Choose one of the verified Bliss models." },
      { status: 400 }
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ success: false, error: "A prompt is required." }, { status: 400 });
  }
  if (prompt.length > MAX_BODY_CHARS) {
    return NextResponse.json({ success: false, error: "Your message is too long." }, { status: 413 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "You're sending messages quickly. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  const composed = buildContextPrompt(prompt.trim(), history as HistoryTurn[] | undefined);

  try {
    const { response } = await generateText(model as ModelId, composed, req.signal);
    const clean = stripScaffold(response);
    if (!clean) {
      throw new Error("empty response");
    }
    return NextResponse.json({ success: true, response: clean, model });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    const cancelled = /cancel/i.test(message);
    if (cancelled) {
      return NextResponse.json({ success: false, error: "Request cancelled." }, { status: 499 });
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
      { status: 502 }
    );
  }
}
