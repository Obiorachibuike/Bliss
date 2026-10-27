// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Composer } from "@/components/chat/Composer";
import { ImageStudio } from "@/components/image/ImageStudio";
import { VideoStudio } from "@/components/video/VideoStudio";
import { __resetCatalogForTests } from "@/lib/hooks/useModelCatalog";
import type { ChatMessage } from "@/lib/types";

/* The client must never over-claim: fallback affordances only appear when the server
 * reports the fallback provider as configured (GET /api/models). */

const TEXT_MODELS = [
  {
    id: "llama",
    name: "Llama 3.3",
    provider: "Meta",
    description: "Versatile open model.",
    capabilities: ["General chat"],
    endpoint: "https://cvron.test/llama.php",
    color: "#2563EB",
    icon: "🦙",
    available: true as const,
    fallback: false,
  },
  {
    id: "agnes-2.5-flash",
    name: "Agnes 2.5 Flash",
    provider: "Agnes AI",
    description: "Fallback provider model.",
    capabilities: ["General chat", "Vision"],
    endpoint: "https://apihub.agnes-ai.com/v1/chat/completions",
    color: "#0EA5E9",
    icon: "🛡️",
    available: true as const,
    fallback: true,
  },
];

const IMAGE_MODELS = [
  {
    id: "flux-dev",
    name: "Flux Dev",
    provider: "Black Forest Labs",
    description: "Fast images.",
    endpoint: "https://cvron.test/flux-dev.php",
    capabilities: ["Text-to-Image"],
    available: true,
    fallback: false,
  },
  {
    id: "agnes-image-2.1-flash",
    name: "Agnes Image 2.1 Flash",
    provider: "Agnes AI",
    description: "Ratio-aware generation and edits.",
    endpoint: "https://apihub.agnes-ai.com/v1/images/generations",
    capabilities: ["Text-to-Image", "Image-to-Image"],
    available: true,
    fallback: true,
  },
];

const VIDEO_MODELS = [
  {
    id: "wan-2.2",
    name: "WAN 2.2",
    provider: "CVRON",
    description: "Image-to-video from a public source frame.",
    capabilities: ["Image-to-Video"],
    endpoint: "https://cvron.test/wan22.php",
    available: true,
    fallback: false,
  },
  {
    id: "agnes-video-2.5-flash",
    name: "Agnes Video 2.5 Flash",
    provider: "Agnes AI",
    description: "Free promotional tier, 720P only.",
    capabilities: ["Text-to-Video", "Keyframes", "Image reference"],
    endpoint: "https://apihub.agnes-ai.com/v1/videos",
    available: true,
    fallback: true,
  },
];

function stubCatalog({
  enabled,
  onFetch,
}: {
  enabled: boolean;
  onFetch?: (url: string, init?: RequestInit) => Response | undefined;
}) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const custom = onFetch?.(url, init);
      if (custom) return custom;
      if (url === "/api/models") {
        return Response.json({
          success: true,
          text: TEXT_MODELS,
          image: IMAGE_MODELS,
          video: VIDEO_MODELS,
          fallback: {
            enabled,
            provider: "Agnes AI",
            vision: enabled,
            nativeConversationContext: enabled,
            chatModels: enabled ? ["agnes-2.5-flash"] : [],
            imageModel: enabled ? "agnes-image-2.1-flash" : null,
            videoModel: enabled ? "agnes-video-2.5-flash" : null,
            videoModels: enabled
              ? ["agnes-video-2.5-flash", "agnes-video-2.5"]
              : [],
            textToVideo: enabled,
            docs: "https://www.agnes-ai.com/en/docs",
          },
        });
      }
      return Response.json({ ok: true });
    }),
  );
  // fresh module-level catalogue store for this test
  __resetCatalogForTests();
  return calls;
}

const wrap = (ui: React.ReactNode) => <ThemeProvider>{ui}</ThemeProvider>;
/** Only true leaf matches — avoids "found multiple" from ancestor elements. */
const textIn = (needle: RegExp) => (_: string, el: Element | null) =>
  !!el &&
  needle.test((el.textContent ?? "").trim()) &&
  ![...el.children].some((c) => needle.test((c.textContent ?? "").trim()));

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetCatalogForTests();
  localStorage.clear();
});

describe("message list fallback attribution", () => {
  const base: ChatMessage = {
    id: "a1",
    role: "assistant",
    content: "Here you go.",
    timestamp: 2,
    modelId: "llama",
  };

  it("badges a reply that came from the fallback provider", () => {
    render(wrap(<MessageList messages={[{ ...base, via: "agnes" }]} />));
    expect(screen.getByText(textIn(/via Agnes/))).toBeInTheDocument();
  });

  it("stays quiet when the primary provider answered", () => {
    render(wrap(<MessageList messages={[{ ...base, via: "cvron" }]} />));
    expect(screen.queryByText(textIn(/via Agnes/))).not.toBeInTheDocument();
    expect(screen.getByText("llama")).toBeInTheDocument();
  });
});

describe("model selector and the fallback catalogue", () => {
  it("offers the agnes model and reports the fallback as active", async () => {
    stubCatalog({ enabled: true });
    const onChange = vi.fn();
    render(wrap(<ModelSelector value="llama" onChange={onChange} />));
    await userEvent.click(screen.getByRole("button", { name: /llama 3.3/i }));
    expect(await screen.findByText("Agnes 2.5 Flash")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(textIn(/fallback provider active/i)),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Agnes 2.5 Flash"));
    expect(onChange).toHaveBeenCalledWith("agnes-2.5-flash");
  });

  it("still lists the agnes model when no key is set, and says what it needs", async () => {
    stubCatalog({ enabled: false });
    render(wrap(<ModelSelector value="llama" onChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /llama 3.3/i }));
    expect(await screen.findByText("Agnes 2.5 Flash")).toBeInTheDocument();
    expect(
      screen.getByText(textIn(/Set AGNES_API_KEY to unlock/i)),
    ).toBeInTheDocument();
    expect(screen.getByText(textIn(/no API key needed/i))).toBeInTheDocument();
  });
});

describe("composer attachment affordance", () => {
  it("promises image analysis only when the fallback provides it", async () => {
    stubCatalog({ enabled: true });
    render(
      wrap(
        <Composer
          onSend={vi.fn()}
          selectedModel="llama"
          onModelChange={vi.fn()}
        />,
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /attach an image reference/i }),
    );
    expect(
      await screen.findByText(/attach an image for analysis/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(textIn(/real image_url part/i)),
    ).toBeInTheDocument();
  });

  it("states the limitation plainly when there is no vision", async () => {
    stubCatalog({ enabled: false });
    render(
      wrap(
        <Composer
          onSend={vi.fn()}
          selectedModel="llama"
          onModelChange={vi.fn()}
        />,
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /attach an image reference/i }),
    );
    expect(await screen.findByText(/accept text only/i)).toBeInTheDocument();
  });
});

describe("image studio model chooser", () => {
  it("offers both image models and marks the key requirement", async () => {
    stubCatalog({ enabled: false });
    render(
      wrap(
        <ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />,
      ),
    );
    expect(await screen.findByText("Flux Dev")).toBeInTheDocument();
    expect(screen.getByText("Agnes Image 2.1 Flash")).toBeInTheDocument();
    expect(screen.getByText("needs AGNES_API_KEY")).toBeInTheDocument();
  });

  it("labels the agnes model as the fallback provider once it is configured", async () => {
    stubCatalog({ enabled: true });
    render(
      wrap(
        <ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />,
      ),
    );
    expect(await screen.findByText("fallback provider")).toBeInTheDocument();
    expect(screen.queryByText("needs AGNES_API_KEY")).not.toBeInTheDocument();
  });
});

describe("video studio engine + task controls", () => {
  it("lists every documented engine and says plainly which one needs a key", async () => {
    stubCatalog({ enabled: false });
    render(wrap(<VideoStudio onOpenMobileNav={vi.fn()} />));
    expect(await screen.findByText("WAN 2.2")).toBeInTheDocument();
    expect(screen.getByText("Agnes Video 2.5 Flash")).toBeInTheDocument();
    expect(
      screen.getByText(/Needs AGNES_API_KEY on the server/i),
    ).toBeInTheDocument();
    // the key-less engine keeps its own control set: a source image, not task settings
    expect(screen.getByText("Source & motion")).toBeInTheDocument();
    expect(screen.queryByText("Task settings")).not.toBeInTheDocument();
  });

  it("swaps in the task controls the chosen engine actually supports", async () => {
    stubCatalog({ enabled: true });
    render(wrap(<VideoStudio onOpenMobileNav={vi.fn()} />));
    expect(screen.getByText("Source & motion")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("Agnes Video 2.5 Flash"));
    expect(await screen.findByText("Task settings")).toBeInTheDocument();
    expect(screen.getByText("Text → video")).toBeInTheDocument();
    expect(screen.getByText("Keyframes")).toBeInTheDocument();
    expect(screen.getByText("References")).toBeInTheDocument();
    // WAN's mandatory source-image field is gone for a text-to-video engine
    expect(screen.queryByText(/public source image/i)).not.toBeInTheDocument();
    expect(screen.getByText("$0 promo")).toBeInTheDocument();
  });

  it("refuses to start an Agnes task on a deployment without a key", async () => {
    const calls = stubCatalog({ enabled: false });
    render(wrap(<VideoStudio onOpenMobileNav={vi.fn()} />));
    await userEvent.click(await screen.findByText("Agnes Video 2.5 Flash"));
    await userEvent.type(
      screen.getByLabelText(/motion prompt|\bprompt\b/i),
      "coffee pours",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /generate video/i }),
    );
    expect(
      await screen.findByText(/needs the optional Agnes provider/i),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/video")).toHaveLength(0);
  });

  it("creates a task, polls it from the browser and shows the finished clip", async () => {
    let polls = 0;
    const calls = stubCatalog({
      enabled: true,
      onFetch: (url, init) => {
        if (!url.startsWith("/api/video")) return undefined;
        if (init?.method === "POST") {
          return Response.json({
            success: true,
            async: true,
            jobId: "video_ui",
            model: "agnes-video-2.5-flash",
            provider: "agnes",
            status: "queued",
            progress: 0,
            pollIntervalMs: 1,
            maxWaitMs: 5000,
          });
        }
        polls += 1;
        return Response.json(
          polls < 2
            ? {
                success: true,
                jobId: "video_ui",
                status: "in_progress",
                progress: 40,
              }
            : {
                success: true,
                jobId: "video_ui",
                status: "completed",
                progress: 100,
                videoUrl: "https://cdn.local/clip.mp4",
              },
        );
      },
    });
    render(wrap(<VideoStudio onOpenMobileNav={vi.fn()} />));
    await userEvent.click(await screen.findByText("Agnes Video 2.5 Flash"));
    await userEvent.type(
      screen.getByLabelText(/motion prompt|\bprompt\b/i),
      "macro shot of coffee",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /generate video/i }),
    );

    const video = await waitFor(() => {
      const el = document.querySelector("video");
      if (!el) throw new Error("no <video> yet");
      return el;
    });
    expect(video.getAttribute("src")).toBe("https://cdn.local/clip.mp4");
    expect(polls).toBeGreaterThanOrEqual(2);

    const create = calls.find((c) => c.url === "/api/video" && c.body);
    expect(create?.body).toMatchObject({
      model: "agnes-video-2.5-flash",
      prompt: expect.stringContaining("macro shot of coffee"),
      // text is the provider's default mode, so an untouched form stays in it
      mode: "text",
      size: "720P",
      aspectRatio: "16:9",
    });
    expect(create?.body).not.toHaveProperty("firstFrameUrl");
    // the poll carries the id and the model the provider needs to look it up
    expect(
      calls.some((c) =>
        /jobId=video_ui&model=agnes-video-2\.5-flash/.test(c.url),
      ),
    ).toBe(true);
  });

  it("stops watching without pretending the task was cancelled", async () => {
    stubCatalog({
      enabled: true,
      onFetch: (url, init) =>
        url.startsWith("/api/video") && init?.method === "POST"
          ? Response.json({
              success: true,
              async: true,
              jobId: "video_slow",
              model: "agnes-video-2.5-flash",
              status: "queued",
              progress: 0,
              pollIntervalMs: 25,
              maxWaitMs: 5_000,
            })
          : undefined,
    });
    render(wrap(<VideoStudio onOpenMobileNav={vi.fn()} />));
    await userEvent.click(await screen.findByText("Agnes Video 2.5 Flash"));
    await userEvent.type(
      screen.getByLabelText(/motion prompt|\bprompt\b/i),
      "coffee pours",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /generate video/i }),
    );
    // only stop once the task id is known — that's the moment the note appears
    expect(
      await screen.findByText(/queued on Agnes Video 2.5 Flash/i),
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("button", { name: /stop watching/i }),
    );
    expect(
      await screen.findByText(/Stopped watching task video_slow/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/keeps rendering upstream/i)).toBeInTheDocument();

    // the task is resumable from the same tab: the control names the real task id
    const keep = screen.getByRole("button", {
      name: /keep watching task video_slow/i,
    });
    let resumed = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("/api/video") && init?.method !== "POST") {
          resumed += 1;
          return Response.json({
            success: true,
            jobId: "video_slow",
            status: "completed",
            progress: 100,
            videoUrl: "https://cdn.local/resumed.mp4",
          });
        }
        return Response.json({ ok: true });
      }),
    );
    await userEvent.click(keep);
    await waitFor(() => expect(resumed).toBeGreaterThan(0));
    await waitFor(() =>
      expect(document.querySelector("video")?.getAttribute("src")).toBe(
        "https://cdn.local/resumed.mp4",
      ),
    );
    // resuming never creates a second task
    expect(
      screen.getByText(/finished on Agnes Video 2.5 Flash/i),
    ).toBeInTheDocument();
  });
});

describe("image studio output tier", () => {
  it("only offers a size tier for the model that documents one", async () => {
    stubCatalog({ enabled: true });
    render(
      wrap(
        <ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />,
      ),
    );
    expect(screen.queryByText("Output tier")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByText("Agnes Image 2.1 Flash"));
    expect(await screen.findByText("Output tier")).toBeInTheDocument();
    expect(screen.getByText("4K")).toBeInTheDocument();
  });

  it("forwards the chosen tier with the request", async () => {
    const calls = stubCatalog({
      enabled: true,
      onFetch: (url, init) =>
        url === "/api/image" && init?.method === "POST"
          ? Response.json({
              success: true,
              imageUrl: "https://cdn.local/planet.png",
              model: "agnes-image-2.1-flash",
              provider: "agnes",
              fallbackUsed: false,
            })
          : undefined,
    });
    render(
      wrap(
        <ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />,
      ),
    );
    await userEvent.click(await screen.findByText("Agnes Image 2.1 Flash"));
    await userEvent.click(await screen.findByText("2K"));
    await userEvent.click(
      screen.getByRole("button", { name: /^generate image$/i }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url === "/api/image")).toBe(true),
    );
    const body = calls.find((c) => c.url === "/api/image")?.body;
    expect(body).toMatchObject({ model: "agnes-image-2.1-flash", size: "2K" });
  });
});
