import express from 'express';
import cors from 'cors';
import planRoutes from './routes/plan';
import templateRoutes from './routes/templates';
import feedbackRoutes from './routes/feedback';
import authRoutes from './routes/auth';
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

export default app;
