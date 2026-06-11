/**
 * Rendu des decks Marp en GIF animé (et MP4 si ffmpeg est installé) avec
 * fondus entre les slides — pour transformer une présentation en média de
 * post (carrousel animé Instagram/LinkedIn, teaser…).
 *
 * Pipeline 100 % local et sans navigateur : markdown → slides parsées →
 * SVG stylé par thème → PNG (sharp/librsvg) → GIF (gifenc) ou MP4 (ffmpeg).
 * Les SVG n'utilisent que des primitives natives (pas de foreignObject) :
 * mise en page maîtrisée, rendu identique partout.
 */

import sharp from 'sharp';
import { spawnSync, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
// gifenc est en ESM pur sans types — import via require pour rester en CJS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

export interface DeckSlide {
  lead: boolean;
  title: string;
  subtitle: string;
  bullets: string[];
  quote: string;
}

/** Palette visuelle par thème (alignée sur les thèmes Marp de decks.ts) */
const PALETTES: Record<string, { bgFrom: string; bgTo: string; fg: string; accent: string; muted: string }> = {
  launchforge:    { bgFrom: '#0f0d1a', bgTo: '#1a1430', fg: '#e8e6f0', accent: '#7c5cfc', muted: '#b8b3cc' },
  'clean-light':  { bgFrom: '#fcfcfd', bgTo: '#eef1f6', fg: '#1c1e26', accent: '#2563eb', muted: '#555c6e' },
  'bold-gradient':{ bgFrom: '#4f46e5', bgTo: '#db2777', fg: '#ffffff', accent: '#fde68a', muted: '#e9e2f7' },
  default:        { bgFrom: '#ffffff', bgTo: '#f2f3f5', fg: '#222222', accent: '#0288d1', muted: '#5a5f66' },
};

export function paletteFor(theme: string) {
  return PALETTES[theme] ?? PALETTES.launchforge;
}

/** Nettoie le markdown inline (gras, italique, code, liens) pour du texte SVG */
function plainText(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** Découpe le markdown Marp en slides structurées */
export function parseSlides(markdown: string): DeckSlide[] {
  // Retire le front-matter puis découpe sur les séparateurs de slides
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const chunks = body.split(/\n---\s*\n/).map((c) => c.trim()).filter(Boolean);

  return chunks.map((chunk) => {
    const slide: DeckSlide = { lead: /<!--\s*_class:\s*lead\s*-->/.test(chunk), title: '', subtitle: '', bullets: [], quote: '' };
    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('<!--')) continue;
      if (/^#\s+/.test(line))        { slide.title ||= plainText(line.replace(/^#\s+/, '')); continue; }
      if (/^##\s+/.test(line))       { if (slide.title) slide.subtitle ||= plainText(line.replace(/^##\s+/, '')); else slide.title = plainText(line.replace(/^##\s+/, '')); continue; }
      if (/^[-*]\s+/.test(line))     { slide.bullets.push(plainText(line.replace(/^[-*]\s+/, ''))); continue; }
      if (/^\d+[.)]\s+/.test(line))  { slide.bullets.push(plainText(line.replace(/^\d+[.)]\s+/, ''))); continue; }
      if (/^>\s?/.test(line))        { slide.quote = `${slide.quote} ${plainText(line.replace(/^>\s?/, ''))}`.trim(); continue; }
      if (!slide.subtitle && slide.title && slide.bullets.length === 0) slide.subtitle = plainText(line);
    }
    return slide;
  }).filter((s) => s.title || s.bullets.length > 0 || s.quote);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Coupe un texte en lignes d'environ maxChars caractères */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = `${line} ${word}`;
    }
  }
  if (line.trim() && lines.length < maxLines) lines.push(line.trim());
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, ' …');
  }
  return lines;
}

/** SVG d'une slide — primitives natives uniquement (rendu fiable par librsvg) */
export function svgForSlide(slide: DeckSlide, theme: string, size: number): string {
  const p = paletteFor(theme);
  const W = size;
  const pad = Math.round(size * 0.09);
  const parts: string[] = [];
  const font = `font-family="DejaVu Sans, Verdana, sans-serif"`;

  if (slide.lead) {
    const titleSize = Math.round(size * 0.062);
    const lines = wrap(slide.title, 24, 3);
    const startY = W / 2 - ((lines.length - 1) * titleSize * 1.25) / 2 - (slide.subtitle ? titleSize * 0.5 : 0);
    lines.forEach((l, i) => {
      parts.push(`<text x="${W / 2}" y="${startY + i * titleSize * 1.25}" text-anchor="middle" fill="${p.fg}" font-size="${titleSize}" font-weight="bold" ${font}>${esc(l)}</text>`);
    });
    if (slide.subtitle) {
      const sub = wrap(slide.subtitle, 38, 2);
      sub.forEach((l, i) => {
        parts.push(`<text x="${W / 2}" y="${startY + lines.length * titleSize * 1.25 + titleSize * 0.6 + i * titleSize * 0.75}" text-anchor="middle" fill="${p.muted}" font-size="${Math.round(titleSize * 0.52)}" ${font}>${esc(l)}</text>`);
      });
    }
    parts.push(`<rect x="${W / 2 - size * 0.06}" y="${W - pad}" width="${size * 0.12}" height="${Math.max(4, size * 0.008)}" rx="3" fill="${p.accent}"/>`);
  } else {
    const titleSize = Math.round(size * 0.048);
    let y = pad + titleSize;
    for (const l of wrap(slide.title, 30, 2)) {
      parts.push(`<text x="${pad}" y="${y}" fill="${p.fg}" font-size="${titleSize}" font-weight="bold" ${font}>${esc(l)}</text>`);
      y += titleSize * 1.25;
    }
    parts.push(`<rect x="${pad}" y="${y - titleSize * 0.4}" width="${size * 0.11}" height="${Math.max(3, size * 0.007)}" rx="3" fill="${p.accent}"/>`);
    y += titleSize * 0.9;

    const bodySize = Math.round(size * 0.032);
    for (const bullet of slide.bullets.slice(0, 6)) {
      const lines = wrap(bullet, 42, 2);
      parts.push(`<circle cx="${pad + bodySize * 0.3}" cy="${y - bodySize * 0.32}" r="${bodySize * 0.18}" fill="${p.accent}"/>`);
      lines.forEach((l, i) => {
        parts.push(`<text x="${pad + bodySize * 1.1}" y="${y + i * bodySize * 1.3}" fill="${p.fg}" font-size="${bodySize}" ${font}>${esc(l)}</text>`);
      });
      y += lines.length * bodySize * 1.3 + bodySize * 0.85;
    }
    if (slide.quote) {
      const lines = wrap(slide.quote, 40, 3);
      parts.push(`<rect x="${pad}" y="${y - bodySize}" width="${Math.max(3, size * 0.006)}" height="${lines.length * bodySize * 1.35 + bodySize * 0.4}" fill="${p.accent}"/>`);
      lines.forEach((l, i) => {
        parts.push(`<text x="${pad + bodySize}" y="${y + i * bodySize * 1.35}" fill="${p.muted}" font-size="${bodySize}" font-style="italic" ${font}>${esc(l)}</text>`);
      });
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${p.bgFrom}"/><stop offset="100%" stop-color="${p.bgTo}"/>
  </linearGradient></defs>
  <rect width="${W}" height="${W}" fill="url(#bg)"/>
  ${parts.join('\n  ')}
</svg>`;
}

/** Rasterise chaque slide en RGBA brut */
async function renderFrames(markdown: string, theme: string, size: number): Promise<Buffer[]> {
  const slides = parseSlides(markdown);
  if (slides.length === 0) throw new Error('Deck vide — rien à rendre');
  const frames: Buffer[] = [];
  for (const slide of slides) {
    const svg = svgForSlide(slide, theme, size);
    frames.push(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer());
  }
  return frames;
}

/** Fondu entre deux frames RGBA (t ∈ ]0,1[) */
function blend(a: Buffer, b: Buffer, t: number): Buffer {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i] * (1 - t) + b[i] * t) | 0;
  }
  return out;
}

const TRANSITION_STEPS = 7;
const TRANSITION_MS = 60;
const HOLD_MS = 2400;

/** Assemble les slides en GIF animé avec fondus (pur JS — fonctionne partout) */
export async function renderDeckGif(markdown: string, theme: string, size = 640): Promise<Buffer> {
  const frames = await renderFrames(markdown, theme, size);
  const gif = GIFEncoder();

  const writeFrame = (rgba: Buffer, delay: number) => {
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, size, size, { palette, delay });
  };

  for (let i = 0; i < frames.length; i++) {
    writeFrame(frames[i], HOLD_MS);
    const next = frames[(i + 1) % frames.length];
    // Fondu vers la slide suivante (et retour vers la première : boucle propre)
    for (let s = 1; s <= TRANSITION_STEPS; s++) {
      writeFrame(blend(frames[i], next, s / (TRANSITION_STEPS + 1)), TRANSITION_MS);
    }
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

export function isFfmpegAvailable(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

/** Assemble en MP4 via ffmpeg (qualité supérieure, nécessite ffmpeg installé) */
export async function renderDeckMp4(markdown: string, theme: string, size = 1080): Promise<Buffer> {
  if (!isFfmpegAvailable()) {
    throw new Error('ffmpeg n\'est pas installé sur le serveur — utilisez le format GIF, ou installez ffmpeg pour le MP4');
  }
  const frames = await renderFrames(markdown, theme, size);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-deck-'));
  try {
    const concat: string[] = [];
    let n = 0;
    const writePng = async (rgba: Buffer, duration: number) => {
      const file = path.join(tmp, `f${String(n++).padStart(4, '0')}.png`);
      await sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file);
      concat.push(`file '${file}'`, `duration ${duration}`);
    };
    for (let i = 0; i < frames.length; i++) {
      await writePng(frames[i], HOLD_MS / 1000);
      if (i < frames.length - 1) {
        for (let s = 1; s <= TRANSITION_STEPS; s++) {
          await writePng(blend(frames[i], frames[i + 1], s / (TRANSITION_STEPS + 1)), TRANSITION_MS / 1000);
        }
      }
    }
    // Le dernier fichier doit être répété pour que sa durée soit prise en compte
    concat.push(concat[concat.length - 2]);
    const listFile = path.join(tmp, 'list.txt');
    fs.writeFileSync(listFile, concat.join('\n'));
    const out = path.join(tmp, 'out.mp4');
    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', 'format=yuv420p', '-movflags', '+faststart', out,
    ], { timeout: 120000 });
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
