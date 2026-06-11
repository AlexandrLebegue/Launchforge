import { useState, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword, setToken, User } from '../api/client';

interface Props {
  onLogin: (user: User) => void;
}

export default function ResetPasswordPage({ onLogin }: Props) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password,  setPassword]  = useState('');
  const [password2, setPassword2] = useState('');
  const [error,     setError]     = useState('');
  const [busy,      setBusy]      = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== password2) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    const res = await resetPassword(token, password);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Réinitialisation impossible — le lien a peut-être expiré.');
      return;
    }
    // Le contrôle de l'email vient d'être prouvé : connexion directe
    setToken(res.data.token);
    onLogin(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo">🔑</div>
        <h1>Nouveau mot de passe</h1>
        <p>Choisissez le nouveau mot de passe de votre compte</p>

        {error && <div className="error">{error}</div>}

        {!token ? (
          <div className="error">
            Lien incomplet — ouvrez le lien reçu par email, ou{' '}
            <Link to="/forgot-password">refaites une demande</Link>.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Nouveau mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6 caractères minimum"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="form-group">
              <label>Confirmez le mot de passe</label>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="••••••••"
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
              {busy ? '⏳…' : '✓ Changer le mot de passe'}
            </button>
          </form>
        )}

        <div className="footer-link">
          <Link to="/login">← Retour à la connexion</Link>
        </div>
      </div>
    </div>
  );
}
