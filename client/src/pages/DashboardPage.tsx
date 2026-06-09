import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, getApprovals, LaunchPlan } from '../api/client';

interface PlanTaskStats {
  total: number;
  done: number;
  inProgress: number;
  progress: number;
}

function getTaskStats(plan: LaunchPlan): PlanTaskStats {
  const cols = (plan.kanbanState as any)?.columns as Record<string, any[]> | undefined;
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
  const [approvals, setApprovals] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const [plansRes, approvalsRes] = await Promise.all([getPlans(), getApprovals()]);
      if (plansRes.success && plansRes.data) {
        setPlans(plansRes.data);
      } else {
        setError(plansRes.error || 'Impossible de charger vos plans');
      }
      if (approvalsRes.success && approvalsRes.data) {
        setApprovals(approvalsRes.data.length);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="loading">⏳ Chargement de vos plans…</div>;

  const allStats   = plans.map(getTaskStats);
  const totalTasks = allStats.reduce((s, t) => s + t.total, 0);
  const doneTasks  = allStats.reduce((s, t) => s + t.done, 0);
  const activeTasks = allStats.reduce((s, t) => s + t.inProgress, 0);

  return (
    <div className="animate-fadeIn">
      {/* En-tête */}
      <div className="dashboard-header">
        <div>
          <h1>Tableau de bord</h1>
          <p>
            {plans.length === 0
              ? 'Aucun plan pour l\'instant — créez le premier !'
              : `${plans.length} plan${plans.length > 1 ? 's' : ''} de promotion · ${doneTasks}/${totalTasks} tâches terminées`}
          </p>
        </div>
        <Link to="/new" className="btn btn-primary">✨ Nouveau plan</Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Validations en attente — action prioritaire */}
      {approvals > 0 && (
        <Link to="/approvals" className="approval-banner animate-fadeInUp">
          <span className="approval-banner-icon">✋</span>
          <span>
            <strong>{approvals} contenu{approvals > 1 ? 's' : ''}</strong> proposé{approvals > 1 ? 's' : ''} par
            vos agents IA attend{approvals > 1 ? 'ent' : ''} votre validation
          </span>
          <span className="approval-banner-cta">Valider →</span>
        </Link>
      )}

      {/* Statistiques */}
      {plans.length > 0 && (
        <div className="dashboard-stats">
          <div className="stat-card animate-fadeInUp stagger-1">
            <span className="stat-card-icon">📋</span>
            <div className="stat-card-value">{plans.length}</div>
            <div className="stat-card-label">Plans</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-2">
            <span className="stat-card-icon">⚡</span>
            <div className="stat-card-value">{activeTasks}</div>
            <div className="stat-card-label">Tâches en cours</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-3">
            <span className="stat-card-icon">✅</span>
            <div className="stat-card-value">{doneTasks}<span className="stat-card-sub">/{totalTasks}</span></div>
            <div className="stat-card-label">Tâches terminées</div>
          </div>
          <div
            className="stat-card animate-fadeInUp stagger-4 stat-card-clickable"
            onClick={() => navigate('/approvals')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/approvals')}
          >
            <span className="stat-card-icon">✋</span>
            <div className="stat-card-value" style={approvals > 0 ? { color: '#f59e0b' } : undefined}>{approvals}</div>
            <div className="stat-card-label">À valider</div>
          </div>
        </div>
      )}

      {/* Grille de plans ou état vide */}
      {plans.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">🚀</span>
          <h2>Aucun plan de promotion</h2>
          <p>L'assistant IA vous pose quelques questions, recherche votre entreprise, et génère votre plan d'action.</p>
          <Link
            to="/new"
            className="btn btn-primary btn-primary-glow btn-lg"
            style={{ display: 'inline-flex' }}
          >
            ✨ Créer mon premier plan
          </Link>
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((plan, i) => {
            const stats      = getTaskStats(plan);
            const emoji      = nicheEmojis[plan.input.niche] ?? '🚀';
            const staggerCls = `stagger-${Math.min(i + 1, 6)}`;

            return (
              <div
                key={plan.id}
                className={`plan-card animate-fadeInUp ${staggerCls}`}
                onClick={() => navigate(`/plan/${plan.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/plan/${plan.id}`)}
              >
                <div className="plan-card-header">
                  <h3 className="plan-card-title">
                    {emoji} {plan.input.productName}
                  </h3>
                </div>

                <div className="plan-card-meta">
                  <span className="niche-badge">{plan.input.niche}</span>
                  {plan.input.company?.name && (
                    <span className="chip">{plan.input.company.name}</span>
                  )}
                  <span className="plan-card-date">
                    {new Date(plan.createdAt).toLocaleDateString('fr-FR', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                </div>

                <p className="plan-card-audience">{plan.input.targetAudience}</p>

                <div className="plan-progress-bar">
                  <div className="plan-progress-fill" style={{ width: `${stats.progress}%` }} />
                </div>
                <div className="plan-progress-label">
                  {stats.total > 0
                    ? `${stats.done}/${stats.total} tâches · ${stats.progress} %`
                    : 'Kanban non initialisé'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
