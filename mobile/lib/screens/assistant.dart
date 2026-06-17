import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme.dart';
import '../state/app_state.dart';
import '../api/models.dart';
import '../widgets/common.dart';

class AssistantScreen extends StatefulWidget {
 const AssistantScreen({super.key});
 @override
 State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
 final _input = TextEditingController();
 final _scroll = ScrollController();

 static const _suggestions = [
 (Icons.insights_outlined, 'Où en est-on?'),
 (Icons.edit_outlined, 'Rédiger un post'),
 (Icons.mail_outline, 'Lire mes mails'),
 (Icons.lightbulb_outline, 'Idées de contenu'),
 (Icons.event_outlined, 'Planifier ma semaine'),
 (Icons.track_changes, 'Analyser mes leads'),
 ];

 void _send(String text) {
 if (text.trim().isEmpty) return;
 final app = context.read<AppState>();
 setState(() {
 app.assistantThread.add(ChatMessage(role: 'user', text: text.trim()));
 app.assistantThread.add(ChatMessage(
 role: 'assistant',
 text:
 'Bonne idée! Je travaille là-dessus pour **Nimbus** en m\'appuyant sur votre base de connaissances et vos posts récents…',
 actions: ['Lecture base de connaissances'],
 ));
 });
 _input.clear();
 WidgetsBinding.instance.addPostFrameCallback((_) {
 if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
 });
 }

 @override
 Widget build(BuildContext context) {
 final app = context.watch<AppState>();
 final thread = app.assistantThread;

 return Column(
 children: [
 Expanded(
 child: thread.isEmpty
? _welcome()
 : ListView(
 controller: _scroll,
 padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
 children: [for (final m in thread) _Bubble(m)],
 ),
 ),
 // Suggestions
 SizedBox(
 height: 38,
 child: ListView.separated(
 scrollDirection: Axis.horizontal,
 padding: const EdgeInsets.symmetric(horizontal: 16),
 itemCount: _suggestions.length,
 separatorBuilder: (_, __) => const SizedBox(width: 8),
 itemBuilder: (_, i) {
 final s = _suggestions[i];
 return GestureDetector(
 onTap: () => _send(s.$2),
 child: Container(
 alignment: Alignment.center,
 padding: const EdgeInsets.symmetric(horizontal: 14),
 decoration: BoxDecoration(
 color: Forge.surface2,
 borderRadius: BorderRadius.circular(Forge.r),
 border: Border.all(color: Forge.border),
 ),
 child: Row(
 mainAxisSize: MainAxisSize.min,
 children: [
 Icon(s.$1, size: 15, color: Forge.primary),
 const SizedBox(width: 7),
 Text(s.$2, style: const TextStyle(color: Forge.text, fontSize: 13)),
 ],
 ),
 ),
 );
 },
 ),
 ),
 // Saisie
 Container(
 padding: const EdgeInsets.fromLTRB(16, 10, 12, 16),
 decoration: const BoxDecoration(border: Border(top: BorderSide(color: Forge.border))),
 child: Row(
 crossAxisAlignment: CrossAxisAlignment.end,
 children: [
 IconButton(onPressed: () {}, icon: const Icon(Icons.attach_file, color: Forge.textMuted, size: 22)),
 Expanded(
 child: TextField(
 controller: _input,
 minLines: 1,
 maxLines: 4,
 style: const TextStyle(color: Forge.text),
 textInputAction: TextInputAction.send,
 onSubmitted: _send,
 decoration: const InputDecoration(hintText: 'Demandez en langage naturel…'),
 ),
 ),
 const SizedBox(width: 8),
 GestureDetector(
 onTap: () => _send(_input.text),
 child: Container(
 width: 44,
 height: 44,
 decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r), boxShadow: Forge.glow(0.35)),
 child: const Icon(Icons.arrow_upward, color: Colors.white, size: 22),
 ),
 ),
 ],
 ),
 ),
 ],
 );
 }

 Widget _welcome() => Center(
 child: Padding(
 padding: const EdgeInsets.all(32),
 child: Column(
 mainAxisSize: MainAxisSize.min,
 children: [
 Container(
 width: 64,
 height: 64,
 decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.rLg), boxShadow: Forge.glow(0.3)),
 child: const Icon(Icons.local_fire_department, color: Colors.white, size: 32),
 ),
 const SizedBox(height: 18),
 Text('Votre assistant LaunchForge', style: display(20), textAlign: TextAlign.center),
 const SizedBox(height: 8),
 const Text('Rédiger, publier, analyser, planifier — demandez en langage naturel.',
 style: TextStyle(color: Forge.textMuted, height: 1.6), textAlign: TextAlign.center),
 ],
 ),
 ),
 );
}

class _Bubble extends StatelessWidget {
 final ChatMessage m;
 const _Bubble(this.m);

 @override
 Widget build(BuildContext context) {
 final isUser = m.role == 'user';
 return Padding(
 padding: const EdgeInsets.only(bottom: 14),
 child: Row(
 mainAxisAlignment: isUser? MainAxisAlignment.end : MainAxisAlignment.start,
 crossAxisAlignment: CrossAxisAlignment.start,
 children: [
 if (!isUser)...[
 Container(
 width: 30,
 height: 30,
 decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
 child: const Icon(Icons.local_fire_department, color: Colors.white, size: 17),
 ),
 const SizedBox(width: 10),
 ],
 Flexible(
 child: Column(
 crossAxisAlignment: isUser? CrossAxisAlignment.end : CrossAxisAlignment.start,
 children: [
 Container(
 padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
 decoration: BoxDecoration(
 color: isUser? Forge.primaryLight : Forge.surfaceSolid,
 borderRadius: BorderRadius.circular(Forge.rLg),
 border: Border.all(color: isUser? Forge.primary.withValues(alpha: 0.4) : Forge.border),
 ),
 child: _RichText(m.text, color: Forge.text),
 ),
 for (final a in m.actions)
 Padding(
 padding: const EdgeInsets.only(top: 6),
 child: Pill(a, color: Forge.textMuted, icon: Icons.bolt),
 ),
 ],
 ),
 ),
 if (isUser) const SizedBox(width: 10),
 ],
 ),
 );
 }
}

/// Rendu **gras** minimaliste (markdown léger).
class _RichText extends StatelessWidget {
 final String text;
 final Color color;
 const _RichText(this.text, {required this.color});
 @override
 Widget build(BuildContext context) {
 final spans = <TextSpan>[];
 final re = RegExp(r'\*\*(.+?)\*\*');
 int last = 0;
 for (final m in re.allMatches(text)) {
 if (m.start > last) spans.add(TextSpan(text: text.substring(last, m.start)));
 spans.add(TextSpan(text: m.group(1), style: const TextStyle(fontWeight: FontWeight.w700)));
 last = m.end;
 }
 if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
 return RichText(
 text: TextSpan(style: TextStyle(fontFamily: Forge.bodyFont, color: color, fontSize: 14, height: 1.55), children: spans),
 );
 }
}
