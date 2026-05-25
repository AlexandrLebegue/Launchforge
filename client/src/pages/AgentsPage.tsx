import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getAgents, getCatalog, createAgent, updateAgent, deleteAgent,
  Agent, AgentTemplate, AgentPlatform,
} from '../api/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusLabel(status: Agent['status']): string {
  return { active: 'Actif', inactive: 'Inactif', error: 'Erreur' }[status];
}

// ── Modal — Ajouter un agent ──────────────────────────────────────────────────

interface AddModalProps {
  catalog:  AgentTemplate[];
  onClose:  () => void;
  onAdded:  (agent: Agent) => void;
}

function AddAgentModal({ catalog, onClose, onAdded }: AddModalProps) {
  const [selected, setSelected] = useState<AgentPlatform | null>(null);
  const [apiKey,   setApiKey]   = useState('');
  const [name,     setName]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const template = catalog.find((t) => t.platform === selected);

  const handleSelect = (platform: AgentPlatform) => {
    setSelected(platform);
    const tpl = catalog.find((t) => t.platform === platform);
    if (tpl) setName(tpl.name);
    setError('');
  };

  const handleAdd = async () => {
    if (!selected) { setError('Sélectionne une plateforme'); return; }
    setSaving(true);
    setError('');
    const res = await createAgent({ platform: selected, name: name || undefined, apiKey: apiKey || undefined });
    setSaving(false);
    if (res.success && res.data) {
      onAdded(res.data);
    } else {
      setError(res.error || 'Erreur lors de la création');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Ajouter un agent IA</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Catalogue */}
        <div className="catalog-grid">
          {catalog.map((tpl) => (
            <button
              key={tpl.platform}
              className={`catalog-card${selected === tpl.platform ? ' selected' : ''}`}
              onClick={() => handleSelect(tpl.platform)}
            >
              <span className="catalog-icon">{tpl.icon}</span>
              <span className="catalog-name">{tpl.name}</span>
              <span className="catalog-desc">{tpl.description}</span>
            </button>
          ))}
        </div>

        {/* Config */}
        {template && (
          <div className="agent-config-section">
            <div className="form-group">
              <label className="form-label">Nom de l'agent</label>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={template.name}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Clé API {template.name}
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, marginLeft: 6 }}>
                  (optionnelle — mode simulation si vide)
                </span>
              </label>
              <input
                className="form-input api-key-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Clé API ${template.composioApp} via Composio…`}
              />
            </div>
          </div>
        )}

        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={!selected || saving}
          >
            {saving ? '⏳ Création…' : `${template?.icon ?? '🤖'} Ajouter l'agent`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Carte agent ───────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent:    Agent;
  catalog:  AgentTemplate[];
  onToggle: (agent: Agent) => void;
  onDelete: (id: string) => void;
}

function AgentCard({ agent, catalog, onToggle, onDelete }: AgentCardProps) {
  const tpl      = catalog.find((t) => t.platform === agent.platform);
  const icon     = tpl?.icon ?? '🤖';
  const isActive = agent.status === 'active';

  return (
    <div className={`agent-card${isActive ? ' agent-card--active' : ''}`}>
      <div className="agent-card-header">
        <span className="agent-platform-icon">{icon}</span>
        <div className="agent-card-title-group">
          <span className="agent-card-name">{agent.name}</span>
          <span className={`agent-status-badge agent-status-${agent.status}`}>
            {statusLabel(agent.status)}
          </span>
        </div>
        <div className="agent-card-actions">
          <button
            className={`agent-toggle-btn${isActive ? ' on' : ''}`}
            onClick={() => onToggle(agent)}
            title={isActive ? 'Désactiver' : 'Activer'}
          >
            {isActive ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="agent-card-meta">
        <span className="chip">{agent.platform}</span>
        {agent.apiKey
          ? <span className="chip chip-success">🔑 Clé API configurée</span>
          : <span className="chip chip-warning">⚠️ Mode simulation</span>
        }
      </div>

      {agent.lastRunAt && (
        <div className="agent-card-last-run">
          Dernier run : {new Date(agent.lastRunAt).toLocaleString('fr-FR')}
        </div>
      )}

      <div className="agent-card-footer">
        <Link to={`/agents/${agent.id}`} className="btn btn-ghost btn-sm">
          Voir détail →
        </Link>
        <button
          className="btn btn-ghost btn-sm btn-danger"
          onClick={() => onDelete(agent.id)}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents,   setAgents]   = useState<Agent[]>([]);
  const [catalog,  setCatalog]  = useState<AgentTemplate[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showAdd,  setShowAdd]  = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    (async () => {
      const [agRes, catRes] = await Promise.all([getAgents(), getCatalog()]);
      if (agRes.success  && agRes.data)  setAgents(agRes.data);
      if (catRes.success && catRes.data) setCatalog(catRes.data);
      setLoading(false);
    })();
  }, []);

  const handleAdded = (agent: Agent) => {
    setAgents((prev) => [agent, ...prev]);
    setShowAdd(false);
  };

  const handleToggle = async (agent: Agent) => {
    const newStatus = agent.status === 'active' ? 'inactive' : 'active';
    const res = await updateAgent(agent.id, { status: newStatus });
    if (res.success && res.data) {
      setAgents((prev) => prev.map((a) => a.id === agent.id ? res.data! : a));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet agent ? Cette action est irréversible.')) return;
    const res = await deleteAgent(id);
    if (res.success) {
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } else {
      setError('Erreur lors de la suppression');
    }
  };

  const active   = agents.filter((a) => a.status === 'active');
  const inactive = agents.filter((a) => a.status !== 'active');

  if (loading) return <div className="loading">⏳ Chargement des agents…</div>;

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🤖 Agents IA</h1>
          <p className="page-subtitle">
            Configurez vos agents pour automatiser vos actions marketing sur chaque plateforme.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          + Ajouter un agent
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Stats */}
      <div className="dashboard-stats" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-value">{agents.length}</div>
          <div className="stat-label">Agents configurés</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#4ade80' }}>{active.length}</div>
          <div className="stat-label">Agents actifs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--color-primary)' }}>
            {agents.filter((a) => a.apiKey).length}
          </div>
          <div className="stat-label">Avec clé API</div>
        </div>
      </div>

      {/* Liste vide */}
      {agents.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon animate-float">🤖</div>
          <h3 className="empty-state-title">Aucun agent configuré</h3>
          <p className="empty-state-desc">
            Ajoutez votre premier agent pour automatiser vos actions marketing sur Reddit, Twitter, LinkedIn et plus encore.
          </p>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Ajouter un agent
          </button>
        </div>
      )}

      {/* Agents actifs */}
      {active.length > 0 && (
        <section>
          <h2 className="agents-section-title">✅ Actifs</h2>
          <div className="agents-grid">
            {active.map((agent, i) => (
              <div key={agent.id} className={`animate-fadeInUp stagger-${Math.min(i + 1, 6)}`}>
                <AgentCard agent={agent} catalog={catalog} onToggle={handleToggle} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Agents inactifs / en erreur */}
      {inactive.length > 0 && (
        <section style={{ marginTop: active.length > 0 ? 40 : 0 }}>
          <h2 className="agents-section-title">💤 Inactifs</h2>
          <div className="agents-grid">
            {inactive.map((agent, i) => (
              <div key={agent.id} className={`animate-fadeInUp stagger-${Math.min(i + 1, 6)}`}>
                <AgentCard agent={agent} catalog={catalog} onToggle={handleToggle} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Catalogue — plateformes disponibles */}
      {catalog.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <h2 className="agents-section-title">🗂️ Plateformes disponibles</h2>
          <div className="catalog-overview-grid">
            {catalog.map((tpl) => {
              const configured = agents.some((a) => a.platform === tpl.platform);
              return (
                <div
                  key={tpl.platform}
                  className={`catalog-overview-card${configured ? ' configured' : ''}`}
                  onClick={() => !configured && setShowAdd(true)}
                >
                  <span className="catalog-icon">{tpl.icon}</span>
                  <span className="catalog-name">{tpl.name}</span>
                  {configured && <span className="catalog-configured-badge">✓ Configuré</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Modal */}
      {showAdd && (
        <AddAgentModal
          catalog={catalog}
          onClose={() => setShowAdd(false)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}
