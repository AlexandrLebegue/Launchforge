import 'package:flutter/material.dart';

/// Pastille de plateforme — reprend client/src/components/PlatformIcon.tsx
class PlatformIcon extends StatelessWidget {
  final String platform;
  final double size;
  const PlatformIcon(this.platform, {super.key, this.size = 28});

  static const Map<String, ({Color bg, String glyph})> _map = {
    'linkedin': (bg: Color(0xFF0A66C2), glyph: 'in'),
    'twitter': (bg: Color(0xFF111111), glyph: '𝕏'),
    'x': (bg: Color(0xFF111111), glyph: '𝕏'),
    'facebook': (bg: Color(0xFF1877F2), glyph: 'f'),
    'reddit': (bg: Color(0xFFFF4500), glyph: 'r/'),
    'youtube': (bg: Color(0xFFFF0000), glyph: '▶'),
    'tiktok': (bg: Color(0xFF111111), glyph: '♪'),
    'blog': (bg: Color(0xFF475569), glyph: 'B'),
    'newsletter': (bg: Color(0xFF7C5E3C), glyph: '@'),
    'producthunt': (bg: Color(0xFFDA552F), glyph: 'P'),
    'hackernews': (bg: Color(0xFFFF6600), glyph: 'Y'),
    'indiehackers': (bg: Color(0xFF1F364D), glyph: 'IH'),
    'discord': (bg: Color(0xFF5865F2), glyph: 'D'),
    'slack': (bg: Color(0xFF611F69), glyph: 'S'),
    'github': (bg: Color(0xFF24292F), glyph: 'GH'),
  };

  @override
  Widget build(BuildContext context) {
    final key = platform.toLowerCase();
    final entry = _map[key];
    final isInsta = key == 'instagram';
    final glyph = entry?.glyph ?? (platform.isNotEmpty ? platform[0].toUpperCase() : '?');
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: isInsta ? null : (entry?.bg ?? const Color(0x14FFF8F0)),
        gradient: isInsta
            ? const LinearGradient(
                begin: Alignment.bottomLeft,
                end: Alignment.topRight,
                colors: [Color(0xFFF58529), Color(0xFFDD2A7B), Color(0xFF8134AF)],
              )
            : null,
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(
        glyph,
        style: TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: size * (glyph.length > 1 ? 0.34 : 0.46),
          height: 1,
        ),
      ),
    );
  }
}
