import React, { useState, useRef, useEffect } from 'react';
import {
  createVoiceProfile,
  updateVoiceProfile,
  deleteVoiceProfile,
  activateVoiceProfile,
  getVoiceProfiles
} from '../api';

const SECTIONS = [
  { key: 'communication', label: 'Communication Style', icon: '💬', placeholder: 'How do you naturally talk? Direct or diplomatic? Formal or casual? High energy or calm? How do you handle tough conversations?' },
  { key: 'identity', label: 'Core Identity', icon: '🧭', placeholder: 'What drives you? Your professional philosophy in your own words. What do you believe about work, people, success?' },
  { key: 'stories', label: 'Signature Stories', icon: '📖', placeholder: 'Real stories you\'d tell in an interview. The storage facility turnaround, the medical delivery hustle, the HVAC grind — write them like you\'d actually tell them.' },
  { key: 'differentiators', label: 'What Makes Me Different', icon: '⚡', placeholder: 'What sets you apart from other candidates? The honest, authentic things — not corporate buzzwords.' },
  { key: 'phrases', label: 'Phrases I Actually Use', icon: '🗣️', placeholder: 'Words and phrases you naturally say. "Let\'s build trust from the ground up." "Turning chaos into order is my jam." Add your own.' },
  { key: 'gaps', label: 'Honest Gaps', icon: '🌉', placeholder: 'How do you address career transitions or missing experience? Write how you\'d actually explain it in an interview.' },
  { key: 'targeting', label: 'Roles I\'m Targeting', icon: '🎯', placeholder: 'What kinds of jobs are you going after? Property management, customer service, sales, leasing, tech? Any specific companies?' },
  { key: 'neverSay', label: 'Things to NEVER Say', icon: '🚫', placeholder: 'Anything you want the AI to avoid. Wrong company names, exaggerated claims, specific phrases you hate seeing.' },
  { key: 'personalNotes', label: 'Personal Notes', icon: '📝', placeholder: 'Anything else the AI should know. Availability, relocation preferences, salary expectations, personal motivations, fun facts.' },
];

const SLOT_PRESETS = ['Default', 'Formal', 'Conversational', 'Sales Forward', 'Property Management Focus'];

function parseSections(text) {
  if (!text) return {};
  const sections = {};
  let currentKey = null;

  for (const section of SECTIONS) {
    const headerPatterns = [
      section.label.toUpperCase(),
      section.label,
      section.key.toUpperCase(),
    ];
    for (const pattern of headerPatterns) {
      const idx = text.indexOf(pattern);
      if (idx !== -1) {
        if (!sections._order) sections._order = [];
        sections._order.push({ key: section.key, idx });
      }
    }
  }

  if (sections._order && sections._order.length > 0) {
    sections._order.sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < sections._order.length; i++) {
      const { key, idx } = sections._order[i];
      const headerEnd = text.indexOf('\n', idx);
      const start = headerEnd !== -1 ? headerEnd + 1 : idx;
      const end = i + 1 < sections._order.length ? sections._order[i + 1].idx : text.length;
      sections[key] = text.substring(start, end).trim();
    }
    delete sections._order;
    return sections;
  }

  sections.personalNotes = text.trim();
  return sections;
}

function sectionsToText(sections) {
  const parts = [];
  for (const s of SECTIONS) {
    const val = (sections[s.key] || '').trim();
    if (val) {
      parts.push(`${s.label.toUpperCase()}\n\n${val}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

function SectionEditor({ section, value, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();
  const hasContent = value && value.trim().length > 0;

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      if (file.name.endsWith('.txt')) {
        const text = await file.text();
        const combined = value ? `${value}\n\n${text}` : text;
        onChange(section.key, combined);
      } else if (file.name.endsWith('.docx')) {
        const formData = new FormData();
        formData.append('voiceFile', file);
        formData.append('name', '_parse_only_');
        formData.append('text', '_');
        const API_BASE = process.env.REACT_APP_API_URL || '';
        const res = await fetch(`${API_BASE}/parse-file`, { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          const combined = value ? `${value}\n\n${data.text}` : data.text;
          onChange(section.key, combined);
        } else {
          const text = await file.text();
          const combined = value ? `${value}\n\n${text}` : text;
          onChange(section.key, combined);
        }
      }
    } catch (err) {
      console.error('File upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`rounded-lg border transition-all ${
      hasContent
        ? 'bg-surface-raised border-accent/20'
        : 'bg-surface border-surface-overlay'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-sm">{section.icon}</span>
        <span className={`text-[11px] font-bold flex-1 ${hasContent ? 'text-slate-200' : 'text-slate-500'}`}>
          {section.label}
        </span>
        {hasContent && (
          <span className="text-[9px] text-accent/60 font-medium shrink-0">
            {value.trim().length} chars
          </span>
        )}
        <span className="text-[10px] text-slate-600">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <textarea
            value={value || ''}
            onChange={e => onChange(section.key, e.target.value)}
            className="w-full bg-surface border border-surface-overlay rounded-lg px-2.5 py-2 text-xs text-slate-200
                       placeholder-slate-600 focus:outline-none focus:border-accent/40 resize-none leading-relaxed"
            rows={4}
            placeholder={section.placeholder}
          />
          <div className="flex items-center gap-2 mt-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.docx"
              className="hidden"
              onChange={e => { handleFileUpload(e.target.files[0]); e.target.value = ''; }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium text-slate-500 bg-surface border
                         border-surface-overlay rounded hover:text-accent hover:border-accent/30 transition-colors
                         disabled:opacity-50"
            >
              <span>📎</span> {uploading ? 'Reading...' : 'Upload .txt / .docx'}
            </button>
            {hasContent && (
              <button
                onClick={() => onChange(section.key, '')}
                className="px-2 py-1 text-[9px] text-slate-600 hover:text-danger transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SlotEditor({ slot, isActive, profileId, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [sections, setSections] = useState({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getVoiceProfiles(profileId);
        if (cancelled) return;
        const fullSlot = data.voiceProfiles?.find(v => v.id === slot.id);
        if (fullSlot?.text) {
          setSections(parseSections(fullSlot.text));
        }
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load voice profile:', err);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, slot.id]);

  const doSave = async (sectionsToSave) => {
    setSaving(true);
    try {
      const text = sectionsToText(sectionsToSave);
      await updateVoiceProfile(profileId, slot.id, { text });
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      onChanged();
    } catch (err) {
      console.error('Failed to save voice profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleExpand = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

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

  const handleSectionChange = (key, value) => {
    const updated = { ...sectionsRef.current, [key]: value };
    setSections(updated);
    sectionsRef.current = updated;
    setDirty(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(sectionsRef.current);
    }, 1500);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleManualSave = async (e) => {
    e.stopPropagation();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await doSave(sectionsRef.current);
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      await deleteVoiceProfile(profileId, slot.id);
      setConfirmDelete(false);
      onChanged();
    } catch (err) {
      console.error('Failed to delete voice profile:', err);
    }
  };

  const filledCount = SECTIONS.filter(s => sections[s.key]?.trim()).length;

  return (
    <div
      className={`rounded-lg transition-all ${
        isActive
          ? 'bg-accent/10 border-2 border-accent shadow-sm shadow-accent/10'
          : 'bg-surface border border-surface-overlay hover:border-slate-500'
      }`}
    >
      <div
        onClick={handleActivate}
        className="flex items-center justify-between p-3 cursor-pointer"
      >
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
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          <span className="text-[9px] text-slate-500">
            {slot.textLength > 0 ? `${(slot.textLength || 0).toLocaleString()} chars` : 'empty'}
          </span>
          <button
            onClick={handleExpand}
            className="p-1 rounded text-slate-500 hover:text-accent transition-colors"
            title={expanded ? 'Collapse' : 'Edit sections'}
          >
            <span className="text-[10px]">{expanded ? '▼' : '✏️'}</span>
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

      {slot.updatedAt && !expanded && (
        <p className="text-[10px] text-slate-600 px-3 pb-2">
          Updated {new Date(slot.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {filledCount > 0 && ` · ${filledCount}/${SECTIONS.length} sections`}
        </p>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5" onClick={e => e.stopPropagation()}>
          {!loaded ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-slate-500">
                  {filledCount}/{SECTIONS.length} sections filled — click any section to add notes
                </p>
                <div className="flex items-center gap-2">
                  {saving && (
                    <span className="text-[9px] text-slate-500 flex items-center gap-1">
                      <span className="w-2 h-2 border border-accent border-t-transparent rounded-full animate-spin inline-block" />
                      Saving...
                    </span>
                  )}
                  {savedFlash && !saving && (
                    <span className="text-[9px] text-success font-medium animate-fadeInUp">
                      Saved ✓
                    </span>
                  )}
                </div>
              </div>

              {SECTIONS.map(s => (
                <SectionEditor
                  key={s.key}
                  section={s}
                  value={sections[s.key] || ''}
                  onChange={handleSectionChange}
                />
              ))}

              {dirty && (
                <button
                  onClick={handleManualSave}
                  disabled={saving}
                  className="w-full py-2 text-xs font-bold bg-accent text-white rounded-lg hover:bg-accent/80
                             transition-colors disabled:opacity-50 mt-2"
                >
                  {saving ? 'Saving...' : 'Save All Changes'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function VoiceProfile({ profile, onChanged }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  if (!profile) return null;

  const slots = profile.voiceProfiles || [];
  const activeSlotId = profile.activeVoiceProfileId;

  const handleCreate = async () => {
    if (!newName.trim()) return setError('Enter a slot name');
    setError('');
    setCreating(true);
    try {
      await createVoiceProfile(profile.id, {
        name: newName.trim(),
        text: 'New voice profile — click edit to fill in sections.'
      });
      setShowAdd(false);
      setNewName('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleFileCreate = async (file) => {
    if (!file) return;
    setError('');
    setCreating(true);
    try {
      await createVoiceProfile(profile.id, {
        name: newName.trim() || 'Imported',
        file
      });
      setShowAdd(false);
      setNewName('');
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
          <p className="text-[10px] text-slate-600 mb-3">Add notes about your communication style, real stories, and what makes you memorable</p>
          <button
            onClick={() => { setShowAdd(true); setNewName('Default'); }}
            className="px-3 py-1.5 text-[10px] font-semibold bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors"
          >
            Create Voice Profile
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {slots.map(slot => (
          <SlotEditor
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

          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex-1 py-1.5 text-[10px] font-bold bg-accent text-white rounded-lg hover:bg-accent/80
                         transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Empty'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={creating}
              className="px-3 py-1.5 text-[10px] font-bold text-accent bg-accent/10 border border-accent/30 rounded-lg
                         hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              Import File
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.docx"
              className="hidden"
              onChange={e => handleFileCreate(e.target.files[0])}
            />
            <button
              onClick={() => { setShowAdd(false); setError(''); }}
              className="px-3 py-1.5 text-[10px] text-slate-400 bg-surface-raised border border-surface-overlay rounded-lg
                         hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          {error && <p className="text-[10px] text-danger mt-1">{error}</p>}
        </div>
      )}
    </div>
  );
}
