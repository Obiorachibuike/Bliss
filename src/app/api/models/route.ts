import { NextResponse } from "next/server";
import { MODELS, IMAGE_MODELS, VIDEO_MODELS, API_LIMITATIONS } from "@/lib/api/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    text: MODELS,
    image: IMAGE_MODELS,
    video: VIDEO_MODELS,
    limitations: API_LIMITATIONS,
    note: "Models are a verified static configuration derived from the FreeAiAPIs repository — the provider exposes no model-list endpoint.",
  });
}
