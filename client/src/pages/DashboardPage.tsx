import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getOverview, getPlan, Overview, LaunchPlan } from '../api/client';

/**
 * Tableau de bord = vue d'ensemble du projet courant, directement.
 * Pas d'onglets ni de page intermédiaire : l'essentiel du projet actif
 * (chiffres, objectifs, description, phases de lancement) sur une page.
 */
export default function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plan,     setPlan]     = useState<LaunchPlan | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // L'overview (léger, souvent déjà en cache via la sidebar) donne le
      // projet actif ; son plan complet est chargé dans la foulée.
      const res = await getOverview();
      if (res.success && res.data) {
        setOverview(res.data);
        if (res.data.project) {
          const planRes = await getPlan(res.data.project.id);
          if (planRes.success && planRes.data) setPlan(planRes.data);
        }
      } else {
        setError(res.error || 'Impossible de charger votre projet');
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="loading">⏳ Chargement de votre projet…</div>;

  const project = overview?.project ?? null;

  if (!project) {
    return (
      <div className="animate-fadeIn">
        <div className="plan-empty">
                    <h2>Aucun projet</h2>
          <p>L'assistant IA vous pose quelques questions, recherche votre entreprise, et génère votre plan d'action.</p>
          <Link
            to="/new"
            className="btn btn-primary btn-primary-glow btn-lg"
            style={{ display: 'inline-flex' }}
          >
            Créer mon premier projet
          </Link>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  const { posts, approvals } = overview!;
  const input = plan?.input;

  return (
    <div className="animate-fadeIn">
      {/* En-tête : le projet courant */}
      <div className="dashboard-header">
        <div>
          <h1>{project.productName}</h1>
          <div className="plan-meta">
            <span className="niche-badge">{project.niche}</span>
            <span className="plan-meta-dot" />
            <span>{project.targetAudience}</span>
            {input?.pricing && (
              <>
                <span className="plan-meta-dot" />
                <span>{input.pricing}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', paddingTop: 4 }}>
          Créé le {new Date(project.createdAt).toLocaleDateString('fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Validations en attente — action prioritaire */}
      {approvals > 0 && (
        <Link to="/approvals" className="approval-banner animate-fadeInUp">
                    <span>
            <strong>{approvals} contenu{approvals > 1 ? 's' : ''}</strong> proposé{approvals > 1 ? 's' : ''} par
            l'IA attend{approvals > 1 ? 'ent' : ''} votre validation
          </span>
          <span className="approval-banner-cta">Valider →</span>
        </Link>
      )}

      {/* Chiffres du projet */}
      <div className="dashboard-stats">
        <div
          className="stat-card animate-fadeInUp stagger-1 stat-card-clickable"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <div className="stat-card-value">{posts.scheduled}</div>
          <div className="stat-card-label">Posts programmés</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-2 stat-card-clickable"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <div className="stat-card-value">{posts.drafts}</div>
          <div className="stat-card-label">Brouillons & idées</div>
        </div>
        <div className="stat-card animate-fadeInUp stagger-3">
          <div className="stat-card-value">{posts.published}</div>
          <div className="stat-card-label">Posts publiés</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-4 stat-card-clickable"
          onClick={() => navigate('/approvals')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/approvals')}
        >
          <div className="stat-card-value" style={approvals > 0 ? { color: '#f59e0b' } : undefined}>{approvals}</div>
          <div className="stat-card-label">À valider</div>
        </div>
      </div>

      {/* Prochain post */}
      <div className="card animate-fadeInUp stagger-2" style={{ marginBottom: 20 }}>
        <div className="card-header">Prochaine publication</div>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          {posts.next
            ? <>« {posts.next.title || posts.next.platform} » sur <strong style={{ color: 'var(--color-text)' }}>{posts.next.platform}</strong> le {new Date(posts.next.scheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
            : <>Aucun post programmé — <Link to="/content">générez un calendrier éditorial</Link> dans le Hub de contenu.</>}
        </p>
      </div>

      {/* ── Vue d'ensemble du projet ── */}
      {input && (
        <>
          {/* Objectifs */}
          {input.goals?.length > 0 && (
            <div className="plan-section card animate-fadeInUp stagger-3">
              <div className="card-header">Objectifs</div>
              <ul className="weekly-actions-list">
                {input.goals.map((g, i) => <li key={i}>{g}</li>)}
              </ul>
            </div>
          )}

          {/* Description */}
          {input.description && (
            <div className="card animate-fadeInUp stagger-4">
              <div className="card-header">Description</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                {input.description}
              </p>
            </div>
          )}

          {/* Phases de lancement */}
          {(plan?.launch_sequencing || []).length > 0 && (
            <div className="card animate-fadeInUp stagger-5">
              <div className="card-header">Phases de lancement</div>
              {plan!.launch_sequencing.map((ls, i) => (
                <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < plan!.launch_sequencing.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <div className="weekly-week-num" style={{ width: 28, height: 28, fontSize: '0.72rem' }}>{i + 1}</div>
                    <strong style={{ fontSize: '0.9rem' }}>{ls.phase}</strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{ls.timeline}</span>
                  </div>
                  <ul className="weekly-actions-list">
                    {(ls.activities || []).slice(0, 3).map((a, j) => <li key={j}>{a}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
