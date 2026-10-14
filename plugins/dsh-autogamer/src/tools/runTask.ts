/**
 * `autogamer_run_task` — register a device task and return immediately (T1 / G82).
 *
 * This plugin no longer runs tasks. Under the single execution route (S11) the
 * DSH agent loop is the executor: it drives `run_device_action` itself, and
 * `report_task_status` is what ends a turn. What this tool still owns is the
 * *record* — the task id every later status and trace read resolves against —
 * so it mints that id locally instead of asking an engine for one.
 *
 * The record becomes durable through the host rather than through us: the id
 * rides this tool's own `presentationMeta`, the host stores that card on
 * `tool/result.meta`, and the session projection folds it into the task read
 * model. We append no event (R16) and keep no private store, so a cold read
 * replays the log and lands on the same task.
 *
 * `profile` and `timeout_seconds` / `max_steps` stay accepted for contract
 * stability. There is one execution route now, so `profile` no longer selects a
 * second runner, and no backend exists to enforce a timeout or a step cap: the
 * bounds are the agent's own `report_task_status` discipline.
 */
import type { PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import type { JsonValue } from "../dsh-types.js";
import { requireEnv } from "./envGate.js";

export interface RunTaskDeps {
  checkEnv: () => Promise<PreflightResult>;
  defaultProfile: "flash" | "pro";
  defaultDeviceSerial: string;
  /** Mint one task id. Injected so the tool never reaches for a global counter. */
  newTaskId: () => string;
  now: () => Date;
}

export const MAX_INSTRUCTION_CHARS = 2000;

export function defineRunTask(deps: RunTaskDeps): ToolDefinitionInput {
  return {
    name: "autogamer_run_task",
    description:
      "Register an Android automation task and return immediately with a task_id; poll it with " +
      "autogamer_manage_task. Execution is yours: drive the device through run_device_action " +
      "(the task tools only keep the record). flash is fast/reactive, pro is thorough/multi-agent.",
    parameters: {
      instruction: {
        type: "string",
        required: true,
        description: "Natural-language task instruction (non-empty, under 2000 characters).",
      },
      profile: {
        type: "string",
        enum: ["flash", "pro"],
        description: "Execution profile recorded with the task; omit for the configured default.",
      },
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the default device.",
      },
      timeout_seconds: {
        type: "number",
        description: "Accepted for contract stability; nothing enforces it — poll and stop yourself.",
      },
      max_steps: {
        type: "number",
        description: "Accepted for contract stability; nothing enforces it.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string", required: true },
          status: { type: "string", required: true },
          profile: { type: "string" },
          device_serial: { type: "string" },
          started_at: { type: "string" },
        },
        additionalProperties: true,
      },
      // The fold reads this card, not the rendered text: `taskId` is how the
      // session projection learns which task the following device actions
      // belong to (T1).
      presentationMeta: (_args, value) => {
        const record = (value ?? {}) as { task_id?: unknown; status?: unknown };
        const meta: { [key: string]: JsonValue } = {};
        if (typeof record.task_id === "string") meta.taskId = record.task_id;
        if (typeof record.status === "string") meta.status = record.status;
        return meta;
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        return [
          {
            type: "text",
            text:
              `task_id=${String(record.task_id ?? "")}; status=${String(record.status ?? "")}; ` +
              `profile=${String(record.profile ?? "")}; device_serial=${String(record.device_serial ?? "")}`,
          },
        ];
      },
    },
    async execute(args, _exec) {
      const instruction = args.instruction;
      if (typeof instruction !== "string" || instruction.trim().length === 0) {
        throw new Error("task: instruction must be a non-empty string");
      }
      if (instruction.length >= MAX_INSTRUCTION_CHARS) {
        throw new Error(`task: instruction is ${instruction.length} chars, under-${MAX_INSTRUCTION_CHARS} only`);
      }
      await requireEnv(deps.checkEnv);
      const profile = args.profile === "pro" ? "pro" : args.profile === "flash" ? "flash" : deps.defaultProfile;
      const serial =
        typeof args.device_serial === "string" && args.device_serial.length > 0
          ? args.device_serial
          : deps.defaultDeviceSerial.length > 0
            ? deps.defaultDeviceSerial
            : "";
      return {
        task_id: deps.newTaskId(),
        status: "running",
        profile,
        device_serial: serial,
        started_at: deps.now().toISOString(),
      };
    },
  };
}