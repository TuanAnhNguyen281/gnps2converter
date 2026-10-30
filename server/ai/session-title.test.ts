import { describe, expect, it } from "vitest";
import { cleanTitle, draftTitle } from "./session-title.js";

describe("session titles", () => {
  it("drafts from the first sentence and clips long questions", () => {
    expect(
      draftTitle("  Hợp chất nào có MQScore thấp?\nGiải thích lý do giúp tôi."),
    ).toBe("Hợp chất nào có MQScore thấp?");
    const long = draftTitle("so sánh ".repeat(30));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
    expect(draftTitle("   ")).toBe("Phiên nghiên cứu");
  });
  it("keeps one clean line from the model or gives up", () => {
    expect(cleanTitle('Tiêu đề: "Đánh giá MQScore flavonoid".')).toBe(
      "Đánh giá MQScore flavonoid",
    );
    expect(
      cleanTitle(
        "<think>ngắn gọn</think>\n**So sánh adduct [M+H]+**\nGiải thích",
      ),
    ).toBe("So sánh adduct [M+H]+");
    expect(cleanTitle("  \n ")).toBeNull();
    expect(cleanTitle(undefined)).toBeNull();
  });
});
