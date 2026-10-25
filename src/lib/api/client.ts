export interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: unknown;
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<ApiResult<T>> {
  try {
    const res = await fetchWithTimeout(url, options, timeoutMs);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const json = (await res.json()) as T;
    return { success: true, data: json, raw: json };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("Abort")) {
      return { success: false, error: "Request timed out. Please try again." };
    }
    return { success: false, error: msg || "Network error" };
  }
}

export function isValidUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validatePrompt(prompt: string, maxLen = 4000): string | null {
  if (!prompt || !prompt.trim()) return "Prompt cannot be empty.";
  if (prompt.length > maxLen) return `Prompt too long (max ${maxLen} chars).`;
  return null;
}
