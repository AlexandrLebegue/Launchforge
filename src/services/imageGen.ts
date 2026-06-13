/**
 * Génération de visuels pour les posts — OpenRouter (sortie image) puis
 * hébergement public gratuit : les plateformes (Instagram, LinkedIn…)
 * exigent une URL d'image publique, pas du base64.
 *
 * Modèle configurable via IMAGE_MODEL. Défaut : seedream-4.5 (~0,04 $
 * l'image en 2048×2048 — même prix que gemini-flash-image mais 4× plus
 * de pixels, mesuré en réel).
 */

import { buildCompanyContext } from './contentAssistant';
import { saveMediaFile } from './mediaStore';

const DEFAULT_IMAGE_MODEL = 'bytedance-seed/seedream-4.5';

export function isImageGenConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function imageModel(): string {
  return process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}

/** Héberge une image (base64) sur freeimage.host → URL publique permanente */
export async function uploadPublicImage(base64: string): Promise<string> {
  const form = new FormData();
  // Clé freeimage.host : par défaut la clé de DÉMO publique (partagée par tous,
  // donc rate-limitée et faillible). Posez FREEIMAGE_API_KEY (compte gratuit
  // freeimage.host) pour une clé dédiée et fiable.
  form.append('key', process.env.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5');
  form.append('action', 'upload');
  form.append('source', base64);
  form.append('format', 'json');

  const res = await fetch('https://freeimage.host/api/1/upload', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const data: any = await res.json().catch(() => null);
  const url = data?.image?.url;
  if (!url) {
    throw new Error(`Hébergement de l'image échoué (${data?.status_txt || res.status})`);
  }
  return url;
}

/**
 * Héberge une image et retourne une URL utilisable, SANS jamais bloquer
 * l'attachement d'un média. Conserve une copie locale (bibliothèque 90 j) puis
 * tente l'URL publique freeimage.host (indispensable pour publier sur les
 * plateformes). Si ce service externe échoue (clé partagée rate-limitée,
 * format refusé, indisponibilité), repli sur l'hébergement local /uploads —
 * l'aperçu et l'enregistrement marchent ; la publication nécessitera APP_URL.
 */
export async function hostImage(base64: string, ext = 'png'): Promise<{ url: string; public: boolean }> {
  let localUrl: string | null = null;
  try { localUrl = saveMediaFile(Buffer.from(base64, 'base64'), ext).url; } catch { /* copie locale best-effort */ }
  try {
    return { url: await uploadPublicImage(base64), public: true };
  } catch (err) {
    if (!localUrl) throw err; // ni public, ni local : on remonte l'erreur d'origine
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    return { url: appUrl ? `${appUrl}${localUrl}` : localUrl, public: Boolean(appUrl) };
  }
}

/**
 * Génère un visuel à partir d'un brief (contexte projet injecté pour la
 * cohérence de marque) et retourne son URL publique.
 */
export async function generateImage(userId: string, brief: string): Promise<{ url: string; model: string; public: boolean }> {
  if (!isImageGenConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const company = buildCompanyContext(userId);
  const prompt = [
    `Crée une image pour un post de réseau social. Sujet : ${brief}.`,
    'Style : moderne, épuré, professionnel, fort impact visuel. AUCUN texte incrusté dans l\'image (les plateformes pénalisent le texte sur image).',
    company ? `Contexte de marque (pour l'ambiance, ne pas écrire ces informations dans l'image) : ${company.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  // Certains modèles sont image-only (seedream : ['image']), d'autres
  // multi-modaux (gemini : ['image','text']) — on tente puis on replie.
  const callModel = async (modalities: string[]) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: imageModel(),
        modalities,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    return { res, data: await res.json().catch(() => null) as any };
  };

  let { res, data } = await callModel(['image']);
  if (!res.ok && String(data?.error?.message || '').includes('modalities')) {
    ({ res, data } = await callModel(['image', 'text']));
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Génération d'image refusée (${res.status})`);
  }
  const dataUrl: string | undefined = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl?.startsWith('data:image')) {
    throw new Error('Le modèle n\'a pas produit d\'image — réessayez avec un brief plus simple');
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const ext = dataUrl.startsWith('data:image/png') ? 'png' : 'jpg';
  // Conserve une copie locale + URL publique, avec repli local si freeimage échoue
  const { url, public: isPublic } = await hostImage(base64, ext);
  return { url, model: imageModel(), public: isPublic };
}
