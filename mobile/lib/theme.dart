import 'package:flutter/material.dart';

/// Thème « Forge » — anthracite chaud + braise. Repris fidèlement du web
/// (client/src/index.css : variables :root).
class Forge {
  // Couleurs cœur
  static const bg = Color(0xFF121110);
  static const surface = Color(0x07FFF8F0); // rgba(255,248,240,0.025)
  static const surfaceSolid = Color(0xFF1A1816);
  static const surface2 = Color(0x0DFFF8F0); // 0.05
  static const surface3 = Color(0x14FFF8F0); // 0.08
  static const border = Color(0x17FFF4E8); // rgba(255,244,232,0.09)
  static const borderLight = Color(0x0DFFF4E8);
  static const text = Color(0xFFECE7E1);
  static const textMuted = Color(0xFFA39C93);
  static const textSubtle = Color(0xFF6B655E);
  static const primary = Color(0xFFFF6B35);
  static const primaryHover = Color(0xFFFF8557);
  static const primaryLight = Color(0x21FF6B35); // 0.13
  static const success = Color(0xFF34D399);
  static const warning = Color(0xFFFBBF24);
  static const error = Color(0xFFF87171);

  // Braise : jaune chauffé → orange vif → cuivre
  static const gradientPrimary = LinearGradient(
    begin: Alignment(-0.7, -1),
    end: Alignment(0.7, 1),
    colors: [Color(0xFFFF9D4D), Color(0xFFFF6B35), Color(0xFFE8590C)],
    stops: [0.0, 0.55, 1.0],
  );

  static const gradientHero = RadialGradient(
    center: Alignment(0, -1),
    radius: 1.1,
    colors: [Color(0x24FF6B35), Color(0x00121110)],
    stops: [0.0, 0.65],
  );

  // Angles durs — le métal de la forge
  static const r = 3.0;
  static const rLg = 4.0;

  static List<BoxShadow> get cardShadow => const [
        BoxShadow(color: Color(0x66000000), blurRadius: 2, offset: Offset(0, 1)),
        BoxShadow(color: Color(0x59000000), blurRadius: 40, offset: Offset(0, 12)),
      ];

  static List<BoxShadow> glow([double a = 0.16]) => [
        BoxShadow(color: primary.withValues(alpha: a), blurRadius: 20),
      ];

  static const String displayFont = 'SpaceGrotesk';
  static const String bodyFont = 'Inter';

  static TextTheme _textTheme(TextTheme base) =>
      base.apply(fontFamily: bodyFont, bodyColor: text, displayColor: text);

  static ThemeData theme() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      primaryColor: primary,
      colorScheme: const ColorScheme.dark(
        surface: bg,
        primary: primary,
        secondary: primary,
        error: error,
        onPrimary: Colors.white,
        onSurface: text,
      ),
      textTheme: _textTheme(base.textTheme),
      dividerColor: border,
      iconTheme: const IconThemeData(color: textMuted),
      splashColor: primary.withValues(alpha: 0.08),
      highlightColor: primary.withValues(alpha: 0.04),
      tooltipTheme: const TooltipThemeData(
        decoration: BoxDecoration(color: surfaceSolid),
        textStyle: TextStyle(color: text, fontSize: 12),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface2,
        hintStyle: const TextStyle(color: textSubtle),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(r),
          borderSide: const BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(r),
          borderSide: const BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(r),
          borderSide: const BorderSide(color: primary, width: 1.4),
        ),
      ),
    );
  }
}

/// Style d'en-tête display (Space Grotesk).
TextStyle display(double size, {FontWeight w = FontWeight.w700, Color? color}) => TextStyle(
      fontFamily: Forge.displayFont,
      fontSize: size,
      fontWeight: w,
      letterSpacing: -0.02 * size,
      color: color ?? Forge.text,
    );
