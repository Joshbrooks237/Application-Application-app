import React, { useState, useEffect, useCallback } from 'react';
import ResumeUpload from './components/ResumeUpload';
import HistoryFeed from './components/HistoryFeed';
import OptimizationDetail from './components/OptimizationDetail';
import StatusBar from './components/StatusBar';
import { checkHealth, getHistory, getResumeInfo } from './api';

function App() {
  const [resumeInfo, setResumeInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshData = useCallback(async () => {
    try {
      const health = await checkHealth();
      setBackendOnline(true);

      if (health.resumeLoaded) {
        const info = await getResumeInfo();
        setResumeInfo(info);
      }

      const hist = await getHistory();
      setHistory(hist);
    } catch {
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, [refreshData]);

  return (
    <div className="min-h-screen bg-surface">
      <StatusBar online={backendOnline} resumeLoaded={!!resumeInfo} />

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
                  AI-powered resume & cover letter tailoring
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
            <p className="text-slate-400 max-w-md mx-auto">
              Start the backend server with <code className="text-primary-light bg-surface-raised px-2 py-0.5 rounded">cd backend && npm start</code> then refresh this page.
            </p>
          </div>
        ) : selectedId ? (
          <OptimizationDetail
            optimizationId={selectedId}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <ResumeUpload
                resumeInfo={resumeInfo}
                onUploadSuccess={(info) => {
                  setResumeInfo(info);
                  refreshData();
                }}
              />
            </div>
            <div className="lg:col-span-2">
              <HistoryFeed
                history={history}
                onSelect={setSelectedId}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
