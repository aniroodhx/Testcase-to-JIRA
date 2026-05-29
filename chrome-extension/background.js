const api = typeof browser !== 'undefined' ? browser : chrome;

const TOKEN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const KAM_TOKEN_URL = 'https://kam.labcollab.net/lasso_access_token';

// ── Auto token refresh on startup ──────────────────────────────────────────
async function checkAndRefreshToken() {
    try {
        const result = await api.storage.local.get(['jira_api_token', 'jira_token_fetched_at']);
        const fetchedAt = result.jira_token_fetched_at || 0;
        const age = Date.now() - fetchedAt;

        if (!result.jira_api_token || age > TOKEN_REFRESH_INTERVAL_MS) {
            console.log('[TokenRefresh] Token missing or older than 6h — auto-fetching...');
            fetchTokenSilently();
        } else {
            const remaining = Math.round((TOKEN_REFRESH_INTERVAL_MS - age) / 60000);
            console.log(`[TokenRefresh] Token is fresh — next refresh in ~${remaining} min`);
        }
    } catch (e) {
        console.log('[TokenRefresh] Storage read failed:', e.message);
    }
}

function fetchTokenSilently() {
    api.tabs.create({ url: KAM_TOKEN_URL, active: false }, (tab) => {
        const tabId = tab.id;

        api.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
            if (updatedTabId !== tabId || info.status !== 'complete') return;
            api.tabs.onUpdated.removeListener(listener);

            api.scripting.executeScript({
                target: { tabId },
                func: () => {
                    const form = document.querySelector('form');
                    if (form) form.submit();
                    return 'submitted';
                }
            }, () => {
                api.tabs.onUpdated.addListener(function callbackListener(cbTabId, cbInfo) {
                    if (cbTabId !== tabId || cbInfo.status !== 'complete') return;
                    api.tabs.onUpdated.removeListener(callbackListener);

                    api.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const el = document.getElementById('access_token');
                            return el ? el.value : null;
                        }
                    }, (results) => {
                        api.tabs.remove(tabId);
                        const token = results?.[0]?.result;
                        if (token) {
                            api.storage.local.set({
                                jira_api_token: token,
                                jira_token_fetched_at: Date.now()
                            }, () => {
                                console.log('[TokenRefresh] Token auto-refreshed successfully');
                            });
                        } else {
                            console.log('[TokenRefresh] Token not found on KAM page — user may not be on VPN');
                        }
                    });
                });
            });
        });
    });
}

// Run on startup
checkAndRefreshToken();

// Schedule refresh every 6 hours
setInterval(checkAndRefreshToken, TOKEN_REFRESH_INTERVAL_MS);

// ── Message handlers ────────────────────────────────────────────────────────
api.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Manual token fetch (from Options page button)
    if (message.type === 'FETCH_JIRA_TOKEN') {
        api.tabs.create({ url: KAM_TOKEN_URL, active: false }, (tab) => {
            const tabId = tab.id;

            api.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
                if (updatedTabId !== tabId || info.status !== 'complete') return;
                api.tabs.onUpdated.removeListener(listener);

                api.scripting.executeScript({
                    target: { tabId },
                    func: () => {
                        const form = document.querySelector('form');
                        if (form) form.submit();
                        return 'submitted';
                    }
                }, () => {
                    api.tabs.onUpdated.addListener(function callbackListener(cbTabId, cbInfo) {
                        if (cbTabId !== tabId || cbInfo.status !== 'complete') return;
                        api.tabs.onUpdated.removeListener(callbackListener);

                        api.scripting.executeScript({
                            target: { tabId },
                            func: () => {
                                const el = document.getElementById('access_token');
                                return el ? el.value : null;
                            }
                        }, (results) => {
                            api.tabs.remove(tabId);
                            const token = results?.[0]?.result;
                            if (token) {
                                api.storage.local.set({
                                    jira_api_token: token,
                                    jira_token_fetched_at: Date.now()
                                }, () => sendResponse({ token }));
                            } else {
                                sendResponse({ error: 'Token not found on KAM page — are you on VPN?' });
                            }
                        });
                    });
                });
            });
        });
        return true;
    }

    // ── Search Jira for existing bugs by case label ─────────────────────────
    if (message.type === 'SEARCH_JIRA') {
        const { jiraUrl, jiraToken, jiraProject, caseId } = message;
        const label = 'TC-' + caseId;
        const jql = encodeURIComponent(
            `project = "${jiraProject}" AND labels = "${label}" ORDER BY created DESC`
        );
        const url = jiraUrl.replace(/\/$/, '') + '/rest/api/2/search?jql=' + jql + '&maxResults=10&fields=summary,status,labels';

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
                const issues = (body.issues || []).map(i => {
                    const labels = i.fields.labels || [];
                    const stepLabel = labels.find(l => l.match(/^TC-\d+-S\d+$/));
                    const stepNo = stepLabel ? stepLabel.split('-S')[1] : null;
                    return {
                        key: i.key,
                        summary: i.fields.summary,
                        status: i.fields.status.name,
                        stepNo
                    };
                });
                sendResponse({ issues });
            }
        })
        .catch(err => sendResponse({ error: err.message }));
        return true;
    }

    // ── Create new Jira bug ─────────────────────────────────────────────────
    if (message.type === 'CREATE_JIRA') {
        const { jiraUrl, jiraToken, jiraProject, caseId, stepNo, bugTitle, description } = message;
        const labels = ['automated_creation', 'TC-' + caseId, 'TC-' + caseId + '-S' + stepNo];

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
                    labels
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