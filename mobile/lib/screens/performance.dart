import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';
import '../widgets/platform_icon.dart';

class PerformanceScreen extends StatelessWidget {
  const PerformanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final perf = app.performance;
    final weekly = perf?.weekly ?? [];
    final published = app.posts.where((p) => p.status == 'published').toList()
      ..sort((a, b) => (b.impressions + b.likes * 5).compareTo(a.impressions + a.likes * 5));

    final totalImp = weekly.fold<int>(0, (s, w) => s + w.impressions);
    final totalLikes = weekly.fold<int>(0, (s, w) => s + w.likes);
    final totalPosts = weekly.fold<int>(0, (s, w) => s + w.posts);

    if (weekly.isEmpty) {
      return const EmptyState(
        icon: Icons.trending_up,
        title: 'Pas encore de données',
        body: 'Publiez vos premiers posts et synchronisez vos métriques pour voir vos performances ici.',
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        PageTitle('Performances', subtitle: 'Vos métriques sur 7 semaines'),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: _kpi('Impressions', _compact(totalImp), Icons.visibility_outlined)),
            const SizedBox(width: 12),
            Expanded(child: _kpi('Likes', _compact(totalLikes), Icons.favorite_border)),
            const SizedBox(width: 12),
            Expanded(child: _kpi('Posts', '$totalPosts', Icons.article_outlined)),
          ],
        ),
        const SizedBox(height: 16),

        // Courbe impressions
        ForgeCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CardHeader('Impressions par semaine'),
              SizedBox(height: 180, child: _ImpressionsChart(weekly)),
            ],
          ),
        ),

        // Barres likes
        ForgeCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const CardHeader('Likes par semaine'),
              SizedBox(height: 160, child: _LikesChart(weekly)),
            ],
          ),
        ),

        // Rapport IA
        ForgeCard(
          borderColor: Forge.primary.withValues(alpha: 0.3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.auto_awesome, color: Forge.primary, size: 18),
                  const SizedBox(width: 8),
                  Text('Rapport de campagne IA', style: display(16)),
                ],
              ),
              const SizedBox(height: 12),
              Text(app.campaignReport, style: const TextStyle(color: Forge.textMuted, fontSize: 13.5, height: 1.65)),
            ],
          ),
        ),

        // Meilleurs posts
        if (published.isNotEmpty) ...[
          const SizedBox(height: 4),
          const CardHeader('Détail par post'),
          for (final p in published.take(4)) _PerfRow(p),
        ],
      ],
    );
  }

  static Widget _kpi(String label, String value, IconData icon) => ForgeCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: Forge.primary.withValues(alpha: 0.8), size: 18),
            const SizedBox(height: 10),
            Text(value, style: display(22, w: FontWeight.w800)),
            Text(label.toUpperCase(), style: const TextStyle(fontSize: 9.5, color: Forge.textMuted, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
          ],
        ),
      );

  static String _compact(int v) => v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}k' : '$v';
}

class _ImpressionsChart extends StatelessWidget {
  final List<WeeklyPerf> weekly;
  const _ImpressionsChart(this.weekly);
  @override
  Widget build(BuildContext context) {
    final maxY = weekly.map((w) => w.impressions).reduce((a, b) => a > b ? a : b).toDouble() * 1.15;
    return LineChart(
      LineChartData(
        minY: 0,
        maxY: maxY,
        gridData: FlGridData(show: true, drawVerticalLine: false, horizontalInterval: maxY / 4, getDrawingHorizontalLine: (_) => const FlLine(color: Forge.border, strokeWidth: 1)),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 34,
              interval: maxY / 4,
              getTitlesWidget: (v, _) => Text(v >= 1000 ? '${(v / 1000).toStringAsFixed(0)}k' : v.toStringAsFixed(0),
                  style: const TextStyle(color: Forge.textSubtle, fontSize: 10)),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: 1,
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= weekly.length) return const SizedBox.shrink();
                return Padding(padding: const EdgeInsets.only(top: 6), child: Text(weekly[i].week, style: const TextStyle(color: Forge.textSubtle, fontSize: 10)));
              },
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        lineBarsData: [
          LineChartBarData(
            spots: [for (int i = 0; i < weekly.length; i++) FlSpot(i.toDouble(), weekly[i].impressions.toDouble())],
            isCurved: true,
            color: Forge.primary,
            barWidth: 3,
            dotData: FlDotData(getDotPainter: (s, _, __, ___) => FlDotCirclePainter(radius: 3, color: Forge.primary, strokeWidth: 0)),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Forge.primary.withValues(alpha: 0.3), Forge.primary.withValues(alpha: 0.0)],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LikesChart extends StatelessWidget {
  final List<WeeklyPerf> weekly;
  const _LikesChart(this.weekly);
  @override
  Widget build(BuildContext context) {
    final maxY = weekly.map((w) => w.likes).reduce((a, b) => a > b ? a : b).toDouble() * 1.2;
    return BarChart(
      BarChartData(
        maxY: maxY,
        gridData: FlGridData(show: true, drawVerticalLine: false, horizontalInterval: maxY / 4, getDrawingHorizontalLine: (_) => const FlLine(color: Forge.border, strokeWidth: 1)),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 30, interval: maxY / 4, getTitlesWidget: (v, _) => Text(v.toStringAsFixed(0), style: const TextStyle(color: Forge.textSubtle, fontSize: 10)))),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= weekly.length) return const SizedBox.shrink();
                return Padding(padding: const EdgeInsets.only(top: 6), child: Text(weekly[i].week, style: const TextStyle(color: Forge.textSubtle, fontSize: 10)));
              },
            ),
          ),
        ),
        borderData: FlBorderData(show: false),
        barGroups: [
          for (int i = 0; i < weekly.length; i++)
            BarChartGroupData(x: i, barRods: [
              BarChartRodData(
                toY: weekly[i].likes.toDouble(),
                width: 14,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(2)),
                gradient: Forge.gradientPrimary,
              ),
            ]),
        ],
      ),
    );
  }
}

class _PerfRow extends StatelessWidget {
  final Post post;
  const _PerfRow(this.post);
  @override
  Widget build(BuildContext context) {
    return ForgeCard(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          PlatformIcon(post.platform, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(post.title.isEmpty ? post.platform : post.title,
                    style: const TextStyle(color: Forge.text, fontSize: 13.5, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Row(
                  children: [
                    _m(Icons.visibility_outlined, post.impressions),
                    _m(Icons.favorite_border, post.likes),
                    _m(Icons.mode_comment_outlined, post.comments),
                  ],
                ),
              ],
            ),
          ),
          Text('${_engagement(post).toStringAsFixed(1)}%', style: const TextStyle(color: Forge.success, fontWeight: FontWeight.w700, fontSize: 14)),
        ],
      ),
    );
  }

  double _engagement(Post p) => p.impressions == 0 ? 0 : (p.likes + p.comments + p.shares) / p.impressions * 100;

  Widget _m(IconData icon, int v) => Padding(
        padding: const EdgeInsets.only(right: 14),
        child: Row(
          children: [
            Icon(icon, size: 13, color: Forge.textMuted),
            const SizedBox(width: 4),
            Text(v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}k' : '$v', style: const TextStyle(color: Forge.textMuted, fontSize: 11.5)),
          ],
        ),
      );
}
