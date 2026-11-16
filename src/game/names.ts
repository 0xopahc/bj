const FIRST = [
  'Ace',
  'King',
  'Queen',
  'Jack',
  'Spade',
  'Heart',
  'Diamond',
  'Club',
  'River',
  'Felt',
  'Brass',
  'Ivory',
  'Cedar',
  'Harbor',
  'Willow',
  'Midnight',
];

const SECOND = ['Table', 'Shoe', 'Rail', 'Pit', 'Stack', 'Chip', 'Seat', 'Hold', 'Draw', 'Cut', 'Hand', 'Run'];

export function generateDisplayName(nextIndex: (exclusiveMax: number) => number): string {
  const first = FIRST[nextIndex(FIRST.length)] ?? 'Ace';
  const second = SECOND[nextIndex(SECOND.length)] ?? 'Table';
  const number = 100 + nextIndex(900);
  return `${first} ${second} ${number}`;
}
