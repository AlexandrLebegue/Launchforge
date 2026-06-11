import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/client';

export default function ForgotPasswordPage() {
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
    else setError(res.error || 'Demande impossible — réessayez.');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo">🔑</div>
        <h1>Mot de passe oublié</h1>
        <p>Recevez un lien de réinitialisation par email</p>

        {error && <div className="error">{error}</div>}

        {sent ? (
          <div className="approval-feedback">
            📬 Si un compte existe pour <strong>{email}</strong>, un lien de réinitialisation
            (valable 30 minutes) vient d'être envoyé. Pensez à vérifier les spams.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email du compte</label>
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
              {busy ? '⏳ Envoi…' : '📬 Envoyer le lien'}
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
