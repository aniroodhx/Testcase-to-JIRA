const FIELDS = ['testrail_email', 'testrail_api_key', 'testrail_url', 'jira_url', 'jira_api_token', 'jira_project'];

// Load saved values into form on open
chrome.storage.local.get(FIELDS, (saved) => {
    FIELDS.forEach(id => {
        if (saved[id]) document.getElementById(id).value = saved[id];
    });
});

function showStatus(msg, isError = false) {
    const status = document.getElementById('status');
    status.textContent = msg;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';
    setTimeout(() => status.style.display = 'none', 3000);
}

// Auto-fetch Jira token from KAM via background service worker
document.getElementById('get-token-btn').onclick = () => {
    const btn = document.getElementById('get-token-btn');
    const hint = document.getElementById('token-hint');
    btn.disabled = true;
    btn.textContent = '⏳ Fetching...';
    hint.textContent = 'Opening KAM in background, please wait...';

    chrome.runtime.sendMessage({ type: 'FETCH_JIRA_TOKEN' }, (response) => {
        btn.disabled = false;
        btn.textContent = '🔄 Auto-fetch';
        if (response?.token) {
            document.getElementById('jira_api_token').value = response.token;
            // Auto-save the token immediately
            chrome.storage.local.set({ jira_api_token: response.token }, () => {
                hint.textContent = 'Must be on VPN. Fetches and saves token automatically.';
                showStatus('✅ Token fetched and saved automatically!');
            });
        } else {
            hint.textContent = 'Must be on VPN. Fetches and saves token automatically.';
            showStatus('❌ ' + (response?.error || 'Failed to fetch token — are you on VPN?'), true);
        }
    });
};

document.getElementById('save-btn').onclick = () => {
    const values = {};
    FIELDS.forEach(id => {
        values[id] = document.getElementById(id).value.trim();
    });

    if (!values.testrail_url) values.testrail_url = 'https://testrail.p2r.amazon.dev';
    if (!values.jira_url) values.jira_url = 'https://issues.labcollab.net';
    if (!values.jira_project) values.jira_project = 'KRQ';

    chrome.storage.local.set(values, () => {
        showStatus('✅ Settings saved!');
    });
};