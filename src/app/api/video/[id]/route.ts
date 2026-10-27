import { NextResponse } from "next/server";
import { agnesPollVideo } from "@/lib/api/agnes";
import { hasAgnesKeys } from "@/lib/api/agnesKeys";

export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing video id" }, { status: 400 });
  if (!hasAgnesKeys()) {
    return NextResponse.json({ success: false, error: "Agnes not configured." }, { status: 503 });
  }
  try {
    const status = await agnesPollVideo(decodeURIComponent(id), req.signal);
    const isDone = status.status === "completed" || status.status === "success";
    const videoUrl = status.video_url || status.videoUrl || status.url;
    if (isDone && videoUrl) {
      return NextResponse.json({ success: true, status: "completed", videoUrl, video_url: videoUrl, raw: status.raw });
    }
    if (status.status === "failed") {
      return NextResponse.json({ success: false, status: "failed", error: status.error || "Video generation failed.", raw: status.raw }, { status: 502 });
    }
    return NextResponse.json({ success: true, status: status.status, progress: status.progress, raw: status.raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Polling failed";
    return NextResponse.json({ success: false, error: msg, detail: process.env.NODE_ENV === "development" ? msg : undefined }, { status: 502 });
  }
}
