import express from 'express';
import path from 'path';
import cors from 'cors';
import planRoutes from './routes/plan';
import templateRoutes from './routes/templates';
import feedbackRoutes from './routes/feedback';
import authRoutes from './routes/auth';
import researchRoutes from './routes/research';
import agentRoutes from './routes/agents';
import onboardingRoutes from './routes/onboarding';
import approvalRoutes from './routes/approvals';
import postRoutes from './routes/posts';
import knowledgeRoutes from './routes/knowledge';
import knowledgeSyncRoutes from './routes/knowledgeSync';
import contentRoutes from './routes/content';
import contactRoutes from './routes/contacts';
import telegramRoutes from './routes/telegram';
import configRoutes from './routes/config';
import overviewRoutes from './routes/overview';
import assistantRoutes from './routes/assistant';
import deckRoutes from './routes/decks';
import teamRoutes from './routes/teams';
import adminRoutes from './routes/admin';
import { rateLimit } from './middleware/rateLimit';

const app = express();

app.use(cors());
// 15mb pour accepter les PDF en base64 joints à l'onboarding
app.use(express.json({ limit: '15mb' }));
app.use(rateLimit);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/api/auth', authRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/posts', postRoutes);
// Monté AVANT knowledgeRoutes : capte /sources… et /sync…, le reste retombe sur le CRUD
app.use('/api/knowledge', knowledgeSyncRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/config', configRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/decks', deckRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/admin', adminRoutes);

// Médias générés (GIF/MP4 des decks, visuels) — purge automatique à 90 jours.
// Le dossier est résolu à chaque requête : UPLOADS_DIR peut être posé après l'import.
import { uploadsDir } from './services/mediaStore';
app.use('/uploads', (req, res, next) => express.static(uploadsDir(), { maxAge: '7d' })(req, res, next));

// SEO : robots + sitemap construits depuis l'URL publique du déploiement
app.get('/robots.txt', (_req, res) => {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  res.type('text/plain').send(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /uploads/',
     ...(appUrl ? [`Sitemap: ${appUrl}/sitemap.xml`] : [])].join('\n'),
  );
});
app.get('/sitemap.xml', (_req, res) => {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!appUrl) return res.status(404).send('APP_URL non configurée');
  const pages = ['/', '/login', '/register', '/legal', '/privacy'];
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((u) => `  <url><loc>${appUrl}${u}</loc></url>`).join('\n') +
    `\n</urlset>`,
  );
});

const clientDist = path.resolve(process.cwd(), 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;
