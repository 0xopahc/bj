import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { parseTableState, roundDetail, type Round, type TableState } from '../game/engine.ts';
import type { AdminHand, AdminSessionSummary, HistoryEntry, LeaderRow } from '../shared/types.ts';
import { handLabel } from '../game/cards.ts';

export interface SessionRecord {
  id: string;
  displayName: string;
  bankrollCents: number;
  peakBankrollCents: number;
  handsPlayed: number;
  totalWageredCents: number;
  netCents: number;
  banned: boolean;
  banReason: string | null;
  hiddenFromBoard: boolean;
  createdAt: Date;
  updatedAt: Date;
  state: TableState;
}

interface SessionRow {
  id: string;
  display_name: string;
  bankroll_cents: number;
  peak_bankroll_cents: number;
  hands_played: number;
  total_wagered_cents: number;
  net_cents: number;
  banned: boolean;
  ban_reason: string | null;
  hidden_from_board: boolean;
  created_at: Date;
  updated_at: Date;
  state_json: unknown;
}

const SESSION_COLUMNS = `
  id, display_name, bankroll_cents, peak_bankroll_cents, hands_played,
  total_wagered_cents, net_cents, banned, ban_reason, hidden_from_board,
  created_at, updated_at, state_json
`;

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    bankrollCents: row.bankroll_cents,
    peakBankrollCents: row.peak_bankroll_cents,
    handsPlayed: row.hands_played,
    totalWageredCents: row.total_wagered_cents,
    netCents: row.net_cents,
    banned: row.banned,
    banReason: row.ban_reason,
    hiddenFromBoard: row.hidden_from_board,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    state: parseTableState(row.state_json),
  };
}

export async function findSession(pool: Pool, id: string): Promise<SessionRecord | null> {
  const result = await pool.query<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapSession(row) : null;
}

export async function lockSession(client: PoolClient, id: string): Promise<SessionRecord | null> {
  const result = await client.query<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1 FOR UPDATE`, [
    id,
  ]);
  const row = result.rows[0];
  return row ? mapSession(row) : null;
}

export async function insertSession(
  pool: Pool,
  input: { id: string; displayName: string; bankrollCents: number; state: TableState },
): Promise<SessionRecord> {
  const result = await pool.query<SessionRow>(
    `INSERT INTO sessions (
       id, display_name, bankroll_cents, peak_bankroll_cents, state_json
     ) VALUES ($1, $2, $3, $3, $4)
     RETURNING ${SESSION_COLUMNS}`,
    [input.id, input.displayName, input.bankrollCents, input.state],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Session insert did not return a row');
  return mapSession(row);
}

export async function updateSession(client: PoolClient, session: SessionRecord): Promise<void> {
  await client.query(
    `UPDATE sessions SET
       updated_at = now(),
       display_name = $2,
       bankroll_cents = $3,
       peak_bankroll_cents = $4,
       hands_played = $5,
       total_wagered_cents = $6,
       net_cents = $7,
       hidden_from_board = $8,
       banned = $9,
       ban_reason = $10,
       state_json = $11
     WHERE id = $1`,
    [
      session.id,
      session.displayName,
      session.bankrollCents,
      session.peakBankrollCents,
      session.handsPlayed,
      session.totalWageredCents,
      session.netCents,
      session.hiddenFromBoard,
      session.banned,
      session.banReason,
      session.state,
    ],
  );
}

export function applySettlement(session: SessionRecord, round: Round): void {
  session.handsPlayed += 1;
  session.totalWageredCents += round.stakeCents;
  session.netCents += round.netCents;
  if (session.bankrollCents > session.peakBankrollCents) {
    session.peakBankrollCents = session.bankrollCents;
  }
}

export async function insertHand(client: PoolClient, sessionId: string, round: Round): Promise<void> {
  await client.query(
    `INSERT INTO hands (id, session_id, wager_cents, net_cents, description, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), sessionId, round.stakeCents, round.netCents, round.description ?? 'Hand complete.', roundDetail(round)],
  );
}

export async function listHistory(pool: Pool, sessionId: string, limit = 15): Promise<HistoryEntry[]> {
  const result = await pool.query<{
    id: string;
    created_at: Date;
    wager_cents: number;
    net_cents: number;
    description: string;
  }>(
    `SELECT id, created_at, wager_cents, net_cents, description
     FROM hands
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    wagerCents: row.wager_cents,
    netCents: row.net_cents,
    description: row.description,
  }));
}

export async function listLeaderboard(pool: Pool, sessionId: string | null): Promise<{ leaders: LeaderRow[]; you: LeaderRow | null }> {
  const top = await pool.query<{
    id: string;
    display_name: string;
    peak_bankroll_cents: number;
    bankroll_cents: number;
    hands_played: number;
    net_cents: number;
  }>(
    `SELECT id, display_name, peak_bankroll_cents, bankroll_cents, hands_played, net_cents
     FROM sessions
     WHERE hidden_from_board = FALSE AND hands_played > 0
     ORDER BY peak_bankroll_cents DESC, net_cents DESC, created_at ASC, id ASC
     LIMIT 20`,
  );
  const leaders = top.rows.map((row, index) => ({
    rank: index + 1,
    displayName: row.display_name,
    peakBankrollCents: row.peak_bankroll_cents,
    bankrollCents: row.bankroll_cents,
    handsPlayed: row.hands_played,
    netCents: row.net_cents,
    you: row.id === sessionId,
  }));

  if (!sessionId) return { leaders, you: null };
  const mine = await pool.query<{
    id: string;
    display_name: string;
    peak_bankroll_cents: number;
    bankroll_cents: number;
    hands_played: number;
    net_cents: number;
    hidden_from_board: boolean;
    created_at: Date;
  }>(
    `SELECT id, display_name, peak_bankroll_cents, bankroll_cents, hands_played, net_cents, hidden_from_board, created_at
     FROM sessions WHERE id = $1`,
    [sessionId],
  );
  const self = mine.rows[0];
  if (!self || self.hidden_from_board || self.hands_played <= 0) return { leaders, you: null };

  const ahead = await pool.query<{ ahead: number }>(
    `SELECT count(*)::int AS ahead
     FROM sessions
     WHERE hidden_from_board = FALSE
       AND hands_played > 0
       AND (
         peak_bankroll_cents > $1
         OR (peak_bankroll_cents = $1 AND net_cents > $2)
         OR (peak_bankroll_cents = $1 AND net_cents = $2 AND created_at < $3)
         OR (peak_bankroll_cents = $1 AND net_cents = $2 AND created_at = $3 AND id < $4)
       )`,
    [self.peak_bankroll_cents, self.net_cents, self.created_at, self.id],
  );
  const you: LeaderRow = {
    rank: (ahead.rows[0]?.ahead ?? 0) + 1,
    displayName: self.display_name,
    peakBankrollCents: self.peak_bankroll_cents,
    bankrollCents: self.bankroll_cents,
    handsPlayed: self.hands_played,
    netCents: self.net_cents,
    you: true,
  };
  return { leaders, you };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function searchSessions(pool: Pool, query: string | null): Promise<AdminSessionSummary[]> {
  const result = await pool.query<{
    id: string;
    display_name: string;
    bankroll_cents: number;
    peak_bankroll_cents: number;
    hands_played: number;
    net_cents: number;
    total_wagered_cents: number;
    banned: boolean;
    ban_reason: string | null;
    hidden_from_board: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, display_name, bankroll_cents, peak_bankroll_cents, hands_played, net_cents,
            total_wagered_cents, banned, ban_reason, hidden_from_board, created_at, updated_at
     FROM sessions
     WHERE ($1::text IS NULL OR display_name ILIKE $1 ESCAPE '\\' OR id::text = $2)
     ORDER BY updated_at DESC
     LIMIT 100`,
    [query ? `%${escapeLike(query)}%` : null, query],
  );
  return result.rows.map(mapSummary);
}

export async function adminHands(pool: Pool, sessionId: string): Promise<AdminHand[]> {
  const result = await pool.query<{
    id: string;
    created_at: Date;
    wager_cents: number;
    net_cents: number;
    description: string;
    detail: {
      dealer?: { rank: string; suit: string }[];
      hands?: { cards?: { rank: string; suit: string }[] }[];
    };
  }>(
    `SELECT id, created_at, wager_cents, net_cents, description, detail
     FROM hands
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    wagerCents: row.wager_cents,
    netCents: row.net_cents,
    description: row.description,
    dealer: handLabel(row.detail?.dealer ?? []),
    player: (row.detail?.hands ?? []).map((hand) => handLabel(hand.cards ?? [])).filter(Boolean).join(' | '),
  }));
}

export async function leaderboardStats(pool: Pool): Promise<{
  sessions: number;
  playedSessions: number;
  bannedSessions: number;
  hands: number;
  wageredCents: number;
  playerNetCents: number;
}> {
  const result = await pool.query<{
    sessions: number;
    played: number;
    banned: number;
    hands: number;
    wagered: number;
    player_net: number;
  }>(
    `SELECT
       count(*)::int AS sessions,
       count(*) FILTER (WHERE hands_played > 0)::int AS played,
       count(*) FILTER (WHERE banned)::int AS banned,
       coalesce(sum(hands_played), 0)::int AS hands,
       coalesce(sum(total_wagered_cents), 0)::bigint AS wagered,
       coalesce(sum(net_cents), 0)::bigint AS player_net
     FROM sessions`,
  );
  const row = result.rows[0];
  return {
    sessions: row?.sessions ?? 0,
    playedSessions: row?.played ?? 0,
    bannedSessions: row?.banned ?? 0,
    hands: row?.hands ?? 0,
    wageredCents: row?.wagered ?? 0,
    playerNetCents: row?.player_net ?? 0,
  };
}

function mapSummary(row: {
  id: string;
  display_name: string;
  bankroll_cents: number;
  peak_bankroll_cents: number;
  hands_played: number;
  net_cents: number;
  total_wagered_cents: number;
  banned: boolean;
  ban_reason: string | null;
  hidden_from_board: boolean;
  created_at: Date;
  updated_at: Date;
}): AdminSessionSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    bankrollCents: row.bankroll_cents,
    peakBankrollCents: row.peak_bankroll_cents,
    handsPlayed: row.hands_played,
    netCents: row.net_cents,
    totalWageredCents: row.total_wagered_cents,
    banned: row.banned,
    banReason: row.ban_reason,
    hiddenFromBoard: row.hidden_from_board,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toSummary(session: SessionRecord): AdminSessionSummary {
  return {
    id: session.id,
    displayName: session.displayName,
    bankrollCents: session.bankrollCents,
    peakBankrollCents: session.peakBankrollCents,
    handsPlayed: session.handsPlayed,
    netCents: session.netCents,
    totalWageredCents: session.totalWageredCents,
    banned: session.banned,
    banReason: session.banReason,
    hiddenFromBoard: session.hiddenFromBoard,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}
