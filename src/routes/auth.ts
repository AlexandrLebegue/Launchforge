import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, verifyPassword } from '../services/password';
import { signToken, requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { ApiResponse, User, AuthPayload } from '../types';

const router = Router();

router.post('/register', (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      const response: ApiResponse<null> = { success: false, error: 'Email and password are required.' };
      res.status(400).json(response);
      return;
    }

    if (password.length < 6) {
      const response: ApiResponse<null> = { success: false, error: 'Password must be at least 6 characters.' };
      res.status(400).json(response);
      return;
    }

    const existing = storage.getUserByEmail(email);
    if (existing) {
      const response: ApiResponse<null> = { success: false, error: 'A user with this email already exists.' };
      res.status(409).json(response);
      return;
    }

    const id = uuidv4();
    const hashed = hashPassword(password);
    const now = new Date().toISOString();

    const user: User = { id, email, name: name || '', createdAt: now };
    storage.saveUser(user, hashed);

    const token = signToken({ userId: id, email });
    const response: ApiResponse<{ user: User; token: string }> = { success: true, data: { user, token } };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.post('/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      const response: ApiResponse<null> = { success: false, error: 'Email and password are required.' };
      res.status(400).json(response);
      return;
    }

    const user = storage.getUserByEmail(email);
    if (!user) {
      const response: ApiResponse<null> = { success: false, error: 'Invalid email or password.' };
      res.status(401).json(response);
      return;
    }

    if (!verifyPassword(password, user.password)) {
      const response: ApiResponse<null> = { success: false, error: 'Invalid email or password.' };
      res.status(401).json(response);
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });
    const userData: User = { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };

    const response: ApiResponse<{ user: User; token: string }> = { success: true, data: { user: userData, token } };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  try {
    const payload = req.user as AuthPayload;
    const user = storage.getUserById(payload.userId);

    if (!user) {
      const response: ApiResponse<null> = { success: false, error: 'User not found.' };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<User> = { success: true, data: user };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error message',
    };
    res.status(500).json(response);
  }
});

export default router;
