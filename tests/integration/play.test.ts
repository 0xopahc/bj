import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { card } from '../../src/game/cards.ts';
import type { Card } from '../../src/game/cards.ts';
import type { LeaderboardResponse, TableResponse } from '../../src/shared/types.ts';
import {
  closePools,
  getPools,
  login,
  makeApp,
  openSession,
  orderedShoe,
  resetSettings,
  send,
} from '../support.ts';

const START = 10_000_000;

function tableOf(json: Record<string, unknown> | null): TableResponse {
  if (!json || !('session' in json)) throw new Error(`expected a table response: ${JSON.stringify(json)}`);
  return json as unknown as TableResponse;
}

function boardOf(json: Record<string, unknown> | null): LeaderboardResponse {
  if (!json || !('leaders' in json)) throw new Error(`expected a leaderboard: ${JSON.stringify(json)}`);
  return json as unknown as LeaderboardResponse;
}

function containsCard(value: unknown, rank: string, suit: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsCard(item, rank, suit));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.rank === rank && record.suit === suit) return true;
  return Object.values(record).some((item) => containsCard(item, rank, suit));
}

function shoe(...cards: Card[]): Card[] {
  return orderedShoe(cards);
}

describe('player sessions against postgres', () => {
  beforeEach(async () => {
    const pools = await getPools();
    await resetSettings(pools.admin);
  });

  afterAll(async () => {
    await closePools();
  });

  it('keeps the house tables out of the leaderboard database', async () => {
    const pools = await getPools();
    const leaderboard = await pools.leaderboard.query<{ rel: string | null }>(
      "SELECT to_regclass('public.admin_users') AS rel",
    );
    const admin = await pools.admin.query<{ rel: string | null }>("SELECT to_regclass('public.sessions') AS rel");
    const sessions = await pools.leaderboard.query<{ rel: string | null }>(
      "SELECT to_regclass('public.sessions') AS rel",
    );
    const users = await pools.admin.query<{ rel: string | null }>("SELECT to_regclass('public.admin_users') AS rel");
    expect(leaderboard.rows[0]?.rel).toBeNull();
    expect(admin.rows[0]?.rel).toBeNull();
    expect(sessions.rows[0]?.rel).toBe('sessions');
    expect(users.rows[0]?.rel).toBe('admin_users');
  });

  it('opens a $100,000 session and keeps the old cookie when a new one is dealt', async () => {
    const app = makeApp(await getPools());
    const health = await send(app, '/api/health');
    expect(health.response.status).toBe(200);
    expect(health.json).toEqual({ ok: true });
    expect(health.response.headers.get('cache-control')).toContain('no-store');

    const opened = await openSession(app);
    expect(opened.table.session.bankrollCents).toBe(START);
    expect(opened.table.session.peakBankrollCents).toBe(START);
    expect(opened.table.round).toBeNull();
    expect(opened.cookie).toContain('fbj_session=');

    const resumed = await send(app, '/api/session', undefined, opened.cookie);
    expect(resumed.response.status).toBe(200);
    expect(tableOf(resumed.json).session.id).toBe(opened.table.session.id);

    const created = await send(app, '/api/session', {}, opened.cookie);
    expect(created.response.status).toBe(201);
    const next = tableOf(created.json);
    expect(next.session.id).not.toBe(opened.table.session.id);

    const stillOld = await send(app, '/api/session', undefined, opened.cookie);
    expect(tableOf(stillOld.json).session.id).toBe(opened.table.session.id);
    expect(tableOf(stillOld.json).session.bankrollCents).toBe(START);
  });

  it('rejects a bet with no session and does not take chips for an illegal bet', async () => {
    const app = makeApp(await getPools());
    const missing = await send(app, '/api/bet', { amountCents: 500 });
    expect(missing.response.status).toBe(401);

    const opened = await openSession(app);
    const early = await send(app, '/api/action', { type: 'stand' }, opened.cookie);
    expect(early.response.status).toBe(409);

    const tooBig = await send(app, '/api/bet', { amountCents: 20_000_000 }, opened.cookie);
    expect(tooBig.response.status).toBe(400);
    expect(String(tooBig.json?.error)).toMatch(/stack/);

    const coins = await send(app, '/api/bet', { amountCents: 50 }, opened.cookie);
    expect(coins.response.status).toBe(400);
    expect(String(coins.json?.error)).toMatch(/whole dollars/);

    const after = await send(app, '/api/session', undefined, opened.cookie);
    const table = tableOf(after.json);
    expect(table.session.bankrollCents).toBe(START);
    expect(table.round).toBeNull();

    const admin = await login(app);
    const detail = await send(app, `/admin/api/sessions/${table.session.id}`, undefined, admin);
    expect(detail.response.status).toBe(200);
    expect(detail.json?.shoeRemaining).toBe(0);
  });

  it('pays 3 to 2, keeps the peak after a later loss, and lists that session', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [
        shoe(card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H')),
        shoe(card('9', 'S'), card('10', 'D'), card('8', 'C'), card('A', 'S')),
      ],
    });
    const opened = await openSession(app);
    const named = await send(app, '/api/session/name', { displayName: 'Peak Runner' }, opened.cookie);
    expect(named.response.status).toBe(200);

    const blackjack = tableOf((await send(app, '/api/bet', { amountCents: 2_000 }, opened.cookie)).json);
    expect(blackjack.round?.description).toContain('3 to 2');
    expect(blackjack.round?.netCents).toBe(3_000);
    expect(blackjack.session.bankrollCents).toBe(START + 3_000);
    expect(blackjack.session.peakBankrollCents).toBe(START + 3_000);

    const loss = tableOf((await send(app, '/api/bet', { amountCents: 2_000 }, opened.cookie)).json);
    expect(loss.round?.description).toBe('Dealer has blackjack.');
    expect(loss.session.bankrollCents).toBe(START + 1_000);
    expect(loss.session.peakBankrollCents).toBe(START + 3_000);
    expect(loss.session.handsPlayed).toBe(2);

    const board = boardOf((await send(app, '/api/leaderboard', undefined, opened.cookie)).json);
    expect(board.you?.displayName).toBe('Peak Runner');
    expect(board.you?.peakBankrollCents).toBe(START + 3_000);
    expect(board.leaders.some((row) => row.displayName === 'Peak Runner')).toBe(true);
    expect(JSON.stringify(board)).not.toContain(blackjack.session.id);
  });

  it('hides the hole card from the player and shows it to the house', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 0,
      shoes: [shoe(card('10', 'S'), card('A', 'H'), card('9', 'C'), card('Q', 'D'), card('5', 'S'))],
    });
    const opened = await openSession(app);
    const dealt = await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    const view = tableOf(dealt.json);
    expect(view.round?.phase).toBe('insurance');
    expect(view.round?.dealerCards[1]).toEqual({ hidden: true });
    expect(containsCard(dealt.json, 'Q', 'D')).toBe(false);
    expect(JSON.stringify(dealt.json)).not.toContain('"shoe"');

    const history = await send(app, '/api/history', undefined, opened.cookie);
    expect(history.json).toEqual({ hands: [] });
    expect(JSON.stringify(history.json)).not.toContain('detail');

    const admin = await login(app);
    const detail = await send(app, `/admin/api/sessions/${view.session.id}`, undefined, admin);
    expect(detail.response.status).toBe(200);
    expect(containsCard(detail.json, 'Q', 'D')).toBe(true);
  });

  it('finishes a hand from the shoe stored on the session', async () => {
    const pools = await getPools();
    const first = makeApp(pools, {
      reshuffleBelow: 0,
      shoes: [shoe(card('10', 'S'), card('10', 'D'), card('6', 'C'), card('K', 'H'), card('5', 'D'))],
    });
    const opened = await openSession(first);
    const dealt = tableOf((await send(first, '/api/bet', { amountCents: 1_000 }, opened.cookie)).json);
    expect(dealt.round?.phase).toBe('player');
    expect(dealt.round?.dealerCards[0]).toEqual({ rank: '10', suit: 'D' });
    expect(dealt.round?.dealerCards[1]).toEqual({ hidden: true });
    expect(containsCard(dealt, 'K', 'H')).toBe(false);

    const second = createApp({
      leaderboard: pools.leaderboard,
      admin: pools.admin,
      cookieSecure: false,
      shoeSource: () => {
        throw new Error('shoe should have been persisted');
      },
      rulesOverride: { reshuffleBelow: 0 },
    });
    const resumed = tableOf((await send(second, '/api/session', undefined, opened.cookie)).json);
    expect(resumed.round?.dealerCards[0]).toEqual({ rank: '10', suit: 'D' });
    expect(containsCard(resumed, 'K', 'H')).toBe(false);

    const hit = await send(second, '/api/action', { type: 'hit' }, opened.cookie);
    expect(hit.response.status).toBe(200);
    const won = tableOf(hit.json);
    expect(won.round?.hands[0]?.cards.map((dealtCard) => dealtCard.rank)).toEqual(['10', '6', '5']);
    expect(won.round?.netCents).toBe(1_000);
    expect(won.session.bankrollCents).toBe(START + 1_000);
    expect(containsCard(won, 'K', 'H')).toBe(true);
  });

  it('records a forfeit as a loss and leaves the bet with the house', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 0,
      shoes: [shoe(card('10', 'S'), card('9', 'D'), card('6', 'C'), card('7', 'H'))],
    });
    const opened = await openSession(app);
    const dealt = tableOf((await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie)).json);
    expect(dealt.session.bankrollCents).toBe(START - 1_000);
    expect(dealt.round?.phase).toBe('player');

    const abandoned = await send(app, '/api/session/abandon', {}, opened.cookie);
    const table = tableOf(abandoned.json);
    expect(table.round).toBeNull();
    expect(table.session.bankrollCents).toBe(START - 1_000);
    expect(table.session.handsPlayed).toBe(1);
    expect(table.session.netCents).toBe(-1_000);
    expect(table.session.peakBankrollCents).toBe(START);

    const history = await send(app, '/api/history', undefined, opened.cookie);
    const hands = (history.json?.hands ?? []) as { description: string; netCents: number }[];
    expect(hands[0]?.description).toMatch(/forfeit/i);
    expect(hands[0]?.netCents).toBe(-1_000);

    const again = tableOf((await send(app, '/api/session/abandon', {}, opened.cookie)).json);
    expect(again.session.handsPlayed).toBe(1);
    expect(again.session.bankrollCents).toBe(START - 1_000);
  });

  it('serializes two bets on the same session', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 0,
      shoes: [shoe(card('10', 'S'), card('9', 'D'), card('6', 'C'), card('7', 'H'))],
    });
    const opened = await openSession(app);
    const [left, right] = await Promise.all([
      send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie),
      send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie),
    ]);
    expect([left.response.status, right.response.status].sort()).toEqual([200, 409]);
    const after = tableOf((await send(app, '/api/session', undefined, opened.cookie)).json);
    expect(after.session.bankrollCents).toBe(START - 1_000);
    expect(after.round?.phase).toBe('player');
  });

  it('does not let one session spend another session\'s chips', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [shoe(card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H'))],
    });
    const first = await openSession(app);
    const second = await openSession(app);
    const won = tableOf((await send(app, '/api/bet', { amountCents: 2_000 }, first.cookie)).json);
    expect(won.session.bankrollCents).toBe(START + 3_000);
    const other = tableOf((await send(app, '/api/session', undefined, second.cookie)).json);
    expect(other.session.bankrollCents).toBe(START);
    expect(other.session.id).not.toBe(won.session.id);
  });

  it('rejects a name that is not a table name and shows a legal one on the board', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [shoe(card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H'))],
    });
    const opened = await openSession(app);
    const injected = await send(app, '/api/session/name', { displayName: '" OR 1=1' }, opened.cookie);
    expect(injected.response.status).toBe(400);

    const named = await send(app, '/api/session/name', { displayName: 'River Ace' }, opened.cookie);
    expect(named.response.status).toBe(200);
    await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    const board = boardOf((await send(app, '/api/leaderboard', undefined, opened.cookie)).json);
    expect(board.you?.displayName).toBe('River Ace');
    expect(board.leaders.some((row) => row.you && row.displayName === 'River Ace') || board.you).toBeTruthy();
  });

  it('ranks a higher peak ahead and leaves other session ids off the public board', async () => {
    const pools = await getPools();
    const app = makeApp(pools);
    const low = await openSession(app);
    const high = await openSession(app);
    await pools.leaderboard.query(
      'UPDATE sessions SET peak_bankroll_cents = $2, hands_played = 1, net_cents = 0 WHERE id = $1',
      [low.table.session.id, 9_007_199_254_740_800],
    );
    await pools.leaderboard.query(
      'UPDATE sessions SET peak_bankroll_cents = $2, hands_played = 1, net_cents = 0 WHERE id = $1',
      [high.table.session.id, 9_007_199_254_740_900],
    );

    const lowBoard = boardOf((await send(app, '/api/leaderboard', undefined, low.cookie)).json);
    const highBoard = boardOf((await send(app, '/api/leaderboard', undefined, high.cookie)).json);
    expect(highBoard.you?.peakBankrollCents).toBe(9_007_199_254_740_900);
    expect(typeof highBoard.you?.peakBankrollCents).toBe('number');
    expect(highBoard.you?.rank).toBeLessThan(lowBoard.you?.rank ?? 0);
    const payload = JSON.stringify({ low: lowBoard, high: highBoard });
    expect(payload).not.toContain(low.table.session.id);
    expect(payload).not.toContain(high.table.session.id);

    await pools.leaderboard.query('DELETE FROM sessions WHERE id = ANY($1::uuid[])', [
      [low.table.session.id, high.table.session.id],
    ]);
  });

  it('omits a hidden session from the board and blocks a banned one from betting', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [
        shoe(card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H')),
        shoe(card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H')),
      ],
    });
    const opened = await openSession(app);
    await send(app, '/api/session/name', { displayName: 'Hidden Whale' }, opened.cookie);
    await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    const admin = await login(app);
    const id = opened.table.session.id;

    const hidden = await send(app, `/admin/api/sessions/${id}/visibility`, { hidden: true }, admin);
    expect(hidden.response.status).toBe(200);
    const board = boardOf((await send(app, '/api/leaderboard', undefined, opened.cookie)).json);
    expect(board.you).toBeNull();
    expect(board.leaders.some((row) => row.displayName === 'Hidden Whale')).toBe(false);
    const listed = await send(app, '/admin/api/sessions?q=Hidden%20Whale', undefined, admin);
    const sessions = (listed.json?.sessions ?? []) as { id: string }[];
    expect(sessions.some((session) => session.id === id)).toBe(true);

    const banned = await send(app, `/admin/api/sessions/${id}/ban`, { reason: 'Counting cards' }, admin);
    expect(banned.response.status).toBe(200);
    const refused = await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    expect(refused.response.status).toBe(403);

    const lifted = await send(app, `/admin/api/sessions/${id}/unban`, { reason: 'Lifted' }, admin);
    expect(lifted.response.status).toBe(200);
    const allowed = await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    expect(allowed.response.status).toBe(200);
    expect(tableOf(allowed.json).session.bankrollCents).toBeGreaterThan(START);
  });

  it('applies a hit-soft-17 rule to the next hand only', async () => {
    const soft = [card('10', 'S'), card('6', 'C'), card('8', 'D'), card('A', 'S'), card('2', 'H')];
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [shoe(...soft), shoe(...soft)],
    });
    const opened = await openSession(app);
    const admin = await login(app);
    const settings = {
      decks: 6,
      hitSoft17: false,
      startingBankrollCents: START,
    };

    const invalid = await send(app, '/admin/api/settings', { ...settings, decks: 9 }, admin, 'PUT');
    expect(invalid.response.status).toBe(400);

    const first = await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    expect(tableOf(first.json).round?.phase).toBe('player');
    const stood = tableOf((await send(app, '/api/action', { type: 'stand' }, opened.cookie)).json);
    expect(stood.round?.dealerCards).toHaveLength(2);
    expect(stood.round?.netCents).toBe(1_000);

    const raised = await send(app, '/admin/api/settings', { ...settings, hitSoft17: true }, admin, 'PUT');
    expect(raised.response.status).toBe(200);
    expect(raised.json).not.toHaveProperty('maxBetCents');
    expect(raised.json).not.toHaveProperty('minBetCents');

    const second = await send(app, '/api/bet', { amountCents: 1_000 }, opened.cookie);
    expect(second.response.status).toBe(200);
    const lost = tableOf((await send(app, '/api/action', { type: 'stand' }, opened.cookie)).json);
    expect(lost.round?.dealerCards).toHaveLength(3);
    expect(lost.round?.dealerTotal).toBe(19);
    expect(lost.round?.netCents).toBe(-1_000);
    expect(lost.session.peakBankrollCents).toBe(START + 1_000);
  });

  it('accepts a bet above the old table cap when the stack covers it', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [shoe(card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H'))],
    });
    const opened = await openSession(app);
    const bet = await send(app, '/api/bet', { amountCents: 5_000_000 }, opened.cookie);
    expect(bet.response.status).toBe(200);
    const table = tableOf(bet.json);
    expect(table.round?.hands[0]?.betCents).toBe(5_000_000);
    expect(table.session.bankrollCents).toBe(START - 5_000_000);
    expect(table.limits).not.toHaveProperty('maxBetCents');
    expect(table.limits).not.toHaveProperty('minBetCents');
  });
});
