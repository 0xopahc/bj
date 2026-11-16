import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { HttpError } from '../http/errors.ts';
import type { AdminSettings, AuditEntry } from '../shared/types.ts';
import { DEFAULT_DECKS, DEFAULT_STARTING_BANKROLL_CENTS } from '../shared/money.ts';

const MAX_STARTING_CENTS = 100_000_000_000;

export async function loadSettings(pool: Pool): Promise<AdminSettings> {
  const result = await pool.query<{
    decks: number;
    hit_soft_17: boolean;
    starting_bankroll_cents: number;
  }>('SELECT decks, hit_soft_17, starting_bankroll_cents FROM table_settings WHERE id = 1');
  const row = result.rows[0];
  if (!row) {
    return {
      decks: DEFAULT_DECKS,
      hitSoft17: false,
      startingBankrollCents: DEFAULT_STARTING_BANKROLL_CENTS,
    };
  }
  return {
    decks: row.decks,
    hitSoft17: row.hit_soft_17,
    startingBankrollCents: row.starting_bankroll_cents,
  };
}

export function validateSettings(input: unknown): AdminSettings {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Settings body is required');
  const body = input as Record<string, unknown>;
  const decks = body.decks;
  const hitSoft17 = body.hitSoft17;
  const startingBankrollCents = body.startingBankrollCents;
  if (typeof decks !== 'number' || !Number.isInteger(decks) || decks < 1 || decks > 8) {
    throw new HttpError(400, 'Decks must be from 1 to 8');
  }
  if (typeof hitSoft17 !== 'boolean') throw new HttpError(400, 'hitSoft17 must be true or false');
  if (!wholeDollars(startingBankrollCents) || startingBankrollCents < 100 || startingBankrollCents > MAX_STARTING_CENTS) {
    throw new HttpError(400, 'Starting stack must be whole dollars, at least $1, and at most $1,000,000,000');
  }
  return { decks, hitSoft17, startingBankrollCents };
}

function wholeDollars(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value % 100 === 0;
}

export async function saveSettings(pool: Pool, settings: AdminSettings, updatedBy: string): Promise<void> {
  await pool.query(
    `UPDATE table_settings SET
       decks = $1,
       hit_soft_17 = $2,
       starting_bankroll_cents = $3,
       updated_at = now(),
       updated_by = $4
     WHERE id = 1`,
    [settings.decks, settings.hitSoft17, settings.startingBankrollCents, updatedBy],
  );
}

export async function resetSettings(pool: Pool): Promise<void> {
  await saveSettings(
    pool,
    {
      decks: DEFAULT_DECKS,
      hitSoft17: false,
      startingBankrollCents: DEFAULT_STARTING_BANKROLL_CENTS,
    },
    'test',
  );
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createAdminSession(pool: Pool, username: string, hours = 12): Promise<string> {
  const token = newToken();
  await pool.query(
    `INSERT INTO admin_sessions (token_hash, username, expires_at)
     VALUES ($1, $2, now() + ($3::int * interval '1 hour'))`,
    [hashToken(token), username, hours],
  );
  return token;
}

export async function readAdminSession(pool: Pool, token: string): Promise<string | null> {
  const result = await pool.query<{ username: string }>(
    `UPDATE admin_sessions
     SET expires_at = now() + interval '12 hours'
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING username`,
    [hashToken(token)],
  );
  return result.rows[0]?.username ?? null;
}

export async function deleteAdminSession(pool: Pool, token: string): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function findAdminPassword(pool: Pool, username: string): Promise<string | null> {
  const result = await pool.query<{ password_hash: string }>('SELECT password_hash FROM admin_users WHERE username = $1', [
    username,
  ]);
  return result.rows[0]?.password_hash ?? null;
}

export async function writeAudit(
  pool: Pool,
  entry: { username: string; action: string; sessionId?: string | null; detail: Record<string, unknown> },
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (admin_username, action, session_id, detail)
     VALUES ($1, $2, $3, $4)`,
    [entry.username, entry.action, entry.sessionId ?? null, entry.detail],
  );
}

export async function listAudit(pool: Pool, limit = 40): Promise<AuditEntry[]> {
  const result = await pool.query<{
    id: number;
    admin_username: string;
    action: string;
    session_id: string | null;
    detail: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, admin_username, action, session_id, detail, created_at
     FROM audit_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    adminUsername: row.admin_username,
    action: row.action,
    sessionId: row.session_id,
    detail: row.detail ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export function newId(): string {
  return randomUUID();
}
