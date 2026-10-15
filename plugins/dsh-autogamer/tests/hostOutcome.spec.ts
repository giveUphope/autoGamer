/**
 * Host-outcome observation locks (能力重审-3).
 *
 * Two rules govern this file, both earned in #111 where two locks turned out to
 * be false:
 *
 *   1. The handler under test is the one **captured from the real `ctx.on` call**
 *      made during `apply()`. A spec that builds its own handler can only prove
 *      that handler works — it cannot see a broken wiring, and an optional
 *      parameter like `{ global: true }` disappears silently when dropped.
 *   2. The observation is driven through the registered `autogamer_diagnose`
 *      tool, so what is asserted is the report the model would read, not an
 *      internal object the report never consults.
 *
 * What this file cannot prove, and does not claim: that a live host actually
 * emits `tools/result` for our tools. `@deepseek-ai/dsh-tools/testing` ships one
 * tool-definition fixture and no pipeline harness, so there is no offline way to
 * run the real registry — that part needs a host session (not a device).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from "@deepseek-ai/dsh-tools";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { HostOutcomeLedger, OUR_TOOL_NAMES, hostOutcomeOf } from "../src/hostOutcome.js";
import { adbRuntime, getSerialnoArgv, getStateArgv, packagesArgv, pngHeaderOnly, screencapArgv, windowArgv, windowDump } from "./support/fakeAdb.js";

const preflightStub = vi.hoisted(() => ({ ok: true }));

/** Same stand-in as apply.spec: the real runner is locked in preflight.spec.ts. */
vi.mock("../src/env/preflight.js", () => ({
  createPreflight: () => ({
    run: async () => ({ ok: preflightStub.ok, checks: [], finishedAt: "2026-10-15T00:00:00.000Z" }),
  }),
  preflightErrorText: () => "environment: mocked preflight failure",
}));

const { apply } = await import("../src/index.js");
const { configOf: Config } = await import("./support/config.js");

interface RegisteredTool {
  name: string;
  execute(args: Record<string, unknown>, exec: unknown): Promise<unknown>;
  output?: { render(args: unknown, value: unknown): { type: string; text?: string }[] };
}

interface Subscription {
  event: string;
  handler: (exec: { name: string; callId: string }, result: ToolExecutionResult) => void;
  options?: { global?: boolean };
}

/**
 * Cordis-shaped double recording EVERY `ctx.on` call by event name — apply.spec's
 * double keeps only `session/event`, which is exactly the blind spot that let a
 * signal-threading claim pass while nothing reached production wiring.
 */
function fakeContext(definitions: RegisteredTool[], subscriptions: Subscription[]) {
  const agent = { id: "agent-1", followup: () => {} };
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    tools: {
      register(definition: unknown) {
        definitions.push(definition as RegisteredTool);
        return () => {};
      },
      guard(_guard: unknown) {
        return () => {};
      },
    },
    agents: { get: (id: string) => (id === "agent-1" ? agent : undefined), currentInitiator: () => agent },
    on(event: string, handler: Subscription["handler"], options?: { global?: boolean }) {
      subscriptions.push({ event, handler, ...(options === undefined ? {} : { options }) });
      return () => {};
    },
    effect(setup: () => unknown) {
      setup();
    },
  };
}

const A = adbRuntime;

/** A device that answers, so the diagnosis completes and only the counts vary. */
function healthyDevice(): void {
  A.on(getSerialnoArgv, { code: 0, stdout: "emulator-5554\n" });
  A.on(getStateArgv, { code: 0, stdout: "device\n" });
  A.on(windowArgv, { code: 0, stdout: windowDump({ screenState: "ON", focus: "com.example/.Main" }) });
  A.on(packagesArgv, { code: 0, stdout: "" });
  A.on(screencapArgv, { code: 0, stdout: pngHeaderOnly(720, 1600) });
  A.on(/shell ps -A -o PID,ARGS/, { code: 0, stdout: " PID   ARGS\n 1 init [smu] \n" });
}

async function mounted() {
  const definitions: RegisteredTool[] = [];
  const subscriptions: Subscription[] = [];
  await apply(fakeContext(definitions, subscriptions) as never, Config({ ocrEnabled: false }) as never);
  const observer = subscriptions.find((s) => s.event === "tools/result");
  if (observer === undefined) throw new Error("apply() never subscribed to tools/result");
  const diagnose = definitions.find((d) => d.name === "autogamer_diagnose");
  if (diagnose === undefined) throw new Error("autogamer_diagnose was not registered");
  return { definitions, subscriptions, observer, diagnose };
}

const exec = () => ({ signal: new AbortController().signal });

/** Exactly what the host's timeout policy substitutes (upstream src/index.ts:41-47). */
function timeoutResult(): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: "text", text: "Error: tool call timed out after 45000ms" }],
    error: { message: "tool call timed out after 45000ms", info: { name: "ToolTimeoutError", code: "TOOL_TIMEOUT" } },
  } as ToolExecutionResult;
}

function abortedResult(): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: "text", text: "Error: tool call aborted" }],
    error: { message: "tool call aborted", info: { name: "AbortError", code: TOOL_ABORTED } },
  } as ToolExecutionResult;
}

function beforeDispatchResult(): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: "text", text: "Error: tool call aborted before dispatch" }],
    error: { message: "tool call aborted before dispatch", info: { name: "AbortError", code: TOOL_ABORTED_BEFORE_DISPATCH } },
  } as ToolExecutionResult;
}

function ownFailure(message: string): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${message}` }],
    error: { message },
  } as ToolExecutionResult;
}

function success(value: unknown): ToolExecutionResult {
  return { isError: false, value, content: [{ type: "text", text: "ok" }] } as ToolExecutionResult;
}

describe("hostOutcomeOf: attribution by field position", () => {
  it("reads the code where the host actually puts it", () => {
    expect(hostOutcomeOf(timeoutResult())).toBe("timeout");
    expect(hostOutcomeOf(abortedResult())).toBe("aborted");
    expect(hostOutcomeOf(beforeDispatchResult())).toBe("aborted-before-dispatch");
  });

  // The trap R15 records: `info.code`, not `error.code`. A classifier reading the
  // wrong level matches nothing and still returns undefined, so every other test
  // stays green while the count silently never moves.
  it("does not read a code that sits at the wrong level", () => {
    const misplaced = {
      isError: true,
      content: [],
      error: { message: "m", code: "TOOL_TIMEOUT" },
    } as unknown as ToolExecutionResult;
    expect(hostOutcomeOf(misplaced)).toBeUndefined();
  });

  it("leaves a tool's own failure and every success out", () => {
    expect(hostOutcomeOf(ownFailure("environment: adb timed out after 15000ms"))).toBeUndefined();
    expect(hostOutcomeOf(success({ ok: true }))).toBeUndefined();
  });
});

describe("HostOutcomeLedger: bounded counts and one last entry", () => {
  it("counts per outcome, keeps the newest record, and stays silent until then", () => {
    const ledger = new HostOutcomeLedger(() => Date.parse("2026-10-15T08:00:00.000Z"));
    expect(ledger.snapshot()).toEqual({
      seenAll: 0,
      seenOurs: 0,
      total: 0,
      byOutcome: { timeout: 0, aborted: 0, "aborted-before-dispatch": 0 },
    });
    ledger.record("run_device_action", "timeout", "call-1");
    ledger.record("report_task_status", "aborted", "call-2");
    expect(ledger.snapshot()).toEqual({
      seenAll: 0,
      seenOurs: 0,
      total: 2,
      byOutcome: { timeout: 1, aborted: 1, "aborted-before-dispatch": 0 },
      last: { outcome: "aborted", tool: "report_task_status", callId: "call-2", at: "2026-10-15T08:00:00.000Z" },
    });
  });

  /**
   * `total` alone cannot answer 能力重审-3's open question: a host that never emits
   * and a host that emits under a name our filter drops both read `total=0`. These
   * two locks are what separates them — the arrival counter runs before any filter.
   */
  it("counts arrivals before it counts replacements", () => {
    const ledger = new HostOutcomeLedger(() => Date.parse("2026-10-15T08:00:05.000Z"));
    ledger.arrive("run_device_action", true);
    let snap = ledger.snapshot();
    expect(snap.seenAll).toBe(1);
    expect(snap.seenOurs).toBe(1);
    expect(snap.total).toBe(0); // 一次都没被替换 —— 这才是健康读数，不该与「没收到」混淆
    ledger.arrive("skill", false);
    snap = ledger.snapshot();
    expect(snap.seenAll).toBe(2);
    expect(snap.seenOurs).toBe(1);
    expect(snap.lastArrival).toEqual({ tool: "skill", ours: false, at: "2026-10-15T08:00:05.000Z" });
  });
});

describe("the production tools/result subscription", () => {
  beforeEach(() => {
    A.reset();
    healthyDevice();
  });

  it("subscribes with the scope-filter bypass, on the real wiring", async () => {
    const { observer } = await mounted();
    expect(observer.options).toEqual({ global: true });
  });

  /**
   * The ceiling 能力重审-3 left recorded was "offline we cannot tell whether the host
   * emits for our tools at all". `total` could never answer it: no-emissions and
   * emissions-under-a-dropped-name both read 0. This drives the handler the production
   * wiring registered and counts arrivals, so the live session has something to read.
   */
  it("counts what arrived even when nothing was replaced, on the real wiring", async () => {
    const { observer, diagnose } = await mounted();
    observer.handler({ name: "run_device_action", callId: "call-ok" }, success("Success"));
    observer.handler({ name: "skill", callId: "call-other" }, success("another plugin's call"));
    const value = (await diagnose.execute({}, exec())) as Record<string, unknown>;
    const wire = value.host_outcomes as Record<string, unknown>;
    expect(wire).toMatchObject({ seen_all: 2, seen_ours: 1, total: 0, timeouts: 0 });
    expect(wire.last_seen as Record<string, unknown>).toMatchObject({ tool: "skill", ours: false });
    const rendered = diagnose.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("host_seen=1/2");
    expect(rendered[0]?.text).toContain("host_replaced=0");
  });

  // The list in src/hostOutcome.ts is not the authority — what apply registers is.
  // This is the lock that makes the list self-auditing when a tool is added.
  it("counts exactly the tools this plugin registers", async () => {
    const { definitions } = await mounted();
    expect([...definitions.map((d) => d.name)].sort()).toEqual([...OUR_TOOL_NAMES].sort());
  });

  it("reports a host timeout of our own call, in the body the model reads", async () => {
    const { observer, diagnose } = await mounted();
    observer.handler({ name: "run_device_action", callId: "call-9" }, timeoutResult());
    const value = (await diagnose.execute({}, exec())) as Record<string, unknown>;
    expect(value.host_outcomes).toMatchObject({
      total: 1,
      timeouts: 1,
      aborted: 0,
      last: { outcome: "timeout", tool: "run_device_action", call_id: "call-9" },
    });
    const rendered = diagnose.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("host_timeouts=1");
    expect(rendered[0]?.text).toContain("host_seen=1");
  });

  it("counts a caller cancellation as its own outcome, not as a timeout", async () => {
    const { observer, diagnose } = await mounted();
    observer.handler({ name: "run_device_action", callId: "call-a" }, abortedResult());
    observer.handler({ name: "autogamer_get_device_state", callId: "call-b" }, beforeDispatchResult());
    const value = (await diagnose.execute({}, exec())) as Record<string, unknown>;
    expect(value.host_outcomes).toMatchObject({ total: 2, timeouts: 0, aborted: 1, aborted_before_dispatch: 1 });
    // The whole reason `host_seen` is on the wire: with timeouts alone this row and
    // a session where the host never emitted once look identical (`host_timeouts=0`).
    const rendered = diagnose.output!.render({}, value) as { text?: string }[];
    expect(rendered[0]?.text).toContain("host_seen=2");
    expect(rendered[0]?.text).toContain("host_timeouts=0");
  });

  it("keeps another plugin's timeout off our ledger", async () => {
    const { observer, diagnose } = await mounted();
    observer.handler({ name: "browser_navigate", callId: "call-x" }, timeoutResult());
    observer.handler({ name: "our-own-failure-carrying-tool", callId: "call-y" }, ownFailure("environment: no device"));
    const value = (await diagnose.execute({}, exec())) as Record<string, unknown>;
    expect(value.host_outcomes).toMatchObject({ total: 0, timeouts: 0 });
  });

  it("ignores a successful call and our own failure instead of counting them", async () => {
    const { observer, diagnose } = await mounted();
    observer.handler({ name: "run_device_action", callId: "call-s" }, success({ ok: true }));
    observer.handler({ name: "run_device_action", callId: "call-f" }, ownFailure("cancelled: the host deadline passed"));
    const value = (await diagnose.execute({}, exec())) as Record<string, unknown>;
    expect(value.host_outcomes).toMatchObject({ total: 0 });
  });
});
