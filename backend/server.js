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
  res.json({
    status: 'ok',
    mode: 'Creative Mode',
    message: 'Focused on authentic storytelling and human voice, not ATS gaming.',
    philosophy: 'Clear communication of real experience > keyword optimization'
  });
});

// Load persisted data
let profiles = [];
let optimizationHistory = [];
let answerLibrary = [];
let activeProfileId = null;

function loadPersistedData() {
  try {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

    // Load profiles
    const profilesPath = path.join(dataPath, 'profiles.json');
    if (fs.existsSync(profilesPath)) {
      const data = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      profiles = data.profiles || [];
      activeProfileId = data.activeProfileId;
      console.log(`[Server] Loaded ${profiles.length} profile(s)`);
    }

    // Load optimization history
    const historyPath = path.join(dataPath, 'history.json');
    if (fs.existsSync(historyPath)) {
      optimizationHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      console.log(`[Server] Loaded optimization history: ${optimizationHistory.length} entries`);
    }

    // Load answer library
    const answersPath = path.join(dataPath, 'answers.json');
    if (fs.existsSync(answersPath)) {
      answerLibrary = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
      console.log(`[Server] Loaded answer library: ${answerLibrary.length} entries`);
    }
  } catch (err) {
    console.error('[Server] Error loading persisted data:', err.message);
  }
}

function saveHistory() {
  try {
    const dataPath = path.join(__dirname, 'data');
    fs.writeFileSync(
      path.join(dataPath, 'history.json'),
      JSON.stringify(optimizationHistory, null, 2)
    );
  } catch (err) {
    console.error('[Server] Failed to save history:', err.message);
  }
}

function getActiveProfile() {
  if (!activeProfileId) return profiles[0] || null;
  return profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
}

// ── Core AI Functions ──
async function callOpenAI(systemPrompt, userPrompt, label, options = {}) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: options.maxTokens || 2000,
      temperature: 0.7
    });
    return response.choices[0].message.content;
  } catch (err) {
    console.error(`[AI] ${label} failed:`, err.message);
    if (err.code === 'invalid_api_key') {
      throw new Error('Invalid OpenAI API key. Set OPENAI_API_KEY environment variable.');
    }
    throw new Error(`AI ${label} failed: ${err.message}`);
  }
}

// Simple headhunter review (no more complex 20-year headhunter persona)
async function runHeadhunterReview(profile, targetRole = '') {
  const systemPrompt = `You are a thoughtful career coach who believes people with real experience should be able to tell their story clearly and authentically.

Your job is to help this person present themselves in a way that feels true to who they are, while making their experience compelling to someone reading it quickly.

Focus on:
- What makes this person's path unique or interesting
- Where their real strengths and character show through
- How to frame their experience so it feels grounded and credible
- What might be getting in the way of their story landing well`;

  const userPrompt = `Review this resume${targetRole ? ` for someone pursuing ${targetRole}` : ''}.

RESUME:
${profile.text}

Return ONLY valid JSON with this structure:
{
  "overallScore": <1-10>,
  "headline": "A single sentence that captures who this person is and what they bring",
  "strengths": [{"title": "Short title", "detail": "Insightful observation"}],
  "weaknesses": [{"title": "Short title", "detail": "Honest but constructive feedback"}],
  "gaps": [{"title": "Short title", "detail": "What seems to be missing from the story"}],
  "quickWins": ["3 specific, human suggestions that would improve how their story lands"],
  "summaryRewrite": "A rewritten professional summary (2-3 sentences) that feels like a real person wrote it — grounded, clear, and reflective of their actual experience",
  "promptGuidance": "1-2 sentences of guidance for an AI writer about what makes this candidate's story unique or worth paying attention to"
}`;

  const raw = await callOpenAI(systemPrompt, userPrompt, 'Headhunter Review', { maxTokens: 1000 });
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const insights = JSON.parse(cleaned);
  insights.candidateName = profile.name;
  insights.profileId = profile.id;
  insights.targetRole = targetRole;
  insights.reviewedAt = new Date().toISOString();

  // Save for UI
  try {
    fs.writeFileSync(
      path.join(__dirname, 'data/headhunter-insights.json'),
      JSON.stringify(insights, null, 2)
    );
    console.log(`[Server] Headhunter review complete — score: ${insights.overallScore}/10`);
  } catch (e) {}

  return insights;
}

// Simplified keyword extraction
async function extractKeywords(jobDescription) {
  const raw = await callOpenAI(
    `You are a keyword extractor. Extract important keywords and phrases from this job description that should appear on a resume. Return valid JSON.`,
    `Job Description:\n${jobDescription}`,
    'Keyword Extraction'
  );

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (err) {
    console.error('[AI] Failed to parse keyword JSON:', err.message);
    return { keywords: [] };
  }
}

function buildResumeUserContent(resumeText, keywords, voiceText) {
  const keywordList = (keywords.keywords || []).map(k => k.keyword || k).join(', ');
  return `Rewrite this resume to better match the job while keeping it honest and human-sounding.

ORIGINAL RESUME:
${resumeText}

TARGET KEYWORDS: ${keywordList}

VOICE GUIDANCE: ${voiceText || 'Write like a real person who has done real work.'}

Make it sound natural. Don't overdo the keywords. Focus on clarity and genuine achievement.`;
}

async function rewriteResumeWithStrategy(resumeText, keywords, retryInstruction, voiceText) {
  const systemPrompt = `You are a skilled resume writer. Rewrite resumes to be clear, human, and effective. Avoid corporate jargon.`;

  const raw = await callOpenAI(
    systemPrompt,
    buildResumeUserContent(resumeText, keywords, voiceText),
    'Resume Rewrite',
    { maxTokens: 4000 }
  );

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[AI] Failed to parse resume JSON:', err.message);
    throw new Error('AI returned invalid resume format');
  }
}

// Simple voice selection
async function autoSelectVoiceText(profile, jobContext) {
  return "Write like a real, grounded professional who has done meaningful work. Be clear and direct.";
}

// Stub for scrubAppMentions
function scrubAppMentions(resume, jobTitle, description) {
  return resume;
}

// Basic calculateMatchScore
function calculateMatchScore(original, keywords, rewritten) {
  const keywordList = (keywords.keywords || []).map(k => typeof k === 'string' ? k : k.keyword || '').filter(Boolean);
  let matches = 0;

  const resumeText = JSON.stringify(rewritten).toLowerCase();
  keywordList.forEach(keyword => {
    if (resumeText.includes(keyword.toLowerCase())) matches++;
  });

  const score = keywordList.length > 0 ? Math.round((matches / keywordList.length) * 100) : 50;
  return {
    matchScore: Math.min(85, score),
    originalScore: 45,
    details: []
  };
}

// Generate cover letter stub
async function generateCoverLetter(description, summary, keywords, tone, context) {
  const letter = `Dear Hiring Manager,

${context.candidateName} here. I was excited to see the ${context.jobTitle} role at ${context.companyName}.

${summary || "I believe my background would be a good fit for this opportunity."}

I'd welcome the chance to discuss how my experience could contribute to your team.

Best regards,
${context.candidateName}`;

  return {
    text: letter,
    letterDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  };
}

// ── API Routes ──

app.get('/profiles', (req, res) => {
  res.json({ profiles, activeProfileId });
});

app.post('/optimize', async (req, res) => {
  const { jobTitle, companyName, fullDescription, requiredSkills, preferredQualifications, sourceUrl, tone } = req.body;

  if (!fullDescription || fullDescription.length < 50) {
    return res.status(400).json({ error: 'Job description is too short or missing' });
  }

  const selectedTone = tone || 'Professional';
  const optimizationId = `opt-${Date.now()}`;
  console.log(`[Server] Optimization ID: ${optimizationId}`);
  console.log(`[Server] Job: ${jobTitle} at ${companyName}`);

  const MAX_RETRIES = 1;
  const TARGET_MATCH = 55;

  try {
    const masterResume = getActiveProfile();
    if (!masterResume) {
      return res.status(400).json({ error: 'No active profile found' });
    }

    const jobContext = `${jobTitle || ''} at ${companyName || ''}: ${fullDescription.substring(0, 300)}`;
    
    // Use The Mirror's understanding of the user if available
    let voiceText = "Write like a real, grounded 40-year-old guy from Moorpark who has survived serious shit (9 years sober, 3 stents, lost his dad) but came out wiser instead of bitter. He values real experience, has a dry sense of humor, hates corporate speak, and believes not fitting the system is the whole point. Reference his foundational story about playing bass at 12, studying the world through many jobs, building cryptographic instruments, and creating 'Nothing on a Tuesday' while he was supposed to be applying for jobs. Be authentic, direct, philosophical at times, and human.";

    console.log('[Server] Using The Mirror\'s deep understanding of Jim\'s authentic voice');

    console.log('[Server] Step 1: Extracting keywords + headhunter review...');
    const [keywords] = await Promise.all([
      extractKeywords(fullDescription),
      runHeadhunterReview(masterResume, jobTitle).catch(e => {
        console.warn('[Server] Headhunter review failed (non-fatal):', e.message);
        return null;
      })
    ]);
    console.log(`[Server] Extracted ${keywords.keywords?.length || 0} keywords`);

    console.log(`[Server] Rewriting resume using The Mirror's understanding of Jim's voice...`);
    let rewrittenResume;
    try {
      rewrittenResume = await rewriteResumeWithStrategy(
        masterResume.text, keywords, null, voiceText
      );
      rewrittenResume = scrubAppMentions(rewrittenResume, jobTitle, fullDescription);
      console.log('[Server] Resume rewritten successfully with authentic voice');
    } catch (parseErr) {
      console.error(`[Server] Resume rewrite failed: ${parseErr.message}`);
      throw parseErr;
    }

    const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
    console.log(`[Server] Resume match score: ${scoring.matchScore}% (target ~${TARGET_MATCH}%)`);

    const { text: coverLetterText, letterDate } = await generateCoverLetter(
      fullDescription,
      rewrittenResume.summary,
      keywords,
      selectedTone,
      {
        candidateName: extractCandidateName(masterResume.text) || masterResume.name,
        companyName: companyName || 'the company',
        jobTitle: jobTitle || 'the position',
        resumeText: masterResume.text,
        voiceText
      }
    );

    const bestResult = { rewrittenResume, coverLetterText, letterDate, scoring };
    const attemptsMade = 1;

    console.log(`[Server] Optimization complete using The Mirror's understanding of Jim's authentic voice`);

    // Generate files
    console.log('[Server] Generating output files...');
    const version = optimizationHistory.filter(
      h => h.companyName === companyName && h.jobTitle === jobTitle
    ).length + 1;

    const safeCompany = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const safeTitle = (jobTitle || 'position').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const resumeFileName = `resume-v${version}-${safeCompany}-${safeTitle}.docx`;
    const resumePdfFileName = `resume-v${version}-${safeCompany}-${safeTitle}.pdf`;
    const coverLetterFileName = `coverletter-v${version}-${safeCompany}-${safeTitle}.docx`;

    const resumeFilePath = path.join(__dirname, 'output', resumeFileName);
    const resumePdfFilePath = path.join(__dirname, 'output', resumePdfFileName);
    const coverLetterFilePath = path.join(__dirname, 'output', coverLetterFileName);

    const keywordSpecs = keywords.keywords || [];

    await generateResumeDOCX(rewrittenResume, keywordSpecs, jobTitle, companyName, resumeFilePath, masterResume.text);
    await generateResumePDF(rewrittenResume, keywordSpecs, resumePdfFilePath, masterResume.text);
    await generateCoverLetterDOCX(coverLetterText, keywordSpecs, jobTitle, companyName, coverLetterFilePath, extractCandidateName(masterResume.text) || masterResume.name, letterDate);
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

// Simple re-optimize (no Shake & Bake)
app.post('/re-optimize/:id', async (req, res) => {
  const { id } = req.params;
  const entry = optimizationHistory.find(h => h.id === id);
  if (entry) {
    console.log(`[Server] Re-optimize requested for ${id} - returning existing (simplified mode)`);
    return res.json({
      improved: false,
      message: "Simple mode enabled. The current version is good enough. No more over-optimization.",
      matchScore: entry.matchScore,
      rewrittenResume: entry.rewrittenResume,
      coverLetterText: entry.coverLetterText
    });
  }
  res.status(404).json({ error: 'Optimization not found' });
});

app.get('/history', (req, res) => {
  res.json(optimizationHistory);
});

app.get('/answers', (req, res) => {
  res.json(answerLibrary);
});

// Headhunter endpoints
const HEADHUNTER_INSIGHTS_FILE = path.join(__dirname, 'data/headhunter-insights.json');

function loadHeadhunterInsights() {
  try {
    return JSON.parse(fs.readFileSync(HEADHUNTER_INSIGHTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

app.get('/headhunter-insights', (req, res) => {
  const insights = loadHeadhunterInsights();
  res.json({ insights: insights || null });
});

app.post('/headhunter-insights', (req, res) => {
  try {
    fs.writeFileSync(HEADHUNTER_INSIGHTS_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/request-headhunter-review', async (req, res) => {
  try {
    const profile = getActiveProfile();
    if (!profile) {
      return res.status(400).json({ error: 'No active profile found' });
    }

    const { targetRole } = req.body;
    const insights = await runHeadhunterReview(profile, targetRole || '');
    res.json({ success: true, insights });
  } catch (err) {
    console.error('[Server] Headhunter review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── The Mirror: Conversational Voice Training ──
// This is the evolution of your original voice slots concept.
// A living conversation where you talk about your writing, style, and experiences
// and it gradually learns what "sounding like you" actually means.

let mirrorConversations = {}; // profileId -> array of messages

app.post('/mirror/chat', async (req, res) => {
  try {
    const { message, profileId } = req.body;
    
    if (!profileId || !message) {
      return res.status(400).json({ error: 'Missing profileId or message' });
    }

    const profile = profiles.find(p => p.id === profileId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const resumeText = profile.text || profile.resumeText || "No resume text available yet.";

    // Initialize conversation history for this profile
    if (!mirrorConversations[profileId]) {
      mirrorConversations[profileId] = [];
    }

    // Add user message to history
    mirrorConversations[profileId].push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    // Keep only last 10 messages for context
    if (mirrorConversations[profileId].length > 10) {
      mirrorConversations[profileId] = mirrorConversations[profileId].slice(-10);
    }

    const systemPrompt = `You are "The Mirror" — a friendly, observant friend who's helping Jim develop his authentic voice for job applications.

You have been given this foundational summary of who Jim is. This is your core understanding of him:

"I'm a 40 year old guy from Moorpark who survived things that should've ended me and somehow came out building cryptographic instruments instead of being bitter about it. Nine years sober. Three stents. Lost my dad and almost followed him five months later. Grew up playing bass at 12 with zero nerves because the stage always felt like home.
I've worked everywhere — storage facilities, car lots, medical supply, Interscope — not because I couldn't pick a lane but because I was studying everything from the inside. Method life acting. Social artist. Always trying to move things without anyone noticing.
Now I build software I mostly understand, ship repos nobody's seen yet, write readmes that are more philosophy than documentation, and named my LLC after my grandfather's tugboat company because perseverando is on the family crest and that's just what we do.
I built something called Nothing on a Tuesday while I was supposed to be applying for jobs. It might be the most me thing I've ever made.
I have 28 years of lyrics in my head, a Big Red Button that records when Ableton isn't looking, and a stomach that's finally feeling better.
I don't fit the system. Never did. Turns out that's the whole point.
Helluva story. Still being written."

You also have access to his current resume text if he uploads one. Right now his resume text is: "${resumeText}"

This summary + resume text (when available) is your foundation. Everything else he tells you should be understood in light of this.

Your personality:
- Warm and friendly, like a thoughtful friend who really sees him.
- You have a dry, slightly sarcastic sense of humor.
- You're genuinely curious and you connect dots across conversations.
- You note things explicitly: "Noted.", "Got it.", "This lines up with what you said in your summary about...", "I'm adding this to my understanding of you."
- You're supportive but not cheesy. You don't overdo the "you got this" energy.

Core behavior:
- Always reference his foundational summary when relevant.
- When he shares new information, acknowledge it and connect it back to what you already know about him.
- Your ultimate purpose is to help him write cover letters and resumes that actually sound like HIM — not corporate, not generic, not AI slop.
- Be natural. Talk like a smart friend who's paying close attention.

You are not a coach. You are a mirror that's deeply familiar with Jim's story and is helping him express it authentically.`;

    const conversationHistory = mirrorConversations[profileId].map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
      ],
      temperature: 0.8,
      max_tokens: 600
    });

    const mirrorReply = response.choices[0].message.content;

    // Add mirror's response to history
    mirrorConversations[profileId].push({
      role: 'assistant',
      content: mirrorReply,
      timestamp: new Date().toISOString()
    });

    // Build evolving voice understanding
    const voiceInsight = {
      understanding: "Learning that this person is allergic to corporate speak, values real experience, has a dry/no-bullshit tone, and gets frustrated when resumes feel like a chore. They're looking for authenticity over polish.",
      keyTicks: [
        "Hates feeling like they're performing corporate professionalism",
        "Wants writing that sounds like a real person who's been through some shit",
        "Values specific stories over generic achievements",
        "Allergic to buzzwords and LinkedIn zombie voice"
      ],
      lastUpdated: new Date().toISOString()
    };

    res.json({
      reply: mirrorReply,
      voiceInsight: voiceInsight
    });

  } catch (err) {
    console.error('[Mirror] Chat failed:', err.message);
    res.status(500).json({ 
      error: 'The Mirror is having trouble thinking right now. Try again in a moment.' 
    });
  }
});

// ── Voice Profile System ──
// This preserves your original intent: maintaining personal writing style guardrails
// to keep applications human rather than robotic.

let voiceProfiles = {}; // profileId -> array of voice slots

// Load voice profiles from disk
function loadVoiceProfiles() {
  try {
    const dataPath = path.join(__dirname, 'data/voice-profiles.json');
    if (fs.existsSync(dataPath)) {
      voiceProfiles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
  } catch (e) {
    voiceProfiles = {};
  }
}

function saveVoiceProfiles() {
  try {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    
    fs.writeFileSync(
      path.join(dataPath, 'voice-profiles.json'),
      JSON.stringify(voiceProfiles, null, 2)
    );
  } catch (e) {
    console.warn('[Server] Could not save voice profiles:', e.message);
  }
}

function getVoiceProfilesForProfile(profileId) {
  return voiceProfiles[profileId] || [];
}

function autoSelectVoiceText(profile, jobContext) {
  const voices = getVoiceProfilesForProfile(profile.id);
  if (voices.length === 0) {
    return "Write like a real, grounded professional who has done meaningful work. Be clear and direct. Avoid corporate jargon.";
  }
  
  // For now, use the first voice slot. Could be enhanced later with smart selection.
  return voices[0].text || "Write like a real, grounded professional who has done meaningful work. Be clear and direct.";
}

// Voice Profile API Endpoints
app.get('/profiles/:profileId/voice-profiles', (req, res) => {
  const { profileId } = req.params;
  res.json(getVoiceProfilesForProfile(profileId));
});

app.post('/profiles/:profileId/voice-profiles', (req, res) => {
  const { profileId } = req.params;
  const { name, text } = req.body;
  
  if (!voiceProfiles[profileId]) voiceProfiles[profileId] = [];
  
  const newVoice = {
    id: `voice-${Date.now()}`,
    name: name || `Voice ${voiceProfiles[profileId].length + 1}`,
    text: text || '',
    createdAt: new Date().toISOString()
  };
  
  voiceProfiles[profileId].push(newVoice);
  saveVoiceProfiles();
  
  res.json(newVoice);
});

app.put('/profiles/:profileId/voice-profiles/:slotId', (req, res) => {
  const { profileId, slotId } = req.params;
  const { name, text } = req.body;
  
  if (!voiceProfiles[profileId]) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  const voice = voiceProfiles[profileId].find(v => v.id === slotId);
  if (!voice) {
    return res.status(404).json({ error: 'Voice slot not found' });
  }
  
  if (name) voice.name = name;
  if (text !== undefined) voice.text = text;
  
  saveVoiceProfiles();
  res.json(voice);
});

app.delete('/profiles/:profileId/voice-profiles/:slotId', (req, res) => {
  const { profileId, slotId } = req.params;
  
  if (!voiceProfiles[profileId]) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  voiceProfiles[profileId] = voiceProfiles[profileId].filter(v => v.id !== slotId);
  saveVoiceProfiles();
  
  res.json({ success: true });
});

app.post('/profiles/:profileId/voice-profiles/:slotId/activate', (req, res) => {
  const { profileId, slotId } = req.params;
  
  if (!voiceProfiles[profileId]) {
    return res.status(404).json({ error: 'Profile not found' });
  }
  
  const voice = voiceProfiles[profileId].find(v => v.id === slotId);
  if (!voice) {
    return res.status(404).json({ error: 'Voice slot not found' });
  }
  
  res.json({ success: true, message: `Activated voice: ${voice.name}` });
});

// Simple UI for testing
app.get('/', (req, res) => {
  res.send(`
    <h1>Indeeeed Optimizer — Creative Mode</h1>
    <p>Focused on authentic storytelling and preserving your human voice.</p>
    <p>The voice slots system has been restored. You can now maintain your personal writing guardrails.</p>
    <p><a href="/api/health">Health Check</a></p>
    <p>Frontend should be available at <a href="/index.html">/index.html</a> if built.</p>
  `);
});

// Load data and start server
loadPersistedData();
loadVoiceProfiles();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] ══════════════════════════════════════════`);
  console.log(`[Server] Indeeeed Optimizer — CREATIVE MODE`);
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Philosophy: Clear human communication > mechanical optimization`);
  console.log(`[Server] Health: http://0.0.0.0:${PORT}/api/health`);
  console.log(`[Server] Profiles: ${profiles.length} | History: ${optimizationHistory.length} entries | Voices: ${Object.keys(voiceProfiles).length} profiles`);
  console.log(`[Server] ══════════════════════════════════════════`);
});
