/**
 * Touch-to-adb translation for the device mirror's downgrade route (Phase 4).
 *
 * The scrcpy control socket would be the native path, but it speaks a custom
 * binary protocol to a socket this plugin cannot open (no DSH binary
 * channel — Phase 0 verdict), so control travels the documented downgrade:
 * plain `adb shell input …` commands. This module is pure argv construction;
 * coordinates are device pixels (the caller converts), swipe duration
 * defaults to 300ms. Tested without any device.
 */

export type TouchEvent =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs?: number };

export const DEFAULT_SWIPE_DURATION_MS = 300;

/** `adb shell input tap|swipe …` argv tail (without the adb binary/serial prefix). */
export function toAdbInputArgs(touch: TouchEvent): string[] {
  const whole = (value: number): string => String(Math.round(value));
  if (touch.kind === "tap") {
    return ["shell", "input", "tap", whole(touch.x), whole(touch.y)];
  }
  return [
    "shell",
    "input",
    "swipe",
    whole(touch.x1),
    whole(touch.y1),
    whole(touch.x2),
    whole(touch.y2),
    whole(touch.durationMs ?? DEFAULT_SWIPE_DURATION_MS),
  ];
}
