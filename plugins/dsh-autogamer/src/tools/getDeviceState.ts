/**
 * `autogamer_get_device_state` — read-only device query answered locally
 * over `adb` (T2-a; was the external ARTEMIS backend in Phase 1).
 *
 * Shape notes (all Phase-0 verdicts, not guesses):
 * - `description` is a plain string: the `{en,zh}` object form does not exist
 *   on the installed dsh-tools (0.2.0-rc.2).
 * - Parameter/output specs are plain JSON-schema maps compiled by
 *   `defineTool`, the same form as the shipped router tool (G30: the object
 *   root is what keeps the LLM API from 400ing the whole request).
 * - Read-only, so `isConcurrencySafe` is unconditionally true (R14/S3: the
 *   host already runs independent reads concurrently; the device gate only
 *   serialises what must be serial). The probes below run in parallel.
 * - The observable contract (tool name, parameters, output keys, render line)
 *   is unchanged from Phase 1 — only the source of the answers moved, so the
 *   existing delivery-shape locks still apply. `screenshot_path` now carries
 *   the host attachment reference instead of a provider-side file path;
 *   `screen_summary` is the local state line, which T2-b replaces with the
 *   hierarchy-derived summary once the hierarchy is native.
 * - A failed preflight throws `environment:` with the fix (scheme §6).
 */
import { imageMediaTypeOf, parseImageSize } from "../coord.js";
import type { ConnectionState, DeviceStateProbe } from "../device/state.js";
import type { DshImageAttachment, ToolDefinitionInput } from "../dsh-types.js";
import type { PreflightResult } from "../env/preflight.js";
import { requireEnv } from "./envGate.js";

export interface GetDeviceStateDeps {
  probe: DeviceStateProbe;
  checkEnv: () => Promise<PreflightResult>;
  defaultDeviceSerial: string;
  /**
   * Host attachment store. Without it `include_screenshot` reports no image
   * rather than failing the read — the state answers do not depend on media.
   */
  saveScreenshot?(
    bytes: Uint8Array,
    mediaType: DshImageAttachment["mediaType"],
  ): Promise<DshImageAttachment | undefined>;
}

export function defineGetDeviceState(deps: GetDeviceStateDeps): ToolDefinitionInput {
  return {
    name: "autogamer_get_device_state",
    description:
      "Query the Android device state directly over adb: connection, foreground app, " +
      "screen state and frame size, whether the accessibility helper APK is installed, " +
      "and an optional screenshot. " +
      "Read-only; does not touch any task.",
    parameters: {
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the default device.",
      },
      include_screenshot: {
        type: "boolean",
        description: "Capture a screenshot and return its attachment reference.",
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
        const record = { ...(value ?? {}) } as Record<string, unknown>;
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
        // Same rule as the action router: the attachment reference renders as an
        // image block, so it must not also be flattened into the text envelope.
        const image = record.screenshot as DshImageAttachment | undefined;
        delete record.screenshot;
        const text = parts.join("; ");
        return image?.attachmentId
          ? [{ type: "text", text }, { type: "image", attachment: image }]
          : [{ type: "text", text }];
      },
    },
    async execute(args, exec) {
      await requireEnv(deps.checkEnv);
      const asked =
        typeof args.device_serial === "string" && args.device_serial.length > 0
          ? args.device_serial
          : deps.defaultDeviceSerial.length > 0
            ? deps.defaultDeviceSerial
            : undefined;
      const options = { signal: exec?.signal };
      // `adb` addresses the one attached device when none is named, so the
      // serial we report comes from the same question (measured: `get-serialno`
      // -> `emulator-5554`, exit 0; an unknown serial -> exit 1, empty stdout).
      const serial = asked ?? (await deps.probe.serial(options));
      const [connection, state, helperInstalled] = await Promise.all([
        deps.probe.connection(serial, options),
        deps.probe.window(serial, options),
        deps.probe.helperInstalled(serial, options),
      ]);
      // One frame for both questions: the reported size and the returned image
      // are the same capture, so the summary cannot describe a different frame
      // than the one the model is looking at.
      const png = await deps.probe.capture(serial, options);
      const frame = png === undefined ? undefined : parseImageSize(png);
      const connected = connection === "device";
      const mediaType = png === undefined ? undefined : imageMediaTypeOf(png);
      const screenshot =
        args.include_screenshot === true && png !== undefined && mediaType !== undefined
          ? await deps.saveScreenshot?.(png, mediaType)
          : undefined;
      return {
        device_serial: serial ?? "",
        connected,
        ...(state.foreground !== undefined ? { current_package: state.foreground.package } : {}),
        ...(state.foreground !== undefined ? { current_activity: state.foreground.activity } : {}),
        screen_summary: summarize({ connected, connection, state, frame, helperInstalled }),
        // `screenshot_path` stays the contract's text handle (the opaque host
        // attachment id, never a filesystem path); `screenshot` is the reference
        // the render turns into the image block the model actually sees.
        ...(screenshot !== undefined
          ? { screenshot, screenshot_path: String(screenshot.attachmentId) }
          : {}),
        ...(helperInstalled !== undefined ? { accessibility_helper_installed: helperInstalled } : {}),
      };
    },
  };
}

/**
 * The one-line state the model reads. Deliberately made of what the probes
 * answered: a question that did not answer says so instead of guessing, and
 * `not connected` is only said when adb actually said the device is not ready.
 */
export function summarize(input: {
  connected: boolean;
  connection: ConnectionState | undefined;
  state: { screenLocked: boolean | null };
  frame: { width: number; height: number } | undefined;
  helperInstalled: boolean | undefined;
}): string {
  const parts = [
    input.connected
      ? "connected"
      : `not connected (adb get-state: ${input.connection ?? "did not answer"})`,
    input.state.screenLocked === true
      ? "screen locked/off"
      : input.state.screenLocked === false
        ? "screen on and unlocked"
        : "screen state unknown (dumpsys window did not answer)",
    input.frame === undefined
      ? "frame size unknown"
      : `frame ${input.frame.width}x${input.frame.height}`,
    input.helperInstalled === undefined
      ? "helper probe did not answer"
      : input.helperInstalled
        ? "helper APK installed"
        : "helper APK not installed",
  ];
  // Joined with ` | `, not `; `: the render flattens fields with `; `, and a
  // summary carrying that separator would read as several fields (measured on
  // the live emulator).
  return parts.join(" | ");
}
