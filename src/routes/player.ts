import { randomInt, randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { PoolClient } from 'pg';
import { applyAction, dealRound, takeForfeit, type Rules } from '../game/engine.ts';
import { generateDisplayName } from '../game/names.ts';
import { cutCardThreshold } from '../game/shoe.ts';
import { toRoundView } from '../game/view.ts';
import { HttpError } from '../http/errors.ts';
import { cookieOptions, isUuid, PLAYER_COOKIE } from '../http/cookies.ts';
import { takeToken } from '../http/rate-limit.ts';
import { loadSettings } from '../repos/admin-store.ts';
import {
  applySettlement,
  findSession,
  insertHand,
  insertSession,
  listHistory,
  listLeaderboard,
  lockSession,
  updateSession,
  type SessionRecord,
} from '../repos/sessions.ts';
import type { AdminSettings, GameAction, TableResponse } from '../shared/types.ts';
import { withTx } from '../db/tx.ts';
import type { AppDeps, AppEnv } from '../app-deps.ts';

const ACTIONS = new Set<GameAction>(['hit', 'stand', 'double', 'split', 'insurance', 'decline', 'even_money']);

export function mountPlayer(app: Hono<AppEnv>, deps: AppDeps): void {
  app.get('/api/session', async (c) => {
    const existing = readPlayerId(c);
    if (existing) {
      const session = await findSession(deps.leaderboard, existing);
      if (session) return c.json(await tableResponse(deps, session));
    }
    return c.json(await openSession(c, deps), 201);
  });

  app.post('/api/session', async (c) => c.json(await openSession(c, deps), 201));

  app.post('/api/session/name', async (c) => {
    const name = normalizeDisplayName((await readJson(c) as { displayName?: unknown })?.displayName);
    return withPlayer(c, deps, async (session) => {
      session.displayName = name;
    });
  });

  app.post('/api/session/abandon', (c) =>
    withPlayer(c, deps, async (session, _rules, client) => {
      const forfeited = takeForfeit(session.state);
      if (!forfeited) return;
      applySettlement(session, forfeited);
      await insertHand(client, session.id, forfeited);
    }),
  );

  app.post('/api/bet', async (c) => {
    const amountCents = readAmount(await readJson(c));
    return withPlayer(c, deps, async (session, rules, client) => {
      const result = dealRound(session.state, amountCents, session.bankrollCents, rules, deps.shoeSource);
      session.bankrollCents = result.bankrollCents;
      await recordIfSettled(client, session, result.settled);
    });
  });

  app.post('/api/action', async (c) => {
    const action = readAction(await readJson(c));
    return withPlayer(c, deps, async (session, _rules, client) => {
      const result = applyAction(session.state, action, session.bankrollCents, deps.shoeSource);
      session.bankrollCents = result.bankrollCents;
      await recordIfSettled(client, session, result.settled);
    });
  });

  app.get('/api/leaderboard', async (c) => {
    const id = readPlayerId(c);
    return c.json(await listLeaderboard(deps.leaderboard, id));
  });

  app.get('/api/history', async (c) => {
    const id = readPlayerId(c);
    if (!id) return c.json({ hands: [] });
    const session = await findSession(deps.leaderboard, id);
    if (!session) return c.json({ hands: [] });
    return c.json({ hands: await listHistory(deps.leaderboard, id) });
  });
}

async function openSession(c: Context<AppEnv>, deps: AppDeps): Promise<TableResponse> {
  if (!takeToken(`session:${clientKey(c)}`, 200, 10 * 60 * 1000)) {
    throw new HttpError(429, 'Too many new sessions. Wait a few minutes and try again.');
  }
  const settings = await loadSettings(deps.admin);
  const session = await insertSession(deps.leaderboard, {
    id: randomUUID(),
    displayName: generateDisplayName((max) => randomInt(0, max)),
    bankrollCents: settings.startingBankrollCents,
    state: { v: 1, shoe: [], round: null },
  });
  setCookie(c, PLAYER_COOKIE, session.id, cookieOptions(deps.cookieSecure, 60 * 60 * 24 * 400));
  return tableResponseFrom(session, settings);
}

async function withPlayer(
  c: Context<AppEnv>,
  deps: AppDeps,
  fn: (session: SessionRecord, rules: Rules, client: PoolClient) => Promise<void>,
): Promise<Response> {
  const id = readPlayerId(c);
  if (!id) throw new HttpError(401, 'No session');
  const settings = await loadSettings(deps.admin);
  const rules = rulesFor(settings, deps);
  const session = await withTx(deps.leaderboard, async (client) => {
    const locked = await lockSession(client, id);
    if (!locked) throw new HttpError(401, 'No session');
    if (locked.banned) throw new HttpError(403, 'This session was closed by the house');
    await fn(locked, rules, client);
    await updateSession(client, locked);
    return locked;
  });
  return c.json(tableResponseFrom(session, settings));
}

async function tableResponse(deps: AppDeps, session: SessionRecord): Promise<TableResponse> {
  const settings = await loadSettings(deps.admin);
  return tableResponseFrom(session, settings);
}

function tableResponseFrom(session: SessionRecord, settings: AdminSettings): TableResponse {
  return {
    session: {
      id: session.id,
      displayName: session.displayName,
      bankrollCents: session.bankrollCents,
      peakBankrollCents: session.peakBankrollCents,
      handsPlayed: session.handsPlayed,
      netCents: session.netCents,
      banned: session.banned,
      hiddenFromBoard: session.hiddenFromBoard,
    },
    round: toRoundView(session.state, session.bankrollCents),
    limits: settings,
  };
}

async function recordIfSettled(client: PoolClient, session: SessionRecord, settled: boolean): Promise<void> {
  if (!settled || !session.state.round) return;
  applySettlement(session, session.state.round);
  await insertHand(client, session.id, session.state.round);
}

function rulesFor(settings: AdminSettings, deps: AppDeps): Rules {
  return {
    decks: settings.decks,
    hitSoft17: settings.hitSoft17,
    reshuffleBelow: deps.rulesOverride?.reshuffleBelow ?? cutCardThreshold(settings.decks),
  };
}

function readPlayerId(c: Context): string | null {
  const value = getCookie(c, PLAYER_COOKIE);
  if (!value || !isUuid(value)) return null;
  return value;
}

export function normalizeDisplayName(input: unknown): string {
  if (typeof input !== 'string') throw new HttpError(400, 'Name must be 2 to 24 letters, numbers, and spaces');
  const name = input.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(name) || name.length < 2 || name.length > 24) {
    throw new HttpError(400, 'Name must be 2 to 24 letters, numbers, and spaces');
  }
  return name;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

function readAmount(body: unknown): number {
  if (!body || typeof body !== 'object' || !('amountCents' in body)) {
    throw new HttpError(400, 'amountCents is required');
  }
  const amount = (body as { amountCents: unknown }).amountCents;
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new HttpError(400, 'amountCents must be an integer');
  }
  return amount;
}

function readAction(body: unknown): GameAction {
  if (!body || typeof body !== 'object' || !('type' in body)) throw new HttpError(400, 'Action type is required');
  const type = (body as { type: unknown }).type;
  if (typeof type !== 'string' || !ACTIONS.has(type as GameAction)) throw new HttpError(400, 'Unknown action');
  return type as GameAction;
}

function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return 'local';
  return forwarded.split(',')[0]?.trim() || 'local';
}
