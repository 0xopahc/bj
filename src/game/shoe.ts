import { randomInt } from 'node:crypto';
import { RANKS, SUITS, type Card } from './cards.ts';

export type ShoeSource = (decks: number) => Card[];

export function buildShoe(decks: number, nextIndex: (exclusiveMax: number) => number): Card[] {
  if (!Number.isInteger(decks) || decks < 1 || decks > 8) {
    throw new Error('Decks must be an integer from 1 to 8');
  }
  const cards: Card[] = [];
  for (let deck = 0; deck < decks; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ rank, suit });
      }
    }
  }
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swap = nextIndex(index + 1);
    if (!Number.isInteger(swap) || swap < 0 || swap > index) {
      throw new Error('Shuffle index out of range');
    }
    const current = cards[index]!;
    cards[index] = cards[swap]!;
    cards[swap] = current;
  }
  return cards;
}

export function casinoShoe(decks: number): Card[] {
  return buildShoe(decks, (exclusiveMax) => randomInt(0, exclusiveMax));
}

/** Index 0 is dealt first. The shoe itself is a stack. */
export function shoeFromDrawOrder(drawOrder: readonly Card[]): Card[] {
  return [...drawOrder].reverse();
}

/**
 * Reshuffle before a round once fewer than this many cards remain.
 * Six decks cut at 78 cards (about 75% dealt). Shorter shoes still keep
 * a 40-card buffer so a split-and-double round cannot run the shoe dry.
 */
export function cutCardThreshold(decks: number): number {
  return Math.max(40, Math.floor(decks * 52 * 0.25));
}
