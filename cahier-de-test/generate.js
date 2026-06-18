/* Génère le cahier de test LaunchForge en PDF (HTML -> Playwright/Chromium). */
const fs = require('fs');
const path = require('path');
const { chromium } = require('C:/Users/alexa/AppData/Roaming/npm/node_modules/playwright');
const { sections } = require('./data');
const { platformSection, agentOnly, recurrenceSection, leadsSection } = require('./data-platforms');

const matrixSections = [recurrenceSection, leadsSection];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DATE = '18 juin 2026';
const VERSION = '1.1';

/** Rend les étapes / l'attendu : tableau -> liste, sinon texte. */
function cell(v) {
  if (Array.isArray(v)) {
    return '<ol class="steps">' + v.map((x) => `<li>${esc(x)}</li>`).join('') + '</ol>';
  }
  return esc(v);
}

const platformCases = platformSection.groups.reduce((n, g) => n + g.cases.length, 0);
const platformManual = platformSection.groups.reduce(
  (n, g) => n + g.cases.filter((c) => c.man).length,
  0,
);
const matrixCases = matrixSections.reduce(
  (n, s) => n + s.cases.length + s.matrix.rows.length,
  0,
);
const matrixManual = matrixSections.reduce(
  (n, s) =>
    n +
    s.cases.filter((c) => c.man).length +
    (s.matrixManual ? s.matrix.rows.length : 0),
  0,
);
const totalCases =
  sections.reduce((n, s) => n + s.cases.length, 0) + platformCases + matrixCases;
const manualCases =
  sections.reduce((n, s) => n + s.cases.filter((c) => c.man).length, 0) +
  platformManual +
  matrixManual;
const moduleCount = sections.length + 1 + matrixSections.length; // + V + W + X

/* ── Table des matières ── */
const toc =
  sections
    .map(
      (s) => `<tr>
      <td class="toc-id">${s.id}</td>
      <td>${esc(s.title)}${s.manual ? ' <span class="chip">manuel ★</span>' : ''}</td>
      <td class="toc-n">${s.cases.length}</td>
    </tr>`,
    )
    .join('') +
  `<tr>
      <td class="toc-id">${platformSection.id}</td>
      <td>${esc(platformSection.title)} <span class="chip">${platformSection.groups.length} plateformes</span></td>
      <td class="toc-n">${platformCases}</td>
    </tr>` +
  matrixSections
    .map(
      (s) => `<tr>
      <td class="toc-id">${s.id}</td>
      <td>${esc(s.title)}${s.manual ? ' <span class="chip">manuel ★</span>' : ''}</td>
      <td class="toc-n">${s.cases.length + s.matrix.rows.length}</td>
    </tr>`,
    )
    .join('');

/* ── Sections ── */
const body = sections
  .map((s) => {
    const rows = s.cases
      .map(
        (c) => `<tr class="${c.man ? 'manual' : ''}">
          <td class="c-id">${c.id}${c.man ? ' <span class="star" title="Vérification manuelle">★</span>' : ''}</td>
          <td class="c-t">${esc(c.t)}${c.pre ? `<div class="pre">Prérequis : ${esc(c.pre)}</div>` : ''}</td>
          <td class="c-e">${cell(c.e)}</td>
          <td class="c-a">${cell(c.a)}</td>
          <td class="c-s">
            <span class="box">OK</span>
            <span class="box">KO</span>
            <span class="box">N/A</span>
          </td>
          <td class="c-n"></td>
        </tr>`,
      )
      .join('');

    return `<section class="module">
      <h2 id="sec-${s.id}"><span class="sec-id">${s.id}</span> ${esc(s.title)}</h2>
      <p class="intro">${esc(s.intro)}</p>
      ${
        s.manual
          ? `<div class="callout">★ Module à <strong>vérification manuelle renforcée</strong> : ne pas se contenter d'un retour « sans erreur » — relire le contenu produit (analyses, leads, emails, plans, contenus validés) et juger sa pertinence.</div>`
          : ''
      }
      <table class="cases">
        <thead>
          <tr>
            <th class="h-id">ID</th>
            <th class="h-t">Cas de test</th>
            <th class="h-e">Étapes</th>
            <th class="h-a">Résultat attendu</th>
            <th class="h-s">Statut</th>
            <th class="h-n">Notes / Anomalie</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  })
  .join('');

/* ── Rend un corps de tableau de cas ── */
function renderRows(cases) {
  return cases
    .map(
      (c) => `<tr class="${c.man ? 'manual' : ''}">
        <td class="c-id">${c.id}${c.man ? ' <span class="star">★</span>' : ''}</td>
        <td class="c-t">${esc(c.t)}${c.pre ? `<div class="pre">Prérequis : ${esc(c.pre)}</div>` : ''}</td>
        <td class="c-e">${cell(c.e)}</td>
        <td class="c-a">${cell(c.a)}</td>
        <td class="c-s"><span class="box">OK</span><span class="box">KO</span><span class="box">N/A</span></td>
        <td class="c-n"></td>
      </tr>`,
    )
    .join('');
}

const tableHead = `<thead><tr>
  <th class="h-id">ID</th><th class="h-t">Cas de test</th><th class="h-e">Étapes</th>
  <th class="h-a">Résultat attendu</th><th class="h-s">Statut</th><th class="h-n">Notes / Anomalie</th>
</tr></thead>`;

/* ── Section V : un sous-bloc par plateforme ── */
const platformBlocks = platformSection.groups
  .map(
    (g) => `<div class="pf-block">
      <h3 id="pf-${g.code}" class="pf-h"><span class="pf-icon">${g.icon}</span> ${esc(g.name)} <span class="pf-code">${g.code}</span></h3>
      <div class="pf-summary">${esc(g.summary)}</div>
      <table class="cases">${tableHead}<tbody>${renderRows(g.cases)}</tbody></table>
    </div>`,
  )
  .join('');

const agentRows = agentOnly.rows
  .map(
    (r) => `<tr>
      <td class="c-id">${r.code}</td>
      <td class="c-t"><span class="pf-icon">${r.icon}</span> ${esc(r.name)}</td>
      <td colspan="2">Format attendu : ${esc(r.fmt)}. Validation : adaptation au format ${esc(r.name)}, mode auto/manuel respecté, publication via les outils Composio ${esc(r.name)}.</td>
      <td class="c-s"><span class="box">OK</span><span class="box">KO</span><span class="box">N/A</span></td>
      <td class="c-n"></td>
    </tr>`,
  )
  .join('');

const platformSectionHtml = `<section class="module">
  <h2 id="sec-${platformSection.id}"><span class="sec-id">${platformSection.id}</span> ${esc(platformSection.title)}</h2>
  <p class="intro">${esc(platformSection.intro)}</p>
  <div class="callout">★ Pour chaque plateforme, vérifier l'<strong>adaptation rédactionnelle aux codes</strong>, le respect des <strong>contraintes (média obligatoire, subreddit, app dev)</strong>, et la fidélité de l'<strong>aperçu</strong>. Légende contraintes : <span class="tag tag-req">média requis</span> <span class="tag">média facultatif</span> <span class="tag tag-sub">subreddit requis</span> <span class="tag tag-app">app dev requise</span>.</div>
  ${platformBlocks}

  <h3 class="pf-h">${esc(agentOnly.title)}</h3>
  <p class="intro">${esc(agentOnly.note)}</p>
  <table class="cases">${tableHead}<tbody>${agentRows}</tbody></table>
</section>`;

/* ── Sections matricielles (W, X) : cas généraux + matrice par plateforme ── */
function renderMatrix(m) {
  const head =
    '<thead><tr>' +
    `<th class="h-id">${esc(m.head[0])}</th>` +
    `<th class="m-pf">${esc(m.head[1])}</th>` +
    `<th class="m-c">${esc(m.head[2])}</th>` +
    `<th class="m-c">${esc(m.head[3])}</th>` +
    '<th class="h-s">Statut</th><th class="h-n">Notes / Anomalie</th>' +
    '</tr></thead>';
  const rows = m.rows
    .map(
      (r) => `<tr>
        <td class="c-id">${esc(r[0])}</td>
        <td class="c-t">${esc(r[1])}</td>
        <td>${esc(r[2])}</td>
        <td>${esc(r[3])}</td>
        <td class="c-s"><span class="box">OK</span><span class="box">KO</span><span class="box">N/A</span></td>
        <td class="c-n"></td>
      </tr>`,
    )
    .join('');
  return `<table class="cases matrix">${head}<tbody>${rows}</tbody></table>`;
}

const matrixSectionsHtml = matrixSections
  .map(
    (s) => `<section class="module">
      <h2 id="sec-${s.id}"><span class="sec-id">${s.id}</span> ${esc(s.title)}</h2>
      <p class="intro">${esc(s.intro)}</p>
      ${
        s.manual
          ? `<div class="callout">★ Module à <strong>vérification manuelle renforcée</strong> — juger la pertinence du contenu détecté/généré, pas seulement l'absence d'erreur.</div>`
          : ''
      }
      <table class="cases">${tableHead}<tbody>${renderRows(s.cases)}</tbody></table>
      <h3 class="pf-h">Déclinaison par plateforme</h3>
      ${renderMatrix(s.matrix)}
    </section>`,
  )
  .join('');

const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Cahier de test — LaunchForge</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1d1a17; font-size: 10.2px; line-height: 1.45; margin: 0; }
  h1, h2, h3 { font-family: "Segoe UI Semibold", "Segoe UI", Arial, sans-serif; }

  /* ── Couverture ── */
  .cover { height: 100vh; display: flex; flex-direction: column; justify-content: center;
    padding: 0 40px; background: linear-gradient(160deg,#1a1816 0%,#2a1a10 60%,#3a1d0a 100%); color: #fff8f0;
    page-break-after: always; }
  .cover .flame { font-size: 40px; }
  .cover h1 { font-size: 38px; margin: 8px 0 4px; letter-spacing: -.5px; }
  .cover .forge { color: #ff6b35; }
  .cover .sub { font-size: 16px; color: #e9b48f; margin-bottom: 26px; }
  .cover .meta { font-size: 12px; color: #cdbfb2; line-height: 1.9; border-top: 1px solid rgba(255,107,53,.35);
    padding-top: 18px; max-width: 460px; }
  .cover .meta b { color: #fff8f0; font-weight: 600; }
  .cover .kpis { display: flex; gap: 14px; margin-top: 26px; }
  .cover .kpi { background: rgba(255,107,53,.12); border: 1px solid rgba(255,107,53,.4);
    border-radius: 8px; padding: 12px 18px; }
  .cover .kpi .n { font-size: 24px; font-weight: 700; color: #ff6b35; }
  .cover .kpi .l { font-size: 10px; color: #cdbfb2; text-transform: uppercase; letter-spacing: .5px; }

  .page { padding: 26px 30px; }
  h2 { font-size: 16px; color: #c2410c; border-bottom: 2px solid #ff6b35; padding-bottom: 5px;
    margin: 0 0 8px; page-break-after: avoid; }
  .sec-id { display: inline-block; background: #ff6b35; color: #fff; border-radius: 5px;
    padding: 1px 8px; font-size: 14px; margin-right: 6px; }
  h3 { font-size: 13px; color: #1d1a17; margin: 18px 0 6px; }
  .module { page-break-inside: auto; margin-bottom: 18px; }
  .intro { color: #514a43; margin: 4px 0 8px; }

  .callout { background: #fff4ec; border-left: 4px solid #ff6b35; padding: 7px 11px; border-radius: 4px;
    font-size: 9.8px; color: #7c2d12; margin: 6px 0 9px; }
  .callout .tag { background: #ece5dd; color: #514a43; }

  /* ── Bloc plateforme (section V) ── */
  .pf-block { page-break-inside: auto; margin: 0 0 12px; }
  .pf-h { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #1d1a17;
    margin: 14px 0 3px; padding-bottom: 3px; border-bottom: 1px solid #f0c9af; page-break-after: avoid; }
  .pf-icon { font-size: 14px; }
  .pf-code { background: #ff6b35; color: #fff; border-radius: 4px; font-size: 9px; padding: 1px 6px; margin-left: auto; }
  .pf-summary { font-size: 9.2px; color: #8a4b2a; background: #fff7f1; border: 1px solid #f3cbb1;
    border-radius: 4px; padding: 3px 8px; margin: 0 0 5px; }
  .tag { display: inline-block; border-radius: 9px; padding: 0 7px; font-size: 8.4px; font-weight: 600;
    background: #ece5dd; color: #514a43; margin: 0 2px; }
  .tag-req { background: #ffe0d3; color: #b3320b; }
  .tag-sub { background: #ffe9c9; color: #9a5a00; }
  .tag-app { background: #e0e7ff; color: #3730a3; }

  /* ── Table des cas ── */
  table.cases { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.cases thead { display: table-header-group; }
  table.cases th { background: #2a2522; color: #fff8f0; font-size: 9.4px; text-align: left;
    padding: 5px 6px; border: 1px solid #2a2522; text-transform: uppercase; letter-spacing: .3px; }
  table.cases td { border: 1px solid #e4ddd5; padding: 5px 6px; vertical-align: top; }
  table.cases tr { page-break-inside: avoid; }
  table.cases tbody tr:nth-child(even) { background: #faf7f3; }
  tr.manual { background: #fff7f1 !important; }
  tr.manual td { border-color: #f3cbb1; }

  .h-id, .c-id { width: 34px; }
  .h-t,  .c-t  { width: 17%; }
  .h-e,  .c-e  { width: 23%; }
  .h-a,  .c-a  { width: 28%; }
  .h-s,  .c-s  { width: 64px; }
  .h-n,  .c-n  { width: auto; }

  /* Matrices (W, X) : colonnes plateforme + 2 colonnes de contenu */
  table.matrix .m-pf { width: 15%; }
  table.matrix .m-c  { width: 27%; }
  table.matrix .c-t  { font-weight: 600; }

  .c-id { font-weight: 700; color: #c2410c; }
  .c-t { font-weight: 600; }
  .pre { font-weight: 400; color: #8a7f74; font-size: 9px; margin-top: 2px; }
  .star { color: #ff6b35; }
  ol.steps { margin: 0; padding-left: 15px; }
  ol.steps li { margin-bottom: 1px; }

  .c-s { text-align: center; white-space: nowrap; }
  .box { display: inline-block; border: 1.3px solid #9a8d80; border-radius: 3px; padding: 1px 3px;
    font-size: 7.6px; color: #6b6055; margin: 1px 0; line-height: 1.2; }
  .c-n { background: #fffefb; }

  /* ── TOC & légende ── */
  table.toc { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.toc td { padding: 4px 8px; border-bottom: 1px solid #ece5dd; font-size: 11px; }
  .toc-id { width: 40px; font-weight: 700; color: #c2410c; }
  .toc-n { width: 60px; text-align: center; color: #8a7f74; }
  .chip { background: #ffe6d6; color: #c2410c; border-radius: 10px; padding: 0 7px; font-size: 8.6px;
    font-weight: 600; vertical-align: middle; }

  .legend { background: #faf7f3; border: 1px solid #e4ddd5; border-radius: 6px; padding: 12px 16px;
    margin-top: 14px; font-size: 10px; }
  .legend h3 { margin-top: 0; }
  .legend ul { margin: 4px 0; padding-left: 18px; }
  .legend li { margin-bottom: 3px; }

  .pillrow { margin: 10px 0; }
  .pill { display: inline-block; background: #2a2522; color: #fff8f0; border-radius: 12px;
    padding: 2px 10px; font-size: 9.5px; margin: 0 4px 4px 0; }

  .signoff { margin-top: 16px; border: 1px solid #e4ddd5; border-radius: 6px; }
  .signoff td { border: 1px solid #e4ddd5; padding: 9px 10px; font-size: 10px; }
  .signoff .lab { background: #faf7f3; font-weight: 600; width: 150px; }
  .muted { color: #8a7f74; }
</style></head>
<body>

  <!-- Couverture -->
  <div class="cover">
    <div class="flame">🔥</div>
    <h1>Cahier de test — Launch<span class="forge">Forge</span></h1>
    <div class="sub">Plan de test fonctionnel exhaustif &amp; checklist de recette</div>
    <div class="meta">
      <div><b>Produit :</b> LaunchForge — plateforme SaaS de lancement (plan, contenu, IA, leads, équipes)</div>
      <div><b>Version du document :</b> ${VERSION} &nbsp;·&nbsp; <b>Date :</b> ${DATE}</div>
      <div><b>Périmètre :</b> ${moduleCount} modules · ${totalCases} cas de test (dont ${manualCases} à vérification manuelle ★)</div>
      <div><b>Environnements :</b> dev (localhost:5173) · prod (launchforge.alexandre-lebegue.com)</div>
      <div><b>Testeur :</b> ____________________  &nbsp; <b>Build / commit :</b> ____________________</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n">${moduleCount}</div><div class="l">Modules</div></div>
      <div class="kpi"><div class="n">${totalCases}</div><div class="l">Cas de test</div></div>
      <div class="kpi"><div class="n">${manualCases}</div><div class="l">Vérif. manuelles ★</div></div>
    </div>
  </div>

  <!-- TOC + mode d'emploi -->
  <div class="page">
    <h2><span class="sec-id">i</span> Sommaire &amp; mode d'emploi</h2>
    <p class="intro">Ce cahier couvre l'ensemble des fonctionnalités de LaunchForge, module par module.
      Les lignes marquées <span class="chip">manuel ★</span> exigent une <strong>relecture humaine du contenu produit</strong>
      (analyses IA, commentaires/leads détectés, emails générés, plans, contenus à valider) — un simple « ça ne plante pas » ne suffit pas.</p>

    <table class="toc">
      <tr><th></th><th></th><th></th></tr>
      ${toc}
      <tr><td></td><td style="font-weight:700">Total</td><td class="toc-n" style="font-weight:700">${totalCases}</td></tr>
    </table>

    <div class="legend">
      <h3>Comment utiliser la checklist</h3>
      <ul>
        <li><b>Statut</b> : cocher <span class="box">OK</span> (conforme), <span class="box">KO</span> (anomalie) ou <span class="box">N/A</span> (non applicable / fonction non configurée).</li>
        <li><b>Notes / Anomalie</b> : en cas de KO, décrire le constat, l'écart au résultat attendu, et joindre une capture / l'ID de l'anomalie.</li>
        <li><b>★ Vérification manuelle</b> : juger la <i>qualité et la pertinence</i> du contenu généré, pas seulement l'absence d'erreur technique.</li>
        <li><b>Pré-requis transverses</b> : compte de test, projet de démonstration, et selon les cas une clé IA (OpenRouter), Composio connecté, et un bot Telegram.</li>
      </ul>
      <div class="pillrow">
        <span class="pill">Chrome / Edge</span><span class="pill">Firefox</span><span class="pill">Safari</span>
        <span class="pill">Mobile (≤ 400px)</span><span class="pill">Tablette</span><span class="pill">Desktop</span>
      </div>
    </div>

    <h3>Pré-requis d'environnement</h3>
    <table class="toc">
      <tr><td class="toc-id">IA</td><td>Clé OpenRouter (OPENROUTER_API_KEY) pour onboarding, rédaction, analyses, rapports, decks.</td></tr>
      <tr><td class="toc-id">Réseaux</td><td>Composio (COMPOSIO_API_KEY) + comptes connectés pour publier, lire métriques, scanner emails/réactions, agenda.</td></tr>
      <tr><td class="toc-id">Google</td><td>GOOGLE_CLIENT_ID/SECRET pour « Continuer avec Google ».</td></tr>
      <tr><td class="toc-id">Telegram</td><td>Bot global ou bot perso (token @BotFather) pour notifications et liaison.</td></tr>
      <tr><td class="toc-id">Stripe</td><td>Clés Stripe en mode <b>test</b> + webhook (offre Brasier : paiement, portail, remboursement). <b>BILLING_ENFORCE_LIMITS</b> active (true) ou désactive (false) les limites freemium.</td></tr>
      <tr><td class="toc-id">Données</td><td>2 comptes (dont 1 admin) + 1 équipe avec membres editor/viewer pour les rôles. Pour tester les murs de l'offre <b>Braise</b> : un compte <b>non-admin à l'essai expiré</b> (le fondateur et l'essai restent en Brasier). Carte de test Stripe : <b>4242 4242 4242 4242</b>.</td></tr>
    </table>
  </div>

  <!-- Modules -->
  <div class="page">
    ${body}

    ${platformSectionHtml}

    ${matrixSectionsHtml}

    <h2><span class="sec-id">✔</span> Synthèse &amp; validation de la recette</h2>
    <p class="intro">À compléter en fin de campagne de test.</p>
    <table class="signoff">
      <tr><td class="lab">Cas exécutés</td><td>______ / ${totalCases}</td><td class="lab">Cas OK</td><td>______</td></tr>
      <tr><td class="lab">Cas KO (anomalies)</td><td>______</td><td class="lab">Cas N/A</td><td>______</td></tr>
      <tr><td class="lab">Anomalies bloquantes</td><td colspan="3">____________________________________________________</td></tr>
      <tr><td class="lab">Verdict</td><td colspan="3"><span class="box">Recette acceptée</span> &nbsp; <span class="box">Acceptée avec réserves</span> &nbsp; <span class="box">Refusée</span></td></tr>
      <tr><td class="lab">Testeur / date</td><td>____________________</td><td class="lab">Responsable / date</td><td>____________________</td></tr>
    </table>
    <p class="muted" style="margin-top:14px; text-align:center;">Cahier de test LaunchForge · v${VERSION} · ${DATE} · ${totalCases} cas de test</p>
  </div>

</body></html>`;

const outDir = __dirname;
const htmlPath = path.join(outDir, 'cahier-de-test-launchforge.html');
const pdfPath = path.join(outDir, 'cahier-de-test-launchforge.pdf');
fs.writeFileSync(htmlPath, html, 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%; font-size:8px; color:#9a8d80; padding:0 10mm; display:flex; justify-content:space-between;">' +
      '<span>Cahier de test — LaunchForge</span>' +
      '<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  await browser.close();
  console.log('PDF généré :', pdfPath);
  console.log('Cas de test :', totalCases, '| Vérifs manuelles :', manualCases, '| Modules :', sections.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
