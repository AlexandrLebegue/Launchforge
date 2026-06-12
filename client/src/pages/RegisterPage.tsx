import { useState, FormEvent } from 'react';
import { Flame } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { register, setToken, User } from '../api/client';

interface Props {
  onRegister: (user: User) => void;
}

export default function RegisterPage({ onRegister }: Props) {
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
      setError(res.error || 'Inscription impossible');
      return;
    }

    setToken(res.data.token);
    onRegister(res.data.user);
    navigate('/');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-page">
        <div className="auth-page-logo"><Flame size={30} /></div>
        <h1>Créer un compte</h1>
        <p>Votre hub de promotion, prêt en quelques secondes</p>

        {error && <div className="error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nom</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Votre nom"
              autoComplete="name"
            />
          </div>
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
              placeholder="6 caractères minimum"
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
            {busy ? '⏳ Création…' : '→ Créer mon compte'}
          </button>
        </form>

        <div className="footer-link">
          Déjà un compte ?{' '}
          <Link to="/login">Se connecter</Link>
        </div>
      </div>
    </div>
  );
}
