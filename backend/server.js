require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const { execSync } = require('child_process');
const OpenAI = require('openai');
const { generateResumeDOCX, generateCoverLetterDOCX } = require('./docxGenerator');
const { generateResumePDF } = require('./pdfGenerator');

const app = express();
const PORT = process.env.PORT || 3001;

// ── OpenAI Setup ──
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/output', express.static(path.join(__dirname, 'output')));

// ── File Upload Config ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `resume-upload-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ── Filename Sanitization ──
function sanitizeForFilename(text, maxLen = 20) {
  return (text || '')
    .replace(/\d+(\.\d+)?\s*(out of \d+)?\s*reviews?/gi, '') // "4.1 out of 5 reviews"
    .replace(/\d+(\.\d+)?\s*stars?/gi, '')                    // "4.1 stars"
    .replace(/\(.*?\)/g, '')                                   // anything in parentheses
    .replace(/[^a-zA-Z0-9\s-]/g, '')                           // strip special chars
    .trim()
    .replace(/\s+/g, '-')                                      // spaces to hyphens
    .replace(/-{2,}/g, '-')                                    // collapse multiple hyphens
    .replace(/^-|-$/g, '')                                     // trim leading/trailing hyphens
    .toLowerCase()
    .substring(0, maxLen)
    .replace(/-$/g, '')                                        // no trailing hyphen after truncation
    || 'unknown';
}

// ── In-Memory State ──
const DATA_DIR = path.join(__dirname, 'data');
const MASTER_RESUME_PATH = path.join(DATA_DIR, 'master-resume.json');
const HISTORY_PATH = path.join(DATA_DIR, 'optimization-history.json');

let masterResume = null;  // { text, fileName, uploadedAt }
let optimizationHistory = []; // array of past optimizations

// Load persisted data on startup
function loadPersistedData() {
  try {
    if (fs.existsSync(MASTER_RESUME_PATH)) {
      masterResume = JSON.parse(fs.readFileSync(MASTER_RESUME_PATH, 'utf-8'));
      console.log('[Server] Loaded master resume from disk:', masterResume.fileName);
    }
  } catch (err) {
    console.error('[Server] Failed to load master resume:', err.message);
  }

  try {
    if (fs.existsSync(HISTORY_PATH)) {
      optimizationHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      console.log('[Server] Loaded optimization history:', optimizationHistory.length, 'entries');
    }
  } catch (err) {
    console.error('[Server] Failed to load history:', err.message);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(optimizationHistory, null, 2));
  } catch (err) {
    console.error('[Server] Failed to save history:', err.message);
  }
}

// ── Resume Parsing ──
async function parseResume(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  console.log(`[Server] Parsing resume: ${filePath} (${ext})`);

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    console.log('[Server] DOCX parsed successfully, length:', result.value.length);
    return result.value;
  }

  if (ext === '.pdf') {
    return parsePDFWithPython(filePath);
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

function parsePDFWithPython(filePath) {
  const pythonScript = `
import sys, json
try:
    import pdfplumber
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pdfplumber', '-q'])
    import pdfplumber

text_parts = []
with pdfplumber.open(sys.argv[1]) as pdf:
    for page in pdf.pages:
        t = page.extract_text()
        if t:
            text_parts.append(t)

print(json.dumps({"text": "\\n".join(text_parts)}))
`;

  const scriptPath = path.join(__dirname, '_parse_pdf.py');
  fs.writeFileSync(scriptPath, pythonScript);

  try {
    const result = execSync(`python3 "${scriptPath}" "${filePath}"`, {
      encoding: 'utf-8',
      timeout: 30000
    });
    const parsed = JSON.parse(result.trim());
    console.log('[Server] PDF parsed successfully, length:', parsed.text.length);
    return parsed.text;
  } catch (err) {
    console.error('[Server] PDF parsing failed:', err.message);
    throw new Error('PDF parsing failed. Ensure python3 and pdfplumber are installed.');
  } finally {
    try { fs.unlinkSync(scriptPath); } catch (_) {}
  }
}

// ── AI Prompts (Phase 4) ──
const PROMPTS = {
  keywordExtraction: `You are an ATS (Applicant Tracking System) expert. Analyze this job description and extract TWO types of items:

1. KEYWORDS (single words or short terms, max 2 words): Extract the top 15 most important individual keywords. Examples: "Python", "leadership", "SQL", "compliance".

2. PHRASES (exact multi-word phrases, 3-6 words): Extract the top 10 most important exact phrases that ATS systems scan for as complete units. These should be phrases used verbatim in the job description. Examples: "customer service experience", "attention to detail", "cross-functional team collaboration", "data-driven decision making".

Categorize each as: technical_skill, soft_skill, qualification, or industry_term. Assign an importance score 1-10. Mark each with a "type" field: "keyword" or "phrase".

Return ONLY valid JSON, no markdown, no explanation.

Expected format:
{"keywords": [{"keyword": "...", "category": "technical_skill|soft_skill|qualification|industry_term", "importance": 1-10, "type": "keyword|phrase"}]}`,

  resumeRewrite: `You are an expert resume writer and ATS optimization specialist. You will be given a candidate's master resume and a list of ATS keywords AND multi-word phrases from a job posting. Your job is to rewrite the resume to best match the target role.

CRITICAL RULES — EVERY ROLE MUST BE INCLUDED:
- The master resume contains MANY different job roles. You MUST include ALL of them in your output. NEVER drop a role.
- Split the roles into TWO groups:
  1. "experience" — the 3-4 roles MOST RELEVANT to the target job. These go first and get full treatment (3 bullets each, heavy keyword injection).
  2. "additionalExperience" — ALL REMAINING roles. These provide credibility, management depth, and seniority. Give each 2 bullets. Still weave in keywords where natural but keep them concise.
- Storage/facility management roles should generally go in "additionalExperience" UNLESS the target job is specifically about facilities, property, or storage management.
- For customer service positions, PRIORITIZE in "experience": Customer Service Associate, Medical Supply Delivery Driver, Fleet Manager, HVAC Lead Generator, and any role with direct customer/client interaction.
- For logistics/operations positions, PRIORITIZE in "experience": Fleet Manager, Medical Supply Delivery Driver, Production Runner, Storage Facility Manager.
- For administrative/office positions, PRIORITIZE in "experience": A&R Administrative Intern, Customer Service Associate, HVAC Lead Generator.

REWRITING RULES:
- Naturally incorporate as many keywords and exact multi-word phrases as possible without keyword stuffing.
- Pay special attention to including EXACT multi-word phrases (marked as "phrase") since ATS systems scan for complete phrases.
- Keep all facts true — do not invent experience or skills.
- Preserve the candidate's voice.
- Rewrite: summary, skills list, 3 bullet points per "experience" role, 2 bullet points per "additionalExperience" role.

Return ONLY valid JSON with keys: summary, skills, experience, additionalExperience.

Expected format:
{"summary": "...", "skills": ["skill1", "skill2", ...], "experience": [{"role": "...", "company": "...", "bullets": ["...", "...", "..."]}], "additionalExperience": [{"role": "...", "company": "...", "bullets": ["...", "..."]}]}`,

  coverLetter: `You are an expert cover letter writer. Write a tailored cover letter using the candidate's background and the job's exact keywords and phrases. Mirror the tone and language of the job posting. The letter should feel human, specific, and confident — not generic. Use the STAR method for one key achievement. Length: 3 paragraphs. Tone: [TONE_SELECTION].

CRITICAL RULES:
- Use the candidate's REAL NAME from their resume — NEVER write [Your Name] or [Candidate Name]
- Use the REAL COMPANY NAME provided — NEVER write [Company Name] or [Employer's Name]
- Use the REAL JOB TITLE provided — NEVER write [Job Title] or [Position]
- Use TODAY'S DATE provided — NEVER write [Date] or [Today's Date]
- Address the letter to "Dear Hiring Manager," if no specific name is given
- NEVER use placeholder brackets like [ ] anywhere in the output

Return only the cover letter text, ready to send with no placeholders.`
};

// ── OpenAI Calls ──
async function callOpenAI(systemPrompt, userContent, label) {
  console.log(`[AI] Starting ${label}...`);
  const startTime = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[AI] ${label} completed in ${elapsed}s (${content.length} chars)`);
    return content;
  } catch (err) {
    console.error(`[AI] ${label} failed:`, err.message);
    if (err.code === 'insufficient_quota') {
      throw new Error('OpenAI API quota exceeded. Check your billing.');
    }
    if (err.code === 'invalid_api_key') {
      throw new Error('Invalid OpenAI API key. Set OPENAI_API_KEY environment variable.');
    }
    throw new Error(`AI ${label} failed: ${err.message}`);
  }
}

async function extractKeywords(jobDescription) {
  const raw = await callOpenAI(
    PROMPTS.keywordExtraction,
    `Job Description:\n${jobDescription}`,
    'Keyword Extraction'
  );

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AI] Failed to parse keyword JSON:', err.message);
    throw new Error('AI returned invalid keyword JSON');
  }
}

function buildResumeUserContent(resumeText, keywords) {
  const allItems = keywords.keywords || [];
  const singleKeywords = allItems.filter(k => k.type !== 'phrase');
  const phrases = allItems.filter(k => k.type === 'phrase');

  const keywordList = singleKeywords
    .map(k => `[keyword] ${k.keyword} (${k.category}, importance: ${k.importance})`)
    .join('\n');
  const phraseList = phrases
    .map(k => `[phrase] "${k.keyword}" (${k.category}, importance: ${k.importance})`)
    .join('\n');

  return `Master Resume:\n${resumeText}\n\n---\nATS Keywords:\n${keywordList}\n\n---\nATS Phrases (use these EXACT multi-word phrases):\n${phraseList}`;
}

async function rewriteResume(resumeText, keywords) {
  return rewriteResumeWithStrategy(resumeText, keywords, null);
}

async function rewriteResumeWithStrategy(resumeText, keywords, retryInstruction) {
  const systemPrompt = retryInstruction
    ? `${PROMPTS.resumeRewrite}\n\n${retryInstruction}`
    : PROMPTS.resumeRewrite;

  const raw = await callOpenAI(
    systemPrompt,
    buildResumeUserContent(resumeText, keywords),
    retryInstruction ? 'Resume Rewrite (retry)' : 'Resume Rewrite'
  );

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AI] Failed to parse resume JSON:', err.message);
    throw new Error('AI returned invalid resume JSON');
  }
}

function extractCandidateName(resumeText) {
  if (!resumeText) return '';
  // The name is almost always the first non-empty line of a resume
  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip lines that look like headers, addresses, or contact info only
    if (/^(resume|curriculum|cv|objective|summary|profile)/i.test(line)) continue;
    if (/^\+?\d[\d\s\-().]{7,}$/.test(line)) continue; // phone number only
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) continue; // email only
    // A name line is typically short (under 50 chars) and mostly letters
    if (line.length < 50 && /^[A-Za-z\s.\-']+$/.test(line) && line.split(/\s+/).length <= 5) {
      console.log('[Server] Extracted candidate name:', line);
      return line;
    }
  }
  return '';
}

function replacePlaceholders(text, candidateName, companyName, jobTitle) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return text
    // Name placeholders
    .replace(/\[Your (?:Full )?Name\]/gi, candidateName)
    .replace(/\[Candidate(?:'s)? Name\]/gi, candidateName)
    .replace(/\[First (?:and )?Last Name\]/gi, candidateName)
    .replace(/\[Name\]/gi, candidateName)
    // Company placeholders
    .replace(/\[Company(?:'s)? Name\]/gi, companyName)
    .replace(/\[Employer(?:'s)? Name\]/gi, companyName)
    .replace(/\[Organization(?:'s)? Name\]/gi, companyName)
    .replace(/\[Hiring Company\]/gi, companyName)
    .replace(/\[Company\]/gi, companyName)
    // Job title placeholders
    .replace(/\[Job Title\]/gi, jobTitle)
    .replace(/\[Position(?: Title)?\]/gi, jobTitle)
    .replace(/\[Role(?: Title)?\]/gi, jobTitle)
    // Date placeholders
    .replace(/\[Today(?:'s)? Date\]/gi, today)
    .replace(/\[Date\]/gi, today)
    .replace(/\[Current Date\]/gi, today)
    // Contact info placeholders — remove the line entirely
    .replace(/.*\[(?:Your )?(?:Email|Phone|Address|City|State|Zip).*\].*\n?/gi, '')
    // Catch any remaining bracket placeholders
    .replace(/\[(?:Your|My|Candidate's?|Insert)\s+[^\]]*\]/gi, '')
    .trim();
}

async function generateCoverLetter(jobDescription, resumeSummary, keywords, tone = 'Professional', meta = {}) {
  const prompt = PROMPTS.coverLetter.replace('[TONE_SELECTION]', tone);
  const keywordList = keywords.keywords.map(k => k.keyword).join(', ');

  const candidateName = meta.candidateName || extractCandidateName(meta.resumeText || '');
  const companyName = meta.companyName || 'the company';
  const jobTitle = meta.jobTitle || 'the position';
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const personalNote = meta.personalNote || '';

  const contentParts = [
    `Candidate Name: ${candidateName}`,
    `Company Name: ${companyName}`,
    `Job Title: ${jobTitle}`,
    `Today's Date: ${today}`,
  ];

  if (personalNote.trim()) {
    contentParts.push(
      ``,
      `---`,
      `PERSONAL MOTIVATION (weave this naturally into the letter — do not quote it verbatim):`,
      personalNote.trim()
    );
    console.log('[Server] Personal note included in cover letter prompt:', personalNote.trim().substring(0, 80) + '...');
  }

  contentParts.push(
    ``,
    `---`,
    `Job Description:`,
    jobDescription,
    ``,
    `---`,
    `Candidate Summary:`,
    resumeSummary,
    ``,
    `---`,
    `Key Terms to Include:`,
    keywordList
  );

  const userContent = contentParts.join('\n');

  const raw = await callOpenAI(prompt, userContent, 'Cover Letter Generation');

  let cleaned = raw.replace(/```\n?/g, '').trim();
  cleaned = replacePlaceholders(cleaned, candidateName, companyName, jobTitle);

  console.log('[Server] Cover letter post-processed — remaining brackets:', (cleaned.match(/\[[^\]]+\]/g) || []).length);
  return cleaned;
}

// ── Keyword Match Scoring ──
function calculateMatchScore(originalResume, keywords, rewrittenResume) {
  const allItems = keywords.keywords || [];
  const rewrittenText = JSON.stringify(rewrittenResume).toLowerCase();
  const originalText = originalResume.toLowerCase();

  let matched = 0;
  let originalMatched = 0;
  const details = allItems.map(k => {
    const kw = k.keyword.toLowerCase();
    const inRewritten = rewrittenText.includes(kw);
    const inOriginal = originalText.includes(kw);
    if (inRewritten) matched++;
    if (inOriginal) originalMatched++;
    return {
      keyword: k.keyword,
      category: k.category,
      importance: k.importance,
      type: k.type || 'keyword',
      inOriginalResume: inOriginal,
      inTailoredResume: inRewritten
    };
  });

  const phraseDetails = details.filter(d => d.type === 'phrase');
  const keywordDetails = details.filter(d => d.type !== 'phrase');

  console.log(`[Server] Keyword match: ${keywordDetails.filter(d => d.inTailoredResume).length}/${keywordDetails.length}`);
  console.log(`[Server] Phrase match: ${phraseDetails.filter(d => d.inTailoredResume).length}/${phraseDetails.length}`);

  return {
    matchScore: allItems.length > 0 ? Math.round((matched / allItems.length) * 100) : 0,
    originalScore: allItems.length > 0 ? Math.round((originalMatched / allItems.length) * 100) : 0,
    matched,
    total: allItems.length,
    details
  };
}

// ── Routes ──

// Health check
app.get('/health', (req, res) => {
  console.log('[Server] Health check');
  res.json({
    status: 'ok',
    resumeLoaded: !!masterResume,
    historyCount: optimizationHistory.length,
    timestamp: new Date().toISOString()
  });
});

// Upload master resume
app.post('/upload-resume', upload.single('resume'), async (req, res) => {
  console.log('[Server] Resume upload request received');

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const text = await parseResume(req.file.path);

    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract enough text from the resume' });
    }

    masterResume = {
      text: text.trim(),
      fileName: req.file.originalname,
      filePath: req.file.path,
      uploadedAt: new Date().toISOString()
    };

    fs.writeFileSync(MASTER_RESUME_PATH, JSON.stringify(masterResume, null, 2));
    console.log('[Server] Master resume saved:', masterResume.fileName, `(${text.length} chars)`);

    res.json({
      success: true,
      fileName: masterResume.fileName,
      textLength: text.length,
      preview: text.substring(0, 300) + '...'
    });
  } catch (err) {
    console.error('[Server] Resume upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get master resume info
app.get('/resume', (req, res) => {
  if (!masterResume) {
    return res.status(404).json({ error: 'No master resume uploaded' });
  }
  res.json({
    fileName: masterResume.fileName,
    uploadedAt: masterResume.uploadedAt,
    textLength: masterResume.text.length,
    preview: masterResume.text.substring(0, 500) + '...'
  });
});

// Get optimization history
app.get('/history', (req, res) => {
  console.log('[Server] History request, entries:', optimizationHistory.length);
  res.json(optimizationHistory.map(h => ({
    id: h.id,
    jobTitle: h.jobTitle,
    companyName: h.companyName,
    matchScore: h.matchScore,
    originalScore: h.originalScore,
    optimizedAt: h.optimizedAt,
    resumePath: h.resumePath,
    coverLetterPath: h.coverLetterPath,
    tone: h.tone
  })));
});

// Get single optimization detail
app.get('/history/:id', (req, res) => {
  const entry = optimizationHistory.find(h => h.id === req.params.id);
  if (!entry) {
    return res.status(404).json({ error: 'Optimization not found' });
  }
  res.json(entry);
});

// Main optimize endpoint
app.post('/optimize', async (req, res) => {
  console.log('[Server] ═══════════════════════════════════════');
  console.log('[Server] Optimize request received');

  if (!masterResume) {
    console.error('[Server] No master resume loaded');
    return res.status(400).json({ error: 'No master resume uploaded. Upload one first at POST /upload-resume' });
  }

  const { jobTitle, companyName, fullDescription, requiredSkills, preferredQualifications, sourceUrl, tone } = req.body;

  if (!fullDescription || fullDescription.length < 50) {
    return res.status(400).json({ error: 'Job description is too short or missing' });
  }

  const selectedTone = tone || 'Professional';
  const optimizationId = `opt-${Date.now()}`;
  console.log(`[Server] Optimization ID: ${optimizationId}`);
  console.log(`[Server] Job: ${jobTitle} at ${companyName}`);
  console.log(`[Server] Description length: ${fullDescription.length} chars`);
  console.log(`[Server] Tone: ${selectedTone}`);

  const MATCH_THRESHOLD = 75;
  const MAX_RETRIES = 3;

  const retryStrategies = [
    {
      name: 'Emphasize different keywords',
      instruction: `RETRY STRATEGY: The previous attempt scored below ${MATCH_THRESHOLD}%. This time, focus HEAVILY on the highest-importance keywords and phrases that were MISSED. Prioritize exact phrase matches above all else. Rephrase bullet points specifically to include the top-importance keywords even if it means restructuring sentences. Be more aggressive with keyword incorporation while keeping facts truthful.`
    },
    {
      name: 'Adjust summary angle',
      instruction: `RETRY STRATEGY: Previous attempts scored below ${MATCH_THRESHOLD}%. This time, completely rewrite the summary from a different angle — lead with the skills and qualifications most central to the job posting. Restructure experience bullets to front-load the exact terminology from the job description. Use the job posting's own language and phrasing wherever possible.`
    },
    {
      name: 'Conversational tone with dense keywords',
      instruction: `RETRY STRATEGY: Previous attempts scored below ${MATCH_THRESHOLD}%. This time, use a slightly more conversational, natural tone that allows you to weave in MORE keywords organically. Write longer, richer bullet points that incorporate multiple keywords per bullet. Expand the skills list to include all relevant variations. Aim for maximum keyword density while maintaining readability.`
    }
  ];

  try {
    // Step 1: Extract ATS keywords (done once, reused across retries)
    console.log('[Server] Step 1: Extracting keywords...');
    const keywords = await extractKeywords(fullDescription);
    console.log(`[Server] Extracted ${keywords.keywords?.length || 0} keywords`);

    let bestResult = null;
    let bestScore = -1;
    let attemptsMade = 0;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const isRetry = attempt > 0;
      const strategy = isRetry ? retryStrategies[attempt - 1] : null;

      if (isRetry) {
        console.log(`[Server] ── Auto-retry ${attempt}/${MAX_RETRIES}: ${strategy.name} ──`);
      }

      // Step 2: Rewrite resume (with optional retry instruction prepended)
      console.log(`[Server] Attempt ${attempt + 1}: Rewriting resume...`);
      const rewrittenResume = await rewriteResumeWithStrategy(
        masterResume.text, keywords, strategy ? strategy.instruction : null
      );
      console.log('[Server] Resume rewritten successfully');

      // Score it
      const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
      console.log(`[Server] Attempt ${attempt + 1} score: ${scoring.matchScore}% (best so far: ${bestScore}%)`);
      attemptsMade = attempt + 1;

      if (scoring.matchScore > bestScore) {
        bestScore = scoring.matchScore;

        // Generate cover letter for this best version
        const useTone = (attempt === MAX_RETRIES && scoring.matchScore < MATCH_THRESHOLD)
          ? 'Conversational' : selectedTone;

        const coverLetterText = await generateCoverLetter(
          fullDescription,
          rewrittenResume.summary,
          keywords,
          useTone,
          {
            candidateName: extractCandidateName(masterResume.text),
            companyName: companyName || 'the company',
            jobTitle: jobTitle || 'the position',
            resumeText: masterResume.text
          }
        );

        bestResult = { rewrittenResume, coverLetterText, scoring };
      }

      if (scoring.matchScore >= MATCH_THRESHOLD) {
        console.log(`[Server] Score ${scoring.matchScore}% meets ${MATCH_THRESHOLD}% threshold on attempt ${attempt + 1}`);
        break;
      }
    }

    const { rewrittenResume, coverLetterText, scoring } = bestResult;
    const belowThreshold = scoring.matchScore < MATCH_THRESHOLD;

    console.log(`[Server] Final score: ${scoring.matchScore}% after ${attemptsMade} attempt(s)${belowThreshold ? ' (below threshold)' : ''}`);

    // Generate DOCX + PDF files for the best result
    console.log('[Server] Generating output files...');
    const version = optimizationHistory.filter(
      h => h.companyName === companyName && h.jobTitle === jobTitle
    ).length + 1;

    const safeCompany = sanitizeForFilename(companyName);
    const safeTitle = sanitizeForFilename(jobTitle);

    const resumeFileName = `resume-v${version}-${safeCompany}-${safeTitle}.docx`;
    const resumePdfFileName = `resume-v${version}-${safeCompany}-${safeTitle}.pdf`;
    const coverLetterFileName = `coverletter-v${version}-${safeCompany}-${safeTitle}.docx`;

    const resumeFilePath = path.join(__dirname, 'output', resumeFileName);
    const resumePdfFilePath = path.join(__dirname, 'output', resumePdfFileName);
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);

    const keywordStrings = (keywords.keywords || []).map(k => k.keyword);

    await generateResumeDOCX(rewrittenResume, keywordStrings, jobTitle, companyName, resumeFilePath, masterResume.text);
    await generateResumePDF(rewrittenResume, keywordStrings, resumePdfFilePath, masterResume.text);
    await generateCoverLetterDOCX(coverLetterText, keywordStrings, jobTitle, companyName, coverLetterFilePath);
    console.log('[Server] All output files saved');

    const historyEntry = {
      id: optimizationId,
      jobTitle: jobTitle || 'Unknown Title',
      companyName: companyName || 'Unknown Company',
      fullDescription,
      requiredSkills: requiredSkills || [],
      preferredQualifications: preferredQualifications || [],
      sourceUrl,
      tone: selectedTone,
      keywords: keywords.keywords || [],
      rewrittenResume,
      originalResumeText: masterResume.text,
      coverLetterText,
      matchScore: scoring.matchScore,
      originalScore: scoring.originalScore,
      keywordDetails: scoring.details,
      retryAttempts: attemptsMade,
      belowThreshold,
      resumePath: `/output/${resumeFileName}`,
      resumePdfPath: `/output/${resumePdfFileName}`,
      coverLetterPath: `/output/${coverLetterFileName}`,
      resumeFileName,
      resumePdfFileName,
      coverLetterFileName,
      optimizedAt: new Date().toISOString()
    };

    optimizationHistory.unshift(historyEntry);
    saveHistory();

    console.log('[Server] ═══════════════════════════════════════');
    console.log(`[Server] Optimization complete! Score: ${scoring.matchScore}% | Attempts: ${attemptsMade}`);

    res.json({
      id: optimizationId,
      matchScore: scoring.matchScore,
      originalScore: scoring.originalScore,
      keywords: keywords.keywords,
      keywordDetails: scoring.details,
      rewrittenResume,
      coverLetterText,
      retryAttempts: attemptsMade,
      belowThreshold,
      resumePath: `/output/${resumeFileName}`,
      resumePdfPath: `/output/${resumePdfFileName}`,
      coverLetterPath: `/output/${coverLetterFileName}`,
      resumeFileName,
      resumePdfFileName,
      coverLetterFileName
    });

  } catch (err) {
    console.error('[Server] Optimization failed:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Re-generate cover letter with different tone
app.post('/regenerate-cover-letter', async (req, res) => {
  const { optimizationId, tone, personalNote } = req.body;
  console.log(`[Server] Regenerating cover letter for ${optimizationId} with tone: ${tone}, personalNote: ${personalNote ? personalNote.length + ' chars' : 'none'}`);

  const entry = optimizationHistory.find(h => h.id === optimizationId);
  if (!entry) {
    return res.status(404).json({ error: 'Optimization not found' });
  }

  try {
    const coverLetterText = await generateCoverLetter(
      entry.fullDescription,
      entry.rewrittenResume.summary,
      { keywords: entry.keywords },
      tone,
      {
        candidateName: extractCandidateName(masterResume?.text || entry.originalResumeText || ''),
        companyName: entry.companyName || 'the company',
        jobTitle: entry.jobTitle || 'the position',
        resumeText: masterResume?.text || entry.originalResumeText || '',
        personalNote: personalNote || ''
      }
    );

    const safeCompany = sanitizeForFilename(entry.companyName);
    const safeTitle = sanitizeForFilename(entry.jobTitle);
    const coverLetterFileName = `coverletter-${tone.toLowerCase()}-${safeCompany}-${safeTitle}.docx`;
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);

    const keywordStrings = entry.keywords.map(k => k.keyword);
    await generateCoverLetterDOCX(coverLetterText, keywordStrings, entry.jobTitle, entry.companyName, coverLetterFilePath);

    entry.coverLetterText = coverLetterText;
    entry.tone = tone;
    entry.personalNote = personalNote || '';
    entry.coverLetterPath = `/output/${coverLetterFileName}`;
    entry.coverLetterFileName = coverLetterFileName;
    saveHistory();

    console.log('[Server] Cover letter regenerated successfully');
    res.json({
      coverLetterText,
      coverLetterPath: `/output/${coverLetterFileName}`,
      coverLetterFileName
    });
  } catch (err) {
    console.error('[Server] Cover letter regeneration failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ──
loadPersistedData();

app.listen(PORT, () => {
  console.log(`[Server] ══════════════════════════════════════════`);
  console.log(`[Server] Indeeeed Optimizer API running on port ${PORT}`);
  console.log(`[Server] Health:  http://localhost:${PORT}/health`);
  console.log(`[Server] Resume:  ${masterResume ? '✅ Loaded' : '❌ Not uploaded'}`);
  console.log(`[Server] History: ${optimizationHistory.length} entries`);
  console.log(`[Server] ══════════════════════════════════════════`);
});
