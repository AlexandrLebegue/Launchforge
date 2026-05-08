import { Router, Request, Response } from 'express';
import { researchProduct, ResearchResult } from '../services/research';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../types';

const router = Router();

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { productName, description, niche } = req.body;

    if (!productName || typeof productName !== 'string') {
      const response: ApiResponse<null> = { success: false, error: 'productName is required' };
      res.status(400).json(response);
      return;
    }

    const result = await researchProduct(productName, description || '', niche || '');

    const response: ApiResponse<ResearchResult> = { success: true, data: result };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'Research failed',
    };
    res.status(500).json(response);
  }
});

export default router;
