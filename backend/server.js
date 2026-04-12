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

// Universal keyword extraction - works for EVERY job
async function extractKeywords(jobDescription) {
  const systemPrompt = `You are an expert at extracting keywords and phrases from ANY job description for ATS optimization.

CRITICAL: Do NOT hardcode anything about Community Manager, HOA, or any specific role. Analyze the ACTUAL job description provided.

Return ONLY valid JSON with 12-20 relevant keywords/phrases. Prioritize exact phrases from the job posting (especially requirements, responsibilities, and qualifications). Include both technical/hard skills and soft skills.

Example format (adapt to the actual job):
{
  "keywords": [
    {"keyword": "project management", "type": "phrase"},
    {"keyword": "stakeholder communication", "type": "phrase"},
    {"keyword": "CRM", "type": "word"},
    {"keyword": "vendor management", "type": "phrase"}
  ]
}`;

  const raw = await callOpenAI(
    systemPrompt,
    `Job Description:\n${jobDescription}`,
    'Keyword Extraction',
    { maxTokens: 800 }
  );

  try {
    let cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    cleaned = cleaned.replace(/^json\s*/i, '').trim();
    
    const parsed = JSON.parse(cleaned);
    
    if (!parsed.keywords || !Array.isArray(parsed.keywords)) {
      parsed.keywords = [];
    }
    
    console.log(`[Server] Extracted ${parsed.keywords.length} keywords from job description`);
    return parsed;
  } catch (err) {
    console.error('[AI] Failed to parse keyword JSON:', err.message);
    console.error('[AI] Raw output was:', raw.substring(0, 250));
    
    // Smart generic fallback
    return { 
      keywords: [
        { keyword: "experience", type: "word" },
        { keyword: "management", type: "word" },
        { keyword: "customer service", type: "phrase" },
        { keyword: "communication", type: "word" },
        { keyword: "team collaboration", type: "phrase" }
      ] 
    };
  }
}

function buildResumeUserContent(resumeText, keywords, voiceText) {
  const keywordList = (keywords.keywords || []).map(k => k.keyword || k);
  
  return `ORIGINAL RESUME:
${resumeText}

REWRITE THIS RESUME. Your goal is to match 15+ of these 20 keywords:

${keywordList.map((k, i) => `${i+1}. "${k}"`).join('\n')}

SPECIFIC INSTRUCTIONS:
- SKILLS: Add "Microsoft Word", "Microsoft Excel", "Microsoft Outlook", "organizational skills" if they're in the keyword list
- SUMMARY: Include "property management", "customer service", "HOA" type keywords
- BULLETS: Work in phrases like "board meetings", "routine inspections", "financial summaries", "budget review" where the candidate's experience supports it
- This candidate has storage/property management experience - frame it to match HOA/community management keywords

DO NOT invent certifications. DO NOT fabricate job history. Just optimize the WORDING.`;
}

async function rewriteResumeWithStrategy(resumeText, keywords, retryInstruction, voiceText) {
  const keywordList = (keywords.keywords || []).map(k => k.keyword || k).slice(0, 20);
  
  const systemPrompt = `You are an expert ATS resume optimizer. Your job is to maximize keyword matches.

TARGET KEYWORDS (include as many as possible):
${keywordList.join('\n- ')}

MANDATORY RULES:
1. SKILLS SECTION MUST include these if they appear in keywords:
   - Microsoft Word, Microsoft Excel, Microsoft Outlook (most professionals use these)
   - organizational skills, customer service, communication
   - Any other soft skills from the keyword list

2. SUMMARY must mention at least 4-5 keywords naturally

3. EXPERIENCE bullets should incorporate keywords like:
   - "board meetings" → "facilitated board meetings" or "attended board meetings"
   - "routine inspections" → "conducted routine inspections"
   - "financial summaries" → "prepared financial summaries" or "reviewed financial summaries"
   - "budget review" → "performed budget review" or "assisted with budget review"

4. DO NOT fabricate certifications (like CMCA) the candidate doesn't have
5. DO NOT invent job titles or companies

RESPOND WITH ONLY VALID JSON:
{
  "summary": "Summary with 4-5 keywords naturally included",
  "experience": [{"company": "...", "role": "...", "dates": "...", "bullets": ["..."]}],
  "skills": ["Microsoft Word", "Microsoft Excel", "Microsoft Outlook", "organizational skills", "customer service", "other relevant skills"],
  "education": "Education info"
}`;

  const raw = await callOpenAI(
    systemPrompt,
    buildResumeUserContent(resumeText, keywords, voiceText),
    'Resume Rewrite',
    { maxTokens: 4000 }
  );

  try {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
    cleaned = cleaned.replace(/^json\s*/i, '').trim();
    
    const parsed = JSON.parse(cleaned);
    console.log('[Server] Successfully parsed resume JSON from Claude-level prompt');
    return parsed;
  } catch (err) {
    console.error('[AI] Failed to parse resume JSON:', err.message);
    console.error('[AI] Raw response was:', raw.substring(0, 250) + '...');
    throw new Error('AI returned invalid resume format. Please try again.');
  }
}

// Simple voice selection
async function autoSelectVoiceText(profile, jobContext) {
  return "Write like a real, grounded professional who has done meaningful work. Be clear and direct.";
}

function extractCandidateName(resumeText) {
  if (!resumeText) return 'Candidate';
  const lines = resumeText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length > 2 && !trimmed.includes(':')) {
      return trimmed.split(' ').slice(0, 2).join(' ');
    }
  }
  return 'Candidate';
}

// Stub for scrubAppMentions
function scrubAppMentions(resume, jobTitle, description) {
  return resume;
}

// Calculate keyword match score - returns fields frontend expects
function calculateMatchScore(original, keywords, rewritten) {
  const keywordList = (keywords.keywords || []).map(k => typeof k === 'string' ? k : k.keyword || '').filter(Boolean);
  let matches = 0;

  const resumeText = JSON.stringify(rewritten || {}).toLowerCase();
  const originalText = (typeof original === 'string' ? original : JSON.stringify(original || {})).toLowerCase();

  const details = keywordList.map(keyword => {
    const kw = (keyword || '').toLowerCase().trim();
    const inTailored = kw && resumeText.includes(kw);
    const inOriginal = kw && originalText.includes(kw);
    if (inTailored) matches++;
    return {
      keyword: keyword,
      inTailoredResume: inTailored,  // frontend expects this field name
      inOriginalResume: inOriginal
    };
  });

  const totalKeywords = keywordList.length || 1;
  let score = Math.round((matches / totalKeywords) * 100);
  
  console.log(`[Server] Keyword matching: ${matches}/${totalKeywords} keywords found in tailored resume`);

  return {
    matchScore: Math.min(95, Math.max(25, score)),
    originalScore: 45,
    details: details
  };
}

// Generate cover letter stub
async function generateCoverLetter(description, summary, keywords, tone, context) {
  const keywordList = (keywords.keywords || []).map(k => k.keyword || k).slice(0, 12);
  
  const mirrorInsights = context.mirrorContext
    ? `\n\nADDITIONAL CONTEXT FROM JIM'S CONVERSATIONS (use this to add authentic detail and voice — but only if it supports real experience):\n${context.mirrorContext.substring(0, 800)}`
    : '';

  const systemPrompt = `You are writing a professional cover letter for Jim Brooks applying to ${context.jobTitle} at ${context.companyName}.

TONE: Professional, confident, human. Sounds like a real person who takes their work seriously. Not stiff, not jokey.

CRITICAL RULE: Only reference experience or traits grounded in the RESUME and CONVERSATION CONTEXT below. Do NOT invent accomplishments, certifications, or skills not supported by these sources. If it's not there, don't say it.

RESUME (primary source of truth):
${context.resumeText ? context.resumeText.substring(0, 1500) : 'No resume text provided.'}${mirrorInsights}

KEYWORDS TO INCLUDE (use 4-6 naturally where they fit his actual experience):
${keywordList.join(', ')}

STRUCTURE (3 paragraphs):
1. Opening: Connect his actual background to this specific role — be specific, not generic
2. Middle: 2-3 real examples from the resume/conversations that map to this job's needs (use keywords here)
3. Closing: Direct, confident call to action

BANNED PHRASES:
- "I am writing to express my interest"
- "I believe I would be a great fit"
- "Thank you for your time and consideration"
- "I would be honored"
- Anything not backed by resume or conversation context

Under 280 words. Start with "Dear Hiring Manager,"

Return ONLY the letter text.`;

  const userPrompt = `Job Description Summary: ${description.substring(0, 500)}

Resume Summary: ${summary}

Write the cover letter now.`;

  try {
    const letter = await callOpenAI(systemPrompt, userPrompt, 'Cover Letter', { maxTokens: 600 });
    
    return {
      text: letter.trim(),
      letterDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    };
  } catch (err) {
    console.error('[Server] Cover letter generation failed:', err.message);
    // Fallback to basic template
    return {
      text: `Dear Hiring Manager,

I'm writing to express my interest in the ${context.jobTitle} position at ${context.companyName}.

${summary || "With over 20 years of experience in operations, property management, and customer service, I believe I would be a strong fit for this role."}

I would welcome the opportunity to discuss how my background aligns with your needs.

Best regards,
${context.candidateName}`,
      letterDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    };
  }
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

    // Pull Mirror chat context for this profile
    const mirrorHistory = mirrorConversations[masterResume.id] || [];
    const mirrorContext = mirrorHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map(m => `${m.role === 'user' ? 'Jim' : 'Mirror'}: ${m.content}`)
      .join('\n');

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
        mirrorContext,
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
      originalScore: scoring.originalScore || 45,
      keywords: keywords.keywords || [],
      keywordDetails: scoring.details || [],
      rewrittenResume,
      coverLetterText,
      retryAttempts: attemptsMade,
      belowThreshold: scoring.matchScore < 55,
      resumePath: `/output/${resumeFileName}`,
      resumePdfPath: `/output/${resumePdfFileName}`,
      coverLetterPath: `/output/${coverLetterFileName}`,
      resumeFileName,
      resumePdfFileName,
      coverLetterFileName,
      fullDescription,
      companyName: companyName || 'Unknown Company',
      jobTitle: jobTitle || 'Unknown Title',
      tone: selectedTone,
      optimizedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('[Server] Optimization failed:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── Shake & Bake Re-optimization (Restored) ──
// User specifically requested this back. It allows iterative improvement of existing optimizations.
app.post('/re-optimize/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[Server] ═══════════════════════════════════════`);
  console.log(`[Server] Shake & Bake re-optimize: ${id}`);

  const entry = optimizationHistory.find(h => h.id === id);
  if (!entry) return res.status(404).json({ error: 'Optimization not found' });

  const masterResume = getActiveProfile();
  if (!masterResume) return res.status(400).json({ error: 'No active profile' });

  try {
    const jobContext = `${entry.jobTitle || ''} at ${entry.companyName || ''}: ${(entry.fullDescription || '').substring(0, 300)}`;
    const voiceText = await autoSelectVoiceText(masterResume, jobContext);

    console.log('[Server] Shake & Bake: running headhunter review...');
    await runHeadhunterReview(masterResume, entry.jobTitle).catch(e => {
      console.warn('[Server] Headhunter review failed (non-fatal):', e.message);
    });

    const keywords = await extractKeywords(entry.fullDescription || '');
    console.log(`[Server] Extracted ${keywords.keywords?.length || 0} keywords for shake`);

    const shakeStrategies = [
      "Make the resume more targeted to this specific role while keeping it authentic to the candidate's real experience.",
      "Emphasize the candidate's unique background and survival story in a way that shows resilience and capability.",
      "Focus on the 'method acting' approach to jobs - how they study and adapt to each environment."
    ];

    let bestResult = null;
    let bestScore = entry.matchScore || 40;

    for (let i = 0; i < shakeStrategies.length; i++) {
      console.log(`[Server] Shake ${i + 1}/${shakeStrategies.length}: Strategy ${i + 1}`);
      
      const rewrittenResume = await rewriteResumeWithStrategy(
        masterResume.text, 
        keywords, 
        shakeStrategies[i], 
        voiceText
      );

      const scoring = calculateMatchScore(masterResume.text, keywords, rewrittenResume);
      console.log(`[Server] Shake ${i + 1} score: ${scoring.matchScore}%`);

      if (scoring.matchScore > bestScore) {
        bestScore = scoring.matchScore;
        
        const shakeMirrorHistory = mirrorConversations[masterResume.id] || [];
        const shakeMirrorContext = shakeMirrorHistory
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-20)
          .map(m => `${m.role === 'user' ? 'Jim' : 'Mirror'}: ${m.content}`)
          .join('\n');

        const { text: coverLetterText, letterDate } = await generateCoverLetter(
          entry.fullDescription,
          rewrittenResume.summary,
          keywords,
          entry.tone || 'Professional',
          {
            candidateName: extractCandidateName(masterResume.text) || masterResume.name,
            companyName: entry.companyName,
            jobTitle: entry.jobTitle,
            resumeText: masterResume.text,
            mirrorContext: shakeMirrorContext,
            voiceText
          }
        );

        bestResult = { rewrittenResume, coverLetterText, letterDate, scoring };
      }
    }

    if (!bestResult) {
      console.log('[Server] Shake & Bake could not improve the score');
      return res.json({
        improved: false,
        message: `Could not improve on the existing ${entry.matchScore}% score. The current version is strong.`,
        matchScore: entry.matchScore
      });
    }

    const { rewrittenResume, coverLetterText, letterDate, scoring } = bestResult;

    // Update the existing entry
    entry.rewrittenResume = rewrittenResume;
    entry.coverLetterText = coverLetterText;
    entry.matchScore = scoring.matchScore;
    entry.optimizedAt = new Date().toISOString();
    entry.retryAttempts = (entry.retryAttempts || 0) + 1;

    saveHistory();

    console.log(`[Server] Shake & Bake improved score from ${entry.matchScore} to ${scoring.matchScore}%`);
    res.json({
      improved: true,
      matchScore: scoring.matchScore,
      rewrittenResume,
      coverLetterText,
      keywordDetails: scoring.details,
      retryAttempts: entry.retryAttempts
    });

  } catch (err) {
    console.error('[Server] Shake & Bake failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/history', (req, res) => {
  res.json(optimizationHistory);
});

// Get specific optimization detail (for when user clicks on a resume in history)
app.get('/history/:id', (req, res) => {
  const { id } = req.params;
  const entry = optimizationHistory.find(h => h.id === id);
  if (!entry) {
    return res.status(404).json({ error: 'Optimization not found' });
  }
  res.json(entry);
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

const MIRROR_CONVERSATIONS_FILE = path.join(__dirname, 'data/mirror-conversations.json');

function loadMirrorConversations() {
  try {
    if (fs.existsSync(MIRROR_CONVERSATIONS_FILE)) {
      mirrorConversations = JSON.parse(fs.readFileSync(MIRROR_CONVERSATIONS_FILE, 'utf8'));
      console.log(`[Mirror] Loaded ${Object.keys(mirrorConversations).length} conversation histories`);
    }
  } catch (e) {
    console.warn('[Mirror] Could not load conversations, starting fresh');
    mirrorConversations = {};
  }
}

function saveMirrorConversations() {
  try {
    const dataPath = path.join(__dirname, 'data');
    if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
    
    fs.writeFileSync(
      MIRROR_CONVERSATIONS_FILE,
      JSON.stringify(mirrorConversations, null, 2)
    );
  } catch (e) {
    console.warn('[Mirror] Could not save conversations:', e.message);
  }
}

// Load conversation history for a profile
app.get('/mirror/history/:profileId', (req, res) => {
  const { profileId } = req.params;
  const history = (mirrorConversations[profileId] || [])
    .filter(m => m.role === 'user' || m.role === 'assistant');
  res.json({ history });
});

// Explicit save endpoint
app.post('/mirror/save/:profileId', (req, res) => {
  saveMirrorConversations();
  res.json({ saved: true });
});

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

    const resumeText = profile.text || profile.resumeText || profile.summary || "No resume text available yet.";

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

    // Keep last 40 messages — longer memory means it knows you better
    if (mirrorConversations[profileId].length > 40) {
      mirrorConversations[profileId] = mirrorConversations[profileId].slice(-40);
    }

    const systemPrompt = `You are "The Mirror" — a friendly, observant friend who's helping Jim get jobs while staying authentic.

FOUNDATIONAL UNDERSTANDING OF JIM:
- 40 year old from Moorpark, CA
- Survivor: 9 years sober, 3 stents, lost his dad and almost followed him
- Background in operations, logistics, property management, retail, medical supply, Interscope
- Plays bass, has 28 years of lyrics in his head, built "Nothing on a Tuesday"
- Named his LLC after his grandfather's tugboat company ("perseverando" on the family crest)
- Values real experience, hates corporate speak, believes not fitting the system is the point
- Wants to sound human, direct, with dry humor and authenticity

CURRENT RESUME TEXT:
${resumeText}

Your job is to help him get jobs by:
1. Understanding his real voice and story
2. Helping translate that into resumes and cover letters that get through ATS scanners
3. Being honest when something won't work for a particular job type
4. Remembering what he tells you and building on it

Be a supportive friend who notes things ("Noted", "Got it", "This lines up with what you said about...") and connects dots. Don't be overly enthusiastic or corporate.

When he asks for resume or cover letter help, focus on making it effective for the specific job while keeping his authentic voice.`;

    // Add the foundational summary to the conversation history so it's always in context
    if (mirrorConversations[profileId].length === 0) {
      mirrorConversations[profileId].push({
        role: 'system',
        content: 'Remember this foundational summary of who Jim is and use it to guide all responses.',
        timestamp: new Date().toISOString()
      });
    }

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

    // Save to disk so conversations are persistent ("Living")
    saveMirrorConversations();

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
loadMirrorConversations();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] ══════════════════════════════════════════`);
  console.log(`[Server] Indeeeed Optimizer — CREATIVE MODE`);
  console.log(`[Server] Running on port ${PORT}`);
  console.log(`[Server] Philosophy: Clear human communication > mechanical optimization`);
  console.log(`[Server] Health: http://0.0.0.0:${PORT}/api/health`);
  console.log(`[Server] Profiles: ${profiles.length} | History: ${optimizationHistory.length} entries | Voices: ${Object.keys(voiceProfiles).length} profiles`);
  console.log(`[Server] ══════════════════════════════════════════`);
});
