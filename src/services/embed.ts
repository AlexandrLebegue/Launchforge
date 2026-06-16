/**
 * Détection « peut-on afficher ce post publié dans une iframe ? ».
 *
 * Beaucoup de plateformes (LinkedIn, X, Instagram, Facebook…) interdisent
 * l'inclusion via `X-Frame-Options` ou la directive CSP `frame-ancestors`.
 * On sonde donc les en-têtes de l'URL publiée avant de tenter une iframe,
 * pour ne jamais afficher un cadre vide. YouTube est traité à part : son
 * URL d'intégration officielle (/embed/…) est toujours intégrable.
 */

const USER_AGENT =
  'Mozilla/5.0 (compatible; LaunchForge/1.0; +https://launchforge.alexandre-lebegue.com)';

export interface EmbedCheck {
  /** true = on peut tenter une iframe sur `embedUrl` */
  embeddable: boolean;
  /** URL à charger dans l'iframe (officielle pour YouTube, sinon l'URL publiée) */
  embedUrl: string | null;
  /** Code machine pour le front :
   *  'youtube' | 'headers-ok' | 'x-frame-options' | 'csp' | 'no-url' | 'unreachable' */
  reason: string;
}

/** Convertit une URL YouTube (watch, youtu.be, shorts, live) en URL d'intégration. */
function youtubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[2]}`;
    }
    return null;
  } catch {
    return null;
  }
}

/** La directive CSP `frame-ancestors` autorise-t-elle l'inclusion par un tiers ? */
function frameAncestorsAllowAny(csp: string): boolean {
  const m = csp.match(/frame-ancestors([^;]*)/i);
  if (!m) return true; // pas de directive → non bloquant
  const value = m[1].trim().toLowerCase();
  if (!value || value === "'none'") return false;
  // Seul un joker '*' garantit qu'un domaine tiers (le nôtre) peut intégrer.
  // 'self' ou une liste d'hôtes précis → on considère que c'est bloqué.
  return value.includes('*');
}

export async function checkEmbeddable(url: string): Promise<EmbedCheck> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { embeddable: false, embedUrl: null, reason: 'no-url' };
  }

  const yt = youtubeEmbedUrl(trimmed);
  if (yt) return { embeddable: true, embedUrl: yt, reason: 'youtube' };

  try {
    const res = await fetch(trimmed, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });

    const xfo = res.headers.get('x-frame-options');
    if (xfo && /\b(deny|sameorigin|allow-from)\b/i.test(xfo)) {
      return { embeddable: false, embedUrl: null, reason: 'x-frame-options' };
    }

    const csp = res.headers.get('content-security-policy');
    if (csp && /frame-ancestors/i.test(csp) && !frameAncestorsAllowAny(csp)) {
      return { embeddable: false, embedUrl: null, reason: 'csp' };
    }

    return { embeddable: true, embedUrl: trimmed, reason: 'headers-ok' };
  } catch {
    return { embeddable: false, embedUrl: null, reason: 'unreachable' };
  }
}
