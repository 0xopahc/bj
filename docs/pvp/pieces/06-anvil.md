# 06 — Local Anvil

Status: not started

Depends on: 04

Read `docs/pvp/README.md`. The escrow and `MockUSDC` already exist.

## Goal

`docker compose up anvil` gives a chain at `127.0.0.1:8545`, with the escrow and mock USDC deployed, and a faucet a developer can call.

## Out of scope

The chain worker, the page, and a public-network deploy.

## Files

- `contracts/script/Deploy.s.sol`
- `docker-compose.yml`
- `package.json`

## Chain

Anvil service, chain id `31337`, host port `8545`. Use a Foundry image that can run `anvil`. Fund the first Anvil account and use its well-known private key only in this local script.

`Deploy.s.sol` deploys `MockUSDC`, then `Escrow` with that token, a fee recipient set to the second Anvil account, and the deployer as the pause owner. It writes the two addresses to `contracts/broadcast/local.json`:

```json
{ "chainId": 31337, "usdc": "0x...", "escrow": "0x..." }
```

Add an npm script `chain:deploy` that runs that Forge script against `http://127.0.0.1:8545`. `MockUSDC.mint` is the faucet. Document the cast or Forge command that mints 100,000 USDC (`100_000_000_000` units) to an address passed as an argument.

Compose starts Anvil. It does not deploy on every `up`. Deploy is the npm script, run once per fresh Anvil state.

## Done when

After `docker compose up anvil` and `npm run chain:deploy`, a `cast call` of the escrow's USDC address matches `local.json`, and a mint increases the mock balance.

## Handoff

```
Implement docs/pvp/pieces/06-anvil.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Piece 04 is already in the tree.
Do not implement any other PvP piece.
```
