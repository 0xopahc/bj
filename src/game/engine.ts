import type { GameAction } from '../shared/types.ts';
import { cardPoint, handTotal, isTenValue, type Card } from './cards.ts';
import type { ShoeSource } from './shoe.ts';

export class RuleError extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409 = 400) {
    super(message);
    this.name = 'RuleError';
    this.status = status;
  }
}

export interface Rules {
  decks: number;
  hitSoft17: boolean;
  /** Reshuffle before a round when the shoe has fewer cards than this. 0 keeps a short test shoe. */
  reshuffleBelow: number;
}

export interface Hand {
  cards: Card[];
  betCents: number;
  stood: boolean;
  doubled: boolean;
  wasSplit: boolean;
  splitAces: boolean;
}

export interface HandSettlement {
  result: 'blackjack' | 'win' | 'lose' | 'push' | 'bust';
  payoutCents: number;
}

export interface Round {
  hands: Hand[];
  active: number;
  dealer: Card[];
  holeHidden: boolean;
  phase: 'insurance' | 'player' | 'done';
  hitSoft17: boolean;
  decks: number;
  insuranceBetCents: number;
  insuranceTaken: boolean;
  dealerNatural: boolean;
  settlements: HandSettlement[] | null;
  description: string | null;
  stakeCents: number;
  returnedCents: number;
  netCents: number;
}

export interface TableState {
  v: 1;
  shoe: Card[];
  round: Round | null;
}

export interface StepResult {
  bankrollCents: number;
  settled: boolean;
}

export function emptyTable(): TableState {
  return { v: 1, shoe: [], round: null };
}

export function parseTableState(value: unknown): TableState {
  if (!value || typeof value !== 'object') throw new Error('Invalid table state');
  const record = value as Partial<TableState>;
  if (record.v !== 1 || !Array.isArray(record.shoe)) throw new Error('Invalid table state');
  return {
    v: 1,
    shoe: record.shoe,
    round: record.round ?? null,
  };
}

export function isNatural(hand: Hand): boolean {
  return !hand.wasSplit && !hand.doubled && hand.cards.length === 2 && handTotal(hand.cards).total === 21;
}

export function legalActions(state: TableState, bankrollCents: number): GameAction[] {
  const round = state.round;
  if (!round || round.phase === 'done') return [];
  if (round.phase === 'insurance') {
    const hand = round.hands[0];
    if (!hand) return ['decline'];
    const cost = Math.floor(hand.betCents / 2);
    const canAfford = cost > 0 && bankrollCents >= cost;
    if (isNatural(hand)) return canAfford ? ['even_money', 'decline'] : ['decline'];
    return canAfford ? ['insurance', 'decline'] : ['decline'];
  }
  const hand = round.hands[round.active];
  if (!hand || handFinished(hand)) return [];
  const actions: GameAction[] = [];
  if (canHit(hand)) actions.push('hit', 'stand');
  if (canDouble(hand, bankrollCents)) actions.push('double');
  if (canSplit(round, hand, bankrollCents)) actions.push('split');
  return actions;
}

export function dealRound(
  state: TableState,
  betCents: number,
  bankrollCents: number,
  rules: Rules,
  shoeSource: ShoeSource,
): StepResult {
  if (state.round && state.round.phase !== 'done') {
    throw new RuleError('Finish the current hand before dealing again', 409);
  }
  if (state.round?.phase === 'done') state.round = null;
  assertBet(betCents, bankrollCents);
  ensureShoe(state, rules, shoeSource);

  const playerFirst = draw(state.shoe);
  const dealerUp = draw(state.shoe);
  const playerSecond = draw(state.shoe);
  const dealerHole = draw(state.shoe);
  bankrollCents -= betCents;

  const hand: Hand = {
    cards: [playerFirst, playerSecond],
    betCents,
    stood: false,
    doubled: false,
    wasSplit: false,
    splitAces: false,
  };
  const round: Round = {
    hands: [hand],
    active: 0,
    dealer: [dealerUp, dealerHole],
    holeHidden: true,
    phase: 'player',
    hitSoft17: rules.hitSoft17,
    decks: rules.decks,
    insuranceBetCents: 0,
    insuranceTaken: false,
    dealerNatural: false,
    settlements: null,
    description: null,
    stakeCents: betCents,
    returnedCents: 0,
    netCents: 0,
  };
  state.round = round;

  if (dealerUp.rank === 'A') {
    round.phase = 'insurance';
    return { bankrollCents, settled: false };
  }
  if (isTenValue(dealerUp) && dealerHole.rank === 'A') {
    return { bankrollCents: pay(state, bankrollCents), settled: true };
  }
  if (isNatural(hand)) {
    return { bankrollCents: pay(state, bankrollCents), settled: true };
  }
  return { bankrollCents, settled: false };
}

export function applyAction(
  state: TableState,
  action: GameAction,
  bankrollCents: number,
  shoeSource: ShoeSource,
): StepResult {
  const round = state.round;
  if (!round || round.phase === 'done') throw new RuleError('No hand in progress', 409);

  if (round.phase === 'insurance') {
    return takeInsurance(state, action, bankrollCents);
  }
  if (round.phase !== 'player') throw new RuleError('That action is not available right now', 409);
  if (!legalActions(state, bankrollCents).includes(action)) {
    throw new RuleError('That action is not available right now');
  }

  const hand = round.hands[round.active];
  if (!hand) throw new RuleError('No active hand');

  if (action === 'hit') {
    hand.cards.push(safeDraw(state, shoeSource));
    if (handTotal(hand.cards).total >= 21) hand.stood = true;
  } else if (action === 'stand') {
    hand.stood = true;
  } else if (action === 'double') {
    const extra = hand.betCents;
    bankrollCents -= extra;
    round.stakeCents += extra;
    hand.betCents += extra;
    hand.doubled = true;
    hand.cards.push(safeDraw(state, shoeSource));
    hand.stood = true;
  } else if (action === 'split') {
    bankrollCents = splitHand(state, hand, bankrollCents, shoeSource);
  } else {
    throw new RuleError('That action is not available right now');
  }

  bankrollCents = advance(state, bankrollCents, shoeSource);
  const settled = state.round?.phase === 'done';
  return { bankrollCents, settled };
}

/** Closes an in-progress hand without paying it. Chips already bet stay with the house. */
export function takeForfeit(state: TableState): Round | null {
  const round = state.round;
  if (!round || round.phase === 'done') return null;
  round.phase = 'done';
  round.holeHidden = false;
  round.active = -1;
  round.returnedCents = 0;
  round.netCents = -round.stakeCents;
  round.description = 'Hand forfeited. The bet stays with the house.';
  round.settlements = round.hands.map(() => ({ result: 'lose', payoutCents: 0 }));
  state.round = null;
  return round;
}

export function roundDetail(round: Round): Record<string, unknown> {
  return {
    dealer: round.dealer,
    dealerNatural: round.dealerNatural,
    insuranceBetCents: round.insuranceBetCents,
    hitSoft17: round.hitSoft17,
    description: round.description,
    hands: round.hands.map((hand, index) => ({
      cards: hand.cards,
      betCents: hand.betCents,
      doubled: hand.doubled,
      wasSplit: hand.wasSplit,
      splitAces: hand.splitAces,
      result: round.settlements?.[index]?.result ?? null,
      payoutCents: round.settlements?.[index]?.payoutCents ?? null,
    })),
  };
}

function assertBet(betCents: number, bankrollCents: number): void {
  if (!Number.isInteger(betCents) || betCents <= 0 || betCents % 100 !== 0) {
    throw new RuleError('Bets are in whole dollars');
  }
  if (betCents > bankrollCents) throw new RuleError('Bet is larger than your stack');
}

function ensureShoe(state: TableState, rules: Rules, shoeSource: ShoeSource): void {
  if (state.shoe.length >= rules.reshuffleBelow && state.shoe.length >= 4) return;
  state.shoe = shoeSource(rules.decks);
  if (state.shoe.length < 4) throw new RuleError('The shoe does not have enough cards to deal');
}

function draw(shoe: Card[]): Card {
  const dealt = shoe.pop();
  if (!dealt) throw new RuleError('The shoe ran out of cards');
  return dealt;
}

function cardKey(dealt: Card): string {
  return `${dealt.rank}${dealt.suit}`;
}

function cardsInPlay(state: TableState): Card[] {
  const round = state.round;
  if (!round) return [];
  return [...round.dealer, ...round.hands.flatMap((hand) => hand.cards)];
}

function subtractInPlay(shoe: Card[], inPlay: readonly Card[]): Card[] {
  const pending = inPlay.map((dealt) => cardKey(dealt));
  const remaining: Card[] = [];
  for (const dealt of shoe) {
    const key = cardKey(dealt);
    const index = pending.indexOf(key);
    if (index >= 0) {
      pending.splice(index, 1);
      continue;
    }
    remaining.push(dealt);
  }
  return remaining;
}

function safeDraw(state: TableState, shoeSource: ShoeSource): Card {
  if (state.shoe.length === 0) {
    const decks = state.round?.decks ?? 6;
    const fresh = subtractInPlay(shoeSource(decks), cardsInPlay(state));
    if (fresh.length === 0) throw new RuleError('The shoe ran out of cards');
    state.shoe = fresh;
  }
  return draw(state.shoe);
}

function canHit(hand: Hand): boolean {
  return !hand.splitAces && !hand.stood && !hand.doubled && handTotal(hand.cards).total < 21;
}

function canDouble(hand: Hand, bankrollCents: number): boolean {
  return (
    hand.cards.length === 2 &&
    !hand.splitAces &&
    !hand.doubled &&
    !hand.stood &&
    handTotal(hand.cards).total < 21 &&
    bankrollCents >= hand.betCents
  );
}

function canSplit(round: Round, hand: Hand, bankrollCents: number): boolean {
  if (hand.cards.length !== 2 || hand.splitAces || hand.stood || hand.doubled) return false;
  if (round.hands.length >= 4) return false;
  if (bankrollCents < hand.betCents) return false;
  const [left, right] = hand.cards;
  if (!left || !right) return false;
  return cardPoint(left.rank) === cardPoint(right.rank);
}

function handFinished(hand: Hand): boolean {
  if (hand.stood) return true;
  if (hand.splitAces && hand.cards.length >= 2) return true;
  return handTotal(hand.cards).total >= 21;
}

function splitHand(state: TableState, hand: Hand, bankrollCents: number, shoeSource: ShoeSource): number {
  const round = state.round!;
  const bet = hand.betCents;
  const moving = hand.cards.pop();
  if (!moving || !hand.cards[0]) throw new RuleError('Cannot split this hand');
  const aces = hand.cards[0].rank === 'A';
  bankrollCents -= bet;
  round.stakeCents += bet;
  hand.wasSplit = true;
  hand.splitAces = aces;
  hand.cards.push(safeDraw(state, shoeSource));
  const created: Hand = {
    cards: [moving, safeDraw(state, shoeSource)],
    betCents: bet,
    stood: false,
    doubled: false,
    wasSplit: true,
    splitAces: aces,
  };
  round.hands.splice(round.active + 1, 0, created);
  if (aces) {
    hand.stood = true;
    created.stood = true;
  } else if (handTotal(hand.cards).total >= 21) {
    hand.stood = true;
  }
  return bankrollCents;
}

function nextOpen(round: Round, from: number): number {
  for (let index = from + 1; index < round.hands.length; index += 1) {
    const hand = round.hands[index];
    if (hand && !handFinished(hand)) return index;
  }
  return -1;
}

function advance(state: TableState, bankrollCents: number, shoeSource: ShoeSource): number {
  const round = state.round;
  if (!round || round.phase !== 'player') return bankrollCents;
  for (let guard = 0; guard < 8; guard += 1) {
    const current = round.hands[round.active];
    if (current && !handFinished(current)) return bankrollCents;
    const next = nextOpen(round, round.active);
    if (next < 0) return settleAfterDealer(state, bankrollCents, shoeSource);
    round.active = next;
  }
  throw new RuleError('Could not advance the hand');
}

function dealerShouldHit(round: Round): boolean {
  const total = handTotal(round.dealer);
  if (total.total < 17) return true;
  if (total.total === 17 && total.soft && round.hitSoft17) return true;
  return false;
}

function settleAfterDealer(state: TableState, bankrollCents: number, shoeSource: ShoeSource): number {
  const round = state.round!;
  round.holeHidden = false;
  round.active = -1;
  const live = round.hands.some((hand) => handTotal(hand.cards).total <= 21);
  if (live) {
    while (dealerShouldHit(round)) {
      round.dealer.push(safeDraw(state, shoeSource));
    }
  }
  return pay(state, bankrollCents);
}

function takeInsurance(state: TableState, action: GameAction, bankrollCents: number): StepResult {
  const round = state.round!;
  const hand = round.hands[0];
  if (!hand) throw new RuleError('No hand in progress', 409);
  const taking = action === 'insurance' || action === 'even_money';
  if (action === 'even_money' && !isNatural(hand)) {
    throw new RuleError('Even money is only offered on blackjack');
  }
  if (!taking && action !== 'decline') {
    throw new RuleError('That action is not available right now', 409);
  }
  if (taking) {
    const cost = Math.floor(hand.betCents / 2);
    if (cost <= 0 || bankrollCents < cost) throw new RuleError('Not enough chips to take insurance');
    bankrollCents -= cost;
    round.insuranceBetCents = cost;
    round.insuranceTaken = true;
    round.stakeCents += cost;
  }
  const dealerNatural = round.dealer.length === 2 && handTotal(round.dealer).total === 21;
  if (dealerNatural || isNatural(hand)) {
    return { bankrollCents: pay(state, bankrollCents), settled: true };
  }
  round.phase = 'player';
  return { bankrollCents, settled: false };
}

/**
 * Stakes are already gone from the bankroll. Payouts put chips back.
 * Blackjack profit is 3:2, so a natural returns 5/2 of the stake.
 * Insurance pays 2:1, which returns 3 times the insurance stake.
 * A natural plus insurance against an ace is exactly even money either way.
 */
function pay(state: TableState, bankrollCents: number): number {
  const round = state.round!;
  const dealer = handTotal(round.dealer);
  const dealerNatural = round.dealer.length === 2 && dealer.total === 21;
  const dealerBust = dealer.total > 21;
  round.dealerNatural = dealerNatural;
  round.holeHidden = false;
  round.phase = 'done';
  round.active = -1;
  const settlements = round.hands.map((hand) => settleHand(hand, dealer.total, dealerBust, dealerNatural));
  let returned = 0;
  for (const settlement of settlements) returned += settlement.payoutCents;
  if (round.insuranceBetCents > 0 && dealerNatural) returned += round.insuranceBetCents * 3;
  round.settlements = settlements;
  round.returnedCents = returned;
  round.netCents = returned - round.stakeCents;
  round.description = describe(round);
  return bankrollCents + returned;
}

function settleHand(
  hand: Hand,
  dealerTotal: number,
  dealerBust: boolean,
  dealerNatural: boolean,
): HandSettlement {
  const total = handTotal(hand.cards).total;
  if (total > 21) return { result: 'bust', payoutCents: 0 };
  const natural = isNatural(hand);
  if (natural && dealerNatural) return { result: 'push', payoutCents: hand.betCents };
  if (natural) {
    return { result: 'blackjack', payoutCents: hand.betCents + Math.floor((hand.betCents * 3) / 2) };
  }
  if (dealerNatural) return { result: 'lose', payoutCents: 0 };
  if (dealerBust || total > dealerTotal) return { result: 'win', payoutCents: hand.betCents * 2 };
  if (total < dealerTotal) return { result: 'lose', payoutCents: 0 };
  return { result: 'push', payoutCents: hand.betCents };
}

function describe(round: Round): string {
  const only = round.hands.length === 1 ? round.hands[0] : undefined;
  if (only && isNatural(only) && round.insuranceTaken && round.dealer[0]?.rank === 'A') {
    return round.dealerNatural
      ? 'Even money. Dealer has blackjack.'
      : 'Even money. Dealer does not have blackjack.';
  }
  const parts: string[] = [];
  if (round.insuranceBetCents > 0) {
    parts.push(round.dealerNatural ? 'Insurance pays 2 to 1.' : 'Insurance loses.');
  }
  const settlements = round.settlements ?? [];
  if (round.hands.length === 1) {
    parts.push(describeOne(settlements[0], round));
  } else {
    settlements.forEach((settlement, index) => {
      const text = describeOne(settlement, round).replace(/\.$/, '');
      parts.push(`Hand ${index + 1}: ${text}.`);
    });
  }
  return parts.join(' ');
}

function describeOne(settlement: HandSettlement | undefined, round: Round): string {
  const dealerBust = handTotal(round.dealer).total > 21;
  switch (settlement?.result) {
    case 'blackjack':
      return 'Blackjack. Pays 3 to 2.';
    case 'bust':
      return 'Bust.';
    case 'push':
      return round.dealerNatural ? 'Push. Dealer also has blackjack.' : 'Push.';
    case 'win':
      return dealerBust ? 'Dealer busts. You win.' : 'You win.';
    case 'lose':
      return round.dealerNatural ? 'Dealer has blackjack.' : 'Dealer wins.';
    default:
      return 'Hand complete.';
  }
}
