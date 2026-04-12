import React, { useState, useEffect } from 'react';
import { requestHeadhunterReview, getHeadhunterInsights } from '../api';

export default function HeadhunterPanel({ activeProfile, onRefresh }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [targetRole, setTargetRole] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadInsights();
  }, []);

  async function loadInsights() {
    try {
      const data = await getHeadhunterInsights();
      setInsights(data.insights);
      if (data.insights) setExpanded(true);
    } catch (err) {
      console.warn('[Headhunter] Failed to load insights:', err);
    }
  }

  async function runReview() {
    if (!activeProfile) {
      alert('No active profile. Upload a resume first.');
      return;
    }

    setLoading(true);
    try {
      const result = await requestHeadhunterReview(targetRole);
      setInsights(result.insights);
      setExpanded(true);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Review failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const scoreColor = (score) => {
    if (score >= 7) return 'text-green-400 border-green-400';
    if (score >= 5) return 'text-yellow-400 border-yellow-400';
    return 'text-red-400 border-red-400';
  };

  return (
    <div className="bg-surface-card border border-surface-overlay rounded-xl p-6 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🕵️</span>
          <div>
            <h2 className="text-lg font-bold text-slate-100">Headhunter Review</h2>
            <p className="text-xs text-slate-400">20 years of recruiting experience</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {expanded && (
        <>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-2">
              Target Role (optional)
            </label>
            <input
              type="text"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. Senior Product Manager"
              className="w-full bg-surface border border-surface-overlay rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-primary-light transition-colors"
            />
          </div>

          <button
            onClick={runReview}
            disabled={loading || !activeProfile}
            className="w-full bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:from-slate-700 disabled:to-slate-600 text-white font-semibold py-3 px-6 rounded-lg transition-all disabled:cursor-not-allowed mb-6"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span> Reviewing...
              </span>
            ) : (
              'Get Headhunter Feedback'
            )}
          </button>

          {insights && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-surface rounded-lg border border-surface-overlay">
                <div className={`w-16 h-16 rounded-full border-4 flex items-center justify-center text-2xl font-bold ${scoreColor(insights.overallScore)}`}>
                  {insights.overallScore}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-300 leading-relaxed">{insights.headline}</p>
                  {insights.reviewedAt && (
                    <p className="text-xs text-slate-500 mt-1">
                      Reviewed {new Date(insights.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface rounded-lg p-3 border border-green-900/30">
                  <h3 className="text-xs font-semibold text-green-400 mb-2 uppercase tracking-wide">
                    Strengths
                  </h3>
                  <div className="space-y-2">
                    {insights.strengths?.map((s, i) => (
                      <div key={i} className="text-xs">
                        <p className="font-medium text-slate-200">{s.title}</p>
                        <p className="text-slate-400 mt-0.5">{s.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface rounded-lg p-3 border border-red-900/30">
                  <h3 className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wide">
                    Weaknesses
                  </h3>
                  <div className="space-y-2">
                    {insights.weaknesses?.map((w, i) => (
                      <div key={i} className="text-xs">
                        <p className="font-medium text-slate-200">{w.title}</p>
                        <p className="text-slate-400 mt-0.5">{w.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface rounded-lg p-3 border border-yellow-900/30">
                  <h3 className="text-xs font-semibold text-yellow-400 mb-2 uppercase tracking-wide">
                    Gaps
                  </h3>
                  <div className="space-y-2">
                    {insights.gaps?.map((g, i) => (
                      <div key={i} className="text-xs">
                        <p className="font-medium text-slate-200">{g.title}</p>
                        <p className="text-slate-400 mt-0.5">{g.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-surface rounded-lg p-4 border border-surface-overlay">
                <h3 className="text-sm font-semibold text-lime-400 mb-2 flex items-center gap-2">
                  ⚡ Quick Wins
                </h3>
                <ul className="space-y-1.5">
                  {insights.quickWins?.map((w, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="text-lime-400 mt-0.5">→</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-surface rounded-lg p-4 border-l-4 border-purple-500">
                <h3 className="text-sm font-semibold text-purple-400 mb-2">
                  Suggested Summary Rewrite
                </h3>
                <p className="text-sm text-slate-300 italic leading-relaxed">
                  {insights.summaryRewrite}
                </p>
              </div>

              <div className="bg-surface rounded-lg p-4 border-l-4 border-cyan-500">
                <h3 className="text-sm font-semibold text-cyan-400 mb-2">
                  AI Optimizer Guidance
                </h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {insights.promptGuidance}
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
                  <span>✓</span>
                  <span>This guidance is automatically applied to all optimizations</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
