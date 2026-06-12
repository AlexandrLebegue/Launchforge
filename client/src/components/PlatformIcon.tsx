/**
 * Icônes de plateformes : badge carré aux couleurs de la marque + glyphe.
 * Volontairement sans dépendance (lucide a retiré les icônes de marques) —
 * la couleur fait la reconnaissance, le libellé adjacent fait le reste.
 */

interface Props {
  platform: string;
  size?: number;
}

const BADGES: Record<string, { bg: string; fg?: string; glyph: string; fontSize?: number }> = {
  linkedin:     { bg: '#0A66C2', glyph: 'in' },
  twitter:      { bg: '#111111', glyph: '𝕏', fontSize: 11 },
  instagram:    { bg: 'linear-gradient(45deg, #f09433, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888)', glyph: '◎' },
  facebook:     { bg: '#1877F2', glyph: 'f' },
  reddit:       { bg: '#FF4500', glyph: 'r/', fontSize: 9 },
  youtube:      { bg: '#FF0000', glyph: '▶', fontSize: 9 },
  tiktok:       { bg: '#111111', glyph: '♪' },
  blog:         { bg: '#475569', glyph: 'B' },
  newsletter:   { bg: '#7c5e3c', glyph: '@' },
  producthunt:  { bg: '#DA552F', glyph: 'P' },
  hackernews:   { bg: '#FF6600', glyph: 'Y' },
  indiehackers: { bg: '#1f364d', glyph: 'IH', fontSize: 8 },
  discord:      { bg: '#5865F2', glyph: 'D' },
  slack:        { bg: '#611f69', glyph: 'S' },
  github:       { bg: '#24292f', glyph: 'GH', fontSize: 8 },
};

export default function PlatformIcon({ platform, size = 16 }: Props) {
  const badge = BADGES[platform] ?? { bg: 'var(--color-surface-3)', glyph: platform.charAt(0).toUpperCase() };
  return (
    <span
      className="platform-badge"
      style={{
        width: size,
        height: size,
        background: badge.bg,
        color: badge.fg ?? '#fff',
        fontSize: badge.fontSize ?? Math.round(size * 0.62),
      }}
      aria-hidden="true"
    >
      {badge.glyph}
    </span>
  );
}
