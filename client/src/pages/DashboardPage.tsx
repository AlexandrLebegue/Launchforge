import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, LaunchPlan } from '../api/client';

function getPlanProgress(plan: LaunchPlan): number {
  const state = plan.kanbanState as any;
  if (!state?.columns) return 0;
  const cols = state.columns as Record<string, any[]>;
  const total = Object.values(cols).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
  if (total === 0) return 0;
  const done = (cols.done ?? []).length;
  return Math.round((done / total) * 100);
}

const nicheEmojis: Record<string, string> = {
  saas: '☁️', ai: '🤖', devtool: '🛠️', nocode: '🧩',
  marketplace: '🏪', fintech: '💳', health: '🏥',
  education: '🎓', ecommerce: '🛒', content: '✍️',
};

export default function DashboardPage() {
  const [plans,   setPlans]   = useState<LaunchPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const res = await getPlans();
      if (res.success && res.data) {
        setPlans(res.data);
      } else {
        setError(res.error || 'Failed to load plans');
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="loading">⏳ Loading your plans…</div>;

  // Compute stats
  const total      = plans.length;
  const inProgress = plans.filter((p) => {
    const state = (p as any).kanbanState;
    return (state?.columns?.in_progress?.length ?? 0) > 0;
  }).length;
  const completed  = plans.filter((p) => getPlanProgress(p) >= 80).length;

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="dashboard-header">
        <div>
          <h1>Your Launch Plans</h1>
          <p>
            {total === 0
              ? 'No plans yet — create your first one!'
              : `${total} plan${total !== 1 ? 's' : ''} ready to execute`}
          </p>
        </div>
        <Link to="/new" className="btn btn-primary">
          ✨ New Plan
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Stats bar */}
      {total > 0 && (
        <div className="dashboard-stats">
          <div className="stat-card animate-fadeInUp stagger-1">
            <span className="stat-card-icon">📋</span>
            <div className="stat-card-value">{total}</div>
            <div className="stat-card-label">Total Plans</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-2">
            <span className="stat-card-icon">⚡</span>
            <div className="stat-card-value">{inProgress}</div>
            <div className="stat-card-label">In Progress</div>
          </div>
          <div className="stat-card animate-fadeInUp stagger-3">
            <span className="stat-card-icon">✅</span>
            <div className="stat-card-value">{completed}</div>
            <div className="stat-card-label">Completed</div>
          </div>
        </div>
      )}

      {/* Plans grid or empty state */}
      {plans.length === 0 ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">🚀</span>
          <h2>No launch plans yet</h2>
          <p>Create your first tactical launch plan to get started.</p>
          <Link
            to="/new"
            className="btn btn-primary btn-primary-glow btn-lg"
            style={{ display: 'inline-flex' }}
          >
            ✨ Create Your First Plan
          </Link>
        </div>
      ) : (
        <div className="plan-grid">
          {plans.map((plan, i) => {
            const progress   = getPlanProgress(plan);
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
                  <span className="plan-card-date">
                    {new Date(plan.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </span>
                </div>

                <p className="plan-card-audience">{plan.input.targetAudience}</p>

                <div className="plan-progress-bar">
                  <div
                    className="plan-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="plan-progress-label">{progress}% complete</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
