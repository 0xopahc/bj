import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTx } from '../db/tx.ts';
import { hashPassword } from './password.ts';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export async function ensureAdmin(pool: Pool, username: string, password: string): Promise<void> {
  if (!USERNAME_RE.test(username)) {
    throw new Error('ADMIN_USERNAME must be 3 to 32 characters: letters, numbers, dot, underscore, or hyphen');
  }
  if (password.length < 8 || password.length > 200) {
    throw new Error('ADMIN_PASSWORD must be 8 to 200 characters');
  }
  const passwordHash = await hashPassword(password);
  await withTx(pool, async (client) => {
    await client.query('DELETE FROM admin_sessions WHERE username <> $1', [username]);
    await client.query('DELETE FROM admin_users WHERE username <> $1', [username]);
    await client.query(
      `INSERT INTO admin_users (id, username, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [randomUUID(), username, passwordHash],
    );
  });
}
