import "dotenv/config";
import { z } from "zod";

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, max = 1_000_000_000) =>
    z.coerce
      .number()
      .int()
      .positive()
      .max(max)
      .parse(env[key] ?? fallback);
  const production = env.NODE_ENV === "production";
  const origin = new URL(env.APP_ORIGIN ?? "http://localhost:5173");
  if (production && origin.protocol !== "https:")
    throw new Error("APP_ORIGIN production phải dùng HTTPS.");
  const secret = env.SESSION_SECRET ?? "";
  if (secret && secret.length < 32)
    throw new Error("SESSION_SECRET phải dài ít nhất 32 ký tự.");
  const googleRedirect =
    env.GOOGLE_REDIRECT_URI ?? `${origin.origin}/api/auth/google/callback`;
  if (new URL(googleRedirect).origin !== origin.origin)
    throw new Error("Google callback phải cùng APP_ORIGIN.");
  return {
    production,
    origin: origin.origin,
    databaseUrl: env.DATABASE_URL ?? "",
    secret,
    aiEncryptionKey: env.AI_ENCRYPTION_KEY ?? "",
    aiKeyVersion: env.AI_KEY_VERSION ?? "v1",
    aiPreviousKeys: env.AI_PREVIOUS_KEYS ?? "",
    aiAllowedHosts: (env.AI_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
    aiDailyRequests: integer("AI_DAILY_REQUESTS", 100, 10000),
    aiDailyTokens: integer("AI_DAILY_TOKEN_BUDGET", 500000),
    aiMaxConcurrent: integer("AI_MAX_CONCURRENT", 2, 10),
    aiMaxStorageBytes: integer("AI_MAX_STORAGE_BYTES", 50000000),
    aiTimeoutMs: integer("AI_TIMEOUT_MS", 90000, 180000),
    googleId: env.GOOGLE_CLIENT_ID ?? "",
    googleSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirect,
    cloudName: env.CLOUDINARY_CLOUD_NAME ?? "",
    cloudKey: env.CLOUDINARY_API_KEY ?? "",
    cloudSecret: env.CLOUDINARY_API_SECRET ?? "",
    maxReports: integer("MAX_REPORTS_PER_USER", 20),
    maxRows: integer("MAX_ROWS_PER_REPORT", 1000, 10000),
    maxJsonBytes: integer("MAX_REPORT_JSON_BYTES", 1048576),
    maxCloudBytes: integer("MAX_CLOUD_BYTES_PER_USER", 100_000_000),
    maxFileBytes: integer("MAX_FILE_BYTES", 9_500_000, 9_500_000),
    maxImageBytes: integer("MAX_IMAGE_BYTES", 2_000_000, 9_500_000),
    concurrency: integer("MAX_HEAVY_REQUESTS", 2, 20),
    trustProxy: env.TRUST_PROXY_HOPS
      ? integer("TRUST_PROXY_HOPS", 1, 5)
      : (false as false | number),
  };
}
export type Config = ReturnType<typeof readConfig>;
