import { Fragment, ReactNode } from 'react';

/**
 * Rendu markdown compact pour les bulles de chat (assistant, création de
 * posts, onboarding) — sans dépendance externe.
 *
 * Blocs : titres (# à ####), listes à puces et numérotées, blocs de code,
 * citations, tableaux, séparateurs.
 * Inline : gras, italique, code, liens, barré.
 */

const INLINE_SPLIT = /(`[^`]+`|!\[[^\]]*\]\([^)\s]+\)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|https?:\/\/[^\s<>"')\]]+)/g;

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif)(\?[^\s]*)?$/i;
const VIDEO_EXT = /\.(mp4|webm)(\?[^\s]*)?$/i;

/** Aperçu inline d'un média (utilisé pour les URLs nues et la syntaxe image) */
function MediaPreview({ url, alt }: { url: string; alt?: string }) {
  if (VIDEO_EXT.test(url) || url.startsWith('/uploads/') && VIDEO_EXT.test(url)) {
    return <video className="md-media" src={url} controls loop muted playsInline />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img className="md-media" src={url} alt={alt || 'aperçu'} loading="lazy" />
    </a>
  );
}

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_SPLIT).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="md-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return <del key={i}>{part.slice(2, -2)}</del>;
    }
    // Image markdown ![alt](url) → aperçu inline
    const mdImg = part.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (mdImg) {
      return <MediaPreview key={i} url={mdImg[2]} alt={mdImg[1]} />;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      // Lien vers un média → aperçu plutôt que lien nu
      if (IMG_EXT.test(link[2]) || VIDEO_EXT.test(link[2])) {
        return <MediaPreview key={i} url={link[2]} alt={link[1]} />;
      }
      return (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="md-link">
          {link[1]}
        </a>
      );
    }
    // URL nue : média → aperçu ; sinon lien cliquable
    if (/^https?:\/\//.test(part) || part.startsWith('/uploads/')) {
      if (IMG_EXT.test(part) || VIDEO_EXT.test(part)) {
        return <MediaPreview key={i} url={part} />;
      }
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="md-link">{part}</a>
      );
    }
    if (part.length > 2 && ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))) {
      return <em key={i}>{renderInline(part.slice(1, -1))}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const RE_HEADING = /^(#{1,4})\s+(.*)$/;
const RE_HR      = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_UL      = /^\s*[-*•]\s+(.*)$/;
const RE_OL      = /^\s*\d+[.)]\s+(.*)$/;
const RE_QUOTE   = /^>\s?(.*)$/;
const RE_TABLE   = /^\s*\|(.+)\|\s*$/;
const RE_TSEP    = /^\s*\|?[\s|:-]+\|?\s*$/;

function tableCells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

/**
 * Vrai tableau = une ligne `|…|` SUIVIE d'un séparateur (`|---|`). On l'utilise
 * à la fois pour ouvrir le bloc tableau et comme condition d'arrêt du
 * paragraphe : une ligne `|…|` orpheline (fréquente en cours de streaming,
 * avant l'arrivée du séparateur) doit alors être traitée comme du texte, sinon
 * la boucle de parsing reste bloquée sur elle (i n'avance pas → boucle infinie).
 */
function isTableStart(lines: string[], idx: number): boolean {
  return (
    RE_TABLE.test(lines[idx]) &&
    idx + 1 < lines.length &&
    RE_TSEP.test(lines[idx + 1]) &&
    lines[idx + 1].includes('-')
  );
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloc de code ```
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // fence fermante (ou fin de texte pendant le streaming)
      blocks.push(<pre key={key++} className="md-pre"><code>{code.join('\n')}</code></pre>);
      continue;
    }

    // Titre
    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 5); // # → h3 … (échelle bulle de chat)
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={key++} className="md-heading">{renderInline(heading[2])}</Tag>);
      i++;
      continue;
    }

    // Séparateur
    if (RE_HR.test(line) && line.trim().length >= 3) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i++;
      continue;
    }

    // Citation
    if (RE_QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        quote.push(lines[i].match(RE_QUOTE)![1]);
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="md-quote">
          {quote.map((q, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(q)}</Fragment>)}
        </blockquote>
      );
      continue;
    }

    // Listes
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const ordered = RE_OL.test(line);
      const re = ordered ? RE_OL : RE_UL;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        items.push(lines[i].match(re)![1]);
        i++;
      }
      const children = items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{children}</ol>
        : <ul key={key++} className="md-list">{children}</ul>);
      continue;
    }

    // Tableau
    if (isTableStart(lines, i)) {
      const header = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && RE_TABLE.test(lines[i])) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{header.map((h, j) => <th key={j}>{renderInline(h)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Ligne vide → respiration entre paragraphes
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraphe : lignes consécutives « simples »
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !RE_HEADING.test(lines[i]) && !RE_UL.test(lines[i]) && !RE_OL.test(lines[i]) &&
      !RE_QUOTE.test(lines[i]) && !(RE_HR.test(lines[i]) && lines[i].trim().length >= 3) &&
      !isTableStart(lines, i)
    ) {
      para.push(lines[i]);
      i++;
    }
    // Filet de sécurité : si aucune ligne n'a été consommée (un détecteur de
    // bloc a matché sans que son bloc ne la prenne en charge), on avance quand
    // même pour garantir la progression — jamais de boucle infinie.
    if (para.length === 0) { para.push(line); i++; }
    blocks.push(
      <p key={key++} className="md-p">
        {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(p)}</Fragment>)}
      </p>
    );
  }

  return <div className="md">{blocks}</div>;
}
