import { describe, expect, it } from "vitest";
import {
  calibrate,
  estimatePromptTokens,
  estimateTextTokens,
  nextCalibration,
} from "./tokens.js";

describe("token estimate", () => {
  it("weights accented Vietnamese heavier than ASCII", () => {
    expect(estimateTextTokens("abcdef")).toBe(2);
    expect(estimateTextTokens("ệệệ")).toBe(2);
    expect(estimateTextTokens("Sai số ppm lớn nhất")).toBeGreaterThan(
      estimateTextTokens("Max ppm error value"),
    );
  });
  it("adds per-message framing and tool schemas", () => {
    const one = estimatePromptTokens([{ role: "user", content: "hi" }]);
    expect(
      estimatePromptTokens([
        { role: "user", content: "hi" },
        { role: "user", content: "hi" },
      ]),
    ).toBeGreaterThan(one);
    expect(
      estimatePromptTokens([{ role: "user", content: "hi" }], [{ a: 1 }]),
    ).toBeGreaterThan(one);
  });
  it("calibrates with a safety margin and bounded EMA", () => {
    expect(calibrate(1000, null)).toBe(1000);
    expect(calibrate(1000, 0.5)).toBe(575);
    expect(calibrate(1000, 10)).toBe(3000);
    expect(nextCalibration(null, 500, 1000)).toBe(0.5);
    expect(nextCalibration(0.5, 1000, 1000)).toBe(0.65);
    expect(nextCalibration(0.5, 0, 1000)).toBeNull();
  });
});
