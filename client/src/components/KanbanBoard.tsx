import { useState, useRef, DragEvent } from 'react';
import { KanbanState, KanbanCard, updateKanban } from '../api/client';

const COLUMNS: { key: KanbanCard['column']; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

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

interface Props {
  planId: string;
  initialKanban: KanbanState;
}

export default function KanbanBoard({ planId, initialKanban }: Props) {
  const safeInitial: KanbanState = initialKanban?.columns
    ? initialKanban
    : { columns: { backlog: [], todo: [], in_progress: [], done: [] } };
  const [kanban, setKanban] = useState<KanbanState>(safeInitial);
  const [dragCard, setDragCard] = useState<KanbanCard | null>(null);
  const [filter, setFilter] = useState('All');
  const [showAdd, setShowAdd] = useState<KanbanCard['column'] | null>(null);
  const [addForm, setAddForm] = useState<{ title: string; category: string; effort: 'low' | 'medium' | 'high' }>({ title: '', category: 'Marketing', effort: 'medium' });
  const dragCol = useRef<string | null>(null);
  const dragIdx = useRef<number>(0);

  const persist = (newState: KanbanState) => {
    setKanban(newState);
    updateKanban(planId, newState);
  };

  const handleDragStart = (card: KanbanCard, col: string, idx: number) => {
    setDragCard(card);
    dragCol.current = col;
    dragIdx.current = idx;
  };

  const handleDrop = (col: KanbanCard['column']) => {
    if (!dragCard) return;
    const fromCol = dragCol.current as KanbanCard['column'];
    const fromList = [...kanban.columns[fromCol]];
    const toList = [...kanban.columns[col]];

    // Remove from source
    const [moved] = fromList.splice(dragIdx.current, 1);
    moved.column = col;
    toList.push(moved);

    persist({
      columns: {
        ...kanban.columns,
        [fromCol]: fromList,
        [col]: toList,
      },
    });
    setDragCard(null);
  };

  const handleAdd = (col: KanbanCard['column']) => {
    const card: KanbanCard = {
      id: `card-${Date.now()}`,
      title: addForm.title,
      description: '',
      category: addForm.category,
      effort: addForm.effort,
      column: col,
      order: kanban.columns[col].length,
      createdAt: new Date().toISOString(),
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

  return (
    <div>
      {/* Filters */}
      <div className="kanban-filters">
        {CATEGORIES.map((c) => (
          <button key={c} className={`filter-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
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
              {kanban.columns[col.key].filter(filterCard).map((card, idx) => (
                <div
                  key={card.id}
                  className="kanban-card"
                  draggable
                  onDragStart={() => handleDragStart(card, col.key, idx)}
                >
                  <div className="kanban-card-top">
                    <span className="kanban-category" style={{ background: COLORS[card.category] || '#475569' }}>
                      {card.category}
                    </span>
                    <span className={`kanban-effort effort-${card.effort}`}>{card.effort}</span>
                    <button className="kanban-delete" onClick={() => handleDelete(col.key, idx)}>×</button>
                  </div>
                  <p className="kanban-card-title">{card.title}</p>
                  {card.description && <p className="kanban-card-desc">{card.description}</p>}
                </div>
              ))}
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
