import { NextResponse } from "next/server";
import {
  MODELS_WITH_FALLBACK,
  IMAGE_MODELS_WITH_FALLBACK,
  VIDEO_MODELS,
  API_LIMITATIONS,
  FALLBACK_CAPABILITIES,
} from "@/lib/api/config";
import { isAgnesConfigured } from "@/lib/api/agnes";

export const dynamic = "force-dynamic";

/** Freshness matters: this is how the UI learns whether a key was just added. */
const NO_STORE = { "Cache-Control": "no-store, max-age=0, s-maxage=0" };

export async function GET() {
  const enabled = isAgnesConfigured();
  return NextResponse.json(
    {
      success: true,
      text: MODELS_WITH_FALLBACK,
      image: IMAGE_MODELS_WITH_FALLBACK,
      video: VIDEO_MODELS,
      // These limits belong to the key-less primary provider; the fallback's own
      // limits live under `fallback` so nothing is mis-attributed.
      limitations: API_LIMITATIONS,
      limitationsFor: "cvron (primary provider)",
      fallback: {
        ...FALLBACK_CAPABILITIES,
        enabled,
        // Only real once the fallback answers: the key-less provider has neither.
        vision: enabled,
        nativeConversationContext: enabled,
        // Video is intentionally excluded: Bliss only wires up endpoints it has verified.
        videoModel: null,
      },
      note:
        "Models are a verified static configuration derived from the FreeAiAPIs repository plus the " +
        "documented Agnes AI gateway — neither provider exposes a model-list endpoint Bliss relies on.",
    },
    { headers: NO_STORE }
  );
}
