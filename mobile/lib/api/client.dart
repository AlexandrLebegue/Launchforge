import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiResult<T> {
  final bool success;
  final T? data;
  final String? error;
  ApiResult({required this.success, this.data, this.error});
}

/// Couche HTTP minimale vers l'API LaunchForge (mêmes routes que le web).
/// L'URL de base est configurable : --dart-define=API_BASE=https://monsite.fr
class Api {
  Api._();
  static final Api instance = Api._();

  static const String base =
      String.fromEnvironment('API_BASE', defaultValue: 'http://localhost:3000');

  String? _token;
  static const _tokenKey = 'launchforge_token';

  Future<void> loadToken() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(_tokenKey);
  }

  String? get token => _token;

  Future<void> setToken(String? t) async {
    _token = t;
    final prefs = await SharedPreferences.getInstance();
    if (t == null) {
      await prefs.remove(_tokenKey);
    } else {
      await prefs.setString(_tokenKey, t);
    }
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Uri _uri(String path) => Uri.parse('$base/api$path');

  Future<ApiResult<dynamic>> _request(String path, {String method = 'GET', Object? body}) async {
    try {
      late http.Response res;
      final uri = _uri(path);
      switch (method) {
        case 'POST':
          res = await http.post(uri, headers: _headers, body: body != null ? jsonEncode(body) : null);
          break;
        case 'PATCH':
          res = await http.patch(uri, headers: _headers, body: body != null ? jsonEncode(body) : null);
          break;
        case 'DELETE':
          res = await http.delete(uri, headers: _headers, body: body != null ? jsonEncode(body) : null);
          break;
        default:
          res = await http.get(uri, headers: _headers);
      }
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiResult(
        success: json['success'] == true,
        data: json['data'],
        error: json['error'],
      );
    } catch (_) {
      return ApiResult(success: false, error: 'Connexion au serveur impossible');
    }
  }

  Future<ApiResult> login(String email, String password) =>
      _request('/auth/login', method: 'POST', body: {'email': email, 'password': password});
  Future<ApiResult> register(String email, String password, String name) =>
      _request('/auth/register', method: 'POST', body: {'email': email, 'password': password, 'name': name});
  Future<ApiResult> getMe() => _request('/auth/me');
  Future<ApiResult> getOverview() => _request('/overview');
  Future<ApiResult> getPlan(String id) => _request('/plan/$id');
  Future<ApiResult> getPosts() => _request('/posts');
  Future<ApiResult> getKnowledge() => _request('/knowledge');
  Future<ApiResult> getContacts() => _request('/contacts');
  Future<ApiResult> getApprovals() => _request('/approvals');
  Future<ApiResult> getApprovalHistory() => _request('/approvals/history');
  Future<ApiResult> getPerformance() => _request('/content/performance');
  Future<ApiResult> getConfigStatus() => _request('/config/status');
}
