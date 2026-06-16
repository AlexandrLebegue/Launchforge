import { useEffect, useState } from 'react';
import { useLang } from '../i18n';
import { getOAuthStatus, GOOGLE_LOGIN_URL } from '../api/client';

const T = {
  fr: { label: 'Continuer avec Google', or: 'ou' },
  en: { label: 'Continue with Google', or: 'or' },
};

/** Logo Google officiel (4 couleurs), inline pour éviter une dépendance */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/** Bouton « Continuer avec Google » — ne s'affiche que si le serveur l'active */
export default function GoogleSignInButton() {
  const { lang } = useLang();
  const t = T[lang];
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    getOAuthStatus().then((res) => {
      if (res.success && res.data?.google) setEnabled(true);
    });
  }, []);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-google"
        onClick={() => { window.location.href = GOOGLE_LOGIN_URL; }}
        style={{ width: '100%', justifyContent: 'center', gap: 10, padding: '12px' }}
      >
        <GoogleLogo />
        {t.label}
      </button>
      <div className="auth-divider"><span>{t.or}</span></div>
    </>
  );
}
