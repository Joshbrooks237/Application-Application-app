import React, { memo, useCallback, useRef, useEffect, useState } from 'react';
import { List } from 'react-window';

const ITEM_HEIGHT = 110;
const MAX_VISIBLE_HEIGHT = 700;

const ScoreBadge = memo(function ScoreBadge({ score, label }) {
  const color = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger';
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${color}`}>{score}%</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
  );
});

const HistoryCard = memo(function HistoryCard({ item, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-surface-raised border border-surface-overlay rounded-xl p-5
                 hover:border-primary/40 hover:bg-surface-overlay/50 transition-all group"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-200 truncate group-hover:text-primary-light transition-colors">
            {item.jobTitle}
          </h3>
          <p className="text-sm text-slate-400 mt-0.5">{item.companyName}</p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-[10px] text-slate-500">
              {new Date(item.optimizedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
              })}
            </span>
            {item.profileName && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary-light border border-primary/20">
                {item.profileEmoji || '📄'} {item.profileName}
              </span>
            )}
            {item.tone && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-overlay text-slate-400">
                {item.tone}
              </span>
            )}
            {item.retryAttempts > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-overlay text-slate-500">
                {item.retryAttempts} attempts
              </span>
            )}
            {item.belowThreshold && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-900/40 text-yellow-400 border border-yellow-600/30">
                ⚠ Low match
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <ScoreBadge score={item.matchScore} label="Match" />
          <span className="text-slate-600 group-hover:text-slate-400 transition-colors text-lg">→</span>
        </div>
      </div>
    </button>
  );
});

export default function HistoryFeed({ history, onSelect }) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleSelect = useCallback((id) => {
    onSelect(id);
  }, [onSelect]);

  const Row = useCallback(({ index, style }) => {
    if (!history || !history[index]) return null;
    const item = history[index];
    return (
      <div style={{ ...style, paddingBottom: 8 }}>
        <HistoryCard item={item} onClick={() => handleSelect(item.id)} />
      </div>
    );
  }, [history, handleSelect]);

  if (!history || history.length === 0) {
    return (
      <div className="animate-fadeInUp">
        <h2 className="text-lg font-bold text-slate-200 mb-4">Optimized Applications</h2>
        <div className="bg-surface-raised border border-surface-overlay rounded-xl p-12 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-sm text-slate-400">
            No optimizations yet. Visit an Indeed job listing and click "Optimize My Application" to get started.
          </p>
        </div>
      </div>
    );
  }

  const listHeight = Math.min(history.length * ITEM_HEIGHT, MAX_VISIBLE_HEIGHT);

  return (
    <div className="animate-fadeInUp" ref={containerRef}>
      <h2 className="text-lg font-bold text-slate-200 mb-4">
        Optimized Applications
        <span className="ml-2 text-sm font-normal text-slate-500">({history.length})</span>
      </h2>

      {history.length <= 10 ? (
        <div className="space-y-3">
          {history.map(item => (
            <HistoryCard key={item.id} item={item} onClick={() => handleSelect(item.id)} />
          ))}
        </div>
      ) : (
        <List
          height={listHeight}
          itemCount={history.length}
          itemSize={ITEM_HEIGHT}
          width="100%"
          overscanCount={5}
        >
          {Row}
        </List>
      )}
    </div>
  );
}
