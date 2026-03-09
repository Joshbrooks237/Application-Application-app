import React from 'react';

function ScoreBadge({ score, label }) {
  const color = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger';
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${color}`}>{score}%</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

export default function HistoryFeed({ history, onSelect }) {
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

  return (
    <div className="animate-fadeInUp">
      <h2 className="text-lg font-bold text-slate-200 mb-4">
        Optimized Applications
        <span className="ml-2 text-sm font-normal text-slate-500">({history.length})</span>
      </h2>

      <div className="space-y-3">
        {history.map((item, i) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className="w-full text-left bg-surface-raised border border-surface-overlay rounded-xl p-5
                       hover:border-primary/40 hover:bg-surface-overlay/50 transition-all group"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-200 truncate group-hover:text-primary-light transition-colors">
                  {item.jobTitle}
                </h3>
                <p className="text-sm text-slate-400 mt-0.5">{item.companyName}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] text-slate-500">
                    {new Date(item.optimizedAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric'
                    })}
                  </span>
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
              <div className="flex items-center gap-4">
                <ScoreBadge score={item.matchScore} label="Match" />
                <span className="text-slate-600 group-hover:text-slate-400 transition-colors text-lg">→</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
