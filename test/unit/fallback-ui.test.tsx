// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { MessageList } from "@/components/chat/MessageList";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { Composer } from "@/components/chat/Composer";
import { ImageStudio } from "@/components/image/ImageStudio";
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

function stubCatalog({ enabled }: { enabled: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/models") {
        return Response.json({
          success: true,
          text: TEXT_MODELS,
          image: IMAGE_MODELS,
          fallback: {
            enabled,
            provider: "Agnes AI",
            vision: enabled,
            nativeConversationContext: enabled,
            chatModels: enabled ? ["agnes-2.5-flash"] : [],
            imageModel: enabled ? "agnes-image-2.1-flash" : null,
            docs: "https://www.agnes-ai.com/en/docs",
          },
        });
      }
      return Response.json({ ok: true });
    })
  );
  // fresh module-level catalogue store for this test
  __resetCatalogForTests();
  return calls;
}

const wrap = (ui: React.ReactNode) => <ThemeProvider>{ui}</ThemeProvider>;
/** Only true leaf matches — avoids "found multiple" from ancestor elements. */
const textIn = (needle: RegExp) => (_: string, el: Element | null) =>
  !!el && needle.test((el.textContent ?? "").trim()) && ![...el.children].some((c) => needle.test((c.textContent ?? "").trim()));

beforeEach(() => {
  vi.unstubAllGlobals();
  __resetCatalogForTests();
  localStorage.clear();
});

describe("message list fallback attribution", () => {
  const base: ChatMessage = { id: "a1", role: "assistant", content: "Here you go.", timestamp: 2, modelId: "llama" };

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
    await waitFor(() => expect(screen.getByText(textIn(/fallback provider active/i))).toBeInTheDocument());
    expect(screen.getByText("fallback")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Agnes 2.5 Flash"));
    expect(onChange).toHaveBeenCalledWith("agnes-2.5-flash");
  });

  it("still lists the agnes model when no key is set, and says what it needs", async () => {
    stubCatalog({ enabled: false });
    render(wrap(<ModelSelector value="llama" onChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /llama 3.3/i }));
    expect(await screen.findByText("Agnes 2.5 Flash")).toBeInTheDocument();
    expect(screen.getByText(textIn(/Set AGNES_API_KEY to unlock/i))).toBeInTheDocument();
    expect(screen.getByText(textIn(/no API key needed/i))).toBeInTheDocument();
  });
});

describe("composer attachment affordance", () => {
  it("promises image analysis only when the fallback provides it", async () => {
    stubCatalog({ enabled: true });
    render(wrap(<Composer onSend={vi.fn()} selectedModel="llama" onModelChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /attach an image reference/i }));
    expect(await screen.findByText(/attach an image for analysis/i)).toBeInTheDocument();
    expect(screen.getByText(textIn(/real image_url part/i))).toBeInTheDocument();
  });

  it("states the limitation plainly when there is no vision", async () => {
    stubCatalog({ enabled: false });
    render(wrap(<Composer onSend={vi.fn()} selectedModel="llama" onModelChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /attach an image reference/i }));
    expect(await screen.findByText(/accept text only/i)).toBeInTheDocument();
  });
});

describe("image studio model chooser", () => {
  it("offers both image models and marks the key requirement", async () => {
    stubCatalog({ enabled: false });
    render(wrap(<ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />));
    expect(await screen.findByText("Flux Dev")).toBeInTheDocument();
    expect(screen.getByText("Agnes Image 2.1 Flash")).toBeInTheDocument();
    expect(screen.getByText("needs AGNES_API_KEY")).toBeInTheDocument();
  });

  it("labels the agnes model as the fallback provider once it is configured", async () => {
    stubCatalog({ enabled: true });
    render(wrap(<ImageStudio onOpenMobileNav={vi.fn()} initialPrompt="a blue planet" />));
    expect(await screen.findByText("fallback provider")).toBeInTheDocument();
    expect(screen.queryByText("needs AGNES_API_KEY")).not.toBeInTheDocument();
  });
});
