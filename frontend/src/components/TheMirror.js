import React, { useState, useRef, useEffect } from 'react';

export default function TheMirror({ activeProfile, onVoiceUpdated }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      type: 'mirror',
      content: "Hey. I'm The Mirror.\n\nI'm here to help you figure out how you actually sound — not how you think you *should* sound on paper.\n\nYou can paste old writing, tell me stories, complain about corporate speak, or just talk. I'll listen and gradually learn what feels like *you*.\n\nWhat should we start with?",
      timestamp: new Date()
    }
  ]);
  
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [voiceUnderstanding, setVoiceUnderstanding] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      const res = await fetch('http://localhost:3001/mirror/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          profileId: activeProfile.id
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to get response from The Mirror');
      }

      const mirrorMessage = {
        id: Date.now() + 1,
        type: 'mirror',
        content: data.reply,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, mirrorMessage]);
      
      if (data.voiceInsight) {
        setVoiceUnderstanding(data.voiceInsight);
        if (onVoiceUpdated) onVoiceUpdated();
      }
    } catch (err) {
      console.error('Mirror conversation failed:', err);
      
      const errorMessage = {
        id: Date.now() + 1,
        type: 'mirror',
        content: "Shit. I'm having trouble thinking right now. The OpenAI connection glitched. Give me a second and try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
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

  return (
    <div className="bg-surface-card border border-surface-overlay rounded-2xl overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-overlay flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center text-xl">
          🪞
        </div>
        <div>
          <h3 className="font-semibold text-slate-100">The Mirror</h3>
          <p className="text-xs text-slate-400">Learning how you actually sound</p>
        </div>
        {voiceUnderstanding && (
          <div className="ml-auto text-[10px] px-2 py-1 bg-emerald-900/30 text-emerald-400 rounded-full">
            Understanding you • {voiceUnderstanding.ticks?.length || 0} patterns
          </div>
        )}
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
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                <span className="text-xs ml-2">thinking about your voice...</span>
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
            placeholder="Paste writing, ask about your style, share a story, or just talk..."
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
          The more you talk to me, the better I understand how you actually sound
        </div>
      </div>
    </div>
  );
}
