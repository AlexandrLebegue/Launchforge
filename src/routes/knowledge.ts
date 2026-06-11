/**
 * /api/knowledge — base de connaissances de l'utilisateur.
 * Injectée dans toutes les générations IA (assistant de contenu, agents).
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { KnowledgeCategory, KnowledgeEntry } from '../types';

const router = Router();
router.use(requireAuth);

const CATEGORIES: KnowledgeCategory[] = ['company', 'product', 'audience', 'tone', 'offers', 'learnings', 'other'];

function loadOwnedEntry(req: Request, res: Response): KnowledgeEntry | null {
  const entry = storage.getKnowledgeById(req.params.id);
  if (!entry || entry.userId !== req.user!.userId) {
    res.status(404).json({ success: false, error: 'Entry not found' });
    return null;
  }
  return entry;
}

// La base de connaissances est propre au projet actif
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  res.json({ success: true, data: storage.getKnowledgeByPlan(userId, storage.getActivePlanId(userId)) });
});

router.post('/', (req: Request, res: Response) => {
  const { title, content, category } = req.body as Partial<KnowledgeEntry>;
  if (!title || typeof title !== 'string' || !content || typeof content !== 'string') {
    return res.status(400).json({ success: false, error: 'title and content are required' });
  }

  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id:        uuid(),
    userId:    req.user!.userId,
    planId:    storage.getActivePlanId(req.user!.userId),
    category:  CATEGORIES.includes(category as KnowledgeCategory) ? (category as KnowledgeCategory) : 'other',
    title:     title.trim(),
    content:   content.trim(),
    createdAt: now,
    updatedAt: now,
  };
  storage.saveKnowledge(entry);
  res.status(201).json({ success: true, data: entry });
});

router.patch('/:id', (req: Request, res: Response) => {
  const entry = loadOwnedEntry(req, res);
  if (!entry) return;

  const { title, content, category } = req.body as Partial<KnowledgeEntry>;
  storage.updateKnowledge(entry.id, {
    title:    typeof title === 'string' && title.trim() ? title.trim() : undefined,
    content:  typeof content === 'string' && content.trim() ? content.trim() : undefined,
    category: CATEGORIES.includes(category as KnowledgeCategory) ? (category as KnowledgeCategory) : undefined,
  });
  res.json({ success: true, data: storage.getKnowledgeById(entry.id) });
});

router.delete('/:id', (req: Request, res: Response) => {
  const entry = loadOwnedEntry(req, res);
  if (!entry) return;
  storage.deleteKnowledge(entry.id);
  res.json({ success: true, data: null });
});

export default router;
