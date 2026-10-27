import { NextResponse } from "next/server";
import { generateImage, editImage } from "@/lib/api/media";
import { agnesGenerateImage } from "@/lib/api/agnes";
import { hasAgnesKeys } from "@/lib/api/agnesKeys";
import { IMAGE_MODELS, isAgnesImageModel } from "@/lib/api/config";

export const maxDuration = 180;

const MAX_PROMPT = 2000;

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

function normalizeImages(body: Record<string, unknown>): string[] | undefined {
  const candidates: string[] = [];
  // New Agnes-style: image[], images[], extra_body.image
  const fields = ["imageUrl", "image_url", "image", "images", "referenceImages", "reference_images"];
  for (const f of fields) {
    const v = body[f];
    if (typeof v === "string" && v.trim()) candidates.push(v.trim());
    else if (Array.isArray(v)) {
      for (const el of v) if (typeof el === "string" && el.trim()) candidates.push(el.trim());
    }
  }
  // extra_body.image
  if (body.extra_body && typeof body.extra_body === "object") {
    const eb = body.extra_body as Record<string, unknown>;
    const img = eb.image;
    if (typeof img === "string" && img.trim()) candidates.push(img.trim());
    else if (Array.isArray(img)) for (const el of img) if (typeof el === "string" && el.trim()) candidates.push(el.trim());
  }
  return candidates.length ? candidates : undefined;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "edit" ? "edit" : "generate";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  let model = typeof body.model === "string" ? body.model.trim() : "";
  // Alias for defaultImageModel
  if (!model && typeof body.imageModel === "string") model = (body.imageModel as string).trim();

  const size = typeof body.size === "string" ? body.size.trim() : "1K";
  const ratio = typeof body.ratio === "string" ? body.ratio.trim() : "1:1";
  const responseFormat =
    (body as Record<string, unknown>).response_format as string | undefined ||
    (body as Record<string, unknown>).responseFormat as string | undefined ||
    undefined;

  if (!prompt) {
    return NextResponse.json({ error: "Please describe the image you want." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `Image prompts are limited to ${MAX_PROMPT} characters.` }, { status: 413 });
  }

  const images = normalizeImages(body);

  // Determine if this should use Agnes
  const agnesRequested =
    isAgnesImageModel(model) ||
    // If edit mode with multiple images or data URI, prefer Agnes when keys exist
    (images && images.some((i) => isDataUri(i)) && hasAgnesKeys()) ||
    (model === "" && hasAgnesKeys() && mode === "generate" && (size !== "1K" || ratio !== "1:1")) ||
    // Explicit flag
    (body.provider as string) === "agnes";

  // If model is flux-dev explicitly, use CVRON
  const isFlux = model === "flux-dev";

  // Default model selection: if Agnes keys exist and user hasn't specified flux, prefer Agnes for richer features.
  // But keep backward compat: if no Agnes keys, always use CVRON.
  const useAgnes = !isFlux && (agnesRequested || (isAgnesImageModel(model) ? true : hasAgnesKeys() && isAgnesImageModel(IMAGE_MODELS.find((m) => m.id === model)?.id ?? "") ? true : false));

  // If model explicitly says agnes, or if hasAgnesKeys and model empty but we want agnes as default for new installs, we still need to handle edit/generate uniformly.
  // Simpler: if model is agnes image model, use Agnes. If no model but Agnes keys exist, use Agnes. Otherwise use CVRON.
  let effectiveUseAgnes = false;
  if (model && isAgnesImageModel(model)) effectiveUseAgnes = true;
  else if (!model && hasAgnesKeys() && !isFlux) {
    // Default to Agnes when keys present (new behavior)
    effectiveUseAgnes = true;
    model = "agnes-image-2.1-flash";
  } else if (model && hasAgnesKeys() && !isFlux) {
    // If model is anything but flux and Agnes is available, assume Agnes if flag
    if (agnesRequested) effectiveUseAgnes = true;
  }

  // Normalize model for Agnes
  if (effectiveUseAgnes) {
    const agnesModel = model && isAgnesImageModel(model) ? model : "agnes-image-2.1-flash";
    try {
      const imageUrl = await agnesGenerateImage(
        {
          prompt,
          model: agnesModel,
          size: size || "1K",
          ratio: ratio || "1:1",
          images,
          response_format: responseFormat || "url",
        },
        req.signal
      );
      return NextResponse.json({ success: true, imageUrl, model: agnesModel, provider: "agnes" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Image generation failed.";
      console.error("[Agnes] image error:", message);
      return NextResponse.json(
        {
          success: false,
          error: message.includes("not configured") ? message : "Your image couldn't be generated right now. Please try again.",
          detail: process.env.NODE_ENV === "development" ? message : undefined,
        },
        { status: /not configured/i.test(message) ? 503 : 502 }
      );
    }
  }

  // ── CVRON path (legacy) ──
  if (mode === "edit") {
    const imageUrl = images?.[0] ?? (typeof body.imageUrl === "string" ? (body.imageUrl as string).trim() : "");
    if (!isSafeImageUrl(imageUrl) && !isDataUri(imageUrl)) {
      return NextResponse.json(
        { error: "Provide a valid publicly accessible image URL (http/https) or data URI." },
        { status: 400 }
      );
    }
    // CVRON cannot handle data URIs — needs public URL
    if (isDataUri(imageUrl)) {
      return NextResponse.json(
        { error: "Flux Dev editing needs a public URL. For data URI uploads, switch to Agnes Image 2.1 Flash." },
        { status: 400 }
      );
    }
    try {
      const { imageUrl: out } = await editImage(prompt, imageUrl);
      return NextResponse.json({ success: true, imageUrl: out, model: "flux-dev", provider: "cvron" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Image editing failed.";
      return NextResponse.json(
        { success: false, error: "Your image couldn't be edited. Please review the source and prompt, then try again.", detail: process.env.NODE_ENV === "development" ? message : undefined },
        { status: 502 }
      );
    }
  }

  try {
    const { imageUrl } = await generateImage(prompt);
    return NextResponse.json({ success: true, imageUrl, model: "flux-dev", provider: "cvron" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Image generation failed.";
    return NextResponse.json(
      { success: false, error: "Your image couldn't be generated right now. Please try again.", detail: process.env.NODE_ENV === "development" ? message : undefined },
      { status: 502 }
    );
  }
}
