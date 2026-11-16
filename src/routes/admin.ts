import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { toRoundView } from '../game/view.ts';
import { HttpError } from '../http/errors.ts';
import { ADMIN_COOKIE, cookieOptions, isUuid } from '../http/cookies.ts';
import { clearFailures, noteFailure, tooManyFailures } from '../http/rate-limit.ts';
import { withTx } from '../db/tx.ts';
import {
  createAdminSession,
  deleteAdminSession,
  findAdminPassword,
  listAudit,
  loadSettings,
  readAdminSession,
  saveSettings,
  validateSettings,
  writeAudit,
} from '../repos/admin-store.ts';
import { adminHands, findSession, leaderboardStats, lockSession, searchSessions, toSummary, updateSession } from '../repos/sessions.ts';
import type { AppDeps, AppEnv } from '../app-deps.ts';

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
let dummyHash: Promise<string> | null = null;

export function mountAdmin(app: Hono<AppEnv>, deps: AppDeps): void {
  app.post('/admin/api/login', async (c) => {
    const body = await readJson(c);
    const username = bodyString(body, 'username');
    const password = bodyString(body, 'password');
    if (password.length > 200) throw new HttpError(401, 'Invalid username or password');
    const key = `login:${clientKey(c)}`;
    if (tooManyFailures(key, 8, LOGIN_WINDOW_MS)) {
      throw new HttpError(429, 'Too many sign-in attempts. Wait and try again.');
    }
    const stored = await findAdminPassword(deps.admin, username);
    const ok = await verifyPassword(password, stored ?? (await dummyPasswordHash()));
    if (!stored || !ok) {
      noteFailure(key, LOGIN_WINDOW_MS);
      await writeAudit(deps.admin, {
        username: username.slice(0, 32) || 'unknown',
        action: 'login_failed',
        detail: {},
      });
      throw new HttpError(401, 'Invalid username or password');
    }
    clearFailures(key);
    const token = await createAdminSession(deps.admin, username);
    setCookie(c, ADMIN_COOKIE, token, cookieOptions(deps.cookieSecure, 60 * 60 * 12));
    await writeAudit(deps.admin, { username, action: 'login', detail: {} });
    return c.json({ username });
  });

  app.post('/admin/api/logout', async (c) => {
    const token = getCookie(c, ADMIN_COOKIE);
    if (token) await deleteAdminSession(deps.admin, token);
    deleteCookie(c, ADMIN_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.use('*', async (c, next) => {
    if (!c.req.path.startsWith('/admin/api/')) return next();
    if (c.req.path === '/admin/api/login') return next();
    const token = getCookie(c, ADMIN_COOKIE);
    if (!token) throw new HttpError(401, 'Sign in required');
    const username = await readAdminSession(deps.admin, token);
    if (!username) throw new HttpError(401, 'Sign in required');
    c.set('adminUser', username);
    await next();
  });

  app.get('/admin/api/me', (c) => c.json({ username: c.get('adminUser') }));

  app.get('/admin/api/stats', async (c) => c.json(await leaderboardStats(deps.leaderboard)));

  app.get('/admin/api/settings', async (c) => c.json(await loadSettings(deps.admin)));

  app.put('/admin/api/settings', async (c) => {
    const settings = validateSettings(await readJson(c));
    const username = c.get('adminUser');
    await saveSettings(deps.admin, settings, username);
    await writeAudit(deps.admin, { username, action: 'update_settings', detail: { ...settings } });
    return c.json(settings);
  });

  app.get('/admin/api/audit', async (c) => c.json({ entries: await listAudit(deps.admin) }));

  app.get('/admin/api/sessions', async (c) => {
    const query = c.req.query('q')?.trim() ?? '';
    if (query.length > 40) throw new HttpError(400, 'Search is too long');
    return c.json({ sessions: await searchSessions(deps.leaderboard, query || null) });
  });

  app.get('/admin/api/sessions/:id', async (c) => {
    const session = await requireSession(deps, c.req.param('id'));
    return c.json({
      session: toSummary(session),
      shoeRemaining: session.state.shoe.length,
      round: toRoundView(session.state, session.bankrollCents, true),
      hands: await adminHands(deps.leaderboard, session.id),
    });
  });

  app.post('/admin/api/sessions/:id/adjust', async (c) => {
    const { deltaCents, reason } = readDelta(await readJson(c));
    const username = c.get('adminUser');
    const session = await withTx(deps.leaderboard, async (client) => {
      const locked = await requireLocked(client, c.req.param('id'));
      const next = locked.bankrollCents + deltaCents;
      if (next < 0) throw new HttpError(400, 'That would make the stack negative');
      locked.bankrollCents = next;
      await updateSession(client, locked);
      return locked;
    });
    await writeAudit(deps.admin, {
      username,
      action: 'adjust_chips',
      sessionId: session.id,
      detail: { deltaCents, reason, bankrollCents: session.bankrollCents },
    });
    return c.json({ session: toSummary(session) });
  });

  app.post('/admin/api/sessions/:id/ban', async (c) => {
    const reason = readReason(await readJson(c));
    return setBan(c, deps, true, reason);
  });

  app.post('/admin/api/sessions/:id/unban', async (c) => setBan(c, deps, false, null));

  app.post('/admin/api/sessions/:id/visibility', async (c) => {
    const body = await readJson(c);
    if (!body || typeof body !== 'object' || typeof (body as { hidden?: unknown }).hidden !== 'boolean') {
      throw new HttpError(400, 'hidden must be true or false');
    }
    const hidden = (body as { hidden: boolean }).hidden;
    const username = c.get('adminUser');
    const session = await withTx(deps.leaderboard, async (client) => {
      const locked = await requireLocked(client, c.req.param('id'));
      locked.hiddenFromBoard = hidden;
      await updateSession(client, locked);
      return locked;
    });
    await writeAudit(deps.admin, {
      username,
      action: hidden ? 'hide' : 'show',
      sessionId: session.id,
      detail: { hidden },
    });
    return c.json({ session: toSummary(session) });
  });
}

async function setBan(c: Context<AppEnv>, deps: AppDeps, banned: boolean, reason: string | null) {
  const username = c.get('adminUser');
  const session = await withTx(deps.leaderboard, async (client) => {
    const locked = await requireLocked(client, c.req.param('id'));
    locked.banned = banned;
    locked.banReason = reason;
    await updateSession(client, locked);
    return locked;
  });
  await writeAudit(deps.admin, {
    username,
    action: banned ? 'ban' : 'unban',
    sessionId: session.id,
    detail: { reason },
  });
  return c.json({ session: toSummary(session) });
}

async function requireSession(deps: AppDeps, id: string | undefined) {
  if (!id || !isUuid(id)) throw new HttpError(404, 'Session not found');
  const session = await findSession(deps.leaderboard, id);
  if (!session) throw new HttpError(404, 'Session not found');
  return session;
}

async function requireLocked(client: Parameters<typeof lockSession>[0], id: string | undefined) {
  if (!id || !isUuid(id)) throw new HttpError(404, 'Session not found');
  const session = await lockSession(client, id);
  if (!session) throw new HttpError(404, 'Session not found');
  return session;
}

function readDelta(body: unknown): { deltaCents: number; reason: string } {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Adjustment body is required');
  const deltaCents = (body as { deltaCents?: unknown }).deltaCents;
  if (typeof deltaCents !== 'number' || !Number.isInteger(deltaCents) || deltaCents === 0) {
    throw new HttpError(400, 'deltaCents must be a non-zero integer');
  }
  if (Math.abs(deltaCents) > 10_000_000_000) throw new HttpError(400, 'Adjustment is too large');
  return { deltaCents, reason: readReason(body) };
}

function readReason(body: unknown): string {
  if (!body || typeof body !== 'object' || typeof (body as { reason?: unknown }).reason !== 'string') {
    throw new HttpError(400, 'A reason of 3 to 200 characters is required');
  }
  const reason = (body as { reason: string }).reason.trim();
  if (reason.length < 3 || reason.length > 200) {
    throw new HttpError(400, 'A reason of 3 to 200 characters is required');
  }
  return reason;
}

function bodyString(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

function clientKey(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (!forwarded) return 'local';
  return forwarded.split(',')[0]?.trim() || 'local';
}

function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('hex'));
  return dummyHash;
}
