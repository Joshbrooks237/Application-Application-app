import React, { useState, useEffect } from 'react';
import { getOptimizationDetail, regenerateCoverLetter, getDownloadUrl } from '../api';
import KeywordPanel from './KeywordPanel';

const TONES = ['Professional', 'Confident', 'Conversational'];

function HighlightedText({ text, keywords }) {
  if (!text || !keywords?.length) return <span>{text}</span>;

  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const regex = new RegExp(`(${sorted.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isKw = sorted.some(k => k.toLowerCase() === part.toLowerCase());
        return isKw ? (
          <mark key={i} className="bg-keyword-highlight text-slate-900 px-0.5 rounded-sm font-semibold">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

export default function OptimizationDetail({ optimizationId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('resume');
  const [tone, setTone] = useState('Professional');
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await getOptimizationDetail(optimizationId);
        setData(detail);
        setTone(detail.tone || 'Professional');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [optimizationId]);

  const handleToneChange = async (newTone) => {
    setTone(newTone);
    setRegenerating(true);
    try {
      const result = await regenerateCoverLetter(optimizationId, newTone);
      setData(prev => ({
        ...prev,
        coverLetterText: result.coverLetterText,
        coverLetterPath: result.coverLetterPath,
        coverLetterFileName: result.coverLetterFileName,
        tone: newTone,
      }));
    } catch (err) {
      setError(`Failed to regenerate: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-light border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-danger font-medium">{error}</p>
        <button onClick={onBack} className="mt-4 text-sm text-primary-light hover:underline">Go back</button>
      </div>
    );
  }

  if (!data) return null;

  const keywordStrings = (data.keywords || []).map(k => k.keyword);

  return (
    <div className="animate-fadeInUp space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-200">{data.jobTitle}</h2>
          <p className="text-sm text-slate-400">{data.companyName}</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={getDownloadUrl(data.resumePath)}
            download={data.resumeFileName}
            className="px-4 py-2.5 text-sm font-semibold bg-primary text-white rounded-lg
                       hover:bg-primary-light transition-colors flex items-center gap-2"
          >
            <span>📄</span> Download Resume
          </a>
          <a
            href={getDownloadUrl(data.coverLetterPath)}
            download={data.coverLetterFileName}
            className="px-4 py-2.5 text-sm font-semibold bg-surface-raised text-slate-200 rounded-lg
                       border border-surface-overlay hover:bg-surface-overlay transition-colors flex items-center gap-2"
          >
            <span>✉️</span> Download Cover Letter
          </a>
        </div>
      </div>

      {/* Score Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Match Score" value={`${data.matchScore}%`} color={data.matchScore >= 80 ? 'text-success' : 'text-warning'} />
        <StatCard label="Original Score" value={`${data.originalScore}%`} color="text-slate-400" />
        <StatCard label="Keywords Found" value={`${data.keywordDetails?.filter(k => k.inTailoredResume).length || 0}/${data.keywords?.length || 0}`} color="text-primary-light" />
        <StatCard label="Improvement" value={`+${(data.matchScore || 0) - (data.originalScore || 0)}%`} color="text-accent" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-raised rounded-lg p-1 border border-surface-overlay">
        {['resume', 'coverLetter', 'keywords'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-md transition-colors
              ${tab === t ? 'bg-primary text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t === 'resume' ? 'Resume Comparison' : t === 'coverLetter' ? 'Cover Letter' : 'Keywords & Gap Analysis'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'resume' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Original */}
          <div className="bg-surface-raised border border-surface-overlay rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-overlay bg-surface-overlay/30">
              <h3 className="text-sm font-bold text-slate-300">Original Resume</h3>
            </div>
            <div className="p-5 text-sm text-slate-400 leading-relaxed whitespace-pre-wrap max-h-[600px] overflow-y-auto">
              {data.originalResumeText}
            </div>
          </div>

          {/* Tailored */}
          <div className="bg-surface-raised border border-primary/30 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-primary/30 bg-primary/5">
              <h3 className="text-sm font-bold text-primary-light">Tailored Resume</h3>
            </div>
            <div className="p-5 text-sm text-slate-300 leading-relaxed max-h-[600px] overflow-y-auto space-y-4">
              {data.rewrittenResume?.summary && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Summary</h4>
                  <p><HighlightedText text={data.rewrittenResume.summary} keywords={keywordStrings} /></p>
                </div>
              )}

              {data.rewrittenResume?.skills?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {data.rewrittenResume.skills.map((skill, i) => (
                      <span key={i} className="px-2.5 py-1 text-xs rounded-full bg-surface-overlay text-slate-300 border border-surface-overlay">
                        <HighlightedText text={skill} keywords={keywordStrings} />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {data.rewrittenResume?.experience?.map((role, i) => (
                <div key={i}>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{role.role || role.title}</h4>
                  <p className="text-xs text-slate-500 mb-2">{role.company}</p>
                  <ul className="space-y-1.5">
                    {role.bullets?.map((bullet, j) => (
                      <li key={j} className="flex gap-2 text-sm">
                        <span className="text-primary-light mt-0.5 shrink-0">•</span>
                        <span><HighlightedText text={bullet} keywords={keywordStrings} /></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'coverLetter' && (
        <div className="space-y-4">
          {/* Tone Selector */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-400">Tone:</span>
            <div className="flex gap-2">
              {TONES.map(t => (
                <button
                  key={t}
                  onClick={() => handleToneChange(t)}
                  disabled={regenerating}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-all
                    ${tone === t
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-raised text-slate-400 border border-surface-overlay hover:text-slate-200'
                    }
                    ${regenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {regenerating && (
              <div className="w-5 h-5 border-2 border-primary-light border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {/* Cover Letter */}
          <div className="bg-surface-raised border border-surface-overlay rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-overlay bg-surface-overlay/30">
              <h3 className="text-sm font-bold text-slate-300">Tailored Cover Letter</h3>
            </div>
            <div className="p-6 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              <HighlightedText text={data.coverLetterText} keywords={keywordStrings} />
            </div>
          </div>
        </div>
      )}

      {tab === 'keywords' && (
        <KeywordPanel
          keywords={data.keywords}
          keywordDetails={data.keywordDetails}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="bg-surface-raised border border-surface-overlay rounded-xl p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
