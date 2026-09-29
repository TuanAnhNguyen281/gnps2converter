import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
const config = readConfig();
const db = config.databaseUrl ? createDatabase(config) : undefined;
const { app, media } = createApp(config, db);
const server = app.listen(Number(process.env.PORT ?? 8787), "0.0.0.0", () => {
  console.log("GNPS2 API ready");
  if (!config.databaseUrl || !config.secret)
    console.log(
      "Auth cần DATABASE_URL và SESSION_SECRET trong .env. Xem README.",
    );
  if (media)
    void media
      .cleanup()
      .catch(() => console.error("[cleanup] Database unavailable"));
});
async function shutdown() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db?.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
