export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

const SUIT_GLYPH: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

export function cardPoint(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
  return Number(rank);
}

export function isTenValue(card: Card): boolean {
  return cardPoint(card.rank) === 10;
}

export interface HandTotal {
  total: number;
  soft: boolean;
}

export function handTotal(cards: readonly Card[]): HandTotal {
  let total = 0;
  let acesAsEleven = 0;
  for (const dealt of cards) {
    if (dealt.rank === 'A') {
      acesAsEleven += 1;
      total += 11;
    } else {
      total += cardPoint(dealt.rank);
    }
  }
  while (total > 21 && acesAsEleven > 0) {
    total -= 10;
    acesAsEleven -= 1;
  }
  return { total, soft: acesAsEleven > 0 && total <= 21 };
}

export function cardLabel(dealt: { rank: string; suit: string }): string {
  const glyph = SUIT_GLYPH[dealt.suit as Suit] ?? dealt.suit;
  return `${dealt.rank}${glyph}`;
}

export function handLabel(cards: readonly { rank: string; suit: string }[]): string {
  return cards.map((dealt) => cardLabel(dealt)).join(' ');
}
