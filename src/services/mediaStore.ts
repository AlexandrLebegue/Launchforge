/**
 * Stockage des médias générés (GIF/MP4 des decks, copies des visuels) dans
 * data/uploads, servi statiquement sur /uploads. Nettoyage automatique des
 * fichiers de plus de 90 jours (au démarrage puis une fois par jour).
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const RETENTION_DAYS = 90;

export function uploadsDir(): string {
  const dir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Écrit un média et retourne son URL relative (/uploads/…) */
export function saveMediaFile(buffer: Buffer, ext: string): { fileName: string; url: string } {
  const fileName = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext.replace(/^\./, '')}`;
  fs.writeFileSync(path.join(uploadsDir(), fileName), buffer);
  return { fileName, url: `/uploads/${fileName}` };
}

/** Supprime les médias plus vieux que `days` jours. Retourne le nombre supprimé. */
export function cleanupOldMedia(days = RETENTION_DAYS, now = Date.now()): number {
  const dir = uploadsDir();
  const cutoff = now - days * 86400_000;
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch { /* fichier disparu entre-temps */ }
  }
  if (removed > 0) console.log(`🧹 Médias nettoyés : ${removed} fichier(s) de plus de ${days} jours`);
  return removed;
}

let cleanupTimer: NodeJS.Timeout | null = null;

/** Lance le nettoyage au démarrage puis quotidiennement */
export function startMediaCleanup(): void {
  if (cleanupTimer) return;
  try { cleanupOldMedia(); } catch { /* best-effort */ }
  cleanupTimer = setInterval(() => {
    try { cleanupOldMedia(); } catch { /* best-effort */ }
  }, 24 * 3600_000);
  cleanupTimer.unref?.();
}
