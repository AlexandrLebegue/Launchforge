import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { useLang, LangSwitch } from '../i18n';
import { Link, useNavigate } from 'react-router-dom';
import { login, setToken, User } from '../api/client';

interface Props {
  onLogin: (user: User) => void;
}

const T = {
  fr: { title: 'Bon retour !', sub: 'Connectez-vous à votre compte LaunchForge', email: 'Email', pwd: 'Mot de passe', submit: '→ Se connecter', busy: '⏳ Connexion…', forgot: 'Mot de passe oublié ?', noAccount: 'Pas encore de compte ?', create: 'Créez-en un gratuitement', err: 'Connexion impossible' },
  en: { title: 'Welcome back!', sub: 'Sign in to your LaunchForge account', email: 'Email', pwd: 'Password', submit: '→ Sign in', busy: '⏳ Signing in…', forgot: 'Forgot your password?', noAccount: 'No account yet?', create: 'Create one for free', err: 'Could not sign in' },
};

export default function LoginPage({ onLogin }: Props) {
  const { lang } = useLang();
  const t = T[lang];
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
      setError(res.error || t.err);
      return;
    }

    setToken(res.data.token);
    onLogin(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-lang"><LangSwitch /></div>
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>{t.title}</h1>
        <p>{t.sub}</p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t.email}</label>
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
            <label>{t.pwd}</label>
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
            {busy ? t.busy : t.submit}
          </button>
        </form>

        <div className="footer-link">
          <Link to="/forgot-password">{t.forgot}</Link>
        </div>
        <div className="footer-link">
          {t.noAccount}{' '}
          <Link to="/register">{t.create}</Link>
        </div>
      </div>
    </div>
  );
}
