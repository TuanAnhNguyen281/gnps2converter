import { describe, expect, it } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import { userAvatarSource } from "./UserAvatar";

describe("Peek account avatars", () => {
  it("keeps the same face when the account name changes", () => {
    expect(userAvatarSource("account-123", "Nguyễn An", 34)).toBe(
      userAvatarSource("account-123", "Tên mới", 34),
    );
  });

  it("falls back to a trimmed name or a stable default without an ID", () => {
    expect(userAvatarSource(undefined, "  Nguyễn An  ", 34)).toBe(
      userAvatarSource("", "Nguyễn An", 34),
    );
    expect(userAvatarSource(undefined, " ", 34)).toBe(
      userAvatarSource("", "user", 34),
    );
  });

  it.each([32, 34, 60])(
    "produces valid standalone SVG at %ipx without exposing account text",
    (size) => {
      const source = userAvatarSource(
        undefined,
        'Nguyễn <An> & "Bạn" \uD800',
        size,
      );
      expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      const svg = decodeURIComponent(source.split(",")[1]);
      expect(XMLValidator.validate(svg)).toBe(true);
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("Nguyễn");
      expect(svg).not.toMatch(
        /<script|<image|<foreignObject|https?:\/\/(?!www\.w3\.org)/,
      );
    },
  );
});
