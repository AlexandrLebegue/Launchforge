/**
 * /api/teams — équipes et collaboration (Phase 1 : fondations).
 *
 * Créer/gérer une équipe, inviter par code/lien, gérer les membres et leurs
 * rôles (owner/editor/viewer). Le rattachement des PROJETS aux équipes et le
 * partage effectif des données arrivent en Phase 2.
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { Team, TeamRole } from '../types';

const router = Router();

// ── GET /api/teams/invite/:code — aperçu PUBLIC (page « Rejoindre » avant
// connexion) : nom de l'équipe + validité, sans authentification.
router.get('/invite/:code', (req: Request, res: Response) => {
  const invite = storage.getTeamInviteByCode(req.params.code);
  if (!invite) return res.status(404).json({ success: false, error: 'Invitation invalide' });
  const team = storage.getTeamById(invite.teamId);
  const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now());
  res.json({
    success: true,
    data: { valid: !expired && Boolean(team), expired, teamName: team?.name ?? null, role: invite.role },
  });
});

router.use(requireAuth);

/** Rôles attribuables via invitation ou changement — 'owner' ne s'attribue pas ainsi */
const ASSIGNABLE_ROLES: TeamRole[] = ['editor', 'viewer'];
/** Durées d'expiration proposées (jours) + valeur par défaut */
const ALLOWED_TTL_DAYS = [1, 7, 30];
const DEFAULT_TTL_DAYS = 7;

const isExpired = (iso: string | null) => Boolean(iso && new Date(iso).getTime() <= Date.now());

const genCode = () => randomBytes(6).toString('base64url'); // ~8 caractères url-safe

/** Charge l'équipe et vérifie l'appartenance ; répond 404/403 sinon. */
function loadMembership(req: Request, res: Response): { team: Team; role: TeamRole } | null {
  const team = storage.getTeamById(req.params.id);
  if (!team) { res.status(404).json({ success: false, error: 'Équipe introuvable' }); return null; }
  const role = storage.getTeamRole(team.id, req.user!.userId);
  if (!role) { res.status(403).json({ success: false, error: 'Vous ne faites pas partie de cette équipe' }); return null; }
  return { team, role };
}

function requireOwner(role: TeamRole, res: Response): boolean {
  if (role !== 'owner') { res.status(403).json({ success: false, error: 'Action réservée au propriétaire de l\'équipe' }); return false; }
  return true;
}

// ── GET /api/teams — mes équipes ─────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  res.json({ success: true, data: storage.getTeamsByUserId(req.user!.userId) });
});

// ── POST /api/teams — créer une équipe ───────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  const name = String((req.body as { name?: unknown }).name ?? '').trim();
  if (!name || name.length > 60) {
    return res.status(400).json({ success: false, error: 'Nom d\'équipe requis (60 caractères max)' });
  }
  res.status(201).json({ success: true, data: storage.createTeam(name, req.user!.userId) });
});

// ── POST /api/teams/join — rejoindre via un code d'invitation ─────────────────
router.post('/join', (req: Request, res: Response) => {
  const code = String((req.body as { code?: unknown }).code ?? '').trim();
  if (!code) return res.status(400).json({ success: false, error: 'Code d\'invitation requis' });

  const invite = storage.getTeamInviteByCode(code);
  if (!invite) return res.status(404).json({ success: false, error: 'Code d\'invitation invalide' });
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    return res.status(410).json({ success: false, error: 'Ce lien d\'invitation a expiré' });
  }
  const team = storage.getTeamById(invite.teamId);
  if (!team) return res.status(404).json({ success: false, error: 'Équipe introuvable' });

  const existing = storage.getTeamRole(team.id, req.user!.userId);
  if (existing) return res.json({ success: true, data: { team, role: existing, alreadyMember: true } });

  storage.addTeamMember(team.id, req.user!.userId, invite.role);
  res.json({ success: true, data: { team, role: invite.role, alreadyMember: false } });
});

// ── GET /api/teams/:id — détail (membres ; invitations pour le propriétaire) ──
router.get('/:id', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  let invites: ReturnType<typeof storage.getTeamInvites> = [];
  if (m.role === 'owner') {
    // Purge des liens expirés à la lecture, on ne renvoie que les liens actifs
    invites = storage.getTeamInvites(m.team.id);
    for (const inv of invites) if (isExpired(inv.expiresAt)) storage.deleteTeamInvite(inv.id);
    invites = invites.filter((inv) => !isExpired(inv.expiresAt));
  }
  res.json({
    success: true,
    data: {
      team: m.team,
      role: m.role,
      members: storage.getTeamMembers(m.team.id),
      invites,
    },
  });
});

// ── PATCH /api/teams/:id — renommer (propriétaire) ───────────────────────────
router.patch('/:id', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  if (!requireOwner(m.role, res)) return;
  const name = String((req.body as { name?: unknown }).name ?? '').trim();
  if (!name || name.length > 60) return res.status(400).json({ success: false, error: 'Nom invalide' });
  storage.renameTeam(m.team.id, name);
  res.json({ success: true, data: { ...m.team, name } });
});

// ── DELETE /api/teams/:id — supprimer (propriétaire) ─────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  if (!requireOwner(m.role, res)) return;
  storage.deleteTeam(m.team.id);
  res.json({ success: true, data: null });
});

// ── POST /api/teams/:id/invites — générer un lien d'invitation (propriétaire) ─
router.post('/:id/invites', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  if (!requireOwner(m.role, res)) return;
  const body = req.body as { role?: unknown; expiresInDays?: unknown };
  const role = body.role as TeamRole;
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: 'Rôle invalide (editor ou viewer)' });
  }
  const days = Number(body.expiresInDays);
  const ttl = ALLOWED_TTL_DAYS.includes(days) ? days : DEFAULT_TTL_DAYS;

  // Anti-accumulation : on réutilise le lien ACTIF existant du même rôle au lieu
  // d'en créer un nouveau à chaque clic. Pour un lien neuf, révoquer d'abord.
  const active = storage.getTeamInvites(m.team.id)
    .find((i) => i.role === role && !isExpired(i.expiresAt));
  if (active) return res.json({ success: true, data: active });

  let code = genCode();
  for (let i = 0; i < 5 && storage.getTeamInviteByCode(code); i++) code = genCode();
  const expiresAt = new Date(Date.now() + ttl * 86400_000).toISOString();
  res.status(201).json({ success: true, data: storage.createTeamInvite(m.team.id, code, role, expiresAt) });
});

// ── DELETE /api/teams/:id/invites/:inviteId — révoquer (propriétaire) ─────────
router.delete('/:id/invites/:inviteId', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  if (!requireOwner(m.role, res)) return;
  storage.deleteTeamInvite(req.params.inviteId);
  res.json({ success: true, data: null });
});

// ── PATCH /api/teams/:id/members/:userId — changer le rôle (propriétaire) ─────
router.patch('/:id/members/:userId', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  if (!requireOwner(m.role, res)) return;
  if (req.params.userId === m.team.ownerId) {
    return res.status(400).json({ success: false, error: 'Le rôle du propriétaire ne peut pas être changé' });
  }
  const role = (req.body as { role?: unknown }).role as TeamRole;
  if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Rôle invalide' });
  if (!storage.getTeamRole(m.team.id, req.params.userId)) {
    return res.status(404).json({ success: false, error: 'Membre introuvable' });
  }
  storage.updateTeamMemberRole(m.team.id, req.params.userId, role);
  res.json({ success: true, data: null });
});

// ── DELETE /api/teams/:id/members/:userId — retirer (propriétaire) ou quitter ─
router.delete('/:id/members/:userId', (req: Request, res: Response) => {
  const m = loadMembership(req, res); if (!m) return;
  const target = req.params.userId;
  const isSelf = target === req.user!.userId;
  if (!isSelf && !requireOwner(m.role, res)) return;
  if (target === m.team.ownerId) {
    return res.status(400).json({ success: false, error: 'Le propriétaire ne peut pas quitter — supprimez l\'équipe à la place' });
  }
  if (!storage.getTeamRole(m.team.id, target)) {
    return res.status(404).json({ success: false, error: 'Membre introuvable' });
  }
  storage.removeTeamMember(m.team.id, target);
  res.json({ success: true, data: null });
});

export default router;
