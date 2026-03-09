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
  const [personalNote, setPersonalNote] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const detail = await getOptimizationDetail(optimizationId);
        setData(detail);
        setTone(detail.tone || 'Professional');
        setPersonalNote(detail.personalNote || '');
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [optimizationId]);

  const handleRegenerate = async (newTone, note) => {
    const useTone = newTone || tone;
    const useNote = note !== undefined ? note : personalNote;
    setTone(useTone);
    setRegenerating(true);
    try {
      const result = await regenerateCoverLetter(optimizationId, useTone, useNote);
      setData(prev => ({
        ...prev,
        coverLetterText: result.coverLetterText,
        coverLetterPath: result.coverLetterPath,
        coverLetterFileName: result.coverLetterFileName,
        tone: useTone,
        personalNote: useNote,
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
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={getDownloadUrl(data.resumePath)}
            download={data.resumeFileName}
            className="px-4 py-2.5 text-sm font-semibold bg-primary text-white rounded-lg
                       hover:bg-primary-light transition-colors flex items-center gap-2"
          >
            <span>📄</span> Resume DOCX
          </a>
          {data.resumePdfPath && (
            <a
              href={getDownloadUrl(data.resumePdfPath)}
              download={data.resumePdfFileName}
              className="px-4 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-lg
                         hover:bg-red-500 transition-colors flex items-center gap-2"
            >
              <span>📕</span> Resume PDF
            </a>
          )}
          <a
            href={getDownloadUrl(data.coverLetterPath)}
            download={data.coverLetterFileName}
            className="px-4 py-2.5 text-sm font-semibold bg-surface-raised text-slate-200 rounded-lg
                       border border-surface-overlay hover:bg-surface-overlay transition-colors flex items-center gap-2"
          >
            <span>✉️</span> Cover Letter
          </a>
        </div>
      </div>

      {/* Below-threshold warning */}
      {data.belowThreshold && (
        <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-yellow-400 text-xl shrink-0">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-yellow-300">Best achievable match — consider if this role is right for you</p>
            <p className="text-xs text-yellow-400/70 mt-1">
              Tried {data.retryAttempts} optimization {data.retryAttempts === 1 ? 'attempt' : 'attempts'} but couldn't reach 75%.
              This is the highest-scoring version. The role may require skills not on your resume.
            </p>
          </div>
        </div>
      )}

      {/* Score Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <StatCard label="Match Score" value={`${data.matchScore}%`} color={data.matchScore >= 80 ? 'text-success' : data.matchScore >= 75 ? 'text-primary-light' : 'text-warning'} />
        <StatCard label="Original Score" value={`${data.originalScore}%`} color="text-slate-400" />
        <StatCard label="Keywords Found" value={`${data.keywordDetails?.filter(k => k.inTailoredResume).length || 0}/${data.keywords?.length || 0}`} color="text-primary-light" />
        <StatCard label="Improvement" value={`+${(data.matchScore || 0) - (data.originalScore || 0)}%`} color="text-accent" />
        <StatCard label="Attempts" value={data.retryAttempts || 1} color={data.retryAttempts > 1 ? 'text-yellow-400' : 'text-slate-400'} />
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

              {data.rewrittenResume?.additionalExperience?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 mt-2 pt-3 border-t border-surface-overlay">
                    Additional Management Experience
                  </h4>
                  {data.rewrittenResume.additionalExperience.map((role, i) => (
                    <div key={`addl-${i}`} className="mb-3">
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
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'coverLetter' && (
        <div className="space-y-4">
          {/* Personal Motivation */}
          <div className="bg-surface-raised border border-surface-overlay rounded-xl p-5">
            <label className="block text-sm font-bold text-slate-300 mb-2">
              Why do you want this job?
            </label>
            <p className="text-xs text-slate-500 mb-3">
              Add 2-3 sentences about your personal motivation. This gets woven into the cover letter to make it feel genuine.
            </p>
            <textarea
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder={"e.g. \"I've admired this company's mission in renewable energy since college, and this role combines my project management experience with my passion for sustainability.\""}
              rows={3}
              maxLength={500}
              className="w-full bg-surface border border-surface-overlay rounded-lg px-4 py-3 text-sm text-slate-200
                         placeholder-slate-600 resize-none focus:outline-none focus:border-primary-light focus:ring-1 focus:ring-primary-light transition-colors"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-slate-600">{personalNote.length}/500</span>
              <button
                onClick={() => handleRegenerate(tone, personalNote)}
                disabled={regenerating}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2
                  ${regenerating
                    ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                    : 'bg-primary text-white hover:bg-primary-light'}`}
              >
                {regenerating && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {regenerating ? 'Regenerating...' : 'Regenerate Cover Letter'}
              </button>
            </div>
          </div>

          {/* Tone Selector */}
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-400">Tone:</span>
            <div className="flex gap-2">
              {TONES.map(t => (
                <button
                  key={t}
                  onClick={() => handleRegenerate(t, personalNote)}
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
