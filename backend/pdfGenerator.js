const PDFDocument = require('pdfkit');
const fs = require('fs');

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const COLOR_PRIMARY = '#2557A7';
const COLOR_TEXT = '#1F2937';
const COLOR_SUBTEXT = '#6B7280';

const MARGIN = 50;
const PAGE_WIDTH = 612;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function extractContactInfo(resumeText) {
  if (!resumeText) return { name: '', contactLine: '' };

  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  let name = '';
  let contactLine = '';

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    if (/^(professional\s+summary|core\s+skills|experience|education|objective)/i.test(line)) break;
    if (!name && line.length < 60 && /^[A-Za-z\s.\-']+$/.test(line)) {
      name = line;
      continue;
    }
    if (name && (line.includes('@') || line.includes('|') || /\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}/.test(line))) {
      contactLine = line;
      break;
    }
  }

  return { name, contactLine };
}

/**
 * Write text with keyword segments bolded inline.
 * pdfkit doesn't have a native "highlight runs" API, so we
 * manually measure and place each segment on the same line(s).
 */
function writeTextWithKeywords(doc, text, keywords, opts = {}) {
  const fontSize = opts.fontSize || 10;
  const color = opts.color || COLOR_TEXT;
  const indent = opts.indent || 0;

  if (!keywords || keywords.length === 0) {
    doc.font(FONT_REGULAR).fontSize(fontSize).fillColor(color);
    doc.text(text, MARGIN + indent, undefined, { width: CONTENT_WIDTH - indent, continued: false });
    return;
  }

  const sortedKw = [...keywords].sort((a, b) => b.length - a.length);
  const segments = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestIdx = remaining.length;
    let matched = null;

    for (const kw of sortedKw) {
      const idx = remaining.toLowerCase().indexOf(kw.toLowerCase());
      if (idx !== -1 && idx < earliestIdx) {
        earliestIdx = idx;
        matched = kw;
      }
    }

    if (!matched) {
      segments.push({ text: remaining, bold: false });
      break;
    }

    if (earliestIdx > 0) {
      segments.push({ text: remaining.substring(0, earliestIdx), bold: false });
    }
    segments.push({ text: remaining.substring(earliestIdx, earliestIdx + matched.length), bold: true });
    remaining = remaining.substring(earliestIdx + matched.length);
  }

  const x = MARGIN + indent;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    doc.font(seg.bold ? FONT_BOLD : FONT_REGULAR)
       .fontSize(fontSize)
       .fillColor(seg.bold ? COLOR_PRIMARY : color);

    if (i === 0) {
      doc.text(seg.text, x, undefined, { width: CONTENT_WIDTH - indent, continued: !isLast });
    } else {
      doc.text(seg.text, { continued: !isLast });
    }
  }
}

function drawSectionLine(doc) {
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(COLOR_PRIMARY).lineWidth(0.5).stroke();
  doc.y = y + 4;
}

async function generateResumePDF(rewrittenResume, keywords, outputPath, masterResumeText) {
  console.log('[PDF] Generating resume document...');

  const { name, contactLine } = extractContactInfo(masterResumeText);

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }
  });

  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // ── Name Header ──
  if (name) {
    doc.font(FONT_BOLD).fontSize(18).fillColor(COLOR_TEXT)
       .text(name, MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.2);
  }

  if (contactLine) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor(COLOR_SUBTEXT)
       .text(contactLine, MARGIN, undefined, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.8);
  }

  // ── Professional Summary ──
  doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_PRIMARY)
     .text('PROFESSIONAL SUMMARY', MARGIN, undefined, { width: CONTENT_WIDTH });
  drawSectionLine(doc);
  doc.moveDown(0.2);

  writeTextWithKeywords(doc, rewrittenResume.summary || '', keywords, { fontSize: 10 });
  doc.moveDown(0.6);

  // ── Skills ──
  const skillsList = rewrittenResume.skills || [];
  if (skillsList.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_PRIMARY)
       .text('SKILLS', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    const skillChunks = [];
    for (let i = 0; i < skillsList.length; i += 4) {
      skillChunks.push(skillsList.slice(i, i + 4).join('  •  '));
    }
    for (const chunk of skillChunks) {
      writeTextWithKeywords(doc, chunk, keywords, { fontSize: 10 });
    }
    doc.moveDown(0.6);
  }

  // ── Professional Experience ──
  const experience = rewrittenResume.experience || [];
  if (experience.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_PRIMARY)
       .text('PROFESSIONAL EXPERIENCE', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    for (const role of experience) {
      const roleTitle = role.role || role.title || 'Role';
      const company = role.company || '';
      const dates = role.dates || '';

      doc.font(FONT_BOLD).fontSize(10).fillColor(COLOR_TEXT)
         .text(roleTitle, MARGIN, undefined, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(COLOR_SUBTEXT)
         .text(`  |  ${company}${dates ? '  |  ' + dates : ''}`, { continued: false });
      doc.moveDown(0.15);

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        doc.font(FONT_REGULAR).fontSize(10).fillColor(COLOR_SUBTEXT)
           .text('•  ', MARGIN + 15, undefined, { continued: true });
        writeTextWithKeywords(doc, bullet, keywords, { fontSize: 10, indent: 15 });
        doc.moveDown(0.05);
      }
      doc.moveDown(0.3);
    }
  }

  // ── Additional Management Experience ──
  const additionalExp = rewrittenResume.additionalExperience || [];
  if (additionalExp.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(COLOR_PRIMARY)
       .text('ADDITIONAL MANAGEMENT EXPERIENCE', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    for (const role of additionalExp) {
      const roleTitle = role.role || role.title || 'Role';
      const company = role.company || '';
      const dates = role.dates || '';

      doc.font(FONT_BOLD).fontSize(10).fillColor(COLOR_TEXT)
         .text(roleTitle, MARGIN, undefined, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(COLOR_SUBTEXT)
         .text(`  |  ${company}${dates ? '  |  ' + dates : ''}`, { continued: false });
      doc.moveDown(0.15);

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        doc.font(FONT_REGULAR).fontSize(10).fillColor(COLOR_SUBTEXT)
           .text('•  ', MARGIN + 15, undefined, { continued: true });
        writeTextWithKeywords(doc, bullet, keywords, { fontSize: 10, indent: 15 });
        doc.moveDown(0.05);
      }
      doc.moveDown(0.3);
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      console.log('[PDF] Resume saved:', outputPath);
      resolve();
    });
    stream.on('error', reject);
  });
}

module.exports = { generateResumePDF };
