"use client";
/* Single source of truth for the runtime catalogue: which models the picker offers,
 * and whether the optional Agnes fallback provider is switched on. `/api/models` is
 * the only place that knows the server environment, so the client asks it once and
 * shares the answer with every consumer. When the answer matches the build-time
 * defaults nothing is emitted, so components never re-render for no reason. */
import { useSyncExternalStore } from "react";
import { MODELS_WITH_FALLBACK, IMAGE_MODELS_WITH_FALLBACK } from "@/lib/api/config";
import type { ModelId } from "@/lib/types";

export interface FallbackStatus {
  enabled: boolean;
  provider: string;
  vision: boolean;
  nativeConversationContext: boolean;
  chatModels: string[];
  imageModel: string | null;
  docs: string;
}

const INITIAL_FALLBACK: FallbackStatus = {
  enabled: false,
  provider: "Agnes AI",
  vision: false,
  nativeConversationContext: false,
  chatModels: [],
  imageModel: null,
  docs: "https://www.agnes-ai.com/en/docs",
};

type TextModels = typeof MODELS_WITH_FALLBACK;
type ImageModels = typeof IMAGE_MODELS_WITH_FALLBACK;

let textModels: TextModels = MODELS_WITH_FALLBACK;
let imageModels: ImageModels = IMAGE_MODELS_WITH_FALLBACK;
let fallbackStatus: FallbackStatus = INITIAL_FALLBACK;

const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;
let settled = false;

function emit() {
  for (const l of listeners) l();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function fetchCatalog() {
  try {
    const res = await fetch("/api/models", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      text?: TextModels;
      image?: ImageModels;
      fallback?: Partial<FallbackStatus>;
    };
    const nextText = Array.isArray(data.text) && data.text.length > 0 ? data.text : MODELS_WITH_FALLBACK;
    const nextImage = Array.isArray(data.image) && data.image.length > 0 ? data.image : IMAGE_MODELS_WITH_FALLBACK;
    const nextFallback: FallbackStatus = data.fallback ? { ...INITIAL_FALLBACK, ...data.fallback } : INITIAL_FALLBACK;

    settled = true;
    let changed = false;
    if (!same(nextText, textModels)) {
      textModels = nextText;
      changed = true;
    }
    if (!same(nextImage, imageModels)) {
      imageModels = nextImage;
      changed = true;
    }
    if (!same(nextFallback, fallbackStatus)) {
      fallbackStatus = nextFallback;
      changed = true;
    }
    if (changed) emit();
  } catch {
    /* stay on the static catalogue — never block the UI on a status call */
  }
}

/** One request for the whole app; concurrent subscribers share it. */
function load(): Promise<void> {
  if (settled) return Promise.resolve();
  if (!inflight) inflight = fetchCatalog().finally(() => (inflight = null));
  return inflight;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  void load();
  return () => listeners.delete(cb);
}

/* Fallback-provider models stay listed even when the key is absent — the route
 * answers with a clear "not enabled" error instead of pretending they don't exist. */
export function useTextModels(): TextModels {
  return useSyncExternalStore(subscribe, () => textModels, () => MODELS_WITH_FALLBACK);
}

export function useImageModels(): ImageModels {
  return useSyncExternalStore(subscribe, () => imageModels, () => IMAGE_MODELS_WITH_FALLBACK);
}

export function useFallbackStatus(): FallbackStatus {
  return useSyncExternalStore(subscribe, () => fallbackStatus, () => INITIAL_FALLBACK);
}

export function modelLabel(id: ModelId, models: TextModels = MODELS_WITH_FALLBACK): string {
  return models.find((m) => m.id === id)?.name ?? id;
}

/** Re-read after a deployment or config change (Settings → "Re-check"). */
export function refreshCatalog() {
  settled = false;
  void load();
}

/** Resolves once the catalogue has been read — handy before asserting in tests. */
export function catalogReady() {
  return load();
}

/** Test seam: drop the cached catalogue so a test can stub a different /api/models. */
export function __resetCatalogForTests() {
  textModels = MODELS_WITH_FALLBACK;
  imageModels = IMAGE_MODELS_WITH_FALLBACK;
  fallbackStatus = INITIAL_FALLBACK;
  settled = false;
  inflight = null;
  listeners.clear();
}
