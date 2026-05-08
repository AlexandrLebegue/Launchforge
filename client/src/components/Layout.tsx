import { Outlet, Link } from 'react-router-dom';
import { User, setToken } from '../api/client';

interface Props {
  user: User;
  onLogout: () => void;
}

export default function Layout({ user, onLogout }: Props) {
  const handleLogout = () => {
    setToken(null);
    onLogout();
  };

  return (
    <div>
      <header className="layout-header">
        <Link to="/" className="logo">
          <span>🚀</span> LaunchForge
        </Link>
        <nav>
          <Link to="/">Dashboard</Link>
          <Link to="/new">New Plan</Link>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            {user.email}
          </span>
          <button onClick={handleLogout}>Logout</button>
        </nav>
      </header>
      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}
