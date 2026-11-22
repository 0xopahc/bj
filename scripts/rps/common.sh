# Shared helpers for the local Anvil checks. Source this file. Do not execute it.
# The keys are Anvil's published defaults. They are for chain id 31337 only.

if [[ -z "${BASH_SOURCE[0]:-}" ]]; then
  echo "source scripts/rps/common.sh from another script" >&2
  exit 1
fi

_RPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$_RPS_DIR/../.." && pwd)
RPC="${RPC:-http://127.0.0.1:8545}"
CONTRACTS="$ROOT/contracts"

ALICE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BOB_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
FEE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

require_anvil() {
  local id
  if ! id=$(cast chain-id --rpc-url "$RPC" 2>/dev/null); then
    echo "Anvil is not answering at $RPC" >&2
    exit 1
  fi
  if [[ "$id" != "31337" ]]; then
    echo "Refusing to run against chain id $id. Start Anvil with --chain-id 31337." >&2
    exit 1
  fi
}

assert_eq() {
  local got="$1" expected="$2" label="$3"
  if [[ "$got" != "$expected" ]]; then
    echo "FAIL $label" >&2
    echo "  got      $got" >&2
    echo "  expected $expected" >&2
    exit 1
  fi
  echo "ok  $label"
}

# forge create --json, then print the deployed address.
deploy() {
  local file="$1" name="$2" key="$3"
  shift 3
  local out
  out=$(forge create "$file:$name" \
    --root "$CONTRACTS" \
    --rpc-url "$RPC" \
    --private-key "$key" \
    --broadcast \
    --json \
    "$@")
  python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])' <<<"$out"
}

send_ok() {
  local key="$1" to="$2"
  shift 2
  local out
  out=$(cast send --json --rpc-url "$RPC" --private-key "$key" "$to" "$@")
  python3 -c 'import json,sys; d=json.load(sys.stdin); status=d.get("status"); assert status in ("0x1", 1, "1"), d' <<<"$out"
}

expect_revert() {
  local label="$1"
  shift
  if "$@" >/tmp/rps-revert.out 2>&1; then
    echo "FAIL $label: transaction succeeded" >&2
    cat /tmp/rps-revert.out >&2
    exit 1
  fi
  echo "ok  $label"
}

# Decimal return value of a cast call. Cast prints `75000000[7.5e7]`; keep the integer.
call_uint() {
  cast call --rpc-url "$RPC" "$@" | sed -E 's/\[.*$//' | tr -d '[:space:]'
}

wallet() {
  cast wallet address --private-key "$1"
}
