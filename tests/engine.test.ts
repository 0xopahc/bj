import { describe, expect, it } from 'vitest';
import { card, handTotal, type Card } from '../src/game/cards.ts';
import {
  applyAction,
  dealRound,
  emptyTable,
  legalActions,
  takeForfeit,
  type Rules,
  type TableState,
} from '../src/game/engine.ts';
import { buildShoe, cutCardThreshold, shoeFromDrawOrder, type ShoeSource } from '../src/game/shoe.ts';
import { toRoundView } from '../src/game/view.ts';

const rules: Rules = {
  decks: 6,
  hitSoft17: false,
  reshuffleBelow: 0,
};

function play(drawOrder: Card[], bet = 2_000, bankroll = 10_000, house: Partial<Rules> = {}) {
  const state = emptyTable();
  const active = { ...rules, ...house };
  const result = dealRound(state, bet, bankroll, active, () => shoeFromDrawOrder(drawOrder));
  return { state, bankroll: result.bankrollCents, settled: result.settled, rules: active };
}

function act(state: TableState, bankroll: number, action: Parameters<typeof applyAction>[1]) {
  const result = applyAction(state, action, bankroll, () => {
    throw new Error('unexpected reshuffle');
  });
  return { bankroll: result.bankrollCents, bankrollCents: result.bankrollCents, settled: result.settled };
}

describe('casino blackjack', () => {
  it('pays a player blackjack 3 to 2 when the dealer does not have one', () => {
    const dealt = play([card('A', 'S'), card('10', 'D'), card('K', 'S'), card('9', 'H')]);
    expect(dealt.settled).toBe(true);
    expect(dealt.state.round?.netCents).toBe(3_000);
    expect(dealt.bankroll).toBe(13_000);
    expect(dealt.state.round?.description).toBe('Blackjack. Pays 3 to 2.');
    expect(dealt.state.round?.settlements?.[0]?.result).toBe('blackjack');
  });

  it('pushes when both sides have blackjack and the dealer shows a ten', () => {
    const dealt = play([card('A', 'S'), card('10', 'D'), card('K', 'S'), card('A', 'H')]);
    expect(dealt.state.round?.netCents).toBe(0);
    expect(dealt.bankroll).toBe(10_000);
    expect(dealt.state.round?.description).toContain('Push');
  });

  it('takes the bet when the dealer has blackjack and the player does not', () => {
    const dealt = play([card('9', 'S'), card('10', 'D'), card('8', 'C'), card('A', 'S')]);
    expect(dealt.settled).toBe(true);
    expect(dealt.bankroll).toBe(8_000);
    expect(dealt.state.round?.description).toBe('Dealer has blackjack.');
    expect(legalActions(dealt.state, dealt.bankroll)).toEqual([]);
  });

  it('offers insurance on an ace and breaks even when the dealer has blackjack', () => {
    const dealt = play([card('9', 'S'), card('A', 'S'), card('8', 'C'), card('K', 'S')]);
    expect(dealt.state.round?.phase).toBe('insurance');
    expect(legalActions(dealt.state, dealt.bankroll)).toEqual(['insurance', 'decline']);
    const taken = act(dealt.state, dealt.bankroll, 'insurance');
    expect(taken.settled).toBe(true);
    expect(taken.bankroll).toBe(10_000);
    expect(dealt.state.round?.netCents).toBe(0);
    expect(dealt.state.round?.description).toContain('Insurance pays 2 to 1.');
  });

  it('lets a five-dollar bet insure for two dollars and fifty cents', () => {
    const dealt = play([card('9', 'S'), card('A', 'H'), card('8', 'C'), card('K', 'D')], 500, 10_000);
    const taken = act(dealt.state, dealt.bankroll, 'insurance');
    expect(dealt.state.round?.insuranceBetCents).toBe(250);
    expect(taken.bankroll).toBe(10_000);
  });

  it('pays even money when blackjack takes insurance against an ace', () => {
    const cards = [card('A', 'S'), card('A', 'H'), card('K', 'S'), card('9', 'D')];
    const declined = play(cards);
    expect(legalActions(declined.state, declined.bankroll)).toEqual(['even_money', 'decline']);
    const passed = act(declined.state, declined.bankroll, 'decline');
    expect(passed.bankroll).toBe(13_000);
    expect(declined.state.round?.description).toBe('Blackjack. Pays 3 to 2.');

    const taken = play(cards);
    const even = act(taken.state, taken.bankroll, 'even_money');
    expect(even.bankroll).toBe(12_000);
    expect(taken.state.round?.netCents).toBe(2_000);
    expect(taken.state.round?.description).toContain('Even money');
  });

  it('stands on soft 17 and hits hard 16', () => {
    // Up card is the six, so this is not an insurance hand. Hole ace makes soft 17.
    const softCards = [card('10', 'S'), card('6', 'C'), card('8', 'D'), card('A', 'S'), card('2', 'H')];
    const soft = play(softCards);
    expect(soft.state.round?.phase).toBe('player');
    const stood = act(soft.state, soft.bankroll, 'stand');
    expect(soft.state.round?.dealer).toHaveLength(2);
    expect(handTotal(soft.state.round!.dealer).total).toBe(17);
    expect(stood.bankroll).toBe(12_000);
    expect(soft.state.round?.description).toBe('You win.');

    const hitting = play(softCards, 2_000, 10_000, {
      hitSoft17: true,
    });
    act(hitting.state, hitting.bankroll, 'stand');
    expect(hitting.state.round?.dealer).toHaveLength(3);
    expect(handTotal(hitting.state.round!.dealer).total).toBe(19);
    expect(hitting.state.round?.netCents).toBe(-2_000);

    const sixteen = play([card('10', 'S'), card('9', 'D'), card('7', 'C'), card('7', 'H'), card('K', 'S')]);
    act(sixteen.state, sixteen.bankroll, 'stand');
    expect(sixteen.state.round?.dealer).toHaveLength(3);
    expect(sixteen.state.round?.description).toBe('Dealer busts. You win.');
    expect(sixteen.state.round?.netCents).toBe(2_000);
  });

  it('loses a bust immediately and does not let the dealer draw', () => {
    const dealt = play([card('10', 'S'), card('10', 'D'), card('6', 'C'), card('6', 'H'), card('K', 'H'), card('A', 'S')]);
    act(dealt.state, dealt.bankroll, 'hit');
    expect(dealt.state.round?.hands[0]?.cards).toHaveLength(3);
    expect(dealt.state.round?.dealer).toHaveLength(2);
    expect(dealt.state.round?.settlements?.[0]?.result).toBe('bust');
    expect(dealt.state.round?.netCents).toBe(-2_000);
    expect(dealt.state.shoe.map((dealtCard) => dealtCard.rank)).toContain('A');
  });

  it('doubles for one card and pays the doubled stake', () => {
    const dealt = play([card('5', 'S'), card('10', 'D'), card('6', 'C'), card('7', 'H'), card('10', 'S')]);
    const finished = act(dealt.state, dealt.bankroll, 'double');
    expect(dealt.state.round?.hands[0]?.cards).toHaveLength(3);
    expect(dealt.state.round?.hands[0]?.betCents).toBe(4_000);
    expect(finished.bankroll).toBe(14_000);
    expect(dealt.state.round?.netCents).toBe(4_000);
    expect(() => act(dealt.state, finished.bankroll, 'hit')).toThrow(/not available|No hand/);
  });

  it('rejects a double after a hit and a split of unequal cards', () => {
    const dealt = play([card('5', 'S'), card('10', 'D'), card('2', 'C'), card('9', 'H'), card('3', 'D')]);
    expect(legalActions(dealt.state, dealt.bankroll)).not.toContain('split');
    expect(() => act(dealt.state, dealt.bankroll, 'split')).toThrow(/not available/);
    const hit = act(dealt.state, dealt.bankroll, 'hit');
    expect(() => act(dealt.state, hit.bankroll, 'double')).toThrow(/not available/);
  });

  it('refuses a double the stack cannot cover', () => {
    const dealt = play([card('5', 'S'), card('10', 'D'), card('6', 'C'), card('9', 'H')], 2_000, 3_000);
    expect(dealt.bankroll).toBe(1_000);
    expect(legalActions(dealt.state, dealt.bankroll)).not.toContain('double');
  });

  it('pays a split ace and ten as 1 to 1, not 3 to 2', () => {
    const dealt = play(
      [card('A', 'S'), card('10', 'D'), card('A', 'H'), card('9', 'C'), card('K', 'D'), card('8', 'S')],
      1_000,
      10_000,
    );
    const finished = act(dealt.state, dealt.bankroll, 'split');
    expect(finished.settled).toBe(true);
    expect(dealt.state.round?.hands).toHaveLength(2);
    expect(dealt.state.round?.settlements?.[0]).toEqual({ result: 'win', payoutCents: 2_000 });
    expect(dealt.state.round?.settlements?.[1]).toEqual({ result: 'push', payoutCents: 1_000 });
    expect(dealt.state.round?.netCents).toBe(1_000);
    expect(legalActions(dealt.state, finished.bankroll)).not.toContain('hit');
  });

  it('allows three splits and stops at four hands', () => {
    const dealt = play(
      [
        card('8', 'S'),
        card('10', 'H'),
        card('8', 'C'),
        card('9', 'D'),
        card('8', 'D'),
        card('8', 'H'),
        card('8', 'C'),
        card('3', 'D'),
        card('K', 'H'),
        card('5', 'C'),
      ],
      1_000,
      100_000,
    );
    let bankroll = dealt.bankroll;
    bankroll = act(dealt.state, bankroll, 'split').bankrollCents;
    expect(dealt.state.round?.hands).toHaveLength(2);
    bankroll = act(dealt.state, bankroll, 'split').bankrollCents;
    expect(dealt.state.round?.hands).toHaveLength(3);
    expect(legalActions(dealt.state, bankroll)).toContain('split');
    bankroll = act(dealt.state, bankroll, 'split').bankrollCents;
    expect(dealt.state.round?.hands).toHaveLength(4);
    expect(legalActions(dealt.state, bankroll)).not.toContain('split');
    while (dealt.state.round?.phase === 'player') {
      if (dealt.state.round.active === 3) {
        expect(legalActions(dealt.state, bankroll)).not.toContain('split');
      }
      expect(legalActions(dealt.state, bankroll).length).toBeGreaterThan(0);
      bankroll = act(dealt.state, bankroll, 'stand').bankrollCents;
    }
    expect(dealt.state.round?.settlements).toHaveLength(4);
    expect(dealt.state.round?.netCents).toBe(-4_000);
    expect(bankroll).toBe(96_000);
  });

  it('pushes equal totals', () => {
    const dealt = play([card('10', 'S'), card('10', 'D'), card('9', 'C'), card('9', 'H')]);
    act(dealt.state, dealt.bankroll, 'stand');
    expect(dealt.state.round?.netCents).toBe(0);
    expect(dealt.state.round?.description).toBe('Push.');
  });

  it('rejects bets that are not whole dollars or larger than the stack without burning a card', () => {
    const state = emptyTable();
    state.shoe = shoeFromDrawOrder([card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H'), card('2', 'S')]);
    const source: ShoeSource = () => {
      throw new Error('shoe should stay put');
    };
    expect(() => dealRound(state, 50, 10_000, rules, source)).toThrow(/whole dollars/);
    expect(() => dealRound(state, 20_000, 10_000, rules, source)).toThrow(/larger than your stack/);
    expect(state.round).toBeNull();
    expect(state.shoe).toHaveLength(5);
  });

  it('accepts a one-dollar bet and any whole-dollar bet the stack covers', () => {
    const small = emptyTable();
    small.shoe = shoeFromDrawOrder([card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H')]);
    const source: ShoeSource = () => {
      throw new Error('shoe should stay put');
    };
    expect(dealRound(small, 100, 10_000, rules, source).bankrollCents).toBe(9_900);

    const large = emptyTable();
    large.shoe = shoeFromDrawOrder([card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H')]);
    const dealt = dealRound(large, 5_000_000, 10_000_000, rules, source);
    expect(dealt.bankrollCents).toBe(5_000_000);
    expect(large.round?.hands[0]?.betCents).toBe(5_000_000);
  });

  it('offers only decline when the stack cannot pay insurance', () => {
    const dealt = play([card('10', 'S'), card('A', 'H'), card('9', 'C'), card('5', 'D')], 2_000, 2_000);
    expect(dealt.bankroll).toBe(0);
    expect(legalActions(dealt.state, dealt.bankroll)).toEqual(['decline']);
    expect(() => act(dealt.state, dealt.bankroll, 'insurance')).toThrow(/Not enough/);
  });

  it('forfeits an open hand and leaves a finished hand alone', () => {
    const dealt = play([card('10', 'S'), card('9', 'D'), card('6', 'C'), card('7', 'H')], 2_000, 10_000);
    const forfeited = takeForfeit(dealt.state);
    expect(forfeited?.netCents).toBe(-2_000);
    expect(forfeited?.description).toContain('forfeited');
    expect(dealt.state.round).toBeNull();
    expect(takeForfeit(dealt.state)).toBeNull();
  });

  it('reshuffles before the deal when the shoe is inside the cut card', () => {
    const state = emptyTable();
    state.shoe = shoeFromDrawOrder([card('2', 'S'), card('2', 'H'), card('2', 'D')]);
    let builds = 0;
    dealRound(state, 1_000, 10_000, { ...rules, reshuffleBelow: 40 }, () => {
      builds += 1;
      return shoeFromDrawOrder([card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H')]);
    });
    expect(builds).toBe(1);
    expect(state.round?.hands[0]?.cards[0]).toEqual(card('10', 'S'));
    expect(cutCardThreshold(6)).toBe(78);
    expect(cutCardThreshold(1)).toBe(40);
  });

  it('keeps a scripted shoe when reshuffles are disabled', () => {
    const state = emptyTable();
    state.shoe = shoeFromDrawOrder([card('10', 'S'), card('9', 'D'), card('8', 'C'), card('7', 'H')]);
    dealRound(state, 1_000, 10_000, rules, () => {
      throw new Error('unexpected reshuffle');
    });
    expect(state.round?.hands[0]?.cards[0]).toEqual(card('10', 'S'));
  });

  it('rebuilds an empty shoe without duplicating cards that are already in play', () => {
    const state = emptyTable();
    state.round = {
      hands: [
        {
          cards: [card('A', 'S'), card('9', 'H')],
          betCents: 1_000,
          stood: false,
          doubled: false,
          wasSplit: false,
          splitAces: false,
        },
      ],
      active: 0,
      dealer: [card('10', 'D'), card('6', 'C')],
      holeHidden: true,
      phase: 'player',
      hitSoft17: false,
      decks: 1,
      insuranceBetCents: 0,
      insuranceTaken: false,
      dealerNatural: false,
      settlements: null,
      description: null,
      stakeCents: 1_000,
      returnedCents: 0,
      netCents: 0,
    };
    applyAction(state, 'hit', 5_000, (decks) => buildShoe(decks, () => 0));
    const round = state.round;
    if (!round) throw new Error('round missing');
    const all = [...state.shoe, ...round.dealer, ...round.hands.flatMap((hand) => hand.cards)];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((dealt) => `${dealt.rank}${dealt.suit}`)).size).toBe(52);
  });

  it('hides the hole card until the hand is over', () => {
    const dealt = play([card('10', 'S'), card('A', 'H'), card('9', 'C'), card('Q', 'D')]);
    const hidden = toRoundView(dealt.state, dealt.bankroll);
    const revealed = toRoundView(dealt.state, dealt.bankroll, true);
    expect(hidden?.dealerCards[1]).toEqual({ hidden: true });
    expect(JSON.stringify(hidden)).not.toContain('"Q"');
    expect(revealed?.dealerCards[1]).toEqual({ rank: 'Q', suit: 'D' });
  });

  it('builds a full six-deck shoe', () => {
    const shoe = buildShoe(6, (max) => max - 1);
    expect(shoe).toHaveLength(312);
    const aces = shoe.filter((dealt) => dealt.rank === 'A');
    expect(aces).toHaveLength(24);
  });
});
