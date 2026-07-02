import { useState, useEffect, useCallback } from 'react';
import Loader from '../components/Loader';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, PenLine, CheckCircle2, ClipboardCheck, Rocket, Download, TrendingUp } from 'lucide-react';
import { getOverview, getPlan, getContacts, invalidateOverview, Overview, LaunchPlan } from '../api/client';
import ImportHistoryModal from '../components/ImportHistoryModal';

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
  const [showImport, setShowImport] = useState(false);
  const [wonRevenue, setWonRevenue] = useState(0);
  const navigate = useNavigate();

  const load = useCallback(async (refresh = false) => {
    // L'overview (léger, souvent déjà en cache via la sidebar) donne le
    // projet actif ; son plan complet est chargé dans la foulée.
    if (refresh) invalidateOverview();
    const res = await getOverview();
    if (res.success && res.data) {
      setOverview(res.data);
      if (res.data.project) {
        const planRes = await getPlan(res.data.project.id);
        if (planRes.success && planRes.data) setPlan(planRes.data);
        // CA gagné = somme des deals « gagnés » du pipeline CRM
        const contactsRes = await getContacts();
        if (contactsRes.success && contactsRes.data) {
          setWonRevenue(contactsRes.data.filter((c) => c.stage === 'won').reduce((s, c) => s + (c.amount ?? 0), 0));
        }
      }
    } else {
      setError(res.error || 'Impossible de charger votre projet');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loader text="Chargement de votre projet…" />;

  const project = overview?.project ?? null;

  if (!project) {
    return (
      <div className="animate-fadeIn">
        <div className="plan-empty">
          <span className="plan-empty-icon"><Rocket size={40} /></span>
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
  // Mode « croissance / vente » vs « lancement » — pilote les libellés du plan
  // affiché (l'objectif primaire prime ; sinon on déduit du stade commercial).
  const growthMode =
    input?.primaryObjective === 'grow-revenue' ||
    input?.primaryObjective === 'both' ||
    (!input?.primaryObjective &&
      (input?.traction === 'first-customers' || input?.traction === 'early-revenue' || input?.traction === 'scaling'));

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
            {/* Modifier le projet → base de connaissances : simple texte orange, à la suite du résumé */}
            <span className="plan-meta-dot" />
            <Link to="/knowledge" className="dashboard-edit-link" title="Modifier les informations du projet (entreprise, offres, ton, audience…)">
              Modifier
            </Link>
          </div>
        </div>
        <div className="dashboard-header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowImport(true)}
            data-tour="dashboard-import"
            title="Rapatrier vos posts déjà publiés sur vos réseaux connectés"
          >
            <Download size={15} /> Importer mes anciens posts
          </button>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', paddingTop: 4 }}>
            Créé le {new Date(project.createdAt).toLocaleDateString('fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showImport && (
        <ImportHistoryModal
          onClose={() => setShowImport(false)}
          onDone={(imported) => { if (imported > 0) void load(true); }}
        />
      )}

      {/* Validations en attente — action prioritaire */}
      {approvals > 0 && (
        <Link to="/approvals" className="approval-banner animate-fadeInUp">
          <span className="approval-banner-icon"><ClipboardCheck size={20} /></span>
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
          <span className="stat-card-icon"><CalendarClock size={20} /></span>
          <div className="stat-card-value">{posts.scheduled}</div>
          <div className="stat-card-label">Posts programmés</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-2 stat-card-clickable"
          onClick={() => navigate('/content')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/content')}
        >
          <span className="stat-card-icon"><PenLine size={20} /></span>
          <div className="stat-card-value">{posts.drafts}</div>
          <div className="stat-card-label">Brouillons & idées</div>
        </div>
        <div className="stat-card animate-fadeInUp stagger-3">
          <span className="stat-card-icon"><CheckCircle2 size={20} /></span>
          <div className="stat-card-value">{posts.published}</div>
          <div className="stat-card-label">Posts publiés</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-4 stat-card-clickable"
          onClick={() => navigate('/approvals')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/approvals')}
        >
          <span className="stat-card-icon"><ClipboardCheck size={20} /></span>
          <div className="stat-card-value" style={approvals > 0 ? { color: '#f59e0b' } : undefined}>{approvals}</div>
          <div className="stat-card-label">À valider</div>
        </div>
        <div
          className="stat-card animate-fadeInUp stagger-5 stat-card-clickable"
          onClick={() => navigate('/crm')}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/crm')}
        >
          <span className="stat-card-icon"><TrendingUp size={20} /></span>
          <div className="stat-card-value" style={wonRevenue > 0 ? { color: '#34d399' } : undefined}>{Math.round(wonRevenue).toLocaleString('fr-FR')} €</div>
          <div className="stat-card-label">CA gagné</div>
        </div>
      </div>

      {/* Prochaine publication + Objectifs côte à côte ; la description passe
          sous la prochaine publication (colonne de gauche). */}
      <div className="dashboard-overview-grid">
        <div className="dashboard-overview-col">
          {/* Prochain post */}
          <div className="card animate-fadeInUp stagger-2">
            <div className="card-header">Prochaine publication</div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              {posts.next
                ? <>« {posts.next.title || posts.next.platform} » sur <strong style={{ color: 'var(--color-text)' }}>{posts.next.platform}</strong> le {new Date(posts.next.scheduledAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
                : <>Aucun post programmé — <Link to="/content">générez un calendrier éditorial</Link> dans le Hub de contenu.</>}
            </p>
          </div>

          {/* Description — sous la prochaine publication */}
          {input?.description && (
            <div className="card animate-fadeInUp stagger-4">
              <div className="card-header">Description</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
                {input.description}
              </p>
            </div>
          )}
        </div>

        {/* Objectifs — à droite de la prochaine publication */}
        {input && input.goals?.length > 0 && (
          <div className="plan-section card animate-fadeInUp stagger-3">
            <div className="card-header">Objectifs</div>
            {input.revenueGoal && (
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>
                🎯 {input.revenueGoal}
              </div>
            )}
            <ul className="weekly-actions-list">
              {input.goals.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* ── Phases du plan (pleine largeur, sous la vue d'ensemble) ── */}
      {input && (plan?.launch_sequencing || []).length > 0 && (
        <div className="card animate-fadeInUp stagger-5">
          <div className="card-header">{growthMode ? 'Phases de croissance' : 'Phases de lancement'}</div>
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

      {/* ── Stratégie d'acquisition & de vente : déjà générée par l'IA, on la
          surface ici car c'est le cœur du « décrocher des ventes ». ── */}
      {input && (plan?.outreach_strategy || []).length > 0 && (
        <div className="card animate-fadeInUp stagger-5">
          <div className="card-header">{growthMode ? "Stratégie d'acquisition & de vente" : "Stratégie d'approche"}</div>
          {plan!.outreach_strategy.map((os, i) => (
            <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < plan!.outreach_strategy.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.9rem' }}>{os.phase}</strong>
                {os.target && <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>cible : {os.target}</span>}
              </div>
              <ul className="weekly-actions-list">
                {(os.tactics || []).slice(0, 4).map((t, j) => <li key={j}>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
