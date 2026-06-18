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
import { startConversationCleanup } from './services/conversationCleanup';
import { jwtSecretIsWeak } from './middleware/auth';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Sécurité : en production, refuser de démarrer avec un JWT_SECRET faible/par
  // défaut (sinon les jetons sont forgeables → usurpation de n'importe quel compte).
  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.APP_URL);
  if (isProd && jwtSecretIsWeak()) {
    throw new Error(
      'SECURITY: JWT_SECRET absent, trop court ou par défaut en production. ' +
      'Définissez une valeur aléatoire forte (`openssl rand -hex 32`) dans .env avant de démarrer.',
    );
  }

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
    startConversationCleanup();
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
