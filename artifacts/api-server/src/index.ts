import app from "./app";
import { logger } from "./lib/logger";
import { runCleanup } from "./routes/cleanup.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Daily cleanup at 21:00 UTC (midnight EAT)
  function scheduleNextCleanup() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(21, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      runCleanup()
        .then((r) => logger.info(r, "Scheduled cleanup complete"))
        .catch((e) => logger.error({ e }, "Scheduled cleanup failed"))
        .finally(scheduleNextCleanup);
    }, ms);
    logger.info({ nextRunMs: ms }, "Cleanup scheduled");
  }
  scheduleNextCleanup();
});
