import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Flame, LayoutDashboard, Megaphone, CalendarDays, MessageSquare,
  TrendingUp, BookOpen, ClipboardCheck, Settings, LogOut, HelpCircle,
  Compass, PenLine, Users, Shield, Gem, Target, Bot, BrainCircuit, X,
} from 'lucide-react';
import { User, setToken, getOverview, activatePlan, markTutorialSeen, ProjectSummary, getBillingStatus, BillingStatus } from '../api/client';
import { isAdminEmail } from '../utils/admin';
import LogoEmbers from './LogoEmbers';
import GuidedTour, { TourStep } from './GuidedTour';
import TutorialMenu, { TutorialMeta } from './TutorialMenu';

interface Props {
  user: User;
  onLogout: () => void;
  /** Appelé quand le tutoriel d'accueil est consommé — l'état App reflète alors
   *  tutorialPending=false (évite tout re-déclenchement au remontage de Layout). */
  onTutorialSeen: () => void;
  /** Profil mis à jour depuis la page Profil (nom/email/jeton) — remonté à App. */
  onUserUpdate: (user: User, token?: string) => void;
}

const navItems = [
  { to: '/',            icon: <LayoutDashboard size={17} />, label: 'Tableau de bord', tour: 'dashboard'   },
  { to: '/content',     icon: <Megaphone size={17} />,       label: 'Hub de contenu',  tour: 'content'     },
  { to: '/calendar',    icon: <CalendarDays size={17} />,    label: 'Calendrier',      tour: 'calendar'    },
  { to: '/assistant',   icon: <MessageSquare size={17} />,   label: 'Assistant',       tour: 'assistant'   },
  { to: '/automations', icon: <Bot size={17} />,             label: 'Automatisations', tour: 'automations' },
  { to: '/performance', icon: <TrendingUp size={17} />,      label: 'Performances',    tour: 'performance' },
  { to: '/crm',         icon: <Target size={17} />,          label: 'CRM',             tour: 'crm'         },
  { to: '/knowledge',   icon: <BookOpen size={17} />,        label: 'Connaissances',   tour: 'knowledge'   },
  { to: '/approvals',   icon: <ClipboardCheck size={17} />,  label: 'Validations',     tour: 'approvals'   },
  { to: '/teams',       icon: <Users size={17} />,           label: 'Équipes',         tour: 'teams'       },
  { to: '/config',      icon: <Settings size={17} />,        label: 'Configuration',   tour: 'config'      },
];

/** Un tutoriel = un parcours guidé ciblant un module. `route` est ouverte avant
 *  de lancer le parcours ; `sidebar` force l'ouverture de la barre latérale
 *  (pour les pas qui pointent ses éléments). */
interface Tutorial extends TutorialMeta {
  route?: string;
  sidebar?: boolean;
  steps: TourStep[];
}

const TUTORIALS: Tutorial[] = [
  // ── Découverte générale du site (lancé aussi à la première visite) ──
  {
    id: 'site',
    title: 'Découverte du site',
    description: 'Tour rapide de toutes les sections de l\'application.',
    icon: <Compass size={18} />,
    route: '/',
    sidebar: true,
    steps: [
      {
        title: 'Bienvenue sur LaunchForge 🔥',
        body: (
          <>LaunchForge transforme votre entreprise en <strong>posts prêts à publier</strong> : l'IA
            rédige, vous validez, ça se publie sur vos réseaux, puis les résultats reviennent nourrir
            l'IA. En 1 minute, voici comment tout s'articule.</>
        ),
      },
      { target: '[data-tour="nav-dashboard"]', title: 'Tableau de bord', body: <>La vue d'ensemble de votre projet : chiffres clés, prochaine publication, objectifs et phases de lancement.</> },
      { target: '[data-tour="nav-content"]', title: 'Hub de contenu', body: <>Le cœur de l'app. Rédigez vos posts (ou laissez l'IA le faire), ajoutez images/vidéos, programmez-les et générez un calendrier éditorial complet.</> },
      { target: '[data-tour="nav-calendar"]', title: 'Calendrier', body: <>Tous vos posts programmés sur une frise chronologique — pour visualiser et ajuster votre cadence.</> },
      { target: '[data-tour="nav-assistant"]', title: 'Assistant', body: <>Un chat IA qui cherche des idées, fait des recherches web et rédige avec vous, en s'appuyant sur votre base de connaissances.</> },
      { target: '[data-tour="nav-performance"]', title: 'Performances', body: <>Les métriques réelles de vos posts publiés (vues, likes, commentaires) synchronisées depuis vos comptes.</> },
      { target: '[data-tour="nav-knowledge"]', title: 'Connaissances', body: <>Le carburant de l'IA : entreprise, ton, offres, audience. Plus c'est riche, meilleurs sont les posts générés.</> },
      { target: '[data-tour="nav-approvals"]', title: 'Validations', body: <>Les contenus proposés par l'IA atterrissent ici. Vous relisez, ajustez, puis approuvez avant publication.</> },
      { target: '[data-tour="nav-config"]', title: 'Configuration', body: <>Connectez vos comptes (X, LinkedIn, Reddit, Instagram…) et réglez la publication automatique et la synchro des métriques.</> },
      { target: '[data-tour="project"]', title: 'Vos projets', body: <>Chaque projet a ses propres posts, connaissances et réglages. Changez de projet ou créez-en un nouveau ici.</> },
      {
        title: 'À vous de jouer !',
        body: (
          <>Votre premier projet est créé 🎉 Direction le <strong>Hub de contenu</strong> pour
            retrouver les posts générés par l'IA, puis connectez vos comptes dans
            <strong> Configuration</strong> pour publier. Besoin d'aide sur un module précis ?
            Rouvrez <strong>« Tutoriels »</strong> en bas de la barre latérale.</>
        ),
      },
    ],
  },

  // ── Le Hub de contenu ──
  {
    id: 'hub',
    title: 'Le Hub de contenu',
    description: 'Créer, planifier et générer vos posts.',
    icon: <Megaphone size={18} />,
    route: '/content',
    steps: [
      { title: 'Le Hub de contenu', body: <>C'est ici que vit tout votre contenu. Voyons les trois façons de créer des posts, et comment les retrouver.</> },
      { target: '[data-tour="hub-new"]', title: 'Créer un post', body: <>Ouvre l'éditeur pour rédiger un post à la main (ou avec l'aide de l'IA). Un tutoriel dédié détaille chaque champ.</> },
      { target: '[data-tour="hub-assistant"]', title: 'Assistant IA', body: <>Un chat qui trouve des idées, fait des recherches web, rédige et enregistre directement vos posts.</> },
      { target: '[data-tour="hub-calendar"]', title: 'Générer un calendrier', body: <>L'IA rédige et programme plusieurs semaines de posts d'un coup, d'après votre plan et vos connaissances.</> },
      { target: '[data-tour="hub-tabs"]', title: 'Posts & Slides', body: <>Basculez entre vos posts et vos présentations (slides) générées par l'IA, attachables à un post.</> },
      { target: '[data-tour="hub-filters"]', title: 'Rechercher & filtrer', body: <>Retrouvez un post par texte, statut ou plateforme. La liste juste en dessous regroupe tout votre contenu.</> },
      { title: 'Astuce', body: <>Pour comprendre l'éditeur de post en profondeur, lancez le tutoriel <strong>« Créer un post : les champs »</strong>.</> },
    ],
  },

  // ── L'éditeur de post (ouvre un nouveau post pour montrer les champs) ──
  {
    id: 'post',
    title: 'Créer un post : les champs',
    description: 'Comprendre chaque champ de l\'éditeur de post.',
    icon: <PenLine size={18} />,
    route: '/content?tutorial=post',
    steps: [
      { title: 'L\'éditeur de post', body: <>On vient d'ouvrir un nouveau post. Parcourons ses champs un par un — rien n'est enregistré tant que vous ne le décidez pas.</> },
      { target: '[data-tour="pe-platforms"]', title: 'Plateformes', body: <>Choisissez où publier. La première sélectionnée est la plateforme <strong>principale</strong> ; les suivantes créent des <strong>déclinaisons</strong> adaptées par l'IA.</> },
      { target: '[data-tour="pe-content"]', title: 'Contenu', body: <>Le statut (idée, brouillon, programmé, publié), un titre interne, et surtout le <strong>texte du post</strong>. Pour Reddit, un champ subreddit apparaît ici.</> },
      { target: '[data-tour="pe-media"]', title: 'Média', body: <>Joignez une image, un GIF ou une vidéo. Obligatoire pour Instagram. Vous pouvez téléverser un fichier, coller une URL, ou en générer un par IA.</> },
      { target: '[data-tour="pe-schedule"]', title: 'Planification', body: <>Datez le post, choisissez une récurrence, et activez la <strong>publication automatique</strong> pour qu'il parte tout seul à l'heure dite.</> },
      { target: '[data-tour="pe-ai"]', title: 'Rédaction par l\'IA', body: <>Donnez un brief : l'IA rédige le post à partir de votre base de connaissances et l'écrit directement dans le champ texte.</> },
      { target: '[data-tour="pe-preview"]', title: 'Aperçu en direct', body: <>Voyez le rendu réel par plateforme, au fil de la frappe — pour vérifier avant de publier.</> },
      { target: '[data-tour="pe-publish"]', title: 'Enregistrer ou publier', body: <>Enregistrez en brouillon, ou <strong>publiez immédiatement</strong> sur vos comptes connectés. Un résultat s'affiche par plateforme.</> },
      { title: 'C\'est tout !', body: <>Fermez l'éditeur quand vous voulez ; vos posts apparaissent dans la liste du Hub. Pensez à connecter vos comptes (tutoriel « Connecter vos comptes »).</> },
    ],
  },

  // ── Le Calendrier ──
  {
    id: 'calendar',
    title: 'Le Calendrier',
    description: 'Visualiser et planifier vos publications dans le temps.',
    icon: <CalendarDays size={18} />,
    route: '/calendar',
    steps: [
      { title: 'Le Calendrier', body: <>Une vue mensuelle de tout votre planning : posts programmés, brouillons datés et publications passées.</> },
      { target: '[data-tour="cal-grid"]', title: 'La grille du mois', body: <>Chaque pastille est un post (la couleur indique le statut). Cliquez un jour vide pour créer un post pré-daté, ou une pastille pour l'ouvrir.</> },
      { target: '[data-tour="cal-new"]', title: 'Nouveau post', body: <>Crée un post directement depuis le calendrier — vous ajustez la date dans l'éditeur.</> },
      { target: '[data-tour="cal-sync"]', title: 'Google Calendar', body: <>Reportez vos posts programmés dans votre agenda Google (compte à connecter dans Configuration).</> },
    ],
  },

  // ── La base de connaissances ──
  {
    id: 'knowledge',
    title: 'La base de connaissances',
    description: 'Nourrir l\'IA : entreprise, ton, offres, audience.',
    icon: <BookOpen size={18} />,
    route: '/knowledge',
    steps: [
      { title: 'La base de connaissances', body: <>C'est le <strong>carburant de l'IA</strong> : tout ce qu'elle doit savoir sur vous. Écrit une fois, réutilisé dans tous les posts et agents.</> },
      { target: '[data-tour="kb-new"]', title: 'Créer une fiche', body: <>Commencez par trois fiches : proposition de valeur (Produit), client idéal (Audience), ton de marque (Ton & style).</> },
      { target: '[data-tour="kb-cats"]', title: 'Catégories & recherche', body: <>Vos fiches sont rangées par thème (Entreprise, Produit, Offres, Enseignements, Veille…). Filtrez ou recherchez ici.</> },
      { target: '[data-tour="kb-tabs"]', title: 'Fiches & Contacts', body: <>L'onglet Contacts regroupe vos prospects et clients, détectés et scorés par l'IA depuis vos commentaires et emails.</> },
      { title: 'Plus c\'est riche, mieux c\'est', body: <>Chaque fiche améliore directement la qualité des posts générés. L'analyse des performances y ajoute aussi des « Enseignements ».</> },
    ],
  },

  // ── L'Assistant ──
  {
    id: 'assistant',
    title: 'L\'Assistant',
    description: 'Piloter tout LaunchForge en discutant.',
    icon: <MessageSquare size={18} />,
    route: '/assistant',
    steps: [
      { title: 'L\'Assistant', body: <>Un chat qui pilote toute l'app : il fait le point sur le projet, rédige et publie des posts, lit et envoie des emails, gère l'agenda, valide des contenus et cherche sur le web.</> },
      { target: '[data-tour="asst-suggestions"]', title: 'Idées rapides', body: <>Des raccourcis pour démarrer : « Où en est-on ? », « Rédiger un post », « Lire mes mails »… Cliquez pour lancer.</> },
      { target: '[data-tour="asst-input"]', title: 'Demandez en langage naturel', body: <>Écrivez votre demande comme à un humain. Entrée pour envoyer, Maj+Entrée pour un retour à la ligne.</> },
      { target: '[data-tour="asst-reset"]', title: 'Nouvelle conversation', body: <>Repartez de zéro quand vous changez de sujet.</> },
    ],
  },

  // ── Les Validations ──
  {
    id: 'approvals',
    title: 'Les Validations',
    description: 'Relire et approuver les contenus proposés par l\'IA.',
    icon: <ClipboardCheck size={18} />,
    route: '/approvals',
    steps: [
      { title: 'Les Validations', body: <>Quand l'IA prépare un contenu en mode « validation », il atterrit ici pour votre relecture avant publication — vous gardez la main.</> },
      { target: '[data-tour="appr-card"]', title: 'Le contenu proposé', body: <>Chaque carte montre le contenu rédigé par un agent. Vous pouvez le <strong>modifier directement</strong> avant de l'approuver.</> },
      { target: '[data-tour="appr-actions"]', title: 'Valider ou rejeter', body: <>« Valider et publier » envoie le contenu (édité si besoin) ; « Rejeter » le refuse avec un motif.</> },
      { target: '[data-tour="appr-history"]', title: 'Historique des envois', body: <>La trace exacte de ce qui est parti : lien publié, échec ou rejet — pour chaque contenu traité.</> },
      { title: 'Validation ou automatique ?', body: <>Le passage par cette page dépend du mode de publication choisi dans Configuration (relecture ou publication directe).</> },
    ],
  },

  // ── Les Performances ──
  {
    id: 'performance',
    title: 'Les Performances',
    description: 'Lire vos métriques et savoir quoi améliorer.',
    icon: <TrendingUp size={18} />,
    route: '/performance',
    steps: [
      { title: 'Les Performances', body: <>Vos chiffres dans le temps et l'analyse IA — pour voir ce qui marche et quoi refaire.</> },
      { target: '[data-tour="perf-analytics"]', title: 'Vos courbes', body: <>Vues et likes par semaine, progression relative, et croissance cumulée au fil des synchronisations.</> },
      { target: '[data-tour="perf-report"]', title: 'Rapport de campagne IA', body: <>L'IA lit vos chiffres et vous dit ce qui marche, ce qui cale, et quoi faire cette semaine.</> },
      { target: '[data-tour="perf-table"]', title: 'Détail par post', body: <>Le détail de chaque post publié, trié par engagement. Cliquez-en un pour l'ouvrir et lancer son analyse.</> },
      { title: 'D\'où viennent les chiffres ?', body: <>Des métriques synchronisées depuis vos comptes connectés (fréquence réglable dans Configuration), ou saisies à la main.</> },
    ],
  },

  // ── Configuration / connexions ──
  {
    id: 'config',
    title: 'Connecter vos comptes & publier',
    description: 'Brancher X, LinkedIn, Reddit… et régler l\'automatisation.',
    icon: <Settings size={18} />,
    route: '/config',
    steps: [
      { title: 'Configuration', body: <>Pour publier depuis l'app et lire vos métriques, il faut connecter vos réseaux. Voyons l'essentiel.</> },
      { target: '[data-tour="cfg-accounts"]', title: 'Connexions plateformes', body: <>Connectez X, LinkedIn, Reddit, Instagram… en un clic (OAuth via Composio). Un compte « Fonctionnel » peut publier et être mesuré.</> },
      { target: '[data-tour="cfg-publish"]', title: 'Publication des contenus IA', body: <>Choisissez si les contenus rédigés par l'IA passent par vos <strong>Validations</strong> (recommandé) ou sont publiés directement.</> },
      { target: '[data-tour="cfg-metrics"]', title: 'Synchro des métriques', body: <>Réglez la fréquence à laquelle l'app relit automatiquement les vues, likes et commentaires de vos posts publiés.</> },
      { title: 'Prêt à publier', body: <>Une fois vos comptes connectés, vos posts partent directement depuis LaunchForge et leurs résultats remontent dans Performances.</> },
    ],
  },
];

/** Métadonnées seules (pour le menu) */
const TUTORIAL_META: TutorialMeta[] = TUTORIALS.map(({ id, title, description, icon }) => ({ id, title, description, icon }));

export default function Layout({ user, onLogout, onTutorialSeen, onUserUpdate }: Props) {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  // Pub Brasier PLUS (Claude Opus) — masquable, mémorisé par navigateur
  const [plusPromoDismissed, setPlusPromoDismissed] = useState(
    () => localStorage.getItem('lf_plus_promo_dismissed') === '1',
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSteps, setActiveSteps] = useState<TourStep[] | null>(null);

  // Lance un tutoriel : ouvre la bonne page, ajuste la barre latérale, démarre le parcours
  const startTutorial = useCallback((id: string) => {
    const tut = TUTORIALS.find((t) => t.id === id);
    if (!tut) return;
    setMenuOpen(false);
    setSidebarOpen(Boolean(tut.sidebar)); // les pas « site » pointent la barre latérale
    if (tut.route) navigate(tut.route);
    setActiveSteps(tut.steps);
  }, [navigate]);

  const closeTour = useCallback(() => {
    setActiveSteps(null);
    if (window.innerWidth <= 900) setSidebarOpen(false);
  }, []);

  // Tutoriel d'accueil : montré UNE fois, juste après la création du 1er projet.
  // `tutorialPending` est posé à la création du compte (serveur) puis consommé
  // ici — il est donc lié au COMPTE, survit aux changements d'appareil/navigateur
  // et ne se redéclenche pas aux connexions suivantes (Google incluse). On attend
  // que l'utilisateur ait créé SON propre projet (projet personnel, sans équipe) :
  // un compte neuf (0 projet) ne le voit pas, et rejoindre une équipe — dont on ne
  // fait qu'accéder aux projets — ne suffit pas à le déclencher. La consommation
  // est persistée côté serveur (markTutorialSeen) ET reflétée dans l'état App
  // (onTutorialSeen) ; le ref couvre la session/le montage courant.
  // ≥ 1 projet personnel (créé par l'utilisateur, sans équipe). Booléen stable :
  // bascule une seule fois (false→true) et sert de dépendance — éviter de dépendre
  // du tableau `projects` (nouvelle référence à chaque rafraîchissement, ce qui
  // annulerait le minuteur avant son déclenchement).
  const hasOwnProject = projects.some((p) => !p.teamId);
  const autoTourStarted = useRef(false);
  useEffect(() => {
    if (autoTourStarted.current) return;
    if (!user.tutorialPending) return;
    if (!hasOwnProject) return;
    autoTourStarted.current = true;
    // Consommation (serveur + état App) DANS le minuteur : au lancement réel du
    // tutoriel. La faire avant changerait `user.tutorialPending` (une dépendance)
    // et le nettoyage de l'effet annulerait le minuteur avant les 700 ms.
    const t = setTimeout(() => {
      startTutorial('site');
      markTutorialSeen().catch(() => { /* best-effort : ref + état App gardent la session propre */ });
      onTutorialSeen();
    }, 700);
    return () => clearTimeout(t);
  }, [user.tutorialPending, hasOwnProject, startTutorial, onTutorialSeen]);

  // UNE requête légère pour tout le shell (projets + badge validations),
  // partagée avec le tableau de bord via le cache du client API.
  const loadOverview = useCallback(() => {
    getOverview().then((res) => {
      if (res.success && res.data) {
        setProjects(res.data.projects);
        setPendingApprovals(res.data.approvals);
      }
    });
  }, []);

  // Rafraîchie à chaque navigation (servie par le cache si < 5 s) + toutes les 30 s
  useEffect(() => {
    loadOverview();
    const timer = setInterval(loadOverview, 30000);
    return () => clearInterval(timer);
  }, [loadOverview, location.pathname]);

  // État d'abonnement (badge essai / pastille upgrade) — rafraîchi à la navigation
  useEffect(() => {
    getBillingStatus().then((res) => { if (res.success && res.data) setBilling(res.data); });
  }, [location.pathname]);

  const activeProject = projects.find((p) => p.active) ?? projects[0];

  const handleSelectProject = async (plan: ProjectSummary) => {
    setPickerOpen(false);
    closeSidebar();
    if (plan.active) {
      // Projet déjà actif : le tableau de bord EST sa vue d'ensemble
      navigate('/');
      return;
    }
    setSwitching(plan.id);
    await activatePlan(plan.id);
    // Changement de contexte : TOUTES les vues (dashboard, hub, connaissances,
    // validations, configuration) sont propres au projet — rechargement complet
    // pour repartir sur des données fraîches.
    window.location.href = '/';
  };

  const handleLogout = () => {
    setToken(null);
    onLogout();
    setSidebarOpen(false);
  };

  const closeSidebar = () => setSidebarOpen(false);

  // Avatar: first letter of name or email
  const avatarLetter = (user.name || user.email).charAt(0).toUpperCase();
  // Short display name: part before @
  const displayName  = user.name || user.email.split('@')[0];

  return (
    <div className="layout-root">
      {/* ── Mobile hamburger ── */}
      <button
        className={`layout-hamburger${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen((o) => !o)}
        aria-label="Toggle navigation"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>

      {/* ── Overlay (mobile) ── */}
      <div
        className={`layout-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={closeSidebar}
      />

      {/* ── Sidebar ── */}
      <aside className={`layout-sidebar${sidebarOpen ? ' open' : ''}`}>
        {/* Logo */}
        <Link to="/" className="layout-sidebar-logo" onClick={closeSidebar}>
          <span className="layout-sidebar-logo-icon"><Flame size={21} /></span>
          <span>Launch<span className="logo-forge">Forge</span></span>
          <LogoEmbers />
        </Link>

        {/* Nav items */}
        <nav className="layout-nav" aria-label="Main navigation">
          <span className="layout-nav-section">Menu</span>

          {navItems.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);

            return (
              <Link
                key={item.to}
                to={item.to}
                data-tour={`nav-${item.tour}`}
                className={`layout-nav-item${isActive ? ' active' : ''}`}
                onClick={closeSidebar}
              >
                <span className="layout-nav-icon">{item.icon}</span>
                {item.label}
                {item.to === '/approvals' && pendingApprovals > 0 && (
                  <span className="layout-nav-badge">{pendingApprovals}</span>
                )}
              </Link>
            );
          })}

          <span className="layout-nav-section" style={{ marginTop: 18 }}>Projet</span>

          {/* Sélecteur de projet : un seul bouton, le projet actif. Cliquer
              ouvre la liste pour changer de projet ou en créer un nouveau. */}
          {activeProject ? (
            <div className="layout-project-picker" data-tour="project">
              <button
                className={`layout-nav-item layout-project${pickerOpen ? ' active' : ''}`}
                onClick={() => setPickerOpen((o) => !o)}
                title="Projet de travail courant — cliquer pour changer de projet"
              >
                <span className="layout-nav-icon project-initial">{activeProject.productName.charAt(0).toUpperCase()}</span>
                <span className="layout-project-name">{activeProject.productName}</span>
                <span className="layout-project-dot" title="Projet actif" />
                <span className="layout-project-chevron">{pickerOpen ? '▴' : '▾'}</span>
              </button>

              {pickerOpen && (
                <div className="layout-project-menu">
                  {projects.map((plan) => (
                    <button
                      key={plan.id}
                      className={`layout-nav-item layout-project${plan.active ? ' active' : ''}`}
                      onClick={() => handleSelectProject(plan)}
                      title={plan.active ? 'Projet actif — tableau de bord' : 'Basculer sur ce projet'}
                    >
                      <span className="layout-nav-icon project-initial">{plan.productName.charAt(0).toUpperCase()}</span>
                      <span className="layout-project-text">
                        <span className="layout-project-name">{plan.productName}</span>
                        {plan.teamId && (
                          <span className="layout-project-team">
                            <Users size={11} /> {plan.teamName}{plan.role && plan.role !== 'owner' ? ` · ${plan.role === 'viewer' ? 'lecteur' : 'éditeur'}` : ''}
                          </span>
                        )}
                      </span>
                      {switching === plan.id
                        ? <span className="layout-project-dot loading">⏳</span>
                        : Boolean(plan.active) && <span className="layout-project-dot" title="Projet actif" />}
                    </button>
                  ))}
                  <Link to="/new" className="layout-nav-item layout-project-new" onClick={() => { setPickerOpen(false); closeSidebar(); }}>
                    <span className="layout-nav-icon">＋</span>
                    Nouveau projet
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <Link to="/new" className="layout-nav-item layout-project-new" data-tour="project" onClick={closeSidebar}>
              <span className="layout-nav-icon">＋</span>
              Nouveau projet
            </Link>
          )}
        </nav>

        {/* Footer: user info + logout */}
        <div className="layout-sidebar-footer">
          <NavLink
            to="/profile"
            className={({ isActive }) => `layout-user-card${isActive ? ' active' : ''}`}
            onClick={closeSidebar}
            title="Mon profil — informations du compte et données personnelles"
          >
            <div className="layout-user-avatar">{avatarLetter}</div>
            <div className="layout-user-info">
              <div className="layout-user-name">{displayName}</div>
              <div className="layout-user-role">Voir mon profil</div>
            </div>
          </NavLink>

          <Link
            to="/billing"
            className={`layout-nav-item${location.pathname.startsWith('/billing') ? ' active' : ''}`}
            onClick={closeSidebar}
            title="Abonnement & facturation"
          >
            <span className="layout-nav-icon"><Gem size={17} /></span>
            Abonnement
            {billing?.trial.active && (
              <span className="layout-nav-badge" title="Essai en cours">{billing.trial.daysLeft}j</span>
            )}
            {billing && !billing.trial.active && billing.tier === 'braise' && (
              <span className="layout-nav-badge" style={{ background: '#ff6b35' }} title="Passer à Brasier">↑</span>
            )}
          </Link>

          {isAdminEmail(user.email) && (
            <Link
              to="/admin"
              className={`layout-nav-item${location.pathname.startsWith('/admin') ? ' active' : ''}`}
              onClick={closeSidebar}
              title="Panneau d'administration fondateur"
            >
              <span className="layout-nav-icon"><Shield size={17} /></span>
              Administration
            </Link>
          )}

          <button
            className="layout-nav-item"
            onClick={() => { closeSidebar(); setMenuOpen(true); }}
            title="Tutoriels guidés — choisissez un module à découvrir"
          >
            <span className="layout-nav-icon"><HelpCircle size={17} /></span>
            Tutoriels
          </button>

          <button
            className="layout-nav-item"
            onClick={handleLogout}
          >
            <span className="layout-nav-icon"><LogOut size={17} /></span>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="layout-main">
        {/* Pub Brasier PLUS : visible tant que l'utilisateur n'a pas l'IA premium */}
        {billing && billing.tier !== 'plus' && !plusPromoDismissed && !location.pathname.startsWith('/billing') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            margin: '12px 16px 0', padding: '10px 14px', borderRadius: 12, fontSize: 13.5,
            background: 'linear-gradient(90deg, rgba(167,139,250,0.16), rgba(167,139,250,0.06))',
            border: '1px solid rgba(167,139,250,0.45)',
          }}>
            <BrainCircuit size={17} style={{ color: '#a78bfa', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 220 }}>
              <strong>Nouveau — Brasier PLUS</strong> : votre assistant, vos posts et vos e-mails de vente
              propulsés par <strong>Claude Opus 4.8</strong>, l'IA d'Anthropic à l'état de l'art.
            </span>
            <Link to="/billing" className="btn btn-sm" style={{ background: '#a78bfa', color: '#1a1030', fontWeight: 700, borderRadius: 8, padding: '5px 12px', textDecoration: 'none' }}>
              Découvrir ⚡
            </Link>
            <button
              onClick={() => { localStorage.setItem('lf_plus_promo_dismissed', '1'); setPlusPromoDismissed(true); }}
              title="Masquer"
              style={{ background: 'none', border: 0, color: 'inherit', opacity: 0.55, cursor: 'pointer', padding: 4, display: 'flex' }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {/* Contexte partagé avec les pages enfants (ex. Profil : utilisateur
            courant + remontée des modifications de compte vers App). */}
        <Outlet context={{ user, onUserUpdate }} />
      </main>

      {/* ── Tutoriels : menu de sélection + parcours guidé ── */}
      {menuOpen && (
        <TutorialMenu tutorials={TUTORIAL_META} onPick={startTutorial} onClose={() => setMenuOpen(false)} />
      )}
      {activeSteps && <GuidedTour steps={activeSteps} onClose={closeTour} />}

    </div>
  );
}
