importScripts('config.js');

function installContextMenus() {
  const items = [
    { id: 'answer-with-rio-brave', title: 'Answer with Rio Brave ✨', contexts: ['selection'] },
    { id: 'optimize-with-rio-brave', title: 'Optimize with Rio Brave ✨', contexts: ['selection'] },
    { id: 'make-resume-rio-brave', title: 'Rio Brave — Make Resume & Cover Letter', contexts: ['selection'] },
    { id: 'fill-all-rio-brave', title: 'Fill All Fields with Rio Brave ✨', contexts: ['page'] }
  ];
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn('[Indeeeed] contextMenus.removeAll:', chrome.runtime.lastError.message);
    }
    for (const item of items) {
      chrome.contextMenus.create(item, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Indeeeed] contextMenus.create', item.id, chrome.runtime.lastError.message);
        }
      });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Indeeeed] Extension onInstalled:', details.reason);
  installContextMenus();
});

// Service worker wake-up (e.g. after browser restart) — menus can be missing; ensure they exist
chrome.runtime.onStartup.addListener(() => {
  installContextMenus();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Indeeeed Background] Message received:', message);

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: INDEEEED_CONFIG.DASHBOARD_URL });
    sendResponse({ success: true });
  }

  if (message.type === 'CHECK_BACKEND') {
    fetch(`${INDEEEED_CONFIG.API_URL}/health`)
      .then(res => res.json())
      .then(data => sendResponse({ online: true, data }))
      .catch(() => sendResponse({ online: false }));
    return true;
  }

  return false;
});

// ── Rio Brave: Highlight-to-Answer ──
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'answer-with-rio-brave' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'GENERATE_ANSWER',
      question: info.selectionText
    });
  }
  if (info.menuItemId === 'optimize-with-rio-brave' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'OPTIMIZE_TEXT',
      text: info.selectionText
    });
  }
  if (info.menuItemId === 'make-resume-rio-brave' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'MAKE_RESUME',
      text: info.selectionText
    });
  }
  if (info.menuItemId === 'fill-all-rio-brave') {
    chrome.tabs.sendMessage(tab.id, { type: 'FILL_ALL_FIELDS' });
  }
});
