import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let stop: (() => Promise<unknown>) | undefined;

export async function setup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('freebj_leaderboard')
    .withUsername('freebj')
    .withPassword('freebj')
    .start();
  stop = () => container.stop();

  const leaderboardUrl = container.getConnectionUri();
  const client = new pg.Client({ connectionString: leaderboardUrl });
  await client.connect();
  await client.query('CREATE DATABASE freebj_admin');
  await client.end();

  const adminUrl = databaseUrl(leaderboardUrl, 'freebj_admin');
  await writeFile('/tmp/freebj-test-env.json', JSON.stringify({ leaderboardUrl, adminUrl }));
}

export async function teardown(): Promise<void> {
  await stop?.();
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}
