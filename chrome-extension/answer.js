(function () {
  'use strict';

  const API_URL = (typeof INDEEEED_CONFIG !== 'undefined' && INDEEEED_CONFIG.API_URL)
    ? INDEEEED_CONFIG.API_URL
    : 'https://application-application-app-production.up.railway.app';

  let previewBubble = null;
  let currentAnswerId = null;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  function makeDraggable(element, handle) {
    if (!element || !handle) return;
    
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.rio-close')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      element.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = (initialLeft + dx) + 'px';
      element.style.top = (initialTop + dy) + 'px';
      element.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.style.transition = '';
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GENERATE_ANSWER') {
      handleAnswerRequest(msg.question);
    }
    if (msg.type === 'OPTIMIZE_TEXT') {
      handleOptimizeText(msg.text);
    }
    if (msg.type === 'MAKE_RESUME') {
      handleMakeResume(msg.text);
    }
    if (msg.type === 'FILL_ALL_FIELDS') {
      handleFillAll();
    }
  });

  function extractPageContext() {
    const url = window.location.href;
    let companyName = '';
    let roleTitle = '';

    // Try common selectors for company/role
    const companySelectors = [
      'meta[property="og:site_name"]',
      '[class*="company" i]', '[data-company]',
      '[class*="employer" i]', 'h1', '.company-name'
    ];
    for (const sel of companySelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.getAttribute('content') || el.textContent || '').trim();
          if (text.length > 1 && text.length < 100) { companyName = text; break; }
        }
      } catch {}
    }

    const roleSelectors = [
      '[class*="job-title" i]', '[class*="jobTitle" i]',
      '[class*="position" i]', 'h1', 'h2'
    ];
    for (const sel of roleSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text.length > 2 && text.length < 150 && text !== companyName) { roleTitle = text; break; }
        }
      } catch {}
    }

    // Try to extract from page title
    if (!companyName) {
      const titleParts = document.title.split(/[|\-–—]/);
      if (titleParts.length > 1) companyName = titleParts[titleParts.length - 1].trim();
    }

    return { url, companyName, roleTitle, pageTitle: document.title };
  }

  function findNearestInputField() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    let node = range.startContainer;

    // Walk up and around to find the closest input/textarea
    for (let i = 0; i < 10; i++) {
      if (!node) break;
      const parent = node.parentElement || node;

      // Check siblings and nearby elements
      const candidates = parent.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]');
      for (const field of candidates) {
        if (field.offsetParent !== null) return field; // visible field
      }

      node = parent.parentElement;
    }

    // Broader search - find empty text fields on the page
    const allFields = document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]');
    for (const field of allFields) {
      if (field.offsetParent !== null && !field.value && !field.textContent) return field;
    }

    return null;
  }

  function pasteIntoField(field, text) {
    if (!field) return false;

    try {
      if (field.getAttribute('contenteditable') === 'true' || field.getAttribute('role') === 'textbox') {
        field.focus();
        field.textContent = text;
        field.innerHTML = text;
      } else {
        field.focus();
        field.value = text;
      }

      // Trigger events for React/Angular/Vue forms
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return true;
    } catch (err) {
      console.error('[Rio Brave] Paste failed:', err);
      return false;
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  function showToast(message, type = 'success') {
    const existing = document.getElementById('rio-brave-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'rio-brave-toast';
    toast.className = `rio-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function removePreview() {
    if (previewBubble) {
      previewBubble.remove();
      previewBubble = null;
    }
  }

  function showPreview(question, answer, answerId) {
    removePreview();
    currentAnswerId = answerId;
    retryCount = 0;

    const bubble = document.createElement('div');
    bubble.id = 'rio-brave-preview';
    bubble.innerHTML = `
      <div class="rio-header">
        <span class="rio-logo">✨</span>
        <span class="rio-title">Rio Brave</span>
        <button class="rio-close" title="Close">✕</button>
      </div>
      <div class="rio-question">${escapeHtml(question.length > 120 ? question.substring(0, 120) + '...' : question)}</div>
      <div class="rio-answer-container">
        <div class="rio-answer">${escapeHtml(answer)}</div>
      </div>
      <div class="rio-actions">
        <button class="rio-btn rio-btn-use">Use This ✓</button>
        <button class="rio-btn rio-btn-retry">Try Again ↻</button>
        <button class="rio-btn rio-btn-edit">Edit ✏️</button>
      </div>
    `;

    // Position near selection
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      bubble.style.top = (window.scrollY + rect.bottom + 12) + 'px';
      bubble.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 420)) + 'px';
    }

    document.body.appendChild(bubble);
    previewBubble = bubble;

    // Make draggable via header
    makeDraggable(bubble, bubble.querySelector('.rio-header'));

    // Close button
    bubble.querySelector('.rio-close').addEventListener('click', removePreview);

    // Use This
    bubble.querySelector('.rio-btn-use').addEventListener('click', () => {
      const answerText = bubble.querySelector('.rio-answer').textContent;
      const field = findNearestInputField();
      const pasted = pasteIntoField(field, answerText);
      copyToClipboard(answerText);

      if (pasted) {
        showToast('Answer pasted successfully!');
      } else {
        showToast('Answer copied — paste with Cmd+V', 'info');
      }
      removePreview();
    });

    // Try Again
    bubble.querySelector('.rio-btn-retry').addEventListener('click', async () => {
      if (retryCount >= MAX_RETRIES) {
        showToast('Max retries reached', 'error');
        return;
      }
      retryCount++;
      const actionsEl = bubble.querySelector('.rio-actions');
      actionsEl.innerHTML = '<div class="rio-loading"><div class="rio-spinner"></div> Regenerating...</div>';

      try {
        const resp = await fetch(`${API_URL}/answers/${currentAnswerId}/regenerate`, { method: 'POST' });
        if (!resp.ok) throw new Error('Regeneration failed');
        const data = await resp.json();

        bubble.querySelector('.rio-answer').textContent = data.answer;
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻ (${MAX_RETRIES - retryCount} left)</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      } catch (err) {
        showToast('Regeneration failed: ' + err.message, 'error');
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      }
    });

    // Edit
    bubble.querySelector('.rio-btn-edit').addEventListener('click', () => {
      const answerContainer = bubble.querySelector('.rio-answer-container');
      const currentText = bubble.querySelector('.rio-answer').textContent;
      answerContainer.innerHTML = `<textarea class="rio-edit-area">${escapeHtml(currentText)}</textarea>`;

      const actionsEl = bubble.querySelector('.rio-actions');
      actionsEl.innerHTML = `
        <button class="rio-btn rio-btn-use">Use Edited ✓</button>
        <button class="rio-btn rio-btn-cancel">Cancel</button>
      `;

      actionsEl.querySelector('.rio-btn-use').addEventListener('click', () => {
        const editedText = bubble.querySelector('.rio-edit-area').value;
        const field = findNearestInputField();
        const pasted = pasteIntoField(field, editedText);
        copyToClipboard(editedText);
        showToast(pasted ? 'Edited answer pasted!' : 'Edited answer copied — paste with Cmd+V', pasted ? 'success' : 'info');
        removePreview();
      });

      actionsEl.querySelector('.rio-btn-cancel').addEventListener('click', () => {
        answerContainer.innerHTML = `<div class="rio-answer">${escapeHtml(currentText)}</div>`;
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      });
    });
  }

  function rebindActions(bubble, question) {
    bubble.querySelector('.rio-btn-use')?.addEventListener('click', () => {
      const answerText = bubble.querySelector('.rio-answer').textContent;
      const field = findNearestInputField();
      const pasted = pasteIntoField(field, answerText);
      copyToClipboard(answerText);
      showToast(pasted ? 'Answer pasted!' : 'Answer copied — paste with Cmd+V', pasted ? 'success' : 'info');
      removePreview();
    });
    bubble.querySelector('.rio-btn-retry')?.addEventListener('click', async () => {
      if (retryCount >= MAX_RETRIES) { showToast('Max retries reached', 'error'); return; }
      retryCount++;
      const actionsEl = bubble.querySelector('.rio-actions');
      actionsEl.innerHTML = '<div class="rio-loading"><div class="rio-spinner"></div> Regenerating...</div>';
      try {
        const resp = await fetch(`${API_URL}/answers/${currentAnswerId}/regenerate`, { method: 'POST' });
        if (!resp.ok) throw new Error('Failed');
        const data = await resp.json();
        bubble.querySelector('.rio-answer').textContent = data.answer;
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻ (${MAX_RETRIES - retryCount} left)</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      } catch (err) {
        showToast('Regeneration failed', 'error');
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      }
    });
    bubble.querySelector('.rio-btn-edit')?.addEventListener('click', () => {
      const answerContainer = bubble.querySelector('.rio-answer-container');
      const currentText = bubble.querySelector('.rio-answer').textContent;
      answerContainer.innerHTML = `<textarea class="rio-edit-area">${escapeHtml(currentText)}</textarea>`;
      const actionsEl = bubble.querySelector('.rio-actions');
      actionsEl.innerHTML = `
        <button class="rio-btn rio-btn-use">Use Edited ✓</button>
        <button class="rio-btn rio-btn-cancel">Cancel</button>
      `;
      actionsEl.querySelector('.rio-btn-use').addEventListener('click', () => {
        const editedText = bubble.querySelector('.rio-edit-area').value;
        const field = findNearestInputField();
        const pasted = pasteIntoField(field, editedText);
        copyToClipboard(editedText);
        showToast(pasted ? 'Edited answer pasted!' : 'Edited answer copied — paste with Cmd+V', pasted ? 'success' : 'info');
        removePreview();
      });
      actionsEl.querySelector('.rio-btn-cancel').addEventListener('click', () => {
        answerContainer.innerHTML = `<div class="rio-answer">${escapeHtml(currentText)}</div>`;
        actionsEl.innerHTML = `
          <button class="rio-btn rio-btn-use">Use This ✓</button>
          <button class="rio-btn rio-btn-retry">Try Again ↻</button>
          <button class="rio-btn rio-btn-edit">Edit ✏️</button>
        `;
        rebindActions(bubble, question);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showLoadingBubble(question) {
    removePreview();

    const bubble = document.createElement('div');
    bubble.id = 'rio-brave-preview';
    bubble.innerHTML = `
      <div class="rio-header">
        <span class="rio-logo">✨</span>
        <span class="rio-title">Rio Brave</span>
        <button class="rio-close" title="Close">✕</button>
      </div>
      <div class="rio-question">${escapeHtml(question.length > 120 ? question.substring(0, 120) + '...' : question)}</div>
      <div class="rio-answer-container">
        <div class="rio-loading"><div class="rio-spinner"></div> Generating answer from your resume...</div>
      </div>
    `;

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      bubble.style.top = (window.scrollY + rect.bottom + 12) + 'px';
      bubble.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 420)) + 'px';
    }

    bubble.querySelector('.rio-close').addEventListener('click', removePreview);
    document.body.appendChild(bubble);
    previewBubble = bubble;
    makeDraggable(bubble, bubble.querySelector('.rio-header'));
  }

  async function handleAnswerRequest(question) {
    console.log('[Rio Brave] Generating answer for:', question.substring(0, 80));

    showLoadingBubble(question);
    const pageContext = extractPageContext();

    try {
      const resp = await fetch(`${API_URL}/answer-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, pageContext })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const data = await resp.json();
      console.log('[Rio Brave] Answer received:', data.id, '[' + data.category + ']');

      if (data.similarPrevious) {
        console.log('[Rio Brave] Similar previous answer found:', data.similarPrevious.id);
      }

      showPreview(question, data.answer, data.id);
    } catch (err) {
      console.error('[Rio Brave] Failed:', err.message);
      removePreview();
      showToast('Failed: ' + err.message, 'error');
    }
  }

  // ── Optimize Text ──

  function showOptimizeLoading(text, message) {
    removePreview();
    const bubble = document.createElement('div');
    bubble.id = 'rio-brave-preview';
    bubble.innerHTML = `
      <div class="rio-header">
        <span class="rio-logo">✨</span>
        <span class="rio-title">Rio Brave — ${message ? 'Creating' : 'Analyzing'}</span>
        <button class="rio-close" title="Close">✕</button>
      </div>
      <div class="rio-question">${escapeHtml(text.length > 120 ? text.substring(0, 120) + '...' : text)}</div>
      <div class="rio-answer-container">
        <div class="rio-loading"><div class="rio-spinner"></div> ${message || 'Analyzing text and building response...'}</div>
      </div>
    `;

    let positioned = false;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      try {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          bubble.style.position = 'absolute';
          bubble.style.top = (window.scrollY + rect.bottom + 12) + 'px';
          bubble.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 420)) + 'px';
          positioned = true;
        }
      } catch (_) {}
    }
    if (!positioned) {
      bubble.style.position = 'fixed';
      bubble.style.top = '20px';
      bubble.style.right = '20px';
      bubble.style.left = 'auto';
    }

    bubble.querySelector('.rio-close').addEventListener('click', removePreview);
    document.body.appendChild(bubble);
    previewBubble = bubble;
    makeDraggable(bubble, bubble.querySelector('.rio-header'));
  }

  function showOptimizeResult(result, originalText) {
    removePreview();

    const bubble = document.createElement('div');
    bubble.id = 'rio-brave-preview';
    bubble.className = 'rio-optimize-result';

    let extraInfo = '';
    if (result.matchScore !== undefined) {
      extraInfo = `<div class="rio-match-score">Resume Match: <strong>${result.matchScore}%</strong></div>`;
    }
    if (result.keywords && result.keywords.length > 0) {
      const kwTags = result.keywords.map(k =>
        `<span class="rio-kw-tag">${escapeHtml(k.keyword)}</span>`
      ).join('');
      extraInfo += `<div class="rio-kw-list">${kwTags}</div>`;
    }
    if (result.suggestion) {
      extraInfo += `<div class="rio-suggestion">${escapeHtml(result.suggestion)}</div>`;
    }

    const isFullResume = result.type === 'full_resume';
    const dashboardUrl = (typeof INDEEEED_CONFIG !== 'undefined' && INDEEEED_CONFIG.DASHBOARD_URL)
      ? INDEEEED_CONFIG.DASHBOARD_URL
      : 'http://localhost:3000';

    bubble.innerHTML = `
      <div class="rio-header">
        <span class="rio-logo">✨</span>
        <span class="rio-title">${escapeHtml(result.title || 'Analysis')}</span>
        <span class="rio-type-badge">${escapeHtml(result.type || 'analysis')}</span>
        <button class="rio-close" title="Close">✕</button>
      </div>
      ${extraInfo}
      <div class="rio-answer-container">
        <div class="rio-answer">${escapeHtml(result.content)}</div>
      </div>
      <div class="rio-actions">
        ${isFullResume ? `<a href="${dashboardUrl}" target="_blank" rel="noopener" class="rio-btn rio-btn-dashboard">View on Dashboard</a>` : ''}
        <button class="rio-btn rio-btn-copy">Copy ✓</button>
        <button class="rio-btn rio-btn-retry">Try Again ↻</button>
        <button class="rio-btn rio-btn-close">Close</button>
      </div>
    `;

    let positioned = false;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      try {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          bubble.style.position = 'absolute';
          bubble.style.top = (window.scrollY + rect.bottom + 12) + 'px';
          bubble.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 420)) + 'px';
          positioned = true;
        }
      } catch (_) {}
    }
    if (!positioned) {
      bubble.style.position = 'fixed';
      bubble.style.top = '20px';
      bubble.style.right = '20px';
      bubble.style.left = 'auto';
    }

    document.body.appendChild(bubble);
    previewBubble = bubble;
    makeDraggable(bubble, bubble.querySelector('.rio-header'));

    bubble.querySelector('.rio-close').addEventListener('click', removePreview);
    bubble.querySelector('.rio-btn-close').addEventListener('click', removePreview);

    bubble.querySelector('.rio-btn-copy').addEventListener('click', () => {
      copyToClipboard(result.content);
      showToast('Copied to clipboard!');
    });

    bubble.querySelector('.rio-btn-retry').addEventListener('click', () => {
      handleOptimizeText(originalText);
    });
  }

  async function handleMakeResume(text) {
    console.log('[Rio Brave] Make resume from:', text.substring(0, 80));
    showOptimizeLoading(text, 'Creating resume & cover letter...');

    try {
      const resp = await fetch(`${API_URL}/analyze-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          pageUrl: window.location.href,
          pageTitle: document.title,
          forceResume: true
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const result = await resp.json();
      showOptimizeResult(result, text);
    } catch (err) {
      console.error('[Rio Brave] Make resume failed:', err.message);
      removePreview();
      showToast('Failed: ' + err.message, 'error');
    }
  }

  async function handleOptimizeText(text) {
    console.log('[Rio Brave] Optimizing text:', text.substring(0, 80));
    showOptimizeLoading(text);

    try {
      const resp = await fetch(`${API_URL}/analyze-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          pageUrl: window.location.href,
          pageTitle: document.title
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const result = await resp.json();
      console.log('[Rio Brave] Analysis complete:', result.type);
      showOptimizeResult(result, text);
    } catch (err) {
      console.error('[Rio Brave] Optimize failed:', err.message);
      removePreview();
      showToast('Analysis failed: ' + err.message, 'error');
    }
  }

  // ── Fill All Fields ──

  function getLabelForField(field) {
    // 1. Explicit <label for="id">
    if (field.id) {
      const label = document.querySelector(`label[for="${field.id}"]`);
      if (label) return label.textContent.trim();
    }

    // 2. Wrapping <label>
    const parentLabel = field.closest('label');
    if (parentLabel) {
      const text = parentLabel.textContent.replace(field.value || '', '').trim();
      if (text) return text;
    }

    // 3. aria-label or aria-labelledby
    if (field.getAttribute('aria-label')) return field.getAttribute('aria-label');
    const labelledBy = field.getAttribute('aria-labelledby');
    if (labelledBy) {
      const el = document.getElementById(labelledBy);
      if (el) return el.textContent.trim();
    }

    // 4. Previous sibling or nearby text
    let prev = field.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
      const text = prev.textContent.trim();
      if (text.length > 1 && text.length < 200) return text;
      prev = prev.previousElementSibling;
    }

    // 5. Parent's preceding text
    const parent = field.parentElement;
    if (parent) {
      const prevParent = parent.previousElementSibling;
      if (prevParent) {
        const text = prevParent.textContent.trim();
        if (text.length > 1 && text.length < 200) return text;
      }
    }

    // 6. Placeholder or name attribute
    return field.placeholder || field.name || '';
  }

  function scanEmptyFields() {
    const selectors = 'textarea, input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), [contenteditable="true"], [role="textbox"]';
    const allFields = document.querySelectorAll(selectors);
    const emptyFields = [];

    for (const field of allFields) {
      if (field.offsetParent === null) continue; // hidden
      if (field.type === 'hidden' || field.type === 'password' || field.type === 'submit') continue;
      if (field.readOnly || field.disabled) continue;

      const hasValue = field.getAttribute('contenteditable') === 'true'
        ? field.textContent.trim().length > 0
        : (field.value || '').trim().length > 0;

      if (hasValue) continue;

      const label = getLabelForField(field);
      emptyFields.push({
        element: field,
        label,
        placeholder: field.placeholder || '',
        type: field.type || field.tagName.toLowerCase(),
      });
    }

    return emptyFields;
  }

  function showProgressOverlay(total) {
    removeProgressOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'rio-brave-progress';
    overlay.innerHTML = `
      <div class="rio-header">
        <span class="rio-logo">✨</span>
        <span class="rio-title">Rio Brave — Fill All</span>
        <button class="rio-close" title="Cancel">✕</button>
      </div>
      <div class="rio-progress-body">
        <div class="rio-loading"><div class="rio-spinner"></div> <span class="rio-progress-text">Scanning ${total} fields...</span></div>
        <div class="rio-progress-bar-track"><div class="rio-progress-bar-fill" style="width: 0%"></div></div>
        <div class="rio-progress-details"></div>
      </div>
    `;
    overlay.querySelector('.rio-close').addEventListener('click', () => {
      removeProgressOverlay();
      showToast('Fill cancelled', 'info');
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateProgress(overlay, filled, total, currentLabel) {
    const pct = Math.round((filled / total) * 100);
    const fill = overlay.querySelector('.rio-progress-bar-fill');
    const text = overlay.querySelector('.rio-progress-text');
    const details = overlay.querySelector('.rio-progress-details');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = `Filling fields... ${filled}/${total}`;
    if (details && currentLabel) details.textContent = currentLabel;
  }

  function removeProgressOverlay() {
    const el = document.getElementById('rio-brave-progress');
    if (el) el.remove();
  }

  async function handleFillAll() {
    const emptyFields = scanEmptyFields();
    console.log(`[Rio Brave] Found ${emptyFields.length} empty fields`);

    if (emptyFields.length === 0) {
      showToast('No empty fields found on this page', 'info');
      return;
    }

    const overlay = showProgressOverlay(emptyFields.length);
    const pageContext = extractPageContext();

    try {
      const fieldData = emptyFields.map(f => ({
        label: f.label,
        placeholder: f.placeholder,
        type: f.type,
      }));

      updateProgress(overlay, 0, emptyFields.length, 'Sending to AI...');

      const resp = await fetch(`${API_URL}/answer-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fieldData, pageContext })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${resp.status}`);
      }

      const data = await resp.json();
      let filledCount = 0;

      for (const result of data.results) {
        const fieldInfo = emptyFields[result.fieldIndex];
        if (!fieldInfo) continue;

        const pasted = pasteIntoField(fieldInfo.element, result.answer);
        if (pasted) {
          fieldInfo.element.style.outline = '2px solid #059669';
          setTimeout(() => { fieldInfo.element.style.outline = ''; }, 3000);
          filledCount++;
        }
        updateProgress(overlay, filledCount, emptyFields.length, fieldInfo.label || `Field ${result.fieldIndex + 1}`);
      }

      removeProgressOverlay();
      showToast(`Filled ${filledCount} of ${emptyFields.length} fields!`, 'success');
      console.log(`[Rio Brave] Batch fill complete: ${filledCount}/${emptyFields.length}`);
    } catch (err) {
      console.error('[Rio Brave] Fill all failed:', err.message);
      removeProgressOverlay();
      showToast('Fill failed: ' + err.message, 'error');
    }
  }

  // Close preview on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { removePreview(); removeProgressOverlay(); }
  });
})();
