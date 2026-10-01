import { it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
import { secureTransport, boundedJson } from "./provider.js";
beforeEach(() => vi.clearAllMocks());
it("blocks DNS resolving to private IP before sending an API key", async () => {
  mocks.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
  await expect(
    secureTransport(
      new URL("https://example.com/v1/models"),
      "secret",
      undefined,
      AbortSignal.timeout(1000),
    ),
  ).rejects.toThrow("địa chỉ");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("pins the validated DNS address on the actual connection and preserves TLS hostname", async () => {
  mocks.lookup
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  mocks.request.mockImplementation((url, options, callback) => {
    expect(url.hostname).toBe("example.com");
    options.lookup(
      "example.com",
      {},
      (err: any, address: string, family: number) => {
        expect(err).toBeNull();
        expect(address).toBe("8.8.8.8");
        expect(family).toBe(4);
      },
    );
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const response = Readable.from([Buffer.from("{}")]) as any;
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      callback(response);
    };
    return request;
  });
  const response = await secureTransport(
    new URL("https://example.com/v1/models"),
    "secret",
    undefined,
    AbortSignal.timeout(1000),
  );
  expect(await boundedJson(response)).toEqual({});
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
});
