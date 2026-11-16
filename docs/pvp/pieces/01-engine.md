# 01 — PvP hand engine

Status: not started

Depends on: none

Read `docs/pvp/README.md` first. The shuffle, the deal order, and the rank order there are the rules. This piece implements them in TypeScript and checks a fixture into the repo.

## Goal

A pure function that plays one heads-up hand from two reveals and a list of actions, and returns who won.

## Out of scope

The practice game in `src/game/engine.ts` keeps its current behavior. Do not add double, split, insurance, HTTP, database, or Solidity.

## Files

- `src/game/pvp.ts`
- `fixtures/pvp/hands.json`
- `tests/pvp.test.ts`

Use `buildShoe` from `src/game/shoe.ts` and the card helpers in `src/game/cards.ts`. The swap index passed into `buildShoe` has already been reduced with `bigint`.

## Behavior

`playPvp` takes:

- `matchId` as a decimal string
- `sigNewer` and `sigOlder` as 65-byte hex signatures
- `actions` in seat order: `{ seat: 0 | 1, kind: "hit" | "stand" }`

An empty or short action list is an in-progress hand, not an error. The API deals before anyone has acted. Extra actions after the hand is over are rejected.

It returns:

- `done`
- `seatToAct` when the hand is still going
- `draw`: card ids dealt so far, first card first
- `result`: `"newer"`, `"older"`, or `"push"` when `done` is true
- the face-up card ids before each action, with the hole excluded until the dealer plays

Seat 0 is the newer ticket. Seat 1 is the older ticket. A bust, a loss to the dealer, and a dealer blackjack against a non-natural are all rank `lose`. A natural against a dealer who does not have a natural is rank `blackjack`. A normal win is rank `win`. The higher rank wins the pot. Equal ranks push.

A hit on 21 or more is rejected. A hit or stand when it is the other seat's turn is rejected. If the dealer peeks a blackjack, the action list must be empty.

The dealer stands on soft 17.

## Fixture

`fixtures/pvp/hands.json` is version `1`. Each case has `name`, `matchId`, `sigNewer`, `sigOlder`, `actions`, `draw`, and `result`. Include at least:

- newer wins, older loses
- equal ranks, so the pot pushes
- newer has a blackjack and older has a normal win
- both bust
- dealer peeks a blackjack
- a hit that busts the seat that acted

Search for 65-byte signatures that produce each case, then commit those signatures and the draw they produce. The signatures do not need to recover to a wallet. Settlement signatures are piece 04.

## Done when

`npm test` covers the cases above, and the draw arrays in the fixture match a second implementation of the cursor in the test (hash the 162 bytes, then hash the 32-byte cursor per swap). That second hash is the lock that keeps piece 04 honest.

## Handoff

```
Implement docs/pvp/pieces/01-engine.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Do not implement any other PvP piece.
```
