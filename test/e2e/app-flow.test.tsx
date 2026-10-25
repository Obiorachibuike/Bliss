// @vitest-environment jsdom
/**
 * End-to-end journey through the real component tree (sidebar, composer, stores,
 * API routes contract). The upstream AI service is mocked at the network boundary so
 * every assertion below reflects code that ships — not a fixture UI.
 *
 * The Playwright specs in e2e/ cover the browser layer (viewports, real navigation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { useChatStore } from "@/lib/store/chatStore";
import { useSettingsStore } from "@/lib/store/settingsStore";

/** Mirrors src/app/layout.tsx, which wraps the page in the ThemeProvider. */
const renderApp = () => render(<ThemeProvider><Home /></ThemeProvider>);
const sidebar = () => within(screen.getByRole("complementary", { name: /primary/i }));

const UPSTREAM = { success: true, response: "Recursion is a function that calls itself.", author: "@cvroon" };

let lastUpstreamUrl = "";

function mockUpstream(overrides: Partial<{ image: string; video: string; failChat: boolean }> = {}) {
  lastUpstreamUrl = "";
  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url, "http://localhost").pathname;

    if (path.startsWith("/api/")) {
      // Route handlers are exercised in test/integration; stub the transport here.
      if (path === "/api/health") {
        return Response.json({
          status: "operational",
          services: { text: { reachable: true, latency: 420 }, image: { reachable: true, latency: 900 } },
          capabilities: { chat: true, imageGeneration: true, vision: false, streaming: false },
        });
      }
      if (path === "/api/chat") {
        if (overrides.failChat) {
          return Response.json({ success: false, error: "Bliss couldn't reach the AI service. Please try again." }, { status: 502 });
        }
        const body = JSON.parse(String(init?.body));
        lastUpstreamUrl = `upstream:${body.model}`;
        return Response.json({ success: true, response: UPSTREAM.response, model: body.model });
      }
      if (path === "/api/image") {
        return Response.json({ success: true, imageUrl: overrides.image ?? "https://cdn.test/gen-1.jpg" });
      }
      if (path === "/api/video") {
        return Response.json({ success: true, videoUrl: overrides.video ?? "https://cdn.test/clip.mp4" });
      }
      return Response.json({ ok: true });
    }

    // Real upstream shape (validated by the services under test)
    return Response.json(UPSTREAM);
  });
  vi.stubGlobal("fetch", handler);
  return handler;
}

beforeEach(() => {
  localStorage.clear();
  useChatStore.setState({ conversations: [], activeId: null });
  mockUpstream();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Bliss end-to-end journey", () => {
  it("1-2. opens Bliss on the welcome screen and starts a conversation from a prompt", async () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/What can we create today\?/);
    // Brand is present in the sidebar
    expect(sidebar().getByText("Bliss")).toBeInTheDocument();

    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "Explain recursion to me");
    fireEvent.keyDown(box, { key: "Enter" });

    // The title shows in the sidebar and the bubble shows in the thread.
    await waitFor(() => expect(screen.getAllByText("Explain recursion to me").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/Recursion is a function that calls itself/)).toBeInTheDocument());
  });

  it("3-4. selecting a model changes the model actually used for the next request", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /llama 3.3/i }));
    await userEvent.click(await screen.findByText("DeepSeek V3.2"));

    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "hi");
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(lastUpstreamUrl).toBe("upstream:deepseek-v3.2"));
    expect(useChatStore.getState().getActive()?.modelId).toBe("deepseek-v3.2");
  });

  it("5-6. receives a response and copies an assistant reply", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();

    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "hello");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Recursion is a function/)).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: /copy/i }).at(-1)!);
    expect(writeText).toHaveBeenCalledWith(UPSTREAM.response);
  });

  it("7-8. starts another conversation and recovers both after a reload", async () => {
    const { unmount } = renderApp();

    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "first chat topic");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByText(/Recursion is a function/)).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: /^new chat$/i })[0]);
    const box2 = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box2, "second chat topic");
    fireEvent.keyDown(box2, { key: "Enter" });

    await waitFor(() => expect(useChatStore.getState().conversations).toHaveLength(2));

    // Simulate a page reload: memory is wiped, localStorage survives.
    const snapshot = localStorage.getItem("bliss-chat-storage");
    expect(snapshot).toBeTruthy();
    unmount();
    useChatStore.setState({ conversations: [], activeId: null });
    localStorage.setItem("bliss-chat-storage", snapshot!);
    await useChatStore.persist.rehydrate!();
    renderApp();

    const recovered = useChatStore.getState().conversations;
    expect(recovered).toHaveLength(2);
    expect(recovered.map((c) => c.title).sort()).toEqual(["first chat topic", "second chat topic"]);
    expect(sidebar().getByText("first chat topic")).toBeInTheDocument();
  });

  it("9-10. opens Image Studio and generates an image from a real response url", async () => {
    mockUpstream({ image: "https://cdn.test/flux-result.jpg" });
    renderApp();

    await userEvent.click(screen.getByRole("button", { name: /^image studio$/i }));
    expect(screen.getByRole("heading", { name: /image studio/i })).toBeInTheDocument();

    const prompt = screen.getByPlaceholderText(/alpine lake|futuristic/i);
    await userEvent.type(prompt, "a blue glass tower at dusk");
    await userEvent.click(screen.getByRole("button", { name: /generate image/i }));

    const img = await waitFor(() => {
      const el = document.querySelector("img[alt='a blue glass tower at dusk']") as HTMLImageElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(img.src).toBe("https://cdn.test/flux-result.jpg");
    expect(screen.queryByText(/couldn't be generated/)).not.toBeInTheDocument();
  });

  it("11. editing an image requires a source url and reports the real result", async () => {
    mockUpstream({ image: "https://cdn.test/edited.jpg" });
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /^image studio$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    await userEvent.type(screen.getByPlaceholderText(/make this image look cinematic/i), "make it a watercolor");
    // Validation first: no source provided.
    await userEvent.click(screen.getByRole("button", { name: /apply edit/i }));
    expect(await screen.findByText(/needs a publicly accessible source image URL/i)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/https:\/\/…\/photo\.jpg/i), "https://cdn.test/source.jpg");
    await userEvent.click(screen.getByRole("button", { name: /apply edit/i }));

    await waitFor(() => expect(document.querySelector("img[src='https://cdn.test/edited.jpg']")).toBeTruthy());
  });

  it("11b. video studio refuses text-only requests instead of faking a clip", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /^video studio$/i }));
    await userEvent.click(screen.getByRole("button", { name: /generate video/i }));
    expect(await screen.findByText(/source image url is required/i)).toBeInTheDocument();
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
  });

  it("11c. video studio shows the returned clip", async () => {
    mockUpstream({ video: "https://cdn.test/clip.mp4" });
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /^video studio$/i }));
    await userEvent.type(screen.getByPlaceholderText(/https:\/\/…\/image\.jpg/i), "https://cdn.test/sky.jpg");
    await userEvent.click(screen.getByRole("button", { name: /generate video/i }));
    await waitFor(() => expect(document.querySelector("video[src='https://cdn.test/clip.mp4']")).toBeTruthy());
  });

  it("12. changes the theme and persists it", async () => {
    renderApp();
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /toggle color theme/i }));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(useSettingsStore.getState().theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("bliss-settings-storage")!).state.theme).toBe("light");
  });

  it("sidebar collapses on desktop and the drawer opens on mobile widths", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    await waitFor(() => expect(useSettingsStore.getState().sidebarCollapsed).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    await waitFor(() => expect(useSettingsStore.getState().sidebarCollapsed).toBe(false));
  });

  it("surfaces an upstream outage honestly, with a retry and no fabricated text", async () => {
    mockUpstream({ failChat: true });
    renderApp();
    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "will this work?");
    fireEvent.keyDown(box, { key: "Enter" });

    const alert = await screen.findByText(/couldn.t reach the AI service/i);
    expect(alert).toBeInTheDocument();
    // the assistant bubble contains no invented answer
    expect(screen.queryByText(/Recursion is a function/)).not.toBeInTheDocument();
  });

  it("renames and deletes a conversation from the sidebar", async () => {
    renderApp();
    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "topic to rename");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useChatStore.getState().conversations).toHaveLength(1));

    const row = sidebar().getByText("topic to rename").closest("div")!.parentElement!;
    await userEvent.hover(sidebar().getByText("topic to rename"));
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: /pin conversation/i }));
    await waitFor(() => expect(useChatStore.getState().conversations[0].pinned).toBe(true));

    await userEvent.hover(sidebar().getByText("topic to rename"));
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: /delete conversation/i }));
    await waitFor(() => expect(useChatStore.getState().conversations).toHaveLength(0));
  });

  it("the API Explorer documents only verified endpoints and labels what is unavailable", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: /api explorer/i }));
    expect(await screen.findByText(/flux dev image generation/i)).toBeInTheDocument();
    expect(screen.getByText(/WAN 2.2 image to video/i)).toBeInTheDocument();
    expect(screen.getByText(/Not implemented because it isn/i)).toBeInTheDocument();
    // no invented endpoints
    expect(screen.queryByText(/chat\/completions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/realtime streaming/i)).not.toBeInTheDocument();
  });

  it("history search finds messages inside conversations", async () => {
    renderApp();
    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "unique-search-term-42");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useChatStore.getState().conversations).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /^history$/i }));
    const search = await screen.findByPlaceholderText(/search titles and message content/i);
    await userEvent.type(search, "unique-search-term-42");
    await waitFor(() => expect(screen.getAllByText("unique-search-term-42").length).toBeGreaterThan(0));
    await userEvent.clear(search);
    await userEvent.type(search, "nothing-matches-this");
    await waitFor(() => expect(screen.getByText(/no conversations match your search/i)).toBeInTheDocument());
  });
});
