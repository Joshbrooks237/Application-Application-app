import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import ProfileSwitcher from './components/ProfileSwitcher';
import HistoryFeed from './components/HistoryFeed';
import AnswerLibrary from './components/AnswerLibrary';
import StatusBar from './components/StatusBar';
import ErrorBoundary from './components/ErrorBoundary';
import HeadhunterPanel from './components/HeadhunterPanel';
import TheMirror from './components/TheMirror';
import { checkHealth, getProfiles, getHistory, getAnswers } from './api';

const OptimizationDetail = lazy(() => import('./components/OptimizationDetail'));

function App() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterProfile, setFilterProfile] = useState('all');
  const [activeTab, setActiveTab] = useState('applications');
  const [answers, setAnswers] = useState([]);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || null;

  const refreshData = useCallback(async (signal) => {
    try {
      await checkHealth();
      if (signal?.aborted) return;
      setBackendOnline(true);
    } catch {
      if (!signal?.aborted) {
        setBackendOnline(false);
        setLoading(false);
      }
      return;
    }

    try {
      const profileData = await getProfiles();
      if (signal?.aborted) return;
      setProfiles(profileData?.profiles || []);
      setActiveProfileId(profileData?.activeProfileId || null);
    } catch (err) {
      console.warn('[Indeeeed] Failed to load profiles:', err);
    }

    try {
      const hist = await getHistory();
      if (signal?.aborted) return;
      const arr = Array.isArray(hist) ? hist : (hist?.history || []);
      setHistory(arr);
    } catch (err) {
      console.warn('[Indeeeed] Failed to load history:', err);
    }

    try {
      const ansData = await getAnswers();
      if (signal?.aborted) return;
      setAnswers(Array.isArray(ansData) ? ansData : []);
    } catch (err) {
      console.warn('[Indeeeed] Failed to load answers:', err);
    }

    if (!signal?.aborted) setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshData(controller.signal);
    const interval = setInterval(() => refreshData(controller.signal), 30000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [refreshData]);

  const safeHistory = Array.isArray(history) ? history : [];
  const filteredHistory = filterProfile === 'all'
    ? safeHistory
    : safeHistory.filter(h => h?.profileId === filterProfile);

  return (
    <div className="min-h-screen bg-surface">
      <StatusBar online={backendOnline} resumeLoaded={!!activeProfile} />

      <header className="border-b border-surface-overlay">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🚀</span>
              <div>
                <h1 className="text-2xl font-extrabold bg-gradient-to-r from-primary-light to-accent bg-clip-text text-transparent">
                  Indeeeed Optimizer
                </h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  {activeProfile
                    ? <span>{activeProfile.emoji} Using <strong className="text-slate-300">{activeProfile.name}</strong>'s resume</span>
                    : 'AI-powered resume & cover letter tailoring'
                  }
                </p>
              </div>
            </div>
            {selectedId && (
              <button
                onClick={() => setSelectedId(null)}
                className="px-4 py-2 text-sm font-medium text-slate-300 bg-surface-raised rounded-lg
                           border border-surface-overlay hover:bg-surface-overlay transition-colors"
              >
                ← Back to Dashboard
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-primary-light border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !backendOnline ? (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">⚠️</p>
            <h2 className="text-xl font-bold text-slate-200 mb-2">Backend Offline</h2>
            <p className="text-slate-400 max-w-md mx-auto mb-4">
              Cannot reach the backend API. Check the browser console for the API URL being used.
            </p>
            <p className="text-xs text-slate-500 font-mono bg-surface-raised inline-block px-3 py-1.5 rounded-lg">
              API: {process.env.REACT_APP_API_URL || '(same origin)'}
            </p>
          </div>
        ) : selectedId ? (
          <ErrorBoundary>
            <Suspense fallback={
              <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-2 border-primary-light border-t-transparent rounded-full animate-spin" />
              </div>
            }>
              <OptimizationDetail
                optimizationId={selectedId}
                onBack={() => setSelectedId(null)}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <ErrorBoundary>
                <ProfileSwitcher
                  profiles={profiles}
                  activeProfileId={activeProfileId}
                  onProfilesChanged={refreshData}
                />
              </ErrorBoundary>

              <ErrorBoundary>
                <HeadhunterPanel
                  activeProfile={activeProfile}
                  onRefresh={refreshData}
                />
              </ErrorBoundary>

              <ErrorBoundary>
                <TheMirror
                  activeProfile={activeProfile}
                  onVoiceUpdated={refreshData}
                />
              </ErrorBoundary>
            </div>
            <div className="lg:col-span-2">
              {/* Tab navigation */}
              <div className="flex gap-1 mb-6 bg-surface rounded-xl p-1">
                <button
                  onClick={() => { setActiveTab('applications'); setSelectedId(null); }}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'applications'
                      ? 'bg-primary text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  📄 Optimized Applications ({history.length})
                </button>
                <button
                  onClick={() => { setActiveTab('answers'); setSelectedId(null); }}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'answers'
                      ? 'bg-primary text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ✨ Application Answers ({answers.length})
                </button>
              </div>

              {activeTab === 'applications' && (
                <>
                  {profiles.length > 1 && (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      <span className="text-xs text-slate-500">Filter:</span>
                      <button
                        onClick={() => setFilterProfile('all')}
                        className={`px-3 py-1 text-xs rounded-full transition-colors ${
                          filterProfile === 'all'
                            ? 'bg-primary text-white'
                            : 'bg-surface-raised text-slate-400 border border-surface-overlay hover:text-slate-200'
                        }`}
                      >
                        All Profiles
                      </button>
                      {profiles.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setFilterProfile(p.id)}
                          className={`px-3 py-1 text-xs rounded-full transition-colors ${
                            filterProfile === p.id
                              ? 'bg-primary text-white'
                              : 'bg-surface-raised text-slate-400 border border-surface-overlay hover:text-slate-200'
                          }`}
                        >
                          {p.emoji} {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <ErrorBoundary>
                    <HistoryFeed
                      history={filteredHistory}
                      onSelect={setSelectedId}
                    />
                  </ErrorBoundary>
                </>
              )}

              {activeTab === 'answers' && (
                <ErrorBoundary>
                  <AnswerLibrary answers={answers} />
                </ErrorBoundary>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
