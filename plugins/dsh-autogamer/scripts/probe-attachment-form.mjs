#!/usr/bin/env node
/**
 * G99 判别探针：一次只动一个变量 —— 同一端点、同一模型，只差 `image_url.url` 的形体。
 *
 * 背景：插件把设备截图作为 image 附件块返回（`attachmentId=sha256:…`、`mediaType=image/png`），
 * 宿主把它送进 `openai-completions` 请求后，本地提供方回
 * `400 "'url' field must be a base64 encoded image."`（`inputTokens=0` ⇒ 生成前即被拒）。
 * 「宿主没编码」当时只是最省事的可疑点。本探针把三种形体各发一次，用**唯一签名复现**来定论：
 *
 *   A 内容寻址引用 `sha256:<hex>`  ⇒ 期望复现现场那句（只有这一种能复现）
 *   B 裸 base64（无 `data:` 前缀）  ⇒ 期望另一个 400（`Invalid url.`）
 *   C `data:image/png;base64,…`    ⇒ 期望 200（形体本身被接受、图被视觉编码器吃掉）
 *
 * A 复现现场消息 + B/C 与之不同 ⇒ 「那次请求的 `url` 里放的确实是附件引用」，
 * 而官方 `docs/subsystems/attachment.zh.md` 写明模型可见附件块**绝不**含 base64 或提供方 URL、
 * 编码为请求形体是宿主侧 `readImageRequest()` 的职责 ⇒ 归因落在宿主，我方不改。
 *
 * 零依赖：PNG 自己生成（Node 内置 zlib），不读 `dist`，因此不需要先 build。
 *
 * 用法：
 *   node scripts/probe-attachment-form.mjs
 *   BASE=http://127.0.0.1:1234/v1 MODEL=qwen3.6-35b-a3b-mtp node scripts/probe-attachment-form.mjs
 *
 * 退出码：0 三形体读数与归因一致 / 1 判别塌了（结论不成立，须回台账更正）/
 * 2 前置没就绪（端点不可达）。
 */
import http from "node:http";
import zlib from "node:zlib";

const base = process.env.BASE ?? "http://127.0.0.1:1234/v1";
const model = process.env.MODEL ?? "qwen3.6-35b-a3b-mtp";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let k = n;
  for (let i = 0; i < 8; i += 1) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
  return k >>> 0;
});
function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, c]);
}
function solidPng(w, h) {
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (x * 4) & 0xff;
      raw[i + 1] = (y * 8) & 0xff;
      raw[i + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const b64 = solidPng(64, 64).toString("base64");
const FIELD_MESSAGE = "'url' field must be a base64 encoded image.";

const cases = [
  { id: "A", label: "attachment ref (the form the host sent)", url: `sha256:${"0".repeat(64)}`, want: 400 },
  { id: "B", label: "bare base64 (no data: prefix)", url: b64, want: 400 },
  { id: "C", label: "data:image/png;base64,…", url: `data:image/png;base64,${b64}`, want: 200 },
];

function post(path, payload) {
  // node:http with agent:false: no keep-alive handle left behind, so the exit code
  // is our own and not a libuv abort on Windows (measured: fetch + process.exit(1)
  // came back 127 with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`).
  return new Promise((resolve, reject) => {
    const target = new URL(base + path);
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        agent: false,
        headers: { "content-type": "application/json", "content-length": body.length },
      },
      (res) => {
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function ask(url) {
  const { status, text } = await post("/chat/completions", {
    model,
    max_tokens: 1,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "reply with the single word ok" },
          { type: "image_url", image_url: { url, detail: "auto" } },
        ],
      },
    ],
  });
  let msg = "";
  let promptTokens;
  try {
    const j = JSON.parse(text);
    const raw = j.error?.message ?? j.detail ?? j.message ?? j.error;
    if (raw) msg = typeof raw === "string" ? raw : JSON.stringify(raw);
    promptTokens = j.usage?.prompt_tokens;
  } catch {
    msg = text.slice(0, 160).replace(/\s+/g, " ");
  }
  return { status, msg, promptTokens };
}

const got = [];
for (const c of cases) {
  let r;
  try {
    r = await ask(c.url);
  } catch (err) {
    console.error(`probe-attachment-form: PRECONDITION - ${base} unreachable (${String(err?.cause?.code ?? err?.message ?? err)})`);
    process.exit(2);
  }
  got.push({ ...c, ...r });
  console.log(
    `${c.id} ${String(r.status).padEnd(3)} url.len=${String(c.url.length).padEnd(5)} want=${c.want} ` +
      `prompt_tokens=${r.promptTokens ?? "-"} ${r.msg.slice(0, 90)}  [${c.label}]`,
  );
}

const refReproducesField = got[0].status === 400 && got[0].msg === FIELD_MESSAGE;
const othersDiffer = got.slice(1).every((g) => g.msg !== FIELD_MESSAGE);
const shapesAccepted = got[2].status === 200;
const statusesAsWanted = got.every((g) => g.status === g.want);

if (refReproducesField && othersDiffer && shapesAccepted && statusesAsWanted) {
  console.log(
    "verdict: 归因成立 —— 只有 A（附件引用原样当 url）复现现场那句，B/C 给出不同读数，" +
      "正确的 data URL 被接受（含图形体本身没问题）。⇒ 未编码发生在宿主侧。",
  );
  process.exit(0);
}
console.log(
  `verdict: 判别塌了（A复现现场=${refReproducesField} 其余不撞同一句=${othersDiffer} ` +
    `data URL 被接受=${shapesAccepted} 三态如期望=${statusesAsWanted}）⇒ G99 的归因需回台账更正。`,
);
process.exit(1);
