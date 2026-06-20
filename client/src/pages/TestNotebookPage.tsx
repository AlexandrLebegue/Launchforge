// ⚠️ TEMPORAIRE — Cahier de test interactif partagé, à retirer après la phase de
// test (voir aussi la route publique dans App.tsx et le fichier statique
// client/public/cahier-de-test.html).
//
// Page PUBLIQUE (hors authentification) : le cahier est un document HTML autonome
// (CSS/JS inline) servi en statique à /cahier-de-test.html — donc identique et
// commun à tous, accessible sans connexion. On l'affiche dans une iframe
// plein écran (sans le shell de l'app) pour éviter toute collision de styles.
export default function TestNotebookPage() {
  return (
    <iframe
      src="/cahier-de-test.html"
      title="Cahier de test interactif"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        background: '#fff',
      }}
    />
  );
}
