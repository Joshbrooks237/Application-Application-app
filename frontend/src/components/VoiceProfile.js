import React, { useState, useRef } from 'react';
import {
  createVoiceProfile,
  updateVoiceProfile,
  deleteVoiceProfile,
  activateVoiceProfile
} from '../api';

const SLOT_PRESETS = ['Formal', 'Conversational', 'Sales Forward', 'Property Management Focus', 'Custom'];

function SlotCard({ slot, isActive, profileId, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleActivate = async (e) => {
    e.stopPropagation();
    if (isActive) return;
    try {
      await activateVoiceProfile(profileId, slot.id);
      onChanged();
    } catch (err) {
      console.error('Failed to activate voice profile:', err);
    }
  };

  const handleEdit = (e) => {
    e.stopPropagation();
    setEditName(slot.name);
    setEditText('');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {};
      if (editName && editName !== slot.name) updates.name = editName;
      if (editText.trim()) updates.text = editText;
      await updateVoiceProfile(profileId, slot.id, updates);
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error('Failed to update voice profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    try {
      await deleteVoiceProfile(profileId, slot.id);
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      console.error('Failed to delete voice profile:', err);
    }
  };

  return (
    <div
      onClick={handleActivate}
      className={`relative rounded-lg p-3 transition-all cursor-pointer ${
        isActive
          ? 'bg-accent/10 border-2 border-accent shadow-sm shadow-accent/10'
          : 'bg-surface border border-surface-overlay hover:border-slate-500'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{isActive ? '🎤' : '🎙️'}</span>
          <span className={`text-xs font-bold truncate ${isActive ? 'text-accent' : 'text-slate-300'}`}>
            {slot.name}
          </span>
          {isActive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent font-medium shrink-0">
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={handleEdit}
            className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
            title="Edit"
          >
            <span className="text-[10px]">✏️</span>
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                className="px-1.5 py-0.5 text-[9px] font-bold bg-danger/20 text-danger rounded hover:bg-danger/30"
              >
                Yes
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="px-1.5 py-0.5 text-[9px] text-slate-500 rounded hover:text-slate-300"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="p-1 rounded text-slate-500 hover:text-danger transition-colors"
              title="Delete"
            >
              <span className="text-[10px]">✕</span>
            </button>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-500 mt-1">
        {(slot.textLength || 0).toLocaleString()} chars
        {slot.updatedAt && (
          <> · Updated {new Date(slot.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
        )}
      </p>

      {editing && (
        <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="w-full bg-surface-raised border border-surface-overlay rounded-lg px-2 py-1.5 text-xs text-slate-200
                       placeholder-slate-500 focus:outline-none focus:border-accent/40"
            placeholder="Slot name"
          />
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            className="w-full bg-surface-raised border border-surface-overlay rounded-lg px-2 py-1.5 text-xs text-slate-200
                       placeholder-slate-500 focus:outline-none focus:border-accent/40 resize-none"
            rows={4}
            placeholder="Paste updated voice profile text (leave empty to keep current)"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-1.5 text-[10px] font-bold bg-accent text-white rounded-lg hover:bg-accent/80
                         transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-[10px] text-slate-400 bg-surface-raised border border-surface-overlay rounded-lg
                         hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VoiceProfile({ profile, onChanged }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [newFile, setNewFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  if (!profile) return null;

  const slots = profile.voiceProfiles || [];
  const activeSlotId = profile.activeVoiceProfileId;

  const handleCreate = async () => {
    if (!newText.trim() && !newFile) return setError('Enter voice profile text or upload a file');
    if (!newName.trim()) return setError('Enter a slot name');
    setError('');
    setCreating(true);
    try {
      await createVoiceProfile(profile.id, {
        name: newName.trim(),
        text: newText.trim() || undefined,
        file: newFile || undefined
      });
      setShowAdd(false);
      setNewName('');
      setNewText('');
      setNewFile(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Voice Profile</h3>
        {!showAdd && (
          <button
            onClick={() => { setShowAdd(true); setNewName(SLOT_PRESETS[slots.length % SLOT_PRESETS.length]); }}
            className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors"
          >
            + Add Slot
          </button>
        )}
      </div>

      {slots.length === 0 && !showAdd && (
        <div className="bg-surface border border-surface-overlay rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500 mb-2">No voice profile yet</p>
          <button
            onClick={() => { setShowAdd(true); setNewName('Default'); }}
            className="px-3 py-1.5 text-[10px] font-semibold bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors"
          >
            Add Voice Profile
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {slots.map(slot => (
          <SlotCard
            key={slot.id}
            slot={slot}
            isActive={slot.id === activeSlotId}
            profileId={profile.id}
            onChanged={onChanged}
          />
        ))}
      </div>

      {showAdd && (
        <div className="bg-surface border border-accent/30 rounded-lg p-3 mt-2 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-surface-raised border border-surface-overlay rounded-lg px-2 py-1.5 text-xs text-slate-200
                       placeholder-slate-500 focus:outline-none focus:border-accent/40"
            placeholder="Slot name (e.g. Formal, Conversational)"
            maxLength={40}
            autoFocus
          />

          <div
            onClick={() => fileRef.current?.click()}
            className="border border-dashed border-surface-overlay rounded-lg p-2 text-center cursor-pointer
                       hover:border-slate-500 transition-colors bg-surface-raised"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.docx"
              className="hidden"
              onChange={e => setNewFile(e.target.files[0])}
            />
            <p className="text-[10px] text-slate-400">
              {newFile ? newFile.name : 'Upload .txt or .docx (optional)'}
            </p>
          </div>

          <textarea
            value={newText}
            onChange={e => setNewText(e.target.value)}
            className="w-full bg-surface-raised border border-surface-overlay rounded-lg px-2 py-1.5 text-xs text-slate-200
                       placeholder-slate-500 focus:outline-none focus:border-accent/40 resize-none"
            rows={5}
            placeholder="Or paste voice profile text here — communication style, real stories, philosophy, what makes you memorable..."
          />

          {error && <p className="text-[10px] text-danger">{error}</p>}

          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 py-1.5 text-[10px] font-bold bg-accent text-white rounded-lg hover:bg-accent/80
                         transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Voice Profile'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError(''); }}
              className="px-3 py-1.5 text-[10px] text-slate-400 bg-surface-raised border border-surface-overlay rounded-lg
                         hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
