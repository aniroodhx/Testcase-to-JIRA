const api = typeof browser !== 'undefined' ? browser : chrome;

const TOKEN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PROJECTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;    // 24 hours
const KAM_TOKEN_URL = 'https://kam.labcollab.net/lasso_access_token';
const JIRA_URL = 'https://issues.labcollab.net';

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
            checkAndRefreshProjects(result.jira_api_token);
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
                                checkAndRefreshProjects(token);
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

// ── Fetch and cache accessible projects ──────────────────────────────────
async function checkAndRefreshProjects(token) {
    try {
        const result = await api.storage.local.get(['jira_projects_cache', 'jira_projects_fetched_at']);
        const fetchedAt = result.jira_projects_fetched_at || 0;
        const age = Date.now() - fetchedAt;

        if (!result.jira_projects_cache || age > PROJECTS_CACHE_TTL_MS) {
            console.log('[Projects] Cache missing or older than 24h — fetching...');
            fetchAndCacheProjects(token);
        } else {
            console.log('[Projects] Cache is fresh — ' + result.jira_projects_cache.length + ' projects loaded');
        }
    } catch (e) {
        console.log('[Projects] Cache check failed:', e.message);
    }
}

async function fetchAndCacheProjects(token) {
    try {
        const response = await fetch(JIRA_URL + '/rest/api/2/project?expand=projectKeys', {
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('[Projects] Fetch failed: ' + response.status);
            return;
        }

        const allProjects = await response.json();

        const accessibleProjects = allProjects
            .map(p => ({ key: p.key, name: p.name }))
            .sort((a, b) => a.key.localeCompare(b.key));

        await api.storage.local.set({
            jira_projects_cache: accessibleProjects,
            jira_projects_fetched_at: Date.now()
        });

        console.log('[Projects] Cached ' + accessibleProjects.length + ' accessible projects');
    } catch (e) {
        console.log('[Projects] Fetch error:', e.message);
    }
}

// Run on startup
checkAndRefreshToken();

// Schedule token refresh every 6 hours
setInterval(checkAndRefreshToken, TOKEN_REFRESH_INTERVAL_MS);

// ── Message handlers ────────────────────────────────────────────────────────
api.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Manual token fetch
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
                                }, () => {
                                    fetchAndCacheProjects(token);
                                    sendResponse({ token });
                                });
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

    // Get cached projects
    if (message.type === 'GET_PROJECTS') {
        api.storage.local.get(['jira_projects_cache', 'jira_api_token', 'jira_projects_fetched_at'], (result) => {
            const cache = result.jira_projects_cache;
            const age = Date.now() - (result.jira_projects_fetched_at || 0);

            if (cache && cache.length > 0) {
                sendResponse({ projects: cache });
                if (age > PROJECTS_CACHE_TTL_MS && result.jira_api_token) {
                    fetchAndCacheProjects(result.jira_api_token);
                }
            } else {
                if (result.jira_api_token) {
                    fetchAndCacheProjects(result.jira_api_token).then(() => {
                        api.storage.local.get('jira_projects_cache', (r) => {
                            sendResponse({ projects: r.jira_projects_cache || [] });
                        });
                    });
                } else {
                    sendResponse({ projects: [], error: 'No token available — open Options and click Force Refresh' });
                }
            }
        });
        return true;
    }

    // ── Search Jira for existing bugs by case label ─────────────────────────
    if (message.type === 'SEARCH_JIRA') {
        const { jiraUrl, jiraToken, caseId } = message;
        const label = 'TC-' + caseId;
        const jql = encodeURIComponent(
            `labels = "${label}" ORDER BY created DESC`
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
                if (res.status === 400 || res.status === 404) {
                    sendResponse({ issues: [] });
                } else {
                    sendResponse({ error: 'Jira search error ' + res.status });
                }
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

        // Build base fields
        const fields = {
            project: { key: jiraProject },
            summary: bugTitle,
            description: description,
            issuetype: { name: 'Bug' },
            labels
        };

        // KRF requires Content Type — default to None, tester updates after creation
        if (jiraProject === 'KRF') {
            fields['customfield_12806'] = { value: 'None' };
        }

        fetch(jiraUrl.replace(/\/$/, '') + '/rest/api/2/issue', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + jiraToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        })
        .then(async res => {
            const body = await res.json().catch(() => ({}));
            if (res.status === 403 || res.status === 404) {
                sendResponse({ error: `You don't have access to project "${jiraProject}" or it doesn't exist. Please select a different project.` });
            } else if (res.status === 401) {
                sendResponse({ error: 'Jira token expired — open Options and click Force Refresh.' });
            } else if (res.status === 400) {
                const errors = body.errors || {};
                const errorMessages = body.errorMessages || [];
                const fieldErrors = Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(', ');
                const msg = errorMessages.length > 0 ? errorMessages.join(', ') : fieldErrors;
                sendResponse({ error: `Project "${jiraProject}" requires additional mandatory fields not supported by this tool. Please create this bug manually in Jira. (${msg})` });
            } else if (res.status !== 201) {
                sendResponse({ error: 'Jira error ' + res.status + ': ' + JSON.stringify(body) });
            } else {
                sendResponse({ key: body.key });
            }
        })
        .catch(err => sendResponse({ error: err.message }));
        return true;
    }
});