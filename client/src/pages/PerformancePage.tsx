import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Line, Bar, Area, AreaChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { getPerformance, getCampaignReport, getPosts, PerformanceSeries, Post } from '../api/client';
import { platformIcon, platformLabel, engagementRate } from './ContentHubPage';
import Markdown from '../components/Markdown';

const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n));
const fmtWeek = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** Couleurs alignées sur le thème Forge de l'app */
const C = {
  impressions: '#ff6b35',
  likes: '#34d399',
  rel: '#fbbf24',
  grid: 'rgba(255,248,240,0.07)',
  text: '#a39c93',
};

const tooltipStyle = {
  background: '#1a1816',
  border: '1px solid rgba(255,107,53,0.35)',
  borderRadius: 3,
  fontSize: '0.8rem',
};

export default function PerformancePage() {
  const [series, setSeries] = useState<PerformanceSeries | null>(null);
  const [posts,  setPosts]  = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([getPerformance(), getPosts()]).then(([perfRes, postsRes]) => {
      if (perfRes.success && perfRes.data) setSeries(perfRes.data);
      if (postsRes.success && postsRes.data) setPosts(postsRes.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">⏳ Chargement des performances…</div>;

  const published = posts.filter((p) => p.status === 'published');
  const weekly = (series?.weekly ?? []).map((w) => ({ ...w, label: fmtWeek(w.week) }));
  const daily = (series?.daily ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }));
  const hasData = published.length > 0;

  const bestPost = [...published]
    .filter((p) => engagementRate(p) !== null)
    .sort((a, b) => engagementRate(b)! - engagementRate(a)!)[0];

  // Groupes multi-plateformes : même contenu publié sur ≥ 2 plateformes
  const crossGroups = (() => {
    const byGroup = new Map<string, Post[]>();
    for (const p of published) {
      if (p.crossPostId) byGroup.set(p.crossPostId, [...(byGroup.get(p.crossPostId) ?? []), p]);
    }
    return [...byGroup.entries()]
      .filter(([, group]) => group.length >= 2)
      .map(([id, group]) => {
        const best = [...group].sort((a, b) =>
          (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1) || b.impressions - a.impressions)[0];
        return {
          id,
          title: group[0].title || '(sans titre)',
          posts: [...group].sort((a, b) => b.impressions - a.impressions),
          bestId: best.id,
          maxImpressions: Math.max(...group.map((p) => p.impressions)),
        };
      });
  })();

  const byPlatform = Object.entries(
    published.reduce<Record<string, { posts: number; impressions: number; interactions: number }>>((acc, p) => {
      const s = acc[p.platform] ?? { posts: 0, impressions: 0, interactions: 0 };
      s.posts += 1;
      s.impressions += p.impressions;
      s.interactions += p.likes + p.comments + p.shares;
      acc[p.platform] = s;
      return acc;
    }, {}),
  ).sort((a, b) => b[1].impressions - a[1].impressions);

  return (
    <div className="animate-fadeIn">
      <div className="dashboard-header">
        <div>
          <h1>📈 Performances</h1>
          <p>Vos chiffres dans le temps, l'analyse IA, et ce qu'il faut en faire — pour le projet actif.</p>
        </div>
      </div>

      {!hasData ? (
        <div className="plan-empty">
          <span className="plan-empty-icon">📈</span>
          <h2>Pas encore de données</h2>
          <p>Publiez des posts (et laissez la synchro des métriques travailler, ou saisissez-les) — les courbes apparaîtront ici.</p>
        </div>
      ) : (
        <div className="analytics-wrap">
          {/* ── Évolution hebdomadaire ── */}
          <div className="card">
            <div className="card-header">📊 Vues & likes par semaine de publication</div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="imp" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtNum} />
                <YAxis yAxisId="likes" orientation="right" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtNum} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <Bar yAxisId="imp" dataKey="impressions" name="👁️ Vues" fill={C.impressions} fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={34} />
                <Line yAxisId="likes" type="monotone" dataKey="likes" name="❤️ Likes" stroke={C.likes} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="form-hint">Chaque barre agrège les métriques des posts publiés cette semaine-là.</p>
          </div>

          {/* ── Progression relative ── */}
          <div className="card">
            <div className="card-header">🚀 Progression relative (% vs semaine précédente)</div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={weekly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#fff' }} formatter={(v) => [`${Number(v) > 0 ? '+' : ''}${v} %`]} />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Line type="monotone" dataKey="relImpressions" name="Vues %" stroke={C.impressions} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="relLikes" name="Likes %" stroke={C.rel} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Courbe temporelle réelle (snapshots de synchro) ── */}
          {series?.hasHistory ? (
            <div className="card">
              <div className="card-header">⏱️ Croissance cumulée (instantanés de synchro)</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gImp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.impressions} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={C.impressions} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtNum} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#fff' }} />
                  <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                  <Area type="monotone" dataKey="impressions" name="👁️ Vues cumulées" stroke={C.impressions} fill="url(#gImp)" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="likes" name="❤️ Likes cumulés" stroke={C.likes} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="form-hint">
              ⏱️ La courbe de croissance jour par jour apparaîtra dès que la synchro des métriques aura
              accumulé quelques instantanés (chaque synchro — automatique ou manuelle — en enregistre un).
            </p>
          )}

          {/* ── Rapport IA ── */}
          <CampaignReportCard />

          {/* ── Meilleur post ── */}
          {bestPost && (
            <div className="best-post-card" onClick={() => navigate(`/content?edit=${bestPost.id}`)}>
              <span className="best-post-label">🏆 Meilleur post</span>
              <span className="best-post-title">{platformIcon(bestPost.platform)} {bestPost.title || '(sans titre)'}</span>
              <span className="best-post-rate">📈 {engagementRate(bestPost)!.toFixed(1)} % d'engagement</span>
            </div>
          )}

          {/* ── Par plateforme ── */}
          <div className="card">
            <div className="card-header">Performance par plateforme</div>
            {byPlatform.map(([platform, s]) => {
              const rate = s.impressions > 0 ? (s.interactions / s.impressions) * 100 : 0;
              const maxImpressions = byPlatform[0][1].impressions || 1;
              return (
                <div key={platform} className="platform-row">
                  <span className="platform-row-name">{platformIcon(platform)} {platformLabel(platform)}</span>
                  <div className="platform-row-bar">
                    <div className="platform-row-fill" style={{ width: `${Math.max(4, (s.impressions / maxImpressions) * 100)}%` }} />
                  </div>
                  <span className="platform-row-stats">
                    {s.posts} post{s.posts > 1 ? 's' : ''} · 👁️ {fmtNum(s.impressions)} · 📈 {rate.toFixed(1)} %
                  </span>
                </div>
              );
            })}
          </div>

          {/* ── Multi-plateformes : même contenu, plateformes comparées ── */}
          {crossGroups.length > 0 && (
            <div className="card">
              <div className="card-header">📡 Même contenu, plusieurs plateformes</div>
              <p className="form-hint" style={{ marginBottom: 12 }}>
                La comparaison la plus fiable qui soit : seul le canal change. La plateforme
                gagnante de chaque groupe est mise en avant.
              </p>
              {crossGroups.map((group) => (
                <div key={group.id} className="cross-group">
                  <div className="cross-group-title">{group.title}</div>
                  {group.posts.map((p) => {
                    const rate = engagementRate(p);
                    const best = group.bestId === p.id;
                    return (
                      <div key={p.id} className={`platform-row${best ? ' cross-best' : ''}`}
                           onClick={() => navigate(`/content?edit=${p.id}`)} style={{ cursor: 'pointer' }}>
                        <span className="platform-row-name">
                          {best ? '🏆 ' : ''}{platformIcon(p.platform)} {platformLabel(p.platform)}
                        </span>
                        <div className="platform-row-bar">
                          <div className="platform-row-fill"
                               style={{ width: `${Math.max(4, (p.impressions / (group.maxImpressions || 1)) * 100)}%` }} />
                        </div>
                        <span className="platform-row-stats">
                          👁️ {fmtNum(p.impressions)} · ❤️ {fmtNum(p.likes)} · 📈 {rate !== null ? `${rate.toFixed(1)} %` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ── Tableau détaillé ── */}
          <div className="card">
            <div className="card-header">Détail des posts publiés</div>
            <div className="analytics-table">
              <div className="analytics-row analytics-head">
                <span>Post</span><span>👁️</span><span>❤️</span><span>💬</span><span>🔁</span><span>🔗</span><span>📈</span>
              </div>
              {[...published]
                .sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1))
                .map((p) => {
                  const rate = engagementRate(p);
                  return (
                    <div key={p.id} className="analytics-row" onClick={() => navigate(`/content?edit=${p.id}`)}>
                      <span className="analytics-post">{platformIcon(p.platform)} {p.title || '(sans titre)'}</span>
                      <span>{fmtNum(p.impressions)}</span>
                      <span>{fmtNum(p.likes)}</span>
                      <span>{fmtNum(p.comments)}</span>
                      <span>{fmtNum(p.shares)}</span>
                      <span>{fmtNum(p.clicks)}</span>
                      <span className={rate !== null && rate >= 3 ? 'rate-good' : undefined}>
                        {rate !== null ? `${rate.toFixed(1)} %` : '—'}
                      </span>
                    </div>
                  );
                })}
            </div>
            <p className="form-hint" style={{ marginTop: 10 }}>
              💡 Cliquez sur un post pour l'ouvrir (et lancer son analyse IA). Un engagement ≥ 3 % est bon sur la plupart des plateformes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Rapport de campagne IA (déplacé depuis l'onglet Analyse du Hub)
function CampaignReportCard() {
  const [report, setReport] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');

  const generate = async () => {
    setBusy(true);
    setErr('');
    const res = await getCampaignReport();
    setBusy(false);
    if (res.success && res.data) setReport(res.data.report);
    else setErr(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Rapport échoué.');
  };

  return (
    <div className="card">
      <div className="config-card-head">
        <span className="config-card-title">🗞️ Rapport de campagne</span>
        <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={generate} disabled={busy}>
          {busy ? '⏳ Analyse…' : report ? '↺ Actualiser' : '✨ Générer le rapport'}
        </button>
      </div>
      {!report && !busy && (
        <p className="form-hint">
          L'IA lit vos chiffres et vous dit ce qui marche, ce qui ne marche pas, et quoi faire cette
          semaine — les enseignements alimentent la base de connaissances. Aussi envoyé chaque lundi sur Telegram.
        </p>
      )}
      {err && <div className="chat-error">{err}</div>}
      {report && <div style={{ fontSize: '0.875rem' }}><Markdown text={report} /></div>}
    </div>
  );
}
