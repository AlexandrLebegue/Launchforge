# LaunchForge — application mobile (Flutter)

Version mobile native (Flutter) de [LaunchForge](../README.md), fidèle au thème
« Forge » du web (anthracite chaud + braise orange, angles durs, Space Grotesk /
Inter). L'app se connecte à la **même API** que le client web (`/api`).

## Vues couvertes

| Vue | Écran |
|---|---|
| Accueil public | `landing.dart` |
| Connexion / Inscription | `auth.dart` |
| Onboarding par IA | `create_plan.dart` |
| Tableau de bord | `dashboard.dart` |
| Hub de contenu | `content_hub.dart` |
| Calendrier | `calendar.dart` |
| Assistant (chat) | `assistant.dart` |
| Performances (graphiques) | `performance.dart` |
| Connaissances + Contacts | `knowledge.dart` |
| Validations | `approvals.dart` |
| Configuration | `config.dart` |

Navigation : barre inférieure (5 sections principales) + tiroir latéral
(toutes les sections, sélecteur de projet, profil, déconnexion).

## Lancer

```bash
flutter pub get

# Sur un appareil / émulateur, branché au backend :
flutter run --dart-define=API_BASE=http://10.0.2.2:3000   # Android émulateur
flutter run --dart-define=API_BASE=https://votre-domaine.fr

# Mode démonstration (données fictives, sans backend) :
flutter run --dart-define=DEMO=true
```

`API_BASE` par défaut : `http://localhost:3000`.

## Captures d'écran (vérification de l'UI)

Le dossier `tool/` contient un harnais de capture (Flutter Web + Chrome
headless) qui photographie chaque vue en format mobile (390×844 @2x) :

```bash
flutter build web --dart-define=DEMO=true --no-web-resources-cdn
node tool/shoot.js ../shots          # vues authentifiées (mode démo)

flutter build web --no-web-resources-cdn
node tool/shoot_public.js ../shots   # pages publiques (non authentifiées)
```

> `--no-web-resources-cdn` embarque CanvasKit localement (rendu hors-ligne).
> Les polices Inter / Space Grotesk sont **embarquées** (`assets/fonts/`) pour
> un rendu déterministe ; sur appareil réel, les emojis utilisent la police
> système.
