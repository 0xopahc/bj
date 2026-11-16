import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { card } from '../../src/game/cards.ts';
import type { AdminStats, AuditEntry, TableResponse } from '../../src/shared/types.ts';
import { closePools, getPools, login, makeApp, openSession, orderedShoe, resetSettings, send } from '../support.ts';

const START = 10_000_000;

function tableOf(json: Record<string, unknown> | null): TableResponse {
  return json as unknown as TableResponse;
}

describe('house console', () => {
  beforeEach(async () => {
    const pools = await getPools();
    await resetSettings(pools.admin);
  });

  afterAll(async () => {
    await closePools();
  });

  it('rejects a bad password, accepts the operator, and ignores a player cookie', async () => {
    const app = makeApp(await getPools());
    const player = await openSession(app);
    const wrong = await send(app, '/admin/api/login', { username: 'admin', password: 'not-the-password' });
    expect(wrong.response.status).toBe(401);

    const cookie = await login(app);
    expect(cookie).toContain('fbj_admin=');
    const me = await send(app, '/admin/api/me', undefined, cookie);
    expect(me.json).toEqual({ username: 'admin' });

    const settings = await send(app, '/admin/api/settings', undefined, cookie);
    expect(settings.response.status).toBe(200);
    expect(settings.json).toMatchObject({ hitSoft17: false, decks: 6, startingBankrollCents: START });
    expect(settings.json).not.toHaveProperty('minBetCents');
    expect(settings.json).not.toHaveProperty('maxBetCents');

    const asPlayer = await send(app, '/admin/api/settings', undefined, player.cookie);
    expect(asPlayer.response.status).toBe(401);

    const audit = await send(app, '/admin/api/audit', undefined, cookie);
    const entries = (audit.json?.entries ?? []) as AuditEntry[];
    expect(entries.some((entry) => entry.action === 'login_failed')).toBe(true);
    expect(entries.some((entry) => entry.action === 'login')).toBe(true);
  });

  it('comps chips without moving the peak, then lets a later win move it', async () => {
    const app = makeApp(await getPools(), {
      reshuffleBelow: 10_000,
      shoes: [orderedShoe([card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H')])],
    });
    const opened = await openSession(app);
    const admin = await login(app);
    const id = opened.table.session.id;

    const before = tableOf((await send(app, '/api/session', undefined, opened.cookie)).json);
    expect(before.session.peakBankrollCents).toBe(START);

    const adjusted = await send(
      app,
      `/admin/api/sessions/${id}/adjust`,
      { deltaCents: 5_000, reason: 'Dinner comp' },
      admin,
    );
    expect(adjusted.response.status).toBe(200);
    const summary = (adjusted.json?.session ?? {}) as { bankrollCents: number; peakBankrollCents: number };
    expect(summary.bankrollCents).toBe(START + 5_000);
    expect(summary.peakBankrollCents).toBe(START);

    const negative = await send(
      app,
      `/admin/api/sessions/${id}/adjust`,
      { deltaCents: -(START + 5_000 + 100), reason: 'Too much' },
      admin,
    );
    expect(negative.response.status).toBe(400);

    const won = tableOf((await send(app, '/api/bet', { amountCents: 2_000 }, opened.cookie)).json);
    expect(won.session.bankrollCents).toBe(START + 5_000 + 3_000);
    expect(won.session.peakBankrollCents).toBe(START + 8_000);

    const stats = (await send(app, '/admin/api/stats', undefined, admin)).json as unknown as AdminStats;
    expect(stats.hands).toBeGreaterThanOrEqual(1);
    expect(typeof stats.wageredCents).toBe('number');
    expect(typeof stats.playerNetCents).toBe('number');

    const audit = await send(app, '/admin/api/audit', undefined, admin);
    const entries = (audit.json?.entries ?? []) as AuditEntry[];
    const comp = entries.find((entry) => entry.action === 'adjust_chips' && entry.sessionId === id);
    expect(comp?.detail).toMatchObject({ deltaCents: 5_000, reason: 'Dinner comp' });
  });
});
