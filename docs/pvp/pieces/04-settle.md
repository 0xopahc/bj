# 04 — On-chain settle

Status: not started

Depends on: 01, 02

Read `docs/pvp/README.md` and `fixtures/pvp/hands.json`. Piece 01 owns the shuffle. This piece replays that shuffle in the escrow and pays the result.

## Goal

`settle` checks both reveals and the signed actions, deals the shoe, and credits the winner minus `pot / 1000`. A push credits both stakes and a zero fee.

## Out of scope

The worker, the page, and new hand rules. Do not add double, split, or a forfeit.

## Files

- `contracts/src/Escrow.sol`
- `contracts/test/Settle.t.sol`

Read the fixture from `fixtures/pvp/hands.json`. Forge can read it with `vm.readFile` and `vm.parseJson`. If a case's draw or result disagrees with the contract, fix the contract. Do not edit the fixture to match a different shuffle.

## Settle

```solidity
function settle(uint64 matchId, bytes sigNewer, bytes sigOlder, Action[] actions) external;
```

`Action` is `{ uint8 seat; uint8 kind; bytes sig; }`. `kind` is `0` stand or `1` hit.

Checks:

- The match is paired, not refunded, and not settled.
- `keccak256(sigNewer)` equals the newer ticket commit, and the same for the older ticket.
- `ecrecover` of each reveal's EIP-191 hash returns that ticket's wallet. The signed string is in the README.
- Each action signature recovers to that seat's wallet, over the action hash in the README.
- `visibleCardsHash` inside that signature matches the cards that are face up before the action.
- The seat to act matches the deal. After both seats stand or bust, the dealer plays and stands on soft 17.
- A dealer peek ends the hand with an empty action list.
- A second `settle` reverts.
- `refundMatch` reverts after a successful settle.

Credits:

- Winner: `pot - pot / 1000`. Fee recipient: `pot / 1000`.
- Push: each seat is credited their stake. Fee recipient is credited 0.
- Result event `Settled(matchId, result, fee)` where `result` is `0` newer, `1` older, `2` push.

`claim` from piece 02 is how the USDC leaves.

## Tests

- Every fixture case: the contract's draw equals `draw`, and the paid result equals `result`.
- A swapped visible card makes `settle` revert.
- A signature from the wrong seat reverts.
- Settle on a 20 USDC tier credits `39_960_000` to the winner and `40_000` to the fee recipient.
- A push credits `20_000_000` to each seat.
- Refund after the deadline reverts once the match is settled.
- Replay of the same `settle` reverts.

Use `vm.sign` for the signature tests. The fixture seeds can stay opaque for the draw check. Add one extra Solidity case with known Anvil keys so `ecrecover` is covered.

## Done when

`forge test` passes, including the piece 02 tests.

## Handoff

```
Implement docs/pvp/pieces/04-settle.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Pieces 01 and 02 are already in the tree.
Do not implement any other PvP piece.
```
