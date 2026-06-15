/**
 * Conversion des pièces jointes du chat en blocs de contenu pour le modèle.
 *
 *  - image (png/jpg/webp/gif)  → bloc image_url (vision native du modèle)
 *  - PDF                        → bloc file (parsé par le plugin file-parser d'OpenRouter)
 *  - Word .docx                 → texte extrait (mammoth) inliné
 *  - Excel .xlsx / .xls         → texte extrait (exceljs, format CSV) inliné
 *  - texte / csv / json / md    → inliné tel quel
 *
 * Les fichiers binaires arrivent en base64. L'extraction Office est faite ici
 * (côté serveur) : le client n'a qu'à uploader le fichier brut.
 */

import { ContentPart } from './aiClient';

/** Pièce jointe telle qu'envoyée par le client (binaire en base64) */
export interface ChatAttachment {
  name: string;
  /** type MIME du fichier (depuis le navigateur) */
  mime: string;
  /** contenu en base64 (sans préfixe data:) */
  data: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 Mo par fichier
const MAX_FILES = 4;
const MAX_TEXT_CHARS = 30_000; // plafond du texte extrait inliné par fichier

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i;
const ext = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase();

function isDocx(a: ChatAttachment): boolean {
  return a.mime.includes('wordprocessingml') || ext(a.name) === '.docx';
}
function isExcel(a: ChatAttachment): boolean {
  return a.mime.includes('spreadsheetml') || a.mime === 'application/vnd.ms-excel'
    || ['.xlsx', '.xls'].includes(ext(a.name));
}
function isTextLike(a: ChatAttachment): boolean {
  return a.mime.startsWith('text/') || a.mime === 'application/json'
    || ['.txt', '.md', '.csv', '.json', '.html'].includes(ext(a.name));
}

async function docxToText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

async function excelToText(buf: Buffer): Promise<string> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((sheet) => {
    out.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object' && v && 'text' in (v as any)) return String((v as any).text);
        if (typeof v === 'object' && v && 'result' in (v as any)) return String((v as any).result);
        return String(v);
      });
      out.push(cells.join('\t'));
    });
  });
  return out.join('\n');
}

function textPart(name: string, text: string): ContentPart {
  return { type: 'text', text: `<document name="${name}">\n${text.slice(0, MAX_TEXT_CHARS)}\n</document>` };
}

/**
 * Convertit les pièces jointes en blocs de contenu. Une extraction qui échoue
 * n'interrompt pas le tour : un bloc texte signale le problème au modèle.
 */
export async function buildAttachmentParts(attachments: ChatAttachment[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  for (const a of attachments.slice(0, MAX_FILES)) {
    if (!a || typeof a.data !== 'string' || typeof a.name !== 'string') continue;

    const bytes = Math.floor((a.data.length * 3) / 4);
    if (bytes > MAX_BYTES) {
      parts.push({ type: 'text', text: `<document name="${a.name}">[Fichier trop volumineux, ignoré]</document>` });
      continue;
    }

    try {
      if (IMAGE_MIME.test(a.mime)) {
        parts.push({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } });
      } else if (a.mime === 'application/pdf' || ext(a.name) === '.pdf') {
        parts.push({ type: 'file', file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` } });
      } else if (isDocx(a)) {
        parts.push(textPart(a.name, await docxToText(Buffer.from(a.data, 'base64'))));
      } else if (isExcel(a)) {
        parts.push(textPart(a.name, await excelToText(Buffer.from(a.data, 'base64'))));
      } else if (isTextLike(a)) {
        parts.push(textPart(a.name, Buffer.from(a.data, 'base64').toString('utf-8')));
      } else {
        parts.push({ type: 'text', text: `<document name="${a.name}">[Format non pris en charge]</document>` });
      }
    } catch (err) {
      parts.push({ type: 'text', text: `<document name="${a.name}">[Lecture impossible : ${err instanceof Error ? err.message : 'erreur'}]</document>` });
    }
  }

  return parts;
}
