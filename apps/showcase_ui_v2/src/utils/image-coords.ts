/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 从 Angular `utils/image-overlay.util.ts` 平移的纯坐标/动作解包函数（M2 子集）。
 * canvas 叠加绘制部分（drawActionCoordinatesOnOverlay 等）随 M4 播放器一起平移。
 */

/**
 * Unwrap Flash (`payload.args`) and Pro (`payload.action`) traces.
 * Preserve trace metadata and leave plain action objects unchanged.
 */
export function unwrapTraceAction(record: any): any {
  if (!record || typeof record !== 'object' || !record.payload) return record;

  let payload = record.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return record;
    }
  }
  if (!payload || typeof payload !== 'object') return record;

  const asObject = (v: any) => (Array.isArray(v) ? v[0] : v);
  const candidates = [asObject(payload.args?.action), asObject(payload.action), asObject(payload.args)];
  const inner = candidates.find(c => c && typeof c === 'object');
  if (!inner) return record;

  return {
    ...record,
    ...inner,
    args: (record.args && typeof record.args === 'object') ? record.args : inner,
    name: record.name || inner.action || inner.name,
    action: inner.action || record.name,
    trace_id: record.trace_id,
    timestamp: record.timestamp ?? inner.timestamp
  };
}

/**
 * Helper to parse any coordinate representation into an array of numbers.
 * Handles:
 * - [x, y] or [x1, y1, x2, y2]
 * - "[[x1, y1], [x2, y2]]" or [[x1, y1], [x2, y2]]
 * - "[920, 290, 920, 180]" or "920 290 920 180" or "920, 290, 920, 180"
 * - "(920, 290, 920, 180)"
 */
export function extractNumbersFromCoordinateValue(val: any): number[] | null {
  if (val === null || val === undefined) return null;

  if (Array.isArray(val)) {
    if (val.length === 4 && val.every(v => typeof v === 'number' && !isNaN(v))) {
      return val;
    }
    if (val.length === 2 && val.every(v => typeof v === 'number' && !isNaN(v))) {
      return val;
    }
    if (val.length === 2 && Array.isArray(val[0]) && Array.isArray(val[1])) {
      const p1 = extractNumbersFromCoordinateValue(val[0]);
      const p2 = extractNumbersFromCoordinateValue(val[1]);
      if (p1 && p2 && p1.length === 2 && p2.length === 2) {
        return [p1[0], p1[1], p2[0], p2[1]];
      }
    }
    const flattened: number[] = [];
    for (const item of val) {
      if (typeof item === 'number' && !isNaN(item)) {
        flattened.push(item);
      } else if (typeof item === 'string') {
        const matches = item.match(/-?\d+(?:\.\d+)?/g);
        if (matches) {
          matches.forEach(m => flattened.push(Number(m)));
        }
      } else if (Array.isArray(item)) {
        const sub = extractNumbersFromCoordinateValue(item);
        if (sub) flattened.push(...sub);
      }
    }
    if (flattened.length === 4 || flattened.length === 2) {
      return flattened;
    }
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      const res = extractNumbersFromCoordinateValue(parsed);
      if (res) return res;
    } catch {
      // 非 JSON 字符串，退回到数字提取
    }

    const matches = trimmed.match(/-?\d+(?:\.\d+)?/g);
    if (matches && (matches.length === 4 || matches.length === 2)) {
      return matches.map(m => Number(m));
    }
  }

  return null;
}

/**
 * Parse sequence of coordinates (e.g. [[x1, y1], [x2, y2]] or stringified format)
 */
export function parseSequenceCoordinates(seq: any): number[][] | null {
  if (!seq) return null;
  if (typeof seq === 'string') {
    const trimmed = seq.trim();
    try {
      const parsed = JSON.parse(trimmed);
      const res = parseSequenceCoordinates(parsed);
      if (res && res.length > 0) return res;
    } catch {
      // 非 JSON 字符串，退回到配对正则
    }

    const pairs: number[][] = [];
    const pairRegex = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(trimmed)) !== null) {
      pairs.push([Number(m[1]), Number(m[2])]);
    }
    if (pairs.length > 0) return pairs;
  }

  if (Array.isArray(seq)) {
    const points: number[][] = [];
    for (const item of seq) {
      const p = extractNumbersFromCoordinateValue(item);
      if (p && p.length === 2) {
        points.push([p[0], p[1]]);
      } else if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number' && typeof item[1] === 'number') {
        points.push([item[0], item[1]]);
      }
    }
    if (points.length > 0) return points;
  }
  return null;
}

export function isPureDirectionString(str: any): boolean {
  if (typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  if (/\d/.test(s)) return false;
  return [
    'up', 'down', 'left', 'right',
    'swipe up', 'swipe down', 'swipe left', 'swipe right',
    'scroll up', 'scroll down', 'scroll left', 'scroll right',
    'top', 'bottom'
  ].includes(s);
}
