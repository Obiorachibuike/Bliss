# Bliss — AI Workspace

> **Your ideas. Infinite possibilities.**

> Live deployment: **https://bliss-ai-iota.vercel.app** · verified 2026-10-25 — `/api/health` reported
> `status: operational` with the text upstream returning HTTP 200 and a valid JSON payload.

Bliss is an all-in-one AI workspace: **Free ChatGPT-style AI web app — text chat, image generation, and video generation** — wrapped in one blue-gradient, glass-lit interface that works on desktop, tablet and mobile.

Powered by two providers:
- **Pesles AI (Agnes AI)** — free $0 promo tier: **text chat streaming** (`agnes-2.0-flash` via `POST /v1/chat/completions`), **image** (`agnes-image-2.1-flash` via `POST /v1/images/generations`), **video async** (`agnes-video-v2.0` via `POST /v1/videos` + polling) — see [agnes-ai.com](https://agnes-ai.com) + [platform.agnes-ai.com](https://platform.agnes-ai.com)
- **CVRON FreeAiAPIs** — free key-less fallback (Llama 3.3, GPT-5 Nano, Gemini, DeepSeek, Flux Dev, WAN 2.2) — [cvroon-api/FreeAiAPIs](https://github.com/cvroon-api/FreeAiAPIs)

Both integrated through a controlled Next.js server layer so the browser never talks to the upstream directly and keys never leak.

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
| Multi-model chat | ✅ Working | **Pesles (Agnes)**: agnes-2.0-flash · agnes-2.5-flash · agnes-3.0-flash (streaming, vision) + CVRON: Llama 3.3 · GPT‑5 Nano · Gemini 2.5 Flash Lite · DeepSeek V3.2 |
| Model switching | ✅ Working | Selection is sent to the matching upstream endpoint — not cosmetic |
| Streaming | ✅ Working | Agnes chat streams SSE tokens (`stream: true`) piped via `/api/chat`; CVRON fallback non-streaming with honest *Thinking…* |
| Vision / image analysis | ✅ Working | Via Agnes: attach images (paperclip / paste / drag-drop), downscaled to 2048px, sent as base64 data URIs |
| Text file context | ✅ Working | Attach .txt/.md/.csv etc; contents inlined into prompt |
| Markdown + syntax highlighting | ✅ Working | GFM tables, task lists, fenced code with per-block copy |
| Edit / regenerate / copy | ✅ Working | Editing a turn forks the thread from that point |
| Conversation history | ✅ Working | Renamed, searchable, pinnable, persisted in `localStorage` |
| Image generation | ✅ Working | Agnes `agnes-image-2.1-flash` (1K–4K + ratios, `extra_body.response_format: url`) + CVRON `flux-dev.php` (1–4 per batch) |
| Image editing | ✅ Working | Agnes via `extra_body.image` (URL or base64) + CVRON `image2image.php` (public URL) |
| Image-to-video | ✅ Working | Agnes `agnes-video-v2.0` async + polling + keyframe (2+ images); CVRON `wan22.php` sync |
| Text-to-video | ✅ Working | Via Agnes video (text-only prompt) |
| Saved library | ✅ Working | Responses, images, video refs, code snippets |
| Themes | ✅ Working | Light / dark / system, persisted, applied pre-paint (no flash) |
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

**With Pesles AI (Agnes):**

1. Get a free API key (no credit card): sign up at [platform.agnes-ai.com](https://platform.agnes-ai.com) → API Keys → create key.
2. Configure:
  ```bash
  cp .env.example .env
  ```
  Then add your key(s) as numbered variables — add as many as you want, the server detects them all automatically:
  ```
  AGNES_API_KEY_1=sk-...
  AGNES_API_KEY_2=sk-...
  AGNES_API_KEY_3=sk-...
  # ...just keep numbering to add more
  ```
  (Comma-separated `AGNES_API_KEYS` and single `AGNES_API_KEY` also work.)

  **Key pool:** the server rotates keys round-robin and fails over automatically — a key that hits the rate limit (429) is benched for 60 s, one that runs out of quota (402) for 1 hour, and an invalid key (401) is disabled permanently. Video status polling always uses the same key that created the task, since tasks are account-scoped. The frontend never sees keys, provider names, or technical error details — those go to the server console only.
3. Install & run:
  ```bash
  npm install
  npm start
  ```
4. Open **[http://localhost:3000](http://localhost:3000)**

```bash
npm run build          # production build
npm run start          # serve the production build
npm test               # unit + integration + component tests
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npx playwright install && npm run test:e2e   # browser suite (desktop / iPhone / iPad)
```

## Environment variables

Bliss runs with **zero** config for CVRON, but Pesles AI (Agnes) needs keys for streaming/vision/image/video:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AGNES_API_KEY_1` | For Agnes | — | Primary key (numbered 1…N, unlimited) |
| `AGNES_API_KEY_2` etc | No | — | Additional keys for rotation |
| `AGNES_API_KEYS` | No | — | Comma-separated alternative |
| `AGNES_API_KEY` | No | — | Single-key alternative |
| `AGNES_API_BASE` | No | `https://apihub.agnes-ai.com/v1` | Override Agnes gateway |
| `BLESS_API_BASE` | No | `https://cvron.alwaysdata.net` | Override CVRON host (mirrors) |
| `PORT` | No | `3000` | Listen port for `npm run start` |

Copy the template:
```bash
cp .env.example .env.local
```

CVRON is key-less so no secret leaks. **Agnes keys are server-only** — never `NEXT_PUBLIC_*`, never reach the browser.

## Architecture

```
src/
├─ app/
│  ├─ api/
│  │  ├─ chat/route.ts     POST  model allow-list → Agnes streaming SSE OR CVRON context adapter → upstream (timeout+retry, key pool)
│  │  ├─ image/route.ts    POST  Agnes (size/ratio/extra_body.response_format url) OR CVRON flux-dev
│  │  ├─ video/route.ts    POST  Agnes async task+poll (8n+1 snap) OR CVRON wan22 sync (maxDuration 300s)
│  │  ├─ video/[id]/route.ts GET poll Agnes task by video_id (same-key affinity)
│  │  ├─ models/route.ts   GET   verified catalogue + Pesles limits
│  │  └─ health/route.ts   GET   live probe (CVRON + Agnes) + key pool stats
│  ├─ layout.tsx           theme bootstrap, metadata, manifest, toaster
│  └─ page.tsx              workspace shell (chat / studios / saved / history / settings / API)
├─ lib/
│  ├─ api/config.ts         single source of truth for endpoints + models + limits (CVRON + Agnes)
│  ├─ api/agnes.ts           Agnes chat/image/video client, frame snap, resolution tiers, error extraction
│  ├─ api/agnesKeys.ts       Key pool: parse AGNES_API_KEY_n, round-robin, bench 429/60s 402/1h 401/perm, video affinity
│  ├─ api/text.ts           CVRON LLM call, retry, response validation
│  ├─ api/media.ts          CVRON image/edit/video/host calls
│  ├─ api/client.ts         timeout, JSON fetch, url + prompt validation
│  ├─ utils/fileHandling.ts  Client-side image downscale (2048px max, base64 data URI), text inline, thumbnails
│  ├─ store/                chatStore · savedStore · settingsStore (zustand + persist)
│  ├─ types/                shared domain types
│  └─ utils/                cn · title generation · relative time
└─ components/
   ├─ layout/               Sidebar · Logo · ThemeProvider
   ├─ chat/                 Composer (paperclip/paste/drag, vision) · MessageList (streaming, images) · ModelSelector (grouped) · ContextPanel · WelcomeScreen
   ├─ image/                ImageStudio (Agnes 1K–4K + ratios, upload) + Flux fallback
   ├─ video/                VideoStudio (Agnes async poll 5s, keyframe, text-to-video + WAN fallback)
   └─ ui/                   Button · Card · Input · Badge · Toast · Lightbox
```

Design rules:

- **One place for endpoints.** No component hard-codes an upstream URL; everything resolves from `lib/api/config.ts`.
- **Server-mediated calls.** The browser only ever calls `/api/*`, so validation, rate limiting, retries and key pooling stay server-side.
- **Never trust a 200.** Every payload is parsed and validated; HTML error pages, empty bodies and `success:false` become user-facing errors.
- **Keys never leak.** Frontend never sees `AGNES_API_KEY_*`; technical errors go to server console only.

## How it works (Pesles AI)

- `server.js` concept in Next.js: Express-like proxies moved to Next.js route handlers:
  - `POST /api/chat` — forwards messages with `stream: true` and pipes the SSE token stream back to the client (Agnes) or falls back to CVRON single-prompt folding.
  - `POST /api/image` — forwards prompt + size/ratio (`response_format` correctly nested in `extra_body`, per Agnes docs) and returns the image URL.
  - `POST /api/video` + `GET /api/video/:id` — creates the async video task, then the client polls every 5 s until `status: completed` returns the mp4 URL.
- `public/` replaced by Next.js `src/` — vanilla ChatGPT-style dark UI with mode switcher, streaming text rendering, image gallery, video progress bar.
- **Uploads:** the paperclip (or paste / drag-and-drop) attaches files per mode — Chat accepts images (vision) and text files (contents are inlined into the prompt); Image mode accepts images for image-to-image transformation (`extra_body.image`); Video mode accepts 1 image for image-to-video or 2+ for keyframe animation (`extra_body.image` + `mode: "keyframes"`). Images are downscaled client-side (max 2048 px) and sent as base64 data URIs; only tiny thumbnails are persisted to localStorage.

## Verified API surface

The in-app **API Explorer** documents every endpoint with method, parameters, example request, real response shape and known limitations, and separates upstream routes from Bliss's own. Short list:

**CVRON (key-less):**
```http
GET https://cvron.alwaysdata.net/cvronai/llama.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/gpt-5-nano.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/gemini-2.5-flash-lite.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/deepseek-v3.2.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/flux-dev.php?prompt=…
GET https://cvron.alwaysdata.net/cvronai/image2image.php?prompt=…&image_url=…
GET https://cvron.alwaysdata.net/cvronai/wan22.php?prompt=…&image=…
```

**Pesles AI (Agnes) — $0 promo:**
```http
POST https://apihub.agnes-ai.com/v1/chat/completions   // model: agnes-2.0-flash, streaming SSE
POST https://apihub.agnes-ai.com/v1/images/generations  // model: agnes-image-2.1-flash, size 1K–4K, ratio, extra_body.response_format=url
POST https://apihub.agnes-ai.com/v1/videos              // model: agnes-video-v2.0, num_frames 8n+1, polling GET
GET  https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>
```

**Bliss's own routes:**
```http
POST /api/chat     { model, prompt, history?, images?, stream? } → SSE stream or { success, response, model }
POST /api/image    { prompt, model?, size?, ratio?, images?, imageUrl?, mode? } → { success, imageUrl }
POST /api/video    { prompt, images?/imageUrl, model?, num_frames?, frame_rate? } → { success, videoId, pollUrl } → GET /api/video/:id → { status, videoUrl }
GET  /api/models   → verified catalogue + Pesles limits
GET  /api/health   → live upstream probe + key pool stats + capability matrix
```

## Honest limitations

1. **CVRON has no streaming** — Bliss shows *Thinking…* indicator; Stop discards the turn. **Pesles (Agnes) does stream** — tokens pipe via SSE.
2. **CVRON has no native conversation context** — Bliss folds last ≤8 turns into one prompt, stays inside 4000-char budget, keeps newest turns, strips scaffold. **Pesles has native messages array** with system prompt and vision.
3. **Image generation returns one image per call**, with hosted URLs that may expire. For Agnes, `response_format` must be nested in `extra_body` per docs — Bliss does this correctly.
4. **Video:** CVRON `wan22` is synchronous (no job id, no polling, 290s cap). **Pesles is async**: create task → poll every 5s with same key (account-scoped) until `completed`. `num_frames` must satisfy 8n+1 (server snaps automatically).
5. **Free-tier reliability.** Both providers are rate-limited (Agnes: 20 RPM text, 1/min video). Bliss retries transient failures, surfaces per-message errors, and benches keys per spec.
6. **Media URLs have no documented expiry** — download anything you want to keep.

## Security, privacy & abuse guards

- **Agnes keys are server-only** — never exposed to client, never logged with prompt. Frontend sees only generic errors; details go to server console.
- **Key pool hardening:** round-robin, 429→60s bench, 402→1h bench, 401→permanent disable, video affinity (same key polls).
- **Model allow-list:** unknown `model` values are rejected with `400` before any outbound request.
- **SSRF-safe URL handling:** user-supplied image URLs must parse as `http:`/`https:`; `file:`, `javascript:` rejected. Base64 data URIs allowed for Agnes uploads.
- **Body and prompt limits:** JSON parse guarded, 24 000-char message cap, 2 000-char image prompt cap, `413` on overflow.
- **Rate limiting:** 20 chat requests / minute / IP (`x-forwarded-for`), with opportunistic bucket pruning. Pair with Vercel/KV or Upstash for multi-instance precision.
- **Response validation:** every upstream payload is parsed and shape-checked; HTML error pages become errors.
- **No dangerous rendering:** react-markdown without `rehype-raw` — raw HTML dropped, code highlighted not executed.
- **Security headers** for every route: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `poweredByHeader` disabled.
- **Privacy:** conversations, saved items and preferences live in your browser (`localStorage` keys prefixed `bliss-`). No accounts, no analytics. Prompts leave for the provider — Privacy panel says exactly that, one click clears history/library.

## Testing

```bash
npm test
```

Tests mock every external fetch, so deterministic:

| Suite | Covers |
| --- | --- |
| `test/unit/api.test.ts` | endpoint mapping, request construction, retry/no-retry, response validation, prompt & URL checks, title generation |
| `test/unit/media.test.ts` | image / edit / video / host parsing, HTML-error handling, nested payloads, non-http rejection |
| `test/unit/stores.test.ts` | conversation CRUD, pin/rename/delete, per-conversation model, search, localStorage, saved library, context adapter |
| `test/unit/components.test.tsx` | welcome screen, composer keys + attachment honesty, model selector, message actions, markdown/code safety, theme |
| `test/integration/routes.test.ts` | `POST /api/chat`, `/api/image`, `/api/video`: allow-list, limits, rate limit, upstream outage, context folding, Pesles key routing |
| `test/e2e/app-flow.test.tsx` | full journey through real component tree (14 steps, upstream mocked) |
| `e2e/bliss.spec.ts` | Playwright browser suite: desktop, iPhone 14, iPad portrait; overflow + drawer + persistence checks |

## Deployment

This is a plain Node app — deploy anywhere Node 18+ runs (Render, Railway, Fly.io, a VPS…). Set `AGNES_API_KEY` as an environment variable on the host, point the `Pesles AI` DNS A/CNAME record at it, and enable HTTPS.

### Vercel (recommended)

```bash
npm i -g vercel
vercel            # link
vercel --prod
```

Function timeouts declared in `vercel.json` (`/api/video` 300s, `/api/image` 180s). On Hobby plan raise timeout in Settings → Functions if needed.

Set `AGNES_API_KEY_1` (and 2,3…) in Vercel → Settings → Environment Variables.

### Any Node host

```bash
npm ci
npm run build
npm run start        # honours PORT
```

Bind to `0.0.0.0` in a container.

### Optional Postgres persistence

Product is anonymous-first, no DB required. `savedStore`/`chatStore` are the persistence seam: mirror to Prisma/Drizzle models (`Conversation`, `Message`, `SavedItem`, `Preference`) behind `/api/library`.

### Post-deploy smoke test

```bash
curl -s https://<host>/api/health | jq '.status, .services, .agnesConfigured'
curl -s https://<host>/api/models | jq '.text[].id'
curl -s -X POST https://<host>/api/chat -H 'content-type: application/json' \
     -d '{"model":"agnes-2.0-flash","prompt":"Say OK","stream":false}' | jq
```

Expected: `status` is `operational` when provider is up (or `degraded` when throttling), 7 chat model ids, and either real `response` or clean `{ success: false, error }` — never fabricated.

## Keyboard & accessibility

- `Enter` sends · `Shift + Enter` newline · `⌘/Ctrl + Enter` always sends (both honoured with `enterToSend` off)
- IME-safe: composition never submits a message
- Full keyboard navigation with visible blue focus rings, labelled icon-only buttons, `role="switch"` toggles
- Reduced-motion respected (all Bliss animations collapse to instant transitions)
- AA contrast in both themes; dark palette ships as default
- Mobile: drawer navigation, sticky composer that follows on-screen keyboard, `100dvh` layout, no horizontal overflow at 360px, scrollable code blocks and tables

---

**Third-party services.** Bliss calls CVRON's free APIs and Agnes AI (Pesles AI). Prompts, pasted image URLs and uploaded images (base64) are transmitted to them. Availability, rate limits and $0 pricing (promotional, may change) are outside this project's control — check the [Agnes docs](https://agnes-ai.com/en/docs) for current pricing. Every failure path is user-visible, every unsupported capability is labelled rather than faked.
