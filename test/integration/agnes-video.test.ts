import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Agnes video: the one capability with an asynchronous contract ────────
 * Bliss must (a) never send a body the provider answers with HTTP 400,
 * (b) return a job id instead of pretending the clip is ready,
 * (c) read the documented fields only (top-level `url`, `status`, `progress`,
 *     `error.message`) and treat transport trouble as retryable, never as failure,
 * (d) refuse clearly when no key is configured instead of silently downgrading to
 *     the key-less image-to-video endpoint, which takes different inputs.
 */

const FLASH = "agnes-video-2.5-flash";
const PRO = "agnes-video-2.5";

function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "task_01",
    task_id: "task_01",
    video_id: "video_01",
    object: "video",
    model: FLASH,
    status: "queued",
    progress: 0,
    created_at: 1780000000,
    seconds: "8",
    size: "720P",
    ...overrides,
  };
}

function taskResponse(overrides: Record<string, unknown> = {}) {
  return Response.json(taskPayload(overrides));
}

let ipSeq = 200;
const freshIp = () => `198.51.100.${ipSeq++}`;

async function load(
  key: string | undefined,
  extra: Record<string, string> = {},
) {
  if (key) process.env.AGNES_API_KEY = key;
  else delete process.env.AGNES_API_KEY;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  vi.resetModules();
  const agnes = await import("@/lib/api/agnes");
  const provider = await import("@/lib/api/provider");
  const config = await import("@/lib/api/config");
  const video = await import("@/app/api/video/route");
  return { agnes, provider, config, video };
}

function postVideo(body: unknown, ip = freshIp()) {
  return new Request("http://localhost/api/video", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function pollVideo(jobId: string, model: string, ip = freshIp()) {
  return new Request(
    `http://localhost/api/video?jobId=${encodeURIComponent(jobId)}&model=${encodeURIComponent(model)}`,
    { headers: { "x-forwarded-for": ip } },
  );
}

/** Records every outbound call and answers with `handler`. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        init,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return handler(url, init);
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  delete process.env.AGNES_API_KEY;
  delete process.env.AGNES_BASE_URL;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ── request builder: the documented rules, enforced locally ─────────────── */
describe("buildAgnesVideoBody", () => {
  it("sends the documented defaults", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    const body = buildAgnesVideoBody({ prompt: "  coffee pours  " });
    expect(body).toEqual({
      model: FLASH,
      prompt: "coffee pours",
      seconds: "5",
      size: "720P",
      aspect_ratio: "16:9",
      mode: "text",
    });
  });

  it("keeps seconds a string inside 4-12", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(buildAgnesVideoBody({ prompt: "x", seconds: 12 }).seconds).toBe(
      "12",
    );
    for (const seconds of [3, 13, 4.5, 0]) {
      expect(() => buildAgnesVideoBody({ prompt: "x", seconds })).toThrow(
        /whole number of seconds between 4 and 12/,
      );
    }
  });

  it("restricts the free promotional model to 720P", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", model: FLASH, size: "1080P" }),
    ).toThrow(/supports 720P only/);
    expect(
      buildAgnesVideoBody({ prompt: "x", model: PRO, size: "2K" }).size,
    ).toBe("2K");
  });

  it("rejects aspect ratios the provider doesn't document", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", aspectRatio: "5:4" }),
    ).toThrow(/supports these aspect ratios/);
    // "auto" is explicitly rejected upstream, so Bliss never sends it either.
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", aspectRatio: "auto" }),
    ).toThrow(/aspect ratios/);
  });

  it("refuses media that contradicts the chosen mode", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        mode: "text",
        images: ["https://cdn.local/a.png"],
      }),
    ).toThrow(/Text mode takes a prompt only/);
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", mode: "keyframe" }),
    ).toThrow(/needs a first frame/);
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        mode: "keyframe",
        firstFrame: "https://cdn.local/a.png",
        images: ["https://cdn.local/b.png"],
      }),
    ).toThrow(/first_frame\/last_frame only/);
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", mode: "reference" }),
    ).toThrow(/at least one image, audio or video/);
  });

  it("sends keyframes as first_frame/last_frame", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(
      buildAgnesVideoBody({
        prompt: "x",
        mode: "keyframe",
        firstFrame: "https://cdn.local/a.png",
        lastFrame: "https://cdn.local/b.png",
      }),
    ).toMatchObject({
      mode: "keyframe",
      first_frame: "https://cdn.local/a.png",
      last_frame: "https://cdn.local/b.png",
    });
  });

  it("enforces the per-model media ceilings", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    const six = Array.from(
      { length: 6 },
      (_, i) => `https://cdn.local/${i}.png`,
    );
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        mode: "reference",
        images: six.slice(0, 5),
      }),
    ).not.toThrow();
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", mode: "reference", images: six }),
    ).toThrow(/at most 5 reference images/);
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        model: PRO,
        mode: "reference",
        images: Array.from(
          { length: 9 },
          (_, i) => `https://cdn.local/${i}.png`,
        ),
      }),
    ).toThrow(/at most 8 reference images/);
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        mode: "reference",
        audios: ["a", "b", "c", "d"].map((n) => `https://cdn.local/${n}.mp3`),
      }),
    ).toThrow(/at most 3 reference audio/);
  });

  it("only agnes-video-2.5 takes a reference video", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() =>
      buildAgnesVideoBody({
        prompt: "x",
        mode: "reference",
        referenceVideo: { url: "https://cdn.local/clip.mp4" },
      }),
    ).toThrow(/doesn't accept reference videos/);

    const body = buildAgnesVideoBody({
      prompt: "x",
      model: PRO,
      mode: "reference",
      referenceVideo: {
        url: "https://cdn.local/clip.mp4",
        startSeconds: 2.9,
        requireAudio: true,
      },
    });
    expect(body.videos).toEqual([
      {
        url: "https://cdn.local/clip.mp4",
        // the builder passes the documented field through; the route truncates it
        start_seconds: 2.9,
        require_audio: true,
      },
    ]);
  });

  it("requires public http(s) media and never a local or data URL", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    for (const url of [
      "file:///tmp/a.png",
      "data:image/png;base64,AAAA",
      "not a url",
    ]) {
      expect(() =>
        buildAgnesVideoBody({ prompt: "x", mode: "keyframe", firstFrame: url }),
      ).toThrow(/publicly reachable http\(s\) URL/);
    }
  });

  it("never emits the forbidden pixel/frames knobs", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    const body = buildAgnesVideoBody({
      prompt: "x",
      seconds: 6,
      size: "720P",
      aspectRatio: "9:16",
      seed: 7,
    });
    expect(body).toMatchObject({ seed: 7, seconds: "6", aspect_ratio: "9:16" });
    for (const key of [
      "width",
      "height",
      "fps",
      "num_frames",
      "quality",
      "num_inference_steps",
      "n",
      "video_url",
      "video_path",
      "reference_url",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("rejects an empty or oversized prompt", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() => buildAgnesVideoBody({ prompt: "   " })).toThrow(
      /Describe the motion/,
    );
    expect(() => buildAgnesVideoBody({ prompt: "a".repeat(4001) })).toThrow(
      /too long/,
    );
  });

  it("refuses a model that isn't a documented Agnes video model", async () => {
    const { buildAgnesVideoBody } = await import("@/lib/api/agnes");
    expect(() =>
      buildAgnesVideoBody({ prompt: "x", model: "agnes-video-9.9" }),
    ).toThrow(/isn't a documented Agnes model/);
  });
});

/* ── response parsers ──────────────────────────────────────────────────── */
describe("parseAgnesVideoTask", () => {
  it("prefers video_id and falls back to id", async () => {
    const { parseAgnesVideoTask } = await import("@/lib/api/agnes");
    expect(parseAgnesVideoTask(taskPayload(), FLASH)).toMatchObject({
      videoId: "video_01",
      taskId: "task_01",
      status: "queued",
      model: FLASH,
    });
    expect(
      parseAgnesVideoTask({ id: "task_only", status: "queued" }, FLASH).videoId,
    ).toBe("task_only");
  });

  it("throws when there is nothing to poll", async () => {
    const { parseAgnesVideoTask } = await import("@/lib/api/agnes");
    expect(() => parseAgnesVideoTask({ status: "queued" }, FLASH)).toThrow(
      /didn't return a task id/,
    );
    expect(() => parseAgnesVideoTask(null, FLASH)).toThrow(
      /unexpected response/,
    );
  });

  it("surfaces an upstream error message instead of a bare id", async () => {
    const { parseAgnesVideoTask } = await import("@/lib/api/agnes");
    expect(() =>
      parseAgnesVideoTask(
        { error: { message: "Insufficient credits for this model" } },
        PRO,
      ),
    ).toThrow(/Insufficient credits/);
  });
});

describe("parseAgnesVideoStatus", () => {
  it("reads the top-level url and clamps progress", async () => {
    const { parseAgnesVideoStatus } = await import("@/lib/api/agnes");
    expect(
      parseAgnesVideoStatus({ status: "in_progress", progress: 142 }),
    ).toMatchObject({ status: "in_progress", progress: 100 });
    expect(
      parseAgnesVideoStatus({
        status: "completed",
        progress: 100,
        url: "https://cdn.local/clip.mp4",
        internal_signed: "ignored",
      }),
    ).toEqual({
      status: "completed",
      progress: 100,
      videoUrl: "https://cdn.local/clip.mp4",
    });
  });

  it("reports a completed-but-urlless task as retryable, not as a broken link", async () => {
    const { parseAgnesVideoStatus } = await import("@/lib/api/agnes");
    const out = parseAgnesVideoStatus({ status: "completed", url: null });
    expect(out.status).toBe("completed");
    expect(out.videoUrl).toBeUndefined();
    expect(out.error).toMatch(/without a usable URL/);
  });

  it("keeps a failed task failed with the provider's reason", async () => {
    const { parseAgnesVideoStatus } = await import("@/lib/api/agnes");
    expect(
      parseAgnesVideoStatus({
        status: "failed",
        progress: 61,
        error: { message: "Seed exceeded the supported range" },
      }),
    ).toMatchObject({
      status: "failed",
      error: "Seed exceeded the supported range",
    });
  });
});

/* ── wire shape of both calls ───────────────────────────────────────────── */
describe("createAgnesVideo + getAgnesVideoStatus", () => {
  it("posts to /v1/videos and polls the host root /agnesapi", async () => {
    process.env.AGNES_BASE_URL = "http://127.0.0.1:4599/v1";
    const { video } = await load("sk-test-key");
    const calls = mockFetch((url) =>
      url.includes("/agnesapi")
        ? Response.json({
            status: "completed",
            progress: 100,
            url: "https://cdn.local/agnes-video_01.mp4",
          })
        : taskResponse(),
    );

    const created = await (
      await video.POST(
        postVideo({ prompt: "coffee", model: FLASH, seconds: 8 }),
      )
    ).json();
    expect(created).toMatchObject({
      success: true,
      async: true,
      jobId: "video_01",
      provider: "agnes",
      status: "queued",
      pollIntervalMs: 2000,
    });
    expect(calls[0].url).toBe("http://127.0.0.1:4599/v1/videos");
    expect(calls[0].init?.method).toBe("POST");
    expect(
      (calls[0].init?.headers as Record<string, string>)["Authorization"],
    ).toBe("Bearer sk-test-key");
    expect(calls[0].body).toMatchObject({ seconds: "8", size: "720P" });

    const polled = await (await video.GET(pollVideo("video_01", FLASH))).json();
    expect(polled).toMatchObject({
      success: true,
      status: "completed",
      progress: 100,
      videoUrl: "https://cdn.local/agnes-video_01.mp4",
    });
    const pollCall = calls[1];
    expect(pollCall.url).toBe(
      "http://127.0.0.1:4599/agnesapi?video_id=video_01&model_name=agnes-video-2.5-flash",
    );
    expect(pollCall.init?.method).toBe("GET");
    expect(pollCall.init?.body).toBeUndefined();
  });

  it("keeps the key out of the response and never returns an upstream error verbatim", async () => {
    const { video } = await load("sk-secret-do-not-leak");
    mockFetch(() =>
      Response.json(
        {
          error: {
            message: "upstream exploded",
            api_key: "sk-secret-do-not-leak",
          },
        },
        { status: 500 },
      ),
    );
    const res = await video.POST(postVideo({ prompt: "coffee", model: FLASH }));
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json.success).toBe(false);
    expect(json.jobId).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("sk-secret-do-not-leak");
  });

  it("treats a failed poll as transient so the loop can retry", async () => {
    await load("sk-test-key");
    const { getAgnesVideoStatus } = await import("@/lib/api/agnes");
    mockFetch(() => new Response("<html>gateway</html>", { status: 502 }));
    const out = await getAgnesVideoStatus({
      videoId: "video_01",
      model: FLASH,
    });
    expect(out).toMatchObject({ status: "in_progress", progress: 0 });
    expect(out.videoUrl).toBeUndefined();
    expect(out.error).toMatch(/HTTP 502/);
  });

  it("rejects a task id that can't be a real one", async () => {
    await load("sk-test-key");
    const { getAgnesVideoStatus } = await import("@/lib/api/agnes");
    const calls = mockFetch(() => Response.json({ status: "queued" }));
    await expect(
      getAgnesVideoStatus({ videoId: "../../v1/admin", model: FLASH }),
    ).rejects.toThrow(/isn't valid/);
    expect(calls).toHaveLength(0);
  });
});

describe("video model catalogue rules", () => {
  it("honours AGNES_VIDEO_MODEL for a documented id and ignores a bogus one", async () => {
    const { readAgnesVideoModel } = await import("@/lib/api/config");
    expect(readAgnesVideoModel(PRO)).toBe(PRO);
    expect(readAgnesVideoModel("  agnes-video-2.5  ")).toBe(PRO);
    expect(readAgnesVideoModel("agnes-video-9.9")).toBe(FLASH);
    expect(readAgnesVideoModel(undefined)).toBe(FLASH);
  });

  it("keeps the billing, size and reference differences between the two engines", async () => {
    const { agnesVideoModel } = await import("@/lib/api/config");
    expect(agnesVideoModel(FLASH)?.billed).toBe(false);
    expect(agnesVideoModel(PRO)?.billed).toBe(true);
    expect(agnesVideoModel(PRO)?.sizes).toEqual(["720P", "1080P", "1K", "2K"]);
    expect(agnesVideoModel(FLASH)?.videoReference).toBe(false);
    expect(agnesVideoModel(FLASH)?.maxImages).toBe(5);
    expect(agnesVideoModel(PRO)?.maxImages).toBe(8);
  });

  it("exposes every video engine in the shared catalogue with its endpoint", async () => {
    const {
      VIDEO_MODELS_WITH_FALLBACK,
      MODELS_WITH_FALLBACK,
      IMAGE_MODELS_WITH_FALLBACK,
    } = await import("@/lib/api/config");
    expect(VIDEO_MODELS_WITH_FALLBACK.map((m) => m.id)).toEqual([
      "wan-2.2",
      FLASH,
      PRO,
    ]);
    // chat and image catalogues carry the same promise: only documented ids
    expect(
      MODELS_WITH_FALLBACK.filter((m) => m.fallback).map((m) => m.id),
    ).toEqual([
      "agnes-2.5-flash",
      "agnes-3.0-flash",
      "agnes-2.5-pro",
      "agnes-2.5-pro-beta",
    ]);
    expect(
      IMAGE_MODELS_WITH_FALLBACK.filter((m) => m.fallback).map((m) => m.id),
    ).toEqual([
      "agnes-image-2.0-flash",
      "agnes-image-2.1-flash",
      "agnes-image-2.5-flash",
    ]);
    // the deprecated agnes-2.0-flash is deliberately absent from every catalogue
    const all = [
      ...MODELS_WITH_FALLBACK,
      ...IMAGE_MODELS_WITH_FALLBACK,
      ...VIDEO_MODELS_WITH_FALLBACK,
    ]
      .map((m) => m.id)
      .join(" ");
    expect(all).not.toContain("agnes-2.0-flash");
    expect(all).not.toContain("agnes-3.0-pro");
  });
});

/* ── provider seam + route behaviour ────────────────────────────────────── */
describe("video route policy", () => {
  it("refuses an Agnes video with a clear set-up error when no key exists", async () => {
    const { video } = await load(undefined);
    const calls = mockFetch(() => taskResponse());
    const res = await video.POST(postVideo({ prompt: "coffee", model: FLASH }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      provider: "agnes",
      fallbackUsed: false,
    });
    expect(json.error).toMatch(/AGNES_API_KEY/);
    expect(json.jobId).toBeUndefined();
    // ...and it must not quietly spend a request on the key-less provider instead.
    expect(calls).toHaveLength(0);
  });

  it("starts a video without a key on the key-less provider only through the WAN path", async () => {
    const { provider } = await load(undefined);
    const job = await provider.startAgnesVideo({
      prompt: "coffee",
      model: FLASH,
    });
    expect(job).toMatchObject({
      jobId: "",
      status: "failed",
      provider: "agnes",
    });
    expect(job.error).toMatch(/AGNES_API_KEY/);
    const poll = await provider.pollAgnesVideo("video_01", FLASH);
    expect(poll.status).toBe("failed");
    expect(poll.error).toMatch(/isn't enabled/);
  });

  it("rejects an unknown video model instead of guessing", async () => {
    const { video } = await load("sk-test-key");
    const res = await video.POST(
      postVideo({
        prompt: "coffee",
        model: "sora-3",
        imageUrl: "https://cdn.local/a.png",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(
      /WAN 2\.2 or a documented Agnes video model/,
    );
  });

  it("keeps WAN 2.2 image-to-video only", async () => {
    const { video } = await load(undefined);
    const noImage = await video.POST(postVideo({ prompt: "coffee" }));
    expect(noImage.status).toBe(400);
    expect((await noImage.json()).error).toMatch(/image-to-video only/);
    const unsafe = await video.POST(
      postVideo({ prompt: "coffee", imageUrl: "file:///tmp/a.png" }),
    );
    expect(unsafe.status).toBe(400);
  });

  it("validates the poll request", async () => {
    const { video } = await load("sk-test-key");
    const res = await video.GET(
      new Request("http://localhost/api/video", {
        headers: { "x-forwarded-for": freshIp() },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/task id is required/);
  });

  it("answers 400 — not 502 — for input Bliss refuses on documented grounds", async () => {
    const { video } = await load("sk-test-key");
    const calls = mockFetch(() => taskResponse());
    for (const body of [
      { prompt: "x", model: FLASH, ratio: "5:4" }, // ratio the provider doesn't document
      { prompt: "x", model: PRO, seconds: 30 }, // outside the 4-12s range
      { prompt: "x", model: FLASH, size: "4K" }, // 1K tiers are images, not video
      { prompt: "", model: FLASH },
    ]) {
      const res = await video.POST(postVideo(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // none of them reached the provider, so none of them cost quota
    expect(calls).toHaveLength(0);
  });

  it("rejects a task id that could never be a real one when polling", async () => {
    const { video } = await load("sk-test-key");
    const calls = mockFetch(() => Response.json({ status: "queued" }));
    const res = await video.GET(pollVideo("../secrets", FLASH));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't valid/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces an upstream outage as 502, not as a bad request", async () => {
    const { video } = await load("sk-test-key");
    mockFetch(() => new Response("nope", { status: 503 }));
    const res = await video.POST(postVideo({ prompt: "coffee", model: FLASH }));
    expect(res.status).toBe(502);
    expect((await res.json()).jobId).toBeUndefined();
  });

  it("429s a device that creates videos too fast, and never starts a job for it", async () => {
    const { video } = await load("sk-test-key");
    mockFetch(() => taskResponse());
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push(
        (await video.POST(postVideo({ prompt: "coffee", model: FLASH }, ip)))
          .status,
      );
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 6).every((s) => s === 200)).toBe(true);
  });

  it("derives the provider mode from the media actually present", async () => {
    const { video } = await load("sk-test-key");
    const calls = mockFetch(() => taskResponse());
    await video.POST(
      postVideo({
        prompt: "coffee",
        model: PRO,
        size: "1080P",
        firstFrameUrl: "https://cdn.local/a.png",
        lastFrameUrl: "https://cdn.local/b.png",
      }),
    );
    expect(calls[0].body).toMatchObject({
      mode: "keyframe",
      first_frame: "https://cdn.local/a.png",
      last_frame: "https://cdn.local/b.png",
      size: "1080P",
    });
  });

  it("reports the video catalogue and capability honestly", async () => {
    await load(undefined);
    vi.resetModules();
    const { GET } = await import("@/app/api/models/route");
    const json = await (await GET()).json();
    expect(json.video.map((m: { id: string }) => m.id)).toEqual([
      "wan-2.2",
      FLASH,
      PRO,
    ]);
    expect(json.fallback.videoModel).toBeNull();
    expect(json.fallback.textToVideo).toBe(false);
    expect(json.fallback.videoModels).toEqual([]);
  });

  it("caps the route's prompt at the studio limit", async () => {
    const { video } = await load("sk-test-key");
    const calls = mockFetch(() => taskResponse());
    const res = await video.POST(
      postVideo({ prompt: "a".repeat(1501), model: FLASH }),
    );
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("advertises the default video model only while a key is configured", async () => {
    await load("sk-test-key");
    vi.resetModules();
    mockFetch(() => new Response("down", { status: 503 }));
    const { GET } = await import("@/app/api/health/route");
    const json = await (await GET()).json();
    expect(json.fallback.videoModel).toBe(FLASH);
    expect(json.capabilities.textToVideo).toBe(true);
  });
});
