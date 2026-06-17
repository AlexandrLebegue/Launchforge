import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme.dart';
import '../widgets/common.dart';

class LandingScreen extends StatelessWidget {
  const LandingScreen({super.key});

  static const _features = [
    (Icons.smart_toy_outlined, 'Onboarding par IA', 'Un chat vous interviewe, recherche votre entreprise et génère un plan de lancement tactique.'),
    (Icons.campaign_outlined, 'Hub de contenu', 'Calendrier éditorial IA, éditeur avec aperçus fidèles par plateforme, images et présentations.'),
    (Icons.autorenew, 'Séries récurrentes', 'Un post se republie tout seul, réécrit par l\'IA avec un sujet différent à chaque fois.'),
    (Icons.trending_up, 'Performances', 'Métriques synchronisées, graphiques d\'évolution et analyse IA de chaque post.'),
    (Icons.track_changes, 'Leads', 'L\'IA lit vos commentaires et emails, repère les personnes intéressées et les score.'),
    (Icons.forum_outlined, 'Assistant', 'Un chat qui sait tout faire : rédiger, publier, analyser, configurer.'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Forge.bg,
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // Hero
            Container(
              decoration: const BoxDecoration(gradient: Forge.gradientHero),
              padding: const EdgeInsets.fromLTRB(24, 40, 24, 36),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r), boxShadow: Forge.glow(0.3)),
                        child: const Icon(Icons.local_fire_department, color: Colors.white, size: 25),
                      ),
                      const SizedBox(width: 10),
                      RichText(
                        text: TextSpan(style: display(24), children: const [
                          TextSpan(text: 'Launch'),
                          TextSpan(text: 'Forge', style: TextStyle(color: Forge.primary)),
                        ]),
                      ),
                    ],
                  ),
                  const SizedBox(height: 36),
                  Text(
                    'Le hub de promotion de votre startup, forgé par l\'IA.',
                    textAlign: TextAlign.center,
                    style: display(30, w: FontWeight.w800),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'LaunchForge construit votre plan de lancement, rédige et publie votre contenu, suit vos métriques et détecte vos prospects — piloté par l\'IA.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Forge.textMuted, fontSize: 15, height: 1.6),
                  ),
                  const SizedBox(height: 28),
                  PrimaryButton('Commencer gratuitement', large: true, glow: true, icon: Icons.arrow_forward, onPressed: () => context.go('/register')),
                  const SizedBox(height: 12),
                  GhostButton('Se connecter', onPressed: () => context.go('/login')),
                ],
              ),
            ),

            // Features
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
              child: Text('Tout ce qu\'il faut pour lancer', textAlign: TextAlign.center, style: display(22)),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              child: Column(
                children: [
                  for (final f in _features)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: ForgeCard(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 42,
                              height: 42,
                              decoration: BoxDecoration(color: Forge.primaryLight, borderRadius: BorderRadius.circular(Forge.r)),
                              child: Icon(f.$1, color: Forge.primary, size: 22),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(f.$2, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w700, fontSize: 15)),
                                  const SizedBox(height: 4),
                                  Text(f.$3, style: const TextStyle(color: Forge.textMuted, fontSize: 13, height: 1.5)),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // CTA final
            Container(
              margin: const EdgeInsets.fromLTRB(16, 0, 16, 28),
              padding: const EdgeInsets.all(28),
              decoration: BoxDecoration(
                gradient: Forge.gradientPrimary,
                borderRadius: BorderRadius.circular(Forge.rLg),
                boxShadow: Forge.glow(0.35),
              ),
              child: Column(
                children: [
                  Text('Prêt à forger votre lancement ?', textAlign: TextAlign.center, style: display(20, color: Colors.white)),
                  const SizedBox(height: 16),
                  Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(Forge.r),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(Forge.r),
                      onTap: () => context.go('/register'),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24, vertical: 13),
                        child: Text('Créer mon compte', style: TextStyle(color: Color(0xFFE8590C), fontWeight: FontWeight.w700, fontSize: 15)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
