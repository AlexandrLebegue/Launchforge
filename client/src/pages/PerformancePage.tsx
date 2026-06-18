import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, TrendingUp, Sparkles, MessageSquareText, History, ChevronDown,
  CheckCircle2, AlertTriangle, Target, ListChecks, FileText, MessageCircle, RefreshCw,
} from 'lucide-react';
import {
  ComposedChart, Line, Bar, BarChart, Area, AreaChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  getPerformance, getCampaignReport, getCampaignReports, getPosts, getComments, refreshComments, analyzeComments,
  PerformanceSeries, Post, CampaignReportItem, CommentStats, CommentAnalysis,
} from '../api/client';
import { platformLabel, engagementRate } from './ContentHubPage';
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

const PLATFORM_COLORS: Record<string, string> = {
  linkedin:     '#0a66c2',
  twitter:      '#1d9bf0',
  instagram:    '#e1306c',
  facebook:     '#1877f2',
  tiktok:       '#ff0050',
  youtube:      '#ff0000',
  reddit:       '#ff4500',
  blog:         '#6366f1',
  newsletter:   '#8b5cf6',
  producthunt:  '#da552f',
  hackernews:   '#ff6600',
  indiehackers: '#5b8af0',
};


function useCountUp(target: number | null, duration = 1100): number | null {
  const [val, setVal] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) { setVal(null); return; }
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - (1 - p) ** 3;
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function RelativeDeltaCard({ weekly }: {
  weekly: { relImpressions: number | null; relLikes: number | null; label: string }[];
}) {
  const last = [...weekly].reverse().find((w) => w.relImpressions !== null || w.relLikes !== null) ?? null;
  const relImp = last?.relImpressions ?? null;
  const relLik = last?.relLikes ?? null;

  const animImp = useCountUp(relImp);
  const animLik = useCountUp(relLik);

  const DeltaStat = ({
    raw, animated, color, label,
  }: { raw: number | null; animated: number | null; color: string; label: string }) => {
    const isNull = raw === null;
    const isPos  = !isNull && raw! >= 0;
    const col    = isNull ? C.text : isPos ? color : '#f87171';
    const glow   = isNull ? 'none' : `0 0 28px ${col}44`;
    const display = animated ?? raw;
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 8px' }}>
        <div style={{
          fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: C.text, marginBottom: 18,
        }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
          {!isNull && (
            <span style={{ fontSize: '1.3rem', color: col, paddingTop: 7, lineHeight: 1, transition: 'color 0.3s' }}>
              {isPos ? '▲' : '▼'}
            </span>
          )}
          <span style={{
            fontSize: '3.6rem', fontWeight: 800, color: col, lineHeight: 1,
            letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
            textShadow: glow, transition: 'color 0.3s, text-shadow 0.3s',
          }}>
            {isNull ? '—' : Math.abs(display ?? 0).toFixed(1)}
          </span>
          {!isNull && (
            <span style={{ fontSize: '1.6rem', color: col, paddingTop: 10, lineHeight: 1, fontWeight: 700, transition: 'color 0.3s' }}>
              %
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: col, marginTop: 10, opacity: isNull ? 0.4 : 0.7, transition: 'color 0.3s' }}>
          {isNull ? 'pas de comparatif' : `${isPos ? '+' : ''}${raw!.toFixed(1)} % vs sem. préc.`}
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-header">Progression vs semaine précédente</div>
      <div style={{ display: 'flex', gap: 0, flex: 1 }}>
        <DeltaStat raw={relImp} animated={animImp} color={C.impressions} label="Vues" />
        <div style={{ width: 1, background: C.grid, margin: '12px 0' }} />
        <DeltaStat raw={relLik} animated={animLik} color={C.likes} label="Likes" />
      </div>
      {last && (
        <p className="form-hint" style={{ textAlign: 'center', marginTop: 0, paddingBottom: 8 }}>
          Semaine du {last.label}
        </p>
      )}
      {!last && (
        <p className="form-hint" style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          Publiez sur plusieurs semaines pour voir la progression.
        </p>
      )}
    </div>
  );
}

type PlatformStat = { posts: number; impressions: number; interactions: number };

function PlatformBarChart({ data }: { data: [string, PlatformStat][] }) {
  const barData = data.map(([platform, s]) => ({
    platform,
    name: platformLabel(platform),
    impressions: s.impressions,
    posts: s.posts,
    rate: s.impressions > 0 ? (s.interactions / s.impressions) * 100 : 0,
    fill: PLATFORM_COLORS[platform] ?? '#a39c93',
  }));
  const height = Math.max(140, barData.length * 52 + 16);

  const renderLabel = (props: any) => {
    const { x, y, width, height, value, index } = props;
    const d = barData[index];
    const text = `${fmtNum(value)} · ${d.rate.toFixed(1)} %`;
    const inside = width > 120;
    return (
      <text
        x={inside ? x + width - 10 : x + width + 10}
        y={y + height / 2}
        fill={inside ? '#fff' : C.text}
        textAnchor={inside ? 'end' : 'start'}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={600}
      >
        {text}
      </text>
    );
  };

  return (
    <div className="card">
      <div className="card-header">Performance par plateforme</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 4 }} barCategoryGap="28%">
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" hide tickFormatter={fmtNum} />
          <YAxis
            type="category"
            dataKey="name"
            width={96}
            tick={{ fill: '#c0b8b0', fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: '#fff' }}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            formatter={(_v, _n, item: any) => {
              const d = item?.payload;
              return [`${fmtNum(d.impressions)} vues · ${d.posts} post${d.posts > 1 ? 's' : ''} · ${d.rate.toFixed(1)} % eng.`, ''];
            }}
          />
          <Bar
            dataKey="impressions"
            radius={[0, 5, 5, 0]}
            maxBarSize={32}
            animationDuration={900}
            animationEasing="ease-out"
            label={renderLabel}
          >
            {barData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} fillOpacity={0.88} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function NetworkPieChart({ data }: { data: [string, PlatformStat][] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const total = data.reduce((sum, [, s]) => sum + s.impressions, 0);
  const pieData = data.map(([platform, s]) => ({
    name: platform,
    value: s.impressions,
    pct: total > 0 ? (s.impressions / total) * 100 : 0,
    fill: PLATFORM_COLORS[platform] ?? '#a39c93',
    posts: s.posts,
  }));

  const active = activeIdx !== null ? pieData[activeIdx] : null;

  return (
    <div className="card">
      <div className="card-header">Impact total par réseau</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 260px', position: 'relative' }}>
          <ResponsiveContainer width={260} height={260}>
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={112}
                dataKey="value"
                nameKey="name"
                onMouseEnter={(_, i) => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
                strokeWidth={0}
                paddingAngle={2}
              >
                {pieData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.fill}
                    fillOpacity={activeIdx === null || activeIdx === i ? 1 : 0.28}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center', pointerEvents: 'none',
          }}>
            {active ? (
              <>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: active.fill, lineHeight: 1 }}>{fmtNum(active.value)}</div>
                <div style={{ fontSize: '0.62rem', color: C.text, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>vues</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff', marginTop: 5 }}>{active.pct.toFixed(1)} %</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>{fmtNum(total)}</div>
                <div style={{ fontSize: '0.62rem', color: C.text, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>vues totales</div>
              </>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 180 }}>
          {pieData.map((entry, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'default',
                background: activeIdx === i ? 'rgba(255,255,255,0.05)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: entry.fill, flexShrink: 0,
                boxShadow: activeIdx === i ? `0 0 7px ${entry.fill}` : 'none',
                transition: 'box-shadow 0.2s',
              }} />
              <span style={{
                flex: 1, fontSize: '0.83rem',
                color: activeIdx === i ? '#fff' : '#c0b8b0',
                fontWeight: activeIdx === i ? 600 : 400,
                transition: 'color 0.15s',
              }}>
                {platformLabel(entry.name)}
              </span>
              <span style={{
                fontSize: '0.83rem', fontWeight: 700,
                color: activeIdx === i ? entry.fill : '#fff',
                minWidth: 44, textAlign: 'right',
                transition: 'color 0.15s',
              }}>
                {entry.pct.toFixed(1)} %
              </span>
              <span style={{ fontSize: '0.73rem', color: C.text, minWidth: 38, textAlign: 'right' }}>
                {fmtNum(entry.value)}
              </span>
            </div>
          ))}
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: `1px solid ${C.grid}`,
            display: 'flex', justifyContent: 'space-between',
            fontSize: '0.72rem', color: C.text,
          }}>
            <span>{data.length} réseau{data.length > 1 ? 'x' : ''}</span>
            <span>{fmtNum(total)} vues · {data.reduce((s, [, v]) => s + v.posts, 0)} posts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

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
      <div className="dashboard-header" data-tour="perf-header">
        <div>
          <h1>Performances</h1>
          <p>Vos chiffres dans le temps, l'analyse IA, et ce qu'il faut en faire — pour le projet actif.</p>
        </div>
      </div>

      {!hasData ? (
        <div className="plan-empty">
          <span className="plan-empty-icon"><TrendingUp size={40} /></span>
          <h2>Pas encore de données</h2>
          <p>Publiez des posts (et laissez la synchro des métriques travailler, ou saisissez-les) — les courbes apparaîtront ici.</p>
        </div>
      ) : (
        <div className="analytics-wrap" data-tour="perf-analytics">
          {/* ── Évolution hebdomadaire ── */}
          <div className="card">
            <div className="card-header">Vues & likes par semaine de publication</div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={weekly} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="imp" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtNum} />
                <YAxis yAxisId="likes" orientation="right" tick={{ fill: C.text, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtNum} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#fff' }} />
                <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
                <Bar yAxisId="imp" dataKey="impressions" name="Vues" fill={C.impressions} fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={34} />
                <Line yAxisId="likes" type="monotone" dataKey="likes" name="Likes" stroke={C.likes} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="form-hint">Chaque barre agrège les métriques des posts publiés cette semaine-là.</p>
          </div>

          {/* ── Progression relative + Camembert côte à côte (empilés en mobile) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16, alignItems: 'stretch' }}>
            <RelativeDeltaCard weekly={weekly} />
            <NetworkPieChart data={byPlatform} />
          </div>

          {/* ── Courbe temporelle réelle (snapshots de synchro) ── */}
          {series?.hasHistory ? (
            <div className="card">
              <div className="card-header">⏱ Croissance cumulée (instantanés de synchro)</div>
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
                  <Area type="monotone" dataKey="impressions" name="Vues cumulées" stroke={C.impressions} fill="url(#gImp)" strokeWidth={2.5} />
                  <Line type="monotone" dataKey="likes" name="Likes cumulés" stroke={C.likes} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="form-hint">
              ⏱ La courbe de croissance jour par jour apparaîtra dès que la synchro des métriques aura
              accumulé quelques instantanés (chaque synchro — automatique ou manuelle — en enregistre un).
            </p>
          )}

          {/* ── Rapport IA ── */}
          <CampaignReportCard />

          {/* ── Meilleur post ── */}
          {bestPost && (
            <div className="best-post-card" onClick={() => navigate(`/content?edit=${bestPost.id}`)}>
              <span className="best-post-label"><Trophy size={14} /> Meilleur post</span>
              <span className="best-post-title">{bestPost.title || '(sans titre)'}</span>
              <span className="best-post-rate">{engagementRate(bestPost)!.toFixed(1)} % d'engagement</span>
            </div>
          )}

          {/* ── Par plateforme ── */}
          <PlatformBarChart data={byPlatform} />

          {/* ── Commentaires (contenu réel, par type de post) ── */}
          <CommentsCard />

          {/* ── Multi-plateformes : même contenu, plateformes comparées ── */}
          {crossGroups.length > 0 && (
            <div className="card">
              <div className="card-header">Impact d'un même post par plateforme</div>
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
                          {best && <Trophy size={13} className="cross-trophy" />}{platformLabel(p.platform)}
                        </span>
                        <div className="platform-row-bar">
                          <div className="platform-row-fill"
                               style={{ width: `${Math.max(4, (p.impressions / (group.maxImpressions || 1)) * 100)}%` }} />
                        </div>
                        <span className="platform-row-stats">
                          {fmtNum(p.impressions)} · {fmtNum(p.likes)} · {rate !== null ? `${rate.toFixed(1)} %` : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ── Tableau détaillé ── */}
          <div className="card" data-tour="perf-table">
            <div className="card-header">Détail des posts publiés</div>
            <div className="analytics-table">
              <div className="analytics-row analytics-head">
                <span>Post</span><span></span><span></span><span></span><span></span><span></span><span></span>
              </div>
              {[...published]
                .sort((a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1))
                .map((p) => {
                  const rate = engagementRate(p);
                  return (
                    <div key={p.id} className="analytics-row" onClick={() => navigate(`/content?edit=${p.id}`)}>
                      <span className="analytics-post">{platformLabel(p.platform)} · {p.title || '(sans titre)'}</span>
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
              Cliquez sur un post pour l'ouvrir (et lancer son analyse IA). Un engagement ≥ 3 % est bon sur la plupart des plateformes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analyse de campagne IA : parsing en sections + liens vers l'assistant ────

type SectionKind = 'summary' | 'good' | 'bad' | 'leads' | 'actions' | 'other';
interface ReportSection { title: string; body: string; kind: SectionKind }

/** Palette sobre : neutre par défaut, l'accent sémantique reste sur la petite icône uniquement. */
const SECTION_STYLE: Record<SectionKind, { accent: string; Icon: typeof Sparkles }> = {
  summary: { accent: 'var(--color-primary)',     Icon: Sparkles },
  good:    { accent: 'var(--color-success)',     Icon: CheckCircle2 },
  bad:     { accent: 'var(--color-error)',       Icon: AlertTriangle },
  leads:   { accent: 'var(--color-text-muted)',  Icon: Target },
  actions: { accent: 'var(--color-primary)',     Icon: ListChecks },
  other:   { accent: 'var(--color-text-muted)',  Icon: FileText },
};

function classifySection(title: string): SectionKind {
  const t = title.toLowerCase();
  if (t.includes('marche pas') || t.includes('ne marche')) return 'bad';
  if (t.includes('marche') || t.includes('fort')) return 'good';
  if (t.includes('essentiel') || t.includes('résumé') || t.includes('resume')) return 'summary';
  if (t.includes('lead')) return 'leads';
  if (t.includes('faire') || t.includes('semaine') || t.includes('recommand') || t.includes('action')) return 'actions';
  return 'other';
}

function parseReport(md: string): ReportSection[] {
  const parts = md.split(/^##\s+/m).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [{ title: 'Analyse', body: md.trim(), kind: 'other' }];
  return parts.map((part) => {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).replace(/\s*\(.*\)\s*$/, '').trim();
    const body = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    return { title, body, kind: classifySection(title) };
  });
}

function discussPrompt(s: ReportSection): string {
  switch (s.kind) {
    case 'bad':     return `D'après l'analyse de campagne, voici ce qui ne marche pas :\n\n${s.body}\n\nAide-moi à corriger ça : donne-moi des actions concrètes et, si pertinent, rédige les contenus nécessaires.`;
    case 'good':    return `D'après l'analyse de campagne, voici ce qui marche :\n\n${s.body}\n\nComment capitaliser dessus et amplifier ces résultats ?`;
    case 'leads':   return `Voici mon pipeline posts → leads :\n\n${s.body}\n\nComment générer davantage de leads ? Propose un plan concret.`;
    case 'actions': return `Voici les recommandations de l'analyse de campagne pour cette semaine :\n\n${s.body}\n\nAide-moi à les mettre en œuvre une par une, en commençant par la plus prioritaire.`;
    case 'summary': return `Voici l'essentiel de mon analyse de campagne :\n\n${s.body}\n\nQu'est-ce que je devrais faire en priorité maintenant ?`;
    default:        return `À propos de mon analyse de campagne — « ${s.title} » :\n\n${s.body}\n\nQu'en penses-tu et que me recommandes-tu ?`;
  }
}

function SectionedReport({ markdown, onDiscuss }: { markdown: string; onDiscuss: (prompt: string) => void }) {
  const sections = parseReport(markdown);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sections.map((s, i) => {
        const st = SECTION_STYLE[s.kind];
        const { Icon } = st;
        return (
          <div
            key={i}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 10,
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <Icon size={15} color={st.accent} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text)', letterSpacing: '0.01em', flex: 1 }}>
                {s.title}
              </span>
              <button
                type="button"
                onClick={() => onDiscuss(discussPrompt(s))}
                title="Continuer avec l'assistant IA"
                className="report-discuss-btn"
              >
                <MessageSquareText size={12} /> En discuter
              </button>
            </div>
            {s.body && <div style={{ fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--color-text)' }}><Markdown text={s.body} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Commentaires : contenu réel récupéré, groupé par type de post ────────────

const SENTIMENT_STYLE: Record<string, { label: string; color: string }> = {
  positif:  { label: 'Positif', color: '#34d399' },
  'mitigé': { label: 'Mitigé',  color: '#fbbf24' },
  'négatif': { label: 'Négatif', color: '#f87171' },
  'n/a':    { label: '—',       color: C.text },
};

function CommentsCard() {
  const [stats, setStats]         = useState<CommentStats | null>(null);
  const [analysis, setAnalysis]   = useState<CommentAnalysis | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr]             = useState('');
  const [open, setOpen]           = useState<string | null>(null);

  useEffect(() => {
    getComments().then((res) => {
      if (res.success && res.data) setStats(res.data);
      setLoading(false);
    });
  }, []);

  const refresh = async () => {
    setRefreshing(true); setErr('');
    const res = await refreshComments();
    setRefreshing(false);
    if (res.success && res.data) {
      setStats(res.data.stats);
      if (res.data.eligible === 0) setErr('Aucun post publié avec une URL renseignée à scanner — renseignez l\'URL d\'un post publié.');
      else if (res.data.added === 0) setErr('Aucun nouveau commentaire trouvé (les plateformes connectées n\'en exposent peut-être pas).');
    } else {
      setErr(res.error === 'COMPOSIO_NOT_CONFIGURED'
        ? 'Composio non configuré — la récupération des commentaires est indisponible.'
        : res.error || 'Récupération échouée.');
    }
  };

  const analyze = async () => {
    setAnalyzing(true); setErr('');
    const res = await analyzeComments();
    setAnalyzing(false);
    if (res.success && res.data) setAnalysis(res.data);
    else setErr(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Analyse échouée.');
  };

  if (loading) return null;

  const total = stats?.total ?? 0;
  const sentimentFor = (platform: string) => analysis?.byPlatform.find((p) => p.platform === platform);

  return (
    <div className="card">
      <div className="config-card-head" style={{ marginBottom: 14 }}>
        <span className="config-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageCircle size={16} color={C.impressions} /> Commentaires
          {total > 0 && <span style={{ color: C.text, fontWeight: 400 }}>· {total}</span>}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            {refreshing ? 'Récupération…' : 'Récupérer'}
          </button>
          {total > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={analyze} disabled={analyzing}>
              <Sparkles size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} />
              {analyzing ? 'Analyse…' : 'Analyser (IA)'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="chat-error" style={{ marginBottom: 10 }}>{err}</div>}

      {total === 0 ? (
        <p className="form-hint" style={{ margin: 0 }}>
          Aucun commentaire récupéré pour l'instant. Cliquez « Récupérer » (ou synchronisez les métriques d'un
          post publié) — les commentaires laissés sur vos posts apparaîtront ici, regroupés par réseau.
        </p>
      ) : (
        <>
          {analysis?.overall && (
            <div style={{
              fontSize: '0.85rem', lineHeight: 1.55, color: 'var(--color-text)',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 10, padding: '12px 14px', marginBottom: 12,
            }}>
              <Sparkles size={13} color={C.impressions} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {analysis.overall}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stats!.byPlatform.map((p) => {
              const isOpen = open === p.platform;
              const s = sentimentFor(p.platform);
              const sStyle = s && s.sentiment !== 'n/a' ? SENTIMENT_STYLE[s.sentiment] : null;
              return (
                <div key={p.platform} style={{ border: `1px solid ${C.grid}`, borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : p.platform)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', cursor: 'pointer', border: 'none', textAlign: 'left',
                      background: isOpen ? 'rgba(255,255,255,0.03)' : 'transparent', color: 'inherit',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: PLATFORM_COLORS[p.platform] ?? '#a39c93', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: '#fff' }}>{platformLabel(p.platform)}</span>
                    {sStyle && (
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                        color: sStyle.color, border: `1px solid ${sStyle.color}55`, borderRadius: 5, padding: '1px 6px',
                      }}>
                        {sStyle.label}
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: C.text }}>
                      {p.total} commentaire{p.total > 1 ? 's' : ''}
                    </span>
                    <ChevronDown size={15} color={C.text} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
                  </button>

                  {isOpen && (
                    <div style={{ padding: '4px 14px 14px' }}>
                      {s && (s.summary || s.themes.length > 0) && (
                        <div style={{ marginBottom: 12 }}>
                          {s.summary && <p className="form-hint" style={{ margin: '0 0 8px' }}>{s.summary}</p>}
                          {s.themes.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {s.themes.map((t, i) => (
                                <span key={i} style={{
                                  fontSize: '0.72rem', color: '#c0b8b0',
                                  background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.grid}`,
                                  borderRadius: 20, padding: '2px 10px',
                                }}>{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {p.comments.map((c, i) => (
                          <div key={i} style={{ borderLeft: `2px solid ${C.grid}`, paddingLeft: 12 }}>
                            <div style={{ fontSize: '0.76rem', color: C.text, marginBottom: 2 }}>
                              <strong style={{ color: '#c0b8b0' }}>{c.author || 'Anonyme'}</strong>
                              {c.likeCount > 0 && <span> · {fmtNum(c.likeCount)} ❤</span>}
                              {c.commentedAt && <span> · {fmtDay(c.commentedAt)}</span>}
                            </div>
                            <div style={{ fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const fmtReportDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Rapport de campagne IA (déplacé depuis l'onglet Analyse du Hub)
function CampaignReportCard() {
  const [report, setReport] = useState('');
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const [history, setHistory] = useState<CampaignReportItem[]>([]);
  const [openId,  setOpenId]  = useState<string | null>(null);
  const navigate = useNavigate();

  const loadHistory = () =>
    getCampaignReports().then((res) => { if (res.success && res.data) setHistory(res.data); });

  useEffect(() => { loadHistory(); }, []);

  const discuss = (prompt: string) => navigate(`/assistant?prompt=${encodeURIComponent(prompt)}`);

  const generate = async () => {
    setBusy(true);
    setErr('');
    const res = await getCampaignReport();
    setBusy(false);
    if (res.success && res.data) { setReport(res.data.report); loadHistory(); }
    else setErr(res.error === 'AI_NOT_CONFIGURED' ? 'IA non configurée (OPENROUTER_API_KEY).' : res.error || 'Rapport échoué.');
  };

  // L'analyse fraîchement générée est aussi archivée : on l'exclut de l'historique pour éviter le doublon
  const pastReports = report ? history.filter((h) => h.report !== report) : history;

  return (
    <>
      <div className="card" data-tour="perf-report">
        <div className="config-card-head" style={{ marginBottom: report ? 16 : 0 }}>
          <span className="config-card-title">Analyse de campagne IA</span>
          {report && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={generate} disabled={busy}>
              {busy ? '⏳ Analyse…' : '↺ Actualiser'}
            </button>
          )}
        </div>

        {!report && (
          <div style={{ textAlign: 'center', padding: '20px 16px 8px' }}>
            <div style={{
              width: 56, height: 56, margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              background: 'radial-gradient(circle at 50% 35%, rgba(255,107,53,0.28), rgba(255,107,53,0.05))',
              border: '1px solid rgba(255,107,53,0.3)',
            }}>
              <Sparkles size={26} color={C.impressions} />
            </div>
            <p className="form-hint" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
              L'IA lit vos chiffres et vous dit ce qui marche, ce qui ne marche pas, et quoi faire cette
              semaine — chaque section est cliquable pour continuer avec l'assistant. Aussi envoyé chaque lundi sur Telegram.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 9,
                fontSize: '1.02rem', fontWeight: 700, color: '#1a1816',
                background: busy ? '#8a8378' : `linear-gradient(135deg, ${C.impressions}, #ff8c42)`,
                border: 'none', borderRadius: 12,
                padding: '15px 32px', cursor: busy ? 'default' : 'pointer',
                boxShadow: busy ? 'none' : '0 4px 16px rgba(255,107,53,0.28)',
                transition: 'transform 0.12s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(255,107,53,0.4)'; } }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = busy ? 'none' : '0 4px 16px rgba(255,107,53,0.28)'; }}
            >
              <Sparkles size={19} /> {busy ? 'Analyse en cours…' : 'Générer mon analyse'}
            </button>
          </div>
        )}

        {err && <div className="chat-error" style={{ marginTop: 12 }}>{err}</div>}
        {report && <SectionedReport markdown={report} onDiscuss={discuss} />}
      </div>

      {/* ── Encart : analyses précédentes ── */}
      {pastReports.length > 0 && (
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={16} color={C.text} /> Analyses précédentes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pastReports.map((h) => {
              const open = openId === h.id;
              return (
                <div key={h.id} style={{ border: `1px solid ${C.grid}`, borderRadius: 8, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : h.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 14px', cursor: 'pointer',
                      background: open ? 'rgba(255,255,255,0.03)' : 'transparent',
                      border: 'none', color: 'inherit', textAlign: 'left',
                      fontSize: '0.85rem', transition: 'background 0.15s',
                    }}
                  >
                    <ChevronDown
                      size={15}
                      color={C.text}
                      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, fontWeight: open ? 600 : 400, color: open ? '#fff' : '#c0b8b0' }}>
                      {fmtReportDate(h.createdAt)}
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: '4px 14px 14px' }}>
                      <SectionedReport markdown={h.report} onDiscuss={discuss} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
