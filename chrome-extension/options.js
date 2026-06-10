const api = typeof browser !== 'undefined' ? browser : chrome;
const FIELDS = ['testrail_email', 'testrail_api_key', 'testrail_url', 'jira_url', 'jira_api_token'];

api.storage.local.get([...FIELDS, 'jira_token_fetched_at'], (saved) => {
    FIELDS.forEach(id => {
        if (saved[id]) document.getElementById(id).value = saved[id];
    });
    if (saved.jira_token_fetched_at) {
        const age = Math.round((Date.now() - saved.jira_token_fetched_at) / 60000);
        document.getElementById('token-hint').textContent = `Auto-refreshes every 6h, last fetched ${age} min ago. Click to force refresh.`;
    }
});

function showStatus(msg, isError = false) {
    const status = document.getElementById('status');
    status.textContent = msg;
    status.className = isError ? 'error' : 'success';
    status.style.display = 'block';
    setTimeout(() => status.style.display = 'none', 3000);
}

document.getElementById('get-token-btn').onclick = () => {
    const btn = document.getElementById('get-token-btn');
    const hint = document.getElementById('token-hint');
    btn.disabled = true;
    btn.textContent = 'Fetching...';
    hint.textContent = 'Opening KAM in background, please wait...';

    api.runtime.sendMessage({ type: 'FETCH_JIRA_TOKEN' }, (response) => {
        btn.disabled = false;
        btn.textContent = 'Force Refresh';
        if (response?.token) {
            document.getElementById('jira_api_token').value = response.token;
            api.storage.local.set({ jira_api_token: response.token, jira_token_fetched_at: Date.now() }, () => {
                hint.textContent = 'Auto-refreshes every 6h, just fetched now. Click to force refresh.';
                showStatus('Token fetched and saved!');
            });
        } else {
            hint.textContent = 'Auto-refreshes every 6h, must be on VPN.';
            showStatus('❌ ' + (response?.error || 'Failed, are you on VPN?'), true);
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
    api.storage.local.set(values, () => showStatus('Settings saved!'));
};