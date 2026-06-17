import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';
import '../widgets/platform_icon.dart';

class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final pending = app.approvals;
    final history = app.approvalHistory;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        PageTitle('Validations', subtitle: '${pending.length} contenu${pending.length > 1 ? 's' : ''} en attente'),
        const SizedBox(height: 16),
        if (pending.isEmpty)
          ForgeCard(
            child: Row(
              children: const [
                Icon(Icons.check_circle, color: Forge.success),
                SizedBox(width: 12),
                Expanded(child: Text('Tout est à jour — aucun contenu en attente de validation.', style: TextStyle(color: Forge.textMuted))),
              ],
            ),
          )
        else
          for (final item in pending) _ApprovalCard(item),

        if (history.isNotEmpty) ...[
          const SizedBox(height: 8),
          const CardHeader('Historique des envois'),
          for (final h in history) _HistoryRow(h),
        ],
      ],
    );
  }
}

class _ApprovalCard extends StatefulWidget {
  final ApprovalItem item;
  const _ApprovalCard(this.item);
  @override
  State<_ApprovalCard> createState() => _ApprovalCardState();
}

class _ApprovalCardState extends State<_ApprovalCard> {
  late final TextEditingController _content = TextEditingController(text: widget.item.result ?? '');

  void _resolve(bool approved) {
    final app = context.read<AppState>();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(approved ? 'Contenu validé et publié ✓' : 'Contenu rejeté'),
      backgroundColor: approved ? Forge.success : Forge.error,
    ));
    app.resolveApproval(widget.item.id);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: ForgeCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                PlatformIcon(item.agentPlatform, size: 30),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.agentName, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w700, fontSize: 14)),
                      Text(item.cardTitle, style: const TextStyle(color: Forge.textMuted, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
                if (item.planId == null) const Pill('Telegram', color: Color(0xFF38BDF8)),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _content,
              maxLines: null,
              style: const TextStyle(color: Forge.text, fontSize: 14, height: 1.55),
              decoration: const InputDecoration(),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(child: PrimaryButton('Valider et publier', icon: Icons.check, onPressed: () => _resolve(true))),
                const SizedBox(width: 12),
                GhostButton('Rejeter', icon: Icons.close, onPressed: () => _resolve(false)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final ApprovalItem item;
  const _HistoryRow(this.item);
  @override
  Widget build(BuildContext context) {
    final ok = item.status == 'done';
    final rejected = item.status == 'rejected';
    final color = ok ? Forge.success : (rejected ? Forge.textMuted : Forge.error);
    final icon = ok ? Icons.check_circle : (rejected ? Icons.cancel_outlined : Icons.error_outline);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ForgeCard(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PlatformIcon(item.agentPlatform, size: 26),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.cardTitle, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w600, fontSize: 13.5)),
                  const SizedBox(height: 4),
                  Text(item.result ?? '', style: TextStyle(color: color, fontSize: 12.5, height: 1.4)),
                ],
              ),
            ),
            Icon(icon, color: color, size: 18),
          ],
        ),
      ),
    );
  }
}
