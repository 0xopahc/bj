# 08 — PvP page

Status: not started

Depends on: 04, 05

Read `docs/pvp/README.md`. The page is a third Vite entry, next to `web/admin.html`. Use `viem` if piece 07 has not added it yet. Keep a single `viem` dependency.

## Goal

`/pvp` connects a wallet, joins one tier, waits in line, plays hit and stand, and sends `claim`.

## Out of scope

The worker, new hand rules, and a wallet-connect library beyond `viem` and `window.ethereum`.

## Files

- `web/pvp.html`
- `web/src/pvp.ts`
- `web/src/pvp.css`
- `vite.config.ts`
- `src/app.ts`

Add the HTML entry in `vite.config.ts`. Serve `/pvp` from `mountStatic` the same way as `/admin`.

Build-time constants: `PVP_CHAIN_ID`, `PVP_ESCROW_ADDRESS`, `PVP_USDC_ADDRESS`. Read them from `import.meta.env`. The page does not fetch the contract address from the API.

## Screen

1. Connect. If the wallet is on another chain, ask for the configured chain.
2. Login by signing the piece 05 login message, then `POST /api/pvp/session`.
3. Six buttons, labeled `20`, `50`, `100`, `1000`, `5000`, and `10000` USDC. Show the mock or real USDC balance. Joining signs the seed message from the README, stores the signature in `localStorage` under the ticket id, and sends `joinWithAuthorization` when the wallet can sign EIP-3009. Otherwise it approves that tier only and sends `join`.
4. Poll `GET /api/pvp/queue` about once a second. Show the place in line. Cancel sends `cancel` and then `claim`.
5. On a match, poll `GET /api/pvp/match/:id`. Show both face-up hands and the dealer up card. Hit and stand sign the action hash and `POST` it. The hole stays hidden until the match is `ready`.
6. At `ready`, either seat can send `settle` with the reveals and actions from the API, then `claim`. Show the fee on a win and a zero fee on a push.

The practice table at `/` is unchanged.

## Done when

With the API and Anvil running, a developer can mint USDC, join a tier, and see the queue position move. A scripted second wallet can complete a hand through claim. `npm run typecheck` passes.

## Handoff

```
Implement docs/pvp/pieces/08-page.md in /home/andowens/projects/free-bj.
The shared rules are docs/pvp/README.md. Pieces 04 and 05 are already in the tree.
Do not implement any other PvP piece.
```
