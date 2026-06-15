const RAW = (import.meta as any).env?.VITE_ADMIN_EMAILS as string | undefined;

// Fallback: alexandrelebegue12@gmail.com est toujours fondateur.
// Pour ajouter des emails en prod, expose VITE_ADMIN_EMAILS="a@b.com,c@d.com" au build.
const ADMIN_EMAILS = new Set(
  (RAW ?? 'alexandrelebegue12@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase());
}
