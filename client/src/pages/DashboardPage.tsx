import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getOverview, Overview } from '../api/client';

const nicheEmojis: Record<string, string> = {
  saas: '☁️', ai: '🤖', devtool: '🛠️', nocode: '🧩',
  marketplace: '🏪', fintech: '💳', health: '🏥',
  education: '🎓', ecommerce: '🛒', content: '✍️',
  'local-business': '🏠', services: '🧰', other: '🚀',
};

export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // UNE requête : tout le contexte du projet actif (souvent déjà en cache
    // car la sidebar vient de la faire — réponse instantanée).
    getOverview().then((res) => {
      if (res.success && res.data) setOverview(res.data);
      else setError(res.error || 'Impossible de charger votre projet');
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">⏳ Chargement de votre projet…</div>;

  const project = overview?.project ?? null;

  if (!project) {
    return (
      <div className="animate-fadeIn">
        <div className="plan-empty">
          <span className="plan-empty-icon">🚀</span>
          <h2>Aucun projet</h2>
          <p>L'assistant IA vous pose quelques questions, recherche votre entreprise, et génère votre plan d'action.</p>
          <Link
            to="/new"
            className="btn btn-primary btn-primary-glow btn-lg"
            style={{ display: 'inline-flex' }}
          >
            ✨ Créer mon premier projet
          </Link>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  const { tasks, posts, approvals } = overview!;
  const emoji = nicheEmojis[project.niche] ?? '🚀';

  return (
    <div className="animate-fadeIn">
      {/* En-tête : le projet actif */}
      <div className="dashboard-header">
        <div>
          <h1>{emoji} {project.productName}</h1>
          <p>
            {project.targetAudience}
            {project.companyName ? ` · ${project.companyName}` : ''}
          </p>
        </div>
        <Link to={`/plan/${project.id}`} className="btn btn-primary">📋 Plan & Kanban</Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Validations en attente — action prioritaire */}
      {approvals > 0 && (
        <Link to="/approvals" className="approval-banner animate-fadeInUp">
          <span className="approval-banner-icon">✋</span>
          <span>
            <strong>{approvals} contenu{approvals > 1 ? 's' : ''}</strong> proposé{approvals > 1 ? 's' : ''} par
            l'IA attend{approvals > 1 ? 'ent' : ''} votre validation
          </span>
          <span className="approval-banner-cta">Valider →</span>
        </Link>
      )}

      {/* Statistiques du projet */}
      <div className="dashboard-stats">
        <div
          className="stat-card animate-fadeInUp stagger-1 stat-card-clickable"
          onClick={() => navigate(`/plan/${project.id}`)}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate(`/plan/${project.id}`)}
        >
          <span className="stat-card-icon">⚡</span>
          <div className="stat-card-value">{tasks.inProgress}</div>
          <div className="stat-card-label">Tâches en cours</div>
        </div>
        <div className="stat-card animate-fadeInUp stagger-2">
          <span className="stat-card-icon">✅</span>
          <div className="stat-card-value">{tasks.done}<span className="stat-card-sub">/{tasks.total}</span></div>
          <div className="stat-card-label">Tâches terminées</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-3 stat-card-clickable"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <span className="stat-card-icon">🗓️</span>
          <div className="stat-card-value">{posts.scheduled}</div>
          <div className="stat-card-label">Posts programmés</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-4 stat-card-clickable"
          onClick={() => navigate('/approvals')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/approvals')}
        >
          <span className="stat-card-icon">✋</span>
          <div className="stat-card-value" style={approvals > 0 ? { color: '#f59e0b' } : undefined}>{approvals}</div>
          <div className="stat-card-label">À valider</div>
        </div>
      </div>

      {/* Avancement du plan + raccourcis */}
      <div className="plan-grid">
        <div
          className="plan-card animate-fadeInUp stagger-2"
          onClick={() => navigate(`/plan/${project.id}`)}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate(`/plan/${project.id}`)}
        >
          <div className="plan-card-header">
            <h3 className="plan-card-title">📋 Plan de lancement</h3>
            <span className="chip chip-project">🎯 Projet actif</span>
          </div>
          <div className="plan-card-meta">
            <span className="niche-badge">{project.niche}</span>
            <span className="plan-card-date">
              créé le {new Date(project.createdAt).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </span>
          </div>
          <div className="plan-progress-bar">
            <div className="plan-progress-fill" style={{ width: `${tasks.progress}%` }} />
          </div>
          <div className="plan-progress-label">
            {tasks.total > 0
              ? `${tasks.done}/${tasks.total} tâches · ${tasks.progress} %`
              : 'Kanban non initialisé — ouvrez le plan pour démarrer'}
          </div>
        </div>

        <div
          className="plan-card animate-fadeInUp stagger-3"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <div className="plan-card-header">
            <h3 className="plan-card-title">📣 Hub de contenu</h3>
          </div>
          <p className="plan-card-audience">
            {posts.drafts > 0 && `${posts.drafts} brouillon${posts.drafts > 1 ? 's' : ''} à valider · `}
            {posts.published} publié{posts.published > 1 ? 's' : ''}
          </p>
          <div className="plan-progress-label">
            {posts.next
              ? `Prochain post : « ${posts.next.title || posts.next.platform} » le ${new Date(posts.next.scheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : 'Aucun post programmé — générez un calendrier éditorial'}
          </div>
        </div>
      </div>
    </div>
  );
}
