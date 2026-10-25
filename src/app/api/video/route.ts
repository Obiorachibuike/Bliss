import { NextResponse } from "next/server";
import { generateVideo } from "@/lib/api/media";

export const maxDuration = 300;

function isSafeImageUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: { prompt?: string; imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

  if (!prompt) return NextResponse.json({ error: "Describe the motion you want." }, { status: 400 });
  if (!isSafeImageUrl(imageUrl)) {
    return NextResponse.json(
      { error: "WAN 2.2 is image-to-video only — a valid public source image URL is required." },
      { status: 400 }
    );
  }

  try {
    const { videoUrl } = await generateVideo(prompt, imageUrl);
    return NextResponse.json({ success: true, videoUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Video generation failed.";
    return NextResponse.json(
      {
        success: false,
        error: "Video generation failed or timed out. Long jobs can take several minutes — please try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 502 }
    );
  }
}
