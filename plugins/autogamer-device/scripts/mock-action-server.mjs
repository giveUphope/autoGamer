/**
 * Dependency-free MCP stdio action server returning canned success for
 * every tool (S10 spike: isolates model-dispatch behavior from device
 * availability). Line-delimited JSON-RPC over stdio.
 */
import { createInterface } from "node:readline";

const TOOLS = [
  "tap", "long_press_on", "swipe", "back", "launch_app", "stop_app",
  "open_link", "focus_and_input_text", "focus_and_clear_text",
  "erase_one_char", "press_key", "take_screenshot", "get_ui_hierarchy",
  "compare_ui_frames", "list_devices",
];

/**
 * list_devices mirrors artemis/runtime/device_pool.DeviceStatus.to_dict() key for key (G64),
 * because the pool reads those fields to decide eligibility. Emitting anything else here would be
 * inventing contract -- the mistake changelogs #51 records for `ratio`.
 * MOCK_ENUM=failed models "could not ask adb", which must stay distinct from an empty fleet.
 */
const ROSTER = ["mock-device"];
const DEVICE_STATUS_KEYS = [
  "serial", "state", "model", "product", "is_emulator", "is_busy",
  "active_pid", "active_task_desc", "active_session_id", "acquired_at",
];

function listDevicesPayload(includeLockState) {
  const enumerated = process.env.MOCK_ENUM !== "failed";
  // MOCK_LOCK picks the Keyguard verdict when the caller asked for one: "locked",
  // "unknown" (null, which must fail closed downstream) or the default "open".
  const lockMode = process.env.MOCK_LOCK ?? "open";
  const isLocked = lockMode === "locked" ? true : lockMode === "unknown" ? null : false;
  const devices = enumerated
    ? ROSTER.map((serial) => ({
        serial,
        state: "device",
        model: null,
        product: null,
        is_emulator: true,
        is_busy: false,
        active_pid: null,
        active_task_desc: null,
        active_session_id: null,
        acquired_at: null,
        // Asked -> the key is present (null allowed). Not asked -> the key is absent entirely;
        // py's admission reads those two differently (G65).
        ...(includeLockState === true ? { is_locked: isLocked } : {}),
      }))
    : [];
  for (const device of devices) {
    const expected = DEVICE_STATUS_KEYS.length + (includeLockState === true ? 1 : 0);
    if (Object.keys(device).length !== expected) {
      throw new Error("mock list_devices payload drifted from DeviceStatus.to_dict()");
    }
  }
  return JSON.stringify({ enumerated, devices });
}

/**
 * take_screenshot answers a real PNG header (1080x2400 IHDR) so the plugin's
 * screenshot probe resolves dimensions and the 0-1000 → pixel path is
 * testable live without a device. Everything else keeps the legacy text.
 */
const SCREENSHOT_PNG = (() => {
  const bytes = Buffer.alloc(33);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((b, i) => {
    bytes[i] = b;
  });
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1080, 16);
  bytes.writeUInt32BE(2400, 20);
  return bytes.toString("base64");
})();

/**
 * compare_ui_frames answers in the py action surface's own shape (G39 route A):
 * `json.dumps({"changed": changed})` and nothing else -- adb_server.py emits exactly that one
 * key, so a stub carrying an extra field would be inventing contract (changelogs #51).
 * MOCK_EFFECT picks the verdict so the offline drill can exercise both branches and the
 * refusal path (`Error:` prefix) without a device.
 */
const effectVerdict = () => {
  const mode = process.env.MOCK_EFFECT ?? "changed";
  if (mode === "error") return "Error: mock refusing to compare frames";
  return JSON.stringify({ changed: mode !== "unchanged" });
};

function mockText(toolName, toolArgs) {
  if (toolName === "take_screenshot") return SCREENSHOT_PNG;
  if (toolName === "compare_ui_frames") return effectVerdict();
  if (toolName === "list_devices") return listDevicesPayload(toolArgs?.include_lock_state === true);
  return "Success";
}

function handle(message) {
  if (message === undefined || typeof message !== "object") return undefined;
  const { id, method, params } = message;
  if (id === undefined) return undefined; // notification
  // Every response carries the JSON-RPC version marker: the MCP SDK parses
  // each line with JSONRPCMessageSchema (jsonrpc: literal "2.0") and only
  // skips SyntaxErrors — a valid-JSON reply without this field throws out of
  // the reader and the pending request dies as "SdkError: Request timed out"
  // (G56). The real py server gets the field from the official SDK.
  const frame = { jsonrpc: "2.0" };
  switch (method) {
    case "initialize":
      return {
        ...frame,
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-action-server", version: "0.1.0" },
        },
      };
    case "tools/list":
      return {
        ...frame,
        id,
        result: {
          tools: TOOLS.map((name) => ({
            name,
            description: `mock ${name}`,
            inputSchema: { type: "object", properties: {} },
          })),
        },
      };
    case "tools/call": {
      const name = params?.name ?? "unknown";
      console.error(`[mock] tools/call ${name} ${JSON.stringify(params?.arguments ?? {})}`);
      const delay = Number(process.env.MOCK_DELAY_MS ?? 0);
      if (delay <= 0) {
        return { ...frame, id, result: { content: [{ type: "text", text: mockText(name, params?.arguments) }] } };
      }
      // Async reply after the delay: exercises gate blocking and concurrent
      // turns (S10-③) without a real device.
      setTimeout(() => {
        write({ ...frame, id, result: { content: [{ type: "text", text: mockText(name, params?.arguments) }] } });
      }, delay);
      return undefined;
    }
    case "ping":
      return { ...frame, id, result: {} };
    default:
      return { ...frame, id, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

const write = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const lineReader = createInterface({ input: process.stdin });
lineReader.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  try {
    const response = handle(JSON.parse(trimmed));
    if (response !== undefined) write(response);
  } catch (error) {
    console.error(`[mock] bad line: ${error.message}`);
  }
});
console.error("[mock] action server ready");
