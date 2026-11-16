# 09 — Compose and the run steps

Status: not started

Depends on: 06, 07, 08

Read `docs/pvp/README.md`. The processes already build. This piece runs them together and writes down the commands.

## Goal

One Compose file starts Postgres, Anvil, the API, and the chain worker. The README tells a developer how to deploy the escrow and open `/pvp`.

## Out of scope

Hand rules, contract changes, and a public-network deploy.

## Files

- `docker-compose.yml`
- `Dockerfile`
- `package.json`
- `.env.example`
- `readme.md`

## Compose

The app service gains `PVP_DATABASE_URL` pointing at `db:5432/freebj_pvp` with `pvp_user` / `pvp_pass`. It does not receive `PVP_SUBMITTER_KEY`.

The image build produces both `dist/server.mjs` and `dist/chain-worker.mjs`. The app command stays the server. A new `chain` service uses the same image and runs `node dist/chain-worker.mjs`. Its environment is the PvP database URL, chain id `31337`, RPC `http://anvil:8545`, the escrow and USDC addresses, and the submitter key. Depend on `db` and `anvil`.

Keep the existing host port `54329` for local Postgres. Anvil stays on host port `8545`.

`.env.example` lists the new variables. The submitter key example is the first Anvil account, with a comment that this value is for local Anvil only.

## README

Add a short "PvP local" section to `readme.md`:

1. `docker compose up db anvil`
2. `npm run chain:deploy`
3. Mint USDC with the faucet command from piece 06
4. `npm run dev` and `npm run worker`
5. Open `http://localhost:5173/pvp`

`npm run worker` runs the TypeScript worker against the local RPC. Say that a database volume created before `freebj_pvp` existed needs `docker compose down -v`.

Leave the practice-game instructions in place.

## Done when

A fresh checkout can follow that section and reach the `/pvp` connect screen, with the worker logging a cursor against Anvil.

## Handoff

```
Implement docs/pvp/pieces/09-compose.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Pieces 06, 07, and 08 are already in the tree.
Do not change the hand rules.
```
