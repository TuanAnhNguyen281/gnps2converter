import session from "express-session";
import type { Database } from "../db/index.js";
declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrf?: string;
    issuedAt?: number;
    lastActive?: number;
    authVersion?: number;
    oauth?: {
      state: string;
      nonce: string;
      verifier: string;
      createdAt: number;
      linkUser?: string;
    };
  }
}
// Small persistent store: expiry/touch are explicit, cleanup does not keep free hosts awake.
export class PostgresSessionStore extends session.Store {
  constructor(private db: Database) {
    super();
  }
  get(
    sid: string,
    cb: (error: unknown, value?: session.SessionData | null) => void,
  ) {
    this.db
      .query("SELECT sess FROM sessions WHERE sid=$1 AND expire>now()", [sid])
      .then((r) => cb(null, r.rows[0]?.sess ?? null), cb);
  }
  set(sid: string, value: session.SessionData, cb?: (error?: unknown) => void) {
    const expire = value.cookie.expires ?? new Date(Date.now() + 86400000);
    this.db
      .query(
        "INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=$2,expire=$3",
        [sid, JSON.stringify(value), expire],
      )
      .then(
        () => cb?.(),
        (error) => cb?.(error),
      );
  }
  destroy(sid: string, cb?: (error?: unknown) => void) {
    this.db.query("DELETE FROM sessions WHERE sid=$1", [sid]).then(
      () => cb?.(),
      (error) => cb?.(error),
    );
  }
  touch(
    _sid: string,
    _value: session.SessionData,
    cb?: (error?: unknown) => void,
  ) {
    cb?.();
  }
}
