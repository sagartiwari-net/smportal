import { createApp } from "./app";
import { env } from "./config/env";
import { cleanupExpiredPendingInterns } from "./routes/registration.routes";

const app = createApp();

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

async function runPendingCleanup() {
  try {
    const n = await cleanupExpiredPendingInterns();
    if (n > 0) console.log(`[cleanup] Removed ${n} expired pending registration(s)`);
  } catch (err) {
    console.error("[cleanup] Failed:", err);
  }
}

app.listen(env.PORT, () => {
  console.log(`SMM Portal API running on http://localhost:${env.PORT}`);
  void runPendingCleanup();
  setInterval(() => void runPendingCleanup(), CLEANUP_INTERVAL_MS);
});
