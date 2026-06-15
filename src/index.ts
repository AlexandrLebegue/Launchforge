import dotenv from 'dotenv';
dotenv.config();

import { initEngine, getDb } from './db';
import app from './app';
import { startScheduler } from './services/scheduler';
import { startMetricsSync } from './services/metricsSync';
import { startKnowledgeSync } from './services/knowledgeSyncWorker';
import { startTelegramBot } from './services/telegramBot';
import { startMediaCleanup } from './services/mediaStore';
import { startWeeklyReports } from './services/analytics';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  await initEngine();
  getDb();

  const server = app.listen(PORT, () => {
    console.log(`🚀 LaunchForge API running on http://localhost:${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`📚 Plans:  http://localhost:${PORT}/api/plan`);
    startScheduler();
    startMetricsSync();
    startKnowledgeSync();
    startTelegramBot();
    startMediaCleanup();
    startWeeklyReports();
  });

  // Node coupe les requêtes à 300 s par défaut : un upload vidéo de 3 Go sur
  // une connexion domestique dépasse largement ça. 0 = illimité par requête ;
  // headersTimeout (60 s) reste actif contre les connexions zombies.
  server.requestTimeout = 0;
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
