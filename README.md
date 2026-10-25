# Bliss — AI Workspace

> **Your ideas. Infinite possibilities.**

Bliss is an all-in-one AI workspace: multi-model chat, image generation, AI image editing and image-to-video
creation — wrapped in one blue-gradient, glass-lit interface that works on desktop, tablet and mobile.

Built on the free, key-less endpoints documented in
**[cvroon-api/FreeAiAPIs](https://github.com/cvroon-api/FreeAiAPIs)**, integrated through a controlled Next.js
server layer so the browser never talks to the upstream directly.

---

## Table of contents

- [What actually works](#what-actually-works)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Verified API surface](#verified-api-surface)
- [Honest limitations](#honest-limitations)
- [Security, privacy & abuse guards](#security-privacy--abuse-guards)
- [Testing](#testing)
- [Deployment](#deployment)
- [Keyboard & accessibility](#keyboard--accessibility)

---

## What actually works

| Area | Status | Notes |
| --- | --- | --- |
| Multi-model chat | ✅ Working | Llama 3.3 · GPT‑5 Nano · Gemini 2.5 Flash Lite · DeepSeek V3.2 |
| Model switching | ✅ Working | Selection is sent to the matching upstream endpoint — not cosmetic |
| Markdown + syntax highlighting | ✅ Working | GFM tables, task lists, fenced code with per-block copy |
| Edit / regenerate / copy | ✅ Working | Editing a turn forks the thread from that point |
| Conversation history | ✅ Working | Renamed, searchable, pinnable, persisted in `localStorage` |
| Image generation | ✅ Wired to `flux-dev.php` | One image per call; 1–4 per batch |
| Image editing | ✅ Wired to `image2image.php` | Requires a **public image URL** (endpoint cannot take uploads) |
| Image-to-video | ✅ Wired to `wan22.php` | Long-running single request, live elapsed timer |
| Saved library | ✅ Working | Responses, images, video refs, code snippets |
| Themes | ✅ Working | Light / dark / system, persisted, applied pre-paint (no flash) |
| Streaming | ⛔ Not supported | Upstream has no SSE — Bliss shows an honest *Thinking…* state |
| Vision / image analysis | ⛔ Not supported | No documented endpoint; the feature is labelled unavailable |
| Text-to-video | ⛔ Not supported | Only image-to-video exists |
| Server database | ⛔ Not required | Anonymous-first; see [Deployment](#deployment) |

Bliss never simulates an unsupported capability. Where the upstream cannot do something, the UI says so.

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript (strict)**
- **Tailwind CSS v4** with a Bliss brand layer, `@tailwindcss/typography`
- **lucide-react** icons · **react-markdown** + **remark-gfm** + **react-syntax-highlighter**
- **zustand** with `persist` (localStorage) for conversations, library and settings
- **Vitest** + **Testing Library** for unit/integration/component tests, **Playwright** for browser E2E

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

```bash
npm run build          # production build
npm run start          # serve the production build
npm test               # 112 unit + integration + component tests
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npx playwright install && npm run test:e2e   # browser suite (desktop / iPhone / iPad)
```

## Environment variables

Bliss runs with **zero** configuration: the upstream is a free, key-less API and all user data lives in the browser.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BLESS_API_BASE` | No | `https://cvron.alwaysdata.net` | Override the upstream host (mirrors, self-hosted gateway) |
| `PORT` | No | `3000` | Listen port for `npm run start` |

Copy the template if you want to change anything:

```bash
cp .env.example .env.local
```

There are **no secret values to protect** — and the app never reads a client-side `NEXT_PUBLIC_*` key, so nothing can
leak by accident.

## Architecture

```
src/
├─ app/
│  ├─ api/
│  │  ├─ chat/route.ts     POST  model allow-list → context adapter → upstream (timeout + retry)
│  │  ├─ image/route.ts    POST  generate | edit  (validated image_url)
│  │  ├─ video/route.ts    POST  image-to-video (maxDuration 300s)
│  │  ├─ models/route.ts   GET   verified catalogue + limitations
│  │  └─ health/route.ts   GET   live probe of the upstream
│  ├─ layout.tsx           theme bootstrap, metadata, manifest, toaster
│  └─ page.tsx              workspace shell (chat / studios / saved / history / settings / API)
├─ lib/
│  ├─ api/config.ts         single source of truth for endpoints + models + limits
│  ├─ api/text.ts           LLM call, retry, response validation, payload parsing
│  ├─ api/media.ts          image / edit / video / host calls + strict URL validation
│  ├─ api/client.ts         timeout, JSON fetch, url + prompt validation
│  ├─ store/                chatStore · savedStore · settingsStore (zustand + persist)
│  ├─ types/                shared domain types
│  └─ utils/                cn · title generation · relative time
└─ components/
   ├─ layout/               Sidebar · Logo · ThemeProvider
   ├─ chat/                 Composer · MessageList · MarkdownRenderer · ModelSelector · ContextPanel · WelcomeScreen
   ├─ image/                ImageStudio (generate + edit tabs, gallery, lightbox)
   ├─ video/                VideoStudio (source URL, motion prompt, elapsed timer)
   └─ ui/                   Button · Card · Input · Badge · Toast · Lightbox
```

Design rules the codebase enforces:

- **One place for endpoints.** No component hard-codes an upstream URL; everything resolves from `lib/api/config.ts`.
- **Server-mediated calls.** The browser only ever calls `/api/*`, so validation, rate limiting and retries stay in one spot.
- **Never trust a 200.** Every payload is parsed and validated (`parseChatPayload`, `parseMediaPayload`); HTML error pages,
  empty bodies and `success:false` envelopes become user-facing errors, never fake results.

## Verified API surface

The in-app **API Explorer** (sidebar → API Explorer) documents every endpoint with method, parameters, example request,
real response shape and known limitations, and separates upstream routes from Bliss's own. The same list, in short:

```http
GET https://cvron.alwaysdata.net/cvronai/llama.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/gpt-5-nano.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/gemini-2.5-flash-lite.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/deepseek-v3.2.php?prompt=…

GET https://cvron.alwaysdata.net/cvronai/flux-dev.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/image2image.php?prompt=…&image_url=…
GET https://cvron.alwaysdata.net/cvronai/up.php?url=…

GET https://cvron.alwaysdata.net/cvronai/wan22.php?prompt=…&image=…
```

Bliss's own routes:

```http
POST /api/chat     { model, prompt, history? }  → { success, response, model }
POST /api/image    { mode, prompt, imageUrl? }  → { success, imageUrl }
POST /api/video    { prompt, imageUrl }         → { success, videoUrl }
GET  /api/models   → verified catalogue + limitations
GET  /api/health   → live upstream probe + capability matrix
```

Documented but intentionally **not** exposed in the product: `sslproxy.php`, `url-shortener.php`, `win-key.php`
(non-AI utilities that would not belong in this workspace).

## Honest limitations

These come straight from the provider's documentation and drive real product decisions:

1. **No streaming.** Responses arrive complete. The composer shows a *Thinking…* indicator that reflects actual request
   state, and Stop discards the in-flight turn instead of faking a token stream.
2. **No native conversation context.** Every endpoint takes a single `prompt`. Bliss folds the last ≤8 turns into one
   prompt (`buildContextPrompt`), stays inside the documented length budget, keeps the newest turns when trimming, and
   strips any echoed `Assistant:` scaffold from the reply. It is context *construction*, not model memory.
3. **Image generation returns one image per call**, from `flux-dev` only, with hosted URLs that may expire. Bliss says
   "copy or download now" instead of promising permanent storage.
4. **Editing and video need a publicly reachable URL** — the endpoints accept URLs, never multipart uploads. Every
   upload-shaped control is therefore a URL field with the requirement stated inline.
5. **Video is synchronous.** No job id, no polling endpoint, no callback. Bliss runs one long request (290s client cap,
   300s route `maxDuration`) with a live elapsed timer, and reports timeouts plainly.
6. **Free-tier reliability.** `cvron.alwaysdata.net` is rate-limited and occasionally offline. Bliss retries transient
   failures, never retries client errors, and surfaces a dismissible banner plus per-message inline errors when the
   upstream is unreachable.

## Security, privacy & abuse guards

- **No secrets exist** on the server, and nothing sensitive is read from the environment on the client.
- **Model allow-list:** unknown `model` values are rejected with `400` before any outbound request.
- **SSRF-safe URL handling:** user-supplied image URLs must parse as `http:`/`https:` — `file:`, `javascript:` and
  friends are rejected. Bliss never fetches an arbitrary user URL server-side beyond the documented endpoints.
- **Body and prompt limits:** JSON parse guarded, 24 000-char message cap, 1 000-char image prompt cap, `413` on overflow.
- **Rate limiting:** 20 chat requests / minute / IP (`x-forwarded-for`), with opportunistic bucket pruning so a
  long-lived container cannot leak memory. Pair with Vercel/KV or Upstash for multi-instance precision.
- **Response validation:** every upstream payload is parsed and shape-checked; HTML error pages become errors.
- **No dangerous rendering:** react-markdown without `rehype-raw` — raw HTML in a model response is dropped, never
  injected, and code blocks are highlighted, not executed.
- **Security headers** for every route: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, and `poweredByHeader` disabled.
- **Privacy:** conversations, saved items and preferences live in your browser (`localStorage` keys prefixed `bliss-`).
  No accounts, no analytics, no server-side store. Prompts you send do leave for the public provider — the Settings →
  Privacy panel says exactly that, and one click clears history or the whole library.

## Testing

```bash
npm test
```

112 tests across six files:

| Suite | Covers |
| --- | --- |
| `test/unit/api.test.ts` | endpoint mapping, request construction, retry/no-retry policy, response validation, prompt & URL checks, title generation |
| `test/unit/media.test.ts` | image / edit / video / host parsing, HTML-error handling, nested payloads, non-http scheme rejection |
| `test/unit/stores.test.ts` | conversation CRUD, pin/rename/delete, per-conversation model, search, `localStorage` persistence, saved library, context adapter |
| `test/unit/components.test.tsx` | welcome screen, composer keys + attachment honesty, model selector, message actions, markdown/code safety, theme |
| `test/integration/routes.test.ts` | `POST /api/chat`, `/api/image`, `/api/video`: allow-list, limits, rate limit, upstream outage, context folding |
| `test/e2e/app-flow.test.tsx` | the full journey through the real component tree (14 steps, upstream mocked at the network boundary) |
| `e2e/bliss.spec.ts` | Playwright browser suite: desktop, iPhone 14, iPad portrait; overflow + drawer + persistence checks |

External HTTP is always mocked, so the suite is deterministic and never hits the free provider.

## Deployment

### Vercel (recommended)

```bash
npm i -g vercel
vercel            # link
vercel --prod
```

Nothing else is required: no env vars, no database, no build command overrides. The project builds with
`next build` (Turbopack) and runs on the Node runtime; `/api/video` sets `maxDuration = 300`, so on Vercel's Hobby
plan raise the function timeout to 300s in Settings → Functions if you use Video Studio there.

### Any Node host

```bash
npm ci
npm run build
npm run start        # honours PORT
```

Bind to `0.0.0.0` when running in a container so the port is reachable from outside.

### Optional Postgres persistence

The product is deliberately **anonymous-first**, so no database is required. `savedStore` / `chatStore` are the single
seam for persistence: if you add Postgres later, keep the same shapes and mirror writes to Prisma/Drizzle models
(`Conversation`, `Message`, `SavedItem`, `Preference`) behind a new `/api/library` route. Until such a database exists
in the deployment, Bliss does not claim server-side storage.

### Post-deploy smoke test

```bash
curl -s https://<host>/api/health | jq '.status, .services'
curl -s https://<host>/api/models | jq '.text[].id'
curl -s -X POST https://<host>/api/chat -H 'content-type: application/json' \
     -d '{"model":"llama","prompt":"Say OK"}' | jq
```

Expected: `status` is `operational` when the provider is up (or `degraded` when the free tier is throttling), four model
ids, and either a real `response` or a clean `{ success: false, error }` — never a fabricated answer.

## Keyboard & accessibility

- `Enter` sends · `Shift + Enter` newline · `⌘/Ctrl + Enter` always sends (both honoured with `enterToSend` off)
- IME-safe: composition never submits a message
- Full keyboard navigation with visible blue focus rings, labelled icon-only buttons, `role="switch"` toggles
- Reduced-motion respected (all Bliss animations collapse to instant transitions)
- AA contrast in both themes; dark palette ships as default
- Mobile: drawer navigation, sticky composer that follows the on-screen keyboard, `100dvh` layout, no horizontal
  overflow at 360px, scrollable code blocks and tables

---

**Third-party services.** Bliss calls CVRON's free APIs and displays media hosted by that provider. Prompts and pasted
image URLs are transmitted to it. Availability and rate limits are outside this project's control — which is exactly why
every failure path is user-visible and every unsupported capability is labelled rather than faked.
