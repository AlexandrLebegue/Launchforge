/**
 * Présentations Marp — l'IA génère le markdown Marp, le rendu HTML se fait
 * localement (marp-core, sans navigateur). Le mode « Présenter » du deck HTML
 * offre des transitions fluides plein écran ; l'export PPTX/PDF se fait via
 * l'impression du navigateur (Ctrl+P → PDF) ou Marp CLI si Chrome est présent.
 *
 * Thèmes : intégrés Marp (default/gaia/uncover) + thèmes maison + thème
 * custom généré par l'IA (stocké par utilisateur, réglé dans Configuration).
 */

import Marp from '@marp-team/marp-core';
import { chatComplete, isAIConfigured } from './aiClient';
import { buildCompanyContext, buildKnowledgeContext } from './contentAssistant';
import { storage } from './storage';

export { isAIConfigured };

/** Thèmes maison — CSS Marp complets, sobres et très lisibles */
export const CUSTOM_THEMES: Record<string, { label: string; css: string }> = {
  launchforge: {
    label: 'LaunchForge (sombre violet)',
    css: `/* @theme launchforge */
@import 'default';
section {
  background: linear-gradient(135deg, #0f0d1a 0%, #1a1430 100%);
  color: #e8e6f0;
  font-family: 'Avenir Next', 'Segoe UI', system-ui, sans-serif;
  padding: 70px;
}
h1, h2 { color: #ffffff; letter-spacing: -0.02em; }
h1 { font-size: 1.7em; border-bottom: 4px solid #7c5cfc; padding-bottom: 0.25em; }
h2 { font-size: 1.25em; }
strong { color: #a78bfa; }
a { color: #8b9cf9; }
code { background: rgba(124, 92, 252, 0.18); color: #c4b5fd; border-radius: 6px; padding: 0.1em 0.4em; }
blockquote { border-left: 5px solid #7c5cfc; color: #b8b3cc; font-style: italic; }
ul li::marker, ol li::marker { color: #7c5cfc; }
section.lead { text-align: center; justify-content: center; }
section.lead h1 { border: none; font-size: 2.2em; }
footer, header { color: #6b6585; }
`,
  },
  'clean-light': {
    label: 'Clean (clair épuré)',
    css: `/* @theme clean-light */
@import 'default';
section {
  background: #fcfcfd;
  color: #1c1e26;
  font-family: 'Avenir Next', 'Segoe UI', system-ui, sans-serif;
  padding: 70px;
}
h1 { color: #111; font-size: 1.7em; letter-spacing: -0.02em; }
h1::after { content: ''; display: block; width: 80px; height: 5px; background: #2563eb; margin-top: 0.3em; border-radius: 3px; }
h2 { color: #1d4ed8; font-size: 1.2em; }
strong { color: #2563eb; }
blockquote { border-left: 5px solid #2563eb; color: #555; }
section.lead { text-align: center; justify-content: center; }
section.lead h1::after { margin-left: auto; margin-right: auto; }
`,
  },
  'bold-gradient': {
    label: 'Bold (dégradé énergique)',
    css: `/* @theme bold-gradient */
@import 'default';
section {
  background: linear-gradient(120deg, #4f46e5 0%, #9333ea 55%, #db2777 100%);
  color: #ffffff;
  font-family: 'Avenir Next', 'Segoe UI', system-ui, sans-serif;
  padding: 70px;
}
h1, h2 { color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,0.25); letter-spacing: -0.02em; }
h1 { font-size: 1.9em; }
strong { color: #fde68a; }
a { color: #c7d2fe; }
blockquote { border-left: 5px solid rgba(255,255,255,0.6); color: rgba(255,255,255,0.9); }
section.lead { text-align: center; justify-content: center; }
`,
  },
};

export const BUILTIN_THEMES = ['default', 'gaia', 'uncover'] as const;

export function availableThemes(): { value: string; label: string }[] {
  return [
    ...Object.entries(CUSTOM_THEMES).map(([value, t]) => ({ value, label: t.label })),
    ...BUILTIN_THEMES.map((t) => ({ value: t, label: `Marp ${t}` })),
    { value: 'custom', label: 'Mon thème IA (à générer ci-dessous)' },
  ];
}

/** Thème effectif de l'utilisateur : nom + CSS additionnel éventuel */
export function themeForUser(userId: string): { theme: string; css: string | null } {
  const pref = storage.getMarpTheme(userId);
  if (pref.theme === 'custom' && pref.customCss) {
    return { theme: 'custom-user', css: pref.customCss };
  }
  if (CUSTOM_THEMES[pref.theme]) {
    return { theme: pref.theme, css: CUSTOM_THEMES[pref.theme].css };
  }
  if ((BUILTIN_THEMES as readonly string[]).includes(pref.theme)) {
    return { theme: pref.theme, css: null };
  }
  return { theme: 'launchforge', css: CUSTOM_THEMES.launchforge.css };
}

/** Rend un deck Marp en page HTML autonome (présentation plein écran) */
export function renderDeckHtml(markdown: string, theme: string, customCss: string | null): string {
  const marp = new Marp({ html: true });
  let themeName = theme;
  if (customCss) {
    try {
      marp.themeSet.add(customCss);
      themeName = customCss.match(/@theme\s+([\w-]+)/)?.[1] ?? theme;
    } catch { themeName = 'default'; }
  }
  // Le thème est imposé ici via le front-matter (l'IA n'a pas à le connaître)
  const md = markdown.replace(/^---\n/, `---\ntheme: ${themeName}\n`);
  const { html, css } = marp.render(md);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Présentation LaunchForge</title>
<style>${css}
  body { margin: 0; background: #111; }
  .marpit > svg { display: none; width: 100vw; height: 100vh; }
  .marpit > svg.active { display: block; }
  #deck-nav { position: fixed; bottom: 14px; right: 18px; z-index: 10; color: #aaa;
    font: 13px system-ui; background: rgba(0,0,0,0.55); padding: 6px 12px; border-radius: 8px; }
  @media print {
    .marpit > svg { display: block !important; opacity: 1 !important; width: 100%; height: auto; page-break-after: always; }
    #deck-nav { display: none; }
    body { background: #fff; }
  }
</style>
</head>
<body>
<div class="marpit-root">${html}</div>
<div id="deck-nav"></div>
<script>
  // Présentation : ← → / espace / clic ; F = plein écran ; Ctrl+P = export PDF
  const slides = [...document.querySelectorAll('.marpit > svg')];
  let i = 0;
  const nav = document.getElementById('deck-nav');
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, j) => {
      s.classList.toggle('active', j === i);
      s.style.transition = 'opacity 0.35s ease';
      s.style.opacity = j === i ? '1' : '0';
    });
    nav.textContent = (i + 1) + ' / ' + slides.length + '  ·  ← →  ·  F plein écran  ·  Ctrl+P PDF';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') show(i + 1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(i - 1);
    if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.();
  });
  document.addEventListener('click', () => show(i + 1));
  show(0);
</script>
</body>
</html>`;
}

/** L'IA rédige le markdown Marp du deck (contexte projet + connaissances) */
export async function generateDeckMarkdown(
  userId: string,
  brief: string,
  slidesCount: number,
): Promise<{ title: string; markdown: string }> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const n = Math.max(3, Math.min(15, Math.round(slidesCount) || 8));

  const company = buildCompanyContext(userId);
  const knowledge = buildKnowledgeContext(userId, 4000);

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un expert en présentations percutantes (style pitch deck / carrousel LinkedIn). Tu produis du markdown MARP.
Règles Marp :
- Le document commence par un front-matter YAML : ---\\nmarp: true\\npaginate: true\\n---
- Chaque slide est séparée par une ligne "---"
- Première slide : <!-- _class: lead --> puis un titre fort (# …) et un sous-titre — c'est l'accroche
- Slides suivantes : UN message par slide (## titre court + 3-5 puces maximum OU une citation/un chiffre fort)
- Dernière slide : <!-- _class: lead --> avec le call-to-action
- Texte concis et percutant : jamais de paragraphes longs, des **mots-clés en gras**
- PAS de directive theme (gérée ailleurs), PAS d'images externes
Écris dans la langue du brief (français par défaut).${company ? `\n\n## Contexte entreprise\n${company}` : ''}${knowledge ? `\n\n## Base de connaissances\n${knowledge}` : ''}
Réponds UNIQUEMENT avec le markdown Marp complet, sans fences ni commentaire autour.`,
      },
      { role: 'user', content: `Crée une présentation de ${n} slides : ${brief}` },
    ],
    maxTokens: 3000,
    timeoutMs: 180000,
  });

  let markdown = result.content.trim()
    .replace(/^```(?:markdown|md)?\n/, '')
    .replace(/\n```$/, '');
  if (!markdown.startsWith('---')) {
    markdown = `---\nmarp: true\npaginate: true\n---\n\n${markdown}`;
  }
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 150) || brief.slice(0, 80);
  return { title, markdown };
}

/** L'IA génère un thème Marp CSS sur mesure à partir des consignes de l'utilisateur */
export async function generateCustomTheme(userId: string, instructions: string): Promise<string> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const company = buildCompanyContext(userId);

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un designer de thèmes Marp. Tu produis une feuille CSS de thème Marp COMPLÈTE et valide.
Contraintes :
- La première ligne est exactement : /* @theme custom-user */
- Deuxième ligne : @import 'default';
- Style les sélecteurs : section (fond, couleur, police, padding), h1, h2, strong, a, code, blockquote, ul li::marker, section.lead (centré)
- Lisibilité avant tout : contraste élevé, tailles généreuses, pas plus de 3 couleurs
- Uniquement du CSS, aucune url() externe.${company ? `\n\nContexte de marque : ${company.slice(0, 400)}` : ''}
Réponds UNIQUEMENT avec le CSS, sans fences.`,
      },
      { role: 'user', content: `Crée le thème : ${instructions}` },
    ],
    maxTokens: 2000,
  });

  let css = result.content.trim().replace(/^```(?:css)?\n/, '').replace(/\n```$/, '');
  if (!css.startsWith('/* @theme')) {
    css = `/* @theme custom-user */\n@import 'default';\n${css}`;
  }
  // Validation : le thème doit être accepté par Marp (jette si CSS invalide)
  const marp = new Marp();
  marp.themeSet.add(css);
  return css;
}

/** Deck d'exemple pour l'aperçu des thèmes dans la Configuration */
export const SAMPLE_DECK = `---
marp: true
paginate: true
---

<!-- _class: lead -->

# Aperçu du thème

Votre présentation aura cette allure

---

## Un message par slide

- Des puces **courtes** et percutantes
- Un seul message fort
- De la respiration

> « Une citation mise en évidence »

---

<!-- _class: lead -->

# Call to action 🚀

C'est ce thème qui habillera vos decks
`;
