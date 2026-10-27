# Bliss — AI Workspace

> **Your ideas. Infinite possibilities.**

> Live deployment: **https://bliss-ai-iota.vercel.app** · re-verified after every deploy (last: 2026-10-27 22:00 UTC).
> `/api/models` there returns every key-less model plus the documented Agnes chat, image and video ids, with
> `fallback: { enabled: false, videoModel: null, videoModels: [], textToVideo: false }` — this deployment deliberately
> carries no `AGNES_API_KEY`, so the optional provider is documented and armed, never silently active (its pickers stay
> visible and say what to set; `GET /api/video?jobId=…` answers `400` with that same guidance rather than inventing a
> job). The live health probe is honest about partial outages too: at the check above the chat endpoint answered
> `503` while the image endpoint answered `200`, which reports `status: "degraded"` with `degraded: ["chat + video"]`
> — `operational` is reserved for both probes returning a usable body. `/api/health` and `/api/models` answer with
> `Cache-Control: no-store`, so an intermediary can never serve a stale copy of either.

Bliss is an all-in-one AI workspace: multi-model chat, image generation, AI image editing and video creation (both
image-to-video and asynchronous text / keyframe / reference tasks) — wrapped in one blue-gradient, glass-lit
interface that works on desktop, tablet and mobile. Every capability has a real model picker wired to the endpoint
that actually answers it.

Built on the free, key-less endpoints documented in
**[cvroon-api/FreeAiAPIs](https://github.com/cvroon-api/FreeAiAPIs)**, integrated through a controlled Next.js
server layer so the browser never talks to the upstream directly — with an **optional Agnes AI fallback provider**
([docs](https://www.agnes-ai.com/en/docs)) that takes over when the free tier fails, if you give Bliss a key.

---

## Table of contents

- [What actually works](#what-actually-works)
- [Fallback provider (Agnes AI)](#fallback-provider-agnes-ai)
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

| Area                              | Status                        | Notes                                                                                                         |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Multi-model chat                  | ✅ Working                    | Llama 3.3 · GPT‑5 Nano · Gemini 2.5 Flash Lite · DeepSeek V3.2 (+ 4 Agnes models with a key)                  |
| Model switching                   | ✅ Working                    | Every picker is catalogue-driven: the choice is sent to the matching upstream endpoint — not cosmetic         |
| Markdown + syntax highlighting    | ✅ Working                    | GFM tables, task lists, fenced code with per-block copy                                                       |
| Edit / regenerate / copy          | ✅ Working                    | Editing a turn forks the thread from that point                                                               |
| Conversation history              | ✅ Working                    | Renamed, searchable, pinnable, persisted in `localStorage`                                                    |
| Image generation                  | ✅ Wired to `flux-dev.php`    | One image per call; 1–4 per batch                                                                             |
| Image editing                     | ✅ Wired to `image2image.php` | Requires a **public image URL** (endpoint cannot take uploads)                                                |
| Image-to-video                    | ✅ Wired to `wan22.php`       | Long-running single request, live elapsed timer                                                               |
| Text / keyframe / reference video | ✅ Working (needs key)        | Agnes `agnes-video-2.5-flash` and `agnes-video-2.5` as real async tasks the browser polls                     |
| Saved library                     | ✅ Working                    | Responses, images, video refs, code snippets                                                                  |
| Themes                            | ✅ Working                    | Light / dark / system, persisted, applied pre-paint (no flash)                                                |
| Automatic provider fallback       | ✅ Working (opt-in)           | Chat + images retry on Agnes AI when `AGNES_API_KEY` is set                                                   |
| Vision / image analysis           | 🔓 Fallback only              | No key-less endpoint exists; with a key, pasted image URLs are analysed via `image_url`                       |
| Streaming                         | ⛔ Not supported              | The key-less provider cannot stream and Bliss does not fake it — an honest _Thinking…_ state is shown instead |
| Video-to-video                    | 🔓 One model only             | Reference videos exist solely on `agnes-video-2.5`; the key-less provider has no such endpoint                |
| Server database                   | ⛔ Not required               | Anonymous-first; see [Deployment](#deployment)                                                                |

Bliss never simulates an unsupported capability. Where a provider cannot do something, the UI says so — and a
capability that only exists behind the fallback key is labelled _fallback only_, never presented as working on the
free path.

## Fallback provider (Agnes AI)

The primary provider is free and key-less, which also means it is shared, throttled and occasionally down. Bliss can
route a failed request to a second, documented provider instead of showing an error:

```bash
AGNES_API_KEY=sk-…            # server-only; get one at https://platform.agnes-ai.com
```

| Behaviour            | Without a key                              | With a key                                                                                                                     |
| -------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Chat                 | CVRON only, honest 502 on failure          | retry once on `agnes-2.5-flash` (`POST /v1/chat/completions`)                                                                  |
| Images               | `flux-dev` / `image2image` only            | retry on `agnes-image-2.1-flash` (`POST /v1/images/generations`)                                                               |
| Conversation context | flattened 1-prompt digest (≤8 turns)       | genuine `messages` array: last 12 turns + system prompt                                                                        |
| Vision               | URL pasted as text, labelled as unanalysed | real `image_url` content part, analysed by the model                                                                           |
| Video                | WAN 2.2 only, synchronous                  | **asynchronous tasks**: `POST /v1/videos` returns a `video_id`, then `GET /agnesapi?video_id=…&model_name=…` until `completed` |

Design decisions baked into this path:

- **Strictly optional.** No key ⇒ the app behaves exactly as before; `/api/models` and `/api/health` report
  `fallback.enabled: false`, Settings says _"not configured"_, and every fallback-only affordance disappears.
- **Never a silent substitution.** Every success carries `provider` + `fallbackUsed`; a fallback reply is badged
  _via Agnes AI_ in the thread, in Image Studio and in History.
- **Secret containment.** `AGNES_API_KEY` is read in exactly one module (`src/lib/api/fallback-env.ts`), which resolves
  to an empty string whenever `window` exists, and is re-exported nowhere that a client component can reach. Only the
  derived boolean crosses to the browser.
- **Quota respect.** The fallback is never probed by `/api/health`, retries once at most (documented free tier is
  ~20 executable RPM), caps output at `max_tokens: 2048`, and honours the caller's abort signal — a stopped
  generation never triggers a fallback request.
- **Explicit choice beats fallback.** Selecting _Agnes 2.5 Flash_ (or an Agnes image / video model) routes straight
  there and is never answered by the key-less provider; without a key it returns a clear `400` telling you what to set.
- **Video has no fallback, by design.** The two video endpoints take genuinely different inputs (WAN needs a source
  image, Agnes offers text / keyframe / reference), so a failure stays a failure instead of becoming a guess.

### Choosing a model

Model choice is a first-class part of the UI, not a settings afterthought. The pickers read `GET /api/models`, so
what is offered is exactly what the deployment can answer:

| Surface                                                       | Pickers                                                                                                                                                                | What the choice changes                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat (composer + welcome cards, and Settings → default model) | `llama`, `gpt-5-nano`, `gemini-2.5-flash-lite`, `deepseek-v3.2`, `agnes-2.5-flash`, `agnes-3.0-flash`, `agnes-2.5-pro`, `agnes-2.5-pro-beta`                           | which upstream endpoint answers, and whether a real `messages` array with `temperature` / `max_tokens` is used; Agnes replies are badged _via Agnes AI_ |
| Image Studio                                                  | `flux-dev` (key-less) or any of `agnes-image-2.0-flash`, `agnes-image-2.1-flash`, `agnes-image-2.5-flash`, plus a `1K–4K` output tier and 8 aspect ratios              | synchronous 1-image call vs the documented `images/generations` body; an explicit Agnes id is never answered by `flux-dev`                              |
| Video Studio                                                  | `wan-2.2` (key-less, synchronous) or `agnes-video-2.5-flash` / `agnes-video-2.5`, with mode (`text` / `keyframe` / `reference`), `4–12s` duration, size tier and ratio | one long request vs a job id the browser polls; the billed model is labelled _billed_, the promo model _$0 promo_                                       |
| Explore models                                                | every catalogue entry with provider, capabilities, endpoint and its honest limitation                                                                                  | jump straight into the matching studio with that model preselected                                                                                      |

Everything outside that table is deliberately absent: `agnes-2.0-flash` is deprecated upstream and `agnes-3.0-pro` is
"coming soon", so neither appears in the catalogue; `width` / `height` / `fps` / `num_frames` / `quality` /
`num_inference_steps` are rejected by Agnes with a `400`, so Bliss never sends them; and no model claims vision,
streaming or video-to-video it does not have.

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
npm test               # 195 unit + integration + component tests
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npx playwright install && npm run test:e2e   # browser suite (desktop / iPhone / iPad)
```

## Environment variables

Bliss runs with **zero** configuration: the upstream is a free, key-less API and all user data lives in the browser.

| Variable            | Required | Default                          | Purpose                                                                                  |
| ------------------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `BLESS_API_BASE`    | No       | `https://cvron.alwaysdata.net`   | Override the upstream host (mirrors, self-hosted gateway)                                |
| `AGNES_API_KEY`     | No       | —                                | Enables the optional Agnes AI provider (chat, images, vision, video). **Server-only**    |
| `AGNES_CHAT_MODEL`  | No       | `agnes-2.5-flash`                | Which documented Agnes chat model answers the fallback (`agnes-3.0-flash` also accepted) |
| `AGNES_IMAGE_MODEL` | No       | `agnes-image-2.1-flash`          | Agnes model used for generation / editing when none is chosen                            |
| `AGNES_VIDEO_MODEL` | No       | `agnes-video-2.5-flash`          | Agnes model used for a video task when none is chosen                                    |
| `AGNES_BASE_URL`    | No       | `https://apihub.agnes-ai.com/v1` | Point the fallback at another OpenAI-compatible gateway                                  |
| `PORT`              | No       | `3000`                           | Listen port for `npm run start`                                                          |

Copy the template if you want to change anything:

```bash
cp .env.example .env.local
```

With nothing set there are **no secret values to protect**, and the app never reads a client-side `NEXT_PUBLIC_*` key,
so nothing can leak by accident. Adding `AGNES_API_KEY` is the only time a credential exists, and it is read on the
server only — set it as an encrypted Vercel environment variable and never as a `NEXT_PUBLIC_*` value.

## Architecture

```
src/
├─ app/
│  ├─ api/
│  │  ├─ chat/route.ts     POST  model allow-list → context adapter → upstream (timeout + retry)
│  │  ├─ image/route.ts    POST  generate | edit  (validated image_url)
│  │  ├─ video/route.ts    POST  WAN sync clip · Agnes async job (maxDuration 300s)
│  │  │                        GET   /api/video?jobId=…&model=…  one status poll, proxied
│  │  ├─ models/route.ts   GET   verified catalogue + limitations
│  │  └─ health/route.ts   GET   live probe of the upstream
│  ├─ layout.tsx           theme bootstrap, metadata, manifest, toaster
│  └─ page.tsx              workspace shell (chat / studios / saved / history / settings / API)
├─ lib/
│  ├─ api/config.ts         single source of truth for endpoints + models + limits (both providers)
│  ├─ api/fallback-env.ts   the ONLY reader of AGNES_API_KEY (server-guarded)
│  ├─ api/rate-limit.ts     shared per-IP fixed-window buckets (chat, video create, video poll)
│  ├─ api/agnes.ts          Agnes client: chat completions + image generations, payload validation
│  ├─ api/provider.ts       routing chain: primary → fallback, honest errors, message building
│  ├─ api/text.ts           LLM call, retry, response validation, payload parsing
│  ├─ api/media.ts          image / edit / video / host calls + strict URL validation
│  ├─ api/client.ts         timeout, JSON fetch, url + prompt validation
│  ├─ hooks/useModelCatalog.ts  runtime catalogue + fallback status (one /api/models call, shared)
│  ├─ store/                chatStore · savedStore · settingsStore (zustand + persist)
│  ├─ types/                shared domain types
│  └─ utils/                cn · title generation · relative time
└─ components/
   ├─ layout/               Sidebar · Logo · ThemeProvider
   ├─ chat/                 Composer · MessageList · MarkdownRenderer · ModelSelector · ContextPanel · WelcomeScreen · ProviderBadge
   ├─ image/                ImageStudio (generate + edit tabs, gallery, lightbox)
   ├─ video/                VideoStudio (engine + mode picker, task settings, progress, stop / keep watching)
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

Fallback provider (only reachable when `AGNES_API_KEY` is configured) — documented in
[agnes-ai.com/en/docs](https://www.agnes-ai.com/en/docs):

```http
POST https://apihub.agnes-ai.com/v1/chat/completions    Authorization: Bearer …
     { model: "agnes-2.5-flash", messages: [...], temperature: 0.7, max_tokens: 2048, stream: false }
     → { choices: [{ message: { role, content } }], usage }
POST https://apihub.agnes-ai.com/v1/images/generations
     { model: "agnes-image-2.1-flash", prompt, size: "1K", ratio?: "16:9",
       extra_body: { image?: [url…], response_format: "url" } }
     → { created, data: [{ url | b64_json }] }
POST https://apihub.agnes-ai.com/v1/videos
     { model: "agnes-video-2.5-flash", prompt, mode: "text" | "keyframe" | "reference",
       seconds: "8", size: "720P", aspect_ratio: "16:9", n: 1,
       first_frame?, last_frame?, images?[], audios?[], videos?: [{ url, start_seconds?, require_audio? }] }
     → { id, task_id, video_id, object: "video", status: "queued", progress, seconds, size }
GET  https://apihub.agnes-ai.com/agnesapi?video_id=…&model_name=…      (host root, not /v1)
     → { status: "queued" | "in_progress" | "completed" | "failed", progress, url, error? }
```

Verified against the docs and used exactly as published — `response_format` belongs inside `extra_body`, only
`data[0].url` is accepted (base64 output is rejected, not pasted into an `<img>`), video `seconds` is a _string_
(`"4"`–`"12"`), the status poll is a `GET` on the host root that needs `model_name`, only the top-level `url` is
read (`internal_*` fields are ignored), and every combination the provider answers with `400` is rejected locally
before a request is made.

Bliss's own routes:

```http
POST /api/chat     { model, prompt, history? }  → { success, response, model, answeredBy, provider, fallbackUsed }
POST /api/image    { mode, prompt, imageUrl?, model?, ratio?, size? } → { success, imageUrl, model, provider, fallbackUsed }
POST /api/video    { prompt, model?, imageUrl?, mode?, seconds?, size?, aspectRatio?, first/lastFrameUrl?, images?[], audios?[], referenceVideoUrl?, seed? }
                   → { success, async: false, videoUrl, model, provider }      (wan-2.2, synchronous)
                   → { success, async: true, jobId, model, provider, status, progress, pollIntervalMs, maxWaitMs }  (Agnes job)
GET  /api/video?jobId=…&model=…   → { success, jobId, status, progress, videoUrl?, error? }   (one poll, key stays server-side)
GET  /api/models   → verified catalogue (text · image · video) + limitations + fallback status
GET  /api/health   → live upstream probe + capability matrix + fallback status
```

Documented but intentionally **not** exposed in the product: `sslproxy.php`, `url-shortener.php`, `win-key.php`
(non-AI utilities that would not belong in this workspace).

## Honest limitations

These come straight from the provider's documentation and drive real product decisions:

1. **No streaming.** Responses arrive complete. The composer shows a _Thinking…_ indicator that reflects actual request
   state, and Stop discards the in-flight turn instead of faking a token stream.
2. **No native conversation context.** Every endpoint takes a single `prompt`. Bliss folds the last ≤8 turns into one
   prompt (`buildContextPrompt`), stays inside the documented length budget, keeps the newest turns when trimming, and
   strips any echoed `Assistant:` scaffold from the reply. It is context _construction_, not model memory.
3. **Image generation returns one image per call**, from `flux-dev` only, with hosted URLs that may expire. Bliss says
   "copy or download now" instead of promising permanent storage.
4. **Editing and video need a publicly reachable URL** — the endpoints accept URLs, never multipart uploads. Every
   upload-shaped control is therefore a URL field with the requirement stated inline.
5. **Video has two execution models, and the UI says which one you are in.** `wan22.php` is synchronous: no job id, no
   polling endpoint, no callback, so Bliss runs one long request (290s client cap, 300s route `maxDuration`) with a live
   elapsed timer and reports timeouts plainly. Agnes video is a real task: the route returns a `jobId` immediately and
   _the browser_ polls `GET /api/video?jobId=…` every 2s, so a serverless timeout can never strand a render —
   "Stop watching" detaches the tab without claiming the task was cancelled, and "Keep watching" resumes the same id.
6. **Free-tier reliability.** `cvron.alwaysdata.net` is rate-limited and occasionally offline. Bliss retries transient
   failures, never retries client errors, and surfaces a dismissible banner plus per-message inline errors when the
   upstream is unreachable. Configuring `AGNES_API_KEY` adds a _real_ second attempt — it does not hide the first one:
   the failure is still reported in the banner, and the answering provider is badged.
7. **Fallback breadth is intentionally narrow.** Chat, images, image analysis and asynchronous video. Agnes documents
   streaming and tool calling too, but Bliss renders complete answers and has no tool loop, so those are listed as
   "documented, unused" in the API Explorer rather than claimed in the UI. There is no cross-provider fallback for
   video: the two endpoints take different inputs, so a key-less failure stays a failure instead of becoming a guess.

## Security, privacy & abuse guards

- **No secrets exist** on the server by default. When `AGNES_API_KEY` is provided it is read in one guarded module,
  used only in route handlers, and never inlined into the client bundle (`src/lib/api/agnes.ts` is the only importer,
  and `src/lib/api/fallback-env.ts` returns an empty key whenever `window` is defined).
- **Model allow-list:** unknown `model` values are rejected with `400` before any outbound request.
- **SSRF-safe URL handling:** user-supplied image URLs must parse as `http:`/`https:` — `file:`, `javascript:` and
  friends are rejected. Bliss never fetches an arbitrary user URL server-side beyond the documented endpoints.
- **Body and prompt limits:** JSON parse guarded, 24 000-char message cap, 1 000-char image prompt cap, `413` on overflow.
- **Rate limiting** (`src/lib/api/rate-limit.ts`, per-IP fixed windows on `x-forwarded-for`): 20 chat requests,
  6 video _creations_ and 90 status polls per minute, with opportunistic bucket pruning so a long-lived container cannot
  leak memory. Pair with Vercel/KV or Upstash for multi-instance precision.
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
npm test                                  # 195 unit + integration + component tests
npm run build && npm run verify:fallback  # 34 end-to-end checks of the provider chain, offline
```

`npm run verify:fallback` boots the production build against a local stand-in that speaks the documented Agnes
contract (including `POST /v1/videos` validation and the `/agnesapi` status ladder) plus a dead primary host, and
asserts the real behaviour: provider attribution, `messages` vs digest, the `image_url` part, image retry payloads,
the video job create/poll pair, the rules the provider answers with `400`, and honest failures with no key. No
request ever leaves `127.0.0.1`.

195 tests across nine files:

| Suite                                  | Covers                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/api.test.ts`                | endpoint mapping, request construction, retry/no-retry policy, response validation, prompt & URL checks, title generation                                                                      |
| `test/unit/media.test.ts`              | image / edit / video / host parsing, HTML-error handling, nested payloads, non-http scheme rejection                                                                                           |
| `test/unit/stores.test.ts`             | conversation CRUD, pin/rename/delete, per-conversation model, search, `localStorage` persistence, saved library, context adapter                                                               |
| `test/unit/components.test.tsx`        | welcome screen, composer keys + attachment honesty, model selector, message actions, markdown/code safety, theme                                                                               |
| `test/integration/routes.test.ts`      | 27 tests: `POST /api/chat`, `/api/image`, `/api/video`, `/api/health` — allow-list, limits, rate limit, upstream outage, partial-outage honesty, context folding                               |
| `test/integration/agnes-video.test.ts` | 38 tests: every documented Agnes video rule (mode/media consistency, per-model sizes and ceilings, string seconds), task + status parsing, key containment, route policy and catalogue honesty |
| `test/integration/fallback.test.ts`    | 27 tests: the whole fallback chain — retry on outage, real `messages` vs digest, vision part, explicit-model routing, image fallback payloads, secret containment, honest 502s with no key     |
| `test/unit/fallback-ui.test.tsx`       | 15 tests: attribution badge, model picker labelling, composer vision hint, Image Studio model + tier chooser, Video Studio engine/mode picker, stop and resume watching                        |
| `test/e2e/app-flow.test.tsx`           | the full journey through the real component tree (14 steps, upstream mocked at the network boundary)                                                                                           |
| `e2e/bliss.spec.ts`                    | Playwright browser suite: desktop, iPhone 14, iPad portrait; overflow + drawer + persistence checks                                                                                            |

External HTTP is always mocked, so the suite is deterministic and never hits the free provider.

## Deployment

### Vercel (recommended)

```bash
npm i -g vercel
vercel            # link
vercel --prod
```

Already deployed: project **bliss-ai** → `https://bliss-ai-iota.vercel.app` (production alias) and
`https://bliss-ai-git-arena-b92fb736-bliss-obiorachibuikes-projects.vercel.app` (branch preview).
Function timeouts are declared in `vercel.json` (`/api/video` 300s, `/api/image` 300s, `/api/chat` 90s — the chat
budget covers the primary attempt _plus_ one fallback attempt).

To enable the fallback on Vercel:

```bash
vercel env add AGNES_API_KEY production   # encrypted; never a NEXT_PUBLIC_ value
```

Nothing else is required: no env vars, no database, no build command overrides. The project builds with
`next build` (Turbopack) and runs on the Node runtime; `/api/video` sets `maxDuration = 300`, so on Vercel's Hobby
plan those values are capped (long requests are cut off at the platform limit), so raise the timeout in
Settings → Functions if you use Video Studio there.

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
curl -s https://<host>/api/health | jq '.status, .services, .fallback'
curl -s https://<host>/api/models | jq '.text[].id, .fallback.enabled'
curl -s -X POST https://<host>/api/chat -H 'content-type: application/json' \
     -d '{"model":"llama","prompt":"Say OK"}' | jq '.success, .provider, .fallbackUsed, .response'
```

Expected: `status` is `operational` when the provider is up, `degraded-with-fallback` when the free tier is throttling
but a key is configured, and `degraded` when both are unavailable. Five model ids (four key-less + `agnes-2.5-flash`),
`fallback.enabled` reflecting the deployment's env, and either a real `response` (with `provider`/`fallbackUsed`
telling you who answered) or a clean `{ success: false, error }` — never a fabricated answer.

## Keyboard & accessibility

- `Enter` sends · `Shift + Enter` newline · `⌘/Ctrl + Enter` always sends (both honoured with `enterToSend` off)
- IME-safe: composition never submits a message
- Full keyboard navigation with visible blue focus rings, labelled icon-only buttons, `role="switch"` toggles
- Reduced-motion respected (all Bliss animations collapse to instant transitions)
- AA contrast in both themes; dark palette ships as default
- Mobile: drawer navigation, sticky composer that follows the on-screen keyboard, `100dvh` layout, no horizontal
  overflow at 360px, scrollable code blocks and tables

---

**Third-party services.** Bliss calls CVRON's free APIs, displays media hosted by that provider, and — when you
configure a key — calls the Agnes AI gateway. Prompts and pasted image URLs are transmitted to whichever provider
answers. Availability and rate limits are outside this project's control. Availability and rate limits are outside this project's control — which is exactly why
every failure path is user-visible and every unsupported capability is labelled rather than faked.
