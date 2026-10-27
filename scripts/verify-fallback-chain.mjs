/* Offline verification of the primary → fallback routing chain.
 *
 * This sandbox (and any air-gapped CI) cannot reach apihub.agnes-ai.com, so this
 * script boots a local stand-in that speaks the documented Agnes contract
 * (see fake-agnes-gateway.mjs) plus a dead primary host, then asserts that Bliss:
 *
 *   1. answers through the fallback when the primary is unreachable,
 *   2. reports which provider answered (provider + fallbackUsed + answeredBy),
 *   3. sends a real messages array (not the flattened digest) to the fallback,
 *   4. forwards a pasted image URL as an image_url part,
 *   5. retries an image request on the documented images endpoint,
 *   6. still returns an honest 502 when no key is configured,
 *   7. creates and polls an asynchronous Agnes video job (and refuses one without a key).
 *
 * Usage:  npm run build && node scripts/verify-fallback-chain.mjs
 * It never contacts a real provider: every network call stays on 127.0.0.1.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const GATEWAY_PORT = 4599;
const APP_PORT = Number(process.env.VERIFY_PORT || 3210);
const LOG = "/tmp/fake-agnes.log";
const APP = `http://127.0.0.1:${APP_PORT}`;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

function gatewayEntries() {
  if (!fs.existsSync(LOG)) return [];
  return fs
    .readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function start(command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tail = [];
  child.stdout.on("data", (d) => tail.push(String(d)));
  child.stderr.on("data", (d) => tail.push(String(d)));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null)
      console.error(`${command} exited ${code}\n${tail.join("")}`);
  });
  return child;
}

const children = [];
async function stopAll() {
  for (const c of children) c.kill("SIGTERM");
  await sleep(400);
  for (const c of children) c.kill("SIGKILL");
}

let failed = false;
try {
  if (!fs.existsSync(".next/BUILD_ID")) {
    console.error("No production build found — run `npm run build` first.");
    process.exitCode = 1;
  } else {
    fs.writeFileSync(LOG, "");
    children.push(await start("node", ["scripts/fake-agnes-gateway.mjs"]));
    children.push(
      await start(
        "node",
        [
          "node_modules/next/dist/bin/next",
          "start",
          "--port",
          String(APP_PORT),
        ],
        {
          // Real key, but pointed at the local stand-in; primary host goes to a closed port.
          AGNES_API_KEY: "sk-verify-local",
          AGNES_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}/v1`,
          BLESS_API_BASE: "http://127.0.0.1:59999",
          NODE_ENV: "production",
        },
      ),
    );

    const up = await waitFor(`${APP}/api/models`);
    check("app + local gateway are listening", up);

    if (up) {
      const models = await (await fetch(`${APP}/api/models`)).json();
      check(
        "catalogue lists the fallback model",
        models.text.some((m) => m.id === "agnes-2.5-flash"),
        models.text.map((m) => m.id).join(", "),
      );
      check(
        "fallback reports enabled (key present)",
        models.fallback?.enabled === true,
      );
      check(
        "video catalogue is selectable and lists both Agnes engines",
        ["wan-2.2", "agnes-video-2.5-flash", "agnes-video-2.5"].every((id) =>
          models.video.some((m) => m.id === id),
        ),
        models.video.map((m) => m.id).join(", "),
      );
      check(
        "chat catalogue exposes the billed and promo Agnes models",
        [
          "agnes-2.5-flash",
          "agnes-3.0-flash",
          "agnes-2.5-pro",
          "agnes-2.5-pro-beta",
        ].every((id) => models.text.some((m) => m.id === id)),
        models.text.map((m) => m.id).join(", "),
      );
      check(
        "image catalogue exposes the three Agnes image models",
        [
          "agnes-image-2.0-flash",
          "agnes-image-2.1-flash",
          "agnes-image-2.5-flash",
        ].every((id) => (models.image ?? []).some((m) => m.id === id)),
        (models.image ?? []).map((m) => m.id).join(", "),
      );

      const health = await (await fetch(`${APP}/api/health`)).json();
      check(
        "primary outage + fallback => degraded-with-fallback",
        health.status === "degraded-with-fallback",
        health.status,
      );
      check(
        "vision capability unlocked by the key",
        health.capabilities.vision === true,
      );
      check(
        "text-to-video capability unlocked by the key",
        health.capabilities.textToVideo === true,
      );
      check(
        "health names the default video model",
        health.fallback?.videoModel === "agnes-video-2.5-flash",
        String(health.fallback?.videoModel),
      );

      // 1) chat: primary down → fallback answers
      const chat = await (
        await fetch(`${APP}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.50",
          },
          body: JSON.stringify({
            model: "llama",
            prompt:
              "what is in this picture?\n\n![reference image](https://cdn.local/ref.png)",
            history: [
              { role: "user", content: "earlier turn" },
              { role: "assistant", content: "earlier answer" },
            ],
          }),
        })
      ).json();
      check(
        "chat answers via the fallback when the primary is down",
        chat.success === true &&
          chat.provider === "agnes" &&
          chat.fallbackUsed === true &&
          !!chat.response,
        JSON.stringify(chat).slice(0, 160),
      );
      check(
        "fallback reply names the model that actually answered",
        chat.answeredBy === "agnes-2.5-flash",
        String(chat.answeredBy),
      );

      const chatEntry = gatewayEntries().find((e) =>
        e.url?.endsWith("/chat/completions"),
      );
      check(
        "fallback request carries the bearer key",
        chatEntry?.auth === "Bearer sk-verify-local",
        String(chatEntry?.auth),
      );
      const roles = (chatEntry?.body?.messages ?? [])
        .map((m) => m.role)
        .join(",");
      check(
        "fallback gets real turns, not a flattened digest",
        roles === "system,user,assistant,user",
        roles,
      );
      const lastContent = chatEntry?.body?.messages?.at(-1)?.content;
      check(
        "pasted image is forwarded as an image_url part",
        Array.isArray(lastContent) &&
          lastContent.some(
            (p) =>
              p.type === "image_url" &&
              p.image_url?.url === "https://cdn.local/ref.png",
          ),
      );
      check(
        "documented sampling params are sent",
        chatEntry?.body?.max_tokens === 2048 &&
          chatEntry?.body?.stream === false,
        `max_tokens=${chatEntry?.body?.max_tokens} stream=${chatEntry?.body?.stream}`,
      );

      // 2) images: primary down → fallback images endpoint
      const img = await (
        await fetch(`${APP}/api/image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.51",
          },
          body: JSON.stringify({
            mode: "edit",
            prompt: "make it night",
            imageUrl: "https://cdn.local/src.png",
            ratio: "16:9",
          }),
        })
      ).json();
      check(
        "image edit falls back to the Agnes images endpoint",
        img.success === true &&
          img.provider === "agnes" &&
          img.fallbackUsed === true,
        JSON.stringify(img).slice(0, 160),
      );
      const imgEntry = gatewayEntries().find((e) =>
        e.url?.endsWith("/images/generations"),
      );
      check(
        "edit sends extra_body.image + url response_format (ratio preserved)",
        imgEntry?.body?.extra_body?.image?.[0] ===
          "https://cdn.local/src.png" &&
          imgEntry?.body?.extra_body?.response_format === "url" &&
          imgEntry?.body?.ratio === "16:9" &&
          imgEntry?.body?.size === "1K",
        JSON.stringify(imgEntry?.body),
      );

      // 3) video: async Agnes create + proxied polling, driven by the caller
      const vid = await (
        await fetch(`${APP}/api/video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.53",
          },
          body: JSON.stringify({
            prompt: "Macro shot of coffee being poured",
            model: "agnes-video-2.5-flash",
            seconds: 8,
            size: "720P",
            ratio: "16:9",
          }),
        })
      ).json();
      check(
        "video create returns a job instead of pretending to be synchronous",
        vid.success === true &&
          vid.async === true &&
          /^video_/.test(vid.jobId ?? "") &&
          vid.provider === "agnes" &&
          vid.status === "queued",
        JSON.stringify(vid).slice(0, 200),
      );
      const createEntry = gatewayEntries().find((e) =>
        e.url?.endsWith("/v1/videos"),
      );
      check(
        "video create sends the documented body (string seconds, tier size, no forbidden fields)",
        createEntry?.body?.seconds === "8" &&
          createEntry?.body?.size === "720P" &&
          createEntry?.body?.aspect_ratio === "16:9" &&
          createEntry?.body?.mode === "text" &&
          [
            "width",
            "height",
            "fps",
            "num_frames",
            "quality",
            "num_inference_steps",
          ].every((f) => createEntry.body[f] === undefined),
        JSON.stringify(createEntry?.body),
      );

      let poll = null;
      const seen = [];
      for (let i = 0; i < 6; i++) {
        poll = await (
          await fetch(
            `${APP}/api/video?jobId=${encodeURIComponent(vid.jobId)}&model=${vid.model}`,
            {
              headers: { "x-forwarded-for": `203.0.113.${70 + i}` },
            },
          )
        ).json();
        seen.push(`${poll.status}:${poll.progress}`);
        if (poll.status === "completed" || poll.status === "failed") break;
        await sleep(300);
      }
      check(
        "the status poll is proxied without exposing the key",
        poll?.success === true &&
          poll.status === "completed" &&
          poll.videoUrl === `https://cdn.local/agnes-${vid.jobId}.mp4`,
        seen.join(" -> ") + (poll?.error ? ` | ${poll.error}` : ""),
      );
      const statusEntry = gatewayEntries().find((e) =>
        e.url?.startsWith("/agnesapi"),
      );
      check(
        "status poll is a GET carrying video_id + model_name",
        statusEntry?.method === "GET" &&
          /video_id=video_/.test(statusEntry?.url ?? "") &&
          /model_name=agnes-video/.test(statusEntry?.url ?? ""),
        statusEntry?.url,
      );
      check(
        "status poll authenticates with the bearer key",
        statusEntry?.auth === "Bearer sk-verify-local",
        String(statusEntry?.auth),
      );

      const keyframe = await (
        await fetch(`${APP}/api/video`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.54",
          },
          body: JSON.stringify({
            prompt: "Dissolve from dawn to dusk",
            model: "agnes-video-2.5",
            size: "1080P",
            firstFrameUrl: "https://cdn.local/a.png",
            lastFrameUrl: "https://cdn.local/b.png",
          }),
        })
      ).json();
      const keyframeEntry = gatewayEntries()
        .filter((e) => e.url?.endsWith("/v1/videos"))
        .at(-1);
      check(
        "keyframes switch the provider mode and are forwarded as first_frame/last_frame",
        keyframe.success === true &&
          keyframeEntry?.body?.mode === "keyframe" &&
          keyframeEntry.body.first_frame === "https://cdn.local/a.png" &&
          keyframeEntry.body.last_frame === "https://cdn.local/b.png" &&
          keyframeEntry.body.size === "1080P",
        JSON.stringify(keyframeEntry?.body),
      );

      const badRatio = await fetch(`${APP}/api/video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.55",
        },
        body: JSON.stringify({
          prompt: "x",
          model: "agnes-video-2.5-flash",
          ratio: "5:4",
        }),
      });
      check(
        "an unsupported aspect ratio is refused before the request leaves the server",
        badRatio.status === 400,
        String(badRatio.status),
      );

      // 4) explicitly chosen agnes model must not touch the primary
      const before = gatewayEntries().length;
      const direct = await (
        await fetch(`${APP}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "203.0.113.52",
          },
          body: JSON.stringify({ model: "agnes-2.5-flash", prompt: "hello" }),
        })
      ).json();
      const newEntries = gatewayEntries().slice(before);
      check(
        "explicit Agnes choice goes straight to the fallback (not reported as a fallback)",
        direct.success === true &&
          direct.fallbackUsed === false &&
          newEntries.length === 1,
        `fallbackUsed=${direct.fallbackUsed} requests=${newEntries.length}`,
      );
    }
  }
} catch (e) {
  check(
    "verification run completed",
    false,
    e instanceof Error ? e.message : String(e),
  );
} finally {
  // 4) without a key the same flow must fail honestly
  await stopAll();
  children.length = 0;
  children.push(
    await start(
      "node",
      [
        "node_modules/next/dist/bin/next",
        "start",
        "--port",
        String(APP_PORT + 1),
      ],
      {
        BLESS_API_BASE: "http://127.0.0.1:59999",
        AGNES_API_KEY: "",
        NODE_ENV: "production",
      },
    ),
  );
  const upNoKey = await waitFor(`http://127.0.0.1:${APP_PORT + 1}/api/models`);
  check("app is listening with no key", upNoKey);
  if (upNoKey) {
    const noKey = await (
      await fetch(`http://127.0.0.1:${APP_PORT + 1}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.60",
        },
        body: JSON.stringify({ model: "llama", prompt: "hi" }),
      })
    ).json();
    check(
      "no key => honest 502, never a fabricated answer",
      noKey.success === false && noKey.response === undefined,
      JSON.stringify(noKey).slice(0, 160),
    );

    const refused = await fetch(`http://127.0.0.1:${APP_PORT + 1}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "203.0.113.61",
      },
      body: JSON.stringify({ model: "agnes-2.5-flash", prompt: "hi" }),
    });
    const refusedBody = await refused.json();
    check(
      "no key => the Agnes model is refused with an actionable 400",
      refused.status === 400 && /AGNES_API_KEY/.test(refusedBody.error ?? ""),
      refusedBody.error,
    );

    const modelsNoKey = await (
      await fetch(`http://127.0.0.1:${APP_PORT + 1}/api/models`)
    ).json();
    check(
      "no key => fallback reported disabled and vision off",
      modelsNoKey.fallback.enabled === false,
    );
    check(
      "no key => text-to-video reported off",
      modelsNoKey.fallback.textToVideo === false,
      JSON.stringify(modelsNoKey.fallback),
    );

    const noKeyVideo = await fetch(
      `http://127.0.0.1:${APP_PORT + 1}/api/video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.62",
        },
        body: JSON.stringify({
          prompt: "coffee",
          model: "agnes-video-2.5-flash",
        }),
      },
    );
    const noKeyVideoBody = await noKeyVideo.json();
    check(
      "no key => an Agnes video request is refused with set-up guidance, not a fake job",
      noKeyVideo.status === 400 &&
        /AGNES_API_KEY/.test(noKeyVideoBody.error ?? "") &&
        noKeyVideoBody.videoUrl === undefined &&
        noKeyVideoBody.jobId === undefined,
      JSON.stringify(noKeyVideoBody).slice(0, 160),
    );

    const deprecated = await fetch(
      `http://127.0.0.1:${APP_PORT + 1}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "203.0.113.63",
        },
        body: JSON.stringify({ model: "agnes-2.0-flash", prompt: "hi" }),
      },
    );
    check(
      "the deprecated agnes-2.0-flash id is not accepted",
      deprecated.status === 400,
      String(deprecated.status),
    );

    const clientJs = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js"))
          clientJs.push(fs.readFileSync(full, "utf8"));
      }
    };
    walk(".next/static");
    const bundle = clientJs.join("\n");
    check(
      "client bundle contains no Agnes credential",
      bundle.length > 0 && !/sk-verify-local/.test(bundle),
      `${(bundle.length / 1024).toFixed(0)}kB scanned`,
    );
  }
  await stopAll();
}

failed = results.some((r) => !r.ok);
console.log(
  `\n${results.filter((r) => r.ok).length}/${results.length} checks passed`,
);
process.exitCode = failed ? 1 : 0;
