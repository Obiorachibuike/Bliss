"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/components/layout/ThemeProvider";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

/**
 * Assistant markdown. Only CommonMark + GFM are parsed and no raw HTML is
 * forwarded to the DOM (react-markdown drops it by default, and we never pass
 * `rehype-raw`), so a model cannot smuggle executable markup into the chat.
 */
export function MarkdownRenderer({ content }: { content: string }) {
  const { theme } = useTheme();
  const renderMarkdown = useSettingsStore((s) => s.markdownRendering);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!renderMarkdown) {
    return (
      <div className="bliss-md whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {content}
      </div>
    );
  }

  return (
    <div className="bliss-md max-w-none text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-6 mb-3 text-xl font-bold" {...p} />,
          h2: (p) => <h2 className="mt-5 mb-2 text-lg font-semibold" {...p} />,
          h3: (p) => <h3 className="mt-4 mb-2 text-base font-semibold" {...p} />,
          p: (p) => <p className="my-2 leading-7 text-slate-700 dark:text-slate-300" {...p} />,
          ul: (p) => <ul className="my-2 list-disc space-y-1 pl-6" {...p} />,
          ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-6" {...p} />,
          li: (p) => <li className="leading-relaxed" {...p} />,
          strong: (p) => <strong className="font-semibold text-slate-900 dark:text-white" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="my-3 rounded-r-lg border-l-2 border-[#2563EB]/40 bg-[#2563EB]/5 py-2 pl-4 italic dark:bg-[#2563EB]/10"
              {...p}
            />
          ),
          table: (p) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-[rgba(148,163,184,0.16)]">
              <table className="min-w-full text-sm" {...p} />
            </div>
          ),
          th: (p) => <th className="bg-slate-50 px-3 py-2 text-left font-semibold dark:bg-white/5" {...p} />,
          td: (p) => <td className="border-t border-[rgba(148,163,184,0.12)] px-3 py-2" {...p} />,
          a: (p) => (
            <a
              className="text-[#2563EB] underline decoration-[#2563EB]/30 underline-offset-2 hover:text-[#3B82F6] dark:text-[#60A5FA]"
              target="_blank"
              rel="noopener noreferrer nofollow"
              {...p}
            />
          ),
          hr: () => <hr className="my-6 border-[rgba(148,163,184,0.16)]" />,
          code: ({ children, className, node: _node, ...rest }) => {
            const match = /language-(\w+)/.exec(className || "");
            const codeText = String(children).replace(/\n$/, "");
            const lang = match?.[1] ?? "";
            const id = `${lang}:${codeText.slice(0, 24)}`;

            if (!lang) {
              return (
                <code
                  className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-[#2563EB] dark:bg-white/10 dark:text-[#60A5FA]"
                  {...rest}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="group/code my-3 overflow-hidden rounded-xl border border-[rgba(148,163,184,0.16)]">
                <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.12)] bg-[#F8FAFC] px-3 py-1.5 dark:bg-[#0B1220]">
                  <span className="font-mono text-xs text-[#94A3B8]">{lang}</span>
                  <button
                    onClick={() => handleCopy(codeText, id)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#94A3B8] transition hover:bg-black/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    {copied === id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied === id ? "Copied" : "Copy"}
                  </button>
                </div>
                <SyntaxHighlighter
                  language={lang}
                  PreTag="div"
                  style={theme === "dark" ? oneDark : oneLight}
                  customStyle={{ margin: 0, borderRadius: 0, fontSize: "13px", padding: "12px" }}
                >
                  {codeText}
                </SyntaxHighlighter>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
