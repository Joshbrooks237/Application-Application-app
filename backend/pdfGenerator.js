const PDFDocument = require('pdfkit');
const fs = require('fs');

const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const ATS_BLACK = '#000000';

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

  contactLine = contactLine.replace(/\s*\|?\s*github\.com\/\S+/gi, '').replace(/\s*\|\s*$/, '').trim();

  return { name, contactLine };
}

/** Plain black resume body text (no keyword color — ATS / print). */
function writePlainResumeText(doc, text, opts = {}) {
  const fontSize = opts.fontSize || 10;
  const indent = opts.indent || 0;
  doc.font(FONT_REGULAR).fontSize(fontSize).fillColor(ATS_BLACK)
    .text(text || '', { width: CONTENT_WIDTH - indent, continued: false });
}

function drawSectionLine(doc) {
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(ATS_BLACK).lineWidth(0.5).stroke();
  doc.y = y + 4;
}

async function generateResumePDF(rewrittenResume, _keywords, outputPath, masterResumeText) {
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
    doc.font(FONT_BOLD).fontSize(18).fillColor(ATS_BLACK)
       .text(name, MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.2);
  }

  if (contactLine) {
    doc.font(FONT_REGULAR).fontSize(9).fillColor(ATS_BLACK)
       .text(contactLine, MARGIN, undefined, { width: CONTENT_WIDTH, align: 'center' });
    doc.moveDown(0.8);
  }

  // ── Professional Summary ──
  doc.font(FONT_BOLD).fontSize(11).fillColor(ATS_BLACK)
     .text('PROFESSIONAL SUMMARY', MARGIN, undefined, { width: CONTENT_WIDTH });
  drawSectionLine(doc);
  doc.moveDown(0.2);

  writePlainResumeText(doc, rewrittenResume.summary || '', { fontSize: 10 });
  doc.moveDown(0.6);

  // ── Skills ──
  const skillsList = rewrittenResume.skills || [];
  if (skillsList.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(ATS_BLACK)
       .text('CORE COMPETENCIES', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    const skillChunks = [];
    for (let i = 0; i < skillsList.length; i += 4) {
      skillChunks.push(skillsList.slice(i, i + 4).join('  •  '));
    }
    for (const chunk of skillChunks) {
      writePlainResumeText(doc, chunk, { fontSize: 10 });
    }
    doc.moveDown(0.6);
  }

  // ── Professional Experience ──
  const experience = rewrittenResume.experience || [];
  if (experience.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(ATS_BLACK)
       .text('PROFESSIONAL EXPERIENCE', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    for (const role of experience) {
      const roleTitle = role.role || role.title || 'Role';
      const company = role.company || '';
      const dates = role.dates || '';

      doc.font(FONT_BOLD).fontSize(10).fillColor(ATS_BLACK)
         .text(roleTitle, MARGIN, undefined, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(ATS_BLACK)
         .text(`  |  ${company}${dates ? '  |  ' + dates : ''}`, { continued: false });
      doc.moveDown(0.15);

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        doc.font(FONT_REGULAR).fontSize(10).fillColor(ATS_BLACK)
           .text('•  ', MARGIN + 15, undefined, { continued: true });
        writePlainResumeText(doc, bullet, { fontSize: 10, indent: 15 });
        doc.moveDown(0.05);
      }
      doc.moveDown(0.3);
    }
  }

  // ── Additional Management Experience ──
  const additionalExp = rewrittenResume.additionalExperience || [];
  if (additionalExp.length > 0) {
    doc.font(FONT_BOLD).fontSize(11).fillColor(ATS_BLACK)
       .text('ADDITIONAL MANAGEMENT EXPERIENCE', MARGIN, undefined, { width: CONTENT_WIDTH });
    drawSectionLine(doc);
    doc.moveDown(0.2);

    for (const role of additionalExp) {
      const roleTitle = role.role || role.title || 'Role';
      const company = role.company || '';
      const dates = role.dates || '';

      doc.font(FONT_BOLD).fontSize(10).fillColor(ATS_BLACK)
         .text(roleTitle, MARGIN, undefined, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).fillColor(ATS_BLACK)
         .text(`  |  ${company}${dates ? '  |  ' + dates : ''}`, { continued: false });
      doc.moveDown(0.15);

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        doc.font(FONT_REGULAR).fontSize(10).fillColor(ATS_BLACK)
           .text('•  ', MARGIN + 15, undefined, { continued: true });
        writePlainResumeText(doc, bullet, { fontSize: 10, indent: 15 });
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
