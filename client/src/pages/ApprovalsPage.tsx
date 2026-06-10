import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getApprovals, approveRun, rejectRun, ApprovalItem } from '../api/client';

const PLATFORM_ICONS: Record<string, string> = {
  reddit: '🟠', twitter: '🐦', linkedin: '💼', instagram: '📸',
  producthunt: '🐱', hackernews: '🟧', indiehackers: '🔨',
  discord: '💬', slack: '💛', github: '🐙',
};

interface CardState {
  content: string;
  busy: 'approve' | 'reject' | null;
  error: string | null;
}

export default function ApprovalsPage() {
  const [items,    setItems]    = useState<ApprovalItem[]>([]);
  const [states,   setStates]   = useState<Record<string, CardState>>({});
  const [loading,  setLoading]  = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getApprovals();
    if (res.success && res.data) {
      setItems(res.data);
      setStates((prev) => {
        const next: Record<string, CardState> = {};
        for (const item of res.data!) {
          // Conserver les éditions en cours, initialiser les nouveaux
          next[item.id] = prev[item.id] ?? { content: item.result || '', busy: null, error: null };
        }
        return next;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setCard = (id: string, patch: Partial<CardState>) =>
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleApprove = async (item: ApprovalItem) => {
    const state = states[item.id];
    setCard(item.id, { busy: 'approve', error: null });
    const edited = state.content.trim() !== (item.result || '').trim() ? state.content : undefined;
    const res = await approveRun(item.id, edited);
    if (res.success) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setFeedback(`✅ « ${item.cardTitle} » validé et traité.`);
    } else {
      setCard(item.id, { busy: null, error: res.error || 'La validation a échoué — réessayez.' });
    }
  };

  const handleReject = async (item: ApprovalItem) => {
    const reason = window.prompt('Raison du rejet (optionnelle — transmise à l\'historique) :') ?? undefined;
    setCard(item.id, { busy: 'reject', error: null });
    const res = await rejectRun(item.id, reason || undefined);
    if (res.success) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setFeedback(`🚫 « ${item.cardTitle} » rejeté.`);
    } else {
      setCard(item.id, { busy: null, error: res.error || 'Le rejet a échoué — réessayez.' });
    }
  };

  if (loading) return <div className="loading">⏳ Chargement des validations…</div>;

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>✋ Validations</h1>
          <p>
            {items.length === 0
              ? 'Aucune demande en attente — les agents en mode validation déposeront leurs contenus ici.'
              : `${items.length} contenu${items.length > 1 ? 's' : ''} proposé${items.length > 1 ? 's' : ''} par vos agents — relisez, modifiez si besoin, puis validez ou rejetez.`}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => { setLoading(true); load(); }}>
          ↺ Actualiser
        </button>
      </div>

      {feedback && (
        <div className="approval-feedback" onClick={() => setFeedback(null)}>
          {feedback}
        </div>
      )}

      {items.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">✅</span>
          <h2>Tout est à jour</h2>
          <p>
            Quand un agent en mode « validation » prépare un contenu, il apparaît ici
            pour relecture avant publication. Les agents en mode « auto » publient directement.
          </p>
          <Link to="/agents" className="btn btn-primary" style={{ display: 'inline-flex' }}>
            🤖 Gérer mes agents
          </Link>
        </div>
      ) : (
        <div className="approvals-list">
          {items.map((item) => {
            const state = states[item.id] ?? { content: item.result || '', busy: null, error: null };
            const edited = state.content.trim() !== (item.result || '').trim();
            return (
              <div key={item.id} className="approval-card animate-fadeInUp">
                <div className="approval-card-header">
                  <span className="approval-agent">
                    {PLATFORM_ICONS[item.agentPlatform] ?? '🤖'} {item.agentName}
                  </span>
                  <span className="approval-task">{item.cardTitle}</span>
                  <span className="approval-date">
                    {new Date(item.startedAt).toLocaleString('fr-FR', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  {!item.planId && (
                    <span className="chip" title="Tâche lancée depuis Telegram">💬 Telegram</span>
                  )}
                </div>

                <textarea
                  className="approval-content"
                  value={state.content}
                  onChange={(e) => setCard(item.id, { content: e.target.value })}
                  rows={Math.min(14, Math.max(5, state.content.split('\n').length + 1))}
                  disabled={state.busy !== null}
                />
                {edited && <div className="approval-edited-hint">✏️ Contenu modifié — la version éditée sera publiée</div>}
                {state.error && <div className="chat-error">{state.error}</div>}

                <div className="approval-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => handleApprove(item)}
                    disabled={state.busy !== null || !state.content.trim()}
                  >
                    {state.busy === 'approve' ? '⏳ Publication…' : '✅ Valider et publier'}
                  </button>
                  <button
                    className="btn btn-ghost btn-danger"
                    onClick={() => handleReject(item)}
                    disabled={state.busy !== null}
                  >
                    {state.busy === 'reject' ? '⏳…' : '🚫 Rejeter'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
