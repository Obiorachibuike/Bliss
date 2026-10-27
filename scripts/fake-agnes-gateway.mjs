/* Local stand-in for the Agnes AI gateway, used only to verify Bliss' routing/parsing
 * end-to-end in this sandbox (network egress to the real host is blocked).
 * Shapes are copied from https://www.agnes-ai.com/en/docs model pages. */
import http from "node:http";
import fs from "node:fs";

const LOG = "/tmp/fake-agnes.log";
fs.writeFileSync(LOG, "");

/* Video tasks live in memory: id -> polls seen. The gateway walks the documented
 * status ladder (queued -> in_progress -> completed) so the client loop is exercised. */
const videoJobs = new Map();

const VIDEO_MODELS = ["agnes-video-2.5", "agnes-video-2.5-flash"];
const VIDEO_SIZES = {
  "agnes-video-2.5": ["720P", "1080P", "1K", "2K"],
  "agnes-video-2.5-flash": ["720P"],
};
const VIDEO_RATIOS = ["16:9", "21:9", "4:3", "1:1", "3:4", "9:16"];
/* Documented rejections: the provider answers HTTP 400 for any of these. */
const FORBIDDEN_VIDEO_FIELDS = [
  "width",
  "height",
  "fps",
  "num_frames",
  "quality",
  "num_inference_steps",
  "video_url",
  "video_path",
  "video_reference",
  "input_reference",
  "reference_url",
];

function validateVideoRequest(body) {
  if (!body || typeof body !== "object") return "expected a JSON body";
  const model = String(body.model ?? "");
  if (!VIDEO_MODELS.includes(model))
    return `unknown model ${model || "(missing)"}`;
  if (typeof body.prompt !== "string" || !body.prompt.trim())
    return "prompt is required";
  const mode = String(body.mode ?? "text");
  if (!["text", "keyframe", "reference"].includes(mode))
    return `unknown mode ${mode}`;
  for (const field of FORBIDDEN_VIDEO_FIELDS) {
    if (body[field] !== undefined) return `${field} is not supported`;
  }
  if (
    typeof body.size !== "string" ||
    !VIDEO_SIZES[model].includes(body.size)
  ) {
    return `size must be one of ${VIDEO_SIZES[model].join("|")}`;
  }
  if (
    body.aspect_ratio !== undefined &&
    !VIDEO_RATIOS.includes(String(body.aspect_ratio))
  ) {
    return `aspect_ratio ${body.aspect_ratio} is not supported`;
  }
  if (
    typeof body.seconds !== "string" ||
    !/^(?:[4-9]|1[0-2])$/.test(body.seconds)
  ) {
    return "seconds must be a string between 4 and 12";
  }
  if (body.n !== undefined && body.n !== 1) return "n must be 1";
  const images = Array.isArray(body.images) ? body.images : [];
  const audios = Array.isArray(body.audios) ? body.audios : [];
  const videos = Array.isArray(body.videos) ? body.videos : [];
  const frames = [body.first_frame, body.last_frame].filter(
    (v) => typeof v === "string" && v.trim(),
  ).length;
  if (
    mode === "text" &&
    (images.length || audios.length || videos.length || frames)
  )
    return "text mode takes a prompt only";
  if (mode === "keyframe" && (images.length || audios.length || videos.length))
    return "keyframe mode takes first_frame/last_frame only";
  if (mode === "keyframe" && frames < 1)
    return "keyframe mode needs at least one frame";
  if (
    mode === "reference" &&
    !(images.length || audios.length || videos.length)
  )
    return "reference mode needs at least one media url";
  if (frames && mode !== "keyframe")
    return "first_frame/last_frame require keyframe mode";
  const maxImages = model === "agnes-video-2.5" ? 8 : 5;
  if (images.length > maxImages) return `at most ${maxImages} reference images`;
  if (audios.length > 3) return "at most 3 reference audios";
  if (videos.length > (model === "agnes-video-2.5" ? 1 : 0))
    return "reference videos require agnes-video-2.5";
  if (images.length + audios.length + videos.length > 12)
    return "at most 12 media files";
  return null;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const entry = {
      url: req.url,
      method: req.method,
      auth: req.headers.authorization ?? null,
      body: body ? JSON.parse(body) : null,
    };
    fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");

    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/chat/completions")) {
      const last = Array.isArray(entry.body?.messages)
        ? entry.body.messages[entry.body.messages.length - 1]
        : null;
      const hasImage =
        Array.isArray(last?.content) &&
        last.content.some((p) => p.type === "image_url");
      res.end(
        JSON.stringify({
          id: "chatcmpl_local",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: entry.body?.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: hasImage
                  ? "I can see the image: a blue square on a white background. (local gateway)"
                  : "Fallback answer from the local Agnes stand-in.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        }),
      );
      return;
    }
    if (req.url?.endsWith("/images/generations")) {
      const isEdit =
        Array.isArray(entry.body?.extra_body?.image) &&
        entry.body.extra_body.image.length > 0;
      res.end(
        JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [
            {
              url: `https://cdn.local/${isEdit ? "edited" : "generated"}-${entry.body?.ratio ?? "1x1"}.png`,
              b64_json: null,
              revised_prompt: null,
            },
          ],
        }),
      );
      return;
    }
    if (req.url?.startsWith("/v1/videos") && req.method === "POST") {
      const problem = validateVideoRequest(entry.body);
      if (problem) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: problem, code: 400 } }));
        return;
      }
      const videoId = `video_${(videoJobs.size + 1).toString().padStart(4, "0")}`;
      videoJobs.set(videoId, { polls: 0, model: entry.body.model });
      res.end(
        JSON.stringify({
          id: `task_${(videoJobs.size + 1).toString().padStart(4, "0")}`,
          task_id: `task_${(videoJobs.size + 1).toString().padStart(4, "0")}`,
          video_id: videoId,
          object: "video",
          model: entry.body.model,
          status: "queued",
          progress: 0,
          created_at: Math.floor(Date.now() / 1000),
          seconds: entry.body.seconds,
          size: entry.body.size,
        }),
      );
      return;
    }
    if (req.url?.startsWith("/agnesapi")) {
      const url = new URL(req.url, "http://127.0.0.1");
      const videoId = url.searchParams.get("video_id") ?? "";
      const modelName = url.searchParams.get("model_name") ?? "";
      // Keyframe/reference polling is only defined with model_name present.
      if (!videoId || !modelName) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: { message: "video_id and model_name are both required" },
          }),
        );
        return;
      }
      const job = videoJobs.get(videoId);
      if (!job) {
        res.statusCode = 404;
        res.end(
          JSON.stringify({ error: { message: `unknown video_id ${videoId}` } }),
        );
        return;
      }
      job.polls += 1;
      if (job.polls < 2) {
        res.end(
          JSON.stringify({
            status: "in_progress",
            progress: 35,
            url: null,
            error: null,
            internal_index: job.polls,
          }),
        );
        return;
      }
      if (job.polls === 2) {
        res.end(
          JSON.stringify({
            status: "in_progress",
            progress: 70,
            url: null,
            error: null,
            internal_index: job.polls,
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          status: "completed",
          progress: 100,
          url: `https://cdn.local/agnes-${videoId}.mp4`,
          error: null,
          internal_unused: "must be ignored by the client",
          model: job.model,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(
      JSON.stringify({ error: { message: `unhandled path ${req.url}` } }),
    );
  });
});

server.listen(4599, "127.0.0.1", () =>
  console.log("fake agnes listening on 4599"),
);
