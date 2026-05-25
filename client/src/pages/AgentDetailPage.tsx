import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getAgentRuns, updateAgent, deleteAgent, getCatalog,
  Agent, AgentRun, AgentTemplate,
} from '../api/client';
import { getAgents } from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function runStatusClass(status: AgentRun['status']): string {
  return {
    pending: 'run-pending',
    running: 'run-running',
    done:    'run-done',
    failed:  'run-failed',
  }[status];
}

function runStatusLabel(status: AgentRun['status']): string {
  return {
    pending: '⏳ En attente',
    running: '⚡ En cours',
    done:    '✅ Terminé',
    failed:  '❌ Échoué',
  }[status];
}

function agentStatusLabel(status: Agent['status']): string {
  return { active: 'Actif', inactive: 'Inactif', error: 'Erreur' }[status];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();

  const [agent,    setAgent]    = useState<Agent | null>(null);
  const [runs,     setRuns]     = useState<AgentRun[]>([]);
  const [catalog,  setCatalog]  = useState<AgentTemplate[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  // Edition
  const [editName,   setEditName]   = useState('');
  const [editKey,    setEditKey]    = useState('');
  const [showKey,    setShowKey]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [agRes, catRes, runRes] = await Promise.all([
        getAgents(),
        getCatalog(),
        getAgentRuns(id),
      ]);

      if (agRes.success && agRes.data) {
        const found = agRes.data.find((a) => a.id === id);
        if (found) {
          setAgent(found);
          setEditName(found.name);
          setEditKey(found.apiKey || '');
        } else {
          setError('Agent introuvable');
        }
      }
      if (catRes.success && catRes.data) setCatalog(catRes.data);
      if (runRes.success && runRes.data) setRuns(runRes.data);

      setLoading(false);
    })();
  }, [id]);

  // Polling des runs "running" toutes les 3 secondes
  useEffect(() => {
    if (!id) return;
    const hasRunning = runs.some((r) => r.status === 'running' || r.status === 'pending');
    if (!hasRunning) return;

    const timer = setTimeout(async () => {
      const res = await getAgentRuns(id);
      if (res.success && res.data) setRuns(res.data);
    }, 3000);

    return () => clearTimeout(timer);
  }, [runs, id]);

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    setSaveMsg('');
    const res = await updateAgent(agent.id, { name: editName, apiKey: editKey });
    setSaving(false);
    if (res.success && res.data) {
      setAgent(res.data);
      setSaveMsg('✅ Enregistré');
      setTimeout(() => setSaveMsg(''), 3000);
    } else {
      setSaveMsg('❌ Erreur lors de la sauvegarde');
    }
  };

  const handleToggle = async () => {
    if (!agent) return;
    const newStatus = agent.status === 'active' ? 'inactive' : 'active';
    const res = await updateAgent(agent.id, { status: newStatus });
    if (res.success && res.data) setAgent(res.data);
  };

  const handleDelete = async () => {
    if (!agent) return;
    if (!confirm('Supprimer cet agent ? Cette action est irréversible.')) return;
    const res = await deleteAgent(agent.id);
    if (res.success) navigate('/agents');
  };

  if (loading) return <div className="loading">⏳ Chargement…</div>;

  if (error || !agent) {
    return (
      <div>
        <div className="error-banner">{error || 'Agent introuvable'}</div>
        <Link to="/agents" className="btn btn-ghost">← Retour aux agents</Link>
      </div>
    );
  }

  const tpl = catalog.find((t) => t.platform === agent.platform);

  return (
    <div className="animate-fadeIn">
      {/* Back */}
      <Link to="/agents" className="plan-back-btn">← Retour aux agents</Link>

      {/* Header */}
      <div className="plan-detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '2.5rem' }}>{tpl?.icon ?? '🤖'}</span>
          <div>
            <h1 style={{ marginBottom: 4 }}>{agent.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="chip">{agent.platform}</span>
              <span className={`agent-status-badge agent-status-${agent.status}`}>
                {agentStatusLabel(agent.status)}
              </span>
              {!agent.apiKey && (
                <span className="chip chip-warning">⚠️ Mode simulation</span>
              )}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className={`agent-toggle-btn${agent.status === 'active' ? ' on' : ''}`}
              onClick={handleToggle}
            >
              {agent.status === 'active' ? 'ON' : 'OFF'}
            </button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={handleDelete}>
              Supprimer
            </button>
          </div>
        </div>
      </div>

      <div className="agent-detail-grid">
        {/* ── Paramètres ── */}
        <div className="card animate-fadeInUp stagger-1">
          <div className="card-header">⚙️ Paramètres</div>

          <div className="form-group">
            <label className="form-label">Nom de l'agent</label>
            <input
              className="form-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Clé API {tpl?.composioApp ?? agent.platform.toUpperCase()}
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6, fontSize: '0.75rem' }}>
                — via Composio
              </span>
            </label>
            <div className="api-key-field">
              <input
                className="form-input"
                type={showKey ? 'text' : 'password'}
                value={editKey}
                onChange={(e) => setEditKey(e.target.value)}
                placeholder="Clé API ou token Composio…"
              />
              <button
                className="api-key-reveal"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? 'Masquer' : 'Afficher'}
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>
            <p className="form-hint">
              Connectez votre compte {tpl?.name ?? agent.platform} via{' '}
              <a href="https://composio.dev" target="_blank" rel="noopener noreferrer">Composio</a>{' '}
              pour activer les actions réelles.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
            </button>
            {saveMsg && <span style={{ fontSize: '0.85rem', color: saveMsg.startsWith('✅') ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
          </div>
        </div>

        {/* ── Stats rapides ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="stat-card animate-fadeInUp stagger-2">
            <div className="stat-value">{runs.length}</div>
            <div className="stat-label">Runs au total</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-3">
            <div className="stat-value" style={{ color: '#4ade80' }}>
              {runs.filter((r) => r.status === 'done').length}
            </div>
            <div className="stat-label">Réussis</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-4">
            <div className="stat-value" style={{ color: '#f87171' }}>
              {runs.filter((r) => r.status === 'failed').length}
            </div>
            <div className="stat-label">Échoués</div>
          </div>
          {agent.lastRunAt && (
            <div className="stat-card animate-fadeInUp stagger-5">
              <div className="stat-value" style={{ fontSize: '0.9rem' }}>
                {new Date(agent.lastRunAt).toLocaleDateString('fr-FR')}
              </div>
              <div className="stat-label">Dernier run</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Historique des runs ── */}
      <div className="card animate-fadeInUp stagger-3" style={{ marginTop: 24 }}>
        <div className="card-header">📋 Historique des exécutions</div>

        {runs.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Aucun run pour l'instant. Assignez une carte Kanban à cet agent depuis la vue Plan.
          </p>
        ) : (
          <div className="runs-table">
            {runs.map((run) => (
              <div key={run.id} className="run-row">
                <div className="run-row-left">
                  <span className={`run-status-badge ${runStatusClass(run.status)}`}>
                    {runStatusLabel(run.status)}
                  </span>
                  <div className="run-card-title">{run.cardTitle}</div>
                  <div className="run-meta">
                    {new Date(run.startedAt).toLocaleString('fr-FR')}
                    {run.completedAt && (
                      <span style={{ marginLeft: 8, color: 'var(--color-text-muted)' }}>
                        → {new Date(run.completedAt).toLocaleString('fr-FR')}
                      </span>
                    )}
                  </div>
                </div>
                {run.result && (
                  <div className="run-result">
                    {run.result.length > 120 ? run.result.slice(0, 120) + '…' : run.result}
                  </div>
                )}
                <Link to={`/plan/${run.planId}`} className="btn btn-ghost btn-sm">
                  Voir plan →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
