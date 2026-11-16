# 05 — PvP HTTP API

Status: not started

Depends on: 01, 03

Read `docs/pvp/README.md`. Use `playPvp` from `src/game/pvp.ts` for the hand. Read rows from the `pvp` pool. This process does not hold a submitter key and does not send transactions.

## Goal

A wallet can sign in, see the line, post a reveal, and post a signed hit or stand. The response hides the opponent's reveal until both seats are done.

## Out of scope

The page, the worker, and writing chain logs. Tests insert tickets and matches directly.

## Files

- `src/auth/pvp-session.ts`
- `src/repos/pvp.ts`
- `src/routes/pvp.ts`
- `src/app.ts`
- `tests/integration/pvp.test.ts`

## Session

`POST /api/pvp/session` body: `{ address, message, signature, issuedAt }`.

The message is:

```
freebj:pvp:login
{issuedAt}
```

`issuedAt` is ISO time, within five minutes. The recovered address equals `address`. The route sets an HttpOnly cookie, hashed in `pvp_sessions`, for 12 hours. This cookie is not the practice-game cookie and not the admin cookie.

`POST /api/pvp/logout` deletes that row.

## Routes

All of these require the cookie. Addresses are lowercase.

`GET /api/pvp/queue` returns the caller's open ticket, if any, and the six tiers. Each tier includes the queued count and the caller's place, counted as tickets at that tier with `status = 'queued'` and a smaller `queue_index`.

`GET /api/pvp/match/:id` returns the match for a seated wallet. While `status` is `reveal` or `acting`, the body includes that seat's cards, the opponent's face-up cards, the dealer up card, `seatToAct`, and `refundAfter`. It omits the hole and both reveals. When `status` is `ready`, `settled`, or `refunded`, it includes both reveals and the action list so either seat can build a `settle` transaction on the page.

`POST /api/pvp/match/:id/reveal` body: `{ signature }`. The signature must match the README seed string and this ticket's `commit_hash`. Store it in `reveals`. When both reveals exist, deal with `playPvp` and an empty action list. If that result is already `done`, set the match to `ready`. Otherwise set it to `acting`. Store the public state in `state_json`.

`POST /api/pvp/match/:id/action` body: `{ nonce, kind, visibleCommit, signature }`. The cookie wallet must be the seat to act. `nonce` is the next action nonce. Verify the signature against the README action hash, append the row, and advance `state_json` with `playPvp`. A finished hand sets `status` to `ready`.

Reject a reveal or an action for a wallet that is not seated. Reject an action after `refund_after`.

## Tests

Use the same Postgres setup as `tests/integration/play.test.ts`.

- A bad login signature gets 401.
- Queue position counts only queued tickets ahead of the caller.
- A seated wallet cannot read another match.
- The acting response has no hole card and no reveal.
- The ready response has both reveals.
- A hit from the wrong seat gets 400.
- An action that `playPvp` rejects gets 400 and writes no row.

## Done when

`npm test` passes, and `src/` has no chain RPC client and no private key.

## Handoff

```
Implement docs/pvp/pieces/05-api.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Pieces 01 and 03 are already in the tree.
Do not implement any other PvP piece.
```
