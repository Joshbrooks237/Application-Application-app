require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const { execSync } = require('child_process');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { generateResumeDOCX, generateCoverLetterDOCX } = require('./docxGenerator');
const { generateResumePDF } = require('./pdfGenerator');

const app = express();
const PORT = process.env.PORT || 3001;

// ── OpenAI Setup ──
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MUSE_HOOKS = [
  'a vivid real moment from their experience', 'a bold contrarian claim', 'a wry one-liner observation about the industry',
  'a "nobody expected this" underdog story', 'a direct challenge to the reader', 'a quiet confident statement of fact',
  'a question that makes the reader think', 'a short punchy declaration', 'a scene-setting moment like the opening of a film',
  'a self-deprecating aside that reveals character', 'a surprising connection between two unrelated experiences',
  'an honest admission that turns into a strength', 'a callback to something specific in the job posting',
];
const MUSE_RHYTHMS = [
  'Short punchy sentences. Staccato. Let the facts hit.', 'Flowing narrative that builds momentum paragraph by paragraph.',
  'Mix of short and long — punchy opener, then unfold into detail.', 'Conversational cadence — like telling a story over drinks.',
  'Measured and deliberate — every word chosen with care.', 'Fast and energetic — match the pace to the excitement.',
  'Start slow and quiet, then build to a crescendo of confidence.',
];
const MUSE_VIBES = [
  'the person at the party who tells one great story and everyone remembers them',
  'your smartest friend who somehow makes everything sound effortless',
  'the coworker who everyone trusts to handle the hard conversation',
  'someone who just got back from doing something amazing and is humbly excited about it',
  'the person who makes you laugh mid-interview and you realize you want to work with them',
  'a seasoned pro who has nothing to prove but proves it anyway',
  'someone writing a letter to a company they genuinely admire',
  'the candidate whose cover letter the hiring manager reads out loud to their team',
  'a natural leader who communicates through stories, not bullet points',
];

function pickRandom(arr, n = 1) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return n === 1 ? shuffled[0] : shuffled.slice(0, n);
}

async function claudeMuse(tone, voiceProfile, context) {
  if (!anthropic) return null;

  const hook = pickRandom(MUSE_HOOKS);
  const rhythm = pickRandom(MUSE_RHYTHMS);
  const vibe = pickRandom(MUSE_VIBES);
  const seed = Math.floor(Math.random() * 10000);

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are a creative writing director. Your job is to generate precise, vivid VOICE DIRECTION that another AI will follow when writing a cover letter or answer.

You don't write the actual content — you write the creative brief. Think of yourself as the director telling an actor exactly how to deliver a scene.

IMPORTANT: Every brief you write must feel FRESH and DIFFERENT. Never repeat the same formula. You are given random creative seeds below — use them as starting inspiration, then riff in your own direction.

Based on the tone, voice profile, and context, produce a short set of instructions (5-10 bullet points) covering:
- Exact emotional register (warm but not syrupy, witty but not trying hard, etc.)
- Sentence rhythm and pacing
- What kind of opening hook to use — try something unexpected
- Which real stories or experiences to lead with and WHY
- Specific phrases or vocabulary that sound like THIS person
- What to absolutely avoid (cliches, corporate buzzwords, specific patterns)
- How to handle humor (if any) — dry? self-deprecating? observational?
- The "vibe check" — if this letter were a person at a party, who would they be?

Be specific and opinionated. Generic direction like "be professional" is useless. Say things like "Open with the 731-unit storage facility story but frame it as an underdog moment — nobody expected that turnaround." or "Write like someone who's genuinely excited but too cool to show it all at once."`,
      messages: [{
        role: 'user',
        content: `Tone selected: ${tone}
Creative seed #${seed}

${voiceProfile ? `Voice Profile:\n${voiceProfile}\n` : '(No voice profile — invent a compelling voice based on the resume and tone. Be creative.)'}

Context: ${context}

RANDOM CREATIVE SEEDS (use as springboard, not prescription):
- Try opening with: ${hook}
- Sentence rhythm idea: ${rhythm}
- Vibe target: ${vibe}

Generate a UNIQUE creative direction. Surprise me. No two briefs should ever feel the same.`
      }]
    });

    const direction = msg.content[0].text;
    console.log(`[Claude Muse] Direction generated (${direction.length} chars) | tone: ${tone} | seed: ${seed} | hook: "${hook.substring(0, 40)}..."`);
    return direction;
  } catch (err) {
    console.warn('[Claude Muse] Failed, proceeding without:', err.message);
    return null;
  }
}

// ── Ensure required directories exist (Railway ephemeral filesystem) ──
['output', 'uploads', 'data'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// ── Middleware ──
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend build if it exists
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  console.log('[Server] Serving frontend from', FRONTEND_BUILD);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

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
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const HISTORY_PATH = path.join(DATA_DIR, 'optimization-history.json');
const LEGACY_RESUME_PATH = path.join(DATA_DIR, 'master-resume.json');

let profiles = [];          // [{ id, name, emoji, text, fileName, filePath, uploadedAt, voiceProfiles, activeVoiceProfileId }]
let activeProfileId = null;
let deletedProfiles = [];   // soft-delete trash bin
let optimizationHistory = [];

const ANSWERS_PATH = path.join(DATA_DIR, 'answer-library.json');
let answerLibrary = [];

function getActiveProfile() {
  return profiles.find(p => p.id === activeProfileId) || null;
}

function getActiveVoiceText(profile) {
  if (!profile?.voiceProfiles?.length) return '';
  const slot = profile.voiceProfiles.find(v => v.id === profile.activeVoiceProfileId)
    || profile.voiceProfiles[0];
  return slot?.text || '';
}

// Backward compat: migrate old single-resume to first profile
function migrateLegacyResume() {
  if (profiles.length > 0) return;
  try {
    if (fs.existsSync(LEGACY_RESUME_PATH)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_RESUME_PATH, 'utf-8'));
      if (legacy && legacy.text) {
        const profile = {
          id: `profile-${Date.now()}`,
          name: extractCandidateName(legacy.text) || 'Default',
          emoji: '📄',
          text: legacy.text,
          fileName: legacy.fileName || 'resume.docx',
          filePath: legacy.filePath || '',
          uploadedAt: legacy.uploadedAt || new Date().toISOString()
        };
        profiles.push(profile);
        activeProfileId = profile.id;
        saveProfiles();
        console.log('[Server] Migrated legacy resume to profile:', profile.name);
      }
    }
  } catch (err) {
    console.error('[Server] Legacy migration failed:', err.message);
  }
}

function loadPersistedData() {
  try {
    if (fs.existsSync(PROFILES_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf-8'));
      profiles = data.profiles || [];
      activeProfileId = data.activeProfileId || (profiles[0]?.id || null);
      deletedProfiles = data.deletedProfiles || [];
      console.log(`[Server] Loaded ${profiles.length} profile(s), active: ${activeProfileId}, trash: ${deletedProfiles.length}`);
    }
  } catch (err) {
    console.error('[Server] Failed to load profiles:', err.message);
  }

  migrateLegacyResume();

  try {
    if (fs.existsSync(HISTORY_PATH)) {
      optimizationHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      console.log('[Server] Loaded optimization history:', optimizationHistory.length, 'entries');
    }
  } catch (err) {
    console.error('[Server] Failed to load history:', err.message);
  }

  loadAnswers();
}

function saveProfiles() {
  try {
    fs.writeFileSync(PROFILES_PATH, JSON.stringify({ profiles, activeProfileId, deletedProfiles }, null, 2));
  } catch (err) {
    console.error('[Server] Failed to save profiles:', err.message);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(optimizationHistory, null, 2));
  } catch (err) {
    console.error('[Server] Failed to save history:', err.message);
  }
}

function loadAnswers() {
  try {
    if (fs.existsSync(ANSWERS_PATH)) {
      answerLibrary = JSON.parse(fs.readFileSync(ANSWERS_PATH, 'utf-8'));
      console.log('[Server] Loaded answer library:', answerLibrary.length, 'entries');
    }
  } catch (err) {
    console.error('[Server] Failed to load answers:', err.message);
  }
}

function saveAnswers() {
  try {
    fs.writeFileSync(ANSWERS_PATH, JSON.stringify(answerLibrary, null, 2));
  } catch (err) {
    console.error('[Server] Failed to save answers:', err.message);
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
- NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any personal AI tool/app/software the candidate built UNLESS the target job is explicitly in software development, AI, tech, or engineering. For all other roles (customer service, leasing, sales, medical, property management, brand ambassador, administrative, etc.) — REMOVE Rio Brave and any personal app/tool from the experience section entirely. Do not include it in experience, additionalExperience, skills, or summary.
- NEVER invent metrics or scenarios. Each metric belongs to ONE role only — never mix them:
  • 731 units, 5.0 Google rating, 261 reviews → A-AAAKey Mini Storage ONLY
  • 98% on-time delivery rate → Green Cuisine medical delivery ONLY
  • 30+ leads/week → HVAC Lead Generator ONLY
  • 12% fuel reduction → Fleet Manager ONLY
  • 20% consultation increase → HVAC Lead Generator ONLY
  No other numbers exist. Never attribute a metric to the wrong company.
- Joshua is conversational in Spanish but NOT fluent. If Spanish language skills are relevant to the role, list them as "conversational Spanish" or "working knowledge of Spanish." NEVER claim fluency, bilingual status, or "fluent in Spanish."

Return ONLY valid JSON with keys: summary, skills, experience, additionalExperience.

Expected format:
{"summary": "...", "skills": ["skill1", "skill2", ...], "experience": [{"role": "...", "company": "...", "bullets": ["...", "...", "..."]}], "additionalExperience": [{"role": "...", "company": "...", "bullets": ["...", "..."]}]}`,

  coverLetter: `You are an expert cover letter writer. Write a tailored cover letter using ONLY the candidate's real background from their resume and the job's exact keywords and phrases. Mirror the tone and language of the job posting. The letter should feel human, specific, and confident — not generic. Use the STAR method for one key achievement that ACTUALLY EXISTS in the resume. Length: 3 paragraphs. Tone: [TONE_SELECTION].

PERSONALITY RULE — applies to ALL tones: This candidate has a natural sense of humor and it should come through in every cover letter. Include 1-2 witty moments — a punchy opening line, a self-aware aside, or a clever observation about the industry that makes the hiring manager smile. Be charming, not clownish. The goal is a cover letter that feels human and memorable — someone you'd actually want to grab coffee with. Still grounded in real experience, still clearly professional — just with enough personality that it doesn't read like everyone else's.

TONE GUIDE — match your writing style to the selected tone:
- Professional: Polished, formal, corporate-appropriate. Clean structure, measured language, zero slang.
- Confident: Bold, assertive, leads with impact. "Here's what I bring" energy. Numbers up front.
- Conversational: Relaxed, friendly, sounds like a real person wrote it over coffee. Natural rhythm, contractions welcome.
- Casual: Laid-back and approachable, like texting a recruiter you already vibe with. Loose structure, real talk, zero corporate speak. Still shows competence — just doesn't try hard to prove it.
- Funny: Witty, clever, self-aware humor. Open with a memorable hook that makes the reader smile. Dry wit and personality — NOT slapstick or jokes. Still professional enough to get hired. Think "the cover letter they actually read twice."
- Fun: Light, upbeat, playful energy. Shows genuine excitement and personality without the sharp wit of Funny. Think "this person would be awesome to work with." Sprinkle in charm and positivity while keeping it real.
- Storyteller: Narrative-driven. Open with a compelling moment or scene from the candidate's real experience. Pull the reader in like the first page of a book. Arc from challenge to impact.
- Bold: Unapologetic, high-conviction, stands out from the pile. "You need someone who can do X — I already have" energy. Borders on audacious without being arrogant.
- Warm: Empathetic, people-first, relationship-focused. Emphasizes teamwork, mentorship, community impact. Heart on sleeve but still substantive.
- Direct: No fluff, no filler, respects the reader's time. Short punchy sentences. Gets to the point in the first line. Every word earns its place.
- Enthusiastic: High energy, genuinely excited about the opportunity. Infectious passion that feels authentic, not performative. Shows real research into the company.

ABSOLUTE TRUTH RULES — EVERY WORD MUST BE DEFENSIBLE IN AN INTERVIEW:
- NEVER invent a scenario, story, or hypothetical example. Do NOT write "for instance" or "for example" followed by a made-up situation. If you need an example, use ONLY real ones from the resume.
- The ONLY real metrics that exist — and each MUST be attributed to the correct role:
  • 731 units, 5.0 Google rating, 261 reviews → A-AAAKey Mini Storage ONLY
  • 98% on-time delivery rate → Green Cuisine medical delivery ONLY
  • 30+ leads per week → HVAC Lead Generator ONLY
  • 12% fuel reduction → Fleet Manager ONLY
  • 20% consultation increase → HVAC Lead Generator ONLY
  NEVER mix metrics between roles. NEVER attribute a metric to the wrong company. NO OTHER NUMBERS OR STORIES EXIST. Do not invent any other statistics, percentages, or achievement numbers.
- NEVER fabricate experience the candidate does not have. If the candidate managed storage facilities, do NOT claim they managed multifamily apartment complexes. If the job requires experience the candidate doesn't have, bridge the gap HONESTLY: explain how their real experience transfers. Example: "While my property management background is in storage facilities, the core skills of tenant relations, lease enforcement, delinquency management, and vendor coordination transfer directly."
- NEVER claim software proficiency unless the software is explicitly listed in the resume. If the candidate is learning a tool, say "currently training on [tool]" — never claim proficiency.
- Draw ONLY from what exists in the master resume. If a skill or achievement is not there, do not invent it. Use transferable skills and honest bridging instead.
- Use the candidate's real story with real details — real company names, real unit counts, real challenges they faced. Authentic specifics are more compelling than fabricated experience.
- NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any personal AI tool/app the candidate built, unless the job is explicitly in tech/software development.
- Joshua is conversational in Spanish but NOT fluent. If Spanish language skills are relevant to the role, describe them honestly as "conversational Spanish skills" or "working knowledge of Spanish." NEVER claim fluency, bilingual status, or "fluency in both English and Spanish."
- End with ONE closing signature only — never duplicate "Sincerely" or any sign-off. Do NOT include the date, "Dear Hiring Manager," or the candidate's name after "Sincerely" — the document template adds those automatically.

FORMATTING RULES:
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

function buildResumeUserContent(resumeText, keywords, voiceText) {
  const allItems = keywords.keywords || [];
  const singleKeywords = allItems.filter(k => k.type !== 'phrase');
  const phrases = allItems.filter(k => k.type === 'phrase');

  const keywordList = singleKeywords
    .map(k => `[keyword] ${k.keyword} (${k.category}, importance: ${k.importance})`)
    .join('\n');
  const phraseList = phrases
    .map(k => `[phrase] "${k.keyword}" (${k.category}, importance: ${k.importance})`)
    .join('\n');

  let content = `Master Resume:\n${resumeText}`;
  if (voiceText) {
    content += `\n\n---\nVOICE PROFILE — This captures the candidate's communication style, real stories, and what makes them memorable. Use this to make the resume sound genuinely like this person:\n${voiceText}`;
  }
  content += `\n\n---\nATS Keywords:\n${keywordList}\n\n---\nATS Phrases (use these EXACT multi-word phrases):\n${phraseList}`;
  return content;
}

async function rewriteResume(resumeText, keywords, voiceText) {
  return rewriteResumeWithStrategy(resumeText, keywords, null, voiceText);
}

async function rewriteResumeWithStrategy(resumeText, keywords, retryInstruction, voiceText) {
  const systemPrompt = retryInstruction
    ? `${PROMPTS.resumeRewrite}\n\n${retryInstruction}`
    : PROMPTS.resumeRewrite;

  const raw = await callOpenAI(
    systemPrompt,
    buildResumeUserContent(resumeText, keywords, voiceText),
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
      const name = line === line.toUpperCase()
        ? line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : line;
      console.log('[Server] Extracted candidate name:', name);
      return name;
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
  let prompt = PROMPTS.coverLetter.replace('[TONE_SELECTION]', tone);
  const keywordList = keywords.keywords.map(k => k.keyword).join(', ');

  const candidateName = meta.candidateName || extractCandidateName(meta.resumeText || '');

  const museDirection = await claudeMuse(
    tone,
    meta.voiceText || '',
    `Cover letter for ${meta.jobTitle || 'a position'} at ${meta.companyName || 'a company'}. Resume summary: ${resumeSummary?.substring(0, 200) || 'N/A'}`
  );
  if (museDirection) {
    prompt += `\n\nCREATIVE DIRECTION FROM WRITING DIRECTOR (follow this closely — it defines the voice and character of this specific letter):\n${museDirection}`;
  }
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

  const voiceText = meta.voiceText || '';
  if (voiceText) {
    contentParts.push(
      ``,
      `---`,
      `VOICE PROFILE — This captures the candidate's communication style, real stories, and what makes them memorable. Use this to make the letter sound genuinely like this person:`,
      voiceText
    );
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

// ── Profile Routes ──

app.get('/profiles', (req, res) => {
  res.json({
    profiles: profiles.map(p => ({
      id: p.id, name: p.name, emoji: p.emoji,
      fileName: p.fileName, textLength: p.text?.length || 0,
      uploadedAt: p.uploadedAt,
      filePath: p.filePath ? `/uploads/${path.basename(p.filePath)}` : null,
      voiceProfiles: (p.voiceProfiles || []).map(v => ({
        id: v.id, name: v.name,
        textLength: v.text?.length || 0,
        createdAt: v.createdAt, updatedAt: v.updatedAt
      })),
      activeVoiceProfileId: p.activeVoiceProfileId || null
    })),
    activeProfileId
  });
});

app.post('/profiles', upload.single('resume'), async (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: 'Profile name is required' });
  if (!req.file) return res.status(400).json({ error: 'Resume file is required' });

  try {
    const text = await parseResume(req.file.path);
    if (!text || text.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract enough text from the resume' });
    }

    const profile = {
      id: `profile-${Date.now()}`,
      name: name.trim(),
      emoji: emoji || '📄',
      text: text.trim(),
      fileName: req.file.originalname,
      filePath: req.file.path,
      uploadedAt: new Date().toISOString()
    };

    profiles.push(profile);
    if (!activeProfileId) activeProfileId = profile.id;
    saveProfiles();

    console.log(`[Server] Profile created: ${profile.name} (${profile.id})`);
    res.json({ success: true, profile: { id: profile.id, name: profile.name, emoji: profile.emoji, fileName: profile.fileName, textLength: text.length, uploadedAt: profile.uploadedAt } });
  } catch (err) {
    console.error('[Server] Profile creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/profiles/:id', upload.single('resume'), async (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const { name, emoji } = req.body;
  if (name) profile.name = name.trim();
  if (emoji) profile.emoji = emoji;

  if (req.file) {
    try {
      const text = await parseResume(req.file.path);
      if (!text || text.trim().length < 50) {
        return res.status(400).json({ error: 'Could not extract enough text from the resume' });
      }
      profile.text = text.trim();
      profile.fileName = req.file.originalname;
      profile.filePath = req.file.path;
      profile.uploadedAt = new Date().toISOString();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  saveProfiles();
  console.log(`[Server] Profile updated: ${profile.name}`);
  res.json({ success: true, profile: { id: profile.id, name: profile.name, emoji: profile.emoji, fileName: profile.fileName, textLength: profile.text.length, uploadedAt: profile.uploadedAt } });
});

app.delete('/profiles/:id', (req, res) => {
  const idx = profiles.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Profile not found' });

  const removed = profiles.splice(idx, 1)[0];
  removed.deletedAt = new Date().toISOString();
  deletedProfiles.unshift(removed);
  if (activeProfileId === removed.id) {
    activeProfileId = profiles[0]?.id || null;
  }
  saveProfiles();
  console.log(`[Server] Profile moved to trash: ${removed.name}`);
  res.json({ success: true, activeProfileId, canUndo: true, deletedId: removed.id });
});

app.get('/profiles/trash', (req, res) => {
  res.json(deletedProfiles.map(p => ({
    id: p.id, name: p.name, emoji: p.emoji,
    fileName: p.fileName, textLength: p.text?.length || 0,
    deletedAt: p.deletedAt
  })));
});

app.post('/profiles/:id/restore', (req, res) => {
  const idx = deletedProfiles.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Deleted profile not found' });

  const restored = deletedProfiles.splice(idx, 1)[0];
  delete restored.deletedAt;
  profiles.push(restored);
  if (!activeProfileId) activeProfileId = restored.id;
  saveProfiles();
  console.log(`[Server] Profile restored: ${restored.name}`);
  res.json({ success: true, profile: { id: restored.id, name: restored.name, emoji: restored.emoji } });
});

app.post('/profiles/:id/activate', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  activeProfileId = profile.id;
  saveProfiles();
  console.log(`[Server] Active profile switched to: ${profile.name}`);
  res.json({ success: true, activeProfileId });
});

// ── File Parsing Utility ──

app.post('/parse-file', upload.single('voiceFile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  try {
    const text = await parseResume(req.file.path);
    res.json({ text: text.trim() });
  } catch (err) {
    res.status(400).json({ error: 'Could not read file: ' + err.message });
  }
});

// ── Voice Profile Routes ──

app.get('/profiles/:id/voice-profiles', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  res.json({
    voiceProfiles: profile.voiceProfiles || [],
    activeVoiceProfileId: profile.activeVoiceProfileId || null
  });
});

app.post('/profiles/:id/voice-profiles', upload.single('voiceFile'), async (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const { name, text } = req.body;
  let voiceText = text || '';

  if (req.file) {
    try {
      voiceText = await parseResume(req.file.path);
    } catch (err) {
      return res.status(400).json({ error: 'Could not read voice profile file: ' + err.message });
    }
  }

  if (!voiceText || voiceText.trim().length < 10) {
    return res.status(400).json({ error: 'Voice profile text is too short' });
  }

  if (!profile.voiceProfiles) profile.voiceProfiles = [];

  const slot = {
    id: `vp-${Date.now()}`,
    name: (name || 'Default').trim(),
    text: voiceText.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  profile.voiceProfiles.push(slot);
  if (!profile.activeVoiceProfileId) profile.activeVoiceProfileId = slot.id;
  saveProfiles();

  console.log(`[Server] Voice profile created: "${slot.name}" for ${profile.name}`);
  res.json({ success: true, voiceProfile: slot });
});

app.put('/profiles/:id/voice-profiles/:slotId', upload.single('voiceFile'), async (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const slot = (profile.voiceProfiles || []).find(v => v.id === req.params.slotId);
  if (!slot) return res.status(404).json({ error: 'Voice profile slot not found' });

  const { name, text } = req.body;
  if (name) slot.name = name.trim();

  if (req.file) {
    try {
      slot.text = await parseResume(req.file.path);
    } catch (err) {
      return res.status(400).json({ error: 'Could not read voice profile file: ' + err.message });
    }
  } else if (text !== undefined) {
    slot.text = text.trim();
  }

  slot.updatedAt = new Date().toISOString();
  saveProfiles();

  console.log(`[Server] Voice profile updated: "${slot.name}" for ${profile.name}`);
  res.json({ success: true, voiceProfile: slot });
});

app.delete('/profiles/:id/voice-profiles/:slotId', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const idx = (profile.voiceProfiles || []).findIndex(v => v.id === req.params.slotId);
  if (idx === -1) return res.status(404).json({ error: 'Voice profile slot not found' });

  const removed = profile.voiceProfiles.splice(idx, 1)[0];
  if (profile.activeVoiceProfileId === removed.id) {
    profile.activeVoiceProfileId = profile.voiceProfiles[0]?.id || null;
  }
  saveProfiles();

  console.log(`[Server] Voice profile deleted: "${removed.name}" from ${profile.name}`);
  res.json({ success: true, activeVoiceProfileId: profile.activeVoiceProfileId });
});

app.post('/profiles/:id/voice-profiles/:slotId/activate', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const slot = (profile.voiceProfiles || []).find(v => v.id === req.params.slotId);
  if (!slot) return res.status(404).json({ error: 'Voice profile slot not found' });

  profile.activeVoiceProfileId = slot.id;
  saveProfiles();

  console.log(`[Server] Active voice profile: "${slot.name}" for ${profile.name}`);
  res.json({ success: true, activeVoiceProfileId: slot.id });
});

// ── Legacy + Core Routes ──

// Health check
app.get('/health', (req, res) => {
  console.log('[Server] Health check');
  const active = getActiveProfile();
  res.json({
    status: 'ok',
    resumeLoaded: !!active,
    activeProfile: active ? { id: active.id, name: active.name, emoji: active.emoji } : null,
    profileCount: profiles.length,
    historyCount: optimizationHistory.length,
    timestamp: new Date().toISOString()
  });
});

// Legacy upload — creates/updates active profile
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

    const active = getActiveProfile();
    if (active) {
      active.text = text.trim();
      active.fileName = req.file.originalname;
      active.filePath = req.file.path;
      active.uploadedAt = new Date().toISOString();
    } else {
      const profile = {
        id: `profile-${Date.now()}`,
        name: extractCandidateName(text) || 'Default',
        emoji: '📄',
        text: text.trim(),
        fileName: req.file.originalname,
        filePath: req.file.path,
        uploadedAt: new Date().toISOString()
      };
      profiles.push(profile);
      activeProfileId = profile.id;
    }

    saveProfiles();
    const p = getActiveProfile();
    console.log('[Server] Resume saved to profile:', p.name, `(${text.length} chars)`);

    res.json({
      success: true,
      fileName: p.fileName,
      textLength: text.length,
      preview: text.substring(0, 300) + '...'
    });
  } catch (err) {
    console.error('[Server] Resume upload failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get active profile resume info
app.get('/resume', (req, res) => {
  const active = getActiveProfile();
  if (!active) {
    return res.status(404).json({ error: 'No resume profile active' });
  }
  res.json({
    fileName: active.fileName,
    uploadedAt: active.uploadedAt,
    textLength: active.text.length,
    preview: active.text.substring(0, 500) + '...',
    profileId: active.id,
    profileName: active.name,
    profileEmoji: active.emoji
  });
});

// Get optimization history (optionally filtered by profileId)
app.get('/history', (req, res) => {
  let filtered = optimizationHistory;
  if (req.query.profileId) {
    filtered = filtered.filter(h => h.profileId === req.query.profileId);
  }
  console.log(`[Server] History request, entries: ${filtered.length}/${optimizationHistory.length}`);
  res.json(filtered.map(h => ({
    id: h.id,
    jobTitle: h.jobTitle,
    companyName: h.companyName,
    matchScore: h.matchScore,
    originalScore: h.originalScore,
    optimizedAt: h.optimizedAt,
    resumePath: h.resumePath,
    coverLetterPath: h.coverLetterPath,
    tone: h.tone,
    retryAttempts: h.retryAttempts,
    belowThreshold: h.belowThreshold,
    profileId: h.profileId,
    profileName: h.profileName,
    profileEmoji: h.profileEmoji
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

  const masterResume = getActiveProfile();
  if (!masterResume) {
    console.error('[Server] No active profile');
    return res.status(400).json({ error: 'No resume profile active. Create a profile with a resume first.' });
  }
  console.log(`[Server] Using profile: ${masterResume.name} (${masterResume.id})`);

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
      const voiceText = getActiveVoiceText(masterResume);
      let rewrittenResume;
      try {
        rewrittenResume = await rewriteResumeWithStrategy(
          masterResume.text, keywords, strategy ? strategy.instruction : null, voiceText
        );
        console.log('[Server] Resume rewritten successfully');
      } catch (parseErr) {
        console.error(`[Server] Attempt ${attempt + 1} failed: ${parseErr.message}`);
        if (attempt < MAX_RETRIES) {
          console.log('[Server] Will retry with next strategy...');
          continue;
        }
        throw parseErr;
      }

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
            resumeText: masterResume.text,
            voiceText: getActiveVoiceText(masterResume)
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
    await generateCoverLetterDOCX(coverLetterText, keywordStrings, jobTitle, companyName, coverLetterFilePath, extractCandidateName(masterResume.text));
    console.log('[Server] All output files saved');

    const historyEntry = {
      id: optimizationId,
      profileId: masterResume.id,
      profileName: masterResume.name,
      profileEmoji: masterResume.emoji,
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
    const activeProf = getActiveProfile();
    const coverLetterText = await generateCoverLetter(
      entry.fullDescription,
      entry.rewrittenResume.summary,
      { keywords: entry.keywords },
      tone,
      {
        candidateName: extractCandidateName(activeProf?.text || entry.originalResumeText || ''),
        companyName: entry.companyName || 'the company',
        jobTitle: entry.jobTitle || 'the position',
        resumeText: activeProf?.text || entry.originalResumeText || '',
        personalNote: personalNote || '',
        voiceText: getActiveVoiceText(activeProf)
      }
    );

    const safeCompany = sanitizeForFilename(entry.companyName);
    const safeTitle = sanitizeForFilename(entry.jobTitle);
    const coverLetterFileName = `coverletter-${tone.toLowerCase()}-${safeCompany}-${safeTitle}.docx`;
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);

    const keywordStrings = entry.keywords.map(k => k.keyword);
    await generateCoverLetterDOCX(coverLetterText, keywordStrings, entry.jobTitle, entry.companyName, coverLetterFilePath, extractCandidateName(getActiveProfile()?.text || entry.originalResumeText || ''));

    if (!entry.coverLetterVersions) entry.coverLetterVersions = [];
    if (entry.coverLetterText && entry.coverLetterVersions.length === 0) {
      entry.coverLetterVersions.push({
        text: entry.coverLetterText,
        tone: entry.tone || 'Professional',
        generatedAt: entry.optimizedAt || new Date().toISOString()
      });
    }
    entry.coverLetterVersions.push({
      text: coverLetterText,
      tone,
      generatedAt: new Date().toISOString()
    });

    entry.coverLetterText = coverLetterText;
    entry.tone = tone;
    entry.personalNote = personalNote || '';
    entry.coverLetterPath = `/output/${coverLetterFileName}`;
    entry.coverLetterFileName = coverLetterFileName;
    entry.selectedCoverLetterVersion = entry.coverLetterVersions.length - 1;
    saveHistory();

    console.log(`[Server] Cover letter regenerated (version ${entry.coverLetterVersions.length})`);
    res.json({
      coverLetterText,
      coverLetterPath: `/output/${coverLetterFileName}`,
      coverLetterFileName,
      versionCount: entry.coverLetterVersions.length,
      selectedVersion: entry.selectedCoverLetterVersion
    });
  } catch (err) {
    console.error('[Server] Cover letter regeneration failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Answer Library (Highlight-to-Answer) ──

const ANSWER_CATEGORIES = [
  'motivation', 'experience', 'strengths', 'conflict_resolution',
  'salary', 'availability', 'why_this_company', 'skills',
  'leadership', 'teamwork', 'weakness', 'other'
];

app.post('/answer-question', async (req, res) => {
  const { question, pageContext } = req.body;
  console.log('[Server] ── Answer Question ──');
  console.log('[Server] Question:', question?.substring(0, 100));
  console.log('[Server] Context:', pageContext?.url);

  if (!question || question.trim().length < 5) {
    return res.status(400).json({ error: 'Question is too short' });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return res.status(400).json({ error: 'No active resume profile. Upload a resume first.' });
  }

  try {
    // Check for similar previous answers
    const questionLower = question.toLowerCase().trim();
    const similar = answerLibrary.find(a =>
      a.profileId === profile.id &&
      (a.question.toLowerCase().includes(questionLower) ||
       questionLower.includes(a.question.toLowerCase()) ||
       levenshteinSimilarity(a.question.toLowerCase(), questionLower) > 0.6)
    );

    if (similar) {
      console.log('[Server] Found similar previous answer:', similar.id);
    }

    // Generate answer
    const systemPrompt = `You are an expert job application assistant. Using only the candidate's actual experience from their resume, generate a specific, honest, compelling answer to the following job application question. Sound human and natural. Use real examples and real metrics from their background. Never fabricate experience. Keep answers concise — 2 to 4 sentences for short answer fields, up to one paragraph for longer fields. Always lead with a specific real example not a generic statement.

Try to identify the TARGET company name and job position from the page URL, page title, or surrounding page context provided. If you can identify them, use them naturally in the answer. If you CANNOT confidently identify the company name or position — do not guess — just answer the question directly and professionally without mentioning any company name at all.

CRITICAL RULES:
- NEVER invent a scenario, story, or hypothetical example. Do NOT write "for instance" or "for example" followed by a made-up situation. If you need an example, use ONLY real ones from the resume.
- The ONLY real metrics — each belongs to ONE specific role, never mix them:
  • 731 units, 5.0 Google rating, 261 reviews → A-AAAKey Mini Storage ONLY
  • 98% on-time delivery rate → Green Cuisine medical delivery ONLY
  • 30+ leads per week → HVAC Lead Generator ONLY
  • 12% fuel reduction → Fleet Manager ONLY
  • 20% consultation increase → HVAC Lead Generator ONLY
  No other numbers or stories exist. NEVER attribute a metric to the wrong company.
- NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any AI tool/app/software the candidate may have built — these must NEVER appear in any generated answer.
- The candidate's personal software projects, apps, or AI tools should ONLY be referenced if the job is explicitly in tech, AI, or software development AND the question specifically asks about relevant projects or technical experience.
- For all other roles (customer service, leasing, sales, medical, property management, administrative, etc.) — draw ONLY from the candidate's professional work experience at real employers. Do not mention side projects, personal apps, or startup ventures unless they are directly relevant to the role being applied for.
- Joshua is conversational in Spanish but NOT fluent. If Spanish skills are relevant, say "conversational Spanish" or "working knowledge of Spanish." NEVER claim fluency or bilingual status.`;

    const contextParts = [`Question: ${question}`];
    if (pageContext?.companyName) contextParts.push(`Company (from page): ${pageContext.companyName}`);
    if (pageContext?.roleTitle) contextParts.push(`Role (from page): ${pageContext.roleTitle}`);
    if (pageContext?.url) contextParts.push(`Page URL: ${pageContext.url}`);
    if (pageContext?.pageTitle) contextParts.push(`Page Title: ${pageContext.pageTitle}`);
    contextParts.push(`\n---\nCandidate Resume:\n${profile.text}`);

    const voiceText = getActiveVoiceText(profile);
    if (voiceText) {
      contextParts.push(`\n---\nVOICE PROFILE — The candidate's communication style, real stories, and what makes them memorable. Use this to sound genuinely like them:\n${voiceText}`);
    }

    if (similar) {
      contextParts.push(`\n---\nA similar question was previously answered. Here is the previous answer for reference (improve upon it, don't copy verbatim):\n${similar.versions[similar.selectedVersion]?.answer || similar.answer}`);
    }

    const museDirection = await claudeMuse(
      'Conversational',
      voiceText,
      `Answering job application question: "${question.substring(0, 120)}" for ${pageContext?.companyName || 'unknown company'}, role: ${pageContext?.roleTitle || 'unknown'}`
    );

    let finalSystemPrompt = systemPrompt;
    if (museDirection) {
      finalSystemPrompt += `\n\nCREATIVE DIRECTION FROM WRITING DIRECTOR (follow this closely — it defines how this answer should sound):\n${museDirection}`;
    }

    const answer = await callOpenAI(finalSystemPrompt, contextParts.join('\n'), 'Answer Generation');

    // Auto-categorize
    let category = 'other';
    try {
      const catResult = await callOpenAI(
        'Categorize this job application question into exactly ONE of these categories. Return ONLY the category name, nothing else: motivation, experience, strengths, conflict_resolution, salary, availability, why_this_company, skills, leadership, teamwork, weakness, other',
        question,
        'Answer Categorization'
      );
      const cleaned = catResult.trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (ANSWER_CATEGORIES.includes(cleaned)) category = cleaned;
    } catch (err) {
      console.warn('[Server] Categorization failed, using "other":', err.message);
    }

    const entry = {
      id: `ans-${Date.now()}`,
      question: question.trim(),
      answer,
      category,
      pageContext: pageContext || {},
      profileId: profile.id,
      profileName: profile.name,
      profileEmoji: profile.emoji,
      versions: [{ answer, generatedAt: new Date().toISOString() }],
      selectedVersion: 0,
      similarPreviousId: similar?.id || null,
      generatedAt: new Date().toISOString()
    };

    answerLibrary.unshift(entry);
    saveAnswers();
    console.log(`[Server] Answer generated and saved: ${entry.id} [${category}]`);

    res.json({
      id: entry.id,
      question: entry.question,
      answer,
      category,
      similarPrevious: similar ? { id: similar.id, question: similar.question, answer: similar.versions[similar.selectedVersion]?.answer || similar.answer } : null,
      pageContext: entry.pageContext,
      profileId: entry.profileId,
      profileName: entry.profileName,
      generatedAt: entry.generatedAt
    });
  } catch (err) {
    console.error('[Server] Answer generation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Simple similarity check
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const costs = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastVal = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) { costs[j] = j; }
      else if (j > 0) {
        let newVal = costs[j - 1];
        if (longer[i - 1] !== shorter[j - 1]) {
          newVal = Math.min(Math.min(newVal, lastVal), costs[j]) + 1;
        }
        costs[j - 1] = lastVal;
        lastVal = newVal;
      }
    }
    if (i > 0) costs[shorter.length] = lastVal;
  }
  return (longer.length - costs[shorter.length]) / longer.length;
}

app.get('/answers', (req, res) => {
  let filtered = answerLibrary;

  if (req.query.profileId) {
    filtered = filtered.filter(a => a.profileId === req.query.profileId);
  }
  if (req.query.category && req.query.category !== 'all') {
    filtered = filtered.filter(a => a.category === req.query.category);
  }
  if (req.query.search) {
    const s = req.query.search.toLowerCase();
    filtered = filtered.filter(a =>
      a.question.toLowerCase().includes(s) || a.answer.toLowerCase().includes(s)
    );
  }

  const limit = parseInt(req.query.limit) || 50;
  console.log(`[Server] Answers request: ${filtered.length} results (limit ${limit})`);

  res.json(filtered.slice(0, limit).map(a => ({
    id: a.id,
    question: a.question,
    answer: a.versions[a.selectedVersion]?.answer || a.answer,
    category: a.category,
    pageContext: a.pageContext,
    profileId: a.profileId,
    profileName: a.profileName,
    profileEmoji: a.profileEmoji,
    versionsCount: a.versions.length,
    selectedVersion: a.selectedVersion,
    generatedAt: a.generatedAt
  })));
});

app.post('/answers/:id/regenerate', async (req, res) => {
  const entry = answerLibrary.find(a => a.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Answer not found' });

  const profile = profiles.find(p => p.id === entry.profileId) || getActiveProfile();
  if (!profile) return res.status(400).json({ error: 'Profile not found' });

  if (entry.versions.length >= 3) {
    return res.status(400).json({ error: 'Maximum 3 versions reached' });
  }

  try {
    const systemPrompt = `You are an expert job application assistant. Generate a DIFFERENT answer to this question than the previous attempts. Use a different angle, different examples from the resume, or a different structure. Still be honest and use only real experience. 2-4 sentences. NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any AI tool/app the candidate built. For non-tech roles, use only professional work experience. Joshua is conversational in Spanish but NOT fluent — say "conversational Spanish" never claim fluency or bilingual status. Metrics must match the correct role: 731 units/5.0 rating/261 reviews = A-AAAKey ONLY; 98% on-time delivery = Green Cuisine ONLY; 30+ leads/week & 20% consultation increase = HVAC ONLY; 12% fuel reduction = Fleet Manager ONLY. Never mix metrics between roles.\n\nPrevious answers to avoid repeating:\n${entry.versions.map((v, i) => `Version ${i + 1}: ${v.answer}`).join('\n')}`;

    const contextParts = [`Question: ${entry.question}`];
    if (entry.pageContext?.companyName) contextParts.push(`Company: ${entry.pageContext.companyName}`);
    if (entry.pageContext?.roleTitle) contextParts.push(`Role: ${entry.pageContext.roleTitle}`);
    contextParts.push(`\n---\nCandidate Resume:\n${profile.text}`);

    const voiceText = getActiveVoiceText(profile);
    if (voiceText) {
      contextParts.push(`\n---\nVOICE PROFILE — The candidate's communication style and real stories. Sound like them:\n${voiceText}`);
    }

    const answer = await callOpenAI(systemPrompt, contextParts.join('\n'), 'Answer Regeneration');

    entry.versions.push({ answer, generatedAt: new Date().toISOString() });
    entry.selectedVersion = entry.versions.length - 1;
    saveAnswers();

    console.log(`[Server] Answer regenerated: ${entry.id} (version ${entry.versions.length})`);
    res.json({ answer, version: entry.versions.length - 1 });
  } catch (err) {
    console.error('[Server] Answer regeneration failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/answers/:id/select', (req, res) => {
  const entry = answerLibrary.find(a => a.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Answer not found' });

  const { version } = req.body;
  if (version < 0 || version >= entry.versions.length) {
    return res.status(400).json({ error: 'Invalid version' });
  }

  entry.selectedVersion = version;
  saveAnswers();
  console.log(`[Server] Answer version selected: ${entry.id} → v${version}`);
  res.json({ success: true });
});

app.post('/answer-batch', async (req, res) => {
  const { fields, pageContext } = req.body;
  console.log('[Server] ── Batch Answer ──');
  console.log(`[Server] ${fields?.length || 0} fields to fill`);

  if (!Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ error: 'No fields provided' });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return res.status(400).json({ error: 'No active resume profile. Upload a resume first.' });
  }

  try {
    const fieldDescriptions = fields.map((f, i) =>
      `Field ${i + 1}:\n  Label: ${f.label || '(unlabeled)'}\n  Placeholder: ${f.placeholder || '(none)'}\n  Type: ${f.type || 'text'}`
    ).join('\n\n');

    const contextParts = [];
    if (pageContext?.companyName) contextParts.push(`Company: ${pageContext.companyName}`);
    if (pageContext?.roleTitle) contextParts.push(`Role: ${pageContext.roleTitle}`);
    if (pageContext?.url) contextParts.push(`URL: ${pageContext.url}`);

    const systemPrompt = `You are an expert job application assistant. You will receive a list of form fields from a job application page and the candidate's resume. For each field, generate the best answer using ONLY the candidate's real experience. Be specific, honest, and concise. For name fields use the candidate's name. For contact fields use their contact info. For short fields (name, city, phone, etc.) give just the value. For longer questions give 1-4 sentences.

CRITICAL: NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any AI tool/app the candidate may have built. For non-tech roles, draw ONLY from professional work experience at real employers — no side projects or personal apps.
Joshua is conversational in Spanish but NOT fluent. If Spanish skills are relevant, say "conversational Spanish" — NEVER claim fluency or bilingual status.
Metrics must match the correct role: 731 units/5.0 rating/261 reviews = A-AAAKey Mini Storage ONLY; 98% on-time delivery = Green Cuisine ONLY; 30+ leads/week & 20% consultation increase = HVAC ONLY; 12% fuel reduction = Fleet Manager ONLY. Never mix metrics between roles.

Return a JSON array where each element corresponds to a field in order:
[{"fieldIndex": 0, "answer": "..."}, {"fieldIndex": 1, "answer": "..."}, ...]

Return ONLY valid JSON, no markdown, no explanation.`;

    const batchVoice = getActiveVoiceText(profile);
    let userContent = `${contextParts.join('\n')}\n\n---\nForm Fields:\n${fieldDescriptions}\n\n---\nCandidate Resume:\n${profile.text}`;
    if (batchVoice) {
      userContent += `\n\n---\nVOICE PROFILE — Sound like this person:\n${batchVoice}`;
    }

    const raw = await callOpenAI(systemPrompt, userContent, 'Batch Answer Generation');
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const answers = JSON.parse(cleaned);

    // Save each answer to the library
    const results = answers.map(a => {
      const field = fields[a.fieldIndex] || {};
      const entry = {
        id: `ans-${Date.now()}-${a.fieldIndex}`,
        question: field.label || field.placeholder || `Field ${a.fieldIndex + 1}`,
        answer: a.answer,
        category: 'other',
        pageContext: pageContext || {},
        profileId: profile.id,
        profileName: profile.name,
        profileEmoji: profile.emoji,
        versions: [{ answer: a.answer, generatedAt: new Date().toISOString() }],
        selectedVersion: 0,
        similarPreviousId: null,
        generatedAt: new Date().toISOString()
      };
      answerLibrary.unshift(entry);
      return { fieldIndex: a.fieldIndex, answer: a.answer, id: entry.id };
    });

    saveAnswers();
    console.log(`[Server] Batch complete: ${results.length} answers generated`);
    res.json({ results });
  } catch (err) {
    console.error('[Server] Batch answer failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Cover Letter Version Selection ──

app.post('/history/:id/select-cover-letter-version', (req, res) => {
  const entry = optimizationHistory.find(h => h.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Optimization not found' });
  if (!entry.coverLetterVersions?.length) return res.status(400).json({ error: 'No versions available' });

  const { version } = req.body;
  if (version < 0 || version >= entry.coverLetterVersions.length) {
    return res.status(400).json({ error: 'Invalid version' });
  }

  entry.selectedCoverLetterVersion = version;
  entry.coverLetterText = entry.coverLetterVersions[version].text;
  entry.tone = entry.coverLetterVersions[version].tone;
  saveHistory();

  console.log(`[Server] Cover letter version selected: ${entry.id} → v${version}`);
  res.json({ success: true, coverLetterText: entry.coverLetterText });
});

// ── Auto-Archive Old Answers (>30 days) ──

function archiveOldAnswers() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let archived = 0;
  answerLibrary.forEach(a => {
    if (!a.archived && a.generatedAt < thirtyDaysAgo) {
      a.archived = true;
      archived++;
    }
  });
  if (archived > 0) {
    saveAnswers();
    console.log(`[Server] Auto-archived ${archived} answers older than 30 days`);
  }
}

// ── Claude-Powered Feedback Refinement ──

app.post('/refine-with-feedback', async (req, res) => {
  const { originalOutput, feedback, type, context } = req.body;
  console.log('[Server] ── Refine with Feedback ──');
  console.log(`[Server] Type: ${type}, Feedback: ${feedback?.substring(0, 100)}`);

  if (!originalOutput || !feedback) {
    return res.status(400).json({ error: 'Original output and feedback are required' });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return res.status(400).json({ error: 'No active profile' });
  }

  const voiceText = getActiveVoiceText(profile);

  try {
    let refinedInstructions;

    if (anthropic) {
      const claudeMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are a writing coach who interprets human feedback and translates it into precise instructions for a content generator. You understand nuance — when someone says "too stiff" they mean use shorter sentences and contractions. When they say "sound more like me" they mean match the voice profile. When they say "lead with San Antonio" they mean restructure to open with that experience.

Your job: read the original output, the user's feedback, the candidate's voice profile, and their resume. Then return CLEAR, SPECIFIC rewriting instructions that another AI can follow exactly. Be precise about what to change, what to keep, and what tone to hit.

Return ONLY the rewriting instructions, nothing else.`,
        messages: [{
          role: 'user',
          content: `ORIGINAL OUTPUT:\n${originalOutput}\n\nUSER FEEDBACK:\n${feedback}\n\n${voiceText ? `VOICE PROFILE:\n${voiceText}\n\n` : ''}RESUME:\n${profile.text.substring(0, 3000)}`
        }]
      });

      refinedInstructions = claudeMessage.content[0].text;
      console.log('[Server] Claude refined instructions generated');
    } else {
      refinedInstructions = `The user gave this feedback on the previous output: "${feedback}". Rewrite the output to address this feedback while keeping it honest and based on real resume experience.`;
      console.log('[Server] Claude unavailable, using direct feedback passthrough');
    }

    const systemPrompt = type === 'cover_letter'
      ? `${PROMPTS.coverLetter.replace('[TONE_SELECTION]', context?.tone || 'Professional')}\n\nREFINEMENT INSTRUCTIONS (from user feedback — follow these precisely):\n${refinedInstructions}`
      : `You are an expert job application assistant. Generate a refined answer based on the instructions below. Use only real experience from the resume. 2-4 sentences. NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", or any AI tool.\n\nREFINEMENT INSTRUCTIONS:\n${refinedInstructions}`;

    const userParts = [];
    if (type === 'cover_letter' && context) {
      userParts.push(`Candidate Name: ${context.candidateName || extractCandidateName(profile.text)}`);
      userParts.push(`Company Name: ${context.companyName || 'the company'}`);
      userParts.push(`Job Title: ${context.jobTitle || 'the position'}`);
      if (context.jobDescription) userParts.push(`\n---\nJob Description:\n${context.jobDescription}`);
    } else if (context?.question) {
      userParts.push(`Question: ${context.question}`);
    }
    userParts.push(`\n---\nPrevious Output (to refine):\n${originalOutput}`);
    userParts.push(`\n---\nCandidate Resume:\n${profile.text}`);
    if (voiceText) userParts.push(`\n---\nVoice Profile:\n${voiceText}`);

    const refined = await callOpenAI(systemPrompt, userParts.join('\n'), 'Feedback Refinement');

    let cleanedOutput = refined.replace(/```\n?/g, '').trim();
    if (type === 'cover_letter') {
      const candidateName = context?.candidateName || extractCandidateName(profile.text);
      cleanedOutput = replacePlaceholders(cleanedOutput, candidateName, context?.companyName || '', context?.jobTitle || '');
    }

    console.log('[Server] Refined output generated successfully');
    res.json({
      refined: cleanedOutput,
      usedClaude: !!anthropic,
      instructions: refinedInstructions
    });
  } catch (err) {
    console.error('[Server] Feedback refinement failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// SPA catch-all: serve frontend for any route not handled by the API
if (fs.existsSync(FRONTEND_BUILD)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
  });
}

// ── Start Server ──
loadPersistedData();
archiveOldAnswers();

const hasFrontend = fs.existsSync(FRONTEND_BUILD);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] ══════════════════════════════════════════`);
  console.log(`[Server] Indeeeed Optimizer API running on port ${PORT}`);
  console.log(`[Server] PORT=${PORT} (from ${process.env.PORT ? 'env' : 'default'})`);
  console.log(`[Server] Frontend: ${hasFrontend ? 'serving from build' : 'not built (API-only mode)'}`);
  console.log(`[Server] CORS: origin=*`);
  console.log(`[Server] Health:  http://0.0.0.0:${PORT}/health`);
  console.log(`[Server] Profiles: ${profiles.length} (active: ${getActiveProfile()?.name || 'none'})`);
  console.log(`[Server] History: ${optimizationHistory.length} entries`);
  console.log(`[Server] Answers: ${answerLibrary.length} entries`);
  console.log(`[Server] ══════════════════════════════════════════`);
});
