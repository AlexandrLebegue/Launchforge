import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, setToken, User } from '../api/client';

interface Props {
  onLogin: (user: User) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    const res = await login(email, password);
    setBusy(false);

    if (!res.success || !res.data) {
      setError(res.error || 'Login failed');
      return;
    }

    setToken(res.data.token);
    onLogin(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo">🚀</div>
        <h1>Welcome back</h1>
        <p>Sign in to your LaunchForge account</p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
          >
            {busy ? '⏳ Signing in…' : '→ Sign In'}
          </button>
        </form>

        <div className="footer-link">
          Don&apos;t have an account?{' '}
          <Link to="/register">Create one free</Link>
        </div>
      </div>
    </div>
  );
}
