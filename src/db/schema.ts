import { DEFAULT_DECKS, DEFAULT_STARTING_BANKROLL_CENTS } from '../shared/money.ts';

export const LEADERBOARD_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_name TEXT NOT NULL,
  bankroll_cents BIGINT NOT NULL CHECK (bankroll_cents >= 0),
  peak_bankroll_cents BIGINT NOT NULL CHECK (peak_bankroll_cents >= 0),
  hands_played INTEGER NOT NULL DEFAULT 0 CHECK (hands_played >= 0),
  total_wagered_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_wagered_cents >= 0),
  net_cents BIGINT NOT NULL DEFAULT 0,
  hidden_from_board BOOLEAN NOT NULL DEFAULT FALSE,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason TEXT,
  state_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS hands (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  wager_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  description TEXT NOT NULL,
  detail JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_peak_idx
  ON sessions (peak_bankroll_cents DESC, net_cents DESC, created_at ASC, id ASC)
  WHERE hidden_from_board = FALSE AND hands_played > 0;

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_name_idx ON sessions (display_name);
CREATE INDEX IF NOT EXISTS hands_session_idx ON hands (session_id, created_at DESC);
`;

export const ADMIN_SQL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  session_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS table_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Leftover columns. The game does not enforce a table minimum or maximum.
  min_bet_cents INTEGER NOT NULL,
  max_bet_cents INTEGER NOT NULL,
  decks INTEGER NOT NULL,
  hit_soft_17 BOOLEAN NOT NULL,
  starting_bankroll_cents BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO table_settings (
  id, min_bet_cents, max_bet_cents, decks, hit_soft_17, starting_bankroll_cents, updated_by
) VALUES (
  1,
  100,
  100,
  ${DEFAULT_DECKS},
  FALSE,
  ${DEFAULT_STARTING_BANKROLL_CENTS},
  'system'
) ON CONFLICT (id) DO NOTHING;
`;
