#!/usr/bin/env bash
# Write the public RPS addresses into .env.local. Other keys in that file are left alone.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
JSON="$ROOT/contracts/broadcast/local.json"
RPC="${RPC:-http://127.0.0.1:8545}"
ENV_FILE="$ROOT/.env.local"

if [[ ! -f "$JSON" ]]; then
  echo "Missing $JSON. Run npm run chain:deploy first." >&2
  exit 1
fi

ROOT="$ROOT" JSON="$JSON" RPC="$RPC" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json, os, re
from pathlib import Path

data = json.loads(Path(os.environ["JSON"]).read_text())
rpc = os.environ["RPC"]
updates = {
    "VITE_RPS_CHAIN_ID": str(data["chainId"]),
    "VITE_RPS_RPC_URL": rpc,
    "VITE_RPS_ADDRESS": data["rps"],
    "VITE_USDC_ADDRESS": data["usdc"],
    "RPS_RPC_URL": rpc,
}
path = Path(os.environ["ENV_FILE"])
lines = path.read_text().splitlines() if path.exists() else []
seen = set()
out = []
for line in lines:
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
    if match and match.group(1) in updates:
        key = match.group(1)
        if key not in seen:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        continue
    out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
text = "\n".join(out).rstrip() + "\n"
path.write_text(text)
print(f"wrote {path}")
for key in updates:
    print(f"  {key}={updates[key]}")
PY
