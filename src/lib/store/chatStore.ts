"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Conversation, ChatMessage, ModelId } from "@/lib/types";
import { generateTitle } from "@/lib/utils/title";

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  streaming: boolean;
  error: string | null;

  // actions
  createConversation: (modelId: ModelId, firstPrompt?: string) => string;
  setActive: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  addMessage: (convId: string, msg: ChatMessage) => void;
  updateMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (convId: string, msgId: string) => void;
  truncateAfter: (convId: string, msgId: string) => void;
  setConversationModel: (convId: string, modelId: ModelId) => void;
  clearAll: () => void;
  setStreaming: (v: boolean) => void;
  setError: (e: string | null) => void;
  getActive: () => Conversation | undefined;
  search: (q: string) => Conversation[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      streaming: false,
      error: null,

      createConversation: (modelId, firstPrompt) => {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const conv: Conversation = {
          id,
          title: firstPrompt ? generateTitle(firstPrompt) : "New conversation",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          modelId,
          messages: [],
          pinned: false,
        };
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeId: id,
          error: null,
        }));
        return id;
      },

      setActive: (id) => set({ activeId: id, error: null }),

      deleteConversation: (id) =>
        set((s) => {
          const filtered = s.conversations.filter((c) => c.id !== id);
          let nextActive = s.activeId;
          if (s.activeId === id) {
            nextActive = filtered[0]?.id ?? null;
          }
          return { conversations: filtered, activeId: nextActive };
        }),

      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title } : c
          ),
        })),

      togglePin: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c
          ),
        })),

      addMessage: (convId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: [...c.messages, msg],
                  updatedAt: Date.now(),
                  title:
                    c.messages.length === 0 && msg.role === "user"
                      ? generateTitle(msg.content)
                      : c.title,
                }
              : c
          ),
        })),

      updateMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId ? { ...m, ...patch } : m
                  ),
                }
              : c
          ),
        })),

      removeMessage: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) } : c
          ),
        })),

      truncateAfter: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c;
            const idx = c.messages.findIndex((m) => m.id === msgId);
            return idx === -1 ? c : { ...c, messages: c.messages.slice(0, idx + 1) };
          }),
        })),

      setConversationModel: (convId, modelId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === convId ? { ...c, modelId } : c)),
        })),

      clearAll: () => set({ conversations: [], activeId: null }),
      setStreaming: (v) => set({ streaming: v }),
      setError: (e) => set({ error: e }),
      getActive: () => {
        const { conversations, activeId } = get();
        return conversations.find((c) => c.id === activeId);
      },
      search: (q) => {
        const { conversations } = get();
        if (!q.trim()) return conversations;
        const lower = q.toLowerCase();
        return conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(lower) ||
            c.messages.some((m) => m.content.toLowerCase().includes(lower))
        );
      },
    }),
    {
      name: "bliss-chat-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
      }),
    }
  )
);

// helper to construct prompt with history when endpoint lacks context
export function buildPromptWithHistory(messages: ChatMessage[], newPrompt: string): string {
  // Simple adapter: prepend last 6 messages as context
  if (messages.length === 0) return newPrompt;
  const recent = messages.slice(-6);
  const context = recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  return `${context}\n\nUser: ${newPrompt}\nAssistant:`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 6);
}
