import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, LaunchPlan } from '../api/client';

export default function DashboardPage() {
  const [plans, setPlans] = useState<LaunchPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  if (loading) return <div className="loading">Loading your plans...</div>;

  return (
    <div>
      <div className="dashboard-header">
        <h1>Your Launch Plans</h1>
        <Link to="/new" className="btn btn-primary">
          + New Plan
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {plans.length === 0 ? (
        <div className="plan-empty">
          <h2>No launch plans yet</h2>
          <p>Create your first tactical launch plan to get started.</p>
          <Link to="/new" className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex' }}>
            Create Your First Plan
          </Link>
        </div>
      ) : (
        <div className="plan-list">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="plan-item"
              onClick={() => navigate(`/plan/${plan.id}`)}
            >
              <h3>{plan.input.productName}</h3>
              <div className="meta">
                {plan.input.niche} &middot; {new Date(plan.createdAt).toLocaleDateString()} &middot;{' '}
                {plan.input.goals.length} goal{plan.input.goals.length !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
