import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import type { Hono } from 'hono';
import type { AppEnv } from '../src/app-deps.ts';
import pg from 'pg';
import { ensureAdmin } from '../src/auth/admin-user.ts';
import { createApp } from '../src/app.ts';
import { ADMIN_SQL, LEADERBOARD_SQL } from '../src/db/schema.ts';
import { createPool, migrate } from '../src/db/pool.ts';
import { buildShoe, shoeFromDrawOrder, type ShoeSource } from '../src/game/shoe.ts';
import { resetSettings } from '../src/repos/admin-store.ts';
import type { Card } from '../src/game/cards.ts';
import type { TableResponse } from '../src/shared/types.ts';

export interface Pools {
  leaderboard: pg.Pool;
  admin: pg.Pool;
}

let pools: Pools | null = null;

export function testUrls(): { leaderboardUrl: string; adminUrl: string } {
  return JSON.parse(readFileSync('/tmp/freebj-test-env.json', 'utf8')) as {
    leaderboardUrl: string;
    adminUrl: string;
  };
}

export async function getPools(): Promise<Pools> {
  if (pools) return pools;
  const urls = testUrls();
  const created = {
    leaderboard: createPool(urls.leaderboardUrl),
    admin: createPool(urls.adminUrl),
  };
  await migrate(created.leaderboard, LEADERBOARD_SQL);
  await migrate(created.admin, ADMIN_SQL);
  await ensureAdmin(created.admin, 'admin', 'test-password');
  pools = created;
  return created;
}

export async function closePools(): Promise<void> {
  if (!pools) return;
  await pools.leaderboard.end();
  await pools.admin.end();
  pools = null;
}

export function makeApp(
  input: Pools,
  options?: { shoes?: Card[][]; reshuffleBelow?: number; staticDir?: string },
): Hono<AppEnv> {
  const shoes = options?.shoes ?? [];
  let index = 0;
  const shoeSource: ShoeSource = (decks) => {
    if (shoes.length === 0) return buildShoe(decks, (max) => randomInt(0, max));
    const shoe = shoes[Math.min(index, shoes.length - 1)] ?? [];
    index += 1;
    return shoe.map((dealt) => ({ ...dealt }));
  };
  return createApp({
    leaderboard: input.leaderboard,
    admin: input.admin,
    cookieSecure: false,
    shoeSource,
    ...(options?.staticDir ? { staticDir: options.staticDir } : {}),
    ...(options?.reshuffleBelow !== undefined ? { rulesOverride: { reshuffleBelow: options.reshuffleBelow } } : {}),
  });
}

export function orderedShoe(drawOrder: Card[]): Card[] {
  return shoeFromDrawOrder(drawOrder);
}

export function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const listed = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const pairs = listed.map((value) => value.split(';')[0]).filter((value): value is string => Boolean(value));
  if (pairs.length > 0) return pairs.join('; ');
  const single = response.headers.get('set-cookie');
  if (!single) throw new Error(`missing set-cookie: ${response.status}`);
  return single.split(';')[0] ?? single;
}

export async function send(
  app: Hono<AppEnv>,
  path: string,
  body?: unknown,
  cookie?: string,
  method = body === undefined ? 'GET' : 'POST',
): Promise<{ response: Response; json: Record<string, unknown> | null }> {
  const response = await app.request(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  return { response, json };
}

export async function openSession(app: Hono<AppEnv>): Promise<{ cookie: string; table: TableResponse }> {
  const { response, json } = await send(app, '/api/session');
  if (response.status !== 201) {
    throw new Error(`open session failed ${response.status} ${JSON.stringify(json)}`);
  }
  return { cookie: cookieHeader(response), table: json as unknown as TableResponse };
}

export async function login(app: Hono<AppEnv>, password = 'test-password'): Promise<string> {
  const { response, json } = await send(app, '/admin/api/login', { username: 'admin', password });
  if (response.status !== 200) throw new Error(`login failed ${response.status} ${JSON.stringify(json)}`);
  return cookieHeader(response);
}

export { resetSettings };
