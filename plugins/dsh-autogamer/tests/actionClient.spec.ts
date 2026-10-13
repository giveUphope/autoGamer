/**
 * ActionClient lifecycle: a failed connect must not poison later calls.
 * `ensure()` caches the starting promise, so a rejected start has to clear
 * the cache — otherwise every later call rethrows the same stale connection
 * error instead of respawning the server (found via the G33 guard tests: the
 * second spawn attempt surfaced a stale "Connection closed").
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionClient } from "../src/actionClient.js";

let dirs: string[] = [];
let clients: ActionClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.dispose().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function countFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "g33-respawn-"));
  dirs.push(dir);
  const file = join(dir, "spawns.txt");
  writeFileSync(file, "");
  return { dir, file };
}

describe("ActionClient respawn", () => {
  it("respawns the server after a failed connect instead of replaying the stale error", async () => {
    const { file } = countFile();
    const client = new ActionClient({
      // Exits at once: the handshake never completes, so connect() rejects.
      command: [
        process.execPath,
        "-e",
        "require('fs').appendFileSync(process.env.G33_COUNT_FILE, 'x'); process.exit(1)",
      ],
      env: { G33_COUNT_FILE: file },
      callTimeoutMs: 5_000,
    });
    clients.push(client);

    await expect(client.callTool("back", {})).rejects.toThrow();
    await expect(client.callTool("back", {})).rejects.toThrow();
    // Two spawns, not one spawn plus a cached rejection.
    expect(readFileSync(file, "utf8")).toBe("xx");
  });
});
