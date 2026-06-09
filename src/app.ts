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
import { rateLimit } from './middleware/rateLimit';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
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

const clientDist = path.resolve(process.cwd(), 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

export default app;
