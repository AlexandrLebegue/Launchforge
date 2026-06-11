import dotenv from 'dotenv';
dotenv.config();

import { initEngine, getDb } from './db';
import app from './app';
import { startScheduler } from './services/scheduler';
import { startMetricsSync } from './services/metricsSync';
import { startTelegramBot } from './services/telegramBot';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  await initEngine();
  getDb();

  app.listen(PORT, () => {
    console.log(`🚀 LaunchForge API running on http://localhost:${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`📚 Plans:  http://localhost:${PORT}/api/plan`);
    startScheduler();
    startMetricsSync();
    startTelegramBot();
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
