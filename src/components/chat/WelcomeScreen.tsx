"use client";
import { MessageSquare, PenLine, Image as ImageIcon, Blocks } from "lucide-react";


const suggestions = [
  {
    icon: <MessageSquare className="h-4 w-4" />,
    title: "Ask anything",
    prompt: "Help me understand quantum entanglement like I'm 12 years old.",
    hint: "Explain a difficult topic",
  },
  {
    icon: <PenLine className="h-4 w-4" />,
    title: "Write something",
    prompt:
      "Write a professional, warm email to a client rescheduling our Friday meeting to next Tuesday, apologising for the short notice.",
    hint: "Draft emails, posts and copy",
  },
  {
    icon: <ImageIcon className="h-4 w-4" />,
    title: "Create an image",
    prompt: "Create a cinematic image of a futuristic city at dusk, blue hour light, glass towers, flying trams.",
    hint: "Open Image Studio with this prompt",
  },
  {
    icon: <Blocks className="h-4 w-4" />,
    title: "Build something",
    prompt:
      "Help me architect a full-stack Next.js application with authentication, a Postgres database and a REST API. Include folder structure and the trade-offs of each choice.",
    hint: "Plan and code a project",
  },
];

export function WelcomeScreen({
  onPick,
  userName,
}: {
  onPick: (prompt: string, isImage: boolean) => void;
  userName?: string;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-10 sm:py-14">
      <div className="animate-breathe mb-7 grid h-16 w-16 place-items-center rounded-[22px] brand-gradient brand-glow">
        <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden="true">
          <path d="M12 3L14.5 8.6L21 9.3L16.2 13.9L17.5 21L12 17.6L6.5 21L7.8 13.9L3 9.3L9.5 8.6L12 3Z" fill="white" fillOpacity="0.95" />
        </svg>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#94A3B8]">
        {greeting}
        {userName ? ` · ${userName}` : ""}
      </p>
      <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.15]">
        What can we <span className="brand-text">create</span> today?
      </h1>
      <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-[#94A3B8] sm:text-base">
        Ask anything, explore ideas, generate images, or bring your next project to life.
      </p>

      <div className="mt-9 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <button
            key={s.title}
            onClick={() => onPick(s.prompt, i === 2)}
            style={{ animationDelay: `${i * 70}ms` }}
            className="animate-fade-up group relative overflow-hidden rounded-2xl border border-[rgba(148,163,184,0.16)] bg-white/70 p-4 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-[#2563EB]/30 hover:shadow-[0_16px_40px_-16px_rgba(37,99,235,0.45)] dark:bg-[#101827]/70"
          >
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_70%)] opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB] transition-all duration-300 group-hover:bg-[linear-gradient(135deg,#2563EB_0%,#3B82F6_45%,#60A5FA_100%)] group-hover:text-white dark:bg-[#2563EB]/15 dark:text-[#60A5FA]">
              {s.icon}
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#94A3B8]">{s.prompt}</p>
            <p className="mt-2 text-[11px] font-medium text-[#2563EB] opacity-0 transition-opacity group-hover:opacity-100 dark:text-[#60A5FA]">
              {s.hint} →
            </p>
          </button>
        ))}
      </div>

      <p className="mt-8 text-center text-[11px] leading-relaxed text-[#94A3B8]">
        Powered by CVRON Free AI APIs · Llama · GPT‑5 Nano · Gemini 2.5 Flash Lite · DeepSeek V3.2
      </p>
    </div>
  );
}
