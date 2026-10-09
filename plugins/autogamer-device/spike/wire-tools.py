"""Pair-compare the captured LLM wire: does the host put tools on the request?

Block header shape in scripts/proxy-dump.log is exactly:
    ===== <iso ts> <METHOD> <path> =====
Splitting on "===== " mis-bounds every block because that header line also ends
with " =====", so parse line-anchored. Run: python -X utf8 spike/wire-tools.py
"""

import json
import re

LOG = r"D:/DEV/autoGamer/plugins/autogamer-device/scripts/proxy-dump.log"
HEADER = re.compile(r"^===== (\S+) (\w+) (\S+) =====\s*$")

with open(LOG, encoding="utf-8", errors="replace") as fh:
    lines = fh.read().split("\n")

blocks = []
current = None
for ln in lines:
    m = HEADER.match(ln)
    if m:
        if current:
            blocks.append(current)
        current = {"ts": m.group(1), "method": m.group(2), "path": m.group(3), "body": []}
    elif current is not None:
        current["body"].append(ln)
if current:
    blocks.append(current)

print(f"blocks parsed: {len(blocks)}")
paths: dict[str, int] = {}
for b in blocks:
    paths[b["path"]] = paths.get(b["path"], 0) + 1
print(f"paths: {paths}")

for b in blocks:
    if "chat/completions" not in b["path"]:
        continue
    text = "\n".join(b["body"])
    resp = text.find("----- response -----")
    req_text = text[:resp] if resp > 0 else text
    start = req_text.find("{")
    if start < 0:
        print(f"{b['ts']}  NO REQUEST BODY")
        continue
    try:
        payload = json.loads(req_text[start:].strip())
    except json.JSONDecodeError as err:
        print(f"{b['ts']}  UNPARSEABLE request body: {err}")
        continue
    tools = payload.get("tools")
    names = []
    if tools:
        for t in tools:
            fn = t.get("function") if isinstance(t, dict) else None
            names.append((fn or {}).get("name") or (t.get("name") if isinstance(t, dict) else "?"))
    msg_count = len(payload.get("messages", []))
    tool_count = len(names) if tools else 0
    print(
        f"{b['ts']}  model={payload.get('model')!s:<24} msgs={msg_count:<3} tools={tool_count:<3} "
        f"payload-keys={sorted(payload.keys())}"
    )
    if names:
        print(f"      ALL: {', '.join(sorted(n for n in names if n))}")
    if "tool_choice" in payload:
        print(f"      tool_choice={payload['tool_choice']!r}")
