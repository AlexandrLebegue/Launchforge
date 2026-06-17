import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'theme.dart';
import 'state/app_state.dart';
import 'widgets/app_scaffold.dart';
import 'screens/landing.dart';
import 'screens/auth.dart';
import 'screens/dashboard.dart';
import 'screens/content_hub.dart';
import 'screens/calendar.dart';
import 'screens/assistant.dart';
import 'screens/performance.dart';
import 'screens/knowledge.dart';
import 'screens/approvals.dart';
import 'screens/config.dart';
import 'screens/create_plan.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('fr');
  final state = AppState();
  await state.boot();
  runApp(LaunchForgeApp(state: state));
}

class LaunchForgeApp extends StatelessWidget {
  final AppState state;
  const LaunchForgeApp({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: state,
      child: Builder(builder: (context) {
        final router = _router(context.read<AppState>());
        return MaterialApp.router(
          title: 'LaunchForge',
          debugShowCheckedModeBanner: false,
          theme: Forge.theme(),
          routerConfig: router,
        );
      }),
    );
  }
}

/// Page de section authentifiée, enveloppée dans la coque applicative.
Widget _shell(String path, String title, Widget child, {Widget? fab}) =>
    AppScaffold(currentPath: path, title: title, floatingActionButton: fab, child: child);

GoRouter _router(AppState app) {
  return GoRouter(
    initialLocation: app.authenticated ? '/dashboard' : '/',
    refreshListenable: app,
    redirect: (context, state) {
      final loc = state.matchedLocation;
      final isPublic = loc == '/login' || loc == '/register' || loc == '/';
      if (!app.authenticated && !isPublic) return '/';
      if (app.authenticated && isPublic) return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const LandingScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
      GoRoute(path: '/plan', builder: (_, __) => const CreatePlanScreen()),
      GoRoute(path: '/dashboard', builder: (_, __) => _shell('/dashboard', 'LaunchForge', const DashboardScreen())),
      GoRoute(
        path: '/content',
        builder: (ctx, __) => _shell('/content', 'Contenu', const ContentHubScreen(),
            fab: FloatingActionButton.extended(
              backgroundColor: Forge.primary,
              foregroundColor: Colors.white,
              onPressed: () {},
              icon: const Icon(Icons.add),
              label: const Text('Nouveau post'),
            )),
      ),
      GoRoute(path: '/calendar', builder: (_, __) => _shell('/calendar', 'Calendrier', const CalendarScreen())),
      GoRoute(path: '/assistant', builder: (_, __) => _shell('/assistant', 'Assistant', const AssistantScreen())),
      GoRoute(path: '/performance', builder: (_, __) => _shell('/performance', 'Performances', const PerformanceScreen())),
      GoRoute(path: '/knowledge', builder: (_, __) => _shell('/knowledge', 'Connaissances', const KnowledgeScreen())),
      GoRoute(path: '/approvals', builder: (_, __) => _shell('/approvals', 'Validations', const ApprovalsScreen())),
      GoRoute(path: '/config', builder: (_, __) => _shell('/config', 'Configuration', const ConfigScreen())),
    ],
  );
}
