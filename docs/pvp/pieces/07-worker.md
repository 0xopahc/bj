# 07 — Chain worker

Status: not started

Depends on: 03, 04, 06

Read `docs/pvp/README.md`. The worker is a second process in this repo. It uses `viem`. Add that dependency here.

## Goal

Follow finalized escrow logs into `freebj_pvp`, and submit `lockPair` when the two oldest queued tickets are the on-chain head and the next ticket. Submit `settle` when a match is `ready` and both reveals and the action signatures are stored.

## Out of scope

The page, new HTTP routes, and any key on the API process. Do not invent a queue broker.

## Files

- `src/chain-worker.ts`
- `src/chain/indexer.ts`
- `src/chain/submit.ts`
- `package.json`

`package.json` builds a second esbuild entry, `dist/chain-worker.mjs`, from `src/chain-worker.ts`. The API build stays `dist/server.mjs`.

## Loop

Environment: `PVP_DATABASE_URL`, `PVP_CHAIN_ID`, `PVP_RPC_URL`, `PVP_ESCROW_ADDRESS`, `PVP_USDC_ADDRESS`, `PVP_SUBMITTER_KEY`. Missing any of these exits the process.

One leader at a time, with `pg_try_advisory_lock(704163)`. If the lock is taken, this process waits and tries again. It does not start a second follower.

Read logs from `chain_cursors.last_finalized_block + 1` through the RPC `finalized` block. On chain id `31337`, follow `latest` when `finalized` does not advance. Insert `chain_logs` on `(tx_hash, log_index)`. A duplicate log does nothing. Apply `Queued`, `Cancelled`, `Paired`, `Refunded`, and `Settled` onto `tickets`, `matches`, and `claims`. Wallet text is lowercase. Amounts stay integers.

`Queued` inserts a ticket with `status = 'queued'`. `Cancelled` and `Settled` and `Refunded` set the tickets to `closed` and set the match status. `Paired` inserts the match with `status = 'reveal'` and `refund_after` from the event.

Then, for each tier, if the two smallest `queue_index` rows with `status = 'queued'` exist, submit `lockPair(tier)`. A revert because someone else paired them is logged and ignored.

For each match in `ready` with both reveals and a full action list, submit `settle` with the stored signatures. A revert is logged. The row changes when the `Settled` log arrives, not when the transaction is sent.

Sleep a few seconds between passes. Log the cursor. Do not log signatures or the submitter key.

## Done when

Against the piece 06 Anvil, a `join` transaction becomes a `tickets` row after finality, two joins at one tier produce a `Paired` log submitted by the worker, and a ready match in the database produces a `settle` transaction. `npm run typecheck` passes.

## Handoff

```
Implement docs/pvp/pieces/07-worker.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Pieces 03, 04, and 06 are already in the tree.
Do not implement any other PvP piece.
```
