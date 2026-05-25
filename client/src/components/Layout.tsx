import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { User, setToken } from '../api/client';

interface Props {
  user: User;
  onLogout: () => void;
}

const navItems = [
  { to: '/',       icon: '📊', label: 'Dashboard' },
  { to: '/new',    icon: '✨', label: 'New Plan'  },
  { to: '/agents', icon: '🤖', label: 'Agents IA' },
];

export default function Layout({ user, onLogout }: Props) {
  const location  = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
            onClick={handleLogout}
          >
            <span className="layout-nav-icon">🚪</span>
            Sign Out
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
