import { useState, useRef, useEffect, useMemo, useCallback, DragEvent as ReactDragEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  KanbanState, KanbanCard, updateKanban, getAgents, assignCardToAgent,
  getPlanRuns, Agent, AgentRun, RunStatus,
} from '../api/client';

const COLUMNS: { key: KanbanCard['column']; label: string }[] = [
  { key: 'backlog',     label: 'Backlog' },
  { key: 'todo',        label: 'À faire' },
  { key: 'in_progress', label: 'En cours' },
  { key: 'review',      label: 'Relecture' },
  { key: 'done',        label: 'Terminé' },
];

const COL_ORDER = COLUMNS.map((c) => c.key);

const CATEGORIES = ['Marketing', 'Product', 'Community', 'Content', 'Outreach', 'Validation', 'Launch', 'Growth'];

const COLORS: Record<string, string> = {
  Marketing: '#6366f1',
  Product: '#22c55e',
  Community: '#f59e0b',
  Content: '#a78bfa',
  Outreach: '#ef4444',
  Validation: '#06b6d4',
  Launch: '#ec4899',
  Growth: '#14b8a6',
};

const PLATFORM_ICONS: Record<string, string> = {
  reddit: '🟠', twitter: '🐦', linkedin: '💼', instagram: '📸',
  producthunt: '🐱', hackernews: '🟧', indiehackers: '🔨',
  discord: '💬', slack: '💛', github: '🐙',
};

const RUN_BADGES: Record<RunStatus, { icon: string; label: string }> = {
  pending:           { icon: '⏳', label: 'En attente' },
  running:           { icon: '⚡', label: 'Rédaction…' },
  awaiting_approval: { icon: '✋', label: 'À valider' },
  done:              { icon: '✅', label: 'Terminé' },
  failed:            { icon: '❌', label: 'Échoué' },
  rejected:          { icon: '🚫', label: 'Rejeté' },
};

type AssignFilter = 'all' | 'assigned' | 'unassigned';

interface Props {
  planId: string;
  initialKanban: KanbanState;
}

const EMPTY_STATE: KanbanState = {
  columns: { backlog: [], todo: [], in_progress: [], review: [], done: [] },
};

export default function KanbanBoard({ planId, initialKanban }: Props) {
  const safeInitial: KanbanState =
    initialKanban?.columns?.backlog && initialKanban.columns.todo
      ? initialKanban
      : EMPTY_STATE;

  const [kanban,     setKanban]     = useState<KanbanState>(safeInitial);
  const [dragCard,   setDragCard]   = useState<KanbanCard | null>(null);
  const [dragOver,   setDragOver]   = useState<KanbanCard['column'] | null>(null);

  // ── Filtres ──
  const [search,       setSearch]       = useState('');
  const [catFilter,    setCatFilter]    = useState('all');
  const [effortFilter, setEffortFilter] = useState('all');
  const [assignFilter, setAssignFilter] = useState<AssignFilter>('all');

  // ── Ajout de carte ──
  const [showAdd, setShowAdd] = useState<KanbanCard['column'] | null>(null);
  const [addForm, setAddForm] = useState<{ title: string; description: string; category: string; effort: 'low' | 'medium' | 'high' }>({
    title: '', description: '', category: 'Marketing', effort: 'medium',
  });

  // ── Agents & runs réels (persistés côté serveur) ──
  const [agents,     setAgents]     = useState<Agent[]>([]);
  const [runs,       setRuns]       = useState<AgentRun[]>([]);
  const [openAssign, setOpenAssign] = useState<string | null>(null);

  // ── Mobile swipe ──
  const [swipeCardId, setSwipeCardId] = useState<string | null>(null);
  const touchStart  = useRef(0);
  const touchCardId = useRef<string | null>(null);
  const touchCol    = useRef<KanbanCard['column'] | null>(null);
  const swipeDx     = useRef(0);
  const dragCol     = useRef<string | null>(null);

  const loadRuns = useCallback(async () => {
    const res = await getPlanRuns(planId);
    if (res.success && res.data) setRuns(res.data);
  }, [planId]);

  useEffect(() => {
    getAgents().then((res) => {
      if (res.success && res.data) {
        setAgents(res.data.filter((a) => a.status !== 'error'));
      }
    });
    loadRuns();
  }, [loadRuns]);

  // Polling tant qu'un run est actif (rédaction en cours)
  const hasActiveRun = runs.some((r) => r.status === 'pending' || r.status === 'running');
  useEffect(() => {
    if (!hasActiveRun) return;
    const timer = setInterval(loadRuns, 3000);
    return () => clearInterval(timer);
  }, [hasActiveRun, loadRuns]);

  // Dernier run par carte (les runs arrivent triés par date décroissante)
  const runByCard = useMemo(() => {
    const map: Record<string, AgentRun> = {};
    for (const run of runs) {
      if (!map[run.cardId]) map[run.cardId] = run;
    }
    return map;
  }, [runs]);

  const agentById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a])),
    [agents],
  );

  // ── Persistance ──
  const persist = (newState: KanbanState) => {
    setKanban(newState);
    updateKanban(planId, newState);
  };

  const moveCard = (card: KanbanCard, fromCol: KanbanCard['column'], toCol: KanbanCard['column']) => {
    if (toCol === fromCol) return;
    const fromList = [...kanban.columns[fromCol]];
    const toList   = [...kanban.columns[toCol]];
    const idx = fromList.findIndex((c) => c.id === card.id);
    if (idx === -1) return;
    const [moved] = fromList.splice(idx, 1);
    moved.column = toCol;
    toList.push(moved);
    persist({ columns: { ...kanban.columns, [fromCol]: fromList, [toCol]: toList } });
  };

  const handleDragStart = (e: ReactDragEvent, card: KanbanCard, col: string) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragCard(card);
    dragCol.current = col;
  };

  const handleDrop = (col: KanbanCard['column']) => {
    if (dragCard) moveCard(dragCard, dragCol.current as KanbanCard['column'], col);
    setDragCard(null);
    setDragOver(null);
  };

  const handleAdd = (col: KanbanCard['column']) => {
    if (!addForm.title.trim()) return;
    const card: KanbanCard = {
      id:          `card-${Date.now()}`,
      title:       addForm.title.trim(),
      description: addForm.description.trim(),
      category:    addForm.category,
      effort:      addForm.effort,
      column:      col,
      order:       kanban.columns[col].length,
      createdAt:   new Date().toISOString(),
    };
    persist({ columns: { ...kanban.columns, [col]: [...kanban.columns[col], card] } });
    setShowAdd(null);
    setAddForm({ title: '', description: '', category: 'Marketing', effort: 'medium' });
  };

  const handleDelete = (col: KanbanCard['column'], card: KanbanCard) => {
    if (!window.confirm(`Supprimer la tâche « ${card.title} » ?`)) return;
    persist({
      columns: { ...kanban.columns, [col]: kanban.columns[col].filter((c) => c.id !== card.id) },
    });
  };

  // ── Filtres ──
  const filterCard = (card: KanbanCard): boolean => {
    if (catFilter !== 'all' && card.category !== catFilter) return false;
    if (effortFilter !== 'all' && card.effort !== effortFilter) return false;
    if (assignFilter === 'assigned' && !runByCard[card.id]) return false;
    if (assignFilter === 'unassigned' && runByCard[card.id]) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!card.title.toLowerCase().includes(q) && !card.description.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const hasFilters = search.trim() !== '' || catFilter !== 'all' || effortFilter !== 'all' || assignFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setCatFilter('all');
    setEffortFilter('all');
    setAssignFilter('all');
  };

  const totalCards   = COL_ORDER.reduce((sum, c) => sum + kanban.columns[c].length, 0);
  const visibleCards = COL_ORDER.reduce((sum, c) => sum + kanban.columns[c].filter(filterCard).length, 0);

  // ── Mobile swipe handlers ──
  const handleTouchStart = (card: KanbanCard, col: KanbanCard['column'], e: React.TouchEvent) => {
    touchStart.current  = e.touches[0].clientX;
    touchCardId.current = card.id;
    touchCol.current    = col;
    swipeDx.current     = 0;
    setSwipeCardId(card.id);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeCardId) return;
    swipeDx.current = e.touches[0].clientX - touchStart.current;
  };

  const handleTouchEnd = () => {
    const id  = touchCardId.current;
    const col = touchCol.current;
    const dx  = swipeDx.current;
    if (!id || !col) { setSwipeCardId(null); return; }

    const fromIdx = COL_ORDER.indexOf(col);
    const threshold = 60;

    if (dx < -threshold && fromIdx < COL_ORDER.length - 1) {
      const card = kanban.columns[col]?.find((c) => c.id === id);
      if (card) moveCard(card, col, COL_ORDER[fromIdx + 1] as KanbanCard['column']);
    } else if (dx > threshold && fromIdx > 0) {
      const card = kanban.columns[col]?.find((c) => c.id === id);
      if (card) moveCard(card, col, COL_ORDER[fromIdx - 1] as KanbanCard['column']);
    }

    setSwipeCardId(null);
    touchCardId.current = null;
    touchCol.current    = null;
    swipeDx.current     = 0;
  };

  // ── Assignation à un agent ──
  const handleAssign = async (card: KanbanCard, agent: Agent) => {
    setOpenAssign(null);

    // Run optimiste le temps que le serveur réponde
    const optimistic: AgentRun = {
      id: `tmp-${Date.now()}`, agentId: agent.id, planId,
      cardId: card.id, cardTitle: card.title,
      status: 'running', result: null,
      startedAt: new Date().toISOString(), completedAt: null,
    };
    setRuns((prev) => [optimistic, ...prev]);

    const res = await assignCardToAgent(agent.id, {
      planId,
      cardId:          card.id,
      cardTitle:       card.title,
      cardDescription: card.description,
      cardCategory:    card.category,
      cardEffort:      card.effort,
    });

    if (res.success && res.data) {
      setRuns((prev) => [res.data!, ...prev.filter((r) => r.id !== optimistic.id)]);
    } else {
      setRuns((prev) => prev.filter((r) => r.id !== optimistic.id));
    }
  };

  return (
    <div onClick={() => openAssign && setOpenAssign(null)}>
      {/* ── Barre de filtres ── */}
      <div className="kanban-toolbar">
        <input
          className="kanban-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Rechercher une tâche…"
        />
        <select className="kanban-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">Toutes catégories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="kanban-select" value={effortFilter} onChange={(e) => setEffortFilter(e.target.value)}>
          <option value="all">Tout effort</option>
          <option value="low">Effort faible</option>
          <option value="medium">Effort moyen</option>
          <option value="high">Effort élevé</option>
        </select>
        <select className="kanban-select" value={assignFilter} onChange={(e) => setAssignFilter(e.target.value as AssignFilter)}>
          <option value="all">Toutes les tâches</option>
          <option value="assigned">Assignées à un agent</option>
          <option value="unassigned">Non assignées</option>
        </select>
        {hasFilters && (
          <button className="kanban-clear-filters" onClick={clearFilters}>
            ✕ Réinitialiser ({visibleCards}/{totalCards})
          </button>
        )}
      </div>

      {/* ── Colonnes ── */}
      <div className="kanban-board">
        {COLUMNS.map((col) => {
          const cards = kanban.columns[col.key].filter(filterCard);
          return (
            <div
              key={col.key}
              className={`kanban-col${dragOver === col.key ? ' kanban-col-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver((o) => (o === col.key ? null : o))}
              onDrop={() => handleDrop(col.key)}
            >
              <div className="kanban-col-header">
                <h3>{col.label}</h3>
                <span className="kanban-count">{cards.length}</span>
              </div>

              <div className="kanban-cards">
                {cards.map((card) => {
                  const isSwiping = swipeCardId === card.id;
                  const swipedX   = isSwiping ? swipeDx.current : 0;
                  const run       = runByCard[card.id];
                  const runAgent  = run ? agentById[run.agentId] : undefined;

                  return (
                    <div
                      key={card.id}
                      className={`kanban-card ${isSwiping ? 'kanban-swiping' : ''}${dragCard?.id === card.id ? ' kanban-dragging' : ''}`}
                      draggable={!isSwiping}
                      onDragStart={(e) => handleDragStart(e, card, col.key)}
                      onDragEnd={() => { setDragCard(null); setDragOver(null); }}
                      onTouchStart={(e) => handleTouchStart(card, col.key, e)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      style={
                        isSwiping
                          ? { transform: `translateX(${swipedX}px)`, opacity: 1 - Math.abs(swipedX) / 300, transition: 'none', zIndex: 10, position: 'relative' }
                          : {}
                      }
                    >
                      <div className="kanban-card-top">
                        <span className="kanban-category" style={{ background: COLORS[card.category] || '#475569' }}>
                          {card.category}
                        </span>
                        <span className={`kanban-effort effort-${card.effort}`}>{card.effort}</span>
                        <button
                          className="kanban-delete"
                          title="Supprimer la tâche"
                          onClick={(e) => { e.stopPropagation(); handleDelete(col.key, card); }}
                        >×</button>
                      </div>

                      <p className="kanban-card-title">{card.title}</p>
                      {card.description && <p className="kanban-card-desc">{card.description}</p>}

                      {/* Statut réel du run (persisté, mis à jour par polling) */}
                      {run && (
                        run.status === 'awaiting_approval' ? (
                          <Link to="/approvals" className="kanban-run-badge run-awaiting_approval" onClick={(e) => e.stopPropagation()}>
                            {PLATFORM_ICONS[runAgent?.platform ?? ''] ?? '🤖'} {runAgent?.name ?? 'Agent'}
                            {' · '}✋ À valider →
                          </Link>
                        ) : (
                          <div className={`kanban-run-badge run-${run.status}`}>
                            {PLATFORM_ICONS[runAgent?.platform ?? ''] ?? '🤖'} {runAgent?.name ?? 'Agent'}
                            {' · '}{RUN_BADGES[run.status].icon} {RUN_BADGES[run.status].label}
                          </div>
                        )
                      )}

                      {/* Assignation */}
                      {agents.length > 0 && (!run || run.status === 'failed' || run.status === 'rejected') && (
                        <div className="kanban-assign-wrapper" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="kanban-assign-btn"
                            onClick={() => setOpenAssign(openAssign === card.id ? null : card.id)}
                          >
                            🤖 {run ? 'Réassigner' : 'Assigner à un agent'}
                          </button>

                          {openAssign === card.id && (
                            <div className="kanban-assign-dropdown">
                              <div className="kanban-assign-title">Choisir un agent</div>
                              {agents.map((agent) => (
                                <button
                                  key={agent.id}
                                  className="kanban-assign-option"
                                  onClick={() => handleAssign(card, agent)}
                                >
                                  <span>{PLATFORM_ICONS[agent.platform] ?? '🤖'}</span>
                                  <span className="kanban-assign-name">{agent.name}</span>
                                  <span className={`kanban-mode-badge mode-${agent.approvalMode}`}>
                                    {agent.approvalMode === 'auto' ? '⚡ auto' : '✋ validation'}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {cards.length === 0 && (
                  <div className="kanban-col-empty">
                    {hasFilters ? 'Aucune tâche ne correspond aux filtres' : 'Aucune tâche'}
                  </div>
                )}
              </div>

              {showAdd === col.key ? (
                <div className="kanban-add-form">
                  <input
                    value={addForm.title}
                    onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd(col.key)}
                    placeholder="Titre de la tâche…"
                    autoFocus
                  />
                  <textarea
                    value={addForm.description}
                    onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Description (optionnelle) — contexte pour l'agent IA"
                    rows={2}
                  />
                  <div className="kanban-add-row">
                    <select value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select value={addForm.effort} onChange={(e) => setAddForm((f) => ({ ...f, effort: e.target.value as 'low' | 'medium' | 'high' }))}>
                      <option value="low">Effort faible</option>
                      <option value="medium">Effort moyen</option>
                      <option value="high">Effort élevé</option>
                    </select>
                  </div>
                  <div className="kanban-add-row">
                    <button className="btn btn-primary btn-sm" onClick={() => handleAdd(col.key)} disabled={!addForm.title.trim()}>
                      Ajouter
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowAdd(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <button className="kanban-add-btn" onClick={() => setShowAdd(col.key)}>
                  + Nouvelle tâche
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
