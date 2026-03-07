(function () {
  'use strict';

  const BACKEND_URL = 'http://localhost:3001';
  const INIT_DELAY = 2000;
  const RETRY_INTERVAL = 3000;
  const MAX_RETRIES = 10;

  console.log('[Indeeeed] Content script loaded on:', window.location.href);

  // ── Detection: Are we on an Indeed job listing page? ──
  function isJobListingPage() {
    const url = window.location.href;

    // URL-based detection — Indeed uses many URL patterns
    const urlSignals = [
      '/viewjob',
      'vjk=',
      'jk=',
      'fccid=',
      '/rc/clk',
      '/pagead/',
      '/company/',
    ];
    const hasJobUrl = urlSignals.some(sig => url.includes(sig));

    // DOM-based detection — look for job description content
    // Indeed changes class names frequently, so cast a wide net
    const domSelectors = [
      '#jobDescriptionText',
      '[id*="jobDescription"]',
      '[class*="jobsearch-JobComponent"]',
      '[class*="jobsearch-ViewJobLayout"]',
      '[class*="JobInfoHeader"]',
      '[data-testid*="jobsearch"]',
      '[data-testid*="JobInfo"]',
      '.jobsearch-JobInfoHeader-title',
      '.jobsearch-jobDescriptionText',
      '[class*="jobDescription"]',
      '[class*="job-description"]',
      // Side panel on search results page
      '[class*="jobsearch-RightPane"]',
      '[id*="jobsearch-ViewjobPaneWrapper"]',
      '#mosaic-provider-jobcards .result',
    ];
    const hasJobDOM = domSelectors.some(sel => {
      try { return !!document.querySelector(sel); } catch { return false; }
    });

    console.log('[Indeeeed] Detection — URL signals:', hasJobUrl, '| DOM signals:', hasJobDOM);
    return hasJobUrl || hasJobDOM;
  }

  // ── Scraping Logic ──
  function scrapeJobData() {
    console.log('[Indeeeed] Starting job data scrape...');

    const title = extractJobTitle();
    const company = extractCompanyName();
    const description = extractJobDescription();
    const { skills, qualifications } = extractSkillsAndQualifications(description);

    const jobData = {
      jobTitle: title,
      companyName: company,
      fullDescription: description,
      requiredSkills: skills,
      preferredQualifications: qualifications,
      sourceUrl: window.location.href,
      scrapedAt: new Date().toISOString()
    };

    console.log('[Indeeeed] Scraped job data:', {
      title: jobData.jobTitle,
      company: jobData.companyName,
      descriptionLength: jobData.fullDescription.length,
      skillsCount: jobData.requiredSkills.length,
      qualsCount: jobData.preferredQualifications.length
    });

    return jobData;
  }

  function extractJobTitle() {
    const selectors = [
      'h1.jobsearch-JobInfoHeader-title',
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h1[class*="JobInfoHeader"]',
      '.jobsearch-JobInfoHeader-title-container h1',
      'h1.icl-u-xs-mb--xs',
      '[class*="jobTitle"]',
      '[data-testid*="Title"]',
      // Side panel selectors
      '.jcs-JobTitle span',
      '.jcs-JobTitle',
      'a[data-jk] span[title]',
      'h2.jobTitle span',
      'h2.jobTitle',
      // Last resort
      'h1'
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 2) {
          console.log('[Indeeeed] Found job title via:', sel, '→', el.textContent.trim().substring(0, 60));
          return el.textContent.trim();
        }
      } catch { /* skip invalid selectors */ }
    }
    return 'Unknown Title';
  }

  function extractCompanyName() {
    const selectors = [
      '[data-testid="inlineHeader-companyName"] a',
      '[data-testid="inlineHeader-companyName"]',
      '[data-testid*="companyName"]',
      'div.jobsearch-InlineCompanyRating a',
      'div.jobsearch-InlineCompanyRating div',
      '[class*="CompanyName"] a',
      '[class*="companyName"]',
      '[data-company-name]',
      '.jobsearch-CompanyInfoContainer a',
      // Side panel
      'span.companyName',
      '[class*="company_location"] [data-testid="company-name"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 1) {
          console.log('[Indeeeed] Found company name via:', sel, '→', el.textContent.trim());
          return el.textContent.trim();
        }
      } catch { /* skip */ }
    }
    return 'Unknown Company';
  }

  function extractJobDescription() {
    const selectors = [
      '#jobDescriptionText',
      '[id="jobDescriptionText"]',
      '.jobsearch-jobDescriptionText',
      '[class*="jobDescriptionText"]',
      '[data-testid="jobDescriptionText"]',
      '[class*="jobDescription"]',
      '.jobsearch-JobComponent-description',
      '#jobDetails',
      '[id*="jobDetails"]',
      // Side panel on search results
      '.jobsearch-JobComponent',
      '[class*="JobComponent"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 100) {
          console.log('[Indeeeed] Found job description via:', sel, '(', el.textContent.trim().length, 'chars )');
          return el.textContent.trim();
        }
      } catch { /* skip */ }
    }

    // Fallback: grab text from the main content area
    console.log('[Indeeeed] Using fallback scraping for job description');
    const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    return main.textContent.substring(0, 8000).trim();
  }

  function extractSkillsAndQualifications(description) {
    const skills = [];
    const qualifications = [];
    const lines = description.split('\n').map(l => l.trim()).filter(Boolean);

    let currentSection = null;

    for (const line of lines) {
      const lower = line.toLowerCase();

      if (lower.includes('required') || lower.includes('requirements') ||
          lower.includes('must have') || lower.includes('minimum qualifications')) {
        currentSection = 'required';
        continue;
      }
      if (lower.includes('preferred') || lower.includes('nice to have') ||
          lower.includes('bonus') || lower.includes('desired') ||
          lower.includes('preferred qualifications')) {
        currentSection = 'preferred';
        continue;
      }
      if (lower.includes('responsibilities') || lower.includes('what you') ||
          lower.includes('about the role') || lower.includes('job description')) {
        currentSection = 'description';
        continue;
      }
      if (lower.includes('benefits') || lower.includes('perks') ||
          lower.includes('we offer') || lower.includes('compensation')) {
        currentSection = 'benefits';
        continue;
      }

      const isBullet = /^[\-\•\*\u2022\u25E6\u2023\u25AA]/.test(line) || /^\d+[\.\)]/.test(line);

      if (isBullet || (currentSection && line.length > 5 && line.length < 300)) {
        const cleanLine = line.replace(/^[\-\•\*\u2022\u25E6\u2023\u25AA\d\.\)]+\s*/, '').trim();
        if (!cleanLine) continue;

        if (currentSection === 'required') {
          skills.push(cleanLine);
        } else if (currentSection === 'preferred') {
          qualifications.push(cleanLine);
        }
      }
    }

    return { skills, qualifications };
  }

  // ── Toast Notifications ──
  function showToast(message, type = 'success', duration = 4000) {
    let toast = document.getElementById('indeeeed-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'indeeeed-toast';
      document.body.appendChild(toast);
    }

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.className = type;
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;

    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    setTimeout(() => {
      toast.classList.remove('visible');
    }, duration);
  }

  // ── Status Badge ──
  function showStatusBadge(text) {
    let badge = document.getElementById('indeeeed-status-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'indeeeed-status-badge';
      document.body.appendChild(badge);
    }
    badge.textContent = text;
    badge.classList.add('visible');
  }

  function hideStatusBadge() {
    const badge = document.getElementById('indeeeed-status-badge');
    if (badge) badge.classList.remove('visible');
  }

  // ── Selection / Highlight Detection ──
  function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString().trim();
  }

  function updateButtonMode() {
    const btn = document.getElementById('indeeeed-optimize-btn');
    if (!btn || btn.classList.contains('loading')) return;

    const textSpan = btn.querySelector('.btn-text');
    const iconSpan = btn.querySelector('.btn-icon');
    const selected = getSelectedText();

    if (selected.length > 20) {
      btn.classList.add('highlight-mode');
      iconSpan.textContent = '✂️';
      textSpan.textContent = 'Optimize Selected Text';
    } else {
      btn.classList.remove('highlight-mode');
      iconSpan.textContent = '🚀';
      textSpan.textContent = 'Optimize My Application';
    }
  }

  function startSelectionListener() {
    document.addEventListener('selectionchange', updateButtonMode);
    document.addEventListener('mouseup', () => setTimeout(updateButtonMode, 50));
  }

  // ── Floating Button ──
  function createOptimizeButton() {
    if (document.getElementById('indeeeed-optimize-btn')) {
      console.log('[Indeeeed] Button already exists, skipping');
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'indeeeed-optimize-btn';
    btn.innerHTML = `
      <span class="spinner"></span>
      <span class="btn-icon">🚀</span>
      <span class="btn-text">Optimize My Application</span>
    `;

    btn.addEventListener('click', handleOptimizeClick);
    document.body.appendChild(btn);
    startSelectionListener();
    console.log('[Indeeeed] ✅ Floating optimize button injected (with highlight mode)');

    const computed = window.getComputedStyle(btn);
    console.log('[Indeeeed] Button computed styles — display:', computed.display,
      '| visibility:', computed.visibility,
      '| position:', computed.position,
      '| z-index:', computed.zIndex,
      '| bottom:', computed.bottom,
      '| right:', computed.right);
  }

  async function handleOptimizeClick() {
    const btn = document.getElementById('indeeeed-optimize-btn');
    const textSpan = btn.querySelector('.btn-text');

    // Check for highlighted text first
    const selectedText = getSelectedText();
    const isHighlightMode = selectedText.length > 20;

    if (isHighlightMode) {
      console.log(`[Indeeeed] Highlight mode — using selected text (${selectedText.length} chars)`);
    } else {
      console.log('[Indeeeed] Full scrape mode — no text selected');
    }

    const jobData = isHighlightMode
      ? buildJobDataFromSelection(selectedText)
      : scrapeJobData();

    if (!jobData.fullDescription || jobData.fullDescription.length < 50) {
      showToast('Not enough text. Select more text or try scrolling down.', 'error');
      return;
    }

    btn.classList.add('loading');
    textSpan.textContent = 'Optimizing...';
    showStatusBadge(isHighlightMode ? '⏳ Optimizing selected text...' : '⏳ Sending to optimizer...');

    try {
      console.log('[Indeeeed] Sending job data to backend...');

      const response = await fetch(`${BACKEND_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });

      console.log('[Indeeeed] Backend response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log('[Indeeeed] Optimization result received:', {
        hasResume: !!result.resumePath,
        hasCoverLetter: !!result.coverLetterPath,
        keywordCount: result.keywords?.length
      });

      showToast('Resume & cover letter are ready! Open dashboard to download.', 'success', 5000);
      showStatusBadge('✅ Optimization complete');

    } catch (error) {
      console.error('[Indeeeed] Optimization failed:', error);

      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        showToast('Cannot reach backend. Is the server running at localhost:3001?', 'error', 6000);
      } else if (error.message.includes('No master resume')) {
        showToast('Upload your resume first at http://localhost:3000', 'error', 6000);
      } else {
        showToast(`Optimization failed: ${error.message}`, 'error', 5000);
      }

      showStatusBadge('❌ Failed');
    } finally {
      btn.classList.remove('loading');
      // Clear selection so button reverts to default state
      window.getSelection()?.removeAllRanges();
      updateButtonMode();
      setTimeout(hideStatusBadge, 5000);
    }
  }

  function buildJobDataFromSelection(selectedText) {
    // Still try to grab title and company from the page for context
    const title = extractJobTitle();
    const company = extractCompanyName();
    const { skills, qualifications } = extractSkillsAndQualifications(selectedText);

    console.log('[Indeeeed] Built job data from selection — title:', title, '| company:', company);

    return {
      jobTitle: title,
      companyName: company,
      fullDescription: selectedText,
      requiredSkills: skills,
      preferredQualifications: qualifications,
      sourceUrl: window.location.href,
      scrapedAt: new Date().toISOString(),
      mode: 'highlight'
    };
  }

  // ── Initialization with retry ──
  let retryCount = 0;

  function init() {
    console.log(`[Indeeeed] Init attempt ${retryCount + 1}/${MAX_RETRIES} — URL: ${window.location.href}`);

    if (isJobListingPage()) {
      console.log('[Indeeeed] ✅ Indeed job listing detected — injecting UI');
      createOptimizeButton();
      showStatusBadge('🟢 Job detected');
      setTimeout(hideStatusBadge, 3000);
      retryCount = 0;
    } else if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`[Indeeeed] Job page not detected yet, retrying in ${RETRY_INTERVAL}ms... (${retryCount}/${MAX_RETRIES})`);
      setTimeout(init, RETRY_INTERVAL);
    } else {
      console.log('[Indeeeed] Max retries reached. This may not be a job listing page.');
      // Still inject the button on any indeed.com page as a fallback —
      // the user can click it and we'll attempt to scrape whatever is there
      console.log('[Indeeeed] Injecting button anyway as fallback (on indeed.com domain)');
      createOptimizeButton();
    }
  }

  // Handle SPA-style navigation (Indeed uses pushState/replaceState)
  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[Indeeeed] URL changed to:', location.href);
      retryCount = 0;
      // Remove old button so it re-injects cleanly
      const oldBtn = document.getElementById('indeeeed-optimize-btn');
      if (oldBtn) oldBtn.remove();
      setTimeout(init, INIT_DELAY);
    }
  });

  // Also intercept pushState/replaceState directly
  const origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    window.dispatchEvent(new Event('indeeeed-urlchange'));
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    window.dispatchEvent(new Event('indeeeed-urlchange'));
  };
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('indeeeed-urlchange'));
  });
  window.addEventListener('indeeeed-urlchange', () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[Indeeeed] History state changed to:', location.href);
      retryCount = 0;
      const oldBtn = document.getElementById('indeeeed-optimize-btn');
      if (oldBtn) oldBtn.remove();
      setTimeout(init, INIT_DELAY);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Start with initial delay to let Indeed's dynamic content load
  setTimeout(init, INIT_DELAY);
})();
