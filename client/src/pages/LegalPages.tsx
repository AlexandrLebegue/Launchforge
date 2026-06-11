/**
 * Pages légales publiques : mentions légales + politique de confidentialité.
 * Les champs entre ⟦crochets⟧ sont à compléter au moment du déploiement
 * (forme juridique, adresse, hébergeur) — le reste décrit fidèlement les
 * traitements réels de l'application.
 */

import { Link } from 'react-router-dom';

const CONTACT_EMAIL = 'alexandrelebegue12@gmail.com';
const LAST_UPDATE = '11 juin 2026';

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="landing-logo">
          <span>Launch<span className="logo-forge">Forge</span></span>
        </Link>
      </header>
      <main className="legal-main">
        <h1>{title}</h1>
        <p className="legal-updated">Dernière mise à jour : {LAST_UPDATE}</p>
        {children}
      </main>
      <footer className="legal-footer">
        <Link to="/">Accueil</Link>
        {' · '}
        <Link to="/legal">Mentions légales</Link>
        {' · '}
        <Link to="/privacy">Confidentialité</Link>
      </footer>
    </div>
  );
}

export function LegalNoticePage() {
  return (
    <LegalShell title="Mentions légales">
      <h2>Éditeur du site</h2>
      <p>
        LaunchForge est édité par ⟦Alexandre Lebegue — forme juridique et SIREN à compléter⟧,
        ⟦adresse à compléter⟧.<br />
        Contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a><br />
        Directeur de la publication : Alexandre Lebegue.
      </p>

      <h2>Hébergement</h2>
      <p>
        Le site est hébergé par ⟦hébergeur à compléter au déploiement — ex. Hetzner Online GmbH,
        Industriestr. 25, 91710 Gunzenhausen, Allemagne⟧.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        La structure du site, sa charte graphique et ses contenus éditoriaux sont la propriété
        de l'éditeur. Les contenus que vous créez avec LaunchForge (posts, présentations,
        visuels, bases de connaissances) restent votre propriété exclusive.
      </p>

      <h2>Responsabilité</h2>
      <p>
        LaunchForge est un outil d'assistance : les contenus générés par intelligence
        artificielle doivent être relus avant publication. Vous restez seul responsable des
        contenus que vous publiez sur les plateformes tierces via vos comptes connectés, et du
        respect de leurs conditions d'utilisation.
      </p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Politique de confidentialité">
      <p>
        Cette politique décrit les données traitées par LaunchForge, pourquoi, et vos droits
        (Règlement général sur la protection des données — RGPD).
      </p>

      <h2>Responsable de traitement</h2>
      <p>
        ⟦Alexandre Lebegue⟧ — contact : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Données traitées et finalités</h2>
      <ul>
        <li><strong>Compte</strong> : email, nom, mot de passe (haché avec bcrypt — jamais stocké en clair). Finalité : authentification.</li>
        <li><strong>Contenus de travail</strong> : plans de lancement, posts, présentations, visuels, base de connaissances. Finalité : le service lui-même.</li>
        <li><strong>Contacts et prospects</strong> que vous importez ou que l'analyse détecte (nom, email, source, score d'intérêt). Finalité : votre suivi commercial. Vous êtes responsable de la licéité de la prospection menée avec ces données.</li>
        <li><strong>Métriques de publication</strong> (vues, likes, commentaires) relues depuis vos comptes connectés. Finalité : analyse de performance.</li>
        <li><strong>Liaison Telegram</strong> (identifiant de chat) si vous l'activez. Finalité : pilotage par chat et notifications.</li>
      </ul>

      <h2>Sous-traitants et destinataires</h2>
      <p>Les données ne sont jamais vendues. Elles transitent uniquement par les services nécessaires au fonctionnement :</p>
      <ul>
        <li><strong>OpenRouter</strong> (génération IA) : les contenus et le contexte que vous soumettez à la génération.</li>
        <li><strong>Composio</strong> (connexion de vos comptes LinkedIn, Gmail, etc.) : jetons OAuth et appels d'API vers les plateformes que vous connectez. Vous pouvez déconnecter chaque compte à tout moment depuis la vue Configuration.</li>
        <li><strong>Telegram</strong> si vous liez un chat.</li>
        <li>⟦Hébergeur à compléter⟧ : stockage des données.</li>
      </ul>

      <h2>Durées de conservation</h2>
      <ul>
        <li>Données de compte et contenus : tant que le compte est actif.</li>
        <li>Médias générés (GIF, vidéos) : purgés automatiquement après 90 jours.</li>
        <li>Jetons de réinitialisation de mot de passe : 30 minutes, usage unique.</li>
      </ul>

      <h2>Cookies et traceurs</h2>
      <p>
        LaunchForge n'utilise <strong>aucun cookie tiers ni traceur publicitaire</strong>.
        Seul un jeton de session est conservé dans le stockage local de votre navigateur
        pour vous garder connecté ; il disparaît à la déconnexion.
      </p>

      <h2>Vos droits</h2>
      <p>
        Vous disposez des droits d'accès, de rectification, d'effacement, de portabilité et
        d'opposition sur vos données. Écrivez à{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> — réponse sous 30 jours.
        Vous pouvez aussi saisir la CNIL (cnil.fr).
      </p>

      <h2>Sécurité</h2>
      <p>
        Mots de passe hachés (bcrypt), jetons de bot chiffrés au repos, isolation stricte des
        données entre utilisateurs, limitation du débit sur l'authentification.
      </p>
    </LegalShell>
  );
}
