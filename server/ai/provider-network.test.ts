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
it("answers pinned lookups in both single and {all:true} forms", async () => {
  const { pinnedLookup } = await import("./provider.js");
  const pinned = pinnedLookup([
    { address: "2606:4700:3031::6815:3af", family: 6 },
    { address: "104.21.3.175", family: 4 },
  ]);
  const call = (options: any) =>
    new Promise<any[]>((resolve) =>
      pinned("motapis.com", options, (...args: any[]) => resolve(args)),
    );
  // Node 20+ happy eyeballs asks for every address at once.
  expect(await call({ all: true })).toEqual([
    null,
    [
      { address: "2606:4700:3031::6815:3af", family: 6 },
      { address: "104.21.3.175", family: 4 },
    ],
  ]);
  expect(await call({})).toEqual([null, "2606:4700:3031::6815:3af", 6]);
  expect(await call({ family: 4 })).toEqual([null, "104.21.3.175", 4]);
  expect(await call(4)).toEqual([null, "104.21.3.175", 4]);
  const [error] = await call({ family: 6, all: true });
  expect(error).toBeNull();
  const [missing] = await new Promise<any[]>((resolve) =>
    pinnedLookup([{ address: "104.21.3.175", family: 4 }])(
      "x",
      { family: 6 },
      (...args: any[]) => resolve(args),
    ),
  );
  expect(missing.code).toBe("ENOTFOUND");
});
