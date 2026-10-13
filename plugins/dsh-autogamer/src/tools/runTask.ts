/**
 * `autogamer_run_task` — start an Android automation task, return immediately
 * (Phase 2).
 *
 * Backend mapping is locked against the fork's old face: our `instruction`
 * goes out as `task_desc`, `profile` as `model` ("Flash"/"Pro"), and the
 * answer's `trace_id` comes back as our `task_id`. Two accepted params have
 * NO backend counterpart (verified signature): `timeout_seconds` and
 * `max_steps` are accepted for contract stability but not forwarded —
 * enforcement is the caller's polling loop via `autogamer_manage_task`.
 * Defaults (`profile`, serial) fall back to the plugin Config.
 */
import type { ArtemisBackend } from "../artemis/types.js";
import type { PreflightResult } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";
import { requireEnv } from "./envGate.js";

export interface RunTaskDeps {
  backend: ArtemisBackend;
  checkEnv: () => Promise<PreflightResult>;
  defaultProfile: "flash" | "pro";
  defaultDeviceSerial: string;
}

export const MAX_INSTRUCTION_CHARS = 2000;

export function defineRunTask(deps: RunTaskDeps): ToolDefinitionInput {
  return {
    name: "autogamer_run_task",
    description:
      "Start an Android automation task through the external ARTEMIS backend (driven by Google ARTEMIS). " +
      "Returns immediately with a task_id; poll it with autogamer_manage_task. " +
      "flash is fast/reactive, pro is thorough/multi-agent.",
    parameters: {
      instruction: {
        type: "string",
        required: true,
        description: "Natural-language task instruction (non-empty, under 2000 characters).",
      },
      profile: {
        type: "string",
        enum: ["flash", "pro"],
        description: "Execution profile; omit for the configured default.",
      },
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the default device.",
      },
      timeout_seconds: {
        type: "number",
        description: "Accepted but not enforced by the backend (no such provider param): poll and stop yourself.",
      },
      max_steps: {
        type: "number",
        description: "Accepted but not forwarded (no such provider param).",
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
    async execute(args, exec) {
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
            : undefined;
      const info = await deps.backend.startTask(
        {
          instruction,
          profile: profile === "pro" ? "Pro" : "Flash",
          ...(serial !== undefined ? { deviceSerial: serial } : {}),
        },
        exec?.signal,
      );
      return {
        task_id: info.taskId,
        status: "running",
        profile,
        device_serial: info.deviceSerial ?? serial ?? "",
        started_at: info.startedAt,
      };
    },
  };
}
