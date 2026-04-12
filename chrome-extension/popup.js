document.addEventListener('DOMContentLoaded', () => {
  checkBackendStatus();
  checkCurrentPage();

  document.getElementById('open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: INDEEEED_CONFIG.DASHBOARD_URL });
  });

  document.getElementById('check-connection').addEventListener('click', () => {
    setStatus('backend', 'checking', 'Checking backend...');
    checkBackendStatus();
    checkCurrentPage();
  });
});

function checkBackendStatus() {
  fetch(`${INDEEEED_CONFIG.API_URL}/api/health`)
    .then(res => res.json())
    .then(data => {
      const mode = data.mode || 'Creative Mode';
      setStatus('backend', 'online', `Backend online — ${mode}`);
    })
    .catch(() => {
      setStatus('backend', 'offline', 'Backend offline — start server first');
    });
}

function checkCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab && tab.url && tab.url.includes('indeed.com')) {
      const jobSignals = ['viewjob', 'vjk=', 'jk=', 'fccid=', '/rc/clk', '/jobs?'];
      const isJobPage = jobSignals.some(sig => tab.url.includes(sig));
      if (isJobPage) {
        setStatus('page', 'online', 'On Indeed job listing — ready!');
      } else {
        setStatus('page', 'online', 'On Indeed — button will appear if job content found');
      }
    } else {
      setStatus('page', 'offline', 'Not on Indeed — navigate to a job listing');
    }
  });
}

function setStatus(id, state, text) {
  const dot = document.getElementById(`${id}-dot`);
  const label = document.getElementById(`${id}-status`);
  dot.className = `status-dot ${state}`;
  label.textContent = text;
}
