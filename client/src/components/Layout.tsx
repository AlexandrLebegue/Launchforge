import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { User, setToken, getApprovals, getTelegramLinkCode } from '../api/client';

function TelegramModal({ onClose }: { onClose: () => void }) {
  const [code,   setCode]   = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    getTelegramLinkCode().then((res) => {
      if (res.success && res.data) {
        setCode(res.data.code);
        setLinked(res.data.linked);
      } else {
        setError(res.error === 'TELEGRAM_NOT_CONFIGURED'
          ? 'Bot non configuré côté serveur : créez un bot via @BotFather sur Telegram et renseignez TELEGRAM_BOT_TOKEN dans le .env.'
          : res.error || 'Erreur');
      }
    });
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>💬 Bot Telegram</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {error ? (
          <div className="chat-error">{error}</div>
        ) : code === null ? (
          <div className="loading">⏳…</div>
        ) : (
          <div className="post-editor">
            {linked && (
              <div className="approval-feedback" style={{ marginBottom: 0 }}>
                ✅ Un chat Telegram est déjà lié à votre compte. Ce code permet d'en lier un autre.
              </div>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Pilotez LaunchForge depuis Telegram : état des activités, posts à venir,
              validations, lancement d'agents, rédaction de posts/emails, rappels.
            </p>
            <ol style={{ fontSize: '0.85rem', paddingLeft: 20, lineHeight: 2 }}>
              <li>Ouvrez votre bot dans Telegram</li>
              <li>Envoyez-lui ce code (valable 10 minutes) :</li>
            </ol>
            <div className="telegram-code">{code}</div>
            <p className="form-hint">
              Ensuite, parlez-lui naturellement : « Où en est-on ? », « Écris un post LinkedIn sur… »,
              « Rappelle-moi demain 9h de relancer Marie ».
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  user: User;
  onLogout: () => void;
}

const navItems = [
  { to: '/',          icon: '📊', label: 'Tableau de bord' },
  { to: '/content',   icon: '📣', label: 'Hub de contenu'  },
  { to: '/new',       icon: '✨', label: 'Nouveau plan'    },
  { to: '/knowledge', icon: '📚', label: 'Connaissances'   },
  { to: '/agents',    icon: '🤖', label: 'Agents IA'       },
  { to: '/approvals', icon: '✋', label: 'Validations'     },
];

export default function Layout({ user, onLogout }: Props) {
  const location  = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [showTelegram, setShowTelegram] = useState(false);

  // Badge "validations en attente" — rafraîchi à chaque navigation + toutes les 30 s
  useEffect(() => {
    let cancelled = false;
    const refresh = () => getApprovals().then((res) => {
      if (!cancelled && res.success && res.data) setPendingApprovals(res.data.length);
    });
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [location.pathname]);

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
            onClick={() => { setShowTelegram(true); closeSidebar(); }}
          >
            <span className="layout-nav-icon">💬</span>
            Bot Telegram
          </button>

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

      {showTelegram && <TelegramModal onClose={() => setShowTelegram(false)} />}
    </div>
  );
}
