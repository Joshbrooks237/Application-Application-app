import React, { useState, useRef, useEffect, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || '';

const WELCOME_MESSAGE = {
  id: 'welcome',
  type: 'mirror',
  content: "Hey. I'm The Mirror.\n\nI remember everything we've talked about. The more you share, the better I get at writing like you — not like a template.\n\nTalk to me.",
  timestamp: new Date()
};

export default function TheMirror({ activeProfile, onVoiceUpdated }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved'
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load history on mount / profile change
  useEffect(() => {
    if (!activeProfile?.id) return;
    setLoaded(false);

    fetch(`${API_BASE}/mirror/history/${activeProfile.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.history && data.history.length > 0) {
          const loaded = data.history.map((m, i) => ({
            id: `history-${i}`,
            type: m.role === 'user' ? 'user' : 'mirror',
            content: m.content,
            timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
          }));
          setMessages([WELCOME_MESSAGE, ...loaded]);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [activeProfile?.id]);

  const handleSave = useCallback(async () => {
    if (!activeProfile?.id) return;
    setSaveStatus('saving');
    try {
      await fetch(`${API_BASE}/mirror/save/${activeProfile.id}`, { method: 'POST' });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus(null);
    }
  }, [activeProfile?.id]);

  const sendMessage = async () => {
    if (!input.trim() || !activeProfile) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input.trim();
    setInput('');
    setIsThinking(true);

    try {
      const res = await fetch(`${API_BASE}/mirror/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          profileId: activeProfile.id
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      const mirrorMessage = {
        id: Date.now() + 1,
        type: 'mirror',
        content: data.reply,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, mirrorMessage]);

      if (data.voiceInsight) {
        if (onVoiceUpdated) onVoiceUpdated();
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        type: 'mirror',
        content: "Connection glitched. Try again.",
        timestamp: new Date()
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const chatCount = messages.filter(m => m.type === 'user').length;

  return (
    <div className="bg-surface-card border border-surface-overlay rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-overlay flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center text-xl">
          🪞
        </div>
        <div>
          <h3 className="font-semibold text-slate-100">The Mirror</h3>
          <p className="text-xs text-slate-400">
            {loaded && chatCount > 0
              ? `${chatCount} exchanges remembered`
              : 'Learning how you actually sound'}
          </p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
          className={`ml-auto text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
            saveStatus === 'saved'
              ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40'
              : 'bg-surface-raised border border-surface-overlay text-slate-400 hover:text-slate-200 hover:border-slate-500'
          }`}
        >
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save Chat'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-surface">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                message.type === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-surface-raised border border-surface-overlay text-slate-200'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
              <div className="text-[10px] mt-2 opacity-60">
                {message.timestamp instanceof Date
                  ? message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''}
              </div>
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-surface-raised border border-surface-overlay rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-slate-400">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-150"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse delay-300"></div>
                <span className="text-xs ml-2">thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-surface-overlay bg-surface">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Talk to me — stories, frustrations, how you work, anything..."
            className="flex-1 bg-surface-raised border border-surface-overlay rounded-xl px-4 py-3 text-sm resize-y min-h-[52px] max-h-32 focus:outline-none focus:border-primary-light transition-colors"
            rows={1}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isThinking}
            className="px-6 bg-primary hover:bg-primary-light disabled:bg-surface-raised text-white rounded-xl transition-all self-end mb-1"
          >
            →
          </button>
        </div>
        <div className="text-[10px] text-slate-500 mt-2 text-center">
          Chats auto-save after every message. Hit Save Chat to lock it in manually.
        </div>
      </div>
    </div>
  );
}
