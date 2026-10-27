import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Fallback provider (Agnes AI) ─────────────────────────────────────────
 * Bliss' primary provider is key-less and occasionally down; the fallback is a real
 * second provider. These tests pin both halves of the promise: the fallback is used
 * when it is configured, and it is never invented when it is not.
 */

type FetchCall = { url: string; init?: RequestInit };

const AGNES_COMPLETION = {
  id: "chatcmpl_1",
  object: "chat.completion",
  model: "agnes-2.5-flash",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Fallback answer" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
};

async function loadWithKey(key: string | undefined) {
  if (key) process.env.AGNES_API_KEY = key;
  else delete process.env.AGNES_API_KEY;
  vi.resetModules();
  const config = await import("@/lib/api/config");
  const agnes = await import("@/lib/api/agnes");
  const provider = await import("@/lib/api/provider");
  const chat = await import("@/app/api/chat/route");
  const image = await import("@/app/api/image/route");
  return { config, agnes, provider, chat, image };
}

function post(body: unknown, ip = "198.51.100.1") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function spyFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

let ipSeq = 1;
const freshIp = () => `203.0.113.${ipSeq++}`;

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  delete process.env.AGNES_API_KEY;
  vi.unstubAllEnvs();
});

/* ── pure payload parsers ───────────────────────────────────────────────── */
describe("parseAgnesCompletion", () => {
  it("reads the documented OpenAI shape", async () => {
    const { parseAgnesCompletion } = await import("@/lib/api/agnes");
    expect(parseAgnesCompletion(AGNES_COMPLETION)).toBe("Fallback answer");
  });

  it("joins text blocks and ignores non-text parts", async () => {
    const { parseAgnesCompletion } = await import("@/lib/api/agnes");
    expect(
      parseAgnesCompletion({
        choices: [
          {
            message: {
              role: "assistant",
              content: [
                { type: "thinking", text: "IGNORED" },
                { type: "text", text: "part one" },
                { type: "text", text: "part two" },
              ],
            },
          },
        ],
      }),
    ).toBe("part one\npart two");
  });

  it("fails loudly instead of returning an empty reply", async () => {
    const { parseAgnesCompletion } = await import("@/lib/api/agnes");
    expect(() =>
      parseAgnesCompletion({
        choices: [{ message: { role: "assistant", content: "   " } }],
      }),
    ).toThrow(/empty completion/i);
    expect(() => parseAgnesCompletion({ choices: [] })).toThrow(
      /no completion choices/i,
    );
    expect(() => parseAgnesCompletion(null)).toThrow(/no usable response/i);
    expect(() =>
      parseAgnesCompletion({ error: { message: "model not found" } }),
    ).toThrow(/model not found/i);
  });
});

describe("parseAgnesImage", () => {
  it("reads data[0].url", async () => {
    const { parseAgnesImage } = await import("@/lib/api/agnes");
    expect(
      parseAgnesImage({
        created: 1,
        data: [{ url: "https://cdn.test/a.png", b64_json: null }],
      }),
    ).toBe("https://cdn.test/a.png");
  });

  it("rejects base64 output rather than trusting an unusable payload", async () => {
    const { parseAgnesImage } = await import("@/lib/api/agnes");
    expect(() =>
      parseAgnesImage({ data: [{ url: null, b64_json: "iVBORw0" }] }),
    ).toThrow(/base64/i);
    expect(() => parseAgnesImage({ data: [{ url: "not-a-url" }] })).toThrow(
      /unusable image url/i,
    );
    expect(() => parseAgnesImage({ data: [] })).toThrow(/no image data/i);
  });
});

/* ── message building ───────────────────────────────────────────────────── */
describe("buildFallbackMessages", () => {
  it("sends real turns, not the flattened prompt digest", async () => {
    const { buildFallbackMessages } = await import("@/lib/api/provider");
    const messages = buildFallbackMessages("and now?", [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
    ]);
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[1].content).toBe("first");
    expect(messages[messages.length - 1].content).toBe("and now?");
  });

  it("drops roles that are not chat turns and caps each turn", async () => {
    const { buildFallbackMessages } = await import("@/lib/api/provider");
    const messages = buildFallbackMessages("q", [
      { role: "system", content: "INJECTED" },
      { role: "tool", content: "noise" },
      { role: "user", content: "x".repeat(9000) },
    ]);
    expect(JSON.stringify(messages)).not.toContain("INJECTED");
    expect(JSON.stringify(messages)).not.toContain("noise");
    const long = messages.find(
      (m) => typeof m.content === "string" && m.content.startsWith("xxx"),
    )!;
    expect((long.content as string).length).toBeLessThanOrEqual(4000);
  });

  it("turns a pasted image into an image_url part the model can see", async () => {
    const { buildFallbackMessages } = await import("@/lib/api/provider");
    const messages = buildFallbackMessages(
      "what is in this image?",
      [],
      "https://cdn.test/a.jpg",
    );
    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "text", text: "what is in this image?" },
      { type: "image_url", image_url: { url: "https://cdn.test/a.jpg" } },
    ]);
  });

  it("ignores non-http image references", async () => {
    const { buildFallbackMessages } = await import("@/lib/api/provider");
    const messages = buildFallbackMessages("q", [], "file:///etc/passwd");
    expect(typeof messages[messages.length - 1].content).toBe("string");
  });
});

describe("extractImageUrl", () => {
  it("finds the markdown reference the composer inserts", async () => {
    const { extractImageUrl } = await import("@/app/api/chat/route");
    expect(
      extractImageUrl(
        "look here\n\n![reference image](https://cdn.test/a.jpg)\nwhat?",
      ),
    ).toBe("https://cdn.test/a.jpg");
    expect(extractImageUrl("no image here")).toBeUndefined();
    expect(extractImageUrl("![x](ftp://host/a)")).toBeUndefined();
  });
});

/* ── chat route: the fallback chain ─────────────────────────────────────── */
describe("POST /api/chat with a configured fallback", () => {
  it("falls back to Agnes when the key-less provider fails", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("apihub.agnes-ai.com")
        ? Response.json(AGNES_COMPLETION)
        : new Response("down", { status: 503, statusText: "Unavailable" }),
    );

    const res = await chat.POST(
      post(
        {
          model: "llama",
          prompt: "hi",
          history: [{ role: "user", content: "earlier" }],
        },
        freshIp(),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      response: "Fallback answer",
      model: "llama",
      provider: "agnes",
      fallbackUsed: true,
    });

    const agnesCall = calls.find((c) => c.url.includes("/chat/completions"))!;
    expect(agnesCall).toBeTruthy();
    const body = JSON.parse(String(agnesCall.init?.body));
    expect(body.model).toBe("agnes-2.5-flash");
    expect(body.stream).toBe(false);
    // genuine multi-turn, not the flattened digest
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
      "user",
    ]);
    expect(agnesCall.init?.headers).toMatchObject({
      Authorization: "Bearer sk-test-key",
    });
  });

  it("hands the fallback the user's real message, not the flattened digest", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("apihub.agnes-ai.com")
        ? Response.json(AGNES_COMPLETION)
        : new Response("down", { status: 503, statusText: "Unavailable" }),
    );
    await chat.POST(
      post(
        {
          model: "llama",
          prompt: "hi there",
          history: [{ role: "user", content: "earlier" }],
        },
        freshIp(),
      ),
    );
    const body = JSON.parse(
      String(
        calls.find((c) => c.url.includes("/chat/completions"))!.init?.body,
      ),
    );
    const last = body.messages[body.messages.length - 1];
    expect(last.content).toBe("hi there");
    // the scaffold built for the single-prompt provider must not leak into the fallback
    expect(JSON.stringify(body.messages)).not.toContain("User: ");
    expect(JSON.stringify(body.messages)).not.toContain("Assistant:");
  });

  it("sends the attached image as a vision part when the fallback answers", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("apihub.agnes-ai.com")
        ? Response.json(AGNES_COMPLETION)
        : new Response("down", { status: 503, statusText: "Unavailable" }),
    );
    await chat.POST(
      post(
        {
          model: "llama",
          prompt: "![reference image](https://cdn.test/a.jpg)\n describe it",
        },
        freshIp(),
      ),
    );
    const body = JSON.parse(
      String(
        calls.find((c) => c.url.includes("/chat/completions"))!.init?.body,
      ),
    );
    const last = body.messages[body.messages.length - 1];
    expect(last.content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://cdn.test/a.jpg" },
    });
  });

  it("never calls the fallback when the primary answers", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async () =>
      Response.json({ success: true, response: "Primary says hi" }),
    );
    const json = await (
      await chat.POST(post({ model: "llama", prompt: "hi" }, freshIp()))
    ).json();
    expect(json).toMatchObject({
      success: true,
      response: "Primary says hi",
      provider: "cvron",
      fallbackUsed: false,
    });
    expect(calls.some((c) => c.url.includes("agnes"))).toBe(false);
  });

  it("reports both providers failing without inventing an answer", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    spyFetch(
      async () =>
        new Response("nope", { status: 500, statusText: "Server error" }),
    );
    const res = await chat.POST(
      post({ model: "llama", prompt: "hi" }, freshIp()),
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/couldn.t reach the AI service/i);
    expect(json.response).toBeUndefined();
  });

  it("does not start a fallback request after the user stops generation", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const controller = new AbortController();
    const { calls } = spyFetch(async (url) => {
      if (url.includes("apihub.agnes-ai.com"))
        throw new Error("fallback must not run");
      controller.abort();
      return new Response("down", { status: 503, statusText: "Unavailable" });
    });
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": freshIp(),
      },
      body: JSON.stringify({ model: "llama", prompt: "hi" }),
      signal: controller.signal,
    });
    const res = await chat.POST(req);
    expect([499, 502]).toContain(res.status);
    expect(calls.some((c) => c.url.includes("apihub.agnes-ai.com"))).toBe(
      false,
    );
  });

  it("routes an explicitly chosen agnes model straight to the fallback", async () => {
    const { chat } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("apihub.agnes-ai.com")
        ? Response.json(AGNES_COMPLETION)
        : Response.json({ success: true, response: "WRONG PROVIDER" }),
    );
    const json = await (
      await chat.POST(
        post({ model: "agnes-2.5-flash", prompt: "hi" }, freshIp()),
      )
    ).json();
    // an explicit choice is not reported as a fallback
    expect(json).toMatchObject({
      success: true,
      response: "Fallback answer",
      model: "agnes-2.5-flash",
      provider: "agnes",
      fallbackUsed: false,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("POST /api/chat without a configured fallback", () => {
  it("keeps the honest 502 — no silent degradation", async () => {
    const { chat } = await loadWithKey(undefined);
    const { calls } = spyFetch(
      async () =>
        new Response("down", { status: 503, statusText: "Unavailable" }),
    );
    const res = await chat.POST(
      post({ model: "llama", prompt: "hi" }, freshIp()),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/couldn.t reach the AI service/i);
    expect(calls.every((c) => !c.url.includes("apihub.agnes-ai.com"))).toBe(
      true,
    );
  });

  it("refuses an agnes model with an actionable message", async () => {
    const { chat } = await loadWithKey(undefined);
    const { calls } = spyFetch(async () =>
      Response.json({ success: true, response: "should not be used" }),
    );
    const res = await chat.POST(
      post({ model: "agnes-2.5-flash", prompt: "hi" }, freshIp()),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/AGNES_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

/* ── image route ────────────────────────────────────────────────────────── */
describe("POST /api/image with a configured fallback", () => {
  it("retries the same prompt on the Agnes image model when flux fails", async () => {
    const { image } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("/images/generations")
        ? Response.json({
            created: 1,
            data: [{ url: "https://cdn.test/agnes.png" }],
          })
        : Response.json({ success: false, message: "gpu busy" }),
    );
    const res = await image.POST(
      post({ prompt: "a blue planet", ratio: "16:9" }, freshIp()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      imageUrl: "https://cdn.test/agnes.png",
      model: "agnes-image-2.1-flash",
      provider: "agnes",
      fallbackUsed: true,
    });
    const body = JSON.parse(
      String(
        calls.find((c) => c.url.includes("/images/generations"))!.init?.body,
      ),
    );
    expect(body).toMatchObject({
      model: "agnes-image-2.1-flash",
      prompt: "a blue planet",
      size: "1K",
      ratio: "16:9",
    });
    // documented placement: response_format lives inside extra_body, never at the top level
    expect(body.extra_body).toMatchObject({ response_format: "url" });
    expect(body.response_format).toBeUndefined();
    expect(body.extra_body.image).toBeUndefined();
  });

  it("passes a source image for edits", async () => {
    const { image } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("/images/generations")
        ? Response.json({ data: [{ url: "https://cdn.test/edit.png" }] })
        : new Response("down", { status: 503, statusText: "Unavailable" }),
    );
    const res = await image.POST(
      post(
        {
          mode: "edit",
          prompt: "make it night",
          imageUrl: "https://cdn.test/a.jpg",
        },
        freshIp(),
      ),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(
      String(
        calls.find((c) => c.url.includes("/images/generations"))!.init?.body,
      ),
    );
    expect(body.extra_body.image).toEqual(["https://cdn.test/a.jpg"]);
  });

  it("never answers an explicit agnes request with the key-less provider", async () => {
    const { image } = await loadWithKey("sk-test-key");
    const { calls } = spyFetch(async (url) =>
      url.includes("/images/generations")
        ? Response.json({ data: [{ url: "https://cdn.test/agnes.png" }] })
        : Response.json({
            success: true,
            image_url: "https://cdn.test/flux.png",
          }),
    );
    const json = await (
      await image.POST(
        post({ prompt: "x", model: "agnes-image-2.1-flash" }, freshIp()),
      )
    ).json();
    expect(json).toMatchObject({
      success: true,
      imageUrl: "https://cdn.test/agnes.png",
      provider: "agnes",
      fallbackUsed: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps a plain 502 when no key is configured", async () => {
    const { image } = await loadWithKey(undefined);
    spyFetch(async () =>
      Response.json({ success: false, message: "gpu busy" }),
    );
    const res = await image.POST(post({ prompt: "anything" }, freshIp()));
    expect(res.status).toBe(502);
    expect((await res.json()).imageUrl).toBeUndefined();
  });
});

/* ── secret containment ─────────────────────────────────────────────────── */
describe("fallback credential containment", () => {
  it("never resolves a key in a browser-like production runtime", async () => {
    // A real key IS present in the environment here — the guard, not the env, must win.
    process.env.AGNES_API_KEY = "sk-must-not-leak";
    vi.stubEnv("NODE_ENV", "production"); // jsdom gives a `window`, i.e. browser-like
    vi.resetModules();
    try {
      const env = await import("@/lib/api/fallback-env");
      expect(env.AGNES_API_KEY).toBe("");
      expect(env.AGNES_FALLBACK_ENABLED).toBe(false);
      const agnes = await import("@/lib/api/agnes");
      expect(agnes.isAgnesConfigured()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      delete process.env.AGNES_API_KEY;
    }
  });

  it("keeps the key out of every client-reachable config export", async () => {
    const config = await import("@/lib/api/config");
    const serialized = JSON.stringify(
      Object.fromEntries(
        Object.entries(config).filter(([, v]) => typeof v !== "function"),
      ),
    );
    expect(serialized).not.toContain("sk-test-key");
    expect(Object.keys(config)).not.toContain("AGNES_API_KEY");
  });
});

/* ── discovery routes ───────────────────────────────────────────────────── */
describe("model + health routes expose the fallback honestly", () => {
  it("lists the agnes model and its configuration state", async () => {
    await loadWithKey(undefined);
    vi.resetModules();
    const { GET } = await import("@/app/api/models/route");
    const json = await (await GET()).json();
    expect(json.text.map((m: { id: string }) => m.id)).toContain(
      "agnes-2.5-flash",
    );
    expect(json.image.map((m: { id: string }) => m.id)).toContain(
      "agnes-image-2.1-flash",
    );
    expect(json.fallback).toMatchObject({
      enabled: false,
      requiresKey: true,
      keyEnvVar: "AGNES_API_KEY",
    });
    // no key => the async video models are advertised as unavailable, not as silent WAN calls
    expect(json.fallback.videoModel).toBeNull();
    expect(json.fallback.textToVideo).toBe(false);
  });

  it("counts a down primary as degraded-with-fallback only when a key exists", async () => {
    await loadWithKey("sk-test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("down", { status: 503, statusText: "Unavailable" }),
      ),
    );
    vi.resetModules();
    const { GET } = await import("@/app/api/health/route");
    const json = await (await GET()).json();
    expect(json.status).toBe("degraded-with-fallback");
    expect(json.capabilities.vision).toBe(true);
    expect(json.capabilities.nativeConversationContext).toBe(true);
    expect(json.fallback.enabled).toBe(true);
    // the health probe must not spend fallback quota
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(
      "apihub.agnes-ai.com",
    );
  });
});
