import React from 'react';

/**
 * Longest-first keyword / phrase highlighting for tailored resume & cover letter previews.
 * Uses the same job keyword list as the gap-analysis panel (keywordDetails).
 */
export default function HighlightedText({ text, keywordDetails, className = '' }) {
  if (text == null || text === '') return null;

  if (!keywordDetails?.length) {
    return <span className={className}>{text}</span>;
  }

  const specs = [];
  const seen = new Set();
  for (const d of keywordDetails) {
    if (!d?.keyword) continue;
    const t = String(d.keyword).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    specs.push({ text: t, kind: d.type === 'phrase' ? 'phrase' : 'keyword' });
  }
  specs.sort((a, b) => b.text.length - a.text.length);

  const parts = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest = remaining.length;
    let match = null;
    for (const s of specs) {
      const i = remaining.toLowerCase().indexOf(s.text.toLowerCase());
      if (i !== -1 && i < earliest) {
        earliest = i;
        match = s;
      }
    }
    if (!match) {
      parts.push({ text: remaining, kind: 'plain' });
      break;
    }
    if (earliest > 0) {
      parts.push({ text: remaining.slice(0, earliest), kind: 'plain' });
    }
    parts.push({
      text: remaining.slice(earliest, earliest + match.text.length),
      kind: match.kind
    });
    remaining = remaining.slice(earliest + match.text.length);
  }

  return (
    <span className={`whitespace-pre-wrap ${className}`.trim()}>
      {parts.map((p, i) => {
        if (p.kind === 'phrase') {
          return (
            <mark
              key={i}
              className="bg-emerald-600/30 text-emerald-100 font-semibold rounded px-0.5"
            >
              {p.text}
            </mark>
          );
        }
        if (p.kind === 'keyword') {
          return (
            <mark
              key={i}
              className="bg-blue-600/35 text-blue-100 font-semibold rounded px-0.5"
            >
              {p.text}
            </mark>
          );
        }
        return <span key={i}>{p.text}</span>;
      })}
    </span>
  );
}
