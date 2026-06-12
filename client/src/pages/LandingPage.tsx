import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Flame, Bot, ClipboardList, Megaphone, BarChart3, Target, MessageSquare,
  PenLine, Send, TrendingUp, BookOpen, RefreshCw, ShieldCheck, Sparkles,
} from 'lucide-react';
import LogoEmbers from '../components/LogoEmbers';

gsap.registerPlugin(ScrollTrigger);

// ─────────────────────────────────────────────────────────────────────────────
// Contenu — uniquement des affirmations VRAIES (fonctionnalités réelles,
// captures réelles de l'app). Pas de témoignages inventés, pas de chiffres
// de vanité : le produit est jeune et on l'assume.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Bot size={22} />,
    title: 'Onboarding par IA',
    desc: 'Un chat vous interviewe, recherche votre entreprise sur le web, lit vos documents — et en tire un plan de lancement tactique, semaine par semaine.',
  },
  {
    icon: <Megaphone size={22} />,
    title: 'Publication multi-plateformes',
    desc: 'Un post, plusieurs plateformes : le texte est adapté aux codes de chacune par l\'IA, publié automatiquement à l\'heure dite via vos comptes connectés.',
  },
  {
    icon: <RefreshCw size={22} />,
    title: 'Séries récurrentes',
    desc: 'Un post hebdomadaire réécrit à chaque occurrence par l\'IA — qui relit ce qu\'elle a déjà publié pour ne jamais se répéter. Testable avant activation.',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Métriques & analyse',
    desc: 'Vues, likes, commentaires relevés automatiquement depuis vos comptes. Post-mortem IA de chaque post et comparaison du même contenu entre plateformes.',
  },
  {
    icon: <Target size={22} />,
    title: 'Détection de leads',
    desc: 'L\'IA lit les réactions de vos posts et votre boîte mail, repère les personnes intéressées, les score de 0 à 100 et rédige la relance.',
  },
  {
    icon: <MessageSquare size={22} />,
    title: 'Pilotage par chat',
    desc: 'Tout se commande en français, depuis l\'app ou Telegram : « publie ce post sur X et Instagram », « simule ma série », « bilan de la semaine ».',
  },
];

const LOOP_STEPS = [
  { icon: <BookOpen size={20} />,   title: 'Connaissances', desc: 'Votre entreprise, votre ton, vos offres — décrits une fois.' },
  { icon: <Sparkles size={20} />,   title: 'Rédaction IA',  desc: 'Posts, visuels et déclinaisons par plateforme.' },
  { icon: <Send size={20} />,       title: 'Publication',   desc: 'Automatique ou validée par vous, à l\'heure dite.' },
  { icon: <BarChart3 size={20} />,  title: 'Métriques',     desc: 'Vues, likes, leads — relevés sur vos comptes.' },
  { icon: <TrendingUp size={20} />, title: 'Enseignements', desc: 'L\'analyse IA réinjecte ce qui marche dans la base.' },
];

const SHOWCASES = [
  {
    img: '/landing/editeur.png',
    alt: 'Éditeur de post LaunchForge : multiselect de plateformes, aperçu fidèle LinkedIn, panneaux IA',
    title: 'Écrivez une fois, publiez partout',
    desc: 'Sélectionnez vos plateformes, écrivez (ou briefez l\'IA), et vérifiez le rendu exact dans des aperçus fidèles — LinkedIn, X, Instagram, Reddit, YouTube. À l\'enregistrement, chaque exemplaire est adapté aux codes de sa plateforme.',
    points: ['Aperçus fidèles par plateforme', 'Adaptation IA du texte par réseau', 'Images, GIF et vidéos jusqu\'à 3 Go'],
  },
  {
    img: '/landing/calendrier.png',
    alt: 'Calendrier éditorial mensuel de LaunchForge avec posts programmés',
    title: 'Votre mois de contenu, déjà rempli',
    desc: 'L\'IA génère des semaines de posts cohérents depuis votre plan de lancement. Vous relisez, ajustez, et le worker publie à l\'heure programmée — synchronisé avec votre Google Calendar.',
    points: ['Calendrier généré par l\'IA', 'Publication automatique opt-in', 'Synchro Google Calendar'],
  },
  {
    img: '/landing/performances.png',
    alt: 'Vue Performances de LaunchForge : graphiques d\'évolution et comparaison par plateforme',
    title: 'Mesurez, comparez, apprenez',
    desc: 'Les métriques remontent toutes seules depuis vos comptes. Le même contenu publié sur plusieurs plateformes devient une expérience comparée — et chaque enseignement nourrit les prochaines générations.',
    points: ['Courbes d\'évolution et progression', 'Impact d\'un même post par plateforme', 'Rapport de campagne hebdo sur Telegram'],
  },
];

const STEPS = [
  { num: '01', title: 'Décrivez votre entreprise', desc: 'Un chat d\'onboarding qui fait les recherches à votre place — entreprise existante ou simple idée.' },
  { num: '02', title: 'Recevez plan et calendrier', desc: 'Plan de lancement semaine par semaine et premiers posts rédigés, datés, prêts à relire.' },
  { num: '03', title: 'Publiez et apprenez', desc: 'Publication automatique ou validée, métriques relevées, leads détectés — et l\'IA s\'améliore avec vos résultats.' },
];

const FAQ = [
  {
    q: 'Combien ça coûte ?',
    a: 'Rien pendant la bêta — pas de carte bancaire demandée. Un tarif simple sera annoncé à la sortie de bêta, et les premiers utilisateurs seront prévenus avant tout changement.',
  },
  {
    q: 'L\'IA peut-elle publier sans mon accord ?',
    a: 'Non. La publication automatique est un réglage opt-in, post par post. Par défaut, tout contenu attend votre validation — dans l\'app ou directement depuis Telegram.',
  },
  {
    q: 'Comment mes comptes sociaux sont-ils connectés ?',
    a: 'Par OAuth via Composio : vous autorisez chaque plateforme dans une fenêtre officielle (LinkedIn, Google…), et vous pouvez révoquer chaque connexion en un clic depuis la Configuration. LaunchForge ne voit jamais vos mots de passe.',
  },
  {
    q: 'Et mes données ?',
    a: 'Export complet en JSON et suppression définitive du compte en libre-service (RGPD art. 17 et 20), depuis la vue Configuration. Pas de cookies tiers, pas de revente de données.',
  },
  {
    q: 'Quelles plateformes sont couvertes ?',
    a: 'Publication automatique sur LinkedIn, X, Instagram et YouTube ; Reddit, Facebook et les autres via l\'assistant. Plus la détection de leads (commentaires + boîte mail) et la synchro Google Calendar.',
  },
];

/** Braises ambiantes du héro — paramètres aléatoires stables par montage */
function EmberField({ count = 16 }: { count?: number }) {
  const embers = useMemo(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: 4 + Math.random() * 92,
      size: 2 + Math.round(Math.random() * 3),
      dur: 7 + Math.random() * 9,
      delay: Math.random() * 12,
      drift: -28 + Math.random() * 56,
    })), [count]);
  return (
    <div className="ember-field" aria-hidden="true">
      {embers.map((e) => (
        <span
          key={e.id}
          className="field-ember"
          style={{
            left: `${e.left}%`,
            width: e.size,
            height: e.size,
            animationDuration: `${e.dur}s`,
            animationDelay: `${e.delay}s`,
            ['--drift' as string]: `${e.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Héro animé : le produit au travail, en boucle (GSAP)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_DONE = [1, 4, 8, 11];
const MOCK_HOT = [15, 17, 21, 24, 27];

function HeroMock() {
  return (
    <div className="hero-mock" id="hero-mock" aria-hidden="true">
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
                className={`hero-mock-cell${MOCK_DONE.includes(i) ? ' done gs-cell' : MOCK_HOT.includes(i) ? ' hot gs-cell' : ''}`}
              />
            ))}
          </div>
        </div>
        <div className="hero-mock-feed">
          <div className="hero-mock-feed-title">L'agent en action</div>
          <div className="hero-mock-feed-item gs-feed">
            <span className="hero-mock-feed-icon"><PenLine size={14} /></span>
            <span><strong>Post LinkedIn rédigé</strong> — votre ton de marque</span>
            <span className="hero-mock-feed-badge">jeu. 09:00</span>
          </div>
          <div className="hero-mock-feed-item gs-feed">
            <span className="hero-mock-feed-icon"><RefreshCw size={14} /></span>
            <span><strong>Décliné</strong> pour X et Instagram</span>
            <span className="hero-mock-feed-badge">IA</span>
          </div>
          <div className="hero-mock-feed-item gs-feed">
            <span className="hero-mock-feed-icon ok"><Send size={14} /></span>
            <span><strong>Publié</strong> à l'heure programmée</span>
            <span className="hero-mock-feed-badge">auto</span>
          </div>
          <div className="hero-mock-feed-item gs-feed">
            <span className="hero-mock-feed-icon"><Target size={14} /></span>
            <span><strong>Lead détecté</strong> dans les commentaires</span>
            <span className="hero-mock-feed-badge">score 87</span>
          </div>
          <div className="hero-mock-feed-item gs-feed">
            <span className="hero-mock-feed-icon ok"><TrendingUp size={14} /></span>
            <span><strong>Métriques relevées</strong> — l'IA en tire les leçons</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = gsap.context(() => {
      if (reduced) {
        gsap.set('.gs-up, .gs-feed, .gs-cell, .loop-step, .shot-row, .gs-line', { clearProps: 'all', opacity: 1 });
        return;
      }

      // ── Héro : entrée puis démo en boucle ──
      gsap.from('.gs-up', { y: 26, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1 });
      const demo = gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 0.5 });
      demo
        .fromTo('.gs-cell', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.1 })
        .fromTo('.gs-feed', { x: 22, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power2.out', stagger: 0.5 }, '<0.2')
        .to({}, { duration: 2.2 }) // temps de lecture
        .to('.gs-feed', { opacity: 0, duration: 0.4, stagger: 0.04 })
        .to('.gs-cell', { opacity: 0, scale: 0.3, duration: 0.3, stagger: 0.02 }, '<');

      // ── La boucle de la forge : étapes + liens qui se dessinent au scroll ──
      gsap.from('.loop-step', {
        scrollTrigger: { trigger: '.loop-flow', start: 'top 75%' },
        y: 30, opacity: 0, duration: 0.55, ease: 'power3.out', stagger: 0.14,
      });
      gsap.from('.loop-link', {
        scrollTrigger: { trigger: '.loop-flow', start: 'top 75%' },
        scaleX: 0, transformOrigin: 'left center', duration: 0.4, stagger: 0.14, delay: 0.3,
      });
      const returnPath = document.querySelector<SVGPathElement>('.loop-return path');
      if (returnPath) {
        const len = returnPath.getTotalLength();
        gsap.fromTo(returnPath,
          { strokeDasharray: len, strokeDashoffset: len },
          {
            strokeDashoffset: 0, ease: 'none',
            scrollTrigger: { trigger: '.loop-flow', start: 'top 65%', end: 'bottom 45%', scrub: 1 },
          });
      }

      // ── Révélations génériques au scroll ──
      gsap.utils.toArray<HTMLElement>('.gs-section').forEach((el) => {
        gsap.from(el.querySelectorAll('.gs-reveal'), {
          scrollTrigger: { trigger: el, start: 'top 78%' },
          y: 34, opacity: 0, duration: 0.65, ease: 'power3.out', stagger: 0.1,
        });
      });

      // ── Barre de progression : la braise monte avec la lecture ──
      gsap.to('.scroll-ember', {
        scaleX: 1, ease: 'none',
        scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.4 },
      });

      // ── Captures : parallaxe douce au scroll ──
      gsap.utils.toArray<HTMLElement>('.shot-frame').forEach((el) => {
        gsap.fromTo(el, { y: 36 }, {
          y: -24, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top 90%', end: 'bottom 10%', scrub: 1.2 },
        });
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      <div className="scroll-ember" aria-hidden="true" />
      {/* ── Nav ── */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span className="landing-logo">
            <span className="landing-logo-icon"><Flame size={20} /></span>
            <span>Launch<span className="logo-forge">Forge</span></span>
            <LogoEmbers />
          </span>
          <nav className="landing-nav-links" aria-label="Navigation principale">
            <a href="#boucle">La boucle</a>
            <a href="#produit">Le produit</a>
            <a href="#how">Comment ça marche</a>
            <a href="#faq">FAQ</a>
            <Link to="/login" className="btn btn-ghost btn-sm">Se connecter</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Commencer</Link>
          </nav>
        </div>
      </header>

      {/* ── Héro ── */}
      <section className="landing-hero">
        <div className="landing-hero-bg" />
        <EmberField />
        <div className="hero-coals" aria-hidden="true" />
        <div className="landing-hero-content">
          <h1 className="gs-up">
            Forgez la <span className="hero-serif gradient-text">traction</span>
            <br />de votre startup
          </h1>
          <p className="landing-hero-sub gs-up">
            LaunchForge transforme votre plan de lancement en posts rédigés, adaptés et publiés
            sur LinkedIn, X, Instagram et YouTube — puis mesure ce qui marche et apprend de vos
            résultats. Vous gardez la main à chaque étape.
          </p>
          <div className="landing-hero-cta gs-up">
            <Link to="/register" className="btn btn-primary btn-primary-glow btn-lg">
              Commencer gratuitement →
            </Link>
            <a href="#produit" className="btn btn-ghost btn-lg">Voir le produit</a>
          </div>
          {/* Affirmations vérifiables, pas de chiffres de vanité */}
          <div className="hero-truths gs-up">
            <span><Flame size={13} /> Gratuit pendant la bêta</span>
            <span><ShieldCheck size={13} /> RGPD : export &amp; suppression en libre-service</span>
            <span><MessageSquare size={13} /> Pilotable depuis Telegram</span>
          </div>
        </div>
        <HeroMock />
      </section>

      {/* ── La boucle de la forge (schéma animé) ── */}
      <section className="landing-section gs-section" id="boucle">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">La boucle de la forge</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>
            Chaque cycle rend le suivant meilleur : ce que vos posts vous apprennent
            retourne dans la matière première de l'IA.
          </p>
          <div className="loop-flow" role="img" aria-label="Schéma : connaissances, rédaction IA, publication, métriques, enseignements — en boucle">
            {LOOP_STEPS.map((s, i) => (
              <div key={s.title} className="loop-step-wrap">
                <div className="loop-step">
                  <span className="loop-step-icon">{s.icon}</span>
                  <span className="loop-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
                {i < LOOP_STEPS.length - 1 && <span className="loop-link" aria-hidden="true" />}
              </div>
            ))}
            <svg className="loop-return" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true">
              <path d="M 980 4 C 980 48, 20 48, 20 4" fill="none" stroke="url(#emberGrad)" strokeWidth="2" strokeLinecap="round" />
              <defs>
                <linearGradient id="emberGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#e8590c" />
                  <stop offset="50%" stopColor="#ff6b35" />
                  <stop offset="100%" stopColor="#ffb347" />
                </linearGradient>
              </defs>
            </svg>
            <div className="loop-return-label">les enseignements retournent à la forge</div>
          </div>
        </div>
      </section>

      {/* ── Fonctionnalités ── */}
      <section className="landing-section gs-section" id="features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">Tout l'atelier, sous un même toit</h2>
          <div className="ember-line gs-reveal" />
          <div className="landing-features" style={{ marginTop: 44 }}>
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-feature-card gs-reveal">
                <span className="landing-feature-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Le produit, en vrai (captures réelles) ── */}
      <section className="landing-section landing-section-alt gs-section" id="produit">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">Le produit, en vrai</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>
            Pas de maquettes embellies : ces captures sortent de l'application.
          </p>
          {SHOWCASES.map((s, i) => (
            <div key={s.title} className={`shot-row${i % 2 === 1 ? ' reverse' : ''}`}>
              <div className="shot-text gs-reveal">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <ul>
                  {s.points.map((pt) => <li key={pt}><Flame size={12} /> {pt}</li>)}
                </ul>
              </div>
              <div className="shot-frame gs-reveal">
                <img src={s.img} alt={s.alt} loading="lazy" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Comment ça marche ── */}
      <section className="landing-section gs-section" id="how">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">Trois étapes, et la forge tourne</h2>
          <div className="ember-line gs-reveal" />
          <div className="landing-steps" style={{ marginTop: 44 }}>
            {STEPS.map((s) => (
              <div key={s.num} className="landing-step gs-reveal">
                <div className="landing-step-num">{s.num}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="landing-section gs-section" id="faq">
        <div className="landing-section-inner" style={{ maxWidth: 720 }}>
          <h2 className="landing-section-title gs-reveal">Questions directes, réponses directes</h2>
          <div className="ember-line gs-reveal" />
          <div className="faq-list" style={{ marginTop: 40 }}>
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item gs-reveal">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Honnêteté (remplace les faux témoignages) ── */}
      <section className="landing-section landing-section-alt gs-section">
        <div className="landing-section-inner">
          <div className="honest-card gs-reveal">
            <h2>Pas de faux avis ici</h2>
            <p>
              LaunchForge est un produit jeune. Plutôt que d'inventer des témoignages cinq
              étoiles, on préfère vous montrer le vrai produit — et vous laisser juger.
              C'est gratuit pendant la bêta, sans carte bancaire, et vos données s'exportent
              ou s'effacent en deux clics, comme l'exige le RGPD.
            </p>
            <Link to="/register" className="btn btn-primary btn-primary-glow btn-lg">
              Essayer et se faire son avis →
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
          <a href="#boucle">La boucle</a>
          {' · '}
          <a href="#produit">Le produit</a>
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
