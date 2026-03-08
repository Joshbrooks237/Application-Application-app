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
const COLOR_PRIMARY = '2557A7';
const COLOR_TEXT = '1F2937';
const COLOR_SUBTEXT = '6B7280';

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
      name = line;
      continue;
    }
    // Lines with email, phone, or pipe separators are contact info
    if (name && (line.includes('@') || line.includes('|') || /\d{3}[\s\-.]?\d{3}[\s\-.]?\d{4}/.test(line))) {
      contactLine = line;
      break;
    }
  }

  return { name, contactLine };
}

function createHighlightedRuns(text, keywords, baseFontSize = FONT_SIZE_BODY) {
  if (!keywords || keywords.length === 0) {
    return [new TextRun({ text, font: FONT, size: baseFontSize, color: COLOR_TEXT })];
  }

  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
  const runs = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliestIndex = remaining.length;
    let matchedKeyword = null;

    for (const kw of sortedKeywords) {
      const idx = remaining.toLowerCase().indexOf(kw.toLowerCase());
      if (idx !== -1 && idx < earliestIndex) {
        earliestIndex = idx;
        matchedKeyword = kw;
      }
    }

    if (matchedKeyword === null) {
      runs.push(new TextRun({ text: remaining, font: FONT, size: baseFontSize, color: COLOR_TEXT }));
      break;
    }

    if (earliestIndex > 0) {
      runs.push(new TextRun({
        text: remaining.substring(0, earliestIndex),
        font: FONT, size: baseFontSize, color: COLOR_TEXT
      }));
    }

    const matchLength = matchedKeyword.length;
    const matchedText = remaining.substring(earliestIndex, earliestIndex + matchLength);

    runs.push(new TextRun({
      text: matchedText,
      font: FONT,
      size: baseFontSize,
      color: COLOR_PRIMARY,
      bold: true
    }));

    remaining = remaining.substring(earliestIndex + matchLength);
  }

  return runs;
}

/**
 * Generates a tailored resume DOCX with candidate name/contact header,
 * professional formatting, and bolded ATS keywords.
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
        color: COLOR_TEXT
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
        color: COLOR_SUBTEXT
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
        color: COLOR_PRIMARY,
        allCaps: true
      })],
      spacing: { before: 120, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: COLOR_PRIMARY } }
    }),
    new Paragraph({
      children: createHighlightedRuns(rewrittenResume.summary || '', keywords),
      spacing: { after: 200 }
    })
  );

  // ── Skills Section ──
  const skillsList = rewrittenResume.skills || [];
  if (skillsList.length > 0) {
    sections.push(
      new Paragraph({
        children: [new TextRun({
          text: 'SKILLS',
          font: FONT,
          size: FONT_SIZE_HEADING,
          bold: true,
          color: COLOR_PRIMARY,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: COLOR_PRIMARY } }
      })
    );

    const skillChunks = [];
    for (let i = 0; i < skillsList.length; i += 4) {
      skillChunks.push(skillsList.slice(i, i + 4).join('  •  '));
    }
    for (const chunk of skillChunks) {
      sections.push(new Paragraph({
        children: createHighlightedRuns(chunk, keywords),
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
          color: COLOR_PRIMARY,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: COLOR_PRIMARY } }
      })
    );

    for (const role of experience) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: role.role || role.title || 'Role',
              font: FONT,
              size: FONT_SIZE_BODY,
              bold: true,
              color: COLOR_TEXT
            }),
            new TextRun({
              text: `  |  ${role.company || ''}`,
              font: FONT,
              size: FONT_SIZE_BODY,
              color: COLOR_SUBTEXT
            })
          ],
          spacing: { before: 160, after: 40 }
        })
      );

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: '•  ', font: FONT, size: FONT_SIZE_BODY, color: COLOR_SUBTEXT }),
              ...createHighlightedRuns(bullet, keywords)
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
          color: COLOR_PRIMARY,
          allCaps: true
        })],
        spacing: { before: 200, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: COLOR_PRIMARY } }
      })
    );

    for (const role of additionalExp) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({
              text: role.role || role.title || 'Role',
              font: FONT,
              size: FONT_SIZE_BODY,
              bold: true,
              color: COLOR_TEXT
            }),
            new TextRun({
              text: `  |  ${role.company || ''}`,
              font: FONT,
              size: FONT_SIZE_BODY,
              color: COLOR_SUBTEXT
            })
          ],
          spacing: { before: 160, after: 40 }
        })
      );

      const bullets = role.bullets || [];
      for (const bullet of bullets) {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: '•  ', font: FONT, size: FONT_SIZE_BODY, color: COLOR_SUBTEXT }),
              ...createHighlightedRuns(bullet, keywords)
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
 * Generates a cover letter DOCX with professional formatting
 * and bolded keywords.
 */
async function generateCoverLetterDOCX(coverLetterText, keywords, jobTitle, companyName, outputPath) {
  console.log('[DOCX] Generating cover letter document...');

  const paragraphs = coverLetterText.split('\n\n').filter(p => p.trim());
  const children = [];

  children.push(
    new Paragraph({
      children: [new TextRun({
        text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        font: FONT,
        size: FONT_SIZE_BODY,
        color: COLOR_SUBTEXT
      })],
      spacing: { after: 200 }
    })
  );

  if (paragraphs.length > 0 && !paragraphs[0].toLowerCase().startsWith('dear')) {
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: 'Dear Hiring Manager,',
          font: FONT,
          size: FONT_SIZE_BODY,
          color: COLOR_TEXT
        })],
        spacing: { after: 200 }
      })
    );
  }

  for (const para of paragraphs) {
    children.push(
      new Paragraph({
        children: createHighlightedRuns(para.trim(), keywords),
        spacing: { after: 200 },
        alignment: AlignmentType.LEFT
      })
    );
  }

  const lastPara = paragraphs[paragraphs.length - 1] || '';
  if (!lastPara.toLowerCase().includes('sincerely') && !lastPara.toLowerCase().includes('regards')) {
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: 'Sincerely,',
          font: FONT,
          size: FONT_SIZE_BODY,
          color: COLOR_TEXT
        })],
        spacing: { before: 200, after: 80 }
      })
    );
  }

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
