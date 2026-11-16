# PvP build

Heads-up blackjack for USDC. The practice table is unchanged. Nothing in `docs/pvp/` is built yet.

Hand one piece to an agent by giving it this file and that piece. The piece says what to change. This file is the rules those pieces share. If they disagree, this file wins.

## How the system is split

The Hono app stays the only SQL API. It gains `/api/pvp` and a third Postgres database, `freebj_pvp`.

A second process, the chain worker, reads finalized logs and submits transactions. It is TypeScript in this repo, with its own Compose service and its own entry file. The API process does not get the submitter key.

The escrow is Solidity in a Foundry project. That is the only piece that is not TypeScript.

The lineup is a linked list in the escrow, one list per stake tier. Postgres stores a copy of the logs so the page can read position and the hand. The worker rebuilds that copy from the chain if the database is wiped.

There is no Redis, no queue service, and no separate SQL service. Matching is a transaction on the rows that mirror the on-chain list, and the money moves only in the escrow.

## Rules

### Money

USDC has 6 decimals. A tier is one of these amounts, and `join` pulls that exact number of units. The caller does not choose an amount.

| Tier (USDC) | Units |
| --- | --- |
| 20 | 20,000,000 |
| 50 | 50,000,000 |
| 100 | 100,000,000 |
| 1,000 | 1,000,000,000 |
| 5,000 | 5,000,000,000 |
| 10,000 | 10,000,000,000 |

The pot is both stakes. The fee is `pot / 1000` (0.1 percent) and is a constant in the contract. On a 20 USDC hand the pot is 40,000,000 units, the fee is 40,000 units (0.04 USDC), and the winner claims 39,960,000. These tiers divide evenly. The contract still uses integer division.

A push charges no fee. Both stakes are credited back.

Payouts are credits. The wallet calls `claim()` to receive USDC. The contract sets the credit to zero before the token transfer.

The fee recipient and the USDC address are immutable constructor arguments. No function can sweep a player's funds. An owner pause stops new joins. Cancel, refund, settle, and claim keep working.

### Line

Each tier is a linked list. `join` appends to the tail. `cancel` unlinks a ticket that is still queued and credits the stake back. `lockPair(tier)` pairs the head with the next ticket and nobody else. Anyone can call it. The newer ticket (larger queue index, joined later) is seat 0 and acts first. The older ticket is seat 1 and acts second.

A paired match that is not settled within 10 minutes can be refunded by anyone. Both stakes come back and the fee is zero. A stall ends the match and sends that wallet to the tail if they join again. The contract has no forfeit. Proving who withheld a reveal means publishing the seed, and the seed is the shoe.

### Hand

Six decks. Dealer stands on soft 17 and peeks. Blackjack outranks a normal win. The rank order is blackjack, win, push, lose. The higher rank takes the pot. Equal ranks push the pot, including both seats losing.

Hit and stand only. No double, no split, no insurance. The admin table settings do not apply to this table.

The shoe is shuffled from both reveals. Card ids follow `buildShoe` in `src/game/shoe.ts`: deck 0..5, suit `S H D C`, rank `A 2 3 4 5 6 7 8 9 10 J Q K`. Id `deck * 52 + suitIndex * 13 + rankIndex`.

```
cursor = keccak256(sigNewer || sigOlder || matchId)
```

`sigNewer` and `sigOlder` are the 65-byte signatures. `matchId` is a big-endian uint256. The cursor is 162 bytes hashed, then each Fisher-Yates step replaces it with `keccak256` of those 32 bytes. The swap index is `uint256(cursor) % (index + 1)`, from index `311` down to `1`. Deal by popping from the end, the same direction as `draw` in `src/game/engine.ts`. TypeScript must reduce with `bigint` before turning the index into a number.

Deal order:

1. Seat 0, first card
2. Seat 1, first card
3. Dealer up card
4. Seat 0, second card
5. Seat 1, second card
6. Dealer hole card

Further hits pop the next card. If the dealer peeks a blackjack, the hand ends with no seat actions.

Each seat's reveal is a `personal_sign` of this UTF-8 string:

```
freebj:pvp:seed:{chainId}:{escrowAddress}:{ticketId}
```

`escrowAddress` is lowercase hex with a `0x` prefix. `ticketId` is the decimal ticket id. The commit stored at join is `keccak256` of the 65-byte signature. `ecrecover` of the EIP-191 hash must equal the ticket wallet.

Each action is a `personal_sign` over the EIP-191 hash of:

```
keccak256(abi.encode(
  bytes32("freebj.pvp.action.v1"),
  uint256 chainId,
  address escrow,
  uint256 matchId,
  uint32 nonce,
  uint8 seat,
  uint8 kind,
  bytes32 visibleCardsHash
))
```

`kind` is `0` for stand and `1` for hit. `visibleCardsHash` is `keccak256` of the packed card ids that are face up before the action, in deal order, hole excluded. The contract replays the shoe and checks that hash. A transcript whose visible cards differ from the shoe does not settle.

The server sees both reveals during the hand, so it can see the hole. The contract rejects a transcript that does not match the shoe. The page does not receive the opponent's reveal until both seats are finished and either side can submit `settle`.

### Chain

Local games use Anvil, chain id `31337`. The first public network is Base. The worker applies logs only through the RPC `finalized` block. Each log is applied once, keyed by transaction hash and log index.

`PVP_SUBMITTER_KEY` belongs on the worker only. The page ships the escrow address, the USDC address, and the chain id as build-time constants.

## Build order

Pieces at the same level do not share files. Finish the level they depend on before starting them.

| Piece | Level | Depends on | What it adds |
| --- | --- | --- | --- |
| [01 Engine](pieces/01-engine.md) | 0 | none | Two-seat hand and the shared fixture |
| [02 Escrow](pieces/02-escrow.md) | 0 | none | Join, cancel, pair, claim, refund |
| [03 Database](pieces/03-database.md) | 0 | none | `freebj_pvp` and the API pool |
| [04 Settle](pieces/04-settle.md) | 1 | 01, 02 | On-chain replay of a signed hand |
| [05 API](pieces/05-api.md) | 1 | 01, 03 | Wallet session and `/api/pvp` |
| [06 Anvil](pieces/06-anvil.md) | 2 | 04 | Local chain, mock USDC, deploy |
| [08 Page](pieces/08-page.md) | 2 | 04, 05 | `/pvp` |
| [07 Worker](pieces/07-worker.md) | 3 | 03, 04, 06 | Log follower and `lockPair` submitter |
| [09 Compose](pieces/09-compose.md) | 4 | 06, 07, 08 | Containers, env, README run steps |

Level 2 can start the page and Anvil at the same time. The worker waits until Anvil exists so it has an RPC to run against.

## Later

These are out of every piece above.

- Double, which needs a 2× lock
- Split and insurance
- ERC-1271 so a contract wallet can sign actions
- A sealed hole card so the server cannot read it during the hand
- A public-network deploy
- Writing USDC results onto the fake-chip leaderboard

## PR Plan

### PR 1: PvP hand engine and shared fixture

- Files/components affected: src/game/pvp.ts, fixtures/pvp/hands.json, tests/pvp.test.ts
- Dependencies: None
- Description: Implement docs/pvp/pieces/01-engine.md. Follow the hand and shuffle rules in docs/pvp/README.md. Leave the practice engine's behavior in place.

### PR 2: USDC escrow for the queue and the pot

- Files/components affected: contracts/foundry.toml, contracts/src/Escrow.sol, contracts/src/MockUSDC.sol, contracts/test/Escrow.t.sol
- Dependencies: None
- Description: Implement docs/pvp/pieces/02-escrow.md. Money, the linked list, cancel, lockPair, refund, and claim. Do not add settle.

### PR 3: freebj_pvp database

- Files/components affected: docker/initdb/01-databases.sh, src/db/pvp-schema.ts, src/config.ts, src/app-deps.ts, src/index.ts, src/app.ts, .env.example
- Dependencies: None
- Description: Implement docs/pvp/pieces/03-database.md. Third database, schema, pool, and health check. Do not add PvP routes.

### PR 4: On-chain settle of a signed hand

- Files/components affected: contracts/src/Escrow.sol, contracts/test/Settle.t.sol, fixtures/pvp/hands.json
- Dependencies: PR 1, PR 2
- Description: Implement docs/pvp/pieces/04-settle.md. Replay the fixture shoe and pay the rank result. Settle requires the signed transcript.

### PR 5: PvP HTTP API

- Files/components affected: src/routes/pvp.ts, src/repos/pvp.ts, src/auth/pvp-session.ts, src/app.ts, tests/integration/pvp.test.ts
- Dependencies: PR 1, PR 3
- Description: Implement docs/pvp/pieces/05-api.md. Wallet cookie, queue read, reveal, and signed actions. This process does not send transactions.

### PR 6: Local Anvil, mock USDC, deploy

- Files/components affected: docker-compose.yml, contracts/script/Deploy.s.sol, package.json
- Dependencies: PR 4
- Description: Implement docs/pvp/pieces/06-anvil.md. Anvil service, deploy script, faucet. Do not add the chain worker process.

### PR 7: Chain worker

- Files/components affected: src/chain-worker.ts, src/chain/indexer.ts, src/chain/submit.ts, package.json
- Dependencies: PR 3, PR 4, PR 6
- Description: Implement docs/pvp/pieces/07-worker.md. Finalized logs, Postgres copy, lockPair and settle submission. The submitter key stays in this process.

### PR 8: PvP page

- Files/components affected: web/pvp.html, web/src/pvp.ts, web/src/pvp.css, vite.config.ts, src/app.ts
- Dependencies: PR 4, PR 5
- Description: Implement docs/pvp/pieces/08-page.md. Connect, join a tier, wait, play, claim. Contract address and chain id are build-time constants.

### PR 9: Wire PvP into Compose and the README

- Files/components affected: docker-compose.yml, Dockerfile, package.json, .env.example, readme.md
- Dependencies: PR 6, PR 7, PR 8
- Description: Implement docs/pvp/pieces/09-compose.md. Worker container, env, and the local run steps. Do not change the hand rules.
