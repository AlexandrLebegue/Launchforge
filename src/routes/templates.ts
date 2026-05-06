import { Router, Request, Response } from 'express';
import { getTemplates, getTemplateById } from '../templates';
import { ApiResponse, TemplateMeta } from '../types';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const templates = getTemplates();
    const response: ApiResponse<TemplateMeta[]> = {
      success: true,
      data: templates,
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = getTemplateById(id);

    if (!template) {
      const response: ApiResponse<null> = {
        success: false,
        error: `Template with id "${id}" not found`,
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<TemplateMeta> = {
      success: true,
      data: template,
    };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

export default router;
