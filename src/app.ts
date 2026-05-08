import express from 'express';
import path from 'path';
import cors from 'cors';
import planRoutes from './routes/plan';
import templateRoutes from './routes/templates';
import feedbackRoutes from './routes/feedback';
import { rateLimit } from './middleware/rateLimit';
import { createLaunchPlan } from './services/planGenerator';
import { PlanInput, ApiResponse, LaunchPlan } from './types';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/api/plan', planRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/feedback', feedbackRoutes);

app.post('/', (req, res) => {
  try {
    const input: PlanInput = {
      productName: req.body.productName,
      description: req.body.description,
      targetAudience: req.body.targetAudience,
      niche: req.body.niche,
      goals: typeof req.body.goals === 'string' ? req.body.goals.split('\n').map((g: string) => g.trim()).filter(Boolean) : req.body.goals,
      pricing: req.body.pricing,
    };
    const plan = createLaunchPlan(input);
    const response: ApiResponse<LaunchPlan> = { success: true, data: plan };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

export default app;
