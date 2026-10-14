/**
 * G52 Tier 1: the report-nudge path driven by the REAL session store and agent
 * registry instead of apply.spec.ts's fake event bus.
 *
 * What is real here:
 *  - the `turn/end` we react to is committed by `@deepseek-ai/dsh-session`'s own
 *    `Session.append` and published through cordis' post-commit `session/event`;
 *  - the session is entered through a `createScope` realm and the nudge fires with
 *    `ctx.agents.get(session.id)` resolving through the real `AgentRegistry`;
 *  - the action hop goes through the real `ToolRuntime.execute` policy pipeline
 *    inside `ctx.agents.withInitiator(...)`, which is what lets the ledger key on
 *    the initiating agent at all;
 *  - the scope filter is not asserted as an option but OBSERVED: a control
 *    listener owned by a child scope misses the realm-entered `turn/end` while
 *    its `{ global: true }` sibling receives it. That asymmetry is the G44 v1
 *    failure mode, reproduced on host machinery.
 *
 * Deliberately not claimed here: our plugin's listener runs untagged at the root
 * context in this harness, so its own admission is the "untagged listeners pass"
 * branch; the `{ global: true }` requirement applies to the preset realm where the
 * bundle mounts it, and apply.spec.ts still locks the registration options.
 * The device result is irrelevant by design - the action server stub exits at once,
 * and `markActed` happens at the top of `execute` (verified in the G52 probes).
 * Live-only: the host accepting `source.kind:'autogamer'` into session format V4
 * (CHANGELOGS #15).
 */
import { afterEach, describe, expect, it } from "vitest";

/** cordis's `plugin()` carries a signature this plugin never uses; the specs only
 * ever hand it one definition, so the seam is narrowed once, here. */
const mount = (root: { plugin: unknown }, mod: { default?: unknown }): unknown =>
  (root.plugin as (input: unknown) => unknown)(mod.default);
import { Context } from "@deepseek-ai/cordis";
import { createScope } from "@deepseek-ai/dsh-scope";
import * as pluginModule from "../../src/index.js";

const SERVICE_PACKAGES = [
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-attachment",
  "@deepseek-ai/dsh-session",
] as const;

/** Exits immediately: the ledger marks acted before any transport attempt. */
const STUB_ACTION_SERVER = [process.execPath, "-e", "process.exit(0)"];

type SessionLike = { id: string; append(type: string, data: unknown): unknown };

let cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await dispose();
});

async function bootRealTurnPath() {
  const root = new Context();
  for (const specifier of SERVICE_PACKAGES) {
    const mod = (await import(specifier)) as { default: unknown };
    await mount(root, mod);
  }

  const followups: unknown[] = [];
  const globalControl: string[] = [];
  const plainControl: string[] = [];

  // Two realms, the way the live topology has them: the session's Agent realm, and
  // the preset realm that owns our listener. Dispatch travels UP the scope chain
  // and never down, so a listener tagged to the other realm is excluded unless it
  // bypasses the filter.
  const agentRealm = createScope(root, Symbol("g52-agent-realm") as unknown as object);
  const presetRealm = createScope(root, Symbol("g52-preset-realm") as unknown as object);
  cleanups.push(() => presetRealm.dispose(), () => agentRealm.dispose());
  // cordis types `on()` against its own Scoped<Session> generics; these are plain
  // doubles, so the seam is narrowed once rather than at every call site.
  const on = presetRealm.ctx.on as unknown as (
    type: string,
    handler: (session: SessionLike, event: { type: string }) => unknown,
    options?: unknown,
  ) => unknown;
  on("session/event", (session, event) => globalControl.push(`${session?.id}/${event?.type}`), { global: true });
  on("session/event", (session, event) => plainControl.push(`${session?.id}/${event?.type}`));

  const session = await new Promise<SessionLike>((resolve) => {
    agentRealm.ctx.inject(["sessions"], (ctx: any) => resolve(ctx.sessions.create("g52-session")));
  });

  const agent = {
    id: session.id,
    session,
    status: "idle",
    followup: (message: unknown) => {
      followups.push(message);
    },
    cancel: () => {},
    whenIdle: async () => {},
    send: () => {},
    steer: () => {},
    inject: () => {},
  };
  const disposeAgent = await (root.agents as any).register(agent);
  cleanups.push(() => disposeAgent?.());

  await root.plugin(
    {
      name: pluginModule.name,
      Config: pluginModule.Config,
      inject: pluginModule.inject,
      apply: pluginModule.apply,
    } as never,
    { actionServerCommand: STUB_ACTION_SERVER, screenSize: [1080, 2400] } as never,
  );

  /** Run one call through the real policy pipeline with the agent as initiator. */
  const act = (name: string, args: Record<string, unknown>) =>
    (root.agents as any).withInitiator(agent, () =>
      (root.tools as any).execute({
        callId: `g52-${name}-${followups.length}-${plainControl.length}`,
        name,
        arguments: args,
        signal: new AbortController().signal,
      }),
    );

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const endTurn = () => session.append("turn/end", { turn: 1, reason: { kind: "completed" } });

  return { root, session, agent, act, flush, endTurn, followups, globalControl, plainControl };
}

describe("conformance: the report nudge on a real turn/end (G52 Tier 1)", () => {
  it("a real committed turn/end nudges exactly once, and only outside the emit", async () => {
    const { act, endTurn, followups, flush } = await bootRealTurnPath();
    await act("run_device_action", { action: "back", reason: "g52 probe" });
    endTurn();

    // R23 on the real emit path: the append is still publishing, so the nudge must
    // not have been attempted synchronously inside the emit.
    expect(followups).toHaveLength(0);
    await flush();
    expect(followups).toHaveLength(1);
  });

  it("the nudge satisfies the real UserMessage contract", async () => {
    const { act, endTurn, followups, flush } = await bootRealTurnPath();
    await act("run_device_action", { action: "back", reason: "g52 probe" });
    endTurn();
    await flush();

    const message = followups[0] as {
      id?: string;
      role?: string;
      content?: { type: string; text: string }[];
      source?: { kind?: string; reason?: string };
    };
    // `id` is required by dsh-llm's MessageBase ("stable identity preserved across
    // every representation boundary"); the hand mirror this replaced shipped none.
    expect(message.id, "nudge carries no message id").toBeTruthy();
    expect(message.role).toBe("user");
    expect(message.source).toEqual({ kind: "autogamer", reason: "unreported-turn" });
    const text = message.content?.map((block) => block.text ?? "").join("") ?? "";
    expect(text).toContain("report_task_status");
    expect(text).toContain("Do not call run_device_action");
  });

  it("shows the scope filter that { global: true } exists to bypass", async () => {
    const { act, endTurn, flush, globalControl, plainControl } = await bootRealTurnPath();
    await act("run_device_action", { action: "back", reason: "g52 probe" });
    endTurn();
    await flush();

    // Same session, same event, two listeners in the SAME scope: only the global
    // one is admitted, because the session was entered in this very scope while
    // dispatch travels up the chain and never down.
    expect(plainControl, "a non-global listener missed nothing - filter not exercised").toHaveLength(0);
    expect(globalControl).toContain("g52-session/turn/end");
  });

  it("stays silent when the turn reported through the real pipeline", async () => {
    const { act, endTurn, followups, flush } = await bootRealTurnPath();
    await act("run_device_action", { action: "back", reason: "g52 probe" });
    await act("report_task_status", { status: "completed", summary: "g52 done" });
    endTurn();
    await flush();
    expect(followups).toHaveLength(0);
  });

  it("never nudges twice for one agent across real turn/ends", async () => {
    const { act, endTurn, followups, flush } = await bootRealTurnPath();
    await act("run_device_action", { action: "back", reason: "g52 probe" });
    endTurn();
    await flush();
    await act("run_device_action", { action: "back", reason: "g52 again" });
    endTurn();
    await flush();
    expect(followups).toHaveLength(1);
  });
});
