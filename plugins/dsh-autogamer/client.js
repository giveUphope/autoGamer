/**
 * dsh-autogamer browser half (Phase 3).
 *
 * Hand-written in the deployment's ModuleLoader format — the shape comes
 * verbatim from the official decoration template
 * (packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/client.js):
 * `window.__ModuleLoader__.load({ id, factory(require) })`, React from
 * `require('react')` (browser module table, never bundled), minimal
 * `inject: ['slots']`, and `ctx.slots.inject(slot, () => ctx.slots.register(
 * { name, id, order[, key] }, Component))`.
 *
 * Deliberately NOT compiled: tsc (this repo's only builder) cannot emit the
 * ModuleLoader format — the deployment's own client build tooling
 * (packages/client/tsdown.client.ts) owns that. So this file is plain JS and
 * dependency-free; keep it that way (no imports besides require('react')).
 *
 * Slot choices (all verified, Phase 0): `tool.call.toolview` is the keyed
 * conversation slot under `conversation.chat.node`; cells key by wire tool
 * name (R18; ui-cordis registers cordis_define/cordis_run/... the same way).
 * The conversation-level card slot, the RPC helper, the per-plugin settings
 * slot, and any binary frame push do NOT exist upstream — this file must
 * never reference them (locked by tests/clientHalf.spec.ts).
 *
 * What that lock is and is not: it asserts the STRUCTURE above (manifest half,
 * ModuleLoader shape, the five wire keys, react-only requires, the cut-API
 * negative list). It does NOT prove a card ever rendered in a browser — that
 * needs a real session, and since all five tools sit behind `requireEnv`, it
 * needs a device too (🔶). Do not read "has a lock" as "verified live" (R21).
 * Its history: T4 deleted this spec by mistake, reading it as a provider-chain
 * spec (see TODO §七 G95); it was restored unchanged and all six assertions
 * held, which is itself the evidence that this file has not moved since.
 *
 * Owner props are read tolerantly: the exact prop contract lives only in the
 * live inspect catalog (`cordis_inspect what:"client"`), so no card may assume
 * a field. Live data channels (polling, controls) need a mounted proof first;
 * until then every card renders the call's own args/result and nothing else.
 * No custom styling: plain elements inherit the host theme (R18: no Host
 * Client imports, token names unverified, so no style attributes at all).
 */
window.__ModuleLoader__.load({
  id: 'dsh-autogamer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Call record from the binding site: result first, then tolerant fallbacks. */
    function recordOf(props) {
      if (!props || typeof props !== 'object') return {};
      const candidates = [props.result, props.value, props.output];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
      }
      return {};
    }

    function textOf(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    /** Up to 12 printable rows; long values clip like the Host envelopes do. */
    function rowsOf(record) {
      return Object.entries(record)
        .filter((entry) => entry[1] !== undefined && entry[1] !== null)
        .slice(0, 12)
        .map((entry) => {
          const text = textOf(entry[1]);
          return [entry[0], text.length > 200 ? text.slice(0, 200) + '…' : text];
        });
    }

    function Card(title, badge, rows) {
      return h('section', { className: 'dsh-autogamer-card' },
        h('h3', { key: 't' }, title),
        badge ? h('p', { key: 'b' }, h('strong', null, badge)) : null,
        h('dl', { key: 'd' }, rows.flatMap((row) => [
          h('dt', { key: row[0] + '-k' }, row[0]),
          h('dd', { key: row[0] + '-v' }, row[1]),
        ])));
    }

    function pick(record, keys, fallback) {
      for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== '') return String(value);
      }
      return fallback;
    }

    function RunTaskCard(props) {
      const record = recordOf(props);
      return Card(
        'AutoGamer task',
        pick(record, ['status'], 'running'),
        rowsOf(record),
      );
    }

    function ManageCard(props) {
      const record = recordOf(props);
      const current = pick(record, ['current_step'], '?');
      const total = pick(record, ['total_steps'], '?');
      return Card(
        'AutoGamer task state',
        pick(record, ['state'], 'unknown') + ' · step ' + current + '/' + total,
        rowsOf(record),
      );
    }

    function InspectCard(props) {
      const record = recordOf(props);
      const steps = Array.isArray(record.steps) ? record.steps.length : 0;
      return Card(
        'AutoGamer trace',
        pick(record, ['final_status'], 'unknown') + ' · ' + steps + ' steps shown',
        rowsOf(record),
      );
    }

    function DiagnoseCard(props) {
      const record = recordOf(props);
      const crashes = Array.isArray(record.recent_crashes) ? record.recent_crashes.length : 0;
      return Card(
        'AutoGamer diagnosis',
        'adb ' + pick(record, ['adb_connected'], '?') + ' · helper ' +
          pick(record, ['helper_installed'], '?') + ' · crashes ' + crashes,
        rowsOf(record),
      );
    }

    function DeviceStateCard(props) {
      const record = recordOf(props);
      return Card(
        'AutoGamer device state',
        'connected ' + pick(record, ['connected'], '?'),
        rowsOf(record),
      );
    }

    // [wire tool name, cell id, component]. The device-state cell doubles as
    // the DeviceMirror placeholder: with no binary channel upstream, the
    // provider-side screenshot_path renders as a path row (Phase 4 revisits
    // only if a stream transport is ever proven).
    const CELLS = [
      ['autogamer_run_task', 'dsh-autogamer-run-task', RunTaskCard],
      ['autogamer_manage_task', 'dsh-autogamer-manage-task', ManageCard],
      ['autogamer_inspect_trace', 'dsh-autogamer-inspect-trace', InspectCard],
      ['autogamer_diagnose', 'dsh-autogamer-diagnose', DiagnoseCard],
      ['autogamer_get_device_state', 'dsh-autogamer-device-state', DeviceStateCard],
    ];

    return {
      inject: ['slots'],
      apply(ctx) {
        for (const cell of CELLS) {
          const key = cell[0];
          const id = cell[1];
          const component = cell[2];
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
            name: 'tool.call.toolview',
            id,
            order: 10,
            key,
          }, component));
        }
      },
    };
  },
});
