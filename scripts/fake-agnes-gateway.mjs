/* Local stand-in for the Agnes AI gateway, used only to verify Bliss' routing/parsing
 * end-to-end in this sandbox (network egress to the real host is blocked).
 * Shapes are copied from https://www.agnes-ai.com/en/docs model pages. */
import http from "node:http";
import fs from "node:fs";

const LOG = "/tmp/fake-agnes.log";
fs.writeFileSync(LOG, "");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const entry = { url: req.url, method: req.method, auth: req.headers.authorization ?? null, body: body ? JSON.parse(body) : null };
    fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");

    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/chat/completions")) {
      const last = Array.isArray(entry.body?.messages) ? entry.body.messages[entry.body.messages.length - 1] : null;
      const hasImage = Array.isArray(last?.content) && last.content.some((p) => p.type === "image_url");
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
        })
      );
      return;
    }
    if (req.url?.endsWith("/images/generations")) {
      const isEdit = Array.isArray(entry.body?.extra_body?.image) && entry.body.extra_body.image.length > 0;
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
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: `unhandled path ${req.url}` } }));
  });
});

server.listen(4599, "127.0.0.1", () => console.log("fake agnes listening on 4599"));
