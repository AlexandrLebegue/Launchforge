import 'package:flutter/foundation.dart';
import '../api/client.dart';
import '../api/demo_data.dart';
import '../api/models.dart';

/// Mode démonstration : données fictives, aucune dépendance réseau.
/// Activé avec --dart-define=DEMO=true (utilisé pour les captures).
const bool kDemo = bool.fromEnvironment('DEMO', defaultValue: false);

class AppState extends ChangeNotifier {
  final Api api = Api.instance;

  bool booting = true;
  User? user;

  Overview? overview;
  LaunchPlan? plan;
  List<Post> posts = [];
  List<KnowledgeEntry> knowledge = [];
  List<Contact> contacts = [];
  List<ApprovalItem> approvals = [];
  List<ApprovalItem> approvalHistory = [];
  PerformanceSeries? performance;
  String campaignReport = '';
  List<ConfigToolkit> toolkits = [];
  List<ChatMessage> assistantThread = [];

  bool get authenticated => user != null;

  Future<void> boot() async {
    if (kDemo) {
      _seedDemo();
      booting = false;
      notifyListeners();
      return;
    }
    await api.loadToken();
    if (api.token != null) {
      final res = await api.getMe();
      if (res.success && res.data != null) {
        user = User.fromJson(res.data);
        await loadAll();
      } else {
        await api.setToken(null);
      }
    }
    booting = false;
    notifyListeners();
  }

  void _seedDemo() {
    user = Demo.user;
    overview = Demo.overview;
    plan = Demo.plan;
    posts = Demo.posts;
    knowledge = Demo.knowledge;
    contacts = Demo.contacts;
    approvals = Demo.approvals;
    approvalHistory = Demo.approvalHistory;
    performance = Demo.performance;
    campaignReport = Demo.campaignReport;
    toolkits = Demo.toolkits;
    assistantThread = List.from(Demo.assistantThread);
  }

  Future<String?> login(String email, String password) async {
    final res = await api.login(email, password);
    if (res.success && res.data != null) {
      await api.setToken(res.data['token']);
      user = User.fromJson(res.data['user']);
      await loadAll();
      notifyListeners();
      return null;
    }
    return res.error ?? 'Connexion impossible';
  }

  Future<String?> register(String email, String password, String name) async {
    final res = await api.register(email, password, name);
    if (res.success && res.data != null) {
      await api.setToken(res.data['token']);
      user = User.fromJson(res.data['user']);
      await loadAll();
      notifyListeners();
      return null;
    }
    return res.error ?? 'Inscription impossible';
  }

  void resolveApproval(String id) {
    approvals.removeWhere((a) => a.id == id);
    notifyListeners();
  }

  Future<void> logout() async {
    await api.setToken(null);
    user = null;
    overview = null;
    plan = null;
    posts = [];
    knowledge = [];
    contacts = [];
    approvals = [];
    notifyListeners();
  }

  /// Charge l'ensemble des données du projet actif (best-effort, en parallèle).
  Future<void> loadAll() async {
    final results = await Future.wait([
      api.getOverview(),
      api.getPosts(),
      api.getKnowledge(),
      api.getContacts(),
      api.getApprovals(),
      api.getApprovalHistory(),
      api.getPerformance(),
      api.getConfigStatus(),
    ]);

    final ov = results[0];
    if (ov.success && ov.data != null) {
      overview = Overview.fromJson(ov.data);
      if (overview!.project != null) {
        final pl = await api.getPlan(overview!.project!.id);
        if (pl.success && pl.data != null) plan = LaunchPlan.fromJson(pl.data);
      }
    }
    if (results[1].success && results[1].data is List) {
      posts = (results[1].data as List).map((e) => Post.fromJson(e)).toList();
    }
    if (results[2].success && results[2].data is List) {
      knowledge = (results[2].data as List).map((e) => KnowledgeEntry.fromJson(e)).toList();
    }
    if (results[3].success && results[3].data is List) {
      contacts = (results[3].data as List).map((e) => Contact.fromJson(e)).toList();
    }
    if (results[4].success && results[4].data is List) {
      approvals = (results[4].data as List).map((e) => ApprovalItem.fromJson(e)).toList();
    }
    if (results[5].success && results[5].data is List) {
      approvalHistory = (results[5].data as List).map((e) => ApprovalItem.fromJson(e)).toList();
    }
    if (results[6].success && results[6].data != null) {
      performance = PerformanceSeries.fromJson(results[6].data);
    }
    if (results[7].success && results[7].data != null) {
      final composio = results[7].data['composio'];
      if (composio != null && composio['toolkits'] is List) {
        toolkits = (composio['toolkits'] as List).map((e) => ConfigToolkit.fromJson(e)).toList();
      }
    }
  }
}
