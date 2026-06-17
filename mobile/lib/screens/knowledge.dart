import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';

class KnowledgeScreen extends StatefulWidget {
  const KnowledgeScreen({super.key});
  @override
  State<KnowledgeScreen> createState() => _KnowledgeScreenState();
}

class _KnowledgeScreenState extends State<KnowledgeScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  String _category = 'all';

  static const _cats = {
    'all': 'Toutes',
    'company': 'Entreprise',
    'product': 'Produit',
    'audience': 'Audience',
    'tone': 'Ton & style',
    'offers': 'Offres',
    'learnings': 'Enseignements',
    'news': 'Veille',
    'other': 'Autre',
  };

  static const _catColors = {
    'company': Forge.primary,
    'product': Color(0xFF60A5FA),
    'audience': Color(0xFF34D399),
    'tone': Color(0xFFA78BFA),
    'offers': Color(0xFFFBBF24),
    'learnings': Color(0xFFF472B6),
    'news': Color(0xFF38BDF8),
    'other': Forge.textMuted,
  };

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: PageTitle('Connaissances', subtitle: 'Le carburant de l\'IA — ${app.knowledge.length} fiches'),
        ),
        const SizedBox(height: 12),
        TabBar(
          controller: _tabs,
          labelColor: Forge.primary,
          unselectedLabelColor: Forge.textMuted,
          indicatorColor: Forge.primary,
          dividerColor: Forge.border,
          labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          tabs: const [Tab(text: 'Fiches'), Tab(text: 'Contacts')],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [_fiches(app), _contacts(app)],
          ),
        ),
      ],
    );
  }

  Widget _fiches(AppState app) {
    var entries = app.knowledge;
    if (_category != 'all') entries = entries.where((e) => e.category == _category).toList();
    return Column(
      children: [
        SizedBox(
          height: 50,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            itemCount: _cats.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) {
              final key = _cats.keys.elementAt(i);
              final active = _category == key;
              return GestureDetector(
                onTap: () => setState(() => _category = key),
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: active ? Forge.primaryLight : Forge.surface2,
                    borderRadius: BorderRadius.circular(Forge.r),
                    border: Border.all(color: active ? Forge.primary : Forge.border),
                  ),
                  child: Text(_cats[key]!, style: TextStyle(color: active ? Forge.primary : Forge.textMuted, fontWeight: FontWeight.w600, fontSize: 13)),
                ),
              );
            },
          ),
        ),
        Expanded(
          child: entries.isEmpty
              ? const EmptyState(icon: Icons.menu_book_outlined, title: 'Aucune fiche', body: 'Créez votre première fiche pour nourrir l\'IA.')
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
                  itemCount: entries.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _kbCard(entries[i]),
                ),
        ),
      ],
    );
  }

  Widget _kbCard(KnowledgeEntry e) {
    final color = _catColors[e.category] ?? Forge.textMuted;
    return ForgeCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Pill(_cats[e.category] ?? e.category, color: color),
              const Spacer(),
              const Icon(Icons.more_horiz, color: Forge.textSubtle, size: 18),
            ],
          ),
          const SizedBox(height: 10),
          Text(e.title, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 6),
          Text(e.content, style: const TextStyle(color: Forge.textMuted, fontSize: 13.5, height: 1.55), maxLines: 4, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }

  Widget _contacts(AppState app) {
    final contacts = app.contacts;
    if (contacts.isEmpty) {
      return const EmptyState(icon: Icons.people_outline, title: 'Aucun contact', body: 'L\'IA détecte vos leads depuis vos commentaires et emails.');
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 90),
      itemCount: contacts.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, i) => _contactCard(contacts[i]),
    );
  }

  Widget _contactCard(Contact c) {
    final score = c.interestScore ?? 0;
    final scoreColor = score >= 80 ? Forge.success : (score >= 60 ? Forge.warning : Forge.textMuted);
    final typeLabel = switch (c.type) { 'client' => 'Client', 'partner' => 'Partenaire', _ => 'Prospect' };
    return ForgeCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: Forge.primaryLight,
                child: Text(c.name[0], style: const TextStyle(color: Forge.primary, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name, style: const TextStyle(color: Forge.text, fontWeight: FontWeight.w700, fontSize: 14.5)),
                    if (c.company != null) Text(c.company!, style: const TextStyle(color: Forge.textMuted, fontSize: 12.5)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('$score', style: TextStyle(color: scoreColor, fontWeight: FontWeight.w800, fontSize: 18)),
                  const Text('intérêt', style: TextStyle(color: Forge.textSubtle, fontSize: 10)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Pill(typeLabel, color: c.type == 'client' ? Forge.success : (c.type == 'partner' ? const Color(0xFFA78BFA) : Forge.primary)),
              const SizedBox(width: 8),
              if (c.source != null) Expanded(child: Text(c.source!, style: const TextStyle(color: Forge.textSubtle, fontSize: 11.5), overflow: TextOverflow.ellipsis)),
            ],
          ),
          if (c.interestSummary != null) ...[
            const SizedBox(height: 10),
            Text(c.interestSummary!, style: const TextStyle(color: Forge.textMuted, fontSize: 13, height: 1.5)),
          ],
        ],
      ),
    );
  }
}
