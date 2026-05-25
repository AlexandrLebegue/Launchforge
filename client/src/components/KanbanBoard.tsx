import { useState, useRef, useEffect, DragEvent } from 'react';
import { KanbanState, KanbanCard, updateKanban, getAgents, assignCardToAgent, Agent } from '../api/client';

const COLUMNS: { key: KanbanCard['column']; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

const COL_ORDER = COLUMNS.map((c) => c.key);

const CATEGORIES = ['All', 'Marketing', 'Product', 'Community', 'Content', 'Outreach', 'Validation', 'Launch', 'Growth'];

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

  const [kanban,       setKanban]       = useState<KanbanState>(safeInitial);
  const [dragCard,     setDragCard]     = useState<KanbanCard | null>(null);
  const [filter,       setFilter]       = useState('All');
  const [showAdd,      setShowAdd]      = useState<KanbanCard['column'] | null>(null);
  const [addForm,      setAddForm]      = useState<{ title: string; category: string; effort: 'low' | 'medium' | 'high' }>({
    title: '', category: 'Marketing', effort: 'medium',
  });
  const [swipeCardId,  setSwipeCardId]  = useState<string | null>(null);
  const [agents,       setAgents]       = useState<Agent[]>([]);
  // openAssign: id de la carte dont le menu agent est ouvert
  const [openAssign,   setOpenAssign]   = useState<string | null>(null);
  // assignedRuns: cardId → { agentName, status }
  const [assignedRuns, setAssignedRuns] = useState<Record<string, { agentName: string; platform: string; status: string }>>({});

  const touchStart   = useRef(0);
  const touchCardId  = useRef<string | null>(null);
  const touchCol     = useRef<KanbanCard['column'] | null>(null);
  const swipeDx      = useRef(0);
  const dragCol      = useRef<string | null>(null);
  const dragIdx      = useRef<number>(0);

  // Charger les agents actifs au montage
  useEffect(() => {
    getAgents().then((res) => {
      if (res.success && res.data) {
        setAgents(res.data.filter((a) => a.status === 'active'));
      }
    });
  }, []);

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

  const handleDragStart = (card: KanbanCard, col: string, idx: number) => {
    setDragCard(card);
    dragCol.current = col;
    dragIdx.current = idx;
  };

  const handleDrop = (col: KanbanCard['column']) => {
    if (!dragCard) return;
    const fromCol = dragCol.current as KanbanCard['column'];
    moveCard(dragCard, fromCol, col);
    setDragCard(null);
  };

  const handleAdd = (col: KanbanCard['column']) => {
    const card: KanbanCard = {
      id:          `card-${Date.now()}`,
      title:       addForm.title,
      description: '',
      category:    addForm.category,
      effort:      addForm.effort,
      column:      col,
      order:       kanban.columns[col].length,
      createdAt:   new Date().toISOString(),
    };
    const newCol = [...kanban.columns[col], card];
    persist({ columns: { ...kanban.columns, [col]: newCol } });
    setShowAdd(null);
    setAddForm({ title: '', category: 'Marketing', effort: 'medium' });
  };

  const handleDelete = (col: KanbanCard['column'], idx: number) => {
    const newCol = kanban.columns[col].filter((_, i) => i !== idx);
    persist({ columns: { ...kanban.columns, [col]: newCol } });
  };

  const filterCard = (card: KanbanCard): boolean =>
    filter === 'All' || card.category === filter;

  // Touch swipe handlers
  const handleTouchStart = (card: KanbanCard, col: KanbanCard['column'], e: React.TouchEvent) => {
    touchStart.current   = e.touches[0].clientX;
    touchCardId.current  = card.id;
    touchCol.current     = col;
    swipeDx.current      = 0;
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
      const toCol = COL_ORDER[fromIdx + 1];
      const card  = kanban.columns[col]?.find((c) => c.id === id);
      if (card) moveCard(card, col, toCol as KanbanCard['column']);
    } else if (dx > threshold && fromIdx > 0) {
      const toCol = COL_ORDER[fromIdx - 1];
      const card  = kanban.columns[col]?.find((c) => c.id === id);
      if (card) moveCard(card, col, toCol as KanbanCard['column']);
    }

    setSwipeCardId(null);
    touchCardId.current = null;
    touchCol.current    = null;
    swipeDx.current     = 0;
  };

  // ── Assign card to agent ──────────────────────────────────────────────────

  const handleAssign = async (card: KanbanCard, agent: Agent) => {
    setOpenAssign(null);
    setAssignedRuns((prev) => ({
      ...prev,
      [card.id]: { agentName: agent.name, platform: agent.platform, status: 'running' },
    }));

    const res = await assignCardToAgent(agent.id, {
      planId,
      cardId:          card.id,
      cardTitle:       card.title,
      cardDescription: card.description,
      cardCategory:    card.category,
      cardEffort:      card.effort,
    });

    if (res.success) {
      setAssignedRuns((prev) => ({
        ...prev,
        [card.id]: { agentName: agent.name, platform: agent.platform, status: res.data?.status ?? 'running' },
      }));
    } else {
      setAssignedRuns((prev) => ({
        ...prev,
        [card.id]: { agentName: agent.name, platform: agent.platform, status: 'failed' },
      }));
    }
  };

  return (
    <div onClick={() => openAssign && setOpenAssign(null)}>
      {/* Filters */}
      <div className="kanban-filters">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`filter-btn ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Columns */}
      <div className="kanban-board">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className={`kanban-col ${dragCard ? 'kanban-drop-zone' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.key)}
          >
            <div className="kanban-col-header">
              <h3>{col.label}</h3>
              <span className="kanban-count">{kanban.columns[col.key].length}</span>
            </div>

            <div className="kanban-cards">
              {kanban.columns[col.key].filter(filterCard).map((card) => {
                const isSwiping = swipeCardId === card.id;
                const swipedX   = isSwiping ? swipeDx.current : 0;
                const run       = assignedRuns[card.id];

                return (
                  <div
                    key={card.id}
                    className={`kanban-card ${isSwiping ? 'kanban-swiping' : ''}`}
                    draggable={!isSwiping}
                    onDragStart={() => handleDragStart(card, col.key, kanban.columns[col.key].indexOf(card))}
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
                        onClick={(e) => { e.stopPropagation(); handleDelete(col.key, kanban.columns[col.key].indexOf(card)); }}
                      >×</button>
                    </div>

                    <p className="kanban-card-title">{card.title}</p>
                    {card.description && <p className="kanban-card-desc">{card.description}</p>}

                    {/* Run badge si assigné */}
                    {run && (
                      <div className={`kanban-run-badge run-${run.status}`}>
                        {PLATFORM_ICONS[run.platform] ?? '🤖'} {run.agentName}
                        {' · '}
                        <span className={`run-status-badge run-${run.status}`}>
                          {{pending:'⏳', running:'⚡', done:'✅', failed:'❌'}[run.status] ?? run.status}
                        </span>
                      </div>
                    )}

                    {/* Bouton Assign + dropdown */}
                    {agents.length > 0 && (
                      <div className="kanban-assign-wrapper" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="kanban-assign-btn"
                          onClick={() => setOpenAssign(openAssign === card.id ? null : card.id)}
                          title="Assigner à un agent IA"
                        >
                          🤖 Assigner
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
                                <span>{agent.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {showAdd === col.key ? (
              <div className="kanban-add-form">
                <input
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Card title..."
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <select value={addForm.category} onChange={(e) => setAddForm((prev) => ({ ...prev, category: e.target.value }))}>
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <select value={addForm.effort} onChange={(e) => setAddForm((f) => ({ ...f, effort: e.target.value as 'low' | 'medium' | 'high' }))}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => handleAdd(col.key)}>Add</button>
                  <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => setShowAdd(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="kanban-add-btn" onClick={() => setShowAdd(col.key)}>
                + Add card
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
