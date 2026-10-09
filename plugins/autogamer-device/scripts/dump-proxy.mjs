/**
 * Logging proxy for LLM spike debugging: 127.0.0.1:1235 -> 127.0.0.1:1234.
 * Dumps each request body and response status/head to spike/proxy-dump.log,
 * then streams the response back untouched.
 */
import http from "node:http";
import { appendFileSync } from "node:fs";

const LOG = new URL("./proxy-dump.log", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TARGET = { host: "127.0.0.1", port: 1234 };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    appendFileSync(LOG, `\n===== ${new Date().toISOString()} ${req.method} ${req.url} =====\n${body.slice(0, 400_000)}\n----- response -----\n`);

    const upstream = http.request(
      { host: TARGET.host, port: TARGET.port, path: req.url, method: req.method, headers: { ...req.headers, host: `${TARGET.host}:${TARGET.port}` } },
      (upstreamRes) => {
        appendFileSync(LOG, `status=${upstreamRes.statusCode}\n`);
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        let preview = "";
        upstreamRes.on("data", (piece) => {
          preview += piece.toString("utf8");
          if (preview.length > 40_000) {
            appendFileSync(LOG, `${preview.slice(0, 40_000)}\n...[truncated]\n`);
            preview = "";
          }
        });
        upstreamRes.on("end", () => {
          if (preview.length > 0) appendFileSync(LOG, `${preview}\n`);
        });
      },
    );
    upstream.on("error", (error) => {
      appendFileSync(LOG, `upstream error: ${error.message}\n`);
      res.writeHead(502);
      res.end(String(error));
    });
    upstream.end(body.length > 0 ? body : undefined);
  });
});

server.listen(1235, "127.0.0.1", () => console.log("[proxy] listening on 127.0.0.1:1235 -> 1234"));
