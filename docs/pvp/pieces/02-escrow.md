# 02 — USDC escrow

Status: not started

Depends on: none

Read `docs/pvp/README.md` first. This piece locks the stakes and runs the line. It does not deal cards.

## Goal

A Foundry escrow that can take USDC, form a FIFO pair, refund a stalled pair, and pay credits back through `claim`.

## Out of scope

`settle`, the hand replay, the TypeScript worker, and the page. Piece 04 adds `settle` to this contract.

## Files

- `contracts/foundry.toml`
- `contracts/src/Escrow.sol`
- `contracts/src/MockUSDC.sol`
- `contracts/test/Escrow.t.sol`

Use OpenZeppelin for `SafeERC20`, `ReentrancyGuard`, and a pause that covers `join` only. Install it with Forge.

## Contract

Constructor arguments, all immutable except the pause owner:

- USDC token
- fee recipient
- owner, used only for pause and unpause

`join(tier, commit)` pulls `tier` units with `transferFrom`. `joinWithAuthorization` calls the token's `transferWithAuthorization` and requires `from == msg.sender`, `to == address(this)`, and `value == tier`. Unknown tiers revert. `commit` is the `bytes32` the wallet will reveal in piece 04.

Ticket ids start at 1. Each tier has a head and a tail. `cancel(ticketId)` works only for the ticket wallet, and only while the ticket is queued. It unlinks the ticket, including when it is the head or the tail, and credits the full stake to that wallet.

`lockPair(tier)` pairs the head with `head.next` when both are queued. The newer ticket is the next node. The older ticket is the head. It stores `pairedAt`. Anyone can call it. A second pair of the same tickets reverts.

`refundMatch(matchId)` works when `block.timestamp > pairedAt + 10 minutes` and the match is not settled. It credits both stakes and emits `Refunded`. The fee is zero.

`claim()` sends `claimable[msg.sender]` and sets that balance to zero before the token call.

Events: `Queued`, `Cancelled`, `Paired`, `Refunded`, `Claimed`. `Paired` carries the match id, both ticket ids, the tier, and the refund time.

`MockUSDC` has 6 decimals, `mint`, a normal transfer, and `transferWithAuthorization` with a used-nonce mapping. It is a test token, not a production USDC.

## Tests

Forge tests for:

- every tier amount, and a revert on an unknown tier
- fee is not taken on cancel or refund
- cancel of the head, the tail, and a middle ticket
- `lockPair` reverts when given a tier whose head has no partner, and it never skips the head
- refund reverts before 10 minutes and credits both wallets after it
- double `claim` pays once
- a token that calls back into `claim` does not pay twice
- pause blocks `join` and still allows cancel, refund, and claim
- the EIP-3009 path pulls the tier once and rejects a signature for a different amount

## Done when

`forge test` passes. The contract has no `settle` and no admin withdraw.

## Handoff

```
Implement docs/pvp/pieces/02-escrow.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Do not implement any other PvP piece.
```
