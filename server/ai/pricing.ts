export function estimateCost(
  input: number,
  output: number,
  prices: {
    input_price_per_million?: unknown;
    output_price_per_million?: unknown;
  },
): number | null {
  if (
    prices.input_price_per_million === null ||
    prices.input_price_per_million === undefined ||
    prices.output_price_per_million === null ||
    prices.output_price_per_million === undefined
  )
    return null;
  const a = Number(prices.input_price_per_million),
    b = Number(prices.output_price_per_million);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  return Number(((input * a + output * b) / 1000000).toFixed(8));
}
