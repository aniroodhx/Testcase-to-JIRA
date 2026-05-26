chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ── Auto-fetch Jira token from KAM ─────────────────────────────────────
    if (message.type === 'FETCH_JIRA_TOKEN') {
        // Step 1: Open the KAM token page in a hidden tab
        chrome.tabs.create(
            { url: 'https://kam.labcollab.net/lasso_access_token', active: false },
            (tab) => {
                const tabId = tab.id;

                // Step 2: Wait for the page to load, then submit the generate form
                chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
                    if (updatedTabId !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(listener);

                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            // Submit the generate token form
                            const form = document.querySelector('form');
                            if (form) form.submit();
                            return 'submitted';
                        }
                    }, () => {
                        // Step 3: Wait for callback page to load, then extract token
                        chrome.tabs.onUpdated.addListener(function callbackListener(cbTabId, cbInfo) {
                            if (cbTabId !== tabId || cbInfo.status !== 'complete') return;
                            chrome.tabs.onUpdated.removeListener(callbackListener);

                            chrome.scripting.executeScript({
                                target: { tabId },
                                func: () => {
                                    const el = document.getElementById('access_token');
                                    return el ? el.value : null;
                                }
                            }, (results) => {
                                chrome.tabs.remove(tabId);
                                const token = results?.[0]?.result;
                                if (token) {
                                    sendResponse({ token });
                                } else {
                                    sendResponse({ error: 'Token not found on KAM page — are you on VPN?' });
                                }
                            });
                        });
                    });
                });
            }
        );
        return true; // async
    }

    // ── Search Jira for existing bug by case label ──────────────────────────
    if (message.type === 'SEARCH_JIRA') {
        const { jiraUrl, jiraToken, jiraProject, caseId } = message;
        const label = 'TC-' + caseId;
        const jql = encodeURIComponent(
            `project = "${jiraProject}" AND labels = "${label}" ORDER BY created DESC`
        );
        const url = jiraUrl.replace(/\/$/, '') + '/rest/api/2/search?jql=' + jql + '&maxResults=5&fields=summary,status,labels';

        fetch(url, {
            headers: {
                'Authorization': 'Bearer ' + jiraToken,
                'Content-Type': 'application/json'
            }
        })
        .then(async res => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                sendResponse({ error: 'Jira search error ' + res.status });
            } else {
                const issues = (body.issues || []).map(i => ({
                    key: i.key,
                    summary: i.fields.summary,
                    status: i.fields.status.name
                }));
                sendResponse({ issues });
            }
        })
        .catch(err => sendResponse({ error: err.message }));

        return true;
    }

    // ── Create new Jira bug ─────────────────────────────────────────────────
    if (message.type === 'CREATE_JIRA') {
        const { jiraUrl, jiraToken, jiraProject, caseId, bugTitle, description } = message;

        fetch(jiraUrl.replace(/\/$/, '') + '/rest/api/2/issue', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + jiraToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    project: { key: jiraProject },
                    summary: bugTitle,
                    description: description,
                    issuetype: { name: 'Bug' },
                    labels: ['automated_creation', 'TC-' + caseId]
                }
            })
        })
        .then(async res => {
            const body = await res.json().catch(() => ({}));
            if (res.status !== 201) {
                sendResponse({ error: 'Jira error ' + res.status + ': ' + JSON.stringify(body) });
            } else {
                sendResponse({ key: body.key });
            }
        })
        .catch(err => sendResponse({ error: err.message }));

        return true;
    }
});