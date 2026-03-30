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
  'a simple, honest connection between their past work and this role',
  'a quiet confident statement about what they know how to do',
  'a real detail from the job posting that caught their eye',
  'a short sentence about what this kind of work means to them',
  'a plain-spoken observation about the industry',
  'a grounded reflection on a real challenge they handled',
  'a callback to something specific in the job posting',
];
const MUSE_RHYTHMS = [
  'Plain, clear sentences. Like someone explaining their experience to a friend.',
  'Conversational cadence — relaxed, natural, not trying to impress.',
  'Mix of short and medium sentences. No long-winded paragraphs.',
  'Measured and honest. Every sentence earns its place.',
  'Warm and direct. Says what it means without dressing it up.',
];
const MUSE_VIBES = [
  'your reliable coworker who just does their job well and everyone respects them',
  'someone who has been through some things and came out steady',
  'the person at the interview who doesn\'t try to impress — they just are impressive',
  'a seasoned worker who lets their track record do the talking',
  'someone who is grateful for the opportunity but knows what they bring to the table',
  'a real person writing a real letter at their kitchen table',
  'the candidate the hiring manager remembers because they sounded genuine',
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
      system: `You are a voice coach for cover letters. Your job is to give simple, grounded direction that helps another AI write like a REAL PERSON — not like an AI trying to be creative.

CRITICAL RULES:
- NEVER suggest dramatic metaphors, surgical imagery, or overwrought language.
- NEVER suggest words like "hemorrhaging," "tumor," "ground zero," "paradigm," "synergy," "diagnostic mindset," or any word a normal person wouldn't say at a kitchen table.
- NEVER suggest the letter try to be clever. Simple and honest beats creative and forced.
- The goal is a letter that sounds like a real human being wrote it. Someone with a life, bills, and real experience.

Produce 5-8 bullet points covering:
- LENGTH: Under 200 words total body. No fourth paragraph, no resume recap.
- CLOSING: The letter should end with one short memorable original line (not a fake famous quote) tying to logic, problem-solving, or kindness in everyday work.
- PUNCH: Where to land rhythm; mix very short sentences with normal ones.
- ENDEARING: Thoughtful, kind professional, quietly proud — warmth or light humor, never needy or corporate.
- Emotional register: Grounded. Warm but not syrupy. Confident but not cocky.
- Which ONE real experience to lead with and a simple reason why it connects to this job.
- What kind of plain, honest opening to use — no dramatic hooks, just a real sentence.
- Sentence style: Plain language. Short sentences. No thesaurus words.
- What to AVOID: long paragraphs, dramatic metaphors, corporate buzzwords, try-hard creativity, forced cleverness.
- The vibe: Someone you'd want on the team — real, brief, human.`,
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

async function autoSelectVoiceText(profile, jobContext) {
  if (!profile?.voiceProfiles?.length) return '';
  const filledSlots = profile.voiceProfiles.filter(vp => vp.text && vp.text.trim().length > 20);
  if (filledSlots.length === 0) return '';
  if (filledSlots.length === 1) return filledSlots[0].text;

  if (profile.voiceAutoSelect === false) {
    console.log('[Server] Voice auto-select OFF — using manually selected slot');
    return getActiveVoiceText(profile);
  }

  const slotSummaries = filledSlots.map(vp => {
    const targeting = (vp.text || '').match(/ROLES I'M TARGETING[\s\n]+([^\n-][^\n]+)/)?.[1]?.trim() || '';
    const identity = (vp.text || '').match(/CORE IDENTITY[\s\n]+([^\n-][^\n]+)/)?.[1]?.trim() || '';
    return `Slot "${vp.name}" (id: ${vp.id}): ${targeting || identity || '(general purpose)'}`.substring(0, 250);
  }).join('\n');

  try {
    const pick = await callOpenAI(
      `You are a voice profile selector that can also BLEND voices. Given a job context and available voice profile slots, decide the best voice strategy.

You have two options:
OPTION A — Single voice: If one slot clearly matches, return just its id.
OPTION B — Blend: If the job benefits from combining two voices (e.g., a tech-forward sales role could blend "Tech" + "Default"), return both ids with a blend instruction.

Format for single: SINGLE:<slot_id>
Format for blend: BLEND:<primary_id>|<secondary_id>|<one sentence describing how to blend them>

Rules:
- Property management, leasing, storage, facilities → Conversational or Default
- Tech, developer, software, AI, engineering → Tech
- Sales, customer service, CSR, medical → Default
- Creative, startup, relaxed → casual/dude slot
- Hybrid roles (e.g. "technical sales", "operations + tech") → BLEND the two most relevant voices
- When blending, the primary voice sets the base tone, secondary adds flavor
- If unsure, pick the default or first slot as SINGLE`,
      `Job context: ${jobContext.substring(0, 500)}\n\nAvailable voice slots:\n${slotSummaries}`,
      'Voice Auto-Select'
    );

    const result = pick.trim();

    if (result.startsWith('BLEND:')) {
      const parts = result.substring(6).split('|');
      if (parts.length >= 2) {
        const primary = filledSlots.find(vp => vp.id === parts[0].trim());
        const secondary = filledSlots.find(vp => vp.id === parts[1].trim());
        const blendNote = parts[2]?.trim() || 'Blend both voices naturally';
        if (primary && secondary) {
          console.log(`[Server] Voice BLEND: "${primary.name}" + "${secondary.name}" — ${blendNote}`);
          return `=== PRIMARY VOICE: "${primary.name}" ===\n${primary.text}\n\n=== SECONDARY VOICE: "${secondary.name}" (blend in selectively) ===\n${secondary.text}\n\n=== BLEND DIRECTION: ${blendNote} ===`;
        }
      }
    }

    const singleId = result.startsWith('SINGLE:') ? result.substring(7).trim() : result.trim();
    const matched = filledSlots.find(vp => vp.id === singleId);
    if (matched) {
      console.log(`[Server] Auto-selected voice profile: "${matched.name}"`);
      return matched.text || '';
    }
  } catch (err) {
    console.warn('[Server] Voice auto-select failed, using active slot:', err.message);
  }

  return getActiveVoiceText(profile);
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

  resumeRewrite: `You are an expert resume strategist.

###############################################################
# KEYWORD REQUIREMENTS — YOU WILL BE SCORED ON THIS           #
###############################################################
Your output will be automatically scored against the provided keyword list.
- You MUST achieve a **70-77% keyword match rate**
- You MUST include **AT LEAST 11 of the 15 provided keywords**
- If your score is below 70%, you have FAILED

WHERE TO PUT KEYWORDS:
1. SKILLS SECTION: List 8-12 relevant skills using exact keywords from the list
2. SUMMARY: Include 3-4 keywords naturally in 2-3 sentences  
3. BULLET POINTS: Each role should contain 2-3 keywords woven into achievements

KEYWORD INTEGRATION CHECKLIST (do this before outputting):
□ Count how many keywords you used — is it at least 11?
□ Check the skills section — does it contain keywords from the list?
□ Check the summary — does it contain keywords?
□ Check each role's bullets — do they contain keywords?

If you cannot hit 11+ keywords, you are not trying hard enough. Every keyword CAN fit somewhere if you write creatively.
###############################################################

PROSE QUALITY — ALSO REQUIRED:
- Sound like a real person, not a corporate drone
- Vary sentence rhythm — short punchy lines mixed with longer ones
- Show personality: dry humor, wry observations, unexpected turns of phrase
- NO banned words: leveraged, utilized, spearheaded, facilitated, synergy, dynamic, robust, results-driven

The goal is BOTH: 70%+ keyword match AND excellent human prose.

CRITICAL RULES — EVERY ROLE MUST BE INCLUDED:
- The master resume contains MANY different job roles. You MUST include ALL of them in your output. NEVER drop a role.

ORDERING (read top to bottom — this overrides generic “most relevant first” if they conflict):
- **Management / supervisory / lead roles first:** Any role where the candidate managed people, ran a site or operation as the lead, or owned team outcomes should appear **before** individual-contributor roles, **when both are in the same section**. Among manager/lead roles, order by **relevance to the target job** (strongest match first).
- **Then most relevant non-manager roles:** After leads/managers, order remaining roles by **relevance to the target job** (most relevant next, then downward).
- Tie-breakers when relevance is similar (still respect manager-first above): Storage/facility management roles usually sit lower unless the target job is specifically about facilities, property, or storage management. For **customer service** targets, favor roles with direct customer/client interaction. For **logistics/operations** targets, favor Fleet Manager, delivery/ops, production runner, storage leadership when relevant. For **administrative/office** targets, favor admin, CS, and coordination-heavy roles.

Split into TWO groups:
- "experience" — The **primary** roles for this application (typically **3–5 roles**, but use more slots if needed so **no** strong management role is buried just to hit a number). **Prioritize management/supervisory/lead roles here** when they belong in the spotlight; fill remaining slots with the next-most-relevant roles. Give **about 3 substantive bullets per role** (add a **4th** when a metric or scope detail must stay).
- "additionalExperience" — **ALL REMAINING** roles, same ordering rules (managers/leads before ICs where applicable, then by relevance). Typically **2 bullets per role**; add a **3rd** when needed so facts are not lost. Weave keywords where natural.

LENGTH — NO ARTIFICIAL CAP:
- Use **as much space as the content needs**. Do **not** shorten, compress, or strip substance to hit a word count. If you must choose between filler and a **real metric**, keep the metric.

ADDITIONAL RULES:
- Start bullets with strong plain verbs — managed, delivered, built, resolved, coordinated, maintained, handled, ran, kept.
- Keep quantifiable achievements where they exist. Real numbers beat keyword stuffing.
- Keep all facts true — do not invent experience or skills.
- NEVER mention "Indeeeed Optimizer", "Indeeeed", "Rio Brave", "Rio Brave LLC", or any personal AI tool/app/software the candidate built UNLESS the target job is explicitly in software development, AI, tech, or engineering.
- NEVER invent metrics or scenarios. Each metric belongs to ONE role only — never mix them:
  • 731 units, 5.0 Google rating, 261 reviews → A-AAAKey Mini Storage ONLY
  • 98% on-time delivery rate → Green Cuisine medical delivery ONLY
  • 30+ leads/week → HVAC Lead Generator ONLY
  • 12% fuel reduction → Fleet Manager ONLY
  • 20% consultation increase → HVAC Lead Generator ONLY
  No other numbers exist. Never attribute a metric to the wrong company.
- Joshua is conversational in Spanish but NOT fluent. If Spanish language skills are relevant to the role, list them as "conversational Spanish" or "working knowledge of Spanish." NEVER claim fluency, bilingual status, or "fluent in Spanish."

SKILLS ARRAY RULES:
- Generate 9-12 skills for the "skills" array. These appear in a "Core Competencies" block on the resume.
- Pull terms DIRECTLY from the job description wherever the candidate has genuine matching experience.
- Use the job posting's EXACT phrasing — if they say "client relations" don't write "customer relationship management."
- Mix hard skills (software, tools, certifications) with transferable soft skills (conflict resolution, team leadership).
- These skills must be real — never claim a skill the candidate doesn't have.

DATES — REQUIRED FOR EVERY ROLE:
- Every role MUST include a "dates" field with the employment period from the master resume.
- Use the EXACT dates from the master resume. Do not guess or fabricate dates.
- Format: "Month Year — Month Year" or "Year — Year" or "Year — Present" — whatever the master resume uses.
- If the master resume shows approximate dates (like "~2018"), keep the approximation.
- NEVER omit dates. Recruiters flag dateless resumes.

EDUCATION — REQUIRED WHEN PRESENT IN MASTER RESUME:
- If the master resume contains an education section, you MUST include it in your output in a new "education" array.
- NEVER omit education. If the candidate has a Bachelor's degree or higher, it is a key qualifier and must appear on every resume.
- For candidates with international education (study abroad, exchange programs, dual degrees), ALWAYS include both institutions. Example: Bachelor's degree from San Diego State University AND exchange program at KEDGE Business School, France — both are differentiators.
- Placement: For professional roles with 5+ years experience, place education after additionalExperience. For entry-level roles or roles where the degree is a primary qualifier (teaching, research, international business), place education near the top in the JSON (it will render prominently).
- Format each entry as: {"degree": "Bachelor of Arts in Communication", "institution": "San Diego State University", "location": "San Diego, CA", "dates": "Aug 2011 — Aug 2014"}
- For exchange programs or study abroad, create a separate entry: {"degree": "Exchange Program — Business Studies", "institution": "KEDGE Business School", "location": "Marseille, France", "dates": "Sep 2013 — May 2014"}

Return ONLY valid JSON with keys: summary, skills, experience, additionalExperience, education (if present in master resume).

Expected format:
{"summary": "...", "skills": ["skill1", "skill2", ...], "experience": [{"role": "...", "company": "...", "dates": "2022 — Aug 2025", "bullets": ["...", "...", "..."]}], "additionalExperience": [{"role": "...", "company": "...", "dates": "2018 — 2022", "bullets": ["...", "..."]}], "education": [{"degree": "Bachelor of Arts in Communication", "institution": "San Diego State University", "location": "San Diego, CA", "dates": "Aug 2011 — Aug 2014"}]}`,

  coverLetter: `You are writing a cover letter for a real person. Not a template. Not a keyword dump. A letter from someone with a life, with bills, with gratitude for what they've built and quiet confidence in what they can do next. Tone: [TONE_SELECTION].

THE SOUL OF THIS LETTER:
This person is not desperate. They are not begging. They are someone who has worked hard, learned real things in real places, and is offering that experience to a company that needs it. The letter should read like it was written by someone who respects the reader's time, understands the work, and has genuine appreciation for the opportunity — without groveling. Confident but grounded. Grateful but not needy. Human above all.

OPENING HOOK: Start with something real and grounded — a simple connection between the candidate's experience and this role. NEVER open with "I am writing to apply" or any generic opener. But also NEVER open with dramatic metaphors, overwrought imagery, or try-hard creative writing. No "hemorrhaging," no "tumors," no "ground zero." Just a clear, honest first sentence that makes the reader want to keep going.

VOICE: Write like a real person sat down at their kitchen table and wrote this. Plain language. No thesaurus words. No corporate buzzwords like "systems thinking," "diagnostic mindset," "paradigm," or "synergy." If a normal person wouldn't say it out loud to a friend, don't write it. Short sentences are fine. Contractions are fine. The goal is a letter that sounds like it was written by a human being, not an AI trying to sound impressive.

Write like a real person talking about their work, not a corporate document. Avoid buzzwords like 'leveraged,' 'utilized,' 'spearheaded,' 'dynamic,' and 'synergy.' Use plain direct language. Short sentences over long ones. Real words over impressive ones.

CRITICAL — DO NOT SOUND LIKE AI:
The biggest failure mode is sounding artificial. Read your output back. If any sentence sounds like it came from a language model, rewrite it.

BANNED WORDS AND PHRASES — never use these:
"honed," "culminating," "fostering," "leveraging," "paramount," "seamlessly," "multifaceted," "spearheaded," "synergy," "endeavor," "utilize," "facilitated," "orchestrated," "navigated" (unless about actual navigation), "landscape," "ecosystem," "stakeholders," "deep dive," "holistic," "robust," "diverse sectors," "dynamic environment," "fast-paced environment," "cutting-edge," "track record of success," "proven ability," "passion for excellence," "aligns seamlessly," "uniquely positioned," "I am confident that," "I believe my skills," "I am eager to," "I am drawn to," "intrigued by the opportunity"

USE THESE INSTEAD:
- Instead of "honed my ability" → "I got good at" or "I learned how to"
- Instead of "culminating in" → just state the result directly
- Instead of "diverse sectors" → name the actual sectors
- Instead of "navigated high-pressure environments" → "handled tough situations"
- Instead of "fostering relationships" → "building trust with people"
- Instead of "leveraging my experience" → "using what I've learned"
- Instead of "I am confident that" → just state the thing confidently

EXAMPLES OF GOOD vs BAD:
BAD: "My experience across diverse sectors has honed my ability to foster client relationships and navigate complex operational challenges."
GOOD: "I've managed a 731-unit storage facility, delivered medical supplies to 15 clinics, and generated 30 leads a week in HVAC sales. Different jobs, same skill — figuring out what people need and making sure they get it."

BAD: "I am intrigued by the unique operational challenges your organization faces and am eager to apply my diagnostic mindset."
GOOD: "Your job posting mentions handling escalations and resolving disputes — I did that every day for three years at a storage facility with 731 tenants."

BAD: "Culminating in a 5.0 Google rating with 261 reviews, my tenure demonstrated a commitment to excellence."
GOOD: "When I left, the facility had a 5.0 Google rating and 261 reviews. That didn't happen by accident."

Write like the GOOD examples. If your output looks like the BAD examples, you have failed.

TONE GUIDE:
- Professional: Polished but still warm. Measured language, clear respect for the reader.
- Confident: Leads with what they bring. Not arrogant — earned.
- Conversational: Like talking to someone you respect over coffee. Contractions, natural flow.
- Casual: Relaxed, real talk, zero corporate speak. Still shows you're good at what you do.
- Funny: Dry wit, self-aware charm. Makes the reader smile. Still gets hired.
- Fun: Upbeat, genuine energy. The "I'd want to work with this person" letter.
- Storyteller: Opens with a real moment. Arc from challenge to what it taught them.
- Bold: High-conviction. "You need someone who can handle this — I already have."
- Warm: People-first. Emphasizes teamwork, trust, community. Heart visible.
- Direct: No filler. Short sentences. Respects the reader's time completely.
- Enthusiastic: Genuinely excited. Shows they actually looked into the company.

LENGTH & STRUCTURE (NON-NEGOTIABLE):
- Your output is ONLY the letter body. The DOCX template adds **once each**: today's date, the line **Dear Hiring Manager,**, and **Sincerely,** plus the candidate's name. Do NOT put a date, "Dear Hiring Manager," "Dear [name]," "Sincerely," or the candidate's name in your output — any duplicate breaks the letter.
- **Exactly 3 paragraphs maximum**, separated by a **blank line** between paragraphs. If you write a 4th paragraph, you have failed.
- **150–200 words total** for the body only. Count every word; stay inside this range.
- Do not repeat the same paragraph, hook, or closing twice. No duplicate sections.

VOICE — WARM, WITTY, UNFORGETTABLE:
- Sound like a **thoughtful professional with a quiet spark** — someone who notices things, thinks about their work, and has a point of view.
- **Prose that breathes:** Vary your rhythm. Short sentence. Then a longer one that unfolds a bit. Let the reader feel the cadence.
- **Wit, not jokes:** A wry observation. A turn of phrase that lands. "I've managed 731 storage units and 731 different definitions of 'I'll pay you next week.'" Not ha-ha funny — smile-and-keep-reading funny.
- **Specificity is charm:** "I like the moment when someone walks in frustrated and leaves smiling" beats "I'm passionate about customer service." Show, don't tell.
- **One vulnerable truth:** A brief honest moment — "I've swept floors at 2am and opened the office at 8am the next morning," or "The 5.0 rating didn't happen by accident — it happened because I showed up every day even when I didn't want to."
- **Write like someone who reads books, not LinkedIn posts.** Every sentence should feel considered. If it sounds like a template, kill it.

CONTENT:
- One strong achievement with a real number from the resume (not a resume dump).
- One clear tie to this role. Weave the job’s important phrases in **naturally** — as if they belong in conversation — never a checklist or forced keyword stack.

- **Paragraph 3:** One brief beat about the company, the role, or why the work matters — warm, specific, not corporate. Then end with **one short memorable line** (your own words; no fake quotes) that ties together **who they are as a person** — a line about clear thinking, showing up, problem-solving, or kindness in everyday work. Under ~25 words. Should feel like a closing thought that lingers.

Do NOT use only "Thank you for your consideration" as the ending. Do NOT add "Sincerely" or a name after that line — the template adds the signature once.

WHAT MAKES A LETTER UNFORGETTABLE:
- **Specificity is everything:** "I managed 731 units in a neighborhood where the police knew me by name" beats "I have extensive experience."
- **Honest bridges with charm:** "My property management background is in storage, not apartments — but tenants are tenants, and the ones who don't pay their rent all have the same look on their face."
- **Small human moments that land:** "The best part of the job was watching someone drive away with their stuff after I helped them through a rough month" beats "I am passionate about helping people."
- **Quiet confidence, not performance:** "I've done this work. I can do it here." One sentence. No elaboration needed.
- **A closing line they'll remember tomorrow:** Something true about how you work or what you believe. "Good work is just showing up when it's hard and doing it anyway." "The best customer service is figuring out what someone needs before they ask twice." "I've learned that most problems solve themselves if you just stay calm and stay present." Make it sound like hard-won wisdom, not a motivational poster.

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
- Never duplicate a sign-off inside the body. Do NOT include the date, "Dear Hiring Manager,", "Sincerely,", or the candidate's name in your output — the template adds them exactly once.

FORMATTING RULES:
- Use the candidate's REAL NAME from their resume where it fits naturally in the body — NEVER write [Your Name] or [Candidate Name]. Do not add a standalone signature line or printed name; the template adds "Sincerely, [name]" once.
- Use the REAL COMPANY NAME provided — NEVER write [Company Name] or [Employer's Name]
- Use the REAL JOB TITLE provided — NEVER write [Job Title] or [Position]
- NEVER write [Date] or [Today's Date] — the template supplies the date
- NEVER use placeholder brackets like [ ] anywhere in the output

Return only the three body paragraphs (blank line between each), no placeholders.`
};

// ── OpenAI Calls ──
async function callOpenAI(systemPrompt, userContent, label, options = {}) {
  const maxTokens = options.maxTokens ?? 4000;
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
      max_tokens: maxTokens
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
  content += `\n\n---\nLENGTH: No target word count — use as much space as needed for every role and every important fact.\nORDER: Management/lead roles first (by relevance), then other roles by relevance.\n`;
  content += `\n---\n###############################################################
# SCORE TARGET: 70-77% — USE AT LEAST 11 OF THESE 15 KEYWORDS #
###############################################################

KEYWORDS TO USE (you will be scored on how many appear in your output):
${keywordList}

PHRASES TO USE (exact multi-word matches):
${phraseList}

REMINDER: Put keywords in SKILLS, SUMMARY, and BULLET POINTS. Count them before submitting — you need 11+.
###############################################################`;
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
    retryInstruction ? 'Resume Rewrite (retry)' : 'Resume Rewrite',
    { maxTokens: 8192 }
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

async function generateInsightSnippet(jobDescription, companyName, jobTitle) {
  try {
    const raw = await callOpenAI(
      `You are a company research specialist. From the job description and company name provided, extract one specific, human insight about this company or role — something that shows genuine understanding of what they do, who they serve, or why this work matters to real people.

Rules:
- Return ONLY 1-2 sentences. Nothing else.
- Draw from concrete details in the job description: location, community served, industry, mission hints, specific responsibilities.
- If the company name is recognizable, reference what they're known for.
- If location is mentioned, connect to the local community.
- Make it feel like the candidate actually researched this company — not a generic line that could apply anywhere.
- NEVER fabricate facts about the company. Only use what's in the job description or clearly implied by the company name.
- Do NOT write in first person. Write it as a factual observation.

Examples of good output:
- "RATP Dev USA operates transit systems that communities in Ventura County depend on daily — reliability isn't abstract here, it's someone making it to work on time."
- "Green Thumb Industries has built its reputation on quality-controlled cultivation at scale — precision and consistency define every role in their operation."
- "This warehouse serves as the backbone of a regional supply chain, where accurate inventory processing directly impacts delivery timelines for thousands of customers."`,
      `Company: ${companyName}\nJob Title: ${jobTitle}\n\nJob Description:\n${jobDescription}`,
      'Insight Snippet'
    );
    const snippet = raw.trim().replace(/^["']|["']$/g, '');
    console.log(`[Server] Insight snippet generated: "${snippet.substring(0, 80)}..."`);
    return snippet;
  } catch (err) {
    console.warn('[Server] Insight snippet failed, skipping:', err.message);
    return '';
  }
}

async function generateCoverLetter(jobDescription, resumeSummary, keywords, tone = 'Professional', meta = {}) {
  let prompt = PROMPTS.coverLetter.replace('[TONE_SELECTION]', tone);
  const candidateName = meta.candidateName || extractCandidateName(meta.resumeText || '');
  const companyName = meta.companyName || 'the company';
  const jobTitle = meta.jobTitle || 'the position';
  const personalNote = meta.personalNote || '';
  const voiceText = meta.voiceText || '';
  const keywordList = (keywords.keywords || []).map(k => k.keyword).join(', ');
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  // ── Parallel: Claude Muse + Insight Snippet ──
  const [museDirection, insightSnippet] = await Promise.all([
    claudeMuse(
      tone,
      voiceText,
      `Cover letter for ${jobTitle} at ${companyName}. Resume summary: ${resumeSummary?.substring(0, 200) || 'N/A'}`
    ),
    generateInsightSnippet(jobDescription, companyName, jobTitle)
  ]);

  if (museDirection) {
    prompt += `\n\nCREATIVE DIRECTION FROM WRITING DIRECTOR (follow this closely — it defines the voice and character of this specific letter):\n${museDirection}`;
  }
  if (insightSnippet) {
    prompt += `\n\nCOMPANY/JOB INSIGHT (weave this naturally into the letter — do not quote verbatim, adapt it to fit the voice):\n${insightSnippet}`;
  }

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
    `Relevant terms from the job (use naturally where they fit — do NOT force them):`,
    keywordList
  );

  const userContent = contentParts.join('\n');

  const raw = await callOpenAI(prompt, userContent, 'Cover Letter Generation', { maxTokens: 550 });

  let cleaned = raw.replace(/```\n?/g, '').trim();
  cleaned = replacePlaceholders(cleaned, candidateName, companyName, jobTitle);

  console.log('[Server] Cover letter post-processed — remaining brackets:', (cleaned.match(/\[[^\]]+\]/g) || []).length);
  return { text: cleaned, letterDate: today };
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
      activeVoiceProfileId: p.activeVoiceProfileId || null,
      voiceAutoSelect: p.voiceAutoSelect !== false
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
    activeVoiceProfileId: profile.activeVoiceProfileId || null,
    voiceAutoSelect: profile.voiceAutoSelect !== false
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
  profile.voiceAutoSelect = false;
  saveProfiles();

  console.log(`[Server] Active voice profile: "${slot.name}" for ${profile.name} (manual mode)`);
  res.json({ success: true, activeVoiceProfileId: slot.id, voiceAutoSelect: false });
});

app.post('/profiles/:id/voice-auto-select', (req, res) => {
  const profile = profiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const enabled = req.body.enabled !== false;
  profile.voiceAutoSelect = enabled;
  saveProfiles();

  console.log(`[Server] Voice auto-select: ${enabled ? 'ON' : 'OFF'} for ${profile.name}`);
  res.json({ success: true, voiceAutoSelect: enabled });
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

  const MATCH_THRESHOLD = 75; // Target 75-77% — aiming for 77
  const MATCH_CEILING = 77;   // STOP HERE — the sweet spot
  const MAX_RETRIES = 3;      // Keep trying until we hit 77

  const retryStrategies = [
    {
      name: 'Skills section keyword boost',
      instruction: `IMPORTANT: Keep the EXACT resume you just wrote, but ADD more keywords to the SKILLS section only. List 12-15 skills using exact terms from the keyword list. Do NOT rewrite the bullets or summary — just expand the skills.`
    },
    {
      name: 'Add keywords to existing bullets',
      instruction: `IMPORTANT: Keep the EXACT structure and content, but find 4-5 bullets where you can swap in a keyword synonym. Example: if "customer service" is a keyword and you wrote "helped guests", change it to "provided customer service to guests". Minimal changes, maximum keyword hits.`
    },
    {
      name: 'Summary keyword push',
      instruction: `IMPORTANT: Keep the bullets as-is, but rewrite the SUMMARY to pack in 5-6 keywords naturally. Also check the skills list — can you add 2-3 more? We need to hit 77%.`
    }
  ];

  try {
    // Step 0: Auto-select best voice profile for this job
    const jobContext = `${jobTitle || ''} at ${companyName || ''}: ${fullDescription.substring(0, 300)}`;
    const voiceText = await autoSelectVoiceText(masterResume, jobContext);

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
        if (bestResult) {
          console.log(`[Server] All retries failed but we have a valid result from earlier (score: ${bestScore}%). Using that.`);
          break;
        }
        throw parseErr;
      }

      // Score it
      const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
      console.log(`[Server] Attempt ${attempt + 1} score: ${scoring.matchScore}% (target: ${MATCH_THRESHOLD}-${MATCH_CEILING}%)`);
      attemptsMade = attempt + 1;

      // Check if score is in the sweet spot (65-75%) — STOP HERE, this is ideal
      const inSweetSpot = scoring.matchScore >= MATCH_THRESHOLD && scoring.matchScore <= MATCH_CEILING;
      const overOptimized = scoring.matchScore > MATCH_CEILING;

      if (overOptimized) {
        console.log(`[Server] ⚠️ Score ${scoring.matchScore}% is OVER-OPTIMIZED (>${MATCH_CEILING}%). Keeping but not ideal.`);
      }

      // Accept this result if: it's in the sweet spot, OR it's better than what we have
      // But prefer sweet spot scores over higher scores
      const shouldAccept = !bestResult || 
        (inSweetSpot && bestScore > MATCH_CEILING) || // Sweet spot beats over-optimized
        (inSweetSpot && !bestResult) ||
        (scoring.matchScore > bestScore && bestScore < MATCH_THRESHOLD); // Only chase higher if below threshold

      if (shouldAccept || scoring.matchScore > bestScore) {
        bestScore = scoring.matchScore;

        // Generate cover letter for this version
        const { text: coverLetterText, letterDate } = await generateCoverLetter(
          fullDescription,
          rewrittenResume.summary,
          keywords,
          selectedTone,
          {
            candidateName: extractCandidateName(masterResume.text),
            companyName: companyName || 'the company',
            jobTitle: jobTitle || 'the position',
            resumeText: masterResume.text,
            voiceText
          }
        );

        bestResult = { rewrittenResume, coverLetterText, letterDate, scoring };
      }

      // STOP if we're in the sweet spot — don't try to go higher
      if (inSweetSpot) {
        console.log(`[Server] ✅ Score ${scoring.matchScore}% is in sweet spot (${MATCH_THRESHOLD}-${MATCH_CEILING}%). Perfect!`);
        break;
      }

      // Also stop if we're already over-optimized — retrying will only make it worse
      if (overOptimized) {
        console.log(`[Server] Stopping — already over threshold, more attempts would over-optimize.`);
        break;
      }
    }

    const { rewrittenResume, coverLetterText, letterDate, scoring } = bestResult;
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

    const keywordSpecs = keywords.keywords || [];

    await generateResumeDOCX(rewrittenResume, keywordSpecs, jobTitle, companyName, resumeFilePath, masterResume.text);
    await generateResumePDF(rewrittenResume, keywordSpecs, resumePdfFilePath, masterResume.text);
    await generateCoverLetterDOCX(coverLetterText, keywordSpecs, jobTitle, companyName, coverLetterFilePath, extractCandidateName(masterResume.text), letterDate);
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

// Shake & Bake — re-optimize an existing optimization for a better score
app.post('/re-optimize/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[Server] ═══════════════════════════════════════`);
  console.log(`[Server] Shake & Bake re-optimize: ${id}`);

  const entry = optimizationHistory.find(h => h.id === id);
  if (!entry) return res.status(404).json({ error: 'Optimization not found' });

  const masterResume = getActiveProfile();
  if (!masterResume) return res.status(400).json({ error: 'No active profile' });

  const MATCH_THRESHOLD = 65;
  const shakeStrategies = [
    {
      name: 'Aggressive keyword weaving',
      instruction: `SHAKE & BAKE MODE: The previous best score was ${entry.matchScore}%. Beat it. Rewrite every bullet point to front-load the exact terminology from the job description. Use the job posting's own phrases and language. Be aggressive with keyword incorporation — every sentence should pull its weight. Keep all facts truthful but maximize relevance to THIS specific job.`
    },
    {
      name: 'Role-mirroring approach',
      instruction: `SHAKE & BAKE MODE: Previous score: ${entry.matchScore}%. Write as if the candidate already holds this role. Mirror the job description's responsibilities in each bullet — show parallel experience using the EXACT same language the employer used. Restructure the summary to read like a description of the ideal candidate. Stay truthful but align every word to the posting.`
    },
    {
      name: 'Skills-first restructure',
      instruction: `SHAKE & BAKE MODE: Previous score: ${entry.matchScore}%. Restructure the entire resume around the job's required skills. Lead each experience section with the most relevant skill match. Expand the skills list to include every legitimate variation and synonym. Write a summary that hits at least 5 of the top keywords in the first two sentences.`
    },
    {
      name: 'Deep keyword saturation',
      instruction: `SHAKE & BAKE MODE: Previous score: ${entry.matchScore}%. This is the final push. Saturate the resume with keywords from the job description. Use longer, more detailed bullet points that naturally incorporate 2-3 keywords each. Add a "Core Competencies" or "Areas of Expertise" section if it helps pack in more relevant terms. Maximum keyword density, minimum fluff.`
    }
  ];

  try {
    const shakeJobContext = `${entry.jobTitle || ''} at ${entry.companyName || ''}: ${(entry.fullDescription || '').substring(0, 300)}`;
    const voiceText = await autoSelectVoiceText(masterResume, shakeJobContext);

    const keywords = { keywords: entry.keywords };
    let bestResult = null;
    let bestScore = entry.matchScore;
    let attemptsMade = 0;

    for (let attempt = 0; attempt < shakeStrategies.length; attempt++) {
      const strategy = shakeStrategies[attempt];
      console.log(`[Server] Shake ${attempt + 1}/${shakeStrategies.length}: ${strategy.name}`);

      let rewrittenResume;
      try {
        rewrittenResume = await rewriteResumeWithStrategy(
          masterResume.text, keywords, strategy.instruction, voiceText
        );
      } catch (parseErr) {
        console.error(`[Server] Shake ${attempt + 1} failed: ${parseErr.message}`);
        continue;
      }

      const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
      const MATCH_CEILING = 77;
      const inSweetSpot = scoring.matchScore >= MATCH_THRESHOLD && scoring.matchScore <= MATCH_CEILING;
      console.log(`[Server] Shake ${attempt + 1} score: ${scoring.matchScore}% (target: ${MATCH_THRESHOLD}-${MATCH_CEILING}%)`);
      attemptsMade++;

      // Only accept if it improves AND doesn't over-optimize
      if (scoring.matchScore > bestScore && scoring.matchScore <= MATCH_CEILING) {
        bestScore = scoring.matchScore;

        const { text: coverLetterText, letterDate } = await generateCoverLetter(
          entry.fullDescription,
          rewrittenResume.summary,
          keywords,
          entry.tone || 'Professional',
          {
            candidateName: extractCandidateName(masterResume.text),
            companyName: entry.companyName,
            jobTitle: entry.jobTitle,
            resumeText: masterResume.text,
            voiceText
          }
        );

        bestResult = { rewrittenResume, coverLetterText, letterDate, scoring };
      }

      if (inSweetSpot) {
        console.log(`[Server] ✅ Shake & Bake hit sweet spot (${MATCH_THRESHOLD}-${MATCH_CEILING}%)!`);
        break;
      }
    }

    if (!bestResult) {
      console.log('[Server] Shake & Bake could not beat previous score');
      return res.json({
        improved: false,
        message: `Tried ${attemptsMade} strategies but couldn't beat ${entry.matchScore}%. Current version is the best we can do.`,
        matchScore: entry.matchScore
      });
    }

    const { rewrittenResume, coverLetterText, letterDate, scoring } = bestResult;
    const safeCompany = sanitizeForFilename(entry.companyName);
    const safeTitle = sanitizeForFilename(entry.jobTitle);
    const version = optimizationHistory.filter(
      h => h.companyName === entry.companyName && h.jobTitle === entry.jobTitle
    ).length + 1;

    const resumeFileName = `resume-v${version}-${safeCompany}-${safeTitle}.docx`;
    const resumePdfFileName = `resume-v${version}-${safeCompany}-${safeTitle}.pdf`;
    const coverLetterFileName = `coverletter-v${version}-${safeCompany}-${safeTitle}.docx`;
    const resumeFilePath = path.join(__dirname, 'output', resumeFileName);
    const resumePdfFilePath = path.join(__dirname, 'output', resumePdfFileName);
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);
    const keywordSpecs = entry.keywords || [];

    await generateResumeDOCX(rewrittenResume, keywordSpecs, entry.jobTitle, entry.companyName, resumeFilePath, masterResume.text);
    await generateResumePDF(rewrittenResume, keywordSpecs, resumePdfFilePath, masterResume.text);
    await generateCoverLetterDOCX(coverLetterText, keywordSpecs, entry.jobTitle, entry.companyName, coverLetterFilePath, extractCandidateName(masterResume.text), letterDate);

    // Update the history entry in place
    entry.rewrittenResume = rewrittenResume;
    entry.coverLetterText = coverLetterText;
    entry.matchScore = scoring.matchScore;
    entry.originalScore = scoring.originalScore;
    entry.keywordDetails = scoring.details;
    entry.retryAttempts = (entry.retryAttempts || 0) + attemptsMade;
    entry.belowThreshold = scoring.matchScore < MATCH_THRESHOLD;
    entry.resumePath = `/output/${resumeFileName}`;
    entry.resumePdfPath = `/output/${resumePdfFileName}`;
    entry.coverLetterPath = `/output/${coverLetterFileName}`;
    entry.resumeFileName = resumeFileName;
    entry.resumePdfFileName = resumePdfFileName;
    entry.coverLetterFileName = coverLetterFileName;
    entry.lastShakeBake = new Date().toISOString();
    saveHistory();

    console.log(`[Server] Shake & Bake complete! ${entry.matchScore - (scoring.matchScore - bestScore + entry.matchScore)}% → ${scoring.matchScore}%`);
    res.json({
      improved: true,
      matchScore: scoring.matchScore,
      previousScore: entry.matchScore - (scoring.matchScore - bestScore + entry.matchScore),
      rewrittenResume,
      coverLetterText,
      keywordDetails: scoring.details,
      retryAttempts: entry.retryAttempts,
      belowThreshold: entry.belowThreshold,
      resumePath: entry.resumePath,
      resumePdfPath: entry.resumePdfPath,
      coverLetterPath: entry.coverLetterPath,
      resumeFileName,
      resumePdfFileName,
      coverLetterFileName
    });

  } catch (err) {
    console.error('[Server] Shake & Bake failed:', err.message);
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
    const regenJobContext = `${entry.jobTitle || ''} at ${entry.companyName || ''}: ${(entry.fullDescription || '').substring(0, 300)}`;
    const voiceText = await autoSelectVoiceText(activeProf, regenJobContext);

    const { text: coverLetterText, letterDate } = await generateCoverLetter(
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
        voiceText
      }
    );

    const safeCompany = sanitizeForFilename(entry.companyName);
    const safeTitle = sanitizeForFilename(entry.jobTitle);
    const coverLetterFileName = `coverletter-${tone.toLowerCase()}-${safeCompany}-${safeTitle}.docx`;
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);

    const keywordSpecs = entry.keywords || [];
    await generateCoverLetterDOCX(coverLetterText, keywordSpecs, entry.jobTitle, entry.companyName, coverLetterFilePath, extractCandidateName(getActiveProfile()?.text || entry.originalResumeText || ''), letterDate);

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

// Highlight-to-Optimize: Smart text analysis
app.post('/analyze-text', async (req, res) => {
  const { text, pageUrl, pageTitle, forceResume } = req.body;
  console.log('[Server] ── Analyze Text ──');
  console.log('[Server] Text length:', text?.length, '| URL:', pageUrl, '| forceResume:', !!forceResume);

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: 'Selected text is too short' });
  }

  const profile = getActiveProfile();
  if (!profile) {
    return res.status(400).json({ error: 'No active resume profile. Upload a resume first.' });
  }

  try {
    const analyzeJobContext = `${pageTitle || ''} ${pageUrl || ''}: ${text.substring(0, 300)}`;
    const voiceText = await autoSelectVoiceText(profile, analyzeJobContext);

    let textType = forceResume ? 'JOB_DESCRIPTION' : null;

    if (!textType) {
    // Step 1: Detect what the text IS
    const detectionResult = await callOpenAI(
      `You are a text classifier. Analyze the following text and determine what it is. Return ONLY one of these exact labels, nothing else:
- JOB_DESCRIPTION (if it describes a job, lists requirements, responsibilities, or qualifications)
- APPLICATION_QUESTION (if it's a question being asked on a job application — like "Why do you want to work here?" or "Describe a time when...")
- COMPANY_DESCRIPTION (if it describes a company, their mission, values, culture, or what they do)
- GENERAL_TEXT (anything else — random text, article, instructions, etc.)`,
      text.substring(0, 2000),
      'Text Classification'
    );

    textType = detectionResult.trim().toUpperCase().replace(/[^A-Z_]/g, '');
    }
    console.log(`[Server] Text type: ${textType}${forceResume ? ' (forced resume)' : ''}`);

    let result;
    let resultType;

    if (textType === 'JOB_DESCRIPTION') {
      resultType = 'full_resume';
      const masterResume = profile;

      const extracted = await callOpenAI(
        `Extract the job title and company name from this job description or page context. Return ONLY valid JSON: {"jobTitle": "...", "companyName": "..."}. Use the page title or URL if the text doesn't say. If unknown, use "Position" or "Company" as fallback.`,
        `Text:\n${text.substring(0, 800)}\n\nPage title: ${pageTitle || 'N/A'}\nURL: ${pageUrl || 'N/A'}`,
        'Extract Job Context'
      );
      let jobTitle = 'Position';
      let companyName = 'Company';
      try {
        const parsed = JSON.parse(extracted.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
        jobTitle = parsed.jobTitle || jobTitle;
        companyName = parsed.companyName || companyName;
      } catch (_) {}

      const jobContext = `${jobTitle} at ${companyName}: ${text.substring(0, 300)}`;
      const voiceText = await autoSelectVoiceText(masterResume, jobContext);
      const keywords = await extractKeywords(text);
      let bestResult = null;
      let bestScore = -1;
      const MATCH_THRESHOLD = 65;
      const MAX_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let rewrittenResume;
        try {
          rewrittenResume = await rewriteResumeWithStrategy(
            masterResume.text, keywords, null, voiceText
          );
        } catch (e) {
          if (attempt < MAX_RETRIES) continue;
          throw e;
        }
        const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
        if (scoring.matchScore > bestScore) {
          bestScore = scoring.matchScore;
          const { text: coverLetterText, letterDate } = await generateCoverLetter(
            text, rewrittenResume.summary, keywords, 'Professional',
            {
              candidateName: extractCandidateName(masterResume.text),
              companyName,
              jobTitle,
              resumeText: masterResume.text,
              voiceText
            }
          );
          bestResult = { rewrittenResume, coverLetterText, letterDate, scoring };
        }
        if (scoring.matchScore >= MATCH_THRESHOLD) break;
      }

      if (!bestResult) {
        throw new Error('Resume optimization failed. Please try again.');
      }

      const { rewrittenResume, coverLetterText, letterDate, scoring } = bestResult;
      const optimizationId = `opt-${Date.now()}`;
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
      const keywordSpecs = keywords.keywords || [];

      await generateResumeDOCX(rewrittenResume, keywordSpecs, jobTitle, companyName, resumeFilePath, masterResume.text);
      await generateResumePDF(rewrittenResume, keywordSpecs, resumePdfFilePath, masterResume.text);
      await generateCoverLetterDOCX(coverLetterText, keywordSpecs, jobTitle, companyName, coverLetterFilePath, extractCandidateName(masterResume.text), letterDate);

      const historyEntry = {
        id: optimizationId,
        profileId: masterResume.id,
        profileName: masterResume.name,
        profileEmoji: masterResume.emoji,
        jobTitle,
        companyName,
        fullDescription: text,
        sourceUrl: pageUrl || '',
        tone: 'Professional',
        keywords: keywords.keywords || [],
        rewrittenResume,
        originalResumeText: masterResume.text,
        coverLetterText,
        matchScore: scoring.matchScore,
        originalScore: scoring.originalScore,
        keywordDetails: scoring.details,
        retryAttempts: 1,
        belowThreshold: scoring.matchScore < MATCH_THRESHOLD,
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

      console.log(`[Server] Full resume created from highlight: ${jobTitle} at ${companyName} | Score: ${scoring.matchScore}%`);

      result = {
        type: 'full_resume',
        title: 'Resume Created',
        content: `Tailored resume and cover letter for ${jobTitle} at ${companyName}. Match score: ${scoring.matchScore}%.`,
        matchScore: scoring.matchScore,
        keywords: keywords.keywords?.slice(0, 10) || [],
        optimizationId,
        jobTitle,
        companyName,
        suggestion: 'View and download on your dashboard.'
      };

    } else if (textType === 'APPLICATION_QUESTION') {
      resultType = 'answer';
      const systemPrompt = `You are an expert job application assistant. Using only the candidate's actual experience from their resume, generate a specific, honest, compelling answer. Sound human and natural. Use real examples and real metrics from their background. Never fabricate experience. Keep answers concise — 2 to 4 sentences for short answer fields, up to one paragraph for longer fields. Always lead with a specific real example not a generic statement.

CRITICAL RULES:
- NEVER invent a scenario or story. Use ONLY real examples from the resume.
- The ONLY real metrics — each belongs to ONE role:
  • 731 units, 5.0 Google rating, 261 reviews → A-AAAKey Mini Storage ONLY
  • 98% on-time delivery rate → Green Cuisine ONLY
  • 30+ leads per week → HVAC Lead Generator ONLY
  • 12% fuel reduction → Fleet Manager ONLY
  • 20% consultation increase → HVAC Lead Generator ONLY
- NEVER mention "Indeeeed Optimizer", "Rio Brave", or any AI tool unless the job is in tech.
- Joshua is conversational in Spanish — NEVER claim fluency.
- Do NOT use banned AI words: honed, culminating, fostering, leveraging, paramount, seamlessly, etc.`;

      const contextParts = [`Question: ${text}`];
      if (pageUrl) contextParts.push(`Page URL: ${pageUrl}`);
      if (pageTitle) contextParts.push(`Page Title: ${pageTitle}`);
      contextParts.push(`\n---\nCandidate Resume:\n${profile.text}`);
      if (voiceText) {
        contextParts.push(`\n---\nVOICE PROFILE:\n${voiceText}`);
      }

      const museDirection = await claudeMuse('Conversational', voiceText, `Answering: "${text.substring(0, 100)}"`);
      let finalPrompt = systemPrompt;
      if (museDirection) {
        finalPrompt += `\n\nCREATIVE DIRECTION:\n${museDirection}`;
      }

      const answer = await callOpenAI(finalPrompt, contextParts.join('\n'), 'Answer Generation');
      result = { type: 'answer', title: 'Application Answer', content: answer };

    } else if (textType === 'COMPANY_DESCRIPTION') {
      resultType = 'why_us';
      const contextParts = [`Company Info:\n${text}`];
      if (pageUrl) contextParts.push(`Source: ${pageUrl}`);
      contextParts.push(`\n---\nCandidate Resume:\n${profile.text}`);
      if (voiceText) contextParts.push(`\n---\nVOICE PROFILE:\n${voiceText}`);

      const whyUs = await callOpenAI(
        `Write a "Why I want to work here" paragraph using ONLY the candidate's real experience and what's provided about this company. Plain language. No corporate buzzwords. Write like a real person explaining to a friend why this company interests them and what they'd bring.

Sound genuine — connect a specific real experience to something specific about this company. 3-5 sentences max. Do NOT use banned AI words: honed, culminating, fostering, leveraging, paramount, seamlessly, etc.

TRUTH RULES: Only reference real experience from the resume. Never invent skills, stories, or connections.`,
        contextParts.join('\n'),
        'Why Us Generation'
      );

      result = { type: 'why_us', title: 'Why This Company', content: whyUs };

    } else {
      resultType = 'keywords';
      const analysis = await callOpenAI(
        `Analyze this text from a job seeker's perspective. Extract any useful information — keywords, skills mentioned, requirements, company details, or anything that could help tailor a resume or application. Return a brief, practical summary in plain language. 3-4 bullet points max. If there's nothing useful for job seeking, say so honestly.`,
        `Text:\n${text}\n\nPage: ${pageTitle || 'Unknown'}\nURL: ${pageUrl || 'Unknown'}`,
        'Text Analysis'
      );

      result = { type: 'general_analysis', title: 'Text Analysis', content: analysis };
    }

    // Log to answer library (skip for full_resume — already in optimization history)
    let responseId = result.optimizationId || `ans-${Date.now()}`;
    if (resultType !== 'full_resume') {
      const entry = {
        id: responseId,
        profileId: profile.id,
        question: text.substring(0, 200) + (text.length > 200 ? '...' : ''),
        answer: result.content,
        category: resultType === 'answer' ? 'other' : resultType,
        source: 'optimize-highlight',
        pageUrl: pageUrl || '',
        pageTitle: pageTitle || '',
        createdAt: new Date().toISOString(),
        versions: [{ answer: result.content, generatedAt: new Date().toISOString() }],
        selectedVersion: 0
      };
      answerLibrary.unshift(entry);
      saveAnswerLibrary();
    }

    console.log(`[Server] Analyze complete: ${result.type}${resultType === 'full_resume' ? ' | saved to dashboard' : ''}`);
    res.json({ ...result, id: responseId });

  } catch (err) {
    console.error('[Server] Analyze failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    const answerJobContext = `${pageContext?.roleTitle || ''} at ${pageContext?.companyName || ''}: ${question.substring(0, 200)}`;
    const voiceText = await autoSelectVoiceText(profile, answerJobContext);
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

    const regenAnswerCtx = `${entry.pageContext?.roleTitle || ''} at ${entry.pageContext?.companyName || ''}: ${entry.question.substring(0, 200)}`;
    const voiceText = await autoSelectVoiceText(profile, regenAnswerCtx);
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

    const batchJobContext = `${pageContext?.roleTitle || ''} at ${pageContext?.companyName || ''}: ${fields.map(f => f.label || '').join(', ').substring(0, 200)}`;
    const batchVoice = await autoSelectVoiceText(profile, batchJobContext);
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

  const feedbackCtx = `${context?.jobTitle || ''} at ${context?.companyName || ''}: ${(originalOutput || '').substring(0, 200)}`;
  const voiceText = await autoSelectVoiceText(profile, feedbackCtx);

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

    const refined = await callOpenAI(
      systemPrompt,
      userParts.join('\n'),
      'Feedback Refinement',
      type === 'cover_letter' ? { maxTokens: 550 } : {}
    );

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
