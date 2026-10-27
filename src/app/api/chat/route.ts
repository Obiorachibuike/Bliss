import { NextResponse } from "next/server";
import { generateText } from "@/lib/api/text";
import { MODELS, isAgnesChatModel } from "@/lib/api/config";
import type { ModelId } from "@/lib/types";
import { agnesChatStream, agnesChat } from "@/lib/api/agnes";
import { hasAgnesKeys } from "@/lib/api/agnesKeys";

export const maxDuration = 60;

const VALID_MODELS = new Set<string>(MODELS.map((m) => m.id));
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 900;
const MAX_BODY_CHARS = 24_000;
/** Documented upstream budget for a single `prompt` parameter. */
const PROMPT_BUDGET = 4000;

/* A free upstream must not become an open endpoint: 20 requests / minute / IP. */
const WINDOW_MS = 60_000;
const LIMIT = 20;
const buckets = new Map<string, { count: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
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
  images?: unknown;
}

/** The upstream is single-turn, so recent turns are folded into one prompt. */
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

// Build OpenAI-style messages for Agnes (native context + vision)
function buildAgnesMessages(
  prompt: string,
  history: HistoryTurn[] | undefined,
  images?: string[]
): Array<{ role: "system" | "user" | "assistant"; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> {
  const turns = (Array.isArray(history) ? history : []).filter(
    (t): t is { role: string; content: string; images?: string[] } =>
      !!t &&
      (t.role === "user" || t.role === "assistant") &&
      typeof t.content === "string" &&
      t.content.trim().length > 0
  );

  // Keep last 8 turns for Agnes (its context window is large, but we keep sane)
  const recent = turns.slice(-8);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: unknown }> = [
    { role: "system", content: "You are Bliss, a helpful AI assistant powered by Agnes AI. Be concise, friendly, and accurate." },
  ];

  for (const turn of recent) {
    if (turn.role === "user" && turn.images && Array.isArray(turn.images) && turn.images.length > 0) {
      // Vision message: content as array with image_url
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: turn.content.trim().slice(0, MAX_TURN_CHARS) },
      ];
      for (const img of turn.images.slice(0, 4)) {
        if (typeof img === "string" && img) content.push({ type: "image_url", image_url: { url: img } });
      }
      messages.push({ role: "user", content });
    } else {
      messages.push({
        role: turn.role as "user" | "assistant",
        content: turn.content.trim().slice(0, MAX_TURN_CHARS),
      });
    }
  }

  // Current prompt with optional images
  if (images && images.length > 0) {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: prompt.trim() },
    ];
    for (const img of images.slice(0, 4)) {
      if (typeof img === "string" && img) content.push({ type: "image_url", image_url: { url: img } });
    }
    messages.push({ role: "user", content });
  } else {
    messages.push({ role: "user", content: prompt.trim() });
  }

  return messages as never;
}

export async function POST(req: Request) {
  let body: {
    model?: unknown;
    prompt?: unknown;
    history?: unknown;
    messages?: unknown;
    images?: unknown;
    image?: unknown;
    stream?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { model, prompt, history, messages, images, image, stream } = body ?? {};

  if (typeof model !== "string" || !VALID_MODELS.has(model)) {
    return NextResponse.json(
      { success: false, error: "This model isn't supported. Choose one of the verified Bliss models." },
      { status: 400 }
    );
  }

  // Determine if client expects streaming: explicit stream:true or Accept header
  const wantsStream =
    stream === true ||
    (typeof req.headers.get("accept") === "string" && req.headers.get("accept")!.includes("text/event-stream")) ||
    isAgnesChatModel(model);

  if (typeof prompt !== "string" || !prompt.trim()) {
    // Allow empty prompt if messages array is provided (Agnes vision)
    const hasMessages = Array.isArray(messages) && messages.length > 0;
    if (!hasMessages) {
      return NextResponse.json({ success: false, error: "A prompt is required." }, { status: 400 });
    }
  }
  const promptStr = typeof prompt === "string" ? prompt : "";
  if (promptStr.length > MAX_BODY_CHARS) {
    return NextResponse.json({ success: false, error: "Your message is too long." }, { status: 413 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "You're sending messages quickly. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  // ── Agnes path: streaming SSE proxy ──
  if (isAgnesChatModel(model as string)) {
    if (!hasAgnesKeys()) {
      return NextResponse.json(
        {
          success: false,
          error: "Agnes AI is not configured on this server. Add AGNES_API_KEY_1 to your environment.",
          detail: process.env.NODE_ENV === "development" ? "No Agnes keys found" : undefined,
        },
        { status: 503 }
      );
    }

    // Support text files inlined: client may have inlined contents into prompt; we just pass through.
    // Images: either top-level images array or extra images in prompt
    let agnesMessages: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
    if (Array.isArray(messages) && messages.length > 0) {
      // Use provided messages directly (vision-ready)
      agnesMessages = messages as never;
    } else {
      const imgList: string[] | undefined = Array.isArray(images)
        ? (images as string[])
        : typeof image === "string"
          ? [image]
          : Array.isArray(history) &&
              (history as HistoryTurn[]).some((h) => Array.isArray((h as unknown as Record<string, unknown>).images))
            ? undefined
            : undefined;
      // Merge images from history turns that may carry images field
      const extraImages = Array.isArray(images) ? (images as string[]) : undefined;
      agnesMessages = buildAgnesMessages(promptStr.trim(), history as HistoryTurn[] | undefined, extraImages);
      // Also check if last history turn had images, we've already handled; if current has images via top-level, it's in agnesMessages
      if (imgList && imgList.length) {
        // already handled above
      }
    }

    // If client explicitly wants JSON (non-stream), do agnesChat non-streaming
    const urlParams = new URL(req.url).searchParams;
    const forceJson = urlParams.get("format") === "json" || body.stream === false;

    if (forceJson) {
      try {
        const text = await agnesChat({ model: model as string, messages: agnesMessages as never, signal: req.signal });
        const clean = stripScaffold(text);
        return NextResponse.json({ success: true, response: clean, model });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Generation failed.";
        const cancelled = /cancel/i.test(msg);
        if (cancelled) return NextResponse.json({ success: false, error: "Request cancelled." }, { status: 499 });
        return NextResponse.json(
          {
            success: false,
            error: /timed out|unreachable/i.test(msg) ? msg : "Bliss couldn't reach the AI service. Please try again.",
            detail: process.env.NODE_ENV === "development" ? msg : undefined,
          },
          { status: 502 }
        );
      }
    }

    // Streaming path: pipe SSE
    try {
      const upstream = await agnesChatStream({
        model: model as string,
        messages: agnesMessages as never,
        signal: req.signal,
      });

      // Pipe upstream SSE to client, transforming OpenAI chunks to Bliss SSE
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const readable = new ReadableStream({
        async start(controller) {
          const reader = upstream.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed === "data: [DONE]") {
                  controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  continue;
                }
                if (trimmed.startsWith("data: ")) {
                  const jsonStr = trimmed.slice(6);
                  try {
                    const chunk = JSON.parse(jsonStr);
                    const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
                    if (delta) {
                      // Forward as SSE token
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`));
                    }
                    // Also handle non-stream shape if upstream isn't streaming
                    if (chunk.choices?.[0]?.message?.content && !chunk.choices?.[0]?.delta) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: chunk.choices[0].message.content })}\n\n`));
                    }
                  } catch {
                    // Forward raw line if not JSON
                    controller.enqueue(encoder.encode(`${line}\n`));
                  }
                } else if (trimmed.startsWith(":")) {
                  // SSE comment, ignore
                } else {
                  // Unknown line, forward
                  controller.enqueue(encoder.encode(`${line}\n`));
                }
              }
            }
            // flush remaining buffer
            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer + "\n"));
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
        cancel() {
          try { upstream.body?.cancel(); } catch {}
        }
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Generation failed.";
      const cancelled = /cancel/i.test(msg);
      if (cancelled) return NextResponse.json({ success: false, error: "Request cancelled." }, { status: 499 });
      // If streaming setup failed, fallback to non-stream JSON if possible
      console.error("[Agnes] chat stream setup failed:", msg);
      return NextResponse.json(
        {
          success: false,
          error: /timed out/i.test(msg) ? "The model took too long to answer. Try a shorter prompt." : "Bliss couldn't reach the AI service. Please try again.",
          detail: process.env.NODE_ENV === "development" ? msg : undefined,
        },
        { status: 502 }
      );
    }
  }

  // ── CVRON path: legacy non-streaming ──
  const composed = buildContextPrompt(promptStr.trim(), history as HistoryTurn[] | undefined);

  try {
    const { response } = await generateText(model as ModelId, composed, req.signal);
    const clean = stripScaffold(response);
    if (!clean) throw new Error("empty response");
    return NextResponse.json({ success: true, response: clean, model });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    const cancelled = /cancel/i.test(message);
    if (cancelled) return NextResponse.json({ success: false, error: "Request cancelled." }, { status: 499 });
    return NextResponse.json(
      {
        success: false,
        error: /timed out/i.test(message) ? "The model took too long to answer. Try a shorter prompt." : "Bliss couldn't reach the AI service. Please try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 502 }
    );
  }
}
