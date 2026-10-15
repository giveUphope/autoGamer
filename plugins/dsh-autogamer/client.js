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
 * held, which was the evidence that the file had not moved since Phase 3. It has
 * now moved (交付-2, 2026-10-16: the prop path it read did not exist), and the
 * cell count grew from six text assertions to twelve including behaviour locks.
 *
 * The prop contract is MEASURED, not hoped for (2026-10-16, live host: read back
 * from the fiber of a mounted card). `tool.call.toolview` passes the owner props
 * `{callId, toolName, phase, block, openFile, cwd, home, loadImage}` — there is
 * no `result` / `value` / `output` prop. The call's own answer lives inside
 * `block`: `{kind:'tool-result', content:[{type:'text', text}], meta, isError,
 * call:{name, argsRaw}, callTime, subCalls}`. Two of the five tools also get a
 * structured `meta` (`run_task` → {taskId,status}, `manage_task` → {taskId,state});
 * the other three get `null`. Live data channels (polling, controls) still need a
 * mounted proof first; until then every card renders this call's own answer.
 * No custom styling: plain elements inherit the host theme (R18: no Host
 * Client imports, token names unverified, so no style attributes at all).
 */
window.__ModuleLoader__.load({
  id: 'dsh-autogamer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** The one block shape the Host passes this slot; null when props moved on us. */
    function blockOf(props) {
      const block = props && props.block;
      return block && typeof block === 'object' ? block : null;
    }

    /** Our tool's own envelope (`k=v; k=v`) arrives as text; anything unpairable stays one row. */
    function envelopeOf(text) {
      const out = {};
      for (const pair of text.split('; ')) {
        const at = pair.indexOf('=');
        if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
        else if (pair) out.response = (out.response ? out.response + '; ' : '') + pair;
      }
      return out;
    }

    /** `meta` carries the same facts structured; add it only where the envelope has no twin. */
    function addMeta(record, meta) {
      if (!meta || typeof meta !== 'object') return;
      for (const key of Object.keys(meta)) {
        if (record[key] !== undefined) continue;
        if (record[key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] !== undefined) continue;
        record[key] = textOf(meta[key]);
      }
    }

    function recordOf(props) {
      const block = blockOf(props);
      if (!block) return {};
      const texts = (Array.isArray(block.content) ? block.content : [])
        .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text);
      const record = envelopeOf(texts.join('; '));
      addMeta(record, block.meta);
      if (block.isError === true) record.error = texts.join(' ').slice(0, 200) || 'the tool reported an error';
      return record;
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

    function Card(props, title, badge, rows) {
      const block = blockOf(props);
      const phase = props && typeof props.phase === 'string' ? props.phase : '';
      // A card must never dress an error or an unfinished call up as a healthy state.
      const shown = block && block.isError === true ? 'failed' : phase && phase !== 'result' ? phase : badge;
      return h('section', { className: 'dsh-autogamer-card' },
        h('h3', { key: 't' }, title),
        shown ? h('p', { key: 'b' }, h('strong', null, shown)) : null,
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

    // Badges name the keys our own render() actually emits (measured against a live
    // host, 2026-10-16) - a guessed fallback would be a fake health statement.
    function RunTaskCard(props) {
      const record = recordOf(props);
      return Card(
        props,
        'AutoGamer task',
        pick(record, ['status', 'state'], '?'),
        rowsOf(record),
      );
    }

    function ManageCard(props) {
      const record = recordOf(props);
      return Card(
        props,
        'AutoGamer task state',
        pick(record, ['state', 'status'], '?') + (record.steps ? ' · ' + record.steps : ''),
        rowsOf(record),
      );
    }

    function InspectCard(props) {
      const record = recordOf(props);
      return Card(
        props,
        'AutoGamer trace',
        pick(record, ['final_status'], '?') + (record.total_steps ? ' · ' + record.total_steps : ''),
        rowsOf(record),
      );
    }

    function DiagnoseCard(props) {
      const record = recordOf(props);
      return Card(
        props,
        'AutoGamer diagnosis',
        'adb ' + pick(record, ['adb_connected'], '?') + ' · helper ' +
          pick(record, ['helper_installed'], '?') + ' · crashes ' + pick(record, ['recent_crashes'], '?'),
        rowsOf(record),
      );
    }

    function DeviceStateCard(props) {
      const record = recordOf(props);
      return Card(
        props,
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
