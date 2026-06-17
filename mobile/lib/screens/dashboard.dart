import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final ov = app.overview;
    final project = ov?.project;
    final input = app.plan?.input;

    if (project == null) {
      return EmptyState(
        icon: Icons.rocket_launch,
        title: 'Aucun projet',
        body: "L'assistant IA vous pose quelques questions, recherche votre entreprise, et génère votre plan d'action.",
        action: PrimaryButton('Créer mon premier projet', large: true, glow: true, onPressed: () => context.go('/plan')),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        // En-tête projet
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(project.productName, style: display(26)),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Pill(project.niche),
                      const _Dot(),
                      Text(project.targetAudience, style: const TextStyle(color: Forge.textMuted, fontSize: 13)),
                      if (input != null && input.pricing.isNotEmpty) ...[
                        const _Dot(),
                        Text(input.pricing, style: const TextStyle(color: Forge.textMuted, fontSize: 13)),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        // Bannière validations
        if ((ov?.approvals ?? 0) > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: ForgeCard(
              onTap: () => context.go('/approvals'),
              borderColor: Forge.warning.withValues(alpha: 0.4),
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  const Icon(Icons.fact_check_outlined, color: Forge.warning),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '${ov!.approvals} contenu${ov.approvals > 1 ? 's' : ''} proposé${ov.approvals > 1 ? 's' : ''} par l\'IA attend${ov.approvals > 1 ? 'ent' : ''} votre validation',
                      style: const TextStyle(color: Forge.text, fontSize: 13.5),
                    ),
                  ),
                  const Text('Valider →', style: TextStyle(color: Forge.warning, fontWeight: FontWeight.w600, fontSize: 13)),
                ],
              ),
            ),
          ),

        // Cartes chiffres
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.55,
          children: [
            _StatCard(icon: Icons.schedule, value: ov!.postsScheduled, label: 'Posts programmés', onTap: () => context.go('/content')),
            _StatCard(icon: Icons.edit_outlined, value: ov.postsDrafts, label: 'Brouillons & idées', onTap: () => context.go('/content')),
            _StatCard(icon: Icons.check_circle_outline, value: ov.postsPublished, label: 'Posts publiés'),
            _StatCard(icon: Icons.fact_check_outlined, value: ov.approvals, label: 'À valider', highlight: ov.approvals > 0, onTap: () => context.go('/approvals')),
          ],
        ),
        const SizedBox(height: 20),

        // Prochaine publication
        ForgeCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CardHeader('Prochaine publication'),
              if (ov.nextPost != null)
                RichText(
                  text: TextSpan(
                    style: const TextStyle(fontFamily: Forge.bodyFont, color: Forge.textMuted, fontSize: 14, height: 1.5),
                    children: [
                      TextSpan(text: '« ${ov.nextPost!.title} » sur '),
                      TextSpan(text: ov.nextPost!.platform, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w600)),
                      TextSpan(text: ' le ${_fmt(ov.nextPost!.scheduledAt)}'),
                    ],
                  ),
                )
              else
                const Text('Aucun post programmé — générez un calendrier éditorial dans le Hub de contenu.',
                    style: TextStyle(color: Forge.textMuted, fontSize: 14)),
            ],
          ),
        ),

        // Objectifs
        if (input != null && input.goals.isNotEmpty)
          ForgeCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CardHeader('Objectifs'),
                for (final g in input.goals) _bullet(g),
              ],
            ),
          ),

        // Description
        if (input != null && input.description.isNotEmpty)
          ForgeCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CardHeader('Description'),
                Text(input.description, style: const TextStyle(color: Forge.textMuted, fontSize: 14, height: 1.7)),
              ],
            ),
          ),

        // Phases de lancement
        if ((app.plan?.launchSequencing ?? []).isNotEmpty)
          ForgeCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CardHeader('Phases de lancement'),
                for (int i = 0; i < app.plan!.launchSequencing.length; i++)
                  _PhaseTile(index: i + 1, phase: app.plan!.launchSequencing[i], last: i == app.plan!.launchSequencing.length - 1),
              ],
            ),
          ),
      ],
    );
  }

  static String _fmt(String iso) {
    try {
      final d = DateTime.parse(iso).toLocal();
      return DateFormat("d MMM 'à' HH:mm", 'fr').format(d);
    } catch (_) {
      return iso;
    }
  }

  Widget _bullet(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(margin: const EdgeInsets.only(top: 7, right: 10), width: 5, height: 5, decoration: const BoxDecoration(color: Forge.primary, shape: BoxShape.circle)),
            Expanded(child: Text(text, style: const TextStyle(color: Forge.textMuted, fontSize: 13.5, height: 1.5))),
          ],
        ),
      );
}

class _Dot extends StatelessWidget {
  const _Dot();
  @override
  Widget build(BuildContext context) =>
      Container(width: 3, height: 3, decoration: const BoxDecoration(color: Forge.textSubtle, shape: BoxShape.circle));
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final int value;
  final String label;
  final bool highlight;
  final VoidCallback? onTap;
  const _StatCard({required this.icon, required this.value, required this.label, this.highlight = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    return ForgeCard(
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(icon, color: Forge.primary.withValues(alpha: 0.8), size: 20),
          const Spacer(),
          Text('$value',
              style: display(30, w: FontWeight.w800, color: highlight ? Forge.warning : Forge.text)),
          const SizedBox(height: 2),
          Text(label.toUpperCase(),
              style: const TextStyle(fontSize: 10.5, color: Forge.textMuted, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
        ],
      ),
    );
  }
}

class _PhaseTile extends StatelessWidget {
  final int index;
  final dynamic phase;
  final bool last;
  const _PhaseTile({required this.index, required this.phase, required this.last});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: EdgeInsets.only(bottom: last ? 0 : 14),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: Forge.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
                child: Text('$index', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12)),
              ),
              const SizedBox(width: 10),
              Text(phase.phase, style: const TextStyle(fontWeight: FontWeight.w700, color: Forge.text, fontSize: 14)),
              const SizedBox(width: 8),
              Text(phase.timeline, style: const TextStyle(color: Forge.textMuted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          for (final a in (phase.activities as List).take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 6, left: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 6, right: 9),
                    child: SizedBox(width: 5, height: 5, child: DecoratedBox(decoration: BoxDecoration(color: Forge.primary, shape: BoxShape.circle))),
                  ),
                  Expanded(child: Text(a, style: const TextStyle(color: Forge.textMuted, fontSize: 13, height: 1.45))),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
