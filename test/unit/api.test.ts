import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseChatPayload } from "@/lib/api/text";
import { isValidUrl, validatePrompt } from "@/lib/api/client";
import { generateTitle } from "@/lib/utils/title";
import { MODELS, ENDPOINTS, API_LIMITATIONS } from "@/lib/api/config";

/* ------------------------------------------------------------------ *
 * Model configuration
 * ------------------------------------------------------------------ */
describe("model configuration", () => {
  it("exposes the four CVRON text models plus Pesles AI (Agnes) streaming models", () => {
    const ids = MODELS.map((m) => m.id);
    // Original CVRON four must still be present
    for (const id of ["deepseek-v3.2", "gemini-2.5-flash-lite", "gpt-5-nano", "llama"] as const) {
      expect(ids).toContain(id);
    }
    // Pesles AI models added
    expect(ids).toContain("agnes-2.0-flash");
    expect(ids).toContain("agnes-2.5-flash");
    expect(ids).toContain("agnes-3.0-flash");
    expect(ids.length).toBeGreaterThanOrEqual(7);
  });

  it("maps every CVRON model to a real cvron endpoint and Agnes to apihub", () => {
    for (const m of MODELS) {
      if (m.id.startsWith("agnes-")) {
        expect(m.endpoint).toMatch(/^https:\/\/apihub\.agnes-ai\.com\/v1\/chat\/completions$/);
      } else {
        expect(m.endpoint).toMatch(/^https:\/\/cvron\.alwaysdata\.net\/cvronai\/.+\.php$/);
      }
    }
    expect(ENDPOINTS.chat.llama.endsWith("llama.php")).toBe(true);
    expect(ENDPOINTS.image.fluxDev.endsWith("flux-dev.php")).toBe(true);
    expect(ENDPOINTS.image.image2image.endsWith("image2image.php")).toBe(true);
    expect(ENDPOINTS.video.wan22.endsWith("wan22.php")).toBe(true);
    expect(ENDPOINTS.image.agnesImage.endsWith("/images/generations")).toBe(true);
    expect(ENDPOINTS.video.agnesVideo.endsWith("/videos")).toBe(true);
  });

  it("claims streaming + vision via Agnes (and truthfully no longer denies them)", () => {
    expect(API_LIMITATIONS.streaming).toBe(true);
    expect(API_LIMITATIONS.vision).toBe(true);
    expect(API_LIMITATIONS.conversationContext).toBe(true);
    expect(API_LIMITATIONS.textToVideo).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Request construction
 * ------------------------------------------------------------------ */
describe("request construction", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a GET with a url-encoded prompt to the selected model only", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        calls.push(String(u));
        return Response.json({ success: true, response: "hi" });
      })
    );

    const { generateText } = await import("@/lib/api/text");
    await generateText("deepseek-v3.2", "what is 2 + 2? & why?");

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.origin).toBe("https://cvron.alwaysdata.net");
    expect(url.pathname).toBe("/cvronai/deepseek-v3.2.php");
    expect(url.searchParams.get("prompt")).toBe("what is 2 + 2? & why?");
  });

  it("rejects an over-long prompt before touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await import("@/lib/api/text");
    await expect(generateText("llama", "a".repeat(API_LIMITATIONS.maxPromptLength + 1))).rejects.toThrow(/too long/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty prompt", async () => {
    const { generateText } = await import("@/lib/api/text");
    await expect(generateText("llama", "   ")).rejects.toThrow(/empty/i);
  });
});

/* ------------------------------------------------------------------ *
 * Response validation — an HTTP 200 is not proof of a good body
 * ------------------------------------------------------------------ */
describe("response validation", () => {
  it("accepts the documented success shape", () => {
    expect(parseChatPayload({ success: true, response: " Hello ", prompt: "hi" })).toBe("Hello");
  });

  it("accepts alternate content keys some upstreams return", () => {
    expect(parseChatPayload({ text: "alternative" })).toBe("alternative");
    expect(parseChatPayload({ answer: "from answer" })).toBe("from answer");
  });

  it("throws when success:false", () => {
    expect(() => parseChatPayload({ success: false, message: "model busy" })).toThrow(/model busy/);
  });

  it("throws on an HTML error page served with status 200", () => {
    expect(() => parseChatPayload("<html><body>502 Bad Gateway</body></html>")).toThrow(/HTML instead of JSON/);
  });

  it("throws when no usable content exists", () => {
    expect(() => parseChatPayload({ success: true })).toThrow(/no usable response/i);
    expect(() => parseChatPayload(null)).toThrow(/unexpected response/i);
    expect(() => parseChatPayload({ response: "   " })).toThrow(/no usable response/i);
  });

  it("retries transient failures then surfaces the error", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await import("@/lib/api/text");
    await expect(generateText("llama", "hello")).rejects.toThrow(/500/);
    // 1 initial attempt + documented retries
    expect(fetchMock).toHaveBeenCalledTimes(API_LIMITATIONS.retries + 1);
  });

  it("does not retry a client-side 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);
    const { generateText } = await import("@/lib/api/text");
    await expect(generateText("llama", "hello")).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * Input helpers
 * ------------------------------------------------------------------ */
describe("input validation", () => {
  it("accepts only http(s) urls", () => {
    expect(isValidUrl("https://a.io/b.jpg")).toBe(true);
    expect(isValidUrl("http://a.io/b.jpg")).toBe(true);
    expect(isValidUrl("file:///etc/passwd")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });

  it("validatePrompt returns null only for usable prompts", () => {
    expect(validatePrompt("hello")).toBeNull();
    expect(validatePrompt("")).toMatch(/empty/);
    expect(validatePrompt("   ")).toMatch(/empty/);
    expect(validatePrompt("x".repeat(10), 5)).toMatch(/too long/);
  });
});

describe("conversation title generation", () => {
  it("uses the trimmed prompt when it is short", () => {
    expect(generateTitle("  Explain   recursion  ")).toBe("Explain recursion");
  });

  it("truncates long prompts on a word boundary", () => {
    const long =
      "Write a comprehensive guide about the history of computing machines that spans several paragraphs of text";
    const title = generateTitle(long);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/); // no dangling space before the ellipsis
  });

  it("falls back for empty input", () => {
    expect(generateTitle("")).toBe("New conversation");
  });

  it("collapses newlines so titles stay single-line", () => {
    expect(generateTitle("line one\nline two\ttabbed")).toBe("line one line two tabbed");
  });
});
