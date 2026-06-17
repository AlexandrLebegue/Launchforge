import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';
import '../widgets/platform_icon.dart';

class ContentHubScreen extends StatefulWidget {
  const ContentHubScreen({super.key});
  @override
  State<ContentHubScreen> createState() => _ContentHubScreenState();
}

class _ContentHubScreenState extends State<ContentHubScreen> {
  String _query = '';
  String _status = 'all';

  static const _filters = [
    ('all', 'Tous'),
    ('idea', 'Idées'),
    ('draft', 'Brouillons'),
    ('scheduled', 'Programmés'),
    ('published', 'Publiés'),
  ];

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    var posts = app.posts;
    if (_status != 'all') posts = posts.where((p) => p.status == _status).toList();
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      posts = posts.where((p) => p.title.toLowerCase().contains(q) || p.content.toLowerCase().contains(q) || p.platform.contains(q)).toList();
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              PageTitle('Hub de contenu', subtitle: '${app.posts.length} contenus · votre calendrier éditorial'),
              const SizedBox(height: 14),
              TextField(
                onChanged: (v) => setState(() => _query = v),
                style: const TextStyle(color: Forge.text),
                decoration: const InputDecoration(
                  hintText: 'Rechercher un post…',
                  prefixIcon: Icon(Icons.search, color: Forge.textMuted, size: 20),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 34,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _filters.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) {
                    final f = _filters[i];
                    final active = _status == f.$1;
                    return GestureDetector(
                      onTap: () => setState(() => _status = f.$1),
                      child: Container(
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        decoration: BoxDecoration(
                          color: active ? Forge.primaryLight : Forge.surface2,
                          borderRadius: BorderRadius.circular(Forge.r),
                          border: Border.all(color: active ? Forge.primary : Forge.border),
                        ),
                        child: Text(f.$2,
                            style: TextStyle(color: active ? Forge.primary : Forge.textMuted, fontWeight: FontWeight.w600, fontSize: 13)),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: posts.isEmpty
              ? const EmptyState(icon: Icons.campaign_outlined, title: 'Aucun post', body: 'Aucun contenu ne correspond à ce filtre.')
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
                  itemCount: posts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _PostCard(posts[i]),
                ),
        ),
      ],
    );
  }
}

class _PostCard extends StatelessWidget {
  final Post post;
  const _PostCard(this.post);

  @override
  Widget build(BuildContext context) {
    final hasMetrics = post.status == 'published';
    return ForgeCard(
      onTap: () => _showEditor(context, post),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              PlatformIcon(post.platform, size: 30),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(post.title.isEmpty ? post.platform : post.title,
                        style: const TextStyle(fontWeight: FontWeight.w600, color: Forge.text, fontSize: 14.5),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(_date(post), style: const TextStyle(color: Forge.textSubtle, fontSize: 11.5)),
                  ],
                ),
              ),
              Pill(statusLabel(post.status), color: statusColor(post.status)),
            ],
          ),
          const SizedBox(height: 10),
          Text(post.content, style: const TextStyle(color: Forge.textMuted, fontSize: 13.5, height: 1.5), maxLines: 3, overflow: TextOverflow.ellipsis),
          if (post.recurrence != 'none') ...[
            const SizedBox(height: 10),
            Pill('↻ ${_recur(post.recurrence)}', color: Forge.textMuted, icon: null),
          ],
          if (hasMetrics) ...[
            const SizedBox(height: 12),
            const Divider(color: Forge.border, height: 1),
            const SizedBox(height: 10),
            Row(
              children: [
                _metric(Icons.visibility_outlined, post.impressions),
                _metric(Icons.favorite_border, post.likes),
                _metric(Icons.mode_comment_outlined, post.comments),
                _metric(Icons.repeat, post.shares),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _metric(IconData icon, int v) => Padding(
        padding: const EdgeInsets.only(right: 18),
        child: Row(
          children: [
            Icon(icon, size: 15, color: Forge.textMuted),
            const SizedBox(width: 5),
            Text(_compact(v), style: const TextStyle(color: Forge.textMuted, fontSize: 12.5, fontWeight: FontWeight.w600)),
          ],
        ),
      );

  static String _compact(int v) => v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}k' : '$v';

  static String _recur(String r) => switch (r) {
        'daily' => 'Quotidien',
        'weekly' => 'Hebdomadaire',
        'biweekly' => 'Bimensuel',
        'monthly' => 'Mensuel',
        _ => r,
      };

  static String _date(Post p) {
    final iso = p.scheduledAt ?? p.publishedAt;
    if (iso == null) return 'Sans date';
    try {
      return DateFormat("d MMM yyyy 'à' HH:mm", 'fr').format(DateTime.parse(iso).toLocal());
    } catch (_) {
      return iso;
    }
  }

  void _showEditor(BuildContext context, Post post) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Forge.surfaceSolid,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(12))),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(20),
          children: [
            Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Forge.border, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 16),
            Row(
              children: [
                PlatformIcon(post.platform, size: 36),
                const SizedBox(width: 12),
                Expanded(child: Text(post.title.isEmpty ? post.platform : post.title, style: display(18))),
                Pill(statusLabel(post.status), color: statusColor(post.status)),
              ],
            ),
            const SizedBox(height: 18),
            const Text('CONTENU', style: TextStyle(fontSize: 11.5, color: Forge.textMuted, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Forge.surface2, borderRadius: BorderRadius.circular(Forge.r), border: Border.all(color: Forge.border)),
              child: Text(post.content, style: const TextStyle(color: Forge.text, fontSize: 14, height: 1.6)),
            ),
            if (post.subreddit != null) ...[
              const SizedBox(height: 16),
              Pill('r/${post.subreddit}', color: const Color(0xFFFF4500)),
            ],
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(child: GhostButton('Modifier', icon: Icons.edit_outlined, onPressed: () => Navigator.pop(context))),
                const SizedBox(width: 12),
                Expanded(child: PrimaryButton('Publier maintenant', icon: Icons.send, onPressed: () => Navigator.pop(context))),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
