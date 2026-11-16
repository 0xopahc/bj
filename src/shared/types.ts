export type GameAction =
  | 'hit'
  | 'stand'
  | 'double'
  | 'split'
  | 'insurance'
  | 'decline'
  | 'even_money';

export interface CardView {
  rank: string;
  suit: string;
}

export interface HiddenCardView {
  hidden: true;
}

export type DealerCardView = CardView | HiddenCardView;

export type HandStatus =
  | 'playing'
  | 'waiting'
  | 'stood'
  | 'bust'
  | 'blackjack'
  | 'win'
  | 'lose'
  | 'push';

export interface HandView {
  label: string;
  cards: CardView[];
  betCents: number;
  total: number;
  soft: boolean;
  status: HandStatus;
  active: boolean;
}

export interface RoundView {
  phase: 'insurance' | 'player' | 'done';
  dealerCards: DealerCardView[];
  dealerTotal: number | null;
  dealerSoft: boolean;
  hands: HandView[];
  actions: GameAction[];
  insuranceKind: 'insurance' | 'even_money' | null;
  description: string | null;
  netCents: number | null;
  inPlayCents: number;
}

export interface SessionView {
  id: string;
  displayName: string;
  bankrollCents: number;
  peakBankrollCents: number;
  handsPlayed: number;
  netCents: number;
  banned: boolean;
  hiddenFromBoard: boolean;
}

export interface TableLimits {
  decks: number;
  hitSoft17: boolean;
  startingBankrollCents: number;
}

export interface TableResponse {
  session: SessionView;
  round: RoundView | null;
  limits: TableLimits;
}

export interface LeaderRow {
  rank: number;
  displayName: string;
  peakBankrollCents: number;
  bankrollCents: number;
  handsPlayed: number;
  netCents: number;
  you: boolean;
}

export interface LeaderboardResponse {
  leaders: LeaderRow[];
  you: LeaderRow | null;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  wagerCents: number;
  netCents: number;
  description: string;
}

export interface HistoryResponse {
  hands: HistoryEntry[];
}

export interface AdminSettings {
  decks: number;
  hitSoft17: boolean;
  startingBankrollCents: number;
}

export interface AdminStats {
  sessions: number;
  playedSessions: number;
  bannedSessions: number;
  hands: number;
  wageredCents: number;
  playerNetCents: number;
}

export interface AdminSessionSummary {
  id: string;
  displayName: string;
  bankrollCents: number;
  peakBankrollCents: number;
  handsPlayed: number;
  netCents: number;
  totalWageredCents: number;
  banned: boolean;
  banReason: string | null;
  hiddenFromBoard: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminHand {
  id: string;
  createdAt: string;
  wagerCents: number;
  netCents: number;
  description: string;
  dealer: string;
  player: string;
}

export interface AdminSessionDetail {
  session: AdminSessionSummary;
  shoeRemaining: number;
  round: RoundView | null;
  hands: AdminHand[];
}

export interface AuditEntry {
  id: number;
  adminUsername: string;
  action: string;
  sessionId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}
