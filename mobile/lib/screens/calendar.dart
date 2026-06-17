import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';
import '../widgets/platform_icon.dart';

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});
  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  late DateTime _month;

  @override
  void initState() {
    super.initState();
    final posts = context.read<AppState>().posts;
    DateTime? anchor;
    for (final p in posts) {
      final iso = p.scheduledAt ?? p.publishedAt;
      if (iso != null) {
        anchor = DateTime.tryParse(iso)?.toLocal();
        if (p.status == 'scheduled') break;
      }
    }
    final base = anchor ?? DateTime.now();
    _month = DateTime(base.year, base.month);
  }

  Map<int, List<Post>> _byDay(List<Post> posts) {
    final map = <int, List<Post>>{};
    for (final p in posts) {
      final iso = p.scheduledAt ?? p.publishedAt;
      if (iso == null) continue;
      final d = DateTime.tryParse(iso)?.toLocal();
      if (d == null || d.year != _month.year || d.month != _month.month) continue;
      map.putIfAbsent(d.day, () => []).add(p);
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final byDay = _byDay(app.posts);
    final firstWeekday = DateTime(_month.year, _month.month, 1).weekday; // 1=Mon
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    final leading = firstWeekday - 1;
    final totalCells = ((leading + daysInMonth) / 7).ceil() * 7;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        PageTitle('Calendrier', subtitle: 'Votre planning éditorial du mois'),
        const SizedBox(height: 16),
        Row(
          children: [
            IconButton(
              onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
              icon: const Icon(Icons.chevron_left, color: Forge.textMuted),
            ),
            Expanded(
              child: Text(
                toBeginningOfSentenceCase(DateFormat.yMMMM('fr').format(_month))!,
                textAlign: TextAlign.center,
                style: display(18),
              ),
            ),
            IconButton(
              onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
              icon: const Icon(Icons.chevron_right, color: Forge.textMuted),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            for (final d in ['L', 'M', 'M', 'J', 'V', 'S', 'D'])
              Expanded(
                child: Center(
                  child: Text(d, style: const TextStyle(color: Forge.textSubtle, fontSize: 12, fontWeight: FontWeight.w600)),
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7, childAspectRatio: 0.62),
          itemCount: totalCells,
          itemBuilder: (_, i) {
            final dayNum = i - leading + 1;
            if (dayNum < 1 || dayNum > daysInMonth) return const SizedBox.shrink();
            final dayPosts = byDay[dayNum] ?? [];
            return _DayCell(day: dayNum, posts: dayPosts, onTap: dayPosts.isEmpty ? null : () => _showDay(context, dayNum, dayPosts));
          },
        ),
        const SizedBox(height: 18),
        _legend(),
      ],
    );
  }

  Widget _legend() => Wrap(
        spacing: 16,
        runSpacing: 8,
        children: [
          for (final s in ['scheduled', 'draft', 'published'])
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(width: 9, height: 9, decoration: BoxDecoration(color: statusColor(s), shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Text(statusLabel(s), style: const TextStyle(color: Forge.textMuted, fontSize: 12)),
              ],
            ),
        ],
      );

  void _showDay(BuildContext context, int day, List<Post> posts) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Forge.surfaceSolid,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(12))),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${DateFormat.MMMM('fr').format(_month)} $day', style: display(18)),
            const SizedBox(height: 14),
            for (final p in posts)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    PlatformIcon(p.platform, size: 28),
                    const SizedBox(width: 10),
                    Expanded(child: Text(p.title.isEmpty ? p.platform : p.title, style: const TextStyle(color: Forge.text, fontSize: 14))),
                    Pill(statusLabel(p.status), color: statusColor(p.status)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

String _code(String p) => switch (p.toLowerCase()) {
      'linkedin' => 'LinkedIn',
      'twitter' || 'x' => 'X',
      'instagram' => 'Insta',
      'facebook' => 'FB',
      'reddit' => 'Reddit',
      'youtube' => 'YouTube',
      'producthunt' => 'PHunt',
      'newsletter' => 'News',
      'tiktok' => 'TikTok',
      _ => p.length > 6 ? p.substring(0, 6) : p,
    };

class _DayCell extends StatelessWidget {
  final int day;
  final List<Post> posts;
  final VoidCallback? onTap;
  const _DayCell({required this.day, required this.posts, this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.all(2),
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: posts.isEmpty ? Forge.surface : Forge.surface2,
          borderRadius: BorderRadius.circular(Forge.r),
          border: Border.all(color: posts.isEmpty ? Forge.borderLight : Forge.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$day', style: const TextStyle(color: Forge.textMuted, fontSize: 11.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            for (final p in posts.take(2))
              Container(
                margin: const EdgeInsets.only(top: 2),
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
                decoration: BoxDecoration(color: statusColor(p.status).withValues(alpha: 0.18), borderRadius: BorderRadius.circular(2)),
                child: Text(
                  _code(p.platform),
                  style: TextStyle(color: statusColor(p.status), fontSize: 9, fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                ),
              ),
            if (posts.length > 2)
              Padding(
                padding: const EdgeInsets.only(top: 2, left: 3),
                child: Text('+${posts.length - 2}', style: const TextStyle(color: Forge.textSubtle, fontSize: 9)),
              ),
          ],
        ),
      ),
    );
  }
}
