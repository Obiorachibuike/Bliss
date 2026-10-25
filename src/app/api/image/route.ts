import { NextResponse } from "next/server";
import { generateImage, editImage } from "@/lib/api/media";

export const maxDuration = 180;

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
  let body: { mode?: string; prompt?: string; imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode === "edit" ? "edit" : "generate";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "Please describe the image you want." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `Image prompts are limited to ${MAX_PROMPT} characters.` }, { status: 413 });
  }

  if (mode === "edit") {
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    if (!isSafeImageUrl(imageUrl)) {
      return NextResponse.json(
        { error: "Provide a valid publicly accessible image URL (http/https)." },
        { status: 400 }
      );
    }
    try {
      const { imageUrl: out } = await editImage(prompt, imageUrl);
      return NextResponse.json({ success: true, imageUrl: out });
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
    return NextResponse.json({ success: true, imageUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Image generation failed.";
    return NextResponse.json(
      { success: false, error: "Your image couldn't be generated right now. Please try again.", detail: process.env.NODE_ENV === "development" ? message : undefined },
      { status: 502 }
    );
  }
}
