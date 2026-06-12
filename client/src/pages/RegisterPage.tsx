import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { useLang, LangSwitch } from '../i18n';
import { Link, useNavigate } from 'react-router-dom';
import { register, setToken, User } from '../api/client';

interface Props {
  onRegister: (user: User) => void;
}

const T = {
  fr: { title: 'Créer un compte', sub: 'Votre hub de promotion, prêt en quelques secondes', name: 'Nom', namePh: 'Votre nom', email: 'Email', pwd: 'Mot de passe', pwdPh: '6 caractères minimum', submit: '→ Créer mon compte', busy: '⏳ Création…', has: 'Déjà un compte ?', login: 'Se connecter', err: 'Inscription impossible' },
  en: { title: 'Create an account', sub: 'Your promotion hub, ready in seconds', name: 'Name', namePh: 'Your name', email: 'Email', pwd: 'Password', pwdPh: 'At least 6 characters', submit: '→ Create my account', busy: '⏳ Creating…', has: 'Already have an account?', login: 'Sign in', err: 'Could not create the account' },
};

export default function RegisterPage({ onRegister }: Props) {
  const { lang } = useLang();
  const t = T[lang];
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
      setError(res.error || t.err);
      return;
    }

    setToken(res.data.token);
    onRegister(res.data.user);
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
            <label>{t.name}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePh}
              autoComplete="name"
            />
          </div>
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
              placeholder={t.pwdPh}
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
            {busy ? t.busy : t.submit}
          </button>
        </form>

        <div className="footer-link">
          {t.has}{' '}
          <Link to="/login">{t.login}</Link>
        </div>
      </div>
    </div>
  );
}
