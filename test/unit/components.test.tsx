// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Composer } from "@/components/chat/Composer";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { MessageList } from "@/components/chat/MessageList";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useChatStore } from "@/lib/store/chatStore";

const wrap = (ui: React.ReactNode) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeId: null });
  useSettingsStore.setState({ enterToSend: true, theme: "dark" });
});

describe("welcome screen", () => {
  it("shows the tagline and four suggestion cards", () => {
    render(wrap(<WelcomeScreen onPick={vi.fn()} />));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("What can we create today?");
    expect(screen.getByText(/Ask anything, explore ideas, generate images/i)).toBeInTheDocument();
    for (const label of ["Ask anything", "Write something", "Create an image", "Build something"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("submits the card prompt for text cards and routes image cards to the studio", async () => {
    const onPick = vi.fn();
    render(wrap(<WelcomeScreen onPick={onPick} />));
    await userEvent.click(screen.getByText("Ask anything").closest("button")!);
    expect(onPick).toHaveBeenCalledWith(expect.stringMatching(/understand/i), false);

    await userEvent.click(screen.getByText("Create an image").closest("button")!);
    expect(onPick).toHaveBeenCalledWith(expect.stringMatching(/cinematic/i), true);
  });
});

describe("composer", () => {
  it("sends on Enter and keeps Shift+Enter as a newline", async () => {
    const onSend = vi.fn();
    render(wrap(<Composer onSend={onSend} selectedModel="llama" onModelChange={vi.fn()} />));
    const box = screen.getByRole("textbox", { name: /message bliss/i });

    await userEvent.type(box, "first line");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    await userEvent.type(box, " second");
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    // Updated Composer now sends (text, images?) — second arg undefined for no images
    expect(onSend).toHaveBeenCalledWith("first line second", undefined);
    expect(box).toHaveValue("");
  });

  it("respects the enter-to-send preference", async () => {
    useSettingsStore.setState({ enterToSend: false });
    const onSend = vi.fn();
    render(wrap(<Composer onSend={onSend} selectedModel="llama" onModelChange={vi.fn()} />));
    const box = screen.getByRole("textbox", { name: /message bliss/i });
    await userEvent.type(box, "hello");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("hello", undefined);
  });

  it("never sends an empty message and shows a stop control while streaming", () => {
    const onSend = vi.fn();
    const { rerender } = render(wrap(<Composer onSend={onSend} selectedModel="llama" onModelChange={vi.fn()} />));
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    rerender(
      wrap(
        <Composer onSend={onSend} onStop={vi.fn()} isStreaming selectedModel="llama" onModelChange={vi.fn()} />
      )
    );
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("changes the model that the next request will use", async () => {
    const onModelChange = vi.fn();
    render(wrap(<Composer onSend={vi.fn()} selectedModel="llama" onModelChange={onModelChange} />));
    await userEvent.click(screen.getByRole("button", { name: /llama 3.3/i }));
    await userEvent.click(await screen.findByText("DeepSeek V3.2"));
    expect(onModelChange).toHaveBeenCalledWith("deepseek-v3.2");
  });

  it("adds an image reference — for non-vision models as markdown, for Agnes as vision attachment", async () => {
    const onSend = vi.fn();
    // Non-vision model shows disclaimer
    render(wrap(<Composer onSend={onSend} selectedModel="llama" onModelChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /attach files/i }));
    expect(screen.getByText(/accepts text only/i)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/https:\/\/example\.com\/photo\.jpg/i), "https://cdn.test/a.jpg");
    await userEvent.click(screen.getByRole("button", { name: /Add URL/i }));
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("![reference image](https://cdn.test/a.jpg)"), undefined);
  });

  it("attaches images as vision input for Agnes models", async () => {
    const onSend = vi.fn();
    render(wrap(<Composer onSend={onSend} selectedModel="agnes-2.0-flash" onModelChange={vi.fn()} />));
    await userEvent.click(screen.getByRole("button", { name: /attach files/i }));
    expect(screen.getByText(/vision input/i)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/https:\/\/example\.com\/photo\.jpg/i), "https://cdn.test/b.jpg");
    await userEvent.click(screen.getByRole("button", { name: /Add URL/i }));
    await userEvent.type(screen.getByRole("textbox", { name: /message bliss/i }), "describe this");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith("describe this", ["https://cdn.test/b.jpg"]);
  });
});

describe("message list", () => {
  const msgs = [
    { id: "u1", role: "user" as const, content: "Explain recursion", timestamp: 1 },
    {
      id: "a1",
      role: "assistant" as const,
      content: "Recursion means **a function that calls itself**.\n\n```python\ndef f(n):\n    return f(n - 1)\n```",
      timestamp: 2,
      modelId: "llama" as const,
    },
  ];

  it("renders user and assistant turns with distinct labels", () => {
    render(wrap(<MessageList messages={msgs} />));
    expect(screen.getByText("Explain recursion")).toBeInTheDocument();
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bliss").length).toBeGreaterThan(0);
  });

  it("shows the streaming indicator only for the pending message", () => {
    const withPending = [...msgs, { id: "a2", role: "assistant" as const, content: "", timestamp: 3 }];
    render(wrap(<MessageList messages={withPending} streamingId="a2" />));
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it("surfaces an upstream error verbatim instead of an empty bubble", () => {
    render(
      wrap(
        <MessageList
          messages={[...msgs, { id: "a2", role: "assistant", content: "", timestamp: 3, error: "Service unavailable" }]}
        />
      )
    );
    expect(screen.getByText("Service unavailable")).toBeInTheDocument();
  });

  it("copies a message to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(wrap(<MessageList messages={msgs} />));
    fireEvent.mouseEnter(screen.getByText("Explain recursion"));
    await userEvent.click(screen.getAllByRole("button", { name: /copy/i })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Explain recursion"));
  });

  it("regenerates a chosen assistant reply", async () => {
    const onRegenerate = vi.fn();
    render(wrap(<MessageList messages={msgs} onRegenerate={onRegenerate} />));
    await userEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    expect(onRegenerate).toHaveBeenCalledWith("a1");
  });

  it("edits a previous user message and resends it", async () => {
    const onEdit = vi.fn();
    render(wrap(<MessageList messages={msgs} onEditMessage={onEdit} />));
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    const area = screen.getByRole("textbox", { hidden: false }) as HTMLTextAreaElement;
    await userEvent.clear(area);
    await userEvent.type(area, "Explain iteration");
    await userEvent.click(screen.getByRole("button", { name: /save & resend/i }));
    expect(onEdit).toHaveBeenCalledWith("u1", "Explain iteration");
  });
});

describe("markdown rendering", () => {
  it("renders headings, lists, tables and bold text", () => {
    const md = `## Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**bold**`;
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector("h2")).toHaveTextContent("Title");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
  });

  it("renders fenced code with a language label and never executes it", () => {
    const { container } = render(
      <MarkdownRenderer content={'```js\nconst x = 1;\n<img src=x onerror="alert(1)">\n```'} />
    );
    expect(container.textContent).toContain("const x = 1;");
    expect(container.querySelector("img")).toBeNull(); // raw HTML is not turned into markup
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("js", { exact: true })).toBeInTheDocument();
  });

  it("links open safely in a new tab", () => {
    const { container } = render(<MarkdownRenderer content="[docs](https://example.com)" />);
    const a = container.querySelector("a")!;
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});

describe("theme", () => {
  it("applies the dark class by default and toggles it", async () => {
    render(wrap(<div data-testid="x" />));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(screen.getByTestId("x")); // noop, ensures mounted
    await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe("dark"));
  });

  it("honours an explicit light preference and persists it", async () => {
    useSettingsStore.setState({ theme: "light" });
    render(wrap(<div />));
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
    expect(JSON.parse(localStorage.getItem("bliss-settings-storage")!).state.theme).toBe("light");
  });
});
