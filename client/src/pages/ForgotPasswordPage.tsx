import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { useLang, LangSwitch } from '../i18n';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/client';

const T = {
  fr: { title: 'Mot de passe oublié', sub: 'Recevez un lien de réinitialisation par email', label: 'Email du compte', submit: '📬 Envoyer le lien'.replace('📬 ', ''), busy: '⏳ Envoi…', back: '← Retour à la connexion', err: 'Demande impossible — réessayez.', sentA: 'Si un compte existe pour', sentB: ', un lien de réinitialisation (valable 30 minutes) vient d\'être envoyé. Pensez à vérifier les spams.' },
  en: { title: 'Forgot password', sub: 'Get a reset link by email', label: 'Account email', submit: 'Send the link', busy: '⏳ Sending…', back: '← Back to sign in', err: 'Request failed — please try again.', sentA: 'If an account exists for', sentB: ', a reset link (valid 30 minutes) has just been sent. Remember to check your spam folder.' },
};

export default function ForgotPasswordPage() {
  const { lang } = useLang();
  const t = T[lang];
  const [email, setEmail] = useState('');
  const [sent,  setSent]  = useState(false);
  const [error, setError] = useState('');
  const [busy,  setBusy]  = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await forgotPassword(email.trim());
    setBusy(false);
    if (res.success) setSent(true);
    else setError(res.error || t.err);
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-lang"><LangSwitch /></div>
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>{t.title}</h1>
        <p>{t.sub}</p>

        {error && <div className="error">{error}</div>}

        {sent ? (
          <div className="approval-feedback">
            {t.sentA} <strong>{email}</strong>{t.sentB}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t.label}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.fr"
                autoComplete="email"
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
