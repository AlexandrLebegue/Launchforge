import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';

class NavDest {
  final String path, label;
  final IconData icon;
  const NavDest(this.path, this.label, this.icon);
}

const primaryNav = [
  NavDest('/dashboard', 'Accueil', Icons.dashboard_outlined),
  NavDest('/content', 'Contenu', Icons.campaign_outlined),
  NavDest('/assistant', 'Assistant', Icons.forum_outlined),
  NavDest('/performance', 'Perfs', Icons.trending_up),
  NavDest('/knowledge', 'Savoir', Icons.menu_book_outlined),
];

const drawerNav = [
  NavDest('/dashboard', 'Tableau de bord', Icons.dashboard_outlined),
  NavDest('/content', 'Hub de contenu', Icons.campaign_outlined),
  NavDest('/calendar', 'Calendrier', Icons.calendar_month_outlined),
  NavDest('/assistant', 'Assistant', Icons.forum_outlined),
  NavDest('/performance', 'Performances', Icons.trending_up),
  NavDest('/knowledge', 'Connaissances', Icons.menu_book_outlined),
  NavDest('/approvals', 'Validations', Icons.fact_check_outlined),
  NavDest('/config', 'Configuration', Icons.settings_outlined),
];

/// Coque applicative : barre supérieure « braise », contenu, navigation basse,
/// tiroir latéral listant toutes les sections + sélecteur de projet.
class AppScaffold extends StatelessWidget {
  final String currentPath;
  final String title;
  final Widget child;
  final Widget? floatingActionButton;
  const AppScaffold({
    super.key,
    required this.currentPath,
    required this.title,
    required this.child,
    this.floatingActionButton,
  });

  int get _navIndex {
    final i = primaryNav.indexWhere((d) => d.path == currentPath);
    return i < 0 ? 0 : i;
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final approvals = app.overview?.approvals ?? 0;
    return Scaffold(
      backgroundColor: Forge.bg,
      appBar: AppBar(
        backgroundColor: Forge.bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: const Border(bottom: BorderSide(color: Forge.border)),
        title: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
              child: const Icon(Icons.local_fire_department, color: Colors.white, size: 19),
            ),
            const SizedBox(width: 10),
            Text(title, style: display(18)),
          ],
        ),
        actions: [
          if (approvals > 0)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: IconButton(
                onPressed: () => context.go('/approvals'),
                icon: Badge(
                  label: Text('$approvals'),
                  backgroundColor: Forge.primary,
                  child: const Icon(Icons.notifications_outlined, color: Forge.textMuted),
                ),
              ),
            ),
        ],
      ),
      drawer: _ForgeDrawer(currentPath: currentPath),
      body: child,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Forge.border))),
        child: NavigationBarTheme(
          data: NavigationBarThemeData(
            backgroundColor: Forge.surfaceSolid,
            indicatorColor: Forge.primaryLight,
            labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: s.contains(WidgetState.selected) ? Forge.primary : Forge.textMuted,
                )),
            iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(
                  color: s.contains(WidgetState.selected) ? Forge.primary : Forge.textMuted,
                  size: 23,
                )),
          ),
          child: NavigationBar(
            height: 64,
            selectedIndex: _navIndex,
            onDestinationSelected: (i) => context.go(primaryNav[i].path),
            destinations: [
              for (final d in primaryNav) NavigationDestination(icon: Icon(d.icon), label: d.label),
            ],
          ),
        ),
      ),
    );
  }
}

class _ForgeDrawer extends StatelessWidget {
  final String currentPath;
  const _ForgeDrawer({required this.currentPath});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final user = app.user;
    final project = app.overview?.project;
    return Drawer(
      backgroundColor: Forge.surfaceSolid,
      shape: const Border(right: BorderSide(color: Forge.border)),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 10),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
                    child: const Icon(Icons.local_fire_department, color: Colors.white, size: 21),
                  ),
                  const SizedBox(width: 10),
                  RichText(
                    text: TextSpan(
                      style: display(19),
                      children: const [
                        TextSpan(text: 'Launch'),
                        TextSpan(text: 'Forge', style: TextStyle(color: Forge.primary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (project != null)
              Container(
                margin: const EdgeInsets.fromLTRB(14, 6, 14, 6),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Forge.surface2,
                  borderRadius: BorderRadius.circular(Forge.r),
                  border: Border.all(color: Forge.border),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: Forge.primaryLight, borderRadius: BorderRadius.circular(Forge.r)),
                      child: Text(project.productName[0], style: const TextStyle(color: Forge.primary, fontWeight: FontWeight.w700)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(project.productName, style: const TextStyle(fontWeight: FontWeight.w700, color: Forge.text)),
                          Text('Projet actif', style: const TextStyle(fontSize: 11.5, color: Forge.textMuted)),
                        ],
                      ),
                    ),
                    const Icon(Icons.circle, size: 9, color: Forge.success),
                  ],
                ),
              ),
            const Divider(color: Forge.border, height: 18),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                children: [
                  for (final d in drawerNav) _drawerItem(context, d),
                ],
              ),
            ),
            const Divider(color: Forge.border, height: 8),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Forge.primary,
                    radius: 18,
                    child: Text(
                      (user?.name ?? user?.email ?? '?')[0].toUpperCase(),
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.name ?? 'Utilisateur',
                            style: const TextStyle(fontWeight: FontWeight.w600, color: Forge.text), overflow: TextOverflow.ellipsis),
                        const Text('Founder', style: TextStyle(fontSize: 11.5, color: Forge.textMuted)),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Déconnexion',
                    icon: const Icon(Icons.logout, color: Forge.textMuted, size: 20),
                    onPressed: () async {
                      await context.read<AppState>().logout();
                      if (context.mounted) context.go('/login');
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _drawerItem(BuildContext context, NavDest d) {
    final active = currentPath == d.path;
    final app = context.read<AppState>();
    final badge = d.path == '/approvals' ? (app.overview?.approvals ?? 0) : 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Material(
        color: active ? Forge.primaryLight : Colors.transparent,
        borderRadius: BorderRadius.circular(Forge.r),
        child: InkWell(
          borderRadius: BorderRadius.circular(Forge.r),
          onTap: () {
            Navigator.pop(context);
            context.go(d.path);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(
              children: [
                Icon(d.icon, size: 19, color: active ? Forge.primary : Forge.textMuted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(d.label,
                      style: TextStyle(
                        color: active ? Forge.text : Forge.textMuted,
                        fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                        fontSize: 14,
                      )),
                ),
                if (badge > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(color: Forge.primary, borderRadius: BorderRadius.circular(20)),
                    child: Text('$badge', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
