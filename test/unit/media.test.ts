import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImage, editImage, generateVideo, hostImage } from "@/lib/api/media";

beforeEach(() => vi.unstubAllGlobals());

const stub = (body: unknown, init: { status?: number } = {}) =>
  vi.fn(async () => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, {
      status: init.status ?? 200,
      headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" },
    });
  });

describe("image generation", () => {
  it("returns the documented image_url", async () => {
    vi.stubGlobal("fetch", stub({ success: true, image_url: "https://cdn.test/a.jpg", author: "@cvroon" }));
    await expect(generateImage("a red fox")).resolves.toEqual({ imageUrl: "https://cdn.test/a.jpg" });
  });

  it("url-encodes the prompt into the flux-dev query string", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        seen = u;
        return Response.json({ image_url: "https://cdn.test/a.jpg" });
      })
    );
    await generateImage("cats & dogs = fun");
    const url = new URL(seen);
    expect(url.pathname).toBe("/cvronai/flux-dev.php");
    expect(url.searchParams.get("prompt")).toBe("cats & dogs = fun");
  });

  it("refuses to invent an image when the payload has no URL", async () => {
    vi.stubGlobal("fetch", stub({ success: true, message: "queued" }));
    await expect(generateImage("anything")).rejects.toThrow(/did not return a usable URL/i);
  });

  it("treats an HTML maintenance page as a failure, not an image", async () => {
    vi.stubGlobal("fetch", stub("<html><head><title>503</title></head></html>"));
    await expect(generateImage("anything")).rejects.toThrow(/HTML error page/i);
  });

  it("surfaces the provider error message", async () => {
    vi.stubGlobal("fetch", stub({ success: false, message: "gpu pool exhausted" }));
    await expect(generateImage("anything")).rejects.toThrow(/gpu pool exhausted/);
  });

  it("fails on a non-2xx response", async () => {
    vi.stubGlobal("fetch", stub({ error: "x" }, { status: 500 }));
    await expect(generateImage("anything")).rejects.toThrow(/HTTP 500/);
  });

  it("reads nested data.url payloads", async () => {
    vi.stubGlobal("fetch", stub({ data: { url: "https://cdn.test/nested.jpg" } }));
    await expect(generateImage("anything")).resolves.toEqual({ imageUrl: "https://cdn.test/nested.jpg" });
  });

  it("never accepts a non-http scheme as an image url", async () => {
    vi.stubGlobal("fetch", stub({ image_url: "javascript:alert(1)" }));
    await expect(generateImage("anything")).rejects.toThrow(/usable URL/i);
  });

  it("validates the prompt before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateImage("   ")).rejects.toThrow(/describe the image/i);
    await expect(generateImage("x".repeat(1001))).rejects.toThrow(/1000 characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("image editing", () => {
  it("sends prompt + image_url to image2image.php", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        seen = u;
        return Response.json({ image_url: "https://cdn.test/edited.jpg" });
      })
    );
    const { imageUrl } = await editImage("make it night", "https://host/in.jpg");
    expect(imageUrl).toBe("https://cdn.test/edited.jpg");
    const url = new URL(seen);
    expect(url.pathname).toBe("/cvronai/image2image.php");
    expect(url.searchParams.get("image_url")).toBe("https://host/in.jpg");
  });

  it("explains the public-URL requirement for invalid sources", async () => {
    await expect(editImage("x", "/local/path.png")).rejects.toThrow(/fetch publicly/i);
    await expect(editImage("x", "ftp://host/a.png")).rejects.toThrow(/fetch publicly/i);
  });
});

describe("video generation", () => {
  it("returns the finished mp4 url", async () => {
    vi.stubGlobal("fetch", stub({ success: true, videoUrl: "https://strshrt.xyz/videos/x.mp4" }));
    await expect(generateVideo("drifting clouds", "https://host/sky.jpg")).resolves.toEqual({
      videoUrl: "https://strshrt.xyz/videos/x.mp4",
    });
  });

  it("requires a source image (no text-to-video claim)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateVideo("move", "")).rejects.toThrow(/source image URL is required/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails loudly when the job produced no video", async () => {
    vi.stubGlobal("fetch", stub({ success: true, status: "processing" }));
    await expect(generateVideo("move", "https://host/a.jpg")).rejects.toThrow(/did not return a usable URL/i);
  });
});

describe("image host", () => {
  it("accepts a plain-text url body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("https://host.io/pic.png")));
    await expect(hostImage("https://other/pic.png")).resolves.toBe("https://host.io/pic.png");
  });

  it("accepts a json body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "https://host.io/pic.png" })));
    await expect(hostImage("https://other/pic.png")).resolves.toBe("https://host.io/pic.png");
  });

  it("rejects garbage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("uploaded! thanks")));
    await expect(hostImage("https://other/pic.png")).rejects.toThrow(/didn't return a usable URL/i);
  });

  it("validates the input url", async () => {
    await expect(hostImage("nope")).rejects.toThrow(/valid image URL/i);
  });
});
