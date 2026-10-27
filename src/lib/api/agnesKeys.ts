// Agnes API key pool — round-robin rotation with failover benching.
// Parses numbered variables AGNES_API_KEY_1, AGNES_API_KEY_2, ...,
// comma-separated AGNES_API_KEYS, and single AGNES_API_KEY.
// Server detects them all automatically; frontend never sees keys.

type KeyState = {
  key: string;
  index: number;
  disabled: boolean; // 401 permanently
  benchUntil: number; // timestamp ms, 0 if not benched
  failureCount: number;
};

let pool: KeyState[] | null = null;
let nextIdx = 0;
const videoKeyMap = new Map<string, string>(); // videoId -> key

function parseKeys(): string[] {
  const env = process.env as Record<string, string | undefined>;
  const keys: string[] = [];

  // Numbered keys: AGNES_API_KEY_1, AGNES_API_KEY_2, ...
  let i = 1;
  while (true) {
    const k = env[`AGNES_API_KEY_${i}`];
    if (!k) break;
    if (k.trim()) keys.push(k.trim());
    i++;
    if (i > 100) break; // safety
  }

  // Comma-separated AGNES_API_KEYS
  const csv = env.AGNES_API_KEYS;
  if (csv) {
    for (const part of csv.split(",")) {
      const t = part.trim();
      if (t) keys.push(t);
    }
  }

  // Single AGNES_API_KEY
  const single = env.AGNES_API_KEY;
  if (single && single.trim()) keys.push(single.trim());

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const k of keys) {
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(k);
    }
  }
  return deduped;
}

function getPool(): KeyState[] {
  if (pool !== null) return pool;
  const keys = parseKeys();
  pool = keys.map((k, idx) => ({
    key: k,
    index: idx,
    disabled: false,
    benchUntil: 0,
    failureCount: 0,
  }));
  return pool;
}

// For testing / dev: reset pool (useful when env changes)
export function resetPool() {
  pool = null;
  nextIdx = 0;
  videoKeyMap.clear();
}

export function hasAgnesKeys(): boolean {
  return getPool().length > 0;
}

export function getAgnesKeysCount(): number {
  return getPool().length;
}

export function getAllAgnesKeys(): string[] {
  return getPool().map((k) => k.key);
}

export function listKeyStates(): KeyState[] {
  return getPool();
}

export function getNextAgnesKey(): KeyState | null {
  const p = getPool();
  if (p.length === 0) return null;
  const now = Date.now();
  // Try to find a non-disabled, non-benched key via round-robin
  for (let attempt = 0; attempt < p.length; attempt++) {
    const idx = nextIdx % p.length;
    nextIdx = (nextIdx + 1) % p.length;
    const state = p[idx];
    if (state.disabled) continue;
    if (state.benchUntil > now) continue;
    return state;
  }
  // All keys are benched/disabled
  return null;
}

// Mark key failure based on HTTP status
export function markAgnesKeyFailure(keyOrIndex: string | number, status: number) {
  const p = getPool();
  let state: KeyState | undefined;
  if (typeof keyOrIndex === "number") {
    state = p.find((k) => k.index === keyOrIndex);
  } else {
    state = p.find((k) => k.key === keyOrIndex);
  }
  if (!state) return;

  state.failureCount++;
  const now = Date.now();
  if (status === 429) {
    // Rate limited: bench 60s
    state.benchUntil = now + 60_000;
    console.warn(`[Agnes] Key ${state.index} rate-limited (429), benched 60s`);
  } else if (status === 402) {
    // Out of quota: bench 1 hour
    state.benchUntil = now + 60 * 60_000;
    console.warn(`[Agnes] Key ${state.index} out of quota (402), benched 1h`);
  } else if (status === 401 || status === 403) {
    // Invalid key: disable permanently
    state.disabled = true;
    console.error(`[Agnes] Key ${state.index} invalid (${status}), disabled permanently`);
  } else if (status >= 500) {
    // Transient server error: brief bench 10s to avoid hammering
    if (state.benchUntil < now + 10_000) state.benchUntil = now + 10_000;
  }
}

export function markAgnesKeySuccess(keyOrIndex: string | number) {
  const p = getPool();
  let state: KeyState | undefined;
  if (typeof keyOrIndex === "number") {
    state = p.find((k) => k.index === keyOrIndex);
  } else {
    state = p.find((k) => k.key === keyOrIndex);
  }
  if (state) {
    state.benchUntil = 0;
    state.failureCount = 0;
  }
}

// Video key affinity: remember which key created which video
export function recordVideoKey(videoId: string, key: string) {
  if (videoId && key) videoKeyMap.set(videoId, key);
}

export function getVideoKey(videoId: string): string | null {
  return videoKeyMap.get(videoId) ?? null;
}

export function getVideoKeyState(videoId: string): KeyState | null {
  const key = getVideoKey(videoId);
  if (!key) return null;
  return getPool().find((k) => k.key === key) ?? null;
}

// For diagnostics (no keys exposed)
export function getKeyPoolStats() {
  const p = getPool();
  const now = Date.now();
  return {
    total: p.length,
    available: p.filter((k) => !k.disabled && k.benchUntil <= now).length,
    benched: p.filter((k) => k.benchUntil > now).length,
    disabled: p.filter((k) => k.disabled).length,
  };
}
