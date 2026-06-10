import { useState, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { User, setToken, getOverview, activatePlan, ProjectSummary } from '../api/client';

const nicheEmojis: Record<string, string> = {
  saas: '☁️', ai: '🤖', devtool: '🛠️', nocode: '🧩',
  marketplace: '🏪', fintech: '💳', health: '🏥',
  education: '🎓', ecommerce: '🛒', content: '✍️',
  'local-business': '🏠', services: '🧰', other: '🚀',
};

interface Props {
  user: User;
  onLogout: () => void;
}

const navItems = [
  { to: '/',          icon: '📊', label: 'Tableau de bord' },
  { to: '/content',   icon: '📣', label: 'Hub de contenu'  },
  { to: '/knowledge', icon: '📚', label: 'Connaissances'   },
  { to: '/approvals', icon: '✋', label: 'Validations'     },
  { to: '/config',    icon: '⚙️', label: 'Configuration'   },
];

export default function Layout({ user, onLogout }: Props) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);

  // UNE requête légère pour tout le shell (projets + badge validations),
  // partagée avec le tableau de bord via le cache du client API.
  const loadOverview = useCallback(() => {
    getOverview().then((res) => {
      if (res.success && res.data) {
        setProjects(res.data.projects);
        setPendingApprovals(res.data.approvals);
      }
    });
  }, []);

  // Rafraîchie à chaque navigation (servie par le cache si < 5 s) + toutes les 30 s
  useEffect(() => {
    loadOverview();
    const timer = setInterval(loadOverview, 30000);
    return () => clearInterval(timer);
  }, [loadOverview, location.pathname]);

  const activeProject = projects.find((p) => p.active) ?? projects[0];

  const handleSelectProject = async (plan: ProjectSummary) => {
    setPickerOpen(false);
    closeSidebar();
    if (plan.active) {
      // Projet déjà actif : on ouvre simplement son plan détaillé
      navigate(`/plan/${plan.id}`);
      return;
    }
    setSwitching(plan.id);
    await activatePlan(plan.id);
    // Changement de contexte : TOUTES les vues (dashboard, hub, connaissances,
    // validations, configuration) sont propres au projet — rechargement complet
    // pour repartir sur des données fraîches.
    window.location.href = '/';
  };

  const handleLogout = () => {
    setToken(null);
    onLogout();
    setSidebarOpen(false);
  };

  const closeSidebar = () => setSidebarOpen(false);

  // Avatar: first letter of name or email
  const avatarLetter = (user.name || user.email).charAt(0).toUpperCase();
  // Short display name: part before @
  const displayName  = user.name || user.email.split('@')[0];

  return (
    <div className="layout-root">
      {/* ── Mobile hamburger ── */}
      <button
        className="layout-hamburger"
        onClick={() => setSidebarOpen((o) => !o)}
        aria-label="Toggle navigation"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* ── Overlay (mobile) ── */}
      <div
        className={`layout-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={closeSidebar}
      />

      {/* ── Sidebar ── */}
      <aside className={`layout-sidebar${sidebarOpen ? ' open' : ''}`}>
        {/* Logo */}
        <Link to="/" className="layout-sidebar-logo" onClick={closeSidebar}>
          <span className="layout-sidebar-logo-icon">🚀</span>
          LaunchForge
        </Link>

        {/* Nav items */}
        <nav className="layout-nav" aria-label="Main navigation">
          <span className="layout-nav-section">Menu</span>

          {navItems.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);

            return (
              <Link
                key={item.to}
                to={item.to}
                className={`layout-nav-item${isActive ? ' active' : ''}`}
                onClick={closeSidebar}
              >
                <span className="layout-nav-icon">{item.icon}</span>
                {item.label}
                {item.to === '/approvals' && pendingApprovals > 0 && (
                  <span className="layout-nav-badge">{pendingApprovals}</span>
                )}
              </Link>
            );
          })}

          <span className="layout-nav-section" style={{ marginTop: 18 }}>Projet</span>

          {/* Sélecteur de projet : un seul bouton, le projet actif. Cliquer
              ouvre la liste pour changer de projet ou en créer un nouveau. */}
          {activeProject ? (
            <div className="layout-project-picker">
              <button
                className={`layout-nav-item layout-project${pickerOpen ? ' active' : ''}`}
                onClick={() => setPickerOpen((o) => !o)}
                title="Projet de travail courant — cliquer pour changer de projet"
              >
                <span className="layout-nav-icon">{nicheEmojis[activeProject.niche] ?? '🚀'}</span>
                <span className="layout-project-name">{activeProject.productName}</span>
                <span className="layout-project-dot" title="Projet actif" />
                <span className="layout-project-chevron">{pickerOpen ? '▴' : '▾'}</span>
              </button>

              {pickerOpen && (
                <div className="layout-project-menu">
                  {projects.map((plan) => (
                    <button
                      key={plan.id}
                      className={`layout-nav-item layout-project${plan.active ? ' active' : ''}`}
                      onClick={() => handleSelectProject(plan)}
                      title={plan.active ? 'Projet actif — voir le plan' : 'Basculer sur ce projet'}
                    >
                      <span className="layout-nav-icon">{nicheEmojis[plan.niche] ?? '🚀'}</span>
                      <span className="layout-project-name">{plan.productName}</span>
                      {switching === plan.id
                        ? <span className="layout-project-dot loading">⏳</span>
                        : Boolean(plan.active) && <span className="layout-project-dot" title="Projet actif" />}
                    </button>
                  ))}
                  <Link to="/new" className="layout-nav-item layout-project-new" onClick={() => { setPickerOpen(false); closeSidebar(); }}>
                    <span className="layout-nav-icon">＋</span>
                    Nouveau projet
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <Link to="/new" className="layout-nav-item layout-project-new" onClick={closeSidebar}>
              <span className="layout-nav-icon">＋</span>
              Nouveau projet
            </Link>
          )}
        </nav>

        {/* Footer: user info + logout */}
        <div className="layout-sidebar-footer">
          <div className="layout-user-card">
            <div className="layout-user-avatar">{avatarLetter}</div>
            <div className="layout-user-info">
              <div className="layout-user-name">{displayName}</div>
              <div className="layout-user-role">Founder</div>
            </div>
          </div>

          <button
            className="layout-nav-item"
            onClick={handleLogout}
          >
            <span className="layout-nav-icon">🚪</span>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="layout-main">
        <Outlet />
      </main>

    </div>
  );
}
