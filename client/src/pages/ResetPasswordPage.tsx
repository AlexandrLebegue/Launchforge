import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { useLang, LangSwitch } from '../i18n';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword, setToken, User } from '../api/client';

interface Props {
  onLogin: (user: User) => void;
}

const T = {
  fr: { title: 'Nouveau mot de passe', sub: 'Choisissez le nouveau mot de passe de votre compte', pwd: 'Nouveau mot de passe', pwdPh: '6 caractères minimum', pwd2: 'Confirmez le mot de passe', submit: '✓ Changer le mot de passe', busy: '⏳…', back: '← Retour à la connexion', mismatch: 'Les deux mots de passe ne correspondent pas.', err: 'Réinitialisation impossible — le lien a peut-être expiré.', badLinkA: 'Lien incomplet — ouvrez le lien reçu par email, ou', badLinkB: 'refaites une demande' },
  en: { title: 'New password', sub: 'Choose a new password for your account', pwd: 'New password', pwdPh: 'At least 6 characters', pwd2: 'Confirm the password', submit: '✓ Change password', busy: '⏳…', back: '← Back to sign in', mismatch: 'The two passwords do not match.', err: 'Reset failed — the link may have expired.', badLinkA: 'Incomplete link — open the link from the email, or', badLinkB: 'request a new one' },
};

export default function ResetPasswordPage({ onLogin }: Props) {
  const { lang } = useLang();
  const t = T[lang];
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
      setError(t.mismatch);
      return;
    }
    setBusy(true);
    const res = await resetPassword(token, password);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || t.err);
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
        <div className="auth-lang"><LangSwitch /></div>
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>{t.title}</h1>
        <p>{t.sub}</p>

        {error && <div className="error">{error}</div>}

        {!token ? (
          <div className="error">
            {t.badLinkA}{' '}
            <Link to="/forgot-password">{t.badLinkB}</Link>.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
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
            <div className="form-group">
              <label>{t.pwd2}</label>
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
              {busy ? t.busy : t.submit}
            </button>
          </form>
        )}

        <div className="footer-link">
          <Link to="/login">{t.back}</Link>
        </div>
      </div>
    </div>
  );
}
