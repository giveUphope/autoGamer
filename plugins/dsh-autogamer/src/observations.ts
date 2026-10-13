import type { VisibleElement } from "./hierarchy.js";

/**
 * The deliberately shallow memory behind `{index}` handles (G67): one live
 * observation per (agent, device) — the element list the model was LAST SHOWN.
 * A new observation replaces the old one; nothing accumulates and nothing
 * expires, because the safety property (`stale #N never becomes a clickable
 * target`, docs/migration/inventory/04-agent-stack-config.md:203) comes from
 * re-checking a handle's identity against a fresh hierarchy at execution time,
 * not from a TTL.
 */
export class LiveObservations {
  private readonly latest = new Map<string, VisibleElement[]>();

  record(agent: string, device: string, elements: VisibleElement[]): void {
    this.latest.set(observationKey(agent, device), elements);
  }

  get(agent: string, device: string): VisibleElement[] | undefined {
    return this.latest.get(observationKey(agent, device));
  }
}

export function observationKey(agent: string, device: string): string {
  return `${agent}::${device}`;
}
