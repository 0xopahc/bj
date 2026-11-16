import type { GameAction, RoundView } from '../shared/types.ts';
import { handTotal } from './cards.ts';
import { isNatural, legalActions, type Hand, type Round, type TableState } from './engine.ts';

export function toRoundView(state: TableState, bankrollCents: number, revealHole = false): RoundView | null {
  const round = state.round;
  if (!round) return null;
  const showHole = revealHole || !round.holeHidden;
  const dealer = handTotal(round.dealer);
  const actions: GameAction[] = round.phase === 'done' ? [] : legalActions(state, bankrollCents);
  let insuranceKind: RoundView['insuranceKind'] = null;
  if (round.phase === 'insurance') {
    insuranceKind = round.hands[0] && isNatural(round.hands[0]) ? 'even_money' : 'insurance';
  }
  return {
    phase: round.phase,
    dealerCards: round.dealer.map((dealt, index) => {
      if (index === 1 && !showHole) return { hidden: true as const };
      return { rank: dealt.rank, suit: dealt.suit };
    }),
    dealerTotal: showHole ? dealer.total : null,
    dealerSoft: showHole ? dealer.soft : false,
    hands: round.hands.map((hand, index) => {
      const total = handTotal(hand.cards);
      return {
        label: round.hands.length === 1 ? 'Your hand' : `Hand ${index + 1}`,
        cards: hand.cards.map((dealt) => ({ rank: dealt.rank, suit: dealt.suit })),
        betCents: hand.betCents,
        total: total.total,
        soft: total.soft,
        status: statusFor(hand, round, index),
        active: round.phase === 'player' && round.active === index,
      };
    }),
    actions,
    insuranceKind,
    description: round.phase === 'done' ? round.description : null,
    netCents: round.phase === 'done' ? round.netCents : null,
    inPlayCents: round.phase === 'done' ? 0 : round.stakeCents,
  };
}

function statusFor(hand: Hand, round: Round, index: number): RoundView['hands'][number]['status'] {
  if (round.phase === 'done') return round.settlements?.[index]?.result ?? 'stood';
  const total = handTotal(hand.cards).total;
  if (total > 21) return 'bust';
  if (round.phase === 'player' && index === round.active && !handFinished(hand)) return 'playing';
  if (handFinished(hand)) return 'stood';
  return 'waiting';
}

function handFinished(hand: Hand): boolean {
  if (hand.stood) return true;
  if (hand.splitAces && hand.cards.length >= 2) return true;
  return handTotal(hand.cards).total >= 21;
}
