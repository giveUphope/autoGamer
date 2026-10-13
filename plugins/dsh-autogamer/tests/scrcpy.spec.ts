/**
 * Mirror manager unit locks (Phase 4). adb/scrcpy never run here: a scripted
 * runner records argv in order, the filesystem is a map, and launch is a
 * recorded spawn. Device-side command shapes are locked against scrcpy's own
 * developer doc (push/forward/app_process + exact-match version + key=value
 * options); the stop-path pkill stays marked best-effort in the source.
 */
import { describe, expect, it } from "vitest";
import {
  buildForwardArgs,
  buildLaunchArgs,
  buildPushArgs,
  buildUnforwardArgs,
  ScrcpyManager,
  type ScrcpyDeps,
} from "../src/scrcpy/server.js";
import { toAdbInputArgs } from "../src/scrcpy/input.js";
import type { ExecResult } from "../src/env/preflight.js";

function scripted(options?: {
  runs?: Record<string, ExecResult>;
  files?: Record<string, boolean>;
  dirs?: Record<string, string[]>;
  binaries?: Record<string, string>;
}): { spawned: string[][]; calls: string[][]; deps: ScrcpyDeps } {
  const spawned: string[][] = [];
  const calls: string[][] = [];
  return {
    spawned,
    calls,
    deps: {
      run: async (command: string[]) => {
        calls.push(command);
        return (
          options?.runs?.[command.join(" ")] ?? { code: 0, stdout: "", stderr: "" }
        );
      },
      spawnDetached: (command: string[]) => {
        spawned.push(command);
      },
      exists: (path: string) => options?.files?.[path] ?? false,
      listDir: (path: string) => options?.dirs?.[path] ?? [],
      which: (binary: string) => options?.binaries?.[binary],
    },
  };
}

const MIRROR = { maxWidth: 1080, maxFps: 30, bitrateMbps: 4 };

describe("mirror: server resolution refuses before it guesses", () => {
  it("takes an explicit versioned jar", async () => {
    const { deps } = scripted({ files: { "/srv/scrcpy-server-v3.1.jar": true } });
    const manager = new ScrcpyManager({ ...MIRROR, serverPath: "/srv/scrcpy-server-v3.1.jar" }, deps);
    expect(await manager.resolve()).toEqual({ jarPath: "/srv/scrcpy-server-v3.1.jar", version: "3.1", source: "explicit" });
  });

  it("refuses a missing explicit path with the install hint", async () => {
    const { deps } = scripted();
    const manager = new ScrcpyManager({ ...MIRROR, serverPath: "/srv/missing.jar" }, deps);
    await expect(manager.resolve()).rejects.toThrow(/official source/);
  });

  it("refuses an unversioned jar name: exact match is mandatory", async () => {
    const { deps } = scripted({ files: { "/srv/scrcpy-server.jar": true } });
    const manager = new ScrcpyManager({ ...MIRROR, serverPath: "/srv/scrcpy-server.jar" }, deps);
    await expect(manager.resolve()).rejects.toThrow(/exact match is mandatory/);
  });

  it("finds the sidecar jar next to the scrcpy binary", async () => {
    const { deps } = scripted({
      binaries: { scrcpy: "/opt/scrcpy/scrcpy" },
      dirs: { "/opt/scrcpy": ["scrcpy", "scrcpy-server-v2.5.jar"] },
    });
    const manager = new ScrcpyManager(MIRROR, deps);
    expect(await manager.resolve()).toMatchObject({ version: "2.5", source: "sidecar" });
  });

  it("falls back to the sibling binary version for an unversioned sidecar", async () => {
    const { deps } = scripted({
      binaries: { scrcpy: "/opt/scrcpy/scrcpy" },
      dirs: { "/opt/scrcpy": ["scrcpy-server.jar"] },
      runs: { "/opt/scrcpy/scrcpy --version": { code: 0, stdout: "scrcpy 2.5\n", stderr: "" } },
    });
    const manager = new ScrcpyManager(MIRROR, deps);
    expect(await manager.resolve()).toMatchObject({ version: "2.5", source: "sidecar" });
  });

  it("refuses with the install hint when nothing is found", async () => {
    const { deps } = scripted();
    await expect(new ScrcpyManager(MIRROR, deps).resolve()).rejects.toThrow(/official source/);
  });
});

describe("mirror: documented argv shapes", () => {
  it("pushes to the documented device path", () => {
    expect(buildPushArgs("/srv/s.jar")).toEqual(["push", "/srv/s.jar", "/data/local/tmp/scrcpy-server.jar"]);
    expect(buildPushArgs("/srv/s.jar", "em-1").slice(0, 2)).toEqual(["-s", "em-1"]);
  });

  it("forwards the tunnel port to the abstract socket", () => {
    expect(buildForwardArgs(27183)).toEqual(["forward", "tcp:27183", "localabstract:scrcpy"]);
  });

  it("launches with the exact-match version plus the raw-stream option set", () => {
    const argv = buildLaunchArgs("3.1", MIRROR);
    expect(argv.slice(0, 6)).toEqual([
      "shell",
      "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      "3.1",
    ]);
    for (const option of [
      "tunnel_forward=true",
      "audio=false",
      "control=false",
      "cleanup=false",
      "raw_stream=true",
      "max_size=1080",
      "max_fps=30",
      "video_bit_rate=4000000",
    ]) {
      expect(argv, `missing server option ${option}`).toContain(option);
    }
  });

  it("unforward removes exactly the tunnel that was added", () => {
    expect(buildUnforwardArgs(27183)).toEqual(["forward", "--remove", "tcp:27183"]);
  });
});

describe("mirror: start/stop order against a fake adb", () => {
  it("pushes, forwards, then launches detached — and reuses the handle", async () => {
    const { deps, calls, spawned } = scripted({ files: { "/srv/scrcpy-server-v3.1.jar": true } });
    const manager = new ScrcpyManager(
      { ...MIRROR, serverPath: "/srv/scrcpy-server-v3.1.jar", serial: "em-1" },
      deps,
    );
    const first = await manager.start();
    expect(first).toMatchObject({ port: 27183, version: "3.1" });
    expect(calls.map((call) => call.find((part) => part === "push" || part === "forward"))).toEqual([
      "push",
      "forward",
    ]);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.join(" ")).toContain("com.genymobile.scrcpy.Server 3.1");
    await manager.start();
    expect(calls).toHaveLength(2);
    expect(spawned).toHaveLength(1);
  });

  it("a failed push stops before forward and launch", async () => {
    const { deps, calls, spawned } = scripted({
      files: { "/srv/scrcpy-server-v3.1.jar": true },
      runs: { "adb -s em-1 push /srv/scrcpy-server-v3.1.jar /data/local/tmp/scrcpy-server.jar": { code: 1, stdout: "", stderr: "no device" } },
    });
    const manager = new ScrcpyManager(
      { ...MIRROR, serverPath: "/srv/scrcpy-server-v3.1.jar", serial: "em-1" },
      deps,
    );
    await expect(manager.start()).rejects.toThrow(/^environment: adb push/);
    expect(calls).toHaveLength(1);
    expect(spawned).toHaveLength(0);
  });

  it("stop removes the forward and attempts the kill, then disposes quietly", async () => {
    const { deps, calls } = scripted({ files: { "/srv/scrcpy-server-v3.1.jar": true } });
    const manager = new ScrcpyManager({ ...MIRROR, serverPath: "/srv/scrcpy-server-v3.1.jar" }, deps);
    await manager.start();
    const before = calls.length;
    await manager.stop();
    expect(calls.slice(before).map((call) => call.join(" "))).toEqual([
      "adb forward --remove tcp:27183",
      "adb shell pkill -f com.genymobile.scrcpy.Server",
    ]);
    await manager.stop();
    await manager.dispose();
    expect(calls).toHaveLength(before + 2);
  });
});

describe("mirror: touch translation is pure adb input argv", () => {
  it("taps round to whole pixels", () => {
    expect(toAdbInputArgs({ kind: "tap", x: 100.6, y: 200.2 })).toEqual([
      "shell",
      "input",
      "tap",
      "101",
      "200",
    ]);
  });

  it("swipes carry an explicit duration, defaulting to 300ms", () => {
    expect(toAdbInputArgs({ kind: "swipe", x1: 0, y1: 0, x2: 0, y2: 500 })).toEqual([
      "shell",
      "input",
      "swipe",
      "0",
      "0",
      "0",
      "500",
      "300",
    ]);
    expect(
      toAdbInputArgs({ kind: "swipe", x1: 0, y1: 0, x2: 0, y2: 500, durationMs: 120 }),
    ).toContain("120");
  });
});
