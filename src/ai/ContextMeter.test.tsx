import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMeter, newChatReason } from "./ContextMeter";
import type { TokenPreview } from "./types";

const preview = (over: Partial<TokenPreview> = {}): TokenPreview =>
  ({
    contextLimit: 16000,
    outputMax: 2000,
    input: 3000,
    breakdown: {
      instructions: 500,
      data: 1500,
      history: 800,
      question: 200,
      tools: 0,
    },
    history: { included: 4, omitted: 0 },
    ...over,
  }) as TokenPreview;
const noop = () => {};

describe("context meter", () => {
  it("measures input against the window left after the output", () => {
    const html = renderToStaticMarkup(
      <ContextMeter
        preview={preview()}
        dismissed={false}
        disabled={false}
        onDismiss={noop}
        onNewChat={noop}
      />,
    );
    expect(html).toContain("~3.000 / 14.000 token (21%)");
    expect(html).toContain("2 lượt gần nhất");
    expect(html).not.toContain("Tạo hội thoại mới");
  });
  it("suggests a new chat when history is dropped, the window fills or history dominates", () => {
    expect(
      newChatReason(preview({ history: { included: 4, omitted: 6 } })),
    ).toContain("3 lượt cũ");
    expect(newChatReason(preview({ input: 10500 }))).toContain("75%");
    expect(
      newChatReason(
        preview({
          input: 6000,
          history: { included: 16, omitted: 0 },
          breakdown: {
            instructions: 500,
            data: 1500,
            history: 3500,
            question: 200,
            tools: 0,
          },
        }),
      ),
    ).toContain("8 lượt");
    expect(newChatReason(preview())).toBeNull();
    const html = renderToStaticMarkup(
      <ContextMeter
        preview={preview({ input: 12000 })}
        dismissed={false}
        disabled={false}
        onDismiss={noop}
        onNewChat={noop}
      />,
    );
    expect(html).toContain("Nên bắt đầu hội thoại mới");
    expect(
      renderToStaticMarkup(
        <ContextMeter
          preview={preview({ input: 12000 })}
          dismissed
          disabled={false}
          onDismiss={noop}
          onNewChat={noop}
        />,
      ),
    ).not.toContain("Nên bắt đầu");
  });
});
