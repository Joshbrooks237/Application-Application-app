/**
 * Shared longest-match segmentation for ATS keyword / phrase highlighting.
 * Accepts strings or { keyword, type } objects (type === 'phrase' for multi-word phrases).
 */

function normalizeKeywordSpecs(raw) {
  if (!raw || !raw.length) return [];
  const specs = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const t = item.trim();
      if (t) specs.push({ text: t, kind: 'keyword' });
    } else if (item && item.keyword) {
      const t = String(item.keyword).trim();
      if (t) specs.push({ text: t, kind: item.type === 'phrase' ? 'phrase' : 'keyword' });
    }
  }
  const seen = new Set();
  const deduped = [];
  for (const s of specs.sort((a, b) => b.text.length - a.text.length)) {
    const k = s.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(s);
  }
  return deduped.sort((a, b) => b.text.length - a.text.length);
}

/**
 * @returns {{ text: string, kind: 'plain'|'keyword'|'phrase' }[]}
 */
function buildHighlightSegments(text, rawKeywords) {
  const specs = normalizeKeywordSpecs(rawKeywords);
  if (!specs.length || !text) {
    return text ? [{ text, kind: 'plain' }] : [];
  }

  const segments = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestIndex = remaining.length;
    let matched = null;

    for (const s of specs) {
      const idx = remaining.toLowerCase().indexOf(s.text.toLowerCase());
      if (idx !== -1 && idx < earliestIndex) {
        earliestIndex = idx;
        matched = s;
      }
    }

    if (!matched) {
      segments.push({ text: remaining, kind: 'plain' });
      break;
    }

    if (earliestIndex > 0) {
      segments.push({ text: remaining.substring(0, earliestIndex), kind: 'plain' });
    }

    const len = matched.text.length;
    segments.push({
      text: remaining.substring(earliestIndex, earliestIndex + len),
      kind: matched.kind
    });
    remaining = remaining.substring(earliestIndex + len);
  }

  return segments.filter(seg => seg.text.length > 0);
}

module.exports = { normalizeKeywordSpecs, buildHighlightSegments };
