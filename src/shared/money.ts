/** $100,000 in cents. The brief's "100000k" is read as one hundred thousand dollars. */
export const DEFAULT_STARTING_BANKROLL_CENTS = 10_000_000;

export const DEFAULT_DECKS = 6;

export function formatUsd(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const body = `${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`;
  return `${negative ? '-' : ''}$${body}`;
}

export function formatSignedUsd(cents: number): string {
  if (cents > 0) return `+${formatUsd(cents)}`;
  return formatUsd(cents);
}

export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const rest = negative ? trimmed.slice(1) : trimmed;
  const [dollars = '0', fraction = ''] = rest.split('.');
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}
