/* Génère le cahier de test LaunchForge en HTML INTERACTIF.
 *
 *   → cases OK / KO / N/A CLIQUABLES (re-cliquer = désélectionner)
 *   → champ « Notes / Anomalie » ÉDITABLE (saisie directe)
 *   → sauvegarde AUTOMATIQUE dans le navigateur (localStorage)
 *   → barre de progression + compteurs + filtres (Restants / OK / KO / N/A / Manuels)
 *   → export / import des réponses en JSON (sauvegarde, partage, reprise)
 *   → bouton « Imprimer / PDF » pour archiver une version figée avec vos réponses
 *
 * Aucune dépendance externe (pas de Playwright) : produit un fichier .html autonome
 * à ouvrir directement dans un navigateur. Réutilise les mêmes données que le PDF
 * (data.js + data-platforms.js) — le contenu des cas est donc strictement identique.
 *
 *   node cahier-de-test/generate-interactive.js
 */
const fs = require('fs');
const path = require('path');
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

/** Cellule de statut interactive : 3 boutons OK / KO / N/A pour la clé donnée. */
function statusCell(key) {
  const k = esc(key);
  return (
    `<td class="c-s" data-skey="${k}">` +
    `<button type="button" class="st st-ok" data-v="OK">OK</button>` +
    `<button type="button" class="st st-ko" data-v="KO">KO</button>` +
    `<button type="button" class="st st-na" data-v="N/A">N/A</button>` +
    `</td>`
  );
}

/** Cellule de notes / anomalie éditable pour la clé donnée. */
function noteCell(key) {
  return `<td class="c-n"><textarea class="note" data-nkey="${esc(key)}" rows="1" placeholder="Notes / anomalie…"></textarea></td>`;
}

/* ── Comptages (KPI couverture). Inclut les lignes « agents » (DC/SL/GH),
   qui sont elles aussi des cas cochables dans cette version interactive. ── */
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
  sections.reduce((n, s) => n + s.cases.length, 0) +
  platformCases +
  agentOnly.rows.length +
  matrixCases;
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
      <td class="toc-n">${platformCases + agentOnly.rows.length}</td>
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

/* ── Sections standard ── */
const body = sections
  .map((s) => {
    const rows = s.cases
      .map(
        (c) => `<tr class="${c.man ? 'manual' : ''}" data-case="${esc(c.id)}">
          <td class="c-id">${c.id}${c.man ? ' <span class="star" title="Vérification manuelle">★</span>' : ''}</td>
          <td class="c-t">${esc(c.t)}${c.pre ? `<div class="pre">Prérequis : ${esc(c.pre)}</div>` : ''}</td>
          <td class="c-e">${cell(c.e)}</td>
          <td class="c-a">${cell(c.a)}</td>
          ${statusCell(c.id)}
          ${noteCell(c.id)}
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
      (c) => `<tr class="${c.man ? 'manual' : ''}" data-case="${esc(c.id)}">
        <td class="c-id">${c.id}${c.man ? ' <span class="star">★</span>' : ''}</td>
        <td class="c-t">${esc(c.t)}${c.pre ? `<div class="pre">Prérequis : ${esc(c.pre)}</div>` : ''}</td>
        <td class="c-e">${cell(c.e)}</td>
        <td class="c-a">${cell(c.a)}</td>
        ${statusCell(c.id)}
        ${noteCell(c.id)}
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
    (r) => `<tr data-case="${esc(r.code)}">
      <td class="c-id">${r.code}</td>
      <td class="c-t"><span class="pf-icon">${r.icon}</span> ${esc(r.name)}</td>
      <td colspan="2">Format attendu : ${esc(r.fmt)}. Validation : adaptation au format ${esc(r.name)}, mode auto/manuel respecté, publication via les outils Composio ${esc(r.name)}.</td>
      ${statusCell(r.code)}
      ${noteCell(r.code)}
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
      (r) => `<tr data-case="${esc(r[0])}">
        <td class="c-id">${esc(r[0])}</td>
        <td class="c-t">${esc(r[1])}</td>
        <td>${esc(r[2])}</td>
        <td>${esc(r[3])}</td>
        ${statusCell(r[0])}
        ${noteCell(r[0])}
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

/* ── JavaScript client (moteur interactif) ──
   Écrit comme une vraie fonction puis sérialisé : permet d'utiliser des
   gabarits `...` sans conflit avec le littéral de template ci-dessous. */
function clientMain() {
  var KEY = 'launchforge_cahier_test_v1';
  var saveTimer = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  var state = load();
  state.status = state.status || {};
  state.notes = state.notes || {};
  state.fields = state.fields || {};

  function setTxt(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function on(id, ev, fn) { var e = document.getElementById(id); if (e) e.addEventListener(ev, fn); }

  function persist() {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    setTxt('saved-at', 'Sauvegardé ' + new Date().toLocaleTimeString('fr-FR'));
  }
  function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 350); }

  function grow(t) {
    if (!t || t.tagName !== 'TEXTAREA') return;
    t.style.height = 'auto';
    t.style.height = Math.max(t.scrollHeight, 22) + 'px';
  }

  // Applique un statut à une cellule (boutons + teinte de ligne pour les cas).
  function setStatus(key, val) {
    var cell = document.querySelector('[data-skey="' + key + '"]');
    if (!cell) return;
    var btns = cell.querySelectorAll('.st');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-v') === val);
    }
    if (cell.classList.contains('c-s')) {
      var row = cell.closest('tr');
      if (row) { if (val) row.setAttribute('data-st', val); else row.removeAttribute('data-st'); }
    }
  }

  function recompute() {
    var cells = document.querySelectorAll('td.c-s');
    var total = cells.length, ok = 0, ko = 0, na = 0, done = 0;
    for (var i = 0; i < cells.length; i++) {
      var v = state.status[cells[i].getAttribute('data-skey')];
      if (v) { done++; if (v === 'OK') ok++; else if (v === 'KO') ko++; else na++; }
    }
    setTxt('m-total', total); setTxt('m-done', done);
    setTxt('m-ok', ok); setTxt('m-ko', ko); setTxt('m-na', na);
    setTxt('m-rest', total - done);
    var pct = total ? Math.round((done / total) * 100) : 0;
    var bar = document.getElementById('bar-fill'); if (bar) bar.style.width = pct + '%';
    setTxt('m-pct', pct + '%');
    setTxt('sy-done', done); setTxt('sy-total', total);
    setTxt('sy-ok', ok); setTxt('sy-ko', ko); setTxt('sy-na', na);
  }

  function reapplyAll() {
    var act = document.querySelectorAll('.st.active');
    for (var i = 0; i < act.length; i++) act[i].classList.remove('active');
    var tinted = document.querySelectorAll('tr[data-st]');
    for (var j = 0; j < tinted.length; j++) tinted[j].removeAttribute('data-st');
    Object.keys(state.status).forEach(function (k) { setStatus(k, state.status[k]); });
    setStatus('__verdict', state.verdict || '');
    var notes = document.querySelectorAll('.note');
    for (var n = 0; n < notes.length; n++) {
      var nk = notes[n].getAttribute('data-nkey');
      notes[n].value = state.notes[nk] || ''; grow(notes[n]);
    }
    var flds = document.querySelectorAll('[data-fkey]');
    for (var f = 0; f < flds.length; f++) {
      var fk = flds[f].getAttribute('data-fkey');
      flds[f].value = (state.fields[fk] != null ? state.fields[fk] : '');
      if (flds[f].tagName === 'TEXTAREA') grow(flds[f]);
    }
  }

  // --- Clics sur les boutons de statut (cas + verdict) ---
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.st') : null;
    if (!btn) return;
    var cont = btn.closest('[data-skey]');
    if (!cont) return;
    var key = cont.getAttribute('data-skey');
    var val = btn.getAttribute('data-v');
    var cur = (key === '__verdict') ? state.verdict : state.status[key];
    var next = (cur === val) ? '' : val; // re-clic => désélection
    if (key === '__verdict') {
      if (next) state.verdict = next; else delete state.verdict;
    } else {
      if (next) state.status[key] = next; else delete state.status[key];
    }
    setStatus(key, next);
    recompute();
    applyFilter();
    persistSoon();
  });

  // --- Saisie dans les notes / champs ---
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('note')) {
      var k = t.getAttribute('data-nkey');
      if (t.value) state.notes[k] = t.value; else delete state.notes[k];
      grow(t); persistSoon();
    } else if (t.getAttribute && t.getAttribute('data-fkey')) {
      var fk = t.getAttribute('data-fkey');
      if (t.value) state.fields[fk] = t.value; else delete state.fields[fk];
      if (t.tagName === 'TEXTAREA') grow(t);
      persistSoon();
    }
  });

  // --- Filtres + recherche ---
  var filter = 'all', q = '';
  function applyFilter() {
    var rows = document.querySelectorAll('tr[data-case]');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var v = state.status[r.getAttribute('data-case')] || '';
      var manual = r.classList.contains('manual');
      var okF;
      if (filter === 'todo') okF = !v;
      else if (filter === 'OK') okF = v === 'OK';
      else if (filter === 'KO') okF = v === 'KO';
      else if (filter === 'N/A') okF = v === 'N/A';
      else if (filter === 'manual') okF = manual;
      else okF = true;
      var okQ = !q || r.textContent.toLowerCase().indexOf(q) !== -1;
      r.classList.toggle('is-hidden', !(okF && okQ));
    }
    // Masque les blocs sans aucune ligne visible.
    var secs = document.querySelectorAll('.module, .pf-block');
    for (var s = 0; s < secs.length; s++) {
      var caseRows = secs[s].querySelectorAll('tr[data-case]');
      if (!caseRows.length) continue;
      var anyVisible = false;
      for (var c = 0; c < caseRows.length; c++) {
        if (!caseRows[c].classList.contains('is-hidden')) { anyVisible = true; break; }
      }
      secs[s].classList.toggle('is-hidden', !anyVisible);
    }
  }

  // --- Export / Import / Impression / Réinitialisation ---
  function exportJson() {
    var data = JSON.stringify(state, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'cahier-test-launchforge-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var inc = JSON.parse(r.result);
        state.status = Object.assign({}, state.status, inc.status || {});
        state.notes = Object.assign({}, state.notes, inc.notes || {});
        state.fields = Object.assign({}, state.fields, inc.fields || {});
        if (inc.verdict) state.verdict = inc.verdict;
        reapplyAll(); recompute(); applyFilter(); persist();
        alert('Résultats importés.');
      } catch (e) { alert('Fichier invalide : ' + e.message); }
    };
    r.readAsText(file);
  }
  function resetAll() {
    if (!confirm('Effacer TOUTES les réponses et notes de ce navigateur ? Action irréversible (pensez à exporter avant).')) return;
    state = { status: {}, notes: {}, fields: {} };
    try { localStorage.removeItem(KEY); } catch (e) {}
    reapplyAll(); recompute(); applyFilter();
  }

  on('btn-export', 'click', exportJson);
  on('btn-import', 'click', function () { document.getElementById('file-import').click(); });
  on('btn-print', 'click', function () { window.print(); });
  on('btn-reset', 'click', resetAll);
  var fi = document.getElementById('file-import');
  if (fi) fi.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });
  var flts = document.querySelectorAll('[data-filter]');
  for (var i = 0; i < flts.length; i++) {
    (function (b) {
      b.addEventListener('click', function () {
        filter = b.getAttribute('data-filter');
        for (var j = 0; j < flts.length; j++) flts[j].classList.toggle('active', flts[j] === b);
        applyFilter();
      });
    })(flts[i]);
  }
  var search = document.getElementById('search');
  if (search) search.addEventListener('input', function () {
    q = search.value.trim().toLowerCase(); applyFilter();
  });

  // --- Init ---
  reapplyAll();
  recompute();
  applyFilter();
  if (state.savedAt) setTxt('saved-at', 'Sauvegardé ' + new Date(state.savedAt).toLocaleString('fr-FR'));
}

const clientJs = '(' + clientMain.toString() + ')();';

/* ── Document ── */
const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cahier de test interactif — LaunchForge</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1d1a17; font-size: 10.6px; line-height: 1.45; margin: 0; background: #f3efe9; }
  h1, h2, h3 { font-family: "Segoe UI Semibold", "Segoe UI", Arial, sans-serif; }

  /* ── Barre d'outils collante ── */
  .toolbar { position: sticky; top: 0; z-index: 100; background: #1d1a17; color: #fff8f0;
    padding: 8px 14px; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
  .tb-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .tb-row + .tb-row { margin-top: 8px; }
  .tb-title { font-weight: 700; font-size: 13px; }
  .tb-ver { color: #e9b48f; font-weight: 400; font-size: 11px; }
  .tb-actions { margin-left: auto; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .tb-search { background: #2a2522; border: 1px solid #4a423b; color: #fff8f0; border-radius: 6px;
    padding: 5px 9px; font-size: 11px; min-width: 190px; }
  .tb-btn { background: #ff6b35; color: #fff; border: none; border-radius: 6px; padding: 6px 11px;
    font-size: 11px; cursor: pointer; font-weight: 600; }
  .tb-btn:hover { filter: brightness(1.08); }
  .tb-danger { background: #3a3531; color: #e9b48f; }
  .tb-progress { font-size: 11px; }
  .bar { flex: 1; min-width: 150px; height: 9px; background: #3a3531; border-radius: 6px; overflow: hidden; }
  .bar-fill { height: 100%; width: 0; background: linear-gradient(90deg,#ff6b35,#ffb088); transition: width .25s; }
  .counts { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .counts b { color: #fff; }
  .c-ok { color: #86efac; } .c-ko { color: #fca5a5; } .c-na { color: #cbd5e1; } .c-rest { color: #e9b48f; }
  .saved { color: #9a8d80; font-style: italic; }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; }
  .flt { background: #2a2522; color: #cdbfb2; border: 1px solid #4a423b; border-radius: 14px;
    padding: 4px 11px; font-size: 10.5px; cursor: pointer; }
  .flt.active { background: #ff6b35; color: #fff; border-color: #ff6b35; }

  /* ── Couverture ── */
  .cover { min-height: 92vh; display: flex; flex-direction: column; justify-content: center;
    padding: 0 40px; background: linear-gradient(160deg,#1a1816 0%,#2a1a10 60%,#3a1d0a 100%); color: #fff8f0; }
  .cover .flame { font-size: 40px; }
  .cover h1 { font-size: 38px; margin: 8px 0 4px; letter-spacing: -.5px; }
  .cover .forge { color: #ff6b35; }
  .cover .sub { font-size: 16px; color: #e9b48f; margin-bottom: 26px; }
  .cover .meta { font-size: 12px; color: #cdbfb2; line-height: 2.2; border-top: 1px solid rgba(255,107,53,.35);
    padding-top: 18px; max-width: 560px; }
  .cover .meta b { color: #fff8f0; font-weight: 600; }
  .cover .kpis { display: flex; gap: 14px; margin-top: 26px; }
  .cover .kpi { background: rgba(255,107,53,.12); border: 1px solid rgba(255,107,53,.4);
    border-radius: 8px; padding: 12px 18px; }
  .cover .kpi .n { font-size: 24px; font-weight: 700; color: #ff6b35; }
  .cover .kpi .l { font-size: 10px; color: #cdbfb2; text-transform: uppercase; letter-spacing: .5px; }
  input.cover-in { background: rgba(255,255,255,.08); border: 1px solid rgba(255,107,53,.5); color: #fff8f0;
    border-radius: 5px; padding: 3px 8px; font: inherit; font-size: 12px; min-width: 170px; }
  input.cover-in::placeholder { color: #b39e8e; }

  .page { padding: 24px 28px; max-width: 1280px; margin: 0 auto; }
  .sheet { background: #fff; margin: 0 auto; }
  h2 { font-size: 16px; color: #c2410c; border-bottom: 2px solid #ff6b35; padding-bottom: 5px; margin: 0 0 8px; }
  .sec-id { display: inline-block; background: #ff6b35; color: #fff; border-radius: 5px;
    padding: 1px 8px; font-size: 14px; margin-right: 6px; }
  h3 { font-size: 13px; color: #1d1a17; margin: 18px 0 6px; }
  .module { margin-bottom: 18px; }
  .intro { color: #514a43; margin: 4px 0 8px; }

  .callout { background: #fff4ec; border-left: 4px solid #ff6b35; padding: 7px 11px; border-radius: 4px;
    font-size: 10px; color: #7c2d12; margin: 6px 0 9px; }
  .callout .tag { background: #ece5dd; color: #514a43; }

  .hint { background: #ecfdf5; border: 1px solid #a7f3d0; border-left: 4px solid #16a34a; border-radius: 6px;
    padding: 10px 14px; font-size: 11px; color: #14532d; margin: 0 0 14px; }
  .hint b { color: #065f46; }
  .hint .ic { font-size: 13px; }

  /* ── Bloc plateforme (section V) ── */
  .pf-block { margin: 0 0 12px; }
  .pf-h { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #1d1a17;
    margin: 14px 0 3px; padding-bottom: 3px; border-bottom: 1px solid #f0c9af; }
  .pf-icon { font-size: 14px; }
  .pf-code { background: #ff6b35; color: #fff; border-radius: 4px; font-size: 9px; padding: 1px 6px; margin-left: auto; }
  .pf-summary { font-size: 9.6px; color: #8a4b2a; background: #fff7f1; border: 1px solid #f3cbb1;
    border-radius: 4px; padding: 3px 8px; margin: 0 0 5px; }
  .tag { display: inline-block; border-radius: 9px; padding: 0 7px; font-size: 8.6px; font-weight: 600;
    background: #ece5dd; color: #514a43; margin: 0 2px; }
  .tag-req { background: #ffe0d3; color: #b3320b; }
  .tag-sub { background: #ffe9c9; color: #9a5a00; }
  .tag-app { background: #e0e7ff; color: #3730a3; }

  /* ── Table des cas ── */
  table.cases { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
  table.cases th { background: #2a2522; color: #fff8f0; font-size: 9.6px; text-align: left;
    padding: 6px; border: 1px solid #2a2522; text-transform: uppercase; letter-spacing: .3px; }
  table.cases td { border: 1px solid #e4ddd5; padding: 6px; vertical-align: top; }
  table.cases tbody tr:nth-child(even) { background: #faf7f3; }
  tr.manual { background: #fff7f1; }
  tr.manual td { border-color: #f3cbb1; }

  .h-id, .c-id { width: 38px; }
  .h-t,  .c-t  { width: 16%; }
  .h-e,  .c-e  { width: 21%; }
  .h-a,  .c-a  { width: 26%; }
  .h-s,  .c-s  { width: 118px; }
  .h-n,  .c-n  { width: auto; }

  table.matrix .m-pf { width: 14%; }
  table.matrix .m-c  { width: 24%; }
  table.matrix .c-t  { font-weight: 600; }

  .c-id { font-weight: 700; color: #c2410c; }
  .c-t { font-weight: 600; }
  .pre { font-weight: 400; color: #8a7f74; font-size: 9.4px; margin-top: 2px; }
  .star { color: #ff6b35; }
  ol.steps { margin: 0; padding-left: 15px; }
  ol.steps li { margin-bottom: 1px; }

  /* ── Statut interactif ── */
  .c-s { text-align: center; white-space: nowrap; }
  .st { display: inline-block; border: 1.3px solid #b9ada0; background: #fff; border-radius: 5px;
    padding: 3px 7px; font-size: 10.5px; color: #6b6055; cursor: pointer; margin: 1px; font-weight: 600;
    line-height: 1.1; user-select: none; }
  .st:hover { border-color: #6b6055; }
  .st-ok.active { background: #16a34a; border-color: #16a34a; color: #fff; }
  .st-ko.active { background: #dc2626; border-color: #dc2626; color: #fff; }
  .st-na.active { background: #64748b; border-color: #64748b; color: #fff; }
  .st-group { padding: 8px; }
  .st-group .st { padding: 6px 12px; font-size: 11px; margin: 2px; }

  /* Teinte de ligne selon le statut */
  tr[data-st="OK"]  td { background: #f0fdf4 !important; }
  tr[data-st="KO"]  td { background: #fef2f2 !important; }
  tr[data-st="N/A"] td { background: #f5f5f4 !important; }
  tr[data-st="OK"]  .c-id { box-shadow: inset 3px 0 #16a34a; }
  tr[data-st="KO"]  .c-id { box-shadow: inset 3px 0 #dc2626; }
  tr[data-st="N/A"] .c-id { box-shadow: inset 3px 0 #94a3b8; }

  /* ── Notes / champs éditables ── */
  textarea.note, textarea.fld-area { width: 100%; min-height: 22px; border: 1px solid #d8cfc5; border-radius: 4px;
    padding: 4px 6px; font: inherit; font-size: 10px; resize: vertical; box-sizing: border-box;
    background: #fffefb; overflow: hidden; }
  textarea.note:focus, textarea.fld-area:focus { outline: 2px solid #ffb088; border-color: #ff6b35; }
  input.fld { width: 100%; box-sizing: border-box; border: 1px solid #d8cfc5; border-radius: 4px;
    padding: 5px 7px; font: inherit; font-size: 10.5px; }
  input.fld:focus { outline: 2px solid #ffb088; border-color: #ff6b35; }

  /* ── TOC & légende ── */
  table.toc { width: 100%; border-collapse: collapse; margin-top: 6px; background: #fff; }
  table.toc td { padding: 5px 8px; border-bottom: 1px solid #ece5dd; font-size: 11px; }
  .toc-id { width: 40px; font-weight: 700; color: #c2410c; }
  .toc-n { width: 60px; text-align: center; color: #8a7f74; }
  .chip { background: #ffe6d6; color: #c2410c; border-radius: 10px; padding: 0 7px; font-size: 8.8px;
    font-weight: 600; vertical-align: middle; }

  .legend { background: #faf7f3; border: 1px solid #e4ddd5; border-radius: 6px; padding: 12px 16px;
    margin-top: 14px; font-size: 10.5px; }
  .legend h3 { margin-top: 0; }
  .legend ul { margin: 4px 0; padding-left: 18px; }
  .legend li { margin-bottom: 4px; }

  .pillrow { margin: 10px 0; }
  .pill { display: inline-block; background: #2a2522; color: #fff8f0; border-radius: 12px;
    padding: 2px 10px; font-size: 9.5px; margin: 0 4px 4px 0; }

  .signoff { width: 100%; margin-top: 16px; border-collapse: collapse; border: 1px solid #e4ddd5; background: #fff; }
  .signoff td { border: 1px solid #e4ddd5; padding: 9px 10px; font-size: 11px; }
  .signoff .lab { background: #faf7f3; font-weight: 600; width: 170px; }
  .signoff b { color: #c2410c; }
  .muted { color: #8a7f74; }

  .is-hidden { display: none !important; }

  /* ── Impression / export PDF figé ── */
  @media print {
    body { background: #fff; }
    .no-print, .toolbar { display: none !important; }
    .is-hidden { display: revert !important; }       /* PDF complet : on ré-affiche tout */
    .page { max-width: none; padding: 0 6mm; }
    .cover { min-height: 96vh; page-break-after: always; }
    .module, .pf-block { page-break-inside: auto; }
    table.cases tr { page-break-inside: avoid; }
    table.cases thead { display: table-header-group; }
    .st { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .st:not(.active) { opacity: .3; }
    textarea.note, textarea.fld-area { resize: none; border-color: #ccc; }
  }
</style></head>
<body>

  <!-- Barre d'outils -->
  <div class="toolbar no-print">
    <div class="tb-row">
      <div class="tb-title">🔥 Cahier de test — Launch<span style="color:#ff6b35">Forge</span> <span class="tb-ver">interactif · v${VERSION}</span></div>
      <div class="tb-actions">
        <input id="search" class="tb-search" type="search" placeholder="Rechercher (id, mot-clé)…">
        <button id="btn-export" class="tb-btn">⬇ Exporter</button>
        <button id="btn-import" class="tb-btn">⬆ Importer</button>
        <input id="file-import" type="file" accept="application/json,.json" hidden>
        <button id="btn-print" class="tb-btn">🖨 Imprimer / PDF</button>
        <button id="btn-reset" class="tb-btn tb-danger">↺ Réinitialiser</button>
      </div>
    </div>
    <div class="tb-row tb-progress">
      <div class="bar"><div id="bar-fill" class="bar-fill"></div></div>
      <div class="counts">
        <span class="cnt"><b id="m-done">0</b>/<span id="m-total">0</span> traités (<span id="m-pct">0%</span>)</span>
        <span class="cnt c-ok">✓ <b id="m-ok">0</b></span>
        <span class="cnt c-ko">✗ <b id="m-ko">0</b></span>
        <span class="cnt c-na">N/A <b id="m-na">0</b></span>
        <span class="cnt c-rest">Restants <b id="m-rest">0</b></span>
        <span id="saved-at" class="cnt saved"></span>
      </div>
      <div class="filters">
        <button class="flt active" data-filter="all">Tous</button>
        <button class="flt" data-filter="todo">Restants</button>
        <button class="flt" data-filter="OK">OK</button>
        <button class="flt" data-filter="KO">KO</button>
        <button class="flt" data-filter="N/A">N/A</button>
        <button class="flt" data-filter="manual">Manuels ★</button>
      </div>
    </div>
  </div>

  <!-- Couverture -->
  <div class="cover">
    <div class="flame">🔥</div>
    <h1>Cahier de test — Launch<span class="forge">Forge</span></h1>
    <div class="sub">Checklist de recette interactive — cochez, annotez, exportez</div>
    <div class="meta">
      <div><b>Produit :</b> LaunchForge — plateforme SaaS de lancement (plan, contenu, IA, leads, équipes)</div>
      <div><b>Version du document :</b> ${VERSION} &nbsp;·&nbsp; <b>Date :</b> ${DATE}</div>
      <div><b>Périmètre :</b> ${moduleCount} modules · ${totalCases} cas de test (dont ${manualCases} à vérification manuelle ★)</div>
      <div><b>Environnements :</b> dev (localhost:5173) · prod (launchforge.alexandre-lebegue.com)</div>
      <div><b>Testeur :</b> <input class="cover-in" data-fkey="testerName" placeholder="votre nom"> &nbsp; <b>Build / commit :</b> <input class="cover-in" data-fkey="build" placeholder="ex. 002fb0c"></div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n">${moduleCount}</div><div class="l">Modules</div></div>
      <div class="kpi"><div class="n">${totalCases}</div><div class="l">Cas de test</div></div>
      <div class="kpi"><div class="n">${manualCases}</div><div class="l">Vérif. manuelles ★</div></div>
    </div>
  </div>

  <!-- TOC + mode d'emploi -->
  <div class="page">
    <div class="hint no-print">
      <span class="ic">🖱️</span> <b>Mode interactif :</b> cliquez sur <b>OK</b>, <b>KO</b> ou <b>N/A</b> pour chaque cas
      (re-cliquez pour désélectionner), et écrivez directement dans la colonne <b>Notes / Anomalie</b>.
      Tout est <b>sauvegardé automatiquement dans ce navigateur</b>. Utilisez <b>⬇ Exporter</b> pour conserver/partager
      vos réponses en fichier, <b>⬆ Importer</b> pour les recharger, et <b>🖨 Imprimer / PDF</b> pour archiver une version figée.
    </div>

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
        <li><b>Statut</b> : cliquer <span class="st st-ok active">OK</span> (conforme), <span class="st st-ko active">KO</span> (anomalie) ou <span class="st st-na active">N/A</span> (non applicable). Re-cliquer le même bouton le désélectionne ; la ligne se colore selon le statut.</li>
        <li><b>Notes / Anomalie</b> : écrire directement dans le champ — en cas de KO, décrire le constat, l'écart au résultat attendu, joindre une capture / l'ID de l'anomalie. Le champ s'agrandit tout seul.</li>
        <li><b>Sauvegarde</b> : automatique dans ce navigateur (localStorage). <b>⬇ Exporter</b> / <b>⬆ Importer</b> pour conserver, partager ou reprendre sur une autre machine.</li>
        <li><b>Filtres</b> (barre du haut) : n'afficher que les <i>Restants</i>, les <i>KO</i>, les <i>Manuels ★</i>… La recherche filtre par id ou mot-clé.</li>
        <li><b>🖨 Imprimer / PDF</b> : génère un PDF figé avec vos réponses (toutes les lignes, filtres ignorés).</li>
        <li><b>★ Vérification manuelle</b> : juger la <i>qualité et la pertinence</i> du contenu généré, pas seulement l'absence d'erreur technique.</li>
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
    <p class="intro">Compteurs calculés automatiquement à partir de vos réponses. Complétez le verdict et les signatures.</p>
    <table class="signoff">
      <tr><td class="lab">Cas exécutés</td><td><b id="sy-done">0</b> / <span id="sy-total">0</span></td><td class="lab">Cas OK</td><td><b id="sy-ok">0</b></td></tr>
      <tr><td class="lab">Cas KO (anomalies)</td><td><b id="sy-ko">0</b></td><td class="lab">Cas N/A</td><td><b id="sy-na">0</b></td></tr>
      <tr><td class="lab">Anomalies bloquantes</td><td colspan="3"><textarea class="fld-area" data-fkey="blockers" rows="1" placeholder="Lister les anomalies bloquantes (id du cas + constat)…"></textarea></td></tr>
      <tr><td class="lab">Verdict</td><td colspan="3" class="st-group" data-skey="__verdict">
        <button type="button" class="st st-ok" data-v="Recette acceptée">Recette acceptée</button>
        <button type="button" class="st st-na" data-v="Acceptée avec réserves">Acceptée avec réserves</button>
        <button type="button" class="st st-ko" data-v="Refusée">Refusée</button>
      </td></tr>
      <tr><td class="lab">Testeur / date</td><td><input class="fld" data-fkey="testerDate" placeholder="nom / date"></td><td class="lab">Responsable / date</td><td><input class="fld" data-fkey="responsibleDate" placeholder="nom / date"></td></tr>
    </table>
    <p class="muted" style="margin-top:14px; text-align:center;">Cahier de test LaunchForge · v${VERSION} · ${DATE} · ${totalCases} cas de test · version interactive</p>
  </div>

  <script>${clientJs}</script>
</body></html>`;

const outDir = __dirname;
const htmlPath = path.join(outDir, 'cahier-de-test-launchforge-interactif.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('HTML interactif généré :', htmlPath);
console.log('Cas de test :', totalCases, '| Vérifs manuelles :', manualCases, '| Modules :', moduleCount);
