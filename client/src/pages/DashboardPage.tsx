import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, getApprovals, getPosts, LaunchPlan, Post } from '../api/client';

interface PlanTaskStats {
  total: number;
  done: number;
  inProgress: number;
  progress: number;
}

function getTaskStats(plan: LaunchPlan | undefined): PlanTaskStats {
  const cols = (plan?.kanbanState as any)?.columns as Record<string, any[]> | undefined;
  if (!cols) return { total: 0, done: 0, inProgress: 0, progress: 0 };
  const total      = Object.values(cols).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
  const done       = (cols.done ?? []).length;
  const inProgress = (cols.in_progress ?? []).length;
  return {
    total,
    done,
    inProgress,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

const nicheEmojis: Record<string, string> = {
  saas: '☁️', ai: '🤖', devtool: '🛠️', nocode: '🧩',
  marketplace: '🏪', fintech: '💳', health: '🏥',
  education: '🎓', ecommerce: '🛒', content: '✍️',
  'local-business': '🏠', services: '🧰', other: '🚀',
};

export default function DashboardPage() {
  const [plans,     setPlans]     = useState<LaunchPlan[]>([]);
  const [posts,     setPosts]     = useState<Post[]>([]);
  const [approvals, setApprovals] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // Tout est scopé au projet actif côté serveur (validations, posts)
      const [plansRes, approvalsRes, postsRes] = await Promise.all([
        getPlans(), getApprovals(), getPosts(),
      ]);
      if (plansRes.success && plansRes.data) {
        setPlans(plansRes.data);
      } else {
        setError(plansRes.error || 'Impossible de charger vos projets');
      }
      if (approvalsRes.success && approvalsRes.data) setApprovals(approvalsRes.data.length);
      if (postsRes.success && postsRes.data) setPosts(postsRes.data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="loading">⏳ Chargement de votre projet…</div>;

  // Le tableau de bord est celui du PROJET ACTIF (changer de projet : sidebar)
  const project = plans.find((p) => Boolean(p.active)) ?? plans[0];
  const stats   = getTaskStats(project);
  const emoji   = project ? (nicheEmojis[project.input.niche] ?? '🚀') : '🚀';

  const scheduledPosts = posts.filter((p) => p.status === 'scheduled').length;
  const publishedPosts = posts.filter((p) => p.status === 'published').length;
  const draftPosts     = posts.filter((p) => p.status === 'draft' || p.status === 'idea').length;
  const nextPost = posts
    .filter((p) => p.status === 'scheduled' && p.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];

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

  return (
    <div className="animate-fadeIn">
      {/* En-tête : le projet actif */}
      <div className="dashboard-header">
        <div>
          <h1>{emoji} {project.input.productName}</h1>
          <p>
            {project.input.targetAudience}
            {project.input.company?.name ? ` · ${project.input.company.name}` : ''}
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
          <div className="stat-card-value">{stats.inProgress}</div>
          <div className="stat-card-label">Tâches en cours</div>
        </div>
        <div className="stat-card animate-fadeInUp stagger-2">
          <span className="stat-card-icon">✅</span>
          <div className="stat-card-value">{stats.done}<span className="stat-card-sub">/{stats.total}</span></div>
          <div className="stat-card-label">Tâches terminées</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-3 stat-card-clickable"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <span className="stat-card-icon">🗓️</span>
          <div className="stat-card-value">{scheduledPosts}</div>
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
            <span className="niche-badge">{project.input.niche}</span>
            <span className="plan-card-date">
              créé le {new Date(project.createdAt).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </span>
          </div>
          <div className="plan-progress-bar">
            <div className="plan-progress-fill" style={{ width: `${stats.progress}%` }} />
          </div>
          <div className="plan-progress-label">
            {stats.total > 0
              ? `${stats.done}/${stats.total} tâches · ${stats.progress} %`
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
            {draftPosts > 0 && `${draftPosts} brouillon${draftPosts > 1 ? 's' : ''} à valider · `}
            {publishedPosts} publié{publishedPosts > 1 ? 's' : ''}
          </p>
          <div className="plan-progress-label">
            {nextPost
              ? `Prochain post : « ${nextPost.title || nextPost.platform} » le ${new Date(nextPost.scheduledAt!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
              : 'Aucun post programmé — générez un calendrier éditorial'}
          </div>
        </div>
      </div>
    </div>
  );
}
