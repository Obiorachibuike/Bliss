"use client";
import { useCallback, useRef, useState } from "react";
import { Menu, Plus, PanelRightOpen, PanelRightClose, WifiOff, X, RefreshCw } from "lucide-react";
import { useChatStore, uid } from "@/lib/store/chatStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { ContextPanel } from "./ContextPanel";
import type { ChatMessage, ModelId } from "@/lib/types";
import { MODELS } from "@/lib/api/config";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { isAgnesChatModel } from "@/lib/api/config";

export function ChatWorkspace({
  onOpenMobileNav,
  onGoToImageStudio,
}: {
  onOpenMobileNav: () => void;
  onGoToImageStudio: (prompt: string) => void;
}) {
  const active = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId));
  const createConversation = useChatStore((s) => s.createConversation);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const truncateAfter = useChatStore((s) => s.truncateAfter);
  const setConversationModel = useChatStore((s) => s.setConversationModel);

  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const showPanel = useSettingsStore((s) => s.showContextPanel);
  const setContextPanel = useSettingsStore((s) => s.setContextPanel);

  const model: ModelId = active?.modelId ?? defaultModel;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [serviceWarning, setServiceWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const requestAssistant = useCallback(
    async (convId: string, prompt: string, history: { role: string; content: string; images?: string[] }[], modelId: ModelId, images?: string[]) => {
      const asstId = uid();
      addMessage(convId, { id: asstId, role: "assistant", content: "", timestamp: Date.now(), modelId });
      setPendingId(asstId);
      setServiceWarning(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const isAgnes = isAgnesChatModel(modelId);

      try {
        const payload: Record<string, unknown> = { model: modelId, prompt, history };
        if (images && images.length) payload.images = images;
        // Also include aggregated images from history for vision context (already in history)
        if (isAgnes) payload.stream = true;

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: isAgnes ? "text/event-stream" : "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (res.status === 499) {
          removeMessage(convId, asstId);
          toast.info("Generation stopped");
          return;
        }

        // Streaming path for Agnes
        const contentType = res.headers.get("content-type") || "";
        if (isAgnes && contentType.includes("text/event-stream") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let full = "";
          let gotToken = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              if (trimmed === "data: [DONE]") {
                // done
                continue;
              }
              if (trimmed.startsWith("data: ")) {
                const data = trimmed.slice(6);
                if (data === "[DONE]") continue;
                try {
                  const obj = JSON.parse(data);
                  const token = obj.token ?? obj.content ?? obj.text ?? "";
                  if (token) {
                    full += token;
                    gotToken = true;
                    updateMessage(convId, asstId, { content: full, modelId });
                  } else if (obj.error) {
                    throw new Error(obj.error);
                  }
                } catch {
                  // If not JSON, treat as raw token
                  if (data && !data.includes('"')) {
                    full += data;
                    updateMessage(convId, asstId, { content: full, modelId });
                    gotToken = true;
                  }
                }
              }
            }
          }
          // Handle leftover buffer
          if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
            try {
              const obj = JSON.parse(buffer.trim().slice(6));
              const token = obj.token;
              if (token) {
                full += token;
                updateMessage(convId, asstId, { content: full, modelId });
                gotToken = true;
              }
            } catch {}
          }

          if (!gotToken && full.trim().length === 0) {
            // Fallback: try to parse as JSON if streaming produced nothing but server returned JSON inside stream
            // Check if we actually got an error payload
            if (!res.ok) {
              const errText = await res.text().catch(() => "");
              let j: unknown = null;
              try { j = JSON.parse(errText); } catch {}
              const msg = (j as Record<string, unknown>)?.error as string || errText || "Generation failed";
              updateMessage(convId, asstId, { error: String(msg) });
              setServiceWarning(String(msg));
              return;
            }
            // No tokens but still empty — mark as error
            updateMessage(convId, asstId, { error: "No response received. Try again." });
            setServiceWarning("No response received.");
          }
          // Ensure final content is trimmed and scaffold stripped
          if (full.trim()) {
            const clean = full.replace(/^\s*Assistant:\s*/i, "").replace(/^\s*Bliss:\s*/i, "").trim();
            updateMessage(convId, asstId, { content: clean, modelId });
          }
          return;
        }

        // Non-stream JSON fallback
        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.success || typeof data.response !== "string" || !data.response.trim()) {
          const msg =
            data?.error ??
            (res.status === 429
              ? "You're sending messages quickly. Please wait a moment and try again."
              : "Bliss couldn't reach the AI service. Please try again.");
          updateMessage(convId, asstId, { error: msg });
          setServiceWarning(msg);
          return;
        }

        updateMessage(convId, asstId, { content: data.response.trim(), modelId: data.model ?? modelId });
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          removeMessage(convId, asstId);
          toast.info("Generation stopped");
          return;
        }
        const msg = e instanceof Error ? e.message : "Bliss couldn't reach the AI service. Please try again.";
        // Avoid overwriting if already has content from streaming
        const existing = useChatStore.getState().conversations.find((c) => c.id === convId)?.messages.find((m) => m.id === asstId);
        if (existing?.content && existing.content.trim().length > 0) {
          // Keep partial response, just stop streaming marker
        } else {
          updateMessage(convId, asstId, { error: msg });
          setServiceWarning(msg);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setPendingId(null);
      }
    },
    [addMessage, updateMessage, removeMessage]
  );

  const sendMessage = useCallback(
    async (text: string, images?: string[]) => {
      let convId = active?.id;
      if (!convId) convId = createConversation(model, text);

      const prior = useChatStore.getState().conversations.find((c) => c.id === convId);
      const history = (prior?.messages ?? [])
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content, images: (m as unknown as { images?: string[] }).images }));

      // Store tiny thumbnails only for persistence (downscale to avoid localStorage bloat)
      // For now store original but we could thumbnail in future
      const thumbnails = images;

      addMessage(convId, { id: uid(), role: "user", content: text, timestamp: Date.now(), images: thumbnails } as ChatMessage);
      await requestAssistant(convId, text, history, model, images);
    },
    [active?.id, createConversation, addMessage, model, requestAssistant]
  );

  const regenerate = useCallback(
    async (asstMsgId: string) => {
      if (!active) return;
      const idx = active.messages.findIndex((m) => m.id === asstMsgId);
      const userMsg = [...active.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!userMsg) return;
      removeMessage(active.id, asstMsgId);
      const history = active.messages
        .slice(0, active.messages.findIndex((m) => m.id === userMsg.id))
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content, images: (m as unknown as { images?: string[] }).images }));
      await requestAssistant(active.id, userMsg.content, history, active.modelId, (userMsg as unknown as { images?: string[] }).images);
    },
    [active, removeMessage, requestAssistant]
  );

  const editMessage = useCallback(
    async (msgId: string, content: string) => {
      if (!active) return;
      updateMessage(active.id, msgId, { content, timestamp: Date.now() });
      truncateAfter(active.id, msgId);
      const history = active.messages
        .slice(0, active.messages.findIndex((m) => m.id === msgId))
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      await requestAssistant(active.id, content, history, active.modelId);
    },
    [active, updateMessage, truncateAfter, requestAssistant]
  );

  const stop = () => abortRef.current?.abort();
  const modelName = MODELS.find((m) => m.id === model)?.name ?? model;

  return (
    <div className="relative flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[rgba(148,163,184,0.12)] px-3 sm:px-4">
          <button
            onClick={onOpenMobileNav}
            className="grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5 dark:hover:bg-white/10 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{active?.title ?? "New conversation"}</p>
            <p className="hidden truncate text-[11px] text-[#94A3B8] sm:block">
              {active ? `${active.messages.length} messages · ${modelName}` : `Ready · ${modelName}`}
              {isAgnesChatModel(model) && " · Streaming"}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => createConversation(model)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-[rgba(148,163,184,0.16)] px-2.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            <button
              onClick={() => setContextPanel(!showPanel)}
              className={cn(
                "hidden h-9 w-9 place-items-center rounded-xl border border-[rgba(148,163,184,0.16)] hover:bg-slate-50 dark:hover:bg-white/5 xl:grid",
                showPanel && "bg-[#EFF6FF] dark:bg-[#2563EB]/15"
              )}
              aria-label="Toggle context panel"
            >
              {showPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {serviceWarning && (
          <div className="flex items-center gap-2 border-b border-[#F59E0B]/20 bg-[#F59E0B]/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              The upstream AI service didn&apos;t answer after automatic retries. Switch model or try again in a moment.
            </span>
            {active && (
              <button
                onClick={() => {
                  const last = [...active.messages].reverse().find((m) => m.role === "user");
                  if (last) regenerate(asstErrorId(active, last));
                }}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold hover:bg-black/5 dark:hover:bg-white/10"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            )}
            <button
              onClick={() => setServiceWarning(null)}
              className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Dismiss warning"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {active && active.messages.length > 0 ? (
          <MessageList
            messages={active.messages}
            streamingId={pendingId}
            onRegenerate={regenerate}
            onEditMessage={editMessage}
          />
        ) : (
          <WelcomeScreen
            onPick={(prompt, isImage) => {
              if (isImage) return onGoToImageStudio(prompt);
              void sendMessage(prompt);
            }}
          />
        )}

        <Composer
          onSend={(t, imgs) => void sendMessage(t, imgs)}
          onStop={stop}
          isStreaming={!!pendingId}
          selectedModel={model}
          onModelChange={(m) => {
            setDefaultModel(m);
            if (active) setConversationModel(active.id, m);
          }}
        />
      </div>

      {showPanel && (
        <ContextPanel
          modelId={model}
          onClose={() => setContextPanel(false)}
          conversationTitle={active?.title}
          messageCount={active?.messages.length ?? 0}
        />
      )}
    </div>
  );
}

function asstErrorId(conv: { messages: ChatMessage[] }, lastUser: ChatMessage): string {
  const idx = conv.messages.findIndex((m) => m.id === lastUser.id);
  const next = conv.messages.slice(idx + 1).find((m) => m.role === "assistant");
  return next?.id ?? lastUser.id;
}
