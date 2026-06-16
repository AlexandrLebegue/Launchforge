import { useEffect, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../i18n';
import { getMe, setToken, User } from '../api/client';

interface Props {
  onLogin: (user: User) => void;
}

const T = {
  fr: {
    loading: 'Connexion en cours…',
    errors: {
      access_denied: 'Connexion Google annulée.',
      google_not_configured: 'La connexion Google n’est pas activée sur ce serveur.',
      invalid_state: 'Session de connexion expirée — réessayez.',
      email_unverified: 'Votre adresse Google n’est pas vérifiée.',
      oauth_failed: 'La connexion Google a échoué — réessayez.',
      default: 'Connexion impossible.',
    } as Record<string, string>,
  },
  en: {
    loading: 'Signing you in…',
    errors: {
      access_denied: 'Google sign-in cancelled.',
      google_not_configured: 'Google sign-in is not enabled on this server.',
      invalid_state: 'Sign-in session expired — please try again.',
      email_unverified: 'Your Google email address is not verified.',
      oauth_failed: 'Google sign-in failed — please try again.',
      default: 'Could not sign in.',
    } as Record<string, string>,
  },
};

export default function OAuthCallbackPage({ onLogin }: Props) {
  const { lang } = useLang();
  const t = T[lang];
  const navigate = useNavigate();
  const [error, setError] = useState('');
  // Garde StrictMode (double-montage en dev) : ne traite le token qu'une fois.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const errCode = params.get('error');

    if (errCode) {
      setError(t.errors[errCode] || t.errors.default);
      return;
    }
    if (!token) {
      setError(t.errors.default);
      return;
    }

    setToken(token);
    getMe().then((res) => {
      if (res.success && res.data) {
        onLogin(res.data);
        navigate('/', { replace: true });
      } else {
        setToken(null);
        setError(t.errors.default);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo"><Flame size={30} /></div>
        {error ? (
          <>
            <div className="error">{error}</div>
            <div className="footer-link">
              <button className="btn btn-primary" onClick={() => navigate('/login', { replace: true })}>
                {lang === 'fr' ? 'Retour à la connexion' : 'Back to sign in'}
              </button>
            </div>
          </>
        ) : (
          <p>{t.loading}</p>
        )}
      </div>
    </div>
  );
}
