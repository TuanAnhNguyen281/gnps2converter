import { it, expect } from "vitest";
import { estimateCost } from "./pricing.js";
it("estimates configured rates and preserves missing versus zero prices", () => {
  expect(
    estimateCost(12, 5, {
      input_price_per_million: 2,
      output_price_per_million: 5,
    }),
  ).toBe(0.000049);
  expect(
    estimateCost(12, 5, {
      input_price_per_million: null,
      output_price_per_million: 5,
    }),
  ).toBeNull();
  expect(
    estimateCost(12, 5, {
      input_price_per_million: 0,
      output_price_per_million: 0,
    }),
  ).toBe(0);
  expect(
    estimateCost(12, 5, {
      input_price_per_million: -1,
      output_price_per_million: 5,
    }),
  ).toBeNull();
});
