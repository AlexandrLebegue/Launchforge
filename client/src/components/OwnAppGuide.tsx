import { useState } from 'react';
import { ChevronRight, ExternalLink, BookOpen } from 'lucide-react';

/**
 * Tutoriel « créer son app développeur » pour les toolkits en mode app perso
 * (NEEDS_OWN_APP). Bloc dépliable, sans captures hébergées : étapes rédigées +
 * liens profonds vers la doc/portail officiels. Rendu sous le formulaire
 * d'identifiants (Client ID / Client Secret) — partagé entre la Configuration
 * et l'étape de connexion de l'onboarding.
 *
 * Ajouter un toolkit = une entrée dans GUIDES ; le composant renvoie null pour
 * les slugs sans tuto, donc on peut l'afficher sans condition.
 */

interface GuideStep {
  title: string;
  body: React.ReactNode;
}

interface Guide {
  /** Phrase d'accroche au-dessus des étapes */
  intro: string;
  steps: GuideStep[];
  /** Liens « pour aller plus loin » sous les étapes */
  links: { label: string; url: string }[];
}

const AZURE_APPS_URL =
  'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade';

const GUIDES: Record<string, Guide> = {
  outlook: {
    intro:
      "Microsoft n'a pas d'accès « clé en main » via Composio : créez en ~5 min une app gratuite sur le portail Azure (Microsoft Entra ID). Elle fournit le Client ID et le Client Secret à coller ci-dessus, et couvre à la fois la boîte mail et l'agenda Outlook. Un compte Microsoft personnel (Outlook.com) suffit.",
    steps: [
      {
        title: 'Ouvrir les inscriptions d’applications',
        body: (
          <>
            Connectez-vous au portail Azure, puis ouvrez{' '}
            <strong>Microsoft Entra ID &rsaquo; Inscriptions d’applications</strong>.{' '}
            <a href={AZURE_APPS_URL} target="_blank" rel="noopener noreferrer">
              Ouvrir le portail Azure <ExternalLink size={11} />
            </a>
          </>
        ),
      },
      {
        title: 'Nouvelle inscription',
        body: (
          <>
            Cliquez <strong>« Nouvelle inscription »</strong>, donnez un nom (ex. «&nbsp;LaunchForge&nbsp;»),
            et pour «&nbsp;Types de comptes pris en charge&nbsp;» choisissez{' '}
            <strong>« Comptes dans un annuaire organisationnel quelconque et comptes Microsoft personnels »</strong>{' '}
            (couvre Outlook.com et Microsoft&nbsp;365).
          </>
        ),
      },
      {
        title: 'Déclarer l’URI de redirection',
        body: (
          <>
            Dans <strong>« URI de redirection »</strong>, sélectionnez la plateforme <strong>« Web »</strong> et
            collez l’<strong>URL de callback affichée ci-dessus</strong>. Cliquez « S’inscrire ».
          </>
        ),
      },
      {
        title: 'Copier le Client ID',
        body: (
          <>
            Sur la page <strong>« Vue d’ensemble »</strong> de l’app, copiez{' '}
            <strong>« ID d’application (client) »</strong> &rarr; c’est votre <em>Client ID</em>.
          </>
        ),
      },
      {
        title: 'Créer le Client Secret',
        body: (
          <>
            Menu <strong>« Certificats et secrets »</strong> &rsaquo; <strong>« Nouveau secret client »</strong> &rsaquo;
            ajoutez une description et une expiration &rsaquo; « Ajouter ». Copiez <strong>immédiatement la Valeur</strong>{' '}
            (colonne <em>Value</em>, pas <em>Secret&nbsp;ID</em>) — elle n’est affichée qu’une fois &rarr; c’est votre <em>Client Secret</em>.
          </>
        ),
      },
      {
        title: 'Ajouter les autorisations Mail + Agenda',
        body: (
          <>
            Menu <strong>« Autorisations d’API »</strong> &rsaquo; « Ajouter une autorisation » &rsaquo;{' '}
            <strong>« Microsoft Graph »</strong> &rsaquo; <strong>« Autorisations déléguées »</strong>, puis cochez{' '}
            <code>Mail.Read</code>, <code>Mail.Send</code>, <code>Calendars.ReadWrite</code>, <code>offline_access</code>,{' '}
            <code>openid</code>, <code>profile</code>, <code>email</code>. Sur un compte d’organisation, cliquez « Accorder le consentement administrateur ».
          </>
        ),
      },
      {
        title: 'Coller et connecter',
        body: (
          <>
            Revenez ici, collez le <strong>Client ID</strong> et le <strong>Client Secret</strong> ci-dessus,
            cliquez <strong>« Enregistrer et connecter »</strong>, puis autorisez l’accès dans la fenêtre Microsoft.
          </>
        ),
      },
    ],
    links: [
      {
        label: 'Guide Microsoft : inscrire une application',
        url: 'https://learn.microsoft.com/fr-fr/entra/identity-platform/quickstart-register-app',
      },
      { label: 'Doc Composio (Outlook)', url: 'https://composio.dev/auth/outlook' },
    ],
  },
};

export default function OwnAppGuide({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDES[slug];
  if (!guide) return null;

  return (
    <div className="ownapp-guide">
      <button
        type="button"
        className="ownapp-guide-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} className={`ownapp-guide-chevron${open ? ' open' : ''}`} />
        <BookOpen size={13} />
        Comment créer mon app Azure&nbsp;? (tuto pas-à-pas)
      </button>

      {open && (
        <div className="ownapp-guide-body">
          <p className="ownapp-guide-intro">{guide.intro}</p>
          <ol className="ownapp-guide-steps">
            {guide.steps.map((s, i) => (
              <li key={i} className="ownapp-guide-step">
                <span className="ownapp-guide-step-title">{s.title}</span>
                <span className="ownapp-guide-step-body">{s.body}</span>
              </li>
            ))}
          </ol>
          {guide.links.length > 0 && (
            <div className="ownapp-guide-links">
              {guide.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label} <ExternalLink size={11} />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
