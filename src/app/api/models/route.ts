import { NextResponse } from "next/server";
import { MODELS, IMAGE_MODELS, VIDEO_MODELS, API_LIMITATIONS, AGNES_API_BASE } from "@/lib/api/config";
import { hasAgnesKeys, getKeyPoolStats } from "@/lib/api/agnesKeys";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    text: MODELS,
    image: IMAGE_MODELS,
    video: VIDEO_MODELS,
    limitations: API_LIMITATIONS,
    agnes: {
      configured: hasAgnesKeys(),
      keys: hasAgnesKeys() ? getKeyPoolStats() : null,
      base: AGNES_API_BASE,
      models: {
        chat: ["agnes-2.0-flash", "agnes-2.5-flash", "agnes-3.0-flash"],
        image: ["agnes-image-2.1-flash", "agnes-image-2.5-flash"],
        video: ["agnes-video-v2.0", "agnes-video-2.5"],
      },
      endpoints: {
        chat: `${AGNES_API_BASE}/chat/completions`,
        image: `${AGNES_API_BASE}/images/generations`,
        video: `${AGNES_API_BASE}/videos`,
        videoPoll: `${AGNES_API_BASE.replace(/\/v1\/?$/, "")}/agnesapi?video_id=<VIDEO_ID>`,
      },
      pricing: "$0 (promotional pricing)",
      limits: { text: "20 requests/min", video: "1/min" },
    },
    note: "Bliss models: 7 chat (4 CVRON + 3 Agnes/Pesles), 3 image, 3 video. Verified against CVRON FreeAiAPIs and Agnes AI docs.",
  });
}
