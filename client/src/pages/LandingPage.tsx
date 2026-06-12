import { Link } from 'react-router-dom';
import {
  Flame, Bot, ClipboardList, Megaphone, BarChart3, Target, MessageSquare,
  PenLine, Send, TrendingUp,
} from 'lucide-react';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import LogoEmbers from '../components/LogoEmbers';

const features = [
  {
    icon: <Bot size={22} />,
    title: 'Onboarding par IA',
    desc: 'L\'assistant vous interviewe et recherche lui-même votre entreprise sur le web. Joignez un pitch ou un business plan, il s\'occupe du reste.',
  },
  {
    icon: <ClipboardList size={22} />,
    title: 'Plan de lancement sur mesure',
    desc: 'Un plan tactique semaine par semaine : actions concrètes, KPIs, communautés à cibler, angles de contenu — adapté à votre niche.',
  },
  {
    icon: <Megaphone size={22} />,
    title: 'Hub de contenu',
    desc: 'Calendrier éditorial généré par l\'IA, posts récurrents, publication automatique à l\'heure dite et synchro avec votre agenda.',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Analyse des performances',
    desc: 'Métriques par post (synchronisées depuis vos comptes), taux d\'engagement, meilleures plateformes : vous savez ce qui marche.',
  },
  {
    icon: <Target size={22} />,
    title: 'Détection de leads',
    desc: 'L\'IA lit les commentaires de vos posts et votre boîte mail, repère les personnes intéressées et les score de 0 à 100.',
  },
  {
    icon: <MessageSquare size={22} />,
    title: 'Pilotage par chat',
    desc: 'Validez des contenus, lancez des agents, dictez un post ou programmez un rappel — directement depuis Telegram.',
  },
];

const steps = [
  { num: 1, title: 'Décrivez votre entreprise', desc: 'Un chat avec l\'IA qui fait les recherches à votre place — existante ou simple idée.' },
  { num: 2, title: 'Recevez plan + calendrier', desc: 'Plan de lancement tactique et semaines de posts rédigés, programmés, ajoutés à votre agenda.' },
  { num: 3, title: 'Publiez et suivez', desc: 'Publication automatique ou validée par vous, métriques, leads détectés, relances par email.' },
];

const stats = [
  { value: '1 min', label: 'Pour un mois de contenu' },
  { value: '10+',   label: 'Plateformes couvertes'   },
  { value: '100 %', label: 'Gratuit pour démarrer'   },
];

const testimonials = [
  {
    text: 'Un mois de posts rédigés et programmés en une minute, avec mon ton de marque grâce à la base de connaissances. Le gain de temps est irréel.',
    name: 'Alex M.',
    role: 'Indie hacker',
    initial: 'A',
  },
  {
    text: 'Enfin un outil qui exécute au lieu de conseiller : les agents rédigent, je valide depuis Telegram, c\'est publié. Le pipeline de validation me rassure.',
    name: 'Sarah K.',
    role: 'Fondatrice SaaS',
    initial: 'S',
  },
  {
    text: 'Le scoring des leads dans les commentaires a changé ma prospection : je sais qui relancer en premier, et l\'IA rédige l\'email.',
    name: 'Ravi T.',
    role: 'Développeur',
    initial: 'R',
  },
];

// Maquette du héro : un mois de contenu qui se remplit (vert = publié, braise = programmé)
const MOCK_DONE = new Set([1, 4, 8, 11]);
const MOCK_HOT  = new Set([15, 17, 21, 24, 27]);

function HeroMock() {
  return (
    <div className="hero-mock">
      <div className="hero-mock-bar">
        <span className="hero-mock-dot" /><span className="hero-mock-dot" /><span className="hero-mock-dot" />
        <span className="hero-mock-title">LAUNCHFORGE — VOTRE AGENT TRAVAILLE</span>
      </div>
      <div className="hero-mock-body">
        <div className="hero-mock-cal">
          <div className="hero-mock-cal-title">Votre mois de contenu</div>
          <div className="hero-mock-grid">
            {Array.from({ length: 28 }, (_, i) => (
              <span
                key={i}
                className={`hero-mock-cell${MOCK_DONE.has(i) ? ' done' : MOCK_HOT.has(i) ? ' hot' : ''}`}
              />
            ))}
          </div>
        </div>
        <div className="hero-mock-feed">
          <div className="hero-mock-feed-title">L'agent en action</div>
          <div className="hero-mock-feed-item">
            <span className="hero-mock-feed-icon"><PenLine size={14} /></span>
            <span><strong>Post LinkedIn rédigé</strong> — votre ton de marque</span>
            <span className="hero-mock-feed-badge">jeu. 09:00</span>
          </div>
          <div className="hero-mock-feed-item">
            <span className="hero-mock-feed-icon ok"><Send size={14} /></span>
            <span><strong>Publié</strong> sur LinkedIn + X</span>
            <span className="hero-mock-feed-badge">auto</span>
          </div>
          <div className="hero-mock-feed-item">
            <span className="hero-mock-feed-icon"><Target size={14} /></span>
            <span><strong>Lead détecté</strong> dans les commentaires</span>
            <span className="hero-mock-feed-badge">score 87</span>
          </div>
          <div className="hero-mock-feed-item">
            <span className="hero-mock-feed-icon ok"><TrendingUp size={14} /></span>
            <span><strong>+214 % d'impressions</strong> cette semaine</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  // Activates scroll-reveal on all .reveal elements
  useIntersectionObserver();

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">
            <span className="landing-logo-icon"><Flame size={20} /></span>
            <span>Launch<span className="logo-forge">Forge</span></span>
            <LogoEmbers />
          </span>
          <div className="landing-nav-links">
            <a href="#features">Fonctionnalités</a>
            <a href="#how">Comment ça marche</a>
            <Link to="/login"    className="btn btn-ghost btn-sm">Se connecter</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Commencer</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <div className="landing-hero-content">
          <h1>
            Forgez la <span className="hero-serif gradient-text">traction</span>
            <br />de votre startup
          </h1>
          <p className="landing-hero-sub">
            De l'idée à la traction : l'IA construit votre plan de lancement, rédige et
            publie votre contenu, détecte vos prospects les plus chauds — vous gardez le contrôle.
          </p>

          <div className="landing-hero-cta">
            <Link
              to="/register"
              className="btn btn-primary btn-primary-glow btn-lg"
            >
              Créer mon plan gratuitement →
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">
              Se connecter
            </Link>
          </div>

          {/* Stats */}
          <div className="landing-stats">
            {stats.map((s, i) => (
              <div key={i} className={`landing-stat stagger-${i + 1}`}>
                <div className="landing-stat-value">{s.value}</div>
                <div className="landing-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <HeroMock />
      </section>

      {/* ── Features ── */}
      <section className="landing-section reveal" id="features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Tout pour promouvoir votre entreprise</h2>
          <div className="ember-line" />
          <p className="landing-section-sub" style={{ marginTop: 14 }}>
            De la stratégie à la publication, en passant par les leads
          </p>
          <div className="landing-features">
            {features.map((f, i) => (
              <div
                key={i}
                className={`landing-feature-card reveal stagger-${(i % 6) + 1}`}
              >
                <span className="landing-feature-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="landing-section reveal" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Ils l'utilisent au quotidien</h2>
          <div className="ember-line" />
          <p className="landing-section-sub" style={{ marginTop: 14 }}>
            Des fondateurs qui exécutent au lieu de procrastiner
          </p>
          <div className="landing-testimonials">
            {testimonials.map((t, i) => (
              <div key={i} className={`testimonial-card reveal stagger-${i + 1}`}>
                <div className="testimonial-stars">★★★★★</div>
                <p className="testimonial-text">"{t.text}"</p>
                <div className="testimonial-author">
                  <div className="testimonial-avatar">{t.initial}</div>
                  <div>
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="landing-section reveal" id="how">
        <div className="landing-section-inner">
          <h2 className="landing-section-title">Comment ça marche</h2>
          <div className="ember-line" />
          <p className="landing-section-sub" style={{ marginTop: 14 }}>Trois étapes, et votre promotion tourne</p>
          <div className="landing-steps">
            {steps.map((s, i) => (
              <div key={i} className={`landing-step reveal stagger-${i + 1}`}>
                <div className="landing-step-num">{s.num}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 48 }}>
            <Link
              to="/register"
              className="btn btn-primary btn-primary-glow btn-lg"
            >
              Lancer ma promotion →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <p>
          Conçu pour les fondateurs qui exécutent. &copy; 2026{' '}
          <strong style={{ color: 'var(--color-text)' }}>Launch<span className="logo-forge">Forge</span></strong>
        </p>
        <p style={{ marginTop: 6 }}>
          <a href="#features">Fonctionnalités</a>
          {' · '}
          <a href="#how">Comment ça marche</a>
          {' · '}
          <Link to="/register">Commencer</Link>
          {' · '}
          <Link to="/legal">Mentions légales</Link>
          {' · '}
          <Link to="/privacy">Confidentialité</Link>
        </p>
      </footer>
    </div>
  );
}
