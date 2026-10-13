/**
 * `autogamer_get_device_state` — read-only device query through the external
 * ARTEMIS backend (Phase 1).
 *
 * Shape notes (all Phase-0 verdicts, not guesses):
 * - `description` is a plain string: the `{en,zh}` object form does not exist
 *   on the installed dsh-tools (0.2.0-rc.2).
 * - Parameter/output specs are plain JSON-schema maps compiled by
 *   `defineTool`, the same form as the shipped router tool (G30: the object
 *   root is what keeps the LLM API from 400ing the whole request).
 * - Read-only, so `isConcurrencySafe` is unconditionally true (R14/S3: the
 *   host already runs independent reads concurrently; the device gate only
 *   serialises what must be serial).
 * - The backend answers with a provider-side `screenshot_path`; Phase 1 passes
 *   it through untouched (no attachment download — that is the model-side
 *   media path of the existing router tool, not this tool's contract).
 * - A failed preflight throws `environment:` with the fix (scheme §6); the
 *   backend's own classified errors pass through unmodified.
 */
import type { ArtemisBackend } from "../artemis/types.js";
import type { PreflightResult } from "../env/preflight.js";
import { preflightErrorText } from "../env/preflight.js";
import type { ToolDefinitionInput } from "../dsh-types.js";

export interface GetDeviceStateDeps {
  backend: ArtemisBackend;
  checkEnv: () => Promise<PreflightResult>;
  defaultDeviceSerial: string;
}

export function defineGetDeviceState(deps: GetDeviceStateDeps): ToolDefinitionInput {
  return {
    name: "autogamer_get_device_state",
    description:
      "Query the Android device state through the external ARTEMIS backend (driven by Google ARTEMIS): " +
      "connection, foreground app, a structured summary of the visible UI, and an optional screenshot path. " +
      "Read-only; does not touch any task.",
    parameters: {
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the default device.",
      },
      include_screenshot: {
        type: "boolean",
        description: "Ask the backend to capture a screenshot and return its path.",
      },
    },
    isConcurrencySafe: () => true,
    output: {
      schema: {
        // Value-schema DSL: required-ness is per-property (`required: true`),
        // never a top-level `required` array (that throws JsonSchemaError at
        // register time — same rule as the shipped router tool).
        type: "object",
        properties: {
          device_serial: { type: "string", required: true },
          connected: { type: "boolean", required: true },
          current_package: { type: "string" },
          current_activity: { type: "string" },
          screen_summary: { type: "string" },
          screenshot_path: { type: "string" },
          accessibility_helper_installed: { type: "boolean" },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        const record = (value ?? {}) as Record<string, unknown>;
        const parts = [
          `device_serial=${String(record.device_serial ?? "")}`,
          `connected=${String(record.connected ?? false)}`,
        ];
        for (const key of [
          "current_package",
          "current_activity",
          "screen_summary",
          "screenshot_path",
          "accessibility_helper_installed",
        ]) {
          if (record[key] !== undefined) parts.push(`${key}=${String(record[key])}`);
        }
        return [{ type: "text", text: parts.join("; ") }];
      },
    },
    async execute(args) {
      const env = await deps.checkEnv();
      if (!env.ok) throw new Error(preflightErrorText(env));
      const serial =
        typeof args.device_serial === "string" && args.device_serial.length > 0
          ? args.device_serial
          : deps.defaultDeviceSerial.length > 0
            ? deps.defaultDeviceSerial
            : undefined;
      const state = await deps.backend.getDeviceState({
        deviceSerial: serial,
        includeScreenshot: args.include_screenshot === true,
      });
      return {
        device_serial: state.deviceSerial,
        connected: state.connected,
        ...(state.currentPackage !== undefined ? { current_package: state.currentPackage } : {}),
        ...(state.currentActivity !== undefined ? { current_activity: state.currentActivity } : {}),
        ...(state.screenSummary !== undefined ? { screen_summary: state.screenSummary } : {}),
        ...(state.screenshotPath !== undefined ? { screenshot_path: state.screenshotPath } : {}),
        ...(state.helperInstalled !== undefined
          ? { accessibility_helper_installed: state.helperInstalled }
          : {}),
      };
    },
  };
}
