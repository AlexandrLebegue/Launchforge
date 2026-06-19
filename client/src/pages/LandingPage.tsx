import { useEffect, useMemo, useRef, useState, Fragment, ReactElement } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Flame, Bot, Megaphone, BarChart3, Target, MessageSquare,
  PenLine, Send, TrendingUp, BookOpen, RefreshCw, ShieldCheck, Sparkles, CreditCard, History,
  Briefcase, MessageCircle, Camera, Users, Music2, Play, MessagesSquare, Check, Minus, ChevronDown,
} from 'lucide-react';
import LogoEmbers from '../components/LogoEmbers';
import { useLang, LangSwitch, Lang } from '../i18n';

gsap.registerPlugin(ScrollTrigger);

// ─────────────────────────────────────────────────────────────────────────────
// Contenu bilingue — uniquement des affirmations VRAIES (fonctionnalités
// réelles, captures réelles de l'app). Pas de témoignages inventés.
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_ICONS = [
  <Bot size={22} />, <Megaphone size={22} />, <RefreshCw size={22} />,
  <BarChart3 size={22} />, <Target size={22} />, <MessageSquare size={22} />,
  <History size={22} />,
];
const LOOP_ICONS = [
  <BookOpen size={20} />, <Sparkles size={20} />, <Send size={20} />,
  <BarChart3 size={20} />, <TrendingUp size={20} />,
];

// Positions (en % du carré) des 6 modules autour du cœur — 6 angles à 60° l'un de
// l'autre, en partant du haut. Les connecteurs SVG partent du centre (50,50).
const HUB_POS = [
  { x: 50, y: 11 },   // haut
  { x: 83, y: 30.5 }, // haut-droite
  { x: 83, y: 69.5 }, // bas-droite
  { x: 50, y: 89 },   // bas
  { x: 17, y: 69.5 }, // bas-gauche
  { x: 17, y: 30.5 }, // haut-gauche
];

function FeatureHub({ hub }: { hub: { core: { title: string; sub: string }; aria: string; nodes: string[] } }) {
  return (
    <div className="feature-hub gs-reveal" role="img" aria-label={hub.aria}>
      <svg className="feature-hub-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {HUB_POS.map((p, i) => (
          <g key={i}>
            <line className="hub-link-base" x1="50" y1="50" x2={p.x} y2={p.y} />
            <line className="hub-link-flow" x1="50" y1="50" x2={p.x} y2={p.y} style={{ animationDelay: `${i * 0.4}s` }} />
          </g>
        ))}
      </svg>
      <div className="hub-core">
        <span className="hub-core-glow" aria-hidden="true" />
        <span className="hub-core-icon"><Flame size={26} /></span>
        <span className="hub-core-title">{hub.core.title}</span>
        <span className="hub-core-sub">{hub.core.sub}</span>
      </div>
      <div className="hub-nodes">
        {hub.nodes.map((label, i) => (
          <div key={label} className="hub-node" style={{ left: `${HUB_POS[i].x}%`, top: `${HUB_POS[i].y}%` }}>
            <span className="hub-node-icon">{FEATURE_ICONS[i]}</span>
            <span className="hub-node-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const COPY: Record<Lang, {
  nav: { loop: string; product: string; pricing: string; how: string; faq: string; login: string; start: string };
  hero: { before: string; em: string; after: string; sub: string; cta: string; cta2: string; noCard: string; truths: string[] };
  mock: { bar: string; calTitle: string; feedTitle: string; feed: { strong: string; rest: string; badge?: string }[] };
  loop: { title: string; sub: string; aria: string; returnLabel: string; steps: { title: string; desc: string }[] };
  features: { title: string; hub: { core: { title: string; sub: string }; aria: string; nodes: string[] }; items: { title: string; desc: string }[] };
  product: { title: string; sub: string; shots: { title: string; desc: string; points: string[]; alt: string }[] };
  networks: {
    title: string; sub: string; more: string; less: string;
    cols: { network: string; publish: string; metrics: string; import: string };
    val: { yes: string; partial: string; url: string; limited: string };
    details: Record<string, string>;
  };
  how: { title: string; steps: { title: string; desc: string }[] };
  pricing: {
    title: string; sub: string; trialNote: string; guarantee: string;
    plans: { name: string; price: string; per: string; tagline: string; cta: string; featured: boolean; features: string[] }[];
  };
  faq: { title: string; items: { q: string; a: string }[] };
  honest: { title: string; body: string; cta: string };
  footer: { tagline: string };
}> = {
  fr: {
    nav: { loop: 'La boucle', product: 'Le produit', pricing: 'Tarifs', how: 'Comment ça marche', faq: 'FAQ', login: 'Se connecter', start: 'Commencer' },
    hero: {
      before: 'Forgez la ', em: 'traction', after: 'de votre startup',
      sub: 'LaunchForge transforme votre plan de lancement en posts rédigés, adaptés et publiés sur LinkedIn, X, Instagram et YouTube — puis mesure ce qui marche et apprend de vos résultats. Vous gardez la main à chaque étape.',
      cta: 'Commencer gratuitement →', cta2: 'Voir le produit',
      noCard: 'Pas besoin de carte de crédit pour commencer',
      truths: ['15 jours en accès complet, sans carte', 'Offre gratuite pour toujours', 'Pilotable depuis Telegram'],
    },
    mock: {
      bar: 'LAUNCHFORGE — VOTRE AGENT TRAVAILLE',
      calTitle: 'Votre mois de contenu',
      feedTitle: "L'agent en action",
      feed: [
        { strong: 'Post LinkedIn rédigé', rest: ' — votre ton de marque', badge: 'jeu. 09:00' },
        { strong: 'Décliné', rest: ' pour X et Instagram', badge: 'IA' },
        { strong: 'Publié', rest: " à l'heure programmée", badge: 'auto' },
        { strong: 'Lead détecté', rest: ' dans les commentaires', badge: 'score 87' },
        { strong: 'Métriques relevées', rest: " — l'IA en tire les leçons" },
      ],
    },
    loop: {
      title: 'La boucle de la forge',
      sub: 'Chaque cycle rend le suivant meilleur : ce que vos posts vous apprennent retourne dans la matière première de l\'IA.',
      aria: 'Schéma : connaissances, rédaction IA, publication, métriques, enseignements — en boucle',
      returnLabel: 'les enseignements retournent à la forge',
      steps: [
        { title: 'Connaissances', desc: 'Votre entreprise, votre ton, vos offres — décrits une fois.' },
        { title: 'Rédaction IA', desc: 'Posts, visuels et déclinaisons par plateforme.' },
        { title: 'Publication', desc: 'Automatique ou validée par vous, à l\'heure dite.' },
        { title: 'Métriques', desc: 'Vues, likes, leads — relevés sur vos comptes.' },
        { title: 'Enseignements', desc: 'L\'analyse IA réinjecte ce qui marche dans la base.' },
      ],
    },
    features: {
      title: 'Tout l\'atelier, sous un même toit',
      hub: {
        core: { title: 'Forge IA', sub: 'Un seul cerveau, tout l\'atelier' },
        aria: 'Schéma : une IA centrale relie l\'onboarding, la publication, les séries, les métriques, les leads et le pilotage par chat.',
        nodes: ['Onboarding', 'Publication', 'Séries', 'Métriques', 'Leads', 'Chat & Telegram'],
      },
      items: [
        { title: 'Onboarding par IA', desc: 'Un chat vous interviewe, recherche votre entreprise sur le web, lit vos documents — et en tire un plan de lancement tactique, semaine par semaine.' },
        { title: 'Publication multi-plateformes', desc: 'Un post, plusieurs plateformes : le texte est adapté aux codes de chacune par l\'IA, publié automatiquement à l\'heure dite via vos comptes connectés.' },
        { title: 'Séries récurrentes', desc: 'Un post hebdomadaire réécrit à chaque occurrence par l\'IA — qui relit ce qu\'elle a déjà publié pour ne jamais se répéter. Testable avant activation.' },
        { title: 'Métriques & analyse', desc: 'Vues, likes, commentaires relevés automatiquement depuis vos comptes. Post-mortem IA de chaque post et comparaison du même contenu entre plateformes.' },
        { title: 'Détection de leads', desc: 'L\'IA lit les réactions de vos posts et votre boîte mail, repère les personnes intéressées, les score de 0 à 100 et rédige la relance.' },
        { title: 'Pilotage par chat', desc: 'Tout se commande en français, depuis l\'app ou Telegram : « publie ce post sur X et Instagram », « simule ma série », « bilan de la semaine ».' },
        { title: 'Import de vos anciens posts', desc: 'Rapatriez en un clic vos posts déjà publiés sur YouTube, Instagram, TikTok, Facebook, X… Ils rejoignent le Hub avec leurs métriques : l\'IA part de ce qui a déjà marché pour affûter vos prochains posts.' },
      ],
    },
    product: {
      title: 'Le produit, en vrai',
      sub: 'Pas de maquettes embellies : ces captures sortent de l\'application.',
      shots: [
        {
          title: 'Écrivez une fois, publiez partout',
          desc: 'Sélectionnez vos plateformes, écrivez (ou briefez l\'IA), et vérifiez le rendu exact dans des aperçus fidèles — LinkedIn, X, Instagram, Reddit, YouTube. À l\'enregistrement, chaque exemplaire est adapté aux codes de sa plateforme.',
          points: ['Aperçus fidèles par plateforme', 'Adaptation IA du texte par réseau', 'Images, GIF et vidéos jusqu\'à 3 Go'],
          alt: 'Éditeur de post LaunchForge : multiselect de plateformes, aperçu fidèle LinkedIn, panneaux IA',
        },
        {
          title: 'Votre mois de contenu, déjà rempli',
          desc: 'L\'IA génère des semaines de posts cohérents depuis votre plan de lancement. Vous relisez, ajustez, et le worker publie à l\'heure programmée — synchronisé avec votre Google Calendar.',
          points: ['Calendrier généré par l\'IA', 'Publication automatique opt-in', 'Synchro Google Calendar'],
          alt: 'Calendrier éditorial mensuel de LaunchForge avec posts programmés',
        },
        {
          title: 'Mesurez, comparez, apprenez',
          desc: 'Les métriques remontent toutes seules depuis vos comptes. Le même contenu publié sur plusieurs plateformes devient une expérience comparée — et chaque enseignement nourrit les prochaines générations.',
          points: ['Courbes d\'évolution et progression', 'Impact d\'un même post par plateforme', 'Rapport de campagne hebdo sur Telegram'],
          alt: 'Vue Performances de LaunchForge : graphiques d\'évolution et comparaison par plateforme',
        },
      ],
    },
    networks: {
      title: 'Les réseaux sociaux pris en charge',
      sub: 'Publiez, mesurez et importez votre historique — chaque réseau a ses règles, LaunchForge les gère pour vous.',
      more: 'Voir les particularités de chaque réseau',
      less: 'Masquer les détails',
      cols: { network: 'Réseau', publish: 'Publication', metrics: 'Métriques', import: 'Import historique' },
      val: { yes: 'Oui', partial: 'Partiel', url: 'Par URL', limited: 'Limité' },
      details: {
        linkedin: 'Publication de posts (texte + image) et lecture des réactions. L\'API LinkedIn n\'expose ni impressions ni commentaires pour un profil perso et ne permet pas de lister l\'historique — l\'import se fait à l\'unité via l\'URL du post.',
        twitter: 'Publication de posts ; métriques publiques complètes (vues, likes, réponses, reposts). L\'import de l\'historique est limité aux 7 derniers jours (limite de l\'API X).',
        instagram: 'Publication d\'images et de Reels (un média est requis) ; insights reach, likes et commentaires. Import de tout l\'historique sur un compte Business/Creator.',
        facebook: 'Publication sur une Page (l\'API Meta ne couvre pas les profils perso) ; likes, commentaires et partages. Import de tout l\'historique de la Page.',
        tiktok: 'Publication de vidéos et de posts photo ; vues, likes, commentaires et partages inclus. Import de toutes vos vidéos.',
        youtube: 'Mise en ligne de vidéos ; vues, likes et commentaires. Import de tout l\'historique de la chaîne.',
        reddit: 'Publication dans un subreddit (cible requise) ; score et nombre de commentaires (Reddit n\'expose pas les vues). Import de vos posts récents par auteur.',
      },
    },
    how: {
      title: 'Trois étapes, et la forge tourne',
      steps: [
        { title: 'Décrivez votre entreprise', desc: 'Un chat d\'onboarding qui fait les recherches à votre place, connecte vos réseaux et peut importer vos posts existants — entreprise établie ou simple idée.' },
        { title: 'Recevez plan et calendrier', desc: 'Plan de lancement semaine par semaine et premiers posts rédigés, datés, prêts à relire.' },
        { title: 'Publiez et apprenez', desc: 'Publication automatique ou validée, métriques relevées, leads détectés — et l\'IA s\'améliore avec vos résultats.' },
      ],
    },
    pricing: {
      title: 'Un prix simple, deux offres',
      sub: 'Commencez gratuitement. Passez à Brasier quand la forge tourne à plein régime.',
      trialNote: '15 jours d\'accès complet à Brasier offerts à l\'inscription — sans carte bancaire, puis bascule automatique sur Braise.',
      guarantee: 'Garantie 14 jours satisfait ou remboursé.',
      plans: [
        {
          name: 'Braise', price: '0 €', per: 'pour toujours', featured: false,
          tagline: 'Pour découvrir le moteur.',
          cta: 'Commencer gratuitement',
          features: [
            '1 projet',
            '30 générations de contenu IA / mois',
            '2 images IA / mois',
            'Plan de lancement IA, rédaction manuelle & calendrier',
            'Export & suppression RGPD en libre-service',
          ],
        },
        {
          name: 'Brasier', price: '12,90 €', per: '/ mois', featured: true,
          tagline: 'Facturé annuellement · ou 15,90 €/mois en mensuel.',
          cta: 'Passer à Brasier',
          features: [
            'Publication multi-plateformes & auto-publication',
            'Analytics complets + post-mortem IA',
            'Détection de leads & CRM',
            'Séries récurrentes & pilotage Telegram',
            '1000 générations + 50 images IA / mois (usage équitable)',
            'Support prioritaire',
          ],
        },
      ],
    },
    faq: {
      title: 'Questions directes, réponses directes',
      items: [
        { q: 'Combien ça coûte ?', a: 'Deux offres. Braise est gratuite pour toujours : 1 projet, 30 contenus IA et 2 images IA par mois, le plan de lancement et la rédaction manuelle. Brasier débloque la publication multi-plateformes, les analytics, la détection de leads, les séries récurrentes et Telegram — avec un usage IA généreux — pour 12,90 €/mois en annuel (ou 15,90 € en mensuel). Chaque inscription démarre par 15 jours d\'accès complet à Brasier, sans carte bancaire — puis bascule automatiquement sur Braise. Garantie 14 jours satisfait ou remboursé.' },
        { q: 'L\'IA peut-elle publier sans mon accord ?', a: 'Non. La publication automatique est un réglage opt-in, post par post. Par défaut, tout contenu attend votre validation — dans l\'app ou directement depuis Telegram.' },
        { q: 'Comment mes comptes sociaux sont-ils connectés ?', a: 'Par OAuth via Composio : vous autorisez chaque plateforme dans une fenêtre officielle (LinkedIn, Google…), et vous pouvez révoquer chaque connexion en un clic depuis la Configuration. LaunchForge ne voit jamais vos mots de passe.' },
        { q: 'Et mes données ?', a: 'Export complet en JSON et suppression définitive du compte en libre-service (RGPD art. 17 et 20), depuis la vue Configuration. Pas de cookies tiers, pas de revente de données.' },
        { q: 'Quelles plateformes sont couvertes ?', a: 'Publication automatique sur LinkedIn, X, Instagram et YouTube ; Reddit, Facebook et les autres via l\'assistant. Plus la détection de leads (commentaires + boîte mail) et la synchro Google Calendar.' },
      ],
    },
    honest: {
      title: 'Pas de faux avis ici',
      body: 'LaunchForge est un produit jeune. Plutôt que d\'inventer des témoignages cinq étoiles, on préfère vous montrer le vrai produit — et vous laisser juger. L\'offre Braise est gratuite pour toujours, l\'inscription ouvre 15 jours d\'accès complet sans carte bancaire, et vos données s\'exportent ou s\'effacent en deux clics, comme l\'exige le RGPD.',
      cta: 'Essayer et se faire son avis →',
    },
    footer: { tagline: 'Conçu pour les fondateurs qui exécutent.' },
  },

  en: {
    nav: { loop: 'The loop', product: 'The product', pricing: 'Pricing', how: 'How it works', faq: 'FAQ', login: 'Sign in', start: 'Get started' },
    hero: {
      before: 'Forge your startup\'s ', em: 'traction', after: '',
      sub: 'LaunchForge turns your launch plan into posts that are written, adapted and published on LinkedIn, X, Instagram and YouTube — then measures what works and learns from your results. You stay in control at every step.',
      cta: 'Start for free →', cta2: 'See the product',
      noCard: 'No credit card required to start',
      truths: ['15 days of full access, no card', 'Free plan, forever', 'Drive it from Telegram'],
    },
    mock: {
      bar: 'LAUNCHFORGE — YOUR AGENT AT WORK',
      calTitle: 'Your month of content',
      feedTitle: 'The agent in action',
      feed: [
        { strong: 'LinkedIn post written', rest: ' — in your brand voice', badge: 'Thu 09:00' },
        { strong: 'Adapted', rest: ' for X and Instagram', badge: 'AI' },
        { strong: 'Published', rest: ' right on schedule', badge: 'auto' },
        { strong: 'Lead detected', rest: ' in the comments', badge: 'score 87' },
        { strong: 'Metrics collected', rest: ' — the AI learns from them' },
      ],
    },
    loop: {
      title: 'The forge loop',
      sub: 'Every cycle makes the next one better: what your posts teach you goes back into the AI\'s raw material.',
      aria: 'Diagram: knowledge, AI writing, publishing, metrics, learnings — in a loop',
      returnLabel: 'learnings return to the forge',
      steps: [
        { title: 'Knowledge', desc: 'Your company, your voice, your offers — described once.' },
        { title: 'AI writing', desc: 'Posts, visuals and per-platform adaptations.' },
        { title: 'Publishing', desc: 'Automatic or approved by you, right on time.' },
        { title: 'Metrics', desc: 'Views, likes, leads — collected from your accounts.' },
        { title: 'Learnings', desc: 'AI analysis feeds what works back into the base.' },
      ],
    },
    features: {
      title: 'The whole workshop, under one roof',
      hub: {
        core: { title: 'AI Forge', sub: 'One brain, the whole workshop' },
        aria: 'Diagram: a central AI connects onboarding, publishing, series, metrics, leads and chat-first control.',
        nodes: ['Onboarding', 'Publishing', 'Series', 'Metrics', 'Leads', 'Chat & Telegram'],
      },
      items: [
        { title: 'AI onboarding', desc: 'A chat interviews you, researches your company on the web, reads your documents — and produces a tactical, week-by-week launch plan.' },
        { title: 'Multi-platform publishing', desc: 'One post, several platforms: the AI adapts the copy to each network\'s codes and publishes automatically through your connected accounts.' },
        { title: 'Recurring series', desc: 'A weekly post rewritten by the AI on every occurrence — it re-reads what it already published so it never repeats itself. Test it before turning it on.' },
        { title: 'Metrics & analysis', desc: 'Views, likes and comments collected automatically from your accounts. AI post-mortems and same-content comparison across platforms.' },
        { title: 'Lead detection', desc: 'The AI reads your posts\' reactions and your inbox, spots interested people, scores them 0–100 and drafts the follow-up.' },
        { title: 'Chat-first control', desc: 'Everything works in plain language, from the app or Telegram: "publish this on X and Instagram", "simulate my series", "this week\'s report".' },
        { title: 'Import your past posts', desc: 'Pull in your already-published posts from YouTube, Instagram, TikTok, Facebook, X… in one click. They land in the Hub with their metrics: the AI starts from what already worked to sharpen your next posts.' },
      ],
    },
    product: {
      title: 'The product, for real',
      sub: 'No polished mockups: these screenshots come straight from the app.',
      shots: [
        {
          title: 'Write once, publish everywhere',
          desc: 'Pick your platforms, write (or brief the AI), and check the exact rendering in faithful previews — LinkedIn, X, Instagram, Reddit, YouTube. On save, each copy is adapted to its platform\'s codes.',
          points: ['Faithful per-platform previews', 'AI copy adaptation per network', 'Images, GIFs and videos up to 3 GB'],
          alt: 'LaunchForge post editor: platform multiselect, faithful LinkedIn preview, AI panels',
        },
        {
          title: 'Your month of content, already filled',
          desc: 'The AI generates weeks of coherent posts from your launch plan. You review, tweak, and the worker publishes on schedule — synced with your Google Calendar.',
          points: ['AI-generated calendar', 'Opt-in auto-publishing', 'Google Calendar sync'],
          alt: 'LaunchForge monthly editorial calendar with scheduled posts',
        },
        {
          title: 'Measure, compare, learn',
          desc: 'Metrics flow in by themselves from your accounts. The same content published on several platforms becomes a controlled experiment — and every learning feeds the next generations.',
          points: ['Trend and progression charts', 'Same-post impact per platform', 'Weekly campaign report on Telegram'],
          alt: 'LaunchForge Performance view: trend charts and per-platform comparison',
        },
      ],
    },
    networks: {
      title: 'The supported social networks',
      sub: 'Publish, measure and import your history — each network has its own rules, LaunchForge handles them for you.',
      more: 'See each network\'s specifics',
      less: 'Hide details',
      cols: { network: 'Network', publish: 'Publishing', metrics: 'Metrics', import: 'History import' },
      val: { yes: 'Yes', partial: 'Partial', url: 'By URL', limited: 'Limited' },
      details: {
        linkedin: 'Publish posts (text + image) and read reactions. LinkedIn\'s API exposes neither impressions nor comments for a personal profile and can\'t list your history — import is done one post at a time via its URL.',
        twitter: 'Publish posts; full public metrics (views, likes, replies, reposts). History import is limited to the last 7 days (X API limit).',
        instagram: 'Publish images and Reels (media required); reach, likes and comments insights. Import your whole history on a Business/Creator account.',
        facebook: 'Publish to a Page (Meta\'s API doesn\'t cover personal profiles); likes, comments and shares. Import the Page\'s entire history.',
        tiktok: 'Publish videos and photo posts; views, likes, comments and shares included. Import all your videos.',
        youtube: 'Upload videos; views, likes and comments. Import your channel\'s entire history.',
        reddit: 'Publish to a subreddit (target required); score and comment count (Reddit doesn\'t expose views). Import your recent posts by author.',
      },
    },
    how: {
      title: 'Three steps, and the forge runs',
      steps: [
        { title: 'Describe your company', desc: 'An onboarding chat that does the research for you, connects your social accounts and can import your existing posts — existing business or just an idea.' },
        { title: 'Get a plan and a calendar', desc: 'A week-by-week launch plan and your first posts written, dated, ready to review.' },
        { title: 'Publish and learn', desc: 'Automatic or approved publishing, metrics collected, leads detected — and the AI improves with your results.' },
      ],
    },
    pricing: {
      title: 'Simple pricing, two plans',
      sub: 'Start for free. Move up to Brasier when the forge runs at full blast.',
      trialNote: '15 days of full Brasier access on sign-up — no credit card, then it automatically switches to Braise.',
      guarantee: '14-day money-back guarantee.',
      plans: [
        {
          name: 'Braise', price: '€0', per: 'forever', featured: false,
          tagline: 'To explore the engine.',
          cta: 'Start for free',
          features: [
            '1 project',
            '30 AI content generations / month',
            '2 AI images / month',
            'AI launch plan, manual writing & calendar',
            'Self-service GDPR export & deletion',
          ],
        },
        {
          name: 'Brasier', price: '€12.90', per: '/ month', featured: true,
          tagline: 'Billed annually · or €15.90/month monthly.',
          cta: 'Move up to Brasier',
          features: [
            'Multi-platform publishing & auto-publishing',
            'Full analytics + AI post-mortems',
            'Lead detection & CRM',
            'Recurring series & Telegram control',
            '1000 generations + 50 images / month (fair use)',
            'Priority support',
          ],
        },
      ],
    },
    faq: {
      title: 'Straight questions, straight answers',
      items: [
        { q: 'How much does it cost?', a: 'Two plans. Braise is free forever: 1 project, 30 AI contents and 2 AI images per month, the launch plan and manual writing. Brasier unlocks multi-platform publishing, analytics, lead detection, recurring series and Telegram — with generous AI usage — for €12.90/month billed annually (or €15.90 monthly). Every sign-up starts with 15 days of full Brasier access, no credit card — then automatically switches to Braise. 14-day money-back guarantee.' },
        { q: 'Can the AI publish without my approval?', a: 'No. Auto-publishing is an opt-in setting, per post. By default, every piece of content waits for your approval — in the app or straight from Telegram.' },
        { q: 'How are my social accounts connected?', a: 'Through OAuth via Composio: you authorize each platform in its official window (LinkedIn, Google…), and you can revoke any connection in one click from Settings. LaunchForge never sees your passwords.' },
        { q: 'What about my data?', a: 'Full JSON export and permanent account deletion, self-service (GDPR art. 17 & 20), from the Settings view. No third-party cookies, no data resale.' },
        { q: 'Which platforms are covered?', a: 'Automatic publishing on LinkedIn, X, Instagram and YouTube; Reddit, Facebook and others through the assistant. Plus lead detection (comments + inbox) and Google Calendar sync.' },
      ],
    },
    honest: {
      title: 'No fake reviews here',
      body: 'LaunchForge is a young product. Rather than inventing five-star testimonials, we\'d rather show you the real thing — and let you judge. The Braise plan is free forever, signing up opens 15 days of full access with no credit card, and your data can be exported or wiped in two clicks, as the GDPR requires.',
      cta: 'Try it and make up your own mind →',
    },
    footer: { tagline: 'Built for founders who ship.' },
  },
};

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
const FEED_ICONS = [
  <PenLine size={14} />, <RefreshCw size={14} />, <Send size={14} />,
  <Target size={14} />, <TrendingUp size={14} />,
];
const FEED_OK = [false, false, true, false, true];

function HeroMock({ c }: { c: (typeof COPY)['fr']['mock'] }) {
  return (
    <div className="hero-mock" id="hero-mock" aria-hidden="true">
      <div className="hero-mock-bar">
        <span className="hero-mock-dot" /><span className="hero-mock-dot" /><span className="hero-mock-dot" />
        <span className="hero-mock-title">{c.bar}</span>
      </div>
      <div className="hero-mock-body">
        <div className="hero-mock-cal">
          <div className="hero-mock-cal-title">{c.calTitle}</div>
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
          <div className="hero-mock-feed-title">{c.feedTitle}</div>
          {c.feed.map((f, i) => (
            <div key={f.strong} className="hero-mock-feed-item gs-feed">
              <span className={`hero-mock-feed-icon${FEED_OK[i] ? ' ok' : ''}`}>{FEED_ICONS[i]}</span>
              <span><strong>{f.strong}</strong>{f.rest}</span>
              {f.badge && <span className="hero-mock-feed-badge">{f.badge}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const SHOT_IMAGES = ['/landing/editeur.png', '/landing/calendrier.png', '/landing/performances.png'];

// Réseaux pris en charge — capacités (drapeaux non traduits, libellés via COPY).
//  publish: yes | media (média requis) | page (Page seulement) | sub (subreddit requis)
//  metrics: yes (complètes) | partial (limitées par l'API) | no
//  import : yes (historique complet) | limited (fenêtre/best-effort) | url (à l'unité) | no
const SOCIAL_NETWORKS: { slug: string; name: string; icon: ReactElement; publish: string; metrics: string; import: string }[] = [
  { slug: 'linkedin',  name: 'LinkedIn',    icon: <Briefcase size={18} />,      publish: 'yes',   metrics: 'partial', import: 'url' },
  { slug: 'twitter',   name: 'X / Twitter', icon: <MessageCircle size={18} />,  publish: 'yes',   metrics: 'yes',     import: 'limited' },
  { slug: 'instagram', name: 'Instagram',   icon: <Camera size={18} />,         publish: 'media', metrics: 'yes',     import: 'yes' },
  { slug: 'facebook',  name: 'Facebook',    icon: <Users size={18} />,          publish: 'page',  metrics: 'yes',     import: 'yes' },
  { slug: 'tiktok',    name: 'TikTok',      icon: <Music2 size={18} />,         publish: 'media', metrics: 'yes',     import: 'yes' },
  { slug: 'youtube',   name: 'YouTube',     icon: <Play size={18} />,           publish: 'media', metrics: 'yes',     import: 'yes' },
  { slug: 'reddit',    name: 'Reddit',      icon: <MessagesSquare size={18} />, publish: 'sub',   metrics: 'partial', import: 'limited' },
];

/** Rend une cellule de capacité du tableau des réseaux (Oui / Partiel / Par URL / —). */
function netCell(flag: string, val: { yes: string; partial: string; url: string; limited: string }): ReactElement {
  switch (flag) {
    case 'yes': case 'media': case 'page': case 'sub':
      return <span className="net-cell net-yes"><Check size={15} /> {val.yes}</span>;
    case 'partial':
      return <span className="net-cell net-partial">{val.partial}</span>;
    case 'limited':
      return <span className="net-cell net-partial">{val.limited}</span>;
    case 'url':
      return <span className="net-cell net-partial">{val.url}</span>;
    default:
      return <span className="net-cell net-no"><Minus size={14} /></span>;
  }
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const c = COPY[lang];
  const [showNetDetails, setShowNetDetails] = useState(false);

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
        .to({}, { duration: 2.2 })
        .to('.gs-feed', { opacity: 0, duration: 0.4, stagger: 0.04 })
        .to('.gs-cell', { opacity: 0, scale: 0.3, duration: 0.3, stagger: 0.02 }, '<');

      // ── La boucle de la forge ──
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
        gsap.fromTo(el.querySelectorAll('.gs-reveal'),
          { y: 34, opacity: 0 },
          {
            y: 0, opacity: 1, duration: 0.65, ease: 'power3.out', stagger: 0.1,
            // `once` : la révélation ne doit jamais être rejouée ni réinitialisée par
            // un refresh de ScrollTrigger (déclenché par le chargement différé des
            // captures plus bas), sinon les cartes restent bloquées invisibles.
            scrollTrigger: { trigger: el, start: 'top 78%', once: true },
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
  }, [lang]);

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
            <a href="#boucle">{c.nav.loop}</a>
            <a href="#produit">{c.nav.product}</a>
            <a href="#tarifs">{c.nav.pricing}</a>
            <a href="#how">{c.nav.how}</a>
            <a href="#faq">{c.nav.faq}</a>
            <LangSwitch />
            <Link to="/login" className="btn btn-ghost btn-sm">{c.nav.login}</Link>
            <Link to="/register" className="btn btn-primary btn-sm">{c.nav.start}</Link>
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
            {c.hero.before}<span className="hero-serif gradient-text">{c.hero.em}</span>
            {c.hero.after && <><br />{c.hero.after}</>}
          </h1>
          <p className="landing-hero-sub gs-up">{c.hero.sub}</p>
          <div className="landing-hero-cta gs-up">
            <Link to="/register" className="btn btn-primary btn-primary-glow btn-lg">{c.hero.cta}</Link>
            <a href="#produit" className="btn btn-ghost btn-lg">{c.hero.cta2}</a>
          </div>
          <p className="landing-hero-nocard gs-up"><CreditCard size={14} /> {c.hero.noCard}</p>
          <div className="hero-truths gs-up">
            <span><Flame size={13} /> {c.hero.truths[0]}</span>
            <span><ShieldCheck size={13} /> {c.hero.truths[1]}</span>
            <span><MessageSquare size={13} /> {c.hero.truths[2]}</span>
          </div>
        </div>
        <HeroMock c={c.mock} />
      </section>

      {/* ── La boucle de la forge ── */}
      <section className="landing-section gs-section" id="boucle">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.loop.title}</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>{c.loop.sub}</p>
          <div className="loop-flow" role="img" aria-label={c.loop.aria}>
            {c.loop.steps.map((s, i) => (
              <div key={s.title} className="loop-step-wrap">
                <div className="loop-step">
                  <span className="loop-step-icon">{LOOP_ICONS[i]}</span>
                  <span className="loop-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
                {i < c.loop.steps.length - 1 && <span className="loop-link" aria-hidden="true" />}
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
            <div className="loop-return-label">{c.loop.returnLabel}</div>
          </div>
        </div>
      </section>

      {/* ── Fonctionnalités ── */}
      <section className="landing-section gs-section" id="features">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.features.title}</h2>
          <div className="ember-line gs-reveal" />
          <FeatureHub hub={c.features.hub} />
          <div className="landing-features" style={{ marginTop: 28 }}>
            {c.features.items.map((f, i) => (
              <div key={f.title} className="landing-feature-card gs-reveal">
                <span className="landing-feature-icon">{FEATURE_ICONS[i]}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Le produit, en vrai ── */}
      <section className="landing-section landing-section-alt gs-section" id="produit">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.product.title}</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>{c.product.sub}</p>
          {c.product.shots.map((s, i) => (
            <div key={s.title} className={`shot-row${i % 2 === 1 ? ' reverse' : ''}`}>
              <div className="shot-text gs-reveal">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <ul>
                  {s.points.map((pt) => <li key={pt}><Flame size={12} /> {pt}</li>)}
                </ul>
              </div>
              <div className="shot-frame gs-reveal">
                <img src={SHOT_IMAGES[i]} alt={s.alt} loading="lazy" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Réseaux pris en charge ── */}
      <section className="landing-section gs-section" id="reseaux">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.networks.title}</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>{c.networks.sub}</p>

          <div className="landing-networks gs-reveal">
            <table className="landing-networks-table">
              <thead>
                <tr>
                  <th>{c.networks.cols.network}</th>
                  <th>{c.networks.cols.publish}</th>
                  <th>{c.networks.cols.metrics}</th>
                  <th>{c.networks.cols.import}</th>
                </tr>
              </thead>
              <tbody>
                {SOCIAL_NETWORKS.map((n) => (
                  <Fragment key={n.slug}>
                    <tr>
                      <td data-label={c.networks.cols.network}>
                        <span className="net-name"><span className="net-icon">{n.icon}</span>{n.name}</span>
                      </td>
                      <td data-label={c.networks.cols.publish}>{netCell(n.publish, c.networks.val)}</td>
                      <td data-label={c.networks.cols.metrics}>{netCell(n.metrics, c.networks.val)}</td>
                      <td data-label={c.networks.cols.import}>{netCell(n.import, c.networks.val)}</td>
                    </tr>
                    {showNetDetails && (
                      <tr className="net-detail-row">
                        <td colSpan={4}>
                          <span className="net-detail-name"><span className="net-icon">{n.icon}</span>{n.name}</span>
                          {(c.networks.details as Record<string, string>)[n.slug]}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>

            <button
              type="button"
              className="net-toggle"
              onClick={() => setShowNetDetails((v) => !v)}
              aria-expanded={showNetDetails}
            >
              {showNetDetails ? c.networks.less : c.networks.more}
              <ChevronDown size={16} className={`net-chevron${showNetDetails ? ' open' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Comment ça marche ── */}
      <section className="landing-section gs-section" id="how">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.how.title}</h2>
          <div className="ember-line gs-reveal" />
          <div className="landing-steps" style={{ marginTop: 44 }}>
            {c.how.steps.map((s, i) => (
              <div key={s.title} className="landing-step gs-reveal">
                <div className="landing-step-num">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tarifs ── */}
      <section className="landing-section landing-section-alt gs-section" id="tarifs">
        <div className="landing-section-inner">
          <h2 className="landing-section-title gs-reveal">{c.pricing.title}</h2>
          <div className="ember-line gs-reveal" />
          <p className="landing-section-sub gs-reveal" style={{ marginTop: 14 }}>{c.pricing.sub}</p>
          <div
            className="gs-reveal"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22, marginTop: 36, maxWidth: 820, marginInline: 'auto' }}
          >
            {c.pricing.plans.map((p) => (
              <div
                key={p.name}
                style={{
                  position: 'relative', borderRadius: 16, padding: '26px 24px',
                  border: p.featured ? '2px solid #ff6b35' : '1px solid rgba(255,255,255,0.12)',
                  background: p.featured ? 'rgba(255,107,53,0.06)' : 'rgba(255,255,255,0.02)',
                  boxShadow: p.featured ? '0 0 0 5px rgba(255,107,53,0.08)' : 'none',
                }}
              >
                {p.featured && (
                  <span style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#ff6b35', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                    POPULAIRE
                  </span>
                )}
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, margin: 0 }}>
                  <Flame size={18} style={{ color: p.featured ? '#ff6b35' : 'inherit' }} /> {p.name}
                </h3>
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 40, fontWeight: 800 }}>{p.price}</span>
                  <span style={{ opacity: 0.6, fontSize: 15 }}>{p.per}</span>
                </div>
                <p style={{ opacity: 0.7, fontSize: 14, marginTop: 6, minHeight: 38 }}>{p.tagline}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'grid', gap: 11 }}>
                  {p.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.45 }}>
                      <Flame size={13} style={{ color: '#ff6b35', flexShrink: 0, marginTop: 4 }} /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={`btn ${p.featured ? 'btn-primary btn-primary-glow' : 'btn-ghost'} btn-lg`}
                  style={{ width: '100%', marginTop: 22, justifyContent: 'center' }}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
          <div className="gs-reveal" style={{ textAlign: 'center', marginTop: 24, fontSize: 14, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <span><Sparkles size={14} style={{ verticalAlign: -2, color: '#ff6b35' }} /> {c.pricing.trialNote}</span>
            <span><ShieldCheck size={14} style={{ verticalAlign: -2, color: '#ff6b35' }} /> {c.pricing.guarantee}</span>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="landing-section gs-section" id="faq">
        <div className="landing-section-inner" style={{ maxWidth: 720 }}>
          <h2 className="landing-section-title gs-reveal">{c.faq.title}</h2>
          <div className="ember-line gs-reveal" />
          <div className="faq-list" style={{ marginTop: 40 }}>
            {c.faq.items.map((f) => (
              <details key={f.q} className="faq-item gs-reveal">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Honnêteté ── */}
      <section className="landing-section landing-section-alt gs-section">
        <div className="landing-section-inner">
          <div className="honest-card gs-reveal">
            <h2>{c.honest.title}</h2>
            <p>{c.honest.body}</p>
            <Link to="/register" className="btn btn-primary btn-primary-glow btn-lg">{c.honest.cta}</Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <p>
          {c.footer.tagline} &copy; 2026{' '}
          <strong style={{ color: 'var(--color-text)' }}>Launch<span className="logo-forge">Forge</span></strong>
        </p>
        <p style={{ marginTop: 6 }}>
          <a href="#boucle">{c.nav.loop}</a>
          {' · '}
          <a href="#produit">{c.nav.product}</a>
          {' · '}
          <a href="#tarifs">{c.nav.pricing}</a>
          {' · '}
          <Link to="/register">{c.nav.start}</Link>
          {' · '}
          <Link to="/legal">Mentions légales</Link>
          {' · '}
          <Link to="/privacy">{lang === 'fr' ? 'Confidentialité' : 'Privacy'}</Link>
        </p>
      </footer>
    </div>
  );
}
