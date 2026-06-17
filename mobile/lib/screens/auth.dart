import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(text: 'sarah@nimbus.io');
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await context.read<AppState>().login(_email.text.trim(), _password.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (err == null) {
      context.go('/dashboard');
    } else {
      setState(() => _error = err);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthShell(
      title: 'Bon retour !',
      subtitle: 'Connectez-vous à votre compte LaunchForge',
      error: _error,
      fields: [
        _Field(label: 'Email', controller: _email, hint: 'vous@exemple.fr', keyboard: TextInputType.emailAddress),
        _Field(label: 'Mot de passe', controller: _password, hint: '••••••••', obscure: true),
      ],
      submitLabel: _busy ? 'Connexion…' : 'Se connecter',
      onSubmit: _busy ? null : _submit,
      footer: Column(
        children: [
          const SizedBox(height: 18),
          GestureDetector(
            onTap: () {},
            child: const Text('Mot de passe oublié ?', style: TextStyle(color: Forge.primary, fontSize: 13)),
          ),
          const SizedBox(height: 14),
          Wrap(
            alignment: WrapAlignment.center,
            children: [
              const Text('Pas encore de compte ? ', style: TextStyle(color: Forge.textMuted, fontSize: 13)),
              GestureDetector(
                onTap: () => context.go('/register'),
                child: const Text('Créez-en un gratuitement', style: TextStyle(color: Forge.primary, fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await context.read<AppState>().register(_email.text.trim(), _password.text, _name.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    if (err == null) {
      context.go('/dashboard');
    } else {
      setState(() => _error = err);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthShell(
      title: 'Créez votre compte',
      subtitle: 'Forgez votre plan de lancement en quelques minutes',
      error: _error,
      fields: [
        _Field(label: 'Nom', controller: _name, hint: 'Votre nom'),
        _Field(label: 'Email', controller: _email, hint: 'vous@exemple.fr', keyboard: TextInputType.emailAddress),
        _Field(label: 'Mot de passe', controller: _password, hint: '8 caractères minimum', obscure: true),
      ],
      submitLabel: _busy ? 'Création…' : 'Créer mon compte',
      onSubmit: _busy ? null : _submit,
      footer: Column(
        children: [
          const SizedBox(height: 18),
          Wrap(
            alignment: WrapAlignment.center,
            children: [
              const Text('Déjà un compte ? ', style: TextStyle(color: Forge.textMuted, fontSize: 13)),
              GestureDetector(
                onTap: () => context.go('/login'),
                child: const Text('Se connecter', style: TextStyle(color: Forge.primary, fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Field {
  final String label, hint;
  final TextEditingController controller;
  final bool obscure;
  final TextInputType? keyboard;
  _Field({required this.label, required this.controller, required this.hint, this.obscure = false, this.keyboard});
}

class _AuthShell extends StatelessWidget {
  final String title, subtitle, submitLabel;
  final String? error;
  final List<_Field> fields;
  final VoidCallback? onSubmit;
  final Widget footer;
  const _AuthShell({
    required this.title,
    required this.subtitle,
    required this.fields,
    required this.submitLabel,
    required this.onSubmit,
    required this.footer,
    this.error,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Forge.bg,
      body: Container(
        decoration: const BoxDecoration(gradient: Forge.gradientHero),
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Container(
                padding: const EdgeInsets.all(28),
                decoration: BoxDecoration(
                  color: Forge.surfaceSolid,
                  border: Border.all(color: Forge.border),
                  borderRadius: BorderRadius.circular(Forge.rLg),
                  boxShadow: Forge.cardShadow,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.rLg), boxShadow: Forge.glow(0.3)),
                        child: const Icon(Icons.local_fire_department, color: Colors.white, size: 30),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(title, textAlign: TextAlign.center, style: display(23)),
                    const SizedBox(height: 6),
                    Text(subtitle, textAlign: TextAlign.center, style: const TextStyle(color: Forge.textMuted, fontSize: 13.5)),
                    const SizedBox(height: 22),
                    if (error != null)
                      Container(
                        margin: const EdgeInsets.only(bottom: 16),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: const Color(0x1AEF4444),
                          border: Border.all(color: const Color(0x4DEF4444)),
                          borderRadius: BorderRadius.circular(Forge.r),
                        ),
                        child: Text(error!, style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 13)),
                      ),
                    for (final f in fields) ...[
                      Text(f.label.toUpperCase(),
                          style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Forge.textMuted, letterSpacing: 0.4)),
                      const SizedBox(height: 6),
                      TextField(
                        controller: f.controller,
                        obscureText: f.obscure,
                        keyboardType: f.keyboard,
                        style: const TextStyle(color: Forge.text),
                        decoration: InputDecoration(hintText: f.hint),
                      ),
                      const SizedBox(height: 16),
                    ],
                    const SizedBox(height: 4),
                    PrimaryButton(submitLabel, onPressed: onSubmit, icon: Icons.arrow_forward),
                    footer,
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
