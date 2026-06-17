import 'package:flutter/material.dart';
import '../theme.dart';

/// Carte « forge » : surface, bordure fine, angles durs.
class ForgeCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? borderColor;
  const ForgeCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.onTap,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    final card = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: Forge.surfaceSolid,
        border: Border.all(color: borderColor ?? Forge.border),
        borderRadius: BorderRadius.circular(Forge.rLg),
      ),
      child: child,
    );
    if (onTap == null) return card;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(Forge.rLg),
      child: card,
    );
  }
}

/// Titre de carte/section.
class CardHeader extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const CardHeader(this.text, {super.key, this.trailing});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Forge.text)),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Bouton primaire (dégradé braise).
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool large;
  final bool glow;
  const PrimaryButton(this.label, {super.key, this.onPressed, this.icon, this.large = false, this.glow = false});

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: onPressed == null ? 0.55 : 1,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: Forge.gradientPrimary,
          borderRadius: BorderRadius.circular(Forge.r),
          boxShadow: [
            BoxShadow(color: Forge.primary.withValues(alpha: glow ? 0.45 : 0.35), blurRadius: glow ? 22 : 12, offset: const Offset(0, 2)),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(Forge.r),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: large ? 28 : 20, vertical: large ? 15 : 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[Icon(icon, size: 18, color: Colors.white), const SizedBox(width: 8)],
                  Text(label,
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: large ? 16 : 14, letterSpacing: -0.01)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Bouton fantôme (contour).
class GhostButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  const GhostButton(this.label, {super.key, this.onPressed, this.icon});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(Forge.r),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            border: Border.all(color: Forge.border),
            borderRadius: BorderRadius.circular(Forge.r),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 16, color: Forge.textMuted), const SizedBox(width: 7)],
              Text(label, style: const TextStyle(color: Forge.textMuted, fontWeight: FontWeight.w600, fontSize: 13.5)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Petite étiquette pilule.
class Pill extends StatelessWidget {
  final String text;
  final Color color;
  final Color? bg;
  final IconData? icon;
  const Pill(this.text, {super.key, this.color = Forge.primary, this.bg, this.icon});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg ?? color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(3),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: color), const SizedBox(width: 5)],
          Text(text, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// Titre de page (display).
class PageTitle extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  const PageTitle(this.title, {super.key, this.subtitle, this.trailing});
  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: display(24)),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(subtitle!, style: const TextStyle(fontSize: 13.5, color: Forge.textMuted)),
              ],
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

/// État vide.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  final Widget? action;
  const EmptyState({super.key, required this.icon, required this.title, required this.body, this.action});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                gradient: Forge.gradientPrimary,
                borderRadius: BorderRadius.circular(Forge.rLg),
                boxShadow: Forge.glow(0.3),
              ),
              child: Icon(icon, color: Colors.white, size: 34),
            ),
            const SizedBox(height: 20),
            Text(title, style: display(20), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(body, style: const TextStyle(color: Forge.textMuted, height: 1.6), textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 22), action!],
          ],
        ),
      ),
    );
  }
}

String statusLabel(String s) => switch (s) {
      'idea' => 'Idée',
      'draft' => 'Brouillon',
      'scheduled' => 'Programmé',
      'published' => 'Publié',
      _ => s,
    };

Color statusColor(String s) => switch (s) {
      'idea' => Forge.textMuted,
      'draft' => Forge.warning,
      'scheduled' => Forge.primary,
      'published' => Forge.success,
      _ => Forge.textMuted,
    };
