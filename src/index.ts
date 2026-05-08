import dotenv from 'dotenv';
dotenv.config();

import { initEngine, getDb } from './db';
import app from './app';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  await initEngine();
  getDb();

  app.listen(PORT, () => {
    console.log(`🚀 LaunchForge API running on http://localhost:${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔐 Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`📚 Plans:  http://localhost:${PORT}/api/plan`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
