import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';
import '../widgets/platform_icon.dart';

class ConfigScreen extends StatefulWidget {
  const ConfigScreen({super.key});
  @override
  State<ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<ConfigScreen> {
  String _publishMode = 'manual';
  int _metricsInterval = 360;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        PageTitle('Configuration', subtitle: 'Comptes, publication et synchronisation'),
        const SizedBox(height: 18),

        // Comptes
        _section('Connexions plateformes', Icons.link, [
          for (final t in app.toolkits) _ToolkitRow(t),
        ]),

        // Publication
        _section('Publication des contenus IA', Icons.send, [
          _radio('Validation manuelle', 'Les contenus passent par vos Validations avant publication.', 'manual'),
          _radio('Publication automatique', 'Les contenus IA sont publiés directement à l\'heure prévue.', 'auto'),
        ]),

        // Métriques
        _section('Synchro des métriques', Icons.sync, [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Fréquence de relevé automatique', style: TextStyle(color: Forge.text, fontSize: 14, fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final opt in [(0, 'Désactivé'), (60, 'Toutes les heures'), (360, 'Toutes les 6 h'), (1440, '1×/jour')])
                      _chip(opt.$2, _metricsInterval == opt.$1, () => setState(() => _metricsInterval = opt.$1)),
                  ],
                ),
              ],
            ),
          ),
        ]),

        // Telegram
        _section('Telegram', Icons.send_outlined, [
          _infoRow('Bot personnel', 'Pilotez LaunchForge depuis Telegram', const Pill('Lié', color: Forge.success)),
        ]),

        // Données
        _section('Vos données (RGPD)', Icons.shield_outlined, [
          _infoRow('Exporter mes données', 'Téléchargez tout au format JSON', GhostButton('Exporter', onPressed: () {})),
          const SizedBox(height: 10),
          _infoRow('Supprimer mon compte', 'Effacement définitif (art. 17)',
              GhostButton('Supprimer', icon: Icons.delete_outline, onPressed: () {})),
        ]),
      ],
    );
  }

  Widget _section(String title, IconData icon, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: ForgeCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: Forge.primary, size: 18),
                  const SizedBox(width: 8),
                  Text(title, style: display(16)),
                ],
              ),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      );

  Widget _radio(String title, String body, String value) {
    final active = _publishMode == value;
    return InkWell(
      onTap: () => setState(() => _publishMode = value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(active ? Icons.radio_button_checked : Icons.radio_button_off, color: active ? Forge.primary : Forge.textMuted, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(color: active ? Forge.text : Forge.textMuted, fontWeight: FontWeight.w600, fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(body, style: const TextStyle(color: Forge.textSubtle, fontSize: 12.5, height: 1.4)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, bool active, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: active ? Forge.primaryLight : Forge.surface2,
            borderRadius: BorderRadius.circular(Forge.r),
            border: Border.all(color: active ? Forge.primary : Forge.border),
          ),
          child: Text(label, style: TextStyle(color: active ? Forge.primary : Forge.textMuted, fontWeight: FontWeight.w600, fontSize: 13)),
        ),
      );

  Widget _infoRow(String title, String body, Widget trailing) => Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 2),
                Text(body, style: const TextStyle(color: Forge.textSubtle, fontSize: 12.5)),
              ],
            ),
          ),
          trailing,
        ],
      );
}

class _ToolkitRow extends StatelessWidget {
  final ConfigToolkit t;
  const _ToolkitRow(this.t);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          PlatformIcon(t.slug, size: 30),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.name, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w600, fontSize: 14)),
                Text(t.capability, style: const TextStyle(color: Forge.textSubtle, fontSize: 12)),
              ],
            ),
          ),
          if (t.connected)
            const Pill('Fonctionnel', color: Forge.success, icon: Icons.check)
          else
            GhostButton('Connecter', icon: Icons.add_link, onPressed: () {}),
        ],
      ),
    );
  }
}
