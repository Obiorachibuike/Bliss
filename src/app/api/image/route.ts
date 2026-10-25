import { NextResponse } from "next/server";
import { generateImageWithFallback, normalizeRatio } from "@/lib/api/provider";
import { isAgnesConfigured } from "@/lib/api/agnes";
import { AGNES_IMAGE_MODEL } from "@/lib/api/config";

export const maxDuration = 300;

const MAX_PROMPT = 1000;

function isSafeImageUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: { mode?: string; prompt?: string; imageUrl?: string; ratio?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "edit" ? "edit" : "generate";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const model = typeof body.model === "string" ? body.model : undefined;
  const ratio = typeof body.ratio === "string" ? normalizeRatio(body.ratio) : undefined;

  if (!prompt) {
    return NextResponse.json({ error: "Please describe the image you want." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `Image prompts are limited to ${MAX_PROMPT} characters.` }, { status: 413 });
  }
  if (model !== undefined && model !== AGNES_IMAGE_MODEL) {
    return NextResponse.json({ error: "That image model isn't available. Choose Flux Dev or Agnes Image." }, { status: 400 });
  }
  if (model === AGNES_IMAGE_MODEL && !isAgnesConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: "Agnes Image needs the optional fallback provider, which isn't enabled on this deployment. Set AGNES_API_KEY to switch it on.",
      },
      { status: 400 }
    );
  }

  let imageUrl: string | undefined;
  if (mode === "edit") {
    const source = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (!isSafeImageUrl(source)) {
      return NextResponse.json(
        { error: "Provide a valid publicly accessible image URL (http/https)." },
        { status: 400 }
      );
    }
    imageUrl = source;
  }

  const result = await generateImageWithFallback({
    prompt,
    mode,
    ...(imageUrl ? { sourceImageUrl: imageUrl } : {}),
    ...(ratio ? { ratio } : {}),
    ...(model ? { model } : {}),
    signal: req.signal,
  });

  if (result.error || !result.imageUrl) {
    return NextResponse.json(
      {
        success: false,
        error:
          result.error && /cancel/i.test(result.error)
            ? "Request cancelled."
            : mode === "edit"
            ? "Your image couldn't be edited. Please review the source and prompt, then try again."
            : "Your image couldn't be generated right now. Please try again.",
        detail: process.env.NODE_ENV === "development" ? result.error : undefined,
      },
      { status: /cancel/i.test(result.error ?? "") ? 499 : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    imageUrl: result.imageUrl,
    model: result.model,
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
  });
}
