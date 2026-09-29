import { afterEach, describe, expect, it, vi } from "vitest";
import { postProgressStream, setCsrf } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf("");
});

describe("progress event stream client", () => {
  it("parses chunked progress events and returns the final result", async () => {
    setCsrf("test-csrf");
    const encoder = new TextEncoder();
    const wire = [
      `event: progress\ndata: ${JSON.stringify({ stage: "enrichment", step: 4, totalSteps: 6, percent: 51, title: "Đang bổ sung", message: "2/4 hợp chất", current: 2, total: 4 })}\n\n`,
      `event: result\ndata: ${JSON.stringify({ reportId: "saved-report", rows: [] })}\n\n`,
    ].join("");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(wire.slice(0, 43)));
        controller.enqueue(encoder.encode(wire.slice(43, 109)));
        controller.enqueue(encoder.encode(wire.slice(109)));
        controller.close();
      },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const progress: Array<{ stage: string; current?: number }> = [];
    const result = await postProgressStream<{ reportId: string }>(
      "/api/gnps-task/import?progress=stream",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      (event) => progress.push(event),
    );
    expect(result.reportId).toBe("saved-report");
    expect(progress).toEqual([{ stage: "enrichment", current: 2, totalSteps: 6, percent: 51, title: "Đang bổ sung", message: "2/4 hợp chất", step: 4, total: 4 }]);
    expect(fetcher.mock.calls[0][1].headers.get("X-CSRF-Token")).toBe("test-csrf");
  });

  it("surfaces a backend error event and accepts a JSON response for compatibility", async () => {
    setCsrf("test-csrf");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(
        `event: error\ndata: ${JSON.stringify({ message: "Task chưa hoàn tất", code: "GNPS_TASK_NOT_DONE" })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ reportId: "legacy" }),
        { headers: { "Content-Type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetcher);
    await expect(postProgressStream("/api/gnps-task/import?progress=stream", { method: "POST" }, () => undefined))
      .rejects.toMatchObject({ message: "Task chưa hoàn tất", code: "GNPS_TASK_NOT_DONE" });
    await expect(postProgressStream<{ reportId: string }>("/api/gnps-task/import", { method: "POST" }, () => undefined))
      .resolves.toEqual({ reportId: "legacy" });
  });
});
