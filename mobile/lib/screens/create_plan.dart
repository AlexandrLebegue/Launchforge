import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Onboarding par IA — chat d'accueil qui interroge puis génère le plan.
class CreatePlanScreen extends StatelessWidget {
 const CreatePlanScreen({super.key});

 @override
 Widget build(BuildContext context) {
 return Scaffold(
 backgroundColor: Forge.bg,
 appBar: AppBar(
 backgroundColor: Forge.bg,
 surfaceTintColor: Colors.transparent,
 elevation: 0,
 shape: const Border(bottom: BorderSide(color: Forge.border)),
 leading: IconButton(icon: const Icon(Icons.close, color: Forge.textMuted), onPressed: () => context.go('/dashboard')),
 title: Text('Nouveau projet', style: display(18)),
 ),
 body: Column(
 children: [
 Expanded(
 child: ListView(
 padding: const EdgeInsets.all(16),
 children: [
 _bot('Bienvenue Je vais vous aider à forger votre plan de lancement. Pour commencer, quel est le nom de votre produit et que fait-il?'),
 _user('Nimbus — un copilote de gestion de projet pour les équipes produit.'),
 _bot('Super! Je recherche Nimbus sur le web…', actions: ['Recherche web : « Nimbus produit »', 'Analyse concurrence']),
 _bot('Compris. Qui est votre client idéal et quel est votre objectif principal pour les 8 prochaines semaines?'),
 ],
 ),
 ),
 Container(
 padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
 decoration: const BoxDecoration(border: Border(top: BorderSide(color: Forge.border))),
 child: Column(
 children: [
 Row(
 children: [
 Expanded(
 child: TextField(
 style: const TextStyle(color: Forge.text),
 decoration: const InputDecoration(hintText: 'Votre réponse…'),
 ),
 ),
 const SizedBox(width: 10),
 Container(
 width: 44,
 height: 44,
 decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
 child: const Icon(Icons.arrow_upward, color: Colors.white),
 ),
 ],
 ),
 const SizedBox(height: 12),
 PrimaryButton('Générer mon plan de lancement', icon: Icons.auto_awesome, glow: true, onPressed: () => context.go('/dashboard')),
 ],
 ),
 ),
 ],
 ),
 );
 }

 Widget _bot(String text, {List<String> actions = const []}) => Padding(
 padding: const EdgeInsets.only(bottom: 14),
 child: Row(
 crossAxisAlignment: CrossAxisAlignment.start,
 children: [
 Container(
 width: 30,
 height: 30,
 decoration: BoxDecoration(gradient: Forge.gradientPrimary, borderRadius: BorderRadius.circular(Forge.r)),
 child: const Icon(Icons.local_fire_department, color: Colors.white, size: 17),
 ),
 const SizedBox(width: 10),
 Flexible(
 child: Column(
 crossAxisAlignment: CrossAxisAlignment.start,
 children: [
 Container(
 padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
 decoration: BoxDecoration(
 color: Forge.surfaceSolid,
 borderRadius: BorderRadius.circular(Forge.rLg),
 border: Border.all(color: Forge.border),
 ),
 child: Text(text, style: const TextStyle(color: Forge.text, fontSize: 14, height: 1.55)),
 ),
 for (final a in actions)
 Padding(padding: const EdgeInsets.only(top: 6), child: Pill(a, color: Forge.textMuted, icon: Icons.bolt)),
 ],
 ),
 ),
 ],
 ),
 );

 Widget _user(String text) => Padding(
 padding: const EdgeInsets.only(bottom: 14),
 child: Row(
 mainAxisAlignment: MainAxisAlignment.end,
 children: [
 Flexible(
 child: Container(
 padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
 decoration: BoxDecoration(
 color: Forge.primaryLight,
 borderRadius: BorderRadius.circular(Forge.rLg),
 border: Border.all(color: Forge.primary.withValues(alpha: 0.4)),
 ),
 child: Text(text, style: const TextStyle(color: Forge.text, fontSize: 14, height: 1.55)),
 ),
 ),
 ],
 ),
 );
}
