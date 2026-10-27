import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore, buildPromptWithHistory, uid } from "@/lib/store/chatStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { useSavedStore } from "@/lib/store/savedStore";
import type { ChatMessage } from "@/lib/types";

beforeEach(() => {
  // Reset every store between tests so ordering never matters.
  useChatStore.setState({ conversations: [], activeId: null, streaming: false, error: null });
  useSavedStore.setState({ items: [], images: [], videos: [] });
  useSettingsStore.setState({ theme: "dark", defaultModel: "agnes-2.0-flash", enterToSend: true });
});

describe("conversation lifecycle", () => {
  it("creates a conversation, makes it active and titles it from the first prompt", () => {
    const id = useChatStore.getState().createConversation("llama", "Help me debug my python script");
    const state = useChatStore.getState();
    expect(state.activeId).toBe(id);
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0].title).toBe("Help me debug my python script");
    expect(state.conversations[0].modelId).toBe("llama");
  });

  it("starts an untitled conversation as 'New conversation'", () => {
    const id = useChatStore.getState().createConversation("llama");
    expect(useChatStore.getState().conversations.find((c) => c.id === id)?.title).toBe("New conversation");
  });

  it("retitles on the first user message only", () => {
    const id = useChatStore.getState().createConversation("llama");
    const msg = (role: string, content: string): ChatMessage => ({ id: uid(), role: role as never, content, timestamp: Date.now() });
    useChatStore.getState().addMessage(id, msg("user", "second prompt"));
    expect(useChatStore.getState().getActive()?.title).toBe("second prompt");
    useChatStore.getState().addMessage(id, msg("user", "third prompt"));
    expect(useChatStore.getState().getActive()?.title).toBe("second prompt");
  });

  it("keeps per-conversation model selection", () => {
    const a = useChatStore.getState().createConversation("llama");
    const b = useChatStore.getState().createConversation("deepseek-v3.2");
    useChatStore.getState().setConversationModel(a, "gpt-5-nano");
    const convs = useChatStore.getState().conversations;
    expect(convs.find((c) => c.id === a)?.modelId).toBe("gpt-5-nano");
    expect(convs.find((c) => c.id === b)?.modelId).toBe("deepseek-v3.2");
  });

  it("renames, pins and deletes", () => {
    const id = useChatStore.getState().createConversation("llama", "orig");
    useChatStore.getState().renameConversation(id, "renamed");
    expect(useChatStore.getState().getActive()?.title).toBe("renamed");

    useChatStore.getState().togglePin(id);
    expect(useChatStore.getState().getActive()?.pinned).toBe(true);

    useChatStore.getState().deleteConversation(id);
    expect(useChatStore.getState().conversations).toHaveLength(0);
    expect(useChatStore.getState().activeId).toBeNull();
  });

  it("switches active conversation when the deleted one was open", () => {
    const a = useChatStore.getState().createConversation("llama", "A");
    const b = useChatStore.getState().createConversation("llama", "B");
    useChatStore.getState().setActive(b);
    useChatStore.getState().deleteConversation(b);
    expect(useChatStore.getState().activeId).toBe(a);
  });

  it("updates a single message without disturbing its siblings", () => {
    const id = useChatStore.getState().createConversation("llama");
    useChatStore.getState().addMessage(id, { id: "m1", role: "user", content: "one", timestamp: 1 });
    useChatStore.getState().addMessage(id, { id: "m2", role: "assistant", content: "", timestamp: 2 });
    useChatStore.getState().updateMessage(id, "m2", { content: "answer", modelId: "llama" });
    const msgs = useChatStore.getState().getActive()!.messages;
    expect(msgs[0].content).toBe("one");
    expect(msgs[1].content).toBe("answer");
    expect(msgs[1].modelId).toBe("llama");
  });

  it("records an error on a message so the UI can show it inline", () => {
    const id = useChatStore.getState().createConversation("llama");
    useChatStore.getState().addMessage(id, { id: "m1", role: "assistant", content: "", timestamp: 1 });
    useChatStore.getState().updateMessage(id, "m1", { error: "Bliss couldn't reach the AI service." });
    expect(useChatStore.getState().getActive()!.messages[0].error).toMatch(/couldn't reach/);
  });

  it("truncateAfter drops later turns so an edit can fork the thread", () => {
    const id = useChatStore.getState().createConversation("llama");
    for (const [i, r] of ["user", "assistant", "user", "assistant"].entries()) {
      useChatStore.getState().addMessage(id, { id: `x${i}`, role: r as never, content: `${r}${i}`, timestamp: i });
    }
    useChatStore.getState().truncateAfter(id, "x1");
    expect(useChatStore.getState().getActive()!.messages.map((m) => m.id)).toEqual(["x0", "x1"]);
  });
});

describe("history search", () => {
  it("matches titles and message bodies, and tolerates an empty query", () => {
    const a = useChatStore.getState().createConversation("llama", "Recipe for pancakes");
    useChatStore.getState().createConversation("llama", "Quantum physics");
    useChatStore.getState().addMessage(a, {
      id: "m",
      role: "assistant",
      content: "Flip when bubbles form.",
      timestamp: 1,
    });

    expect(useChatStore.getState().search("pancake").map((c) => c.title)).toEqual(["Recipe for pancakes"]);
    expect(useChatStore.getState().search("bubbles").map((c) => c.title)).toEqual(["Recipe for pancakes"]);
    expect(useChatStore.getState().search("QUANTUM")).toHaveLength(1);
    expect(useChatStore.getState().search("")).toHaveLength(2);
    expect(useChatStore.getState().search("nope")).toHaveLength(0);
  });
});

describe("local persistence", () => {
  it("writes conversations to localStorage so a reload recovers them", () => {
    const id = useChatStore.getState().createConversation("llama", "persist me");
    useChatStore.getState().addMessage(id, { id: "m", role: "user", content: "persist me", timestamp: 1 });
    const raw = localStorage.getItem("bliss-chat-storage");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: { conversations: unknown[]; activeId: string } };
    expect(parsed.state.conversations).toHaveLength(1);
    expect((parsed.state.conversations as { title: string }[])[0].title).toBe("persist me");
    expect(parsed.state.activeId).toBe(id);
  });

  it("does not persist transient streaming state", () => {
    useChatStore.getState().createConversation("llama", "x");
    useChatStore.getState().setStreaming(true);
    useChatStore.getState().setError("boom");
    const parsed = JSON.parse(localStorage.getItem("bliss-chat-storage")!) as { state: Record<string, unknown> };
    expect(parsed.state.streaming).toBeUndefined();
    expect(parsed.state.error).toBeUndefined();
  });

  it("persists the theme and default model separately", () => {
    useSettingsStore.getState().setTheme("light");
    useSettingsStore.getState().setDefaultModel("deepseek-v3.2");
    const parsed = JSON.parse(localStorage.getItem("bliss-settings-storage")!) as {
      state: { theme: string; defaultModel: string };
    };
    expect(parsed.state.theme).toBe("light");
    expect(parsed.state.defaultModel).toBe("deepseek-v3.2");
  });

  it("clearing history removes every trace from storage", () => {
    useChatStore.getState().createConversation("llama", "bye");
    useChatStore.getState().clearAll();
    const parsed = JSON.parse(localStorage.getItem("bliss-chat-storage")!) as { state: { conversations: unknown[] } };
    expect(parsed.state.conversations).toHaveLength(0);
  });
});

describe("saved library", () => {
  it("stores responses, images and videos independently", () => {
    useSavedStore.getState().addItem({ id: "1", type: "response", title: "t", content: "c", createdAt: 1 });
    useSavedStore.getState().addImage({ id: "i1", prompt: "p", imageUrl: "https://x/y.jpg", modelId: "flux-dev", createdAt: 1 });
    useSavedStore.getState().addVideo({ id: "v1", prompt: "p", imageUrl: "https://x/y.jpg", videoUrl: "https://x/z.mp4", createdAt: 1 });

    let s = useSavedStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.images).toHaveLength(1);
    expect(s.videos).toHaveLength(1);

    s.removeItem("1");
    s.removeImage("i1");
    s = useSavedStore.getState();
    expect(s.items).toHaveLength(0);
    expect(s.images).toHaveLength(0);
    expect(s.videos).toHaveLength(1);

    useSavedStore.getState().clearAll();
    expect(useSavedStore.getState().videos).toHaveLength(0);
  });

  it("keeps newest items first", () => {
    useSavedStore.getState().addItem({ id: "a", type: "code", title: "first", content: "", createdAt: 1 });
    useSavedStore.getState().addItem({ id: "b", type: "code", title: "second", content: "", createdAt: 2 });
    expect(useSavedStore.getState().items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("context adapter", () => {
  const m = (role: "user" | "assistant", content: string): ChatMessage => ({
    id: uid(),
    role,
    content,
    timestamp: 1,
  });

  it("returns the raw prompt with no history", () => {
    expect(buildPromptWithHistory([], "hello")).toBe("hello");
  });

  it("labels turns and appends the new prompt last", () => {
    const out = buildPromptWithHistory([m("user", "a"), m("assistant", "b")], "c");
    expect(out).toContain("User: a");
    expect(out).toContain("Assistant: b");
    expect(out.trim().endsWith("Assistant:")).toBe(true);
    expect(out.indexOf("User: c")).toBeGreaterThan(out.indexOf("Assistant: b"));
  });

  it("caps context at the last six messages", () => {
    const many = Array.from({ length: 12 }, (_, i) => m(i % 2 ? "assistant" : "user", `msg${i}`));
    const out = buildPromptWithHistory(many, "new");
    expect(out).not.toContain("msg0");
    expect(out).toContain("msg6");
    expect(out).toContain("msg11");
  });
});
