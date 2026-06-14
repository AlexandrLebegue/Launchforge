import { useState, useEffect, useRef, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { register, login, setToken, joinTeam, getInvitePreview, User, InvitePreview } from '../api/client';

interface Props {
  user: User | null;
  onAuthed: (user: User) => void;
}

const ROLE_LABEL: Record<string, string> = { owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur' };

/**
 * Page PUBLIQUE d'arrivée sur un lien d'invitation (/join?code=…). Affiche
 * l'équipe à rejoindre puis : si l'utilisateur est connecté, l'ajoute et
 * redirige ; sinon, propose de créer un compte (ou se connecter) pour rejoindre.
 */
export default function JoinPage({ user, onAuthed }: Props) {
  const [params] = useSearchParams();
  const code = params.get('code') || '';
  const navigate = useNavigate();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!code) { setLoading(false); return; }
    getInvitePreview(code).then((res) => {
      if (res.success && res.data) setPreview(res.data);
      setLoading(false);
    });
  }, [code]);

  // Connecté + invitation valide → on rejoint et on redirige (une seule fois)
  useEffect(() => {
    if (!code || !user || !preview?.valid || joinedRef.current) return;
    joinedRef.current = true;
    joinTeam(code).finally(() => navigate('/teams', { replace: true }));
  }, [user, preview, code, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = mode === 'register' ? await register(email, password, name) : await login(email, password);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || (mode === 'register' ? 'Inscription impossible' : 'Connexion impossible'));
      return;
    }
    setToken(res.data.token);
    // onAuthed met à jour l'état global → l'effet ci-dessus rejoint puis redirige
    onAuthed(res.data.user);
  };

  if (loading) return <div className="loading">⏳ Chargement de l'invitation…</div>;

  // Invitation absente / invalide / expirée
  if (!code || !preview || !preview.valid) {
    return (
      <div className="auth-wrapper">
        <div className="auth-page">
          <div className="auth-page-logo"><Flame size={30} /></div>
          <h1>Invitation invalide</h1>
          <p>{preview?.expired ? 'Ce lien d\'invitation a expiré — demandez-en un nouveau au propriétaire de l\'équipe.' : 'Ce lien d\'invitation n\'est plus valable.'}</p>
          <div className="footer-link"><Link to="/login">Aller à la connexion</Link></div>
        </div>
      </div>
    );
  }

  // Connecté : l'effet rejoint et redirige — court message transitoire
  if (user) {
    return <div className="loading">⏳ Ajout à l'équipe « {preview.teamName} »…</div>;
  }

  // Déconnecté : création de compte (ou connexion) pour rejoindre
  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>Rejoindre « {preview.teamName} »</h1>
        <p>
          Vous êtes invité·e comme <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>.{' '}
          {mode === 'register' ? 'Créez votre compte pour rejoindre l\'équipe.' : 'Connectez-vous pour rejoindre l\'équipe.'}
        </p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Nom</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre nom" autoComplete="name" />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" autoComplete="email" required />
          </div>
          <div className="form-group">
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '6 caractères minimum' : 'Votre mot de passe'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
            {busy ? '⏳…' : (mode === 'register' ? '→ Créer mon compte et rejoindre' : '→ Se connecter et rejoindre')}
          </button>
        </form>

        <div className="footer-link">
          {mode === 'register' ? (
            <>Déjà un compte ?{' '}
              <button type="button" className="auth-link-btn" onClick={() => { setMode('login'); setError(''); }}>Se connecter</button>
            </>
          ) : (
            <>Pas encore de compte ?{' '}
              <button type="button" className="auth-link-btn" onClick={() => { setMode('register'); setError(''); }}>Créer un compte</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
