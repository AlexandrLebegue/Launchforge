/**
 * Markdown (celui que produit l'IA) → MarkdownV2 de Telegram.
 *
 * L'IA répond en markdown « classique » (**gras**, *italique*, `code`, listes à
 * puces, titres #, liens). Envoyé tel quel à Telegram, ça s'affiche avec les
 * astérisques bruts. Telegram accepte parse_mode=MarkdownV2, mais sa syntaxe
 * diffère (gras = *un seul* astérisque, italique = _souligné_) ET exige
 * d'ÉCHAPPER une longue liste de caractères (_ * [ ] ( ) ~ ` > # + - = | { } . !)
 * partout hors entités — une seule erreur d'échappement fait rejeter TOUT le
 * message (400). D'où : conversion robuste ici + repli texte brut à l'envoi
 * (cf. sendTelegramMessage) pour ne jamais perdre un message.
 *
 * Stratégie « placeholders » : on extrait d'abord les constructions (blocs de
 * code, code inline, liens, gras/italique/barré, titres) en jetons neutres
 * délimités par le caractère nul (U+0000), dont la valeur est DÉJÀ convertie et
 * échappée ; on échappe ensuite tout le texte restant ; puis on réinjecte les
 * jetons. Ainsi les marqueurs voulus (* _ ~ ` de la mise en forme) ne sont
 * jamais ré-échappés, et le contenu littéral l'est toujours. Le caractère nul
 * est illégal dans un message Telegram et absent de toute sortie d'IA :
 * délimiteur sûr.
 */

const NUL = String.fromCharCode(0);
const TOKEN_RE = new RegExp(NUL + '(\\d+)' + NUL, 'g');

/** Échappe le texte normal (tous les caractères spéciaux MarkdownV2). */
function esc(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
/** Dans un bloc/inline de code : seuls ` et \ sont à échapper. */
function escCode(s: string): string {
  return s.replace(/[`\\]/g, '\\$&');
}
/** Dans l'URL d'un lien : seuls ) et \ sont à échapper. */
function escUrl(s: string): string {
  return s.replace(/[)\\]/g, '\\$&');
}

/**
 * Convertit du markdown en MarkdownV2 Telegram. Ne jette jamais : en cas de
 * pépin, renvoie le texte échappé « à plat » (toujours un MarkdownV2 valide).
 */
export function toTelegramMarkdownV2(input: string): string {
  try {
    const store: string[] = [];
    const ph = (value: string): string => NUL + (store.push(value) - 1) + NUL;

    // Le nul délimite nos jetons : on le purge d'abord de l'entrée.
    let s = input.split(NUL).join('').replace(/\r\n/g, '\n');

    // 1. Blocs de code ``` ``` (avant tout : leur contenu ne doit rien subir)
    s = s.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) =>
      ph('```' + (lang || '') + '\n' + escCode(code.replace(/\n+$/, '')) + '\n```'),
    );

    // 2. Titres markdown (# … ######) → gras sur la ligne
    s = s.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_m, t: string) => ph('*' + esc(t) + '*'));

    // 3. Puces de liste (-, *, +) → • (caractère non spécial). Les listes
    //    numérotées « 1. » sont gérées par l'échappement général (1\. …).
    s = s.replace(/^([ \t]*)[-*+][ \t]+/gm, (_m, indent: string) => indent + '• ');

    // 4. Code inline `code`
    s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => ph('`' + escCode(code) + '`'));

    // 5. Images ![alt](url) → lien cliquable sur l'alt (ou « image »)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) =>
      ph('[' + esc(alt || 'image') + '](' + escUrl(url) + ')'),
    );
    // 6. Liens [texte](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) =>
      ph('[' + esc(text) + '](' + escUrl(url) + ')'),
    );

    // 7. Gras **texte** → *texte* (avant l'italique, pour ne pas casser les **)
    s = s.replace(/\*\*(?!\s)([^\n]+?)\*\*/g, (_m, t: string) => ph('*' + esc(t) + '*'));
    // 8. Barré ~~texte~~ → ~texte~
    s = s.replace(/~~(?!\s)([^\n]+?)~~/g, (_m, t: string) => ph('~' + esc(t) + '~'));
    // 9. Italique *texte* → _texte_. On ne touche PAS aux « _ » (fréquents dans
    //    les identifiants type snake_case) : ils resteront littéraux.
    s = s.replace(/\*(?!\s)([^*\n]+?)\*/g, (_m, t: string) => ph('_' + esc(t) + '_'));

    // 10. Échappement de tout le texte restant, puis réinjection des jetons.
    //     Le nul et les chiffres ne sont pas spéciaux → esc() laisse les jetons
    //     intacts.
    s = esc(s);
    s = s.replace(TOKEN_RE, (_m, i: string) => store[Number(i)] ?? '');
    return s;
  } catch {
    // Filet de sécurité : au pire, un texte entièrement échappé reste valide.
    return esc(input.split(NUL).join(''));
  }
}
