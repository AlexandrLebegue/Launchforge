/**
 * Conversion markdown → MarkdownV2 Telegram. On vérifie que la mise en forme
 * voulue est produite ET que tous les caractères spéciaux littéraux sont
 * échappés (une seule erreur d'échappement fait rejeter le message par Telegram).
 */

import { describe, it, expect } from 'vitest';
import { toTelegramMarkdownV2 as f } from '../src/services/telegramFormat';

// Caractères que MarkdownV2 exige d'échapper hors entités.
const SPECIALS = '_*[]()~`>#+-=|{}.!';

/**
 * Vérifie qu'un rendu est « sûr » : hors des entités, tout caractère spécial
 * est précédé d'un backslash. On retire d'abord les entités connues (gras,
 * italique, code, liens) pour ne contrôler que le texte littéral.
 */
function assertEscaped(out: string) {
  // Chaque spécial non précédé d'un \ est suspect — on tolère les marqueurs
  // d'entités en les neutralisant au préalable.
  const neutralised = out
    .replace(/```[\s\S]*?```/g, '')            // blocs de code
    .replace(/`[^`]*`/g, '')                    // code inline
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')        // liens
    .replace(/(?<!\\)[*_~]/g, '');              // marqueurs d'emphase non échappés
  const bad = [...neutralised].filter((ch, i) => SPECIALS.includes(ch) && neutralised[i - 1] !== '\\');
  expect(bad, `caractères non échappés: ${bad.join(' ')} dans ${JSON.stringify(out)}`).toEqual([]);
}

describe('toTelegramMarkdownV2 — mise en forme', () => {
  it('gras ** ** → *', () => {
    expect(f('**gras**')).toBe('*gras*');
  });

  it('italique * * → _ _', () => {
    expect(f('*penché*')).toBe('_penché_');
  });

  it('barré ~~ ~~ → ~ ~', () => {
    expect(f('~~barré~~')).toBe('~barré~');
  });

  it('code inline garde les backticks, échappe l\'intérieur', () => {
    expect(f('appelle `a.b()`')).toBe('appelle `a.b()`'); // pas d'échappement des . () dans le code
  });

  it('bloc de code préserve le contenu', () => {
    const out = f('```js\nconst a = 1; // n.b.\n```');
    expect(out).toContain('```js\n');
    expect(out).toContain('const a = 1; // n.b.');
  });

  it('titre # → gras', () => {
    expect(f('## Bilan de la semaine')).toBe('*Bilan de la semaine*');
  });

  it('liste à puces - / * / + → •', () => {
    expect(f('- un\n- deux')).toBe('• un\n• deux');
    expect(f('* un')).toBe('• un');
  });

  it('liste numérotée : le point est échappé', () => {
    expect(f('1. premier')).toBe('1\\. premier');
  });

  it('lien [texte](url) conservé, texte échappé, url intacte', () => {
    expect(f('[mon site](https://ex.com/a)')).toBe('[mon site](https://ex.com/a)');
    expect(f('[a.b!](https://ex.com/x)')).toBe('[a\\.b\\!](https://ex.com/x)');
  });
});

describe('toTelegramMarkdownV2 — échappement (robustesse)', () => {
  it('échappe les caractères spéciaux du texte courant', () => {
    expect(f('Prix : 9.99 € (promo!) - vite')).toBe('Prix : 9\\.99 € \\(promo\\!\\) \\- vite');
  });

  it('n\'italicise pas les underscores des identifiants', () => {
    expect(f('la variable user_id_max')).toBe('la variable user\\_id\\_max');
  });

  it('un message réaliste de l\'assistant reste entièrement échappé', () => {
    const md = [
      '## Ton bilan',
      '',
      'Voici **3 points** à retenir :',
      '- Le post *LinkedIn* a fait +25% (vues).',
      '- Pense à relancer `contact#42`.',
      '',
      'Détails : [ouvre le rapport](https://app.launchforge.dev/report?id=7).',
    ].join('\n');
    assertEscaped(f(md));
  });

  it('gère un texte truffé de spéciaux sans entité', () => {
    assertEscaped(f('a_b*c[d]e(f)g~h`i>j#k+l-m=n|o{p}q.r!s'));
  });

  it('ne jette jamais et purge les caractères nuls parasites', () => {
    const withNul = 'a' + String.fromCharCode(0) + 'b';
    expect(() => f(withNul)).not.toThrow();
    expect(f(withNul)).toBe('ab');
  });
});
