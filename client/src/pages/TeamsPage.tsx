import { useState, useEffect, useCallback } from 'react';
import Loader from '../components/Loader';
import { useSearchParams } from 'react-router-dom';
import { Users, Copy, Trash2 } from 'lucide-react';
import {
  getTeams, createTeam, getTeam, renameTeam, deleteTeam,
  createTeamInvite, deleteTeamInvite, updateTeamMemberRole, removeTeamMember, joinTeam,
  getMe, getOverview, assignPlanToTeam,
  TeamSummary, TeamDetail, TeamRole, ProjectSummary,
} from '../api/client';

const ROLE_LABEL: Record<TeamRole, string> = { owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur' };
const inviteLink = (code: string) => `${window.location.origin}/join?code=${code}`;

export default function TeamsPage() {
  const [teams,      setTeams]      = useState<TeamSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail,     setDetail]     = useState<TeamDetail | null>(null);
  const [myId,       setMyId]       = useState('');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [feedback,   setFeedback]   = useState('');
  const [newName,    setNewName]    = useState('');
  const [joinCode,   setJoinCode]   = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('editor');
  const [inviteDays, setInviteDays] = useState(7);
  const [projects,   setProjects]   = useState<ProjectSummary[]>([]);
  const [attachId,   setAttachId]   = useState('');
  const [busy,       setBusy]       = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadTeams = useCallback(async () => {
    const res = await getTeams();
    if (res.success && res.data) setTeams(res.data);
    setLoading(false);
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await getOverview();
    if (res.success && res.data) setProjects(res.data.projects);
  }, []);

  const openTeam = useCallback(async (id: string) => {
    setError('');
    const res = await getTeam(id);
    if (res.success && res.data) { setDetail(res.data); setSelectedId(id); }
    else setError(res.error || 'Chargement de l\'équipe impossible');
  }, []);

  useEffect(() => {
    getMe().then((r) => { if (r.success && r.data) setMyId(r.data.id); });
    loadTeams();
    loadProjects();
  }, [loadTeams, loadProjects]);

  // Arrivée via un lien d'invitation : ?join=CODE
  useEffect(() => {
    const code = searchParams.get('join');
    if (!code) return;
    searchParams.delete('join');
    setSearchParams(searchParams, { replace: true });
    (async () => {
      const res = await joinTeam(code);
      if (res.success && res.data) {
        setFeedback(res.data.alreadyMember
          ? `Vous êtes déjà membre de « ${res.data.team.name} ».`
          : `Vous avez rejoint « ${res.data.team.name} » comme ${ROLE_LABEL[res.data.role]}.`);
        await loadTeams();
        openTeam(res.data.team.id);
      } else {
        setError(res.error || 'Impossible de rejoindre cette équipe.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => { await loadTeams(); await loadProjects(); if (selectedId) await openTeam(selectedId); };

  const attachProject = async () => {
    if (!detail || !attachId) return;
    const res = await assignPlanToTeam(attachId, detail.team.id);
    if (res.success) { setAttachId(''); setFeedback('Projet rattaché à l\'équipe.'); refresh(); }
    else setError(res.error || 'Rattachement impossible.');
  };

  const detachProject = async (projectId: string) => {
    if (!window.confirm('Détacher ce projet de l\'équipe ? Il redeviendra personnel (propriétaire).')) return;
    const res = await assignPlanToTeam(projectId, null);
    if (res.success) { setFeedback('Projet détaché.'); refresh(); }
    else setError(res.error || 'Détachement impossible.');
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true); setError('');
    const res = await createTeam(newName.trim());
    setBusy(false);
    if (res.success && res.data) { setNewName(''); await loadTeams(); openTeam(res.data.id); }
    else setError(res.error || 'Création impossible.');
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setBusy(true); setError('');
    const res = await joinTeam(joinCode.trim());
    setBusy(false);
    if (res.success && res.data) {
      setJoinCode('');
      setFeedback(res.data.alreadyMember ? `Déjà membre de « ${res.data.team.name} ».` : `Vous avez rejoint « ${res.data.team.name} ».`);
      await loadTeams(); openTeam(res.data.team.id);
    } else setError(res.error || 'Code invalide.');
  };

  const handleInvite = async () => {
    if (!detail) return;
    setBusy(true); setError('');
    const res = await createTeamInvite(detail.team.id, inviteRole, inviteDays);
    setBusy(false);
    if (res.success) openTeam(detail.team.id);
    else setError(res.error || 'Génération du lien impossible.');
  };

  const copyLink = (code: string) => {
    navigator.clipboard?.writeText(inviteLink(code)).then(
      () => setFeedback('Lien d\'invitation copié.'),
      () => setError('Copie impossible — sélectionnez le lien manuellement.'),
    );
  };

  const revokeInvite = async (inviteId: string) => {
    if (!detail) return;
    await deleteTeamInvite(detail.team.id, inviteId);
    openTeam(detail.team.id);
  };

  const changeRole = async (userId: string, role: TeamRole) => {
    if (!detail) return;
    const res = await updateTeamMemberRole(detail.team.id, userId, role);
    if (res.success) openTeam(detail.team.id);
    else setError(res.error || 'Changement de rôle impossible.');
  };

  const removeMember = async (userId: string, name: string) => {
    if (!detail || !window.confirm(`Retirer ${name} de l'équipe ?`)) return;
    const res = await removeTeamMember(detail.team.id, userId);
    if (res.success) openTeam(detail.team.id);
    else setError(res.error || 'Retrait impossible.');
  };

  const leave = async () => {
    if (!detail || !window.confirm(`Quitter l'équipe « ${detail.team.name} » ?`)) return;
    const res = await removeTeamMember(detail.team.id, myId);
    if (res.success) { setDetail(null); setSelectedId(null); await loadTeams(); }
    else setError(res.error || 'Impossible de quitter l\'équipe.');
  };

  const rename = async () => {
    if (!detail) return;
    const name = window.prompt('Nouveau nom de l\'équipe :', detail.team.name)?.trim();
    if (!name) return;
    const res = await renameTeam(detail.team.id, name);
    if (res.success) refresh();
    else setError(res.error || 'Renommage impossible.');
  };

  const remove = async () => {
    if (!detail || !window.confirm(`Supprimer définitivement l'équipe « ${detail.team.name} » ? Ses projets redeviendront personnels (propriétaire).`)) return;
    const res = await deleteTeam(detail.team.id);
    if (res.success) { setDetail(null); setSelectedId(null); await loadTeams(); }
    else setError(res.error || 'Suppression impossible.');
  };

  if (loading) return <Loader text="Chargement des équipes…" />;

  const isOwner = detail?.role === 'owner';

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>Équipes</h1>
          <p>Créez une équipe et invitez des collaborateurs à travailler sur vos projets.</p>
        </div>
      </div>

      {feedback && <div className="approval-feedback" onClick={() => setFeedback('')}>{feedback}</div>}
      {error && <div className="chat-error" onClick={() => setError('')}>{error}</div>}

      <div className="teams-layout">
        {/* ── Colonne gauche : mes équipes + créer + rejoindre ── */}
        <div className="teams-sidebar">
          <div className="card">
            <div className="card-header">Mes équipes</div>
            {teams.length === 0 ? (
              <p className="form-hint">Vous n'appartenez à aucune équipe pour l'instant.</p>
            ) : (
              <div className="team-list">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    className={`team-list-item${selectedId === t.id ? ' active' : ''}`}
                    onClick={() => openTeam(t.id)}
                  >
                    <span className="team-list-avatar"><Users size={15} /></span>
                    <span className="team-list-text">
                      <span className="team-list-name">{t.name}</span>
                      <span className="team-list-meta">{ROLE_LABEL[t.role]} · {t.memberCount} membre{t.memberCount > 1 ? 's' : ''}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">Créer une équipe</div>
            <div className="ai-assist-row">
              <input className="form-input" value={newName} maxLength={60}
                     onChange={(e) => setNewName(e.target.value)} placeholder="Nom de l'équipe" />
              <button className="btn btn-primary" onClick={handleCreate} disabled={busy || !newName.trim()}>Créer</button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Rejoindre une équipe</div>
            <div className="ai-assist-row">
              <input className="form-input" value={joinCode}
                     onChange={(e) => setJoinCode(e.target.value)} placeholder="Code d'invitation" />
              <button className="btn btn-ghost" onClick={handleJoin} disabled={busy || !joinCode.trim()}>Rejoindre</button>
            </div>
            <span className="form-hint-inline">Collez le code reçu, ou ouvrez directement le lien d'invitation.</span>
          </div>
        </div>

        {/* ── Colonne droite : détail de l'équipe sélectionnée ── */}
        <div className="teams-detail">
          {!detail ? (
            <div className="plan-empty">
              <span className="plan-empty-icon"><Users size={40} /></span>
              <h2>Sélectionnez une équipe</h2>
              <p>Choisissez une équipe à gauche pour gérer ses membres et ses invitations.</p>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="config-card-head">
                  <span className="config-card-title">{detail.team.name}</span>
                  <span className={`team-role-badge role-${detail.role}`} style={{ marginLeft: 8 }}>{ROLE_LABEL[detail.role]}</span>
                  {isOwner && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost btn-sm" onClick={rename}>Renommer</button>
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={remove}>Supprimer</button>
                    </span>
                  )}
                  {!isOwner && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={leave}>Quitter</button>
                  )}
                </div>

                {/* Membres */}
                <div className="team-section-title">Membres ({detail.members.length})</div>
                <div className="team-members">
                  {detail.members.map((m) => {
                    const isTheOwner = m.userId === detail.team.ownerId;
                    const editable = isOwner && !isTheOwner;
                    return (
                      <div key={m.userId} className="team-member-row">
                        <span className="team-member-avatar">{(m.name || m.email).charAt(0).toUpperCase()}</span>
                        <span className="team-member-info">
                          <span className="team-member-name">{m.name || m.email}{m.userId === myId && ' (vous)'}</span>
                          <span className="team-member-email">{m.email}</span>
                        </span>
                        {editable ? (
                          <select className="form-input team-role-select" value={m.role}
                                  onChange={(e) => changeRole(m.userId, e.target.value as TeamRole)}>
                            <option value="editor">Éditeur</option>
                            <option value="viewer">Lecteur</option>
                          </select>
                        ) : (
                          <span className={`team-role-badge role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
                        )}
                        {editable && (
                          <button className="kanban-delete" title="Retirer ce membre"
                                  onClick={() => removeMember(m.userId, m.name || m.email)}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Projets de l'équipe (owner/editor) */}
              {detail.role !== 'viewer' && (
                <div className="card">
                  <div className="card-header">Projets de l'équipe</div>
                  {projects.filter((p) => p.teamId === detail.team.id).length === 0 ? (
                    <p className="form-hint">Aucun projet rattaché pour l'instant.</p>
                  ) : (
                    <div className="team-projects">
                      {projects.filter((p) => p.teamId === detail.team.id).map((p) => (
                        <div key={p.id} className="team-project-row">
                          <span className="team-project-name">{p.productName}</span>
                          <button className="btn btn-ghost btn-sm" onClick={() => detachProject(p.id)}>Détacher</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {projects.filter((p) => !p.teamId && p.role === 'owner').length > 0 && (
                    <div className="ai-assist-row" style={{ marginTop: 10 }}>
                      <select className="form-input" value={attachId} onChange={(e) => setAttachId(e.target.value)}>
                        <option value="">Rattacher un de mes projets…</option>
                        {projects.filter((p) => !p.teamId && p.role === 'owner').map((p) => (
                          <option key={p.id} value={p.id}>{p.productName}</option>
                        ))}
                      </select>
                      <button className="btn btn-primary" onClick={attachProject} disabled={!attachId}>Rattacher</button>
                    </div>
                  )}
                  <span className="form-hint-inline">Tous les membres accèdent aux projets rattachés (selon leur rôle). Les comptes utilisés pour publier sont ceux du propriétaire du projet.</span>
                </div>
              )}

              {/* Invitations (propriétaire) */}
              {isOwner && (
                <div className="card">
                  <div className="card-header">Invitations</div>
                  <p className="form-hint" style={{ marginBottom: 10 }}>
                    Générez un lien à partager. La personne le saisit (ou l'ouvre) pour rejoindre l'équipe avec le rôle choisi.
                    Un seul lien actif par rôle : régénérer renvoie le même lien — révoquez-le pour en créer un neuf.
                  </p>
                  <div className="ai-assist-row">
                    <select className="form-input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TeamRole)} style={{ flex: '0 0 120px' }}>
                      <option value="editor">Éditeur</option>
                      <option value="viewer">Lecteur</option>
                    </select>
                    <select className="form-input" value={inviteDays} onChange={(e) => setInviteDays(Number(e.target.value))} style={{ flex: '0 0 130px' }}>
                      <option value={1}>Expire en 1 jour</option>
                      <option value={7}>Expire en 7 jours</option>
                      <option value={30}>Expire en 30 jours</option>
                    </select>
                    <button className="btn btn-primary" onClick={handleInvite} disabled={busy}>Générer un lien</button>
                  </div>

                  {detail.invites.length > 0 && (
                    <div className="team-invites">
                      {detail.invites.map((inv) => (
                        <div key={inv.id} className="team-invite-row">
                          <code className="team-invite-link">{inviteLink(inv.code)}</code>
                          <div className="team-invite-actions">
                            <span className={`team-role-badge role-${inv.role}`}>{ROLE_LABEL[inv.role]}</span>
                            {inv.expiresAt && (
                              <span className="form-hint-inline" style={{ whiteSpace: 'nowrap' }}>
                                expire le {new Date(inv.expiresAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                              </span>
                            )}
                            <button className="btn btn-ghost btn-sm" title="Copier le lien" onClick={() => copyLink(inv.code)}><Copy size={14} /></button>
                            <button className="btn btn-ghost btn-sm" title="Révoquer" onClick={() => revokeInvite(inv.id)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <p className="form-hint">
                Les membres retrouvent les projets de l'équipe dans le sélecteur de projet (barre latérale) et y travaillent selon leur rôle.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
