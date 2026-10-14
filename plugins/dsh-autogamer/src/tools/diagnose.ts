/**
 * `autogamer_diagnose` — device and environment diagnosis, answered locally
 * over adb (T2-f; was the provider's `mobile_diagnose`).
 *
 * Two sources still merge here, and the merge is still the point: the device
 * report from `src/device/diagnose.ts` plus OUR preflight. The tool doubles as
 * the manual preflight entry, so unlike its siblings it does NOT throw on a
 * failed environment - it returns the report with the local fixes appended to
 * the recommendations. It only throws when the report itself could not be
 * produced AND the environment is broken, and then the preflight text (the
 * actionable one) wins.
 *
 * `include_screenshot` is no longer accepted-and-ignored: the frame is captured
 * through the same adb path every other consumer uses and committed to the host
 * attachment store, so the model gets a real image block (render emits
 * `[text, image]`, same shape as the action router).
 */
import type { DeviceDiagnosis } from "../device/diagnose.js";
import type { DshImageAttachment, ToolDefinitionInput } from "../dsh-types.js";
import { preflightErrorText, type PreflightResult } from "../env/preflight.js";
import { requireEnv } from "./envGate.js";

export interface DiagnoseDeps {
  diagnose(serial: string | undefined, options?: { signal?: AbortSignal }): Promise<DeviceDiagnosis>;
  checkEnv: () => Promise<PreflightResult>;
  defaultDeviceSerial: string;
  /** PNG frame for `include_screenshot`; absent means the flag reports nothing. */
  capturePng?(serial: string | undefined, signal?: AbortSignal): Promise<Buffer | undefined>;
  saveScreenshot?(
    bytes: Uint8Array,
    mediaType: DshImageAttachment["mediaType"],
  ): Promise<DshImageAttachment | undefined>;
  /**
   * T5: is the built-in OCR usable? Reported, never gated — a broken OCR costs a
   * `{text}` target its second source, nothing else, so it must not fail a
   * diagnosis or a preflight.
   */
  ocrStatus?(serial: string | undefined, signal?: AbortSignal): Promise<OcrReadout>;
}

export interface OcrReadout {
  readonly enabled: boolean;
  readonly langs: readonly string[];
  readonly missingData: readonly string[];
  /** Set only when a frame actually went through the engine. */
  readonly frame?: { hits: number; ms: number };
  readonly error?: string;
}

/** What to tell the operator, in the order they can act on it. */
export function ocrRecommendations(ocr: OcrReadout): string[] {
  if (!ocr.enabled) return [];
  if (ocr.missingData.length > 0) {
    return [
      `the built-in OCR is missing its packaged language data for ${ocr.missingData.join(", ")} — ` +
        `{text} targets fall back to the hierarchy alone`,
    ];
  }
  if (ocr.error !== undefined) return [`the built-in OCR could not be checked: ${ocr.error}`];
  return [];
}

export function defineDiagnose(deps: DiagnoseDeps): ToolDefinitionInput {
  return {
    name: "autogamer_diagnose",
    description:
      "Diagnose the Android device and the plugin's own environment over adb: adb connection, " +
      "screen state, helper APK install and version, recent entries in the device crash log, " +
      "and actionable fix recommendations. Also the manual entry for a fresh environment preflight.",
    parameters: {
      device_serial: {
        type: "string",
        description: "Target device serial; omit for the only attached device.",
      },
      include_logcat: {
        type: "boolean",
        description: "Accepted; the crash buffer is always read (main logcat is not).",
      },
      include_screenshot: {
        type: "boolean",
        description: "Capture a frame and attach it to the report.",
      },
    },
    output: {
      schema: {
        type: "object",
        properties: {
          device_serial: { type: "string", required: true },
          adb_connected: { type: "boolean", required: true },
          helper_installed: { type: "boolean", required: true },
          helper_version: { type: "string" },
          recent_crashes: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          logcat_path: { type: "string" },
          screenshot_path: { type: "string" },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
          ocr_ready: { type: "boolean" },
          ocr: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
      render: (_args, value) => {
        const record = { ...(value ?? {}) } as Record<string, unknown>;
        const crashes = Array.isArray(record.recent_crashes) ? (record.recent_crashes as unknown[]).length : 0;
        const fixes = Array.isArray(record.recommendations) ? (record.recommendations as unknown[]).length : 0;
        const text =
          `device_serial=${String(record.device_serial ?? "")}; ` +
          `adb_connected=${String(record.adb_connected ?? false)}; ` +
          `helper_installed=${String(record.helper_installed ?? false)}; ` +
          `recent_crashes=${crashes}; recommendations=${fixes}` +
          // Only when the check ran: a report that never asked must not answer.
          (record.ocr_ready === undefined ? "" : `; ocr_ready=${String(record.ocr_ready)}`);
        // Same rule as the router: the attachment becomes an image block, so it
        // must not also be flattened into the text envelope.
        const image = record.screenshot as DshImageAttachment | undefined;
        delete record.screenshot;
        return image?.attachmentId
          ? [{ type: "text", text }, { type: "image", attachment: image }]
          : [{ type: "text", text }];
      },
    },
    async execute(args, exec) {
      const serial =
        typeof args.device_serial === "string" && args.device_serial.length > 0
          ? args.device_serial
          : deps.defaultDeviceSerial.length > 0
            ? deps.defaultDeviceSerial
            : undefined;
      const env = await deps.checkEnv();
      const localFixes = env.ok
        ? []
        : env.checks.filter((check) => !check.ok && check.fix).map((check) => check.fix as string);
      let diagnosis: DeviceDiagnosis;
      try {
        diagnosis = await deps.diagnose(serial, { signal: exec?.signal });
      } catch (error) {
        // The preflight text is the one that says what to do, so it wins over a
        // bare "adb did not answer" whenever both are true.
        if (!env.ok) throw new Error(preflightErrorText(env));
        throw error;
      }
      const recommendations = [...diagnosis.recommendations];
      for (const fix of localFixes) {
        if (!recommendations.includes(fix)) recommendations.push(fix);
      }
      // T5: the enhancement is asked after the device facts, and its own failure
      // is a line in the report rather than a thrown diagnosis.
      let ocr: OcrReadout | undefined;
      if (deps.ocrStatus !== undefined) {
        try {
          ocr = await deps.ocrStatus(serial, exec?.signal);
        } catch (error) {
          ocr = { enabled: true, langs: [], missingData: [], error: String((error as Error)?.message ?? error) };
        }
        for (const note of ocrRecommendations(ocr)) {
          if (!recommendations.includes(note)) recommendations.push(note);
        }
      }
      let screenshot: DshImageAttachment | undefined;
      if (args.include_screenshot === true && deps.capturePng !== undefined && deps.saveScreenshot !== undefined) {
        const png = await deps.capturePng(serial, exec?.signal);
        // A missing frame is not a reason to fail a diagnosis: the report is
        // already useful and the recommendations say what could not be read.
        if (png !== undefined) screenshot = await deps.saveScreenshot(png, "image/png");
      }
      return {
        device_serial: diagnosis.deviceSerial ?? serial ?? "",
        adb_connected: diagnosis.adbConnected,
        helper_installed: diagnosis.helperInstalled ?? false,
        ...(diagnosis.helperVersion !== undefined ? { helper_version: diagnosis.helperVersion } : {}),
        recent_crashes: diagnosis.recentCrashes.map((crash) => ({
          ...(crash.package !== undefined ? { package: crash.package } : {}),
          ...(crash.timestamp !== undefined ? { timestamp: crash.timestamp } : {}),
          ...(crash.stackExcerpt !== undefined ? { stack_excerpt: crash.stackExcerpt } : {}),
        })),
        ...(screenshot !== undefined
          ? { screenshot, screenshot_path: String(screenshot.attachmentId) }
          : {}),
        ...(ocr === undefined
          ? {}
          : {
              ocr_ready: ocr.enabled && ocr.missingData.length === 0 && ocr.error === undefined,
              ocr: {
                enabled: ocr.enabled,
                langs: [...ocr.langs],
                missing_data: [...ocr.missingData],
                ...(ocr.frame !== undefined ? { frame: ocr.frame } : {}),
                ...(ocr.error !== undefined ? { error: ocr.error } : {}),
              },
            }),
        recommendations,
      };
    },
  };
}
