const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, Footer, BorderStyle
} = require('docx');
const fs = require('fs');

const FONT = 'Calibri';
const FONT_SIZE_NAME = 28;      // 14pt
const FONT_SIZE_HEADING = 22;   // 11pt
const FONT_SIZE_BODY = 20;      // 10pt
const FONT_SIZE_CONTACT = 18;   // 9pt
const ATS_BLACK = '000000';

const CLOSING_LINE = '(?:sincerely|best regards|warm regards|kind regards|regards|respectfully|warmly|yours truly|yours sincerely)';

/**
 * Extract candidate contact info from raw resume text.
 * Returns { name, contactLine } where contactLine is everything
 * else on the second line (phone, email, location, links).
 */
function extractContactInfo(resumeText) {
  if (!resumeText) return { name: '', contactLine: '' };

  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  let name = '';
  let contactLine = '';

  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    // Skip section headers
    if (/^(professional\s+summary|core\s+skills|experience|education|objective)/i.test(line)) break;
    // First qualifying line is the name
    if (!name && line.length < 60 && /^[A-Za-z\s.\-']+$/.test(line)) {
      name = line === line.toUpperCase()
        ? line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : line;
      continue;
    }
    // Lines with email, phone, or pipe separators are contact info
    if (name && (line.includes('@') || line.includes('|') || /\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}/.test(line))) {
      contactLine = line;
      break;
    }
  }

  contactLine = contactLine.replace(/\s*\|?\s*github\.com\/\S+/gi, '').replace(/\s*\|\s*$/, '').trim();

  return { name, contactLine };
}

/** Plain black body text for resumes — no keyword color or bold (ATS / print). */
function createPlainRuns(text, baseFontSize = FONT_SIZE_BODY) {
  return [new TextRun({
    text: text || '',
    font: FONT,
    size: baseFontSize,
    color: ATS_BLACK
  })];
}

/**
 * Remove AI-included closings (template adds "Sincerely," + name).
 */
function stripTrailingSignatureBlock(trimmed) {
  let t = trimmed;
  t = t.replace(new RegExp(`\\n\\s*${CLOSING_LINE}\\b[,.]?\\s*[\\s\\S]*$`, 'is'), '');
  t = t.replace(new RegExp(`([.!?])\\s+${CLOSING_LINE}\\b[,.]?\\s*[\\s\\S]*$`, 'i'), '$1');
  t = t.replace(new RegExp(`\\s+${CLOSING_LINE}\\b[,.]?\\s*[A-Za-z][A-Za-z\\s.'-]{0,100}$`, 'i'), '');
  return t.trim();
}

function extractCoverLetterBodyParagraphs(coverLetterText) {
  const rawParagraphs = coverLetterText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const bodyParagraphs = [];
  const seenNorm = new Set();

  for (const p of rawParagraphs) {
    let trimmed = stripTrailingSignatureBlock(p.trim());
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    if (/^\w+\s+\d{1,2},?\s+\d{4}$/.test(trimmed)) continue;
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(trimmed)) continue;
    if (/^dear\s+/i.test(lower)) continue;
    if (new RegExp(`^${CLOSING_LINE}\\b`, 'i').test(lower)) continue;
    if (/^thanks,?\s*$/i.test(trimmed)) continue;
    if (/^thank you for (your )?(time|consideration)[.!]?\s*$/i.test(lower)) continue;

    if (trimmed.length < 45 && /^[a-z\s.\-']+$/i.test(trimmed) && !lower.includes(' the ') && !lower.includes(' and ')) {
      continue;
    }

    const norm = lower.replace(/\s+/g, ' ').trim();
    if (seenNorm.has(norm)) continue;
    seenNorm.add(norm);

    bodyParagraphs.push(trimmed);
  }

  return bodyParagraphs.slice(0, 3);
}

/**
 * Generates a tailored resume DOCX with candidate name/contact header,
 * professional formatting; all body text black (no keyword color).
 */
async function generateResumeDOCX(rewrittenResume, keywords, jobTitle, companyName, outputPath, masterResumeText) {
  console.log('[DOCX] Generating resume document...');

  const sections = [];
  const { name, contactLine } = extractContactInfo(masterResumeText);
  console.log('[DOCX] Contact info — name:', name, '| contact:', contactLine.substring(0, 60));

  // ── Name Header ──
  if (name) {
    sections.push(new Paragraph({
      children: [new TextRun({
        text: name,
        font: FONT,
        size: FONT_SIZE_NAME,
        bold: true,
        color: ATS_BLACK
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 }
    }));
  }

  // ── Contact Line ──
  if (contactLine) {
    sections.push(new Paragraph({
      children: [new TextRun({
        text: contactLine,
        font: FONT,
        size: FONT_SIZE_CONTACT,
        color: ATS_BLACK
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    }));
  }

  // ── Summary Section ──
  sections.push(
    new Paragraph({
      children: [new TextRun({
        text: 'PROFESSIONAL SUMMARY',
        font: FONT,
        size: FONT_SIZE_HEADING,
        bold: true,
        color: ATS_BLACK,
        allCaps: true
      })],
      spacing: { before: 120, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: ATS_BLACK } }
    }),
    new Paragraph({
      children: createPlainRuns(rewrittenResume.summary || ''),
      spacing: { after: 200 }
    })
  );

  // ── Core Competencies Block ──
  const skillsList = rewrittenResume.skills || [];
  if (skillsList.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({
          text: 'CORE COMPETENCIES',
          font: FONT,
          size: FONT_SIZE_HEADING,
          bold: true,
          color: ATS_BLACK,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: ATS_BLACK } }
      })
    );

    const skillChunks = [];
    for (let i = 0; i < skillsList.length; i += 3) {
      skillChunks.push(skillsList.slice(i, i + 3).join('  |  '));
    }
    for (const chunk of skillChunks) {
      sections.push(new Paragraph({
        children: createPlainRuns(chunk),
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 }
      }));
    }
  }

  // ── Experience Section ──
  const experience = rewrittenResume.experience || [];
  if (experience.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({
          text: 'PROFESSIONAL EXPERIENCE',
          font: FONT,
          size: FONT_SIZE_HEADING,
          bold: true,
          color: ATS_BLACK,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: ATS_BLACK } }
      })
    );

    for (const role of experience) {
      const roleChildren = [
        new TextRun({
          text: role.role || role.title || 'Role',
          font: FONT,
          size: FONT_SIZE_BODY,
          bold: true,
          color: ATS_BLACK
        }),
        new TextRun({
          text: `  |  ${role.company || ''}`,
          font: FONT,
          size: FONT_SIZE_BODY,
          color: ATS_BLACK
        })
      ];
      if (role.dates) {
        roleChildren.push(
          new TextRun({
            text: `  |  ${role.dates}`,
            font: FONT,
            size: FONT_SIZE_BODY,
            color: ATS_BLACK
          })
        );
      }
      sections.push(
        new Paragraph({
          children: roleChildren,
          spacing: { before: 160, after: 40 }
        })
      );

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: '•  ', font: FONT, size: FONT_SIZE_BODY, color: ATS_BLACK }),
              ...createPlainRuns(bullet)
            ],
            spacing: { after: 40 },
            indent: { left: 360 }
          })
        );
      }
    }
  }

  // ── Additional Management Experience Section ──
  const additionalExp = rewrittenResume.additionalExperience || [];
  if (additionalExp.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({
          text: 'ADDITIONAL MANAGEMENT EXPERIENCE',
          font: FONT,
          size: FONT_SIZE_HEADING,
          bold: true,
          color: ATS_BLACK,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: ATS_BLACK } }
      })
    );

    for (const role of additionalExp) {
      const addRoleChildren = [
        new TextRun({
          text: role.role || role.title || 'Role',
          font: FONT,
          size: FONT_SIZE_BODY,
          bold: true,
          color: ATS_BLACK
        }),
        new TextRun({
          text: `  |  ${role.company || ''}`,
          font: FONT,
          size: FONT_SIZE_BODY,
          color: ATS_BLACK
        })
      ];
      if (role.dates) {
        addRoleChildren.push(
          new TextRun({
            text: `  |  ${role.dates}`,
            font: FONT,
            size: FONT_SIZE_BODY,
            color: ATS_BLACK
          })
        );
      }
      sections.push(
        new Paragraph({
          children: addRoleChildren,
          spacing: { before: 160, after: 40 }
        })
      );

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: '•  ', font: FONT, size: FONT_SIZE_BODY, color: ATS_BLACK }),
              ...createPlainRuns(bullet)
            ],
            spacing: { after: 40 },
            indent: { left: 360 }
          })
        );
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 720, right: 720 }
        }
      },
      children: sections
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log('[DOCX] Resume saved:', outputPath);
}

/**
 * Generates a cover letter DOCX: one date, one salutation, ≤3 body paragraphs, one signature line.
 */
async function generateCoverLetterDOCX(coverLetterText, _keywords, jobTitle, companyName, outputPath, candidateName, letterDate) {
  console.log('[DOCX] Generating cover letter document...');

  const bodyParagraphs = extractCoverLetterBodyParagraphs(coverLetterText);
  const dateStr = letterDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const signName = (candidateName || 'Joshua Brooks').trim() || 'Joshua Brooks';

  const children = [];

  // Template: single date (must match prompt / generation context when provided)
  children.push(
    new Paragraph({
      children: [new TextRun({
        text: dateStr,
        font: FONT,
        size: FONT_SIZE_BODY,
        color: ATS_BLACK
      })],
      spacing: { after: 200 }
    })
  );

  // Template: salutation
  children.push(
    new Paragraph({
      children: [new TextRun({
        text: 'Dear Hiring Manager,',
        font: FONT,
        size: FONT_SIZE_BODY,
        color: ATS_BLACK
      })],
      spacing: { after: 200 }
    })
  );

  // Body: plain black text, max 3 paragraphs (enforced in extractCoverLetterBodyParagraphs)
  for (const para of bodyParagraphs) {
    children.push(
      new Paragraph({
        children: createPlainRuns(para.trim()),
        spacing: { after: 200 },
        alignment: AlignmentType.LEFT
      })
    );
  }

  // Closing: "Sincerely," on one line, name on the next (standard business letter format)
  children.push(
    new Paragraph({
      children: [new TextRun({
        text: 'Sincerely,',
        font: FONT,
        size: FONT_SIZE_BODY,
        color: ATS_BLACK
      })],
      spacing: { before: 240, after: 0 }
    }),
    new Paragraph({
      children: [new TextRun({
        text: signName,
        font: FONT,
        size: FONT_SIZE_BODY,
        color: ATS_BLACK
      })],
      spacing: { before: 0, after: 80 }
    })
  );

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
        }
      },
      children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log('[DOCX] Cover letter saved:', outputPath);
}

module.exports = { generateResumeDOCX, generateCoverLetterDOCX };
