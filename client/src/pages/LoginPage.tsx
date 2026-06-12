import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
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
      setError(res.error || 'Connexion impossible');
      return;
    }

    setToken(res.data.token);
    onLogin(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>Bon retour !</h1>
        <p>Connectez-vous à votre compte LaunchForge</p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label>Mot de passe</label>
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
            {busy ? '⏳ Connexion…' : '→ Se connecter'}
          </button>
        </form>

        <div className="footer-link">
          <Link to="/forgot-password">Mot de passe oublié ?</Link>
        </div>
        <div className="footer-link">
          Pas encore de compte ?{' '}
          <Link to="/register">Créez-en un gratuitement</Link>
        </div>
      </div>
    </div>
  );
}
