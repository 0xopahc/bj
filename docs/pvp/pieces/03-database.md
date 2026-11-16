# 03 — freebj_pvp database

Status: not started

Depends on: none

Read `docs/pvp/README.md` first. Copy the pattern in `docker/initdb/01-databases.sh` and `src/db/schema.ts`.

## Goal

A third database and login, applied on boot, with a pool the API can ping.

## Out of scope

PvP routes, the worker, and contract calls. Do not write PvP rows into `freebj_leaderboard`.

## Files

- `docker/initdb/01-databases.sh`
- `src/db/pvp-schema.ts`
- `src/config.ts`
- `src/app-deps.ts`
- `src/index.ts`
- `src/app.ts`
- `.env.example`

## Database

Role `pvp_user` with password `pvp_pass`. Database `freebj_pvp`, owned by that role. Revoke public connect, then grant connect to `pvp_user` only. `leaderboard_user` and `admin_user` cannot connect.

Local URL:

```
postgres://pvp_user:pvp_pass@127.0.0.1:54329/freebj_pvp
```

Add `PVP_DATABASE_URL` to config and `.env.example`. `AppDeps` gains a `pvp` pool. `/api/health` runs `SELECT 1` on it.

Existing volumes skip `docker-entrypoint-initdb.d`. Document that a database created before this change needs `docker compose down -v` before the new role appears. Do not put a migration framework in this piece.

## Tables

Money columns are `BIGINT` units. Status values are the check constraints below.

```sql
CREATE TABLE chain_cursors (
  chain_id BIGINT PRIMARY KEY,
  last_finalized_block BIGINT NOT NULL
);

CREATE TABLE chain_logs (
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  event_name TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE tickets (
  chain_id BIGINT NOT NULL,
  contract TEXT NOT NULL,
  id BIGINT NOT NULL,
  wallet TEXT NOT NULL,
  tier_units BIGINT NOT NULL,
  commit_hash TEXT NOT NULL,
  queue_index BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'paired', 'closed')),
  join_tx TEXT NOT NULL,
  match_id BIGINT,
  queued_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, contract, id)
);

CREATE INDEX tickets_line_idx ON tickets (chain_id, contract, tier_units, status, queue_index);

CREATE TABLE matches (
  chain_id BIGINT NOT NULL,
  contract TEXT NOT NULL,
  id BIGINT NOT NULL,
  tier_units BIGINT NOT NULL,
  ticket_newer BIGINT NOT NULL,
  ticket_older BIGINT NOT NULL,
  wallet_newer TEXT NOT NULL,
  wallet_older TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reveal', 'acting', 'ready', 'settled', 'refunded')),
  seat_to_act SMALLINT,
  refund_after TIMESTAMPTZ NOT NULL,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT CHECK (result IN ('newer', 'older', 'push')),
  fee_units BIGINT,
  payout_newer BIGINT,
  payout_older BIGINT,
  settle_tx TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract, id)
);

CREATE TABLE reveals (
  chain_id BIGINT NOT NULL,
  contract TEXT NOT NULL,
  ticket_id BIGINT NOT NULL,
  signature TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract, ticket_id)
);

CREATE TABLE actions (
  chain_id BIGINT NOT NULL,
  contract TEXT NOT NULL,
  match_id BIGINT NOT NULL,
  nonce INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  seat SMALLINT NOT NULL CHECK (seat IN (0, 1)),
  kind TEXT NOT NULL CHECK (kind IN ('hit', 'stand')),
  visible_commit TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract, match_id, nonce)
);

CREATE TABLE claims (
  chain_id BIGINT NOT NULL,
  contract TEXT NOT NULL,
  match_id BIGINT NOT NULL,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('win', 'refund', 'fee')),
  amount_units BIGINT NOT NULL,
  claim_tx TEXT,
  PRIMARY KEY (chain_id, contract, match_id, wallet, kind)
);

CREATE TABLE pvp_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
```

`src/db/pvp-schema.ts` exports this SQL. Boot calls the existing `migrate` helper.

## Done when

A fresh `docker compose up db` creates the role and the tables, the API refuses to boot without `PVP_DATABASE_URL`, and `/api/health` fails when that database is down.

## Handoff

```
Implement docs/pvp/pieces/03-database.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Do not implement any other PvP piece.
```
