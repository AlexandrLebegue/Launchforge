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
import contentRoutes from './routes/content';
import contactRoutes from './routes/contacts';
import telegramRoutes from './routes/telegram';
import configRoutes from './routes/config';
import overviewRoutes from './routes/overview';
import assistantRoutes from './routes/assistant';
import deckRoutes from './routes/decks';
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
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/config', configRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/decks', deckRoutes);

// Médias générés (GIF/MP4 des decks, visuels) — purge automatique à 90 jours.
// Le dossier est résolu à chaque requête : UPLOADS_DIR peut être posé après l'import.
import { uploadsDir } from './services/mediaStore';
app.use('/uploads', (req, res, next) => express.static(uploadsDir(), { maxAge: '7d' })(req, res, next));

const clientDist = path.resolve(process.cwd(), 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;
