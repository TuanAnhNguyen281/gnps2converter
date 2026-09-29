import { Router, type Request } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import * as oidc from "openid-client";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import type { Database } from "../db/index.js";
import { transaction } from "../db/index.js";
import type { Config } from "../config.js";
import { ApiError, owner, route } from "../errors.js";

const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(12, "Mật khẩu cần ít nhất 12 ký tự.").max(128);
const credentials = z.object({ email, password });
const publicUser = (u: Record<string, unknown>) => ({
  id: u.id,
  email: u.email,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
  hasPassword: !!u.password_hash,
});
export const csrfToken = () => randomBytes(32).toString("hex");
export function validCsrf(expected: string | undefined, supplied: unknown) {
  return (
    typeof supplied === "string" &&
    !!expected &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  );
}
export async function signIn(
  req: Request,
  userId: string,
  db: Database,
  verifiedVersion?: number,
) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
  req.session.userId = userId;
  req.session.csrf = csrfToken();
  req.session.issuedAt = Date.now();
  req.session.lastActive = Date.now();
  req.session.authVersion =
    verifiedVersion ??
    (await db.query("SELECT auth_version FROM users WHERE id=$1", [userId]))
      .rows[0].auth_version;
  await new Promise<void>((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
}
export function authRouter(db: Database, config: Config) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      message: "Quá nhiều lần thử. Hãy thử lại sau.",
      code: "RATE_LIMITED",
    },
  });
  const accountLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 15,
    keyGenerator: (req) =>
      String(req.body?.email ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 254),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      message: "Quá nhiều lần thử. Hãy thử lại sau.",
      code: "RATE_LIMITED",
    },
  });
  let hashing = 0;
  router.use((req, res, next) => {
    if (req.method !== "POST" || req.path === "/logout") return next();
    if (hashing >= 2)
      return next(
        new ApiError(429, "Hệ thống đang xử lý đăng nhập. Hãy thử lại."),
      );
    hashing++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        hashing--;
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  });
  let discovery: Promise<oidc.Configuration> | undefined;
  const google = () => {
    if (!config.googleId || !config.googleSecret)
      throw new ApiError(
        503,
        "Đăng nhập Google chưa được cấu hình.",
        "GOOGLE_UNAVAILABLE",
      );
    return (discovery ??= oidc
      .discovery(
        new URL("https://accounts.google.com"),
        config.googleId,
        config.googleSecret,
      )
      .catch((e) => {
        discovery = undefined;
        throw e;
      }));
  };
  router.get("/csrf", (_req, res) =>
    res.json({
      csrf: (_req.session.csrf ??= csrfToken()),
      googleEnabled: !!(config.googleId && config.googleSecret),
    }),
  );
  router.get(
    "/me",
    route(async (req, res) => {
      const id = owner(req);
      const u = await db.query("SELECT * FROM users WHERE id=$1", [id]);
      if (!u.rowCount)
        throw new ApiError(401, "Phiên đăng nhập không còn hợp lệ.");
      const linked = await db.query(
        "SELECT provider FROM auth_accounts WHERE user_id=$1",
        [id],
      );
      res.json({
        user: { ...publicUser(u.rows[0]), googleLinked: !!linked.rowCount },
        csrf: req.session.csrf,
      });
    }),
  );
  router.post(
    "/register",
    limiter,
    route(async (req, res) => {
      const input = credentials
        .extend({ displayName: z.string().trim().min(1).max(80) })
        .parse(req.body);
      const hash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const id = randomUUID();
      try {
        await db.query(
          "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)",
          [id, input.email, input.displayName, hash],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "Không thể đăng ký email này. Hãy đăng nhập hoặc dùng email khác.",
          );
        throw e;
      }
      await signIn(req, id, db);
      res
        .status(201)
        .json({
          user: {
            id,
            email: input.email,
            displayName: input.displayName,
            hasPassword: true,
          },
          csrf: req.session.csrf,
        });
    }),
  );
  const dummyHash = argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  router.post(
    "/login",
    limiter,
    accountLimiter,
    route(async (req, res) => {
      const input = credentials.parse(req.body);
      const result = await db.query("SELECT * FROM users WHERE email=$1", [
        input.email,
      ]);
      const user = result.rows[0];
      const valid = await argon2.verify(
        user?.password_hash ?? (await dummyHash),
        input.password,
      );
      if (!user?.password_hash || !valid)
        throw new ApiError(401, "Email hoặc mật khẩu không đúng.");
      await signIn(req, user.id, db, user.auth_version);
      res.json({ user: publicUser(user), csrf: req.session.csrf });
    }),
  );
  router.post(
    "/logout",
    route(async (req, res) => {
      await new Promise<void>((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      res.clearCookie("gnps.sid", {
        path: "/",
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
      });
      res.sendStatus(204);
    }),
  );
  router.post(
    "/change-password",
    limiter,
    route(async (req, res) => {
      const id = owner(req);
      const input = z
        .object({ oldPassword: password, newPassword: password })
        .parse(req.body);
      const hash = await argon2.hash(input.newPassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      await transaction(db, async (c) => {
        const u = (
          await c.query(
            "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (
          !u?.password_hash ||
          !(await argon2.verify(u.password_hash, input.oldPassword))
        )
          throw new ApiError(400, "Mật khẩu hiện tại không đúng.");
        await c.query(
          "UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2",
          [hash, id],
        );
        await c.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [id]);
      });
      await signIn(req, id, db);
      res.json({ csrf: req.session.csrf });
    }),
  );
  async function beginGoogle(req: Request, linkUser?: string) {
    const client = await google();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    req.session.oauth = {
      state,
      nonce,
      verifier,
      createdAt: Date.now(),
      linkUser,
    };
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: config.googleRedirect,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    await new Promise<void>((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    return url.href;
  }
  router.get(
    "/google",
    limiter,
    route(async (req, res) => {
      res.redirect(await beginGoogle(req));
    }),
  );
  router.post(
    "/google/link",
    limiter,
    route(async (req, res) => {
      const id = owner(req);
      const input = z.object({ password }).parse(req.body);
      const user = (
        await db.query("SELECT password_hash FROM users WHERE id=$1", [id])
      ).rows[0];
      if (
        !user?.password_hash ||
        !(await argon2.verify(user.password_hash, input.password))
      )
        throw new ApiError(401, "Mật khẩu hiện tại không đúng.");
      res.json({ url: await beginGoogle(req, id) });
    }),
  );
  router.get(
    "/google/callback",
    route(async (req, res) => {
      const challenge = req.session.oauth;
      if (
        !challenge ||
        Date.now() - challenge.createdAt > 600_000 ||
        (challenge.linkUser && challenge.linkUser !== req.session.userId)
      )
        throw new ApiError(400, "Phiên đăng nhập Google hết hạn. Hãy thử lại.");
      delete req.session.oauth;
      await new Promise<void>((resolve, reject) =>
        req.session.save((e) => (e ? reject(e) : resolve())),
      );
      try {
        const token = await oidc.authorizationCodeGrant(
          await google(),
          new URL(req.originalUrl, config.origin),
          {
            pkceCodeVerifier: challenge.verifier,
            expectedState: challenge.state,
            expectedNonce: challenge.nonce,
          },
        );
        const claims = token.claims();
        if (!claims?.sub || typeof claims.email !== "string")
          throw new ApiError(400, "Google không trả về tài khoản hợp lệ.");
        const googleEmail = email.parse(claims.email);
        const userId = await transaction(db, async (c) => {
          const existing = (
            await c.query(
              "SELECT user_id FROM auth_accounts WHERE provider='google' AND subject=$1",
              [claims.sub],
            )
          ).rows[0];
          if (existing) {
            if (challenge.linkUser && existing.user_id !== challenge.linkUser)
              throw new ApiError(409, "Google đã liên kết tài khoản khác.");
            return existing.user_id as string;
          }
          let id = challenge.linkUser;
          if (!id) {
            if (
              (
                await c.query("SELECT id FROM users WHERE email=$1", [
                  googleEmail,
                ])
              ).rowCount
            )
              throw new ApiError(
                409,
                "Email đã tồn tại. Đăng nhập bằng mật khẩu rồi chọn Liên kết Google.",
              );
            id = randomUUID();
            await c.query(
              "INSERT INTO users(id,email,display_name,email_verified_at) VALUES($1,$2,$3,$4)",
              [
                id,
                googleEmail,
                String(claims.name ?? googleEmail).slice(0, 80),
                claims.email_verified === true ? new Date() : null,
              ],
            );
          }
          await c.query(
            "INSERT INTO auth_accounts(id,user_id,provider,subject) VALUES($1,$2,'google',$3)",
            [randomUUID(), id, claims.sub],
          );
          return id;
        });
        await signIn(req, userId, db);
        res.redirect(config.origin);
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : "Đăng nhập Google thất bại hoặc đã hủy. Hãy thử lại.";
        res.redirect(
          `${config.origin}/?authError=${encodeURIComponent(message)}`,
        );
      }
    }),
  );
  return router;
}
