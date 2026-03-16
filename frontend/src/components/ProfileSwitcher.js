import React, { useState, useRef } from 'react';
import { createProfile, activateProfile, updateProfile, deleteProfile } from '../api';
import VoiceProfile from './VoiceProfile';

const EMOJI_OPTIONS = ['📄', '👤', '👩', '👨', '🧑', '💼', '🎯', '⭐', '🔥', '💎', '🦊', '🐻', '🎸', '🎨'];

function AddProfileForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📄');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleSubmit = async () => {
    if (!name.trim()) return setError('Enter a name');
    if (!file) return setError('Upload a resume');
    setError('');
    setLoading(true);
    try {
      const result = await createProfile(name.trim(), emoji, file);
      onCreated(result.profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface border border-primary/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            className="w-10 h-10 rounded-lg bg-surface-raised border border-surface-overlay flex items-center justify-center text-xl
                       hover:border-primary/40 transition-colors"
            onClick={() => {
              const idx = EMOJI_OPTIONS.indexOf(emoji);
              setEmoji(EMOJI_OPTIONS[(idx + 1) % EMOJI_OPTIONS.length]);
            }}
            title="Click to change emoji"
          >
            {emoji}
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name (e.g. Joshua)"
          className="flex-1 bg-surface-raised border border-surface-overlay rounded-lg px-3 py-2 text-sm text-slate-200
                     placeholder-slate-500 focus:outline-none focus:border-primary/40"
          maxLength={30}
          autoFocus
        />
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        className="border border-dashed border-surface-overlay rounded-lg p-3 text-center cursor-pointer
                   hover:border-slate-500 transition-colors bg-surface-raised"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <p className="text-xs text-slate-400">
          {file ? `${file.name}` : 'Click to upload resume (PDF/DOCX)'}
        </p>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="flex-1 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-light
                     transition-colors disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Profile'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-400 bg-surface-raised border border-surface-overlay rounded-lg
                     hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ProfileSwitcher({ profiles, activeProfileId, onProfilesChanged }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const fileRef = useRef();

  const handleActivate = async (id) => {
    if (id === activeProfileId) return;
    try {
      await activateProfile(id);
      onProfilesChanged();
    } catch (err) {
      console.error('Failed to activate profile:', err);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteProfile(id);
      setConfirmDeleteId(null);
      onProfilesChanged();
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  };

  const handleReupload = async (id, file) => {
    if (!file) return;
    try {
      await updateProfile(id, { file });
      onProfilesChanged();
    } catch (err) {
      console.error('Failed to update resume:', err);
    }
  };

  return (
    <div className="animate-fadeInUp">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-200">Resume Profiles</h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs font-medium text-primary-light hover:text-primary transition-colors"
          >
            + Add Profile
          </button>
        )}
      </div>

      {showAdd && (
        <div className="mb-3">
          <AddProfileForm
            onCreated={() => { setShowAdd(false); onProfilesChanged(); }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {profiles.length === 0 && !showAdd ? (
        <div className="bg-surface-raised border border-surface-overlay rounded-xl p-8 text-center">
          <p className="text-3xl mb-2">👤</p>
          <p className="text-sm text-slate-400 mb-3">No profiles yet</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
          >
            Create Your First Profile
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => {
            const isActive = p.id === activeProfileId;
            const isConfirmingDelete = confirmDeleteId === p.id;

            return (
              <div
                key={p.id}
                onClick={() => handleActivate(p.id)}
                className={`
                  relative bg-surface-raised rounded-xl p-4 cursor-pointer transition-all group
                  ${isActive
                    ? 'border-2 border-primary shadow-sm shadow-primary/10'
                    : 'border border-surface-overlay hover:border-slate-500'
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  <div className={`
                    w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0
                    ${isActive ? 'bg-primary/10 border border-primary/30' : 'bg-surface border border-surface-overlay'}
                  `}>
                    {p.emoji || '📄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-bold truncate ${isActive ? 'text-primary-light' : 'text-slate-200'}`}>
                        {p.name}
                      </p>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary-light font-medium shrink-0">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {p.fileName} · {(p.textLength || 0).toLocaleString()} chars
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                       onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={editingId === p.id ? fileRef : null}
                      type="file"
                      accept=".pdf,.docx"
                      className="hidden"
                      onChange={(e) => { handleReupload(p.id, e.target.files[0]); setEditingId(null); }}
                    />
                    <button
                      onClick={() => { setEditingId(p.id); setTimeout(() => fileRef.current?.click(), 50); }}
                      className="p-1.5 rounded-md hover:bg-surface-overlay text-slate-500 hover:text-slate-300 transition-colors"
                      title="Update resume"
                    >
                      <span className="text-xs">📎</span>
                    </button>
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="px-2 py-1 text-[10px] font-bold bg-danger/20 text-danger rounded hover:bg-danger/30 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[10px] text-slate-500 rounded hover:text-slate-300 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="p-1.5 rounded-md hover:bg-danger/10 text-slate-500 hover:text-danger transition-colors"
                        title="Delete profile"
                      >
                        <span className="text-xs">✕</span>
                      </button>
                    )}
                  </div>
                </div>

                {p.uploadedAt && (
                  <p className="text-[10px] text-slate-600 mt-2 pl-13">
                    Uploaded {new Date(p.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}

                {isActive && (
                  <div onClick={e => e.stopPropagation()}>
                    <VoiceProfile profile={p} onChanged={onProfilesChanged} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
