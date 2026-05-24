import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, setToken, User } from '../api/client';

interface Props {
  onRegister: (user: User) => void;
}

export default function RegisterPage({ onRegister }: Props) {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    const res = await register(email, password, name);
    setBusy(false);

    if (!res.success || !res.data) {
      setError(res.error || 'Registration failed');
      return;
    }

    setToken(res.data.token);
    onRegister(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo">🚀</div>
        <h1>Create account</h1>
        <p>Start generating launch plans in seconds</p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
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
              placeholder="At least 6 characters"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
          >
            {busy ? '⏳ Creating account…' : '→ Create Account'}
          </button>
        </form>

        <div className="footer-link">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
