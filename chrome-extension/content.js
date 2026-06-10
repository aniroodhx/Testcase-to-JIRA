const api = typeof browser !== 'undefined' ? browser : chrome;
const LAMBDA_URL = 'https://p39n1seqxd.execute-api.us-west-2.amazonaws.com/generate-description';

// Fallback projects if cache unavailable
const FALLBACK_PROJECTS = [
    { key: 'KRQ', name: 'Kindle Rendering QA' },
    { key: 'YJR', name: 'YJR' },
    { key: 'KFA', name: 'Kindle for Android' },
    { key: 'LSN', name: 'Kindle for iOS' },
    { key: 'KAY', name: 'KindleA1Y' },
    { key: 'KRF', name: 'KRF' },
];

function extractCaseId() {
    const match = window.location.href.match(/\/cases\/view\/(\d+)/);
    return match ? match[1] : null;
}

function getTestrailUrl(caseId) {
    const base = window.location.hostname;
    return `https://${base}/index.php?/cases/view/${caseId}`;
}

async function loadCredentials() {
    return new Promise((resolve) => {
        api.storage.local.get(
            ['testrail_email', 'testrail_api_key', 'testrail_url', 'jira_url', 'jira_api_token'],
            resolve
        );
    });
}

async function getProjects() {
    return new Promise((resolve) => {
        api.runtime.sendMessage({ type: 'GET_PROJECTS' }, (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve(FALLBACK_PROJECTS);
                return;
            }
            const projects = response.projects;
            if (projects && projects.length > 0) {
                resolve(projects);
            } else {
                resolve(FALLBACK_PROJECTS);
            }
        });
    });
}

function injectButton() {
    const caseId = extractCaseId();
    if (!caseId) {
        const stray = document.getElementById('jira-bug-button-container');
        if (stray) stray.remove();
        return;
    }

    if (document.getElementById('create-jira-bug-btn')) return;

    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'jira-bug-button-container';
    buttonContainer.style.cssText = 'margin: 15px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; position: relative; z-index: 9999; border: 1px solid #ddd;';

    const button = document.createElement('button');
    button.id = 'create-jira-bug-btn';
    button.textContent = '🐛 Create JIRA';
    button.style.cssText = 'padding: 10px 20px; font-size: 14px; cursor: pointer; background: #0052CC; color: white; border: none; border-radius: 3px; font-weight: bold;';

    if (localStorage.getItem('jira_done_' + caseId)) {
        button.textContent = '✅ Jira Bug Created';
        button.style.background = '#00875A';
    }

    button.onclick = function () {
        showStepAndProjectDialog(caseId, button);
    };

    buttonContainer.appendChild(button);
    const insertionPoint = document.querySelector('.content-header') || document.querySelector('#content-inner');
    if (insertionPoint) {
        insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
    }
}

async function showStepAndProjectDialog(caseId, button) {
    const existing = document.getElementById('step-project-dialog');
    if (existing) existing.remove();

    // Show loading dialog while fetching projects
    const dialog = document.createElement('div');
    dialog.id = 'step-project-dialog';
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:25px; border-radius:8px; box-shadow:0 4px 25px rgba(0,0,0,0.4); z-index:10000; width:420px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 16px 0; color:#0052CC; font-size:16px; font-weight:600;">🐛 Create JIRA Bug</h3>
        <p style="color:#888; font-size:13px;">⏳ Loading projects...</p>`;
    document.body.appendChild(dialog);

    const projects = await getProjects();

    const projectOptions = projects.map(p =>
        `<option value="${p.key}">${p.key} — ${p.name}</option>`
    ).join('');

    dialog.innerHTML = `
        <h3 style="margin:0 0 16px 0; color:#0052CC; font-size:16px; font-weight:600;">🐛 Create JIRA Bug</h3>
        <label style="display:block; font-size:13px; font-weight:bold; color:#333; margin-bottom:4px;">Failing Step Number</label>
        <input id="step-input" type="number" min="1" placeholder="e.g. 3"
            style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:14px; box-sizing:border-box; margin-bottom:14px;" />
        <label style="display:block; font-size:13px; font-weight:bold; color:#333; margin-bottom:4px;">Jira Project</label>
        <select id="project-select"
            style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:13px; box-sizing:border-box; margin-bottom:6px; background:white;">
            ${projectOptions}
        </select>
        <p id="project-warning" style="display:none; margin:0 0 14px 0; color:#FF8B00; font-size:12px; background:#FFF8E1; padding:6px 8px; border-radius:4px; border:1px solid #FFD54F;">
            ⚠️ Some projects require mandatory fields not supported by this tool. If creation fails, please file manually in Jira.
        </p>
        <div style="margin-bottom:20px;"></div>
        <div style="display:flex; gap:10px;">
            <button id="dialog-submit-btn" style="flex:1; padding:10px; background:#0052CC; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Create</button>
            <button id="dialog-cancel-btn" style="flex:1; padding:10px; background:#6B778C; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Cancel</button>
        </div>`;

    setTimeout(() => document.getElementById('step-input').focus(), 50);

    // Show warning for known restricted projects
    const restrictedProjects = ['SBR', 'PTORDA', 'KITTYHAWK'];
    document.getElementById('project-select').onchange = function() {
        const warning = document.getElementById('project-warning');
        warning.style.display = restrictedProjects.includes(this.value) ? 'block' : 'none';
    };

    document.getElementById('dialog-submit-btn').onclick = () => {
        const stepNo = document.getElementById('step-input').value.trim();
        const project = document.getElementById('project-select').value;
        if (!stepNo || isNaN(stepNo) || parseInt(stepNo) < 1) {
            document.getElementById('step-input').style.border = '1px solid #DE350B';
            return;
        }
        dialog.remove();
        button.disabled = true;
        button.textContent = '⏳ Starting...';
        handleCreateJira(caseId, stepNo, project, button);
    };

    document.getElementById('dialog-cancel-btn').onclick = () => dialog.remove();

    document.getElementById('step-input').onkeydown = (e) => {
        if (e.key === 'Enter') document.getElementById('dialog-submit-btn').click();
    };
}

async function fetchTestRailCase(caseId, creds) {
    const basicToken = btoa(creds.testrail_email + ':' + creds.testrail_api_key);
    const url = creds.testrail_url.replace(/\/$/, '') + '/index.php?/api/v2/get_case/' + caseId;
    const response = await fetch(url, {
        headers: {
            'Authorization': 'Basic ' + basicToken,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) throw new Error('TestRail fetch failed: ' + response.status);
    return response.json();
}

function extractStep(testCase, stepNoStr) {
    const stepIndex = parseInt(stepNoStr) - 1;
    const stepsArr = testCase.custom_steps_separated;
    if (Array.isArray(stepsArr) && stepIndex >= 0 && stepIndex < stepsArr.length) {
        return {
            content: stepsArr[stepIndex].content || '',
            expected: stepsArr[stepIndex].expected || '',
            step_number: stepNoStr
        };
    }
    const stepLines = (testCase.custom_steps || '').split('\n').map(l => l.trim()).filter(Boolean);
    const expectedLines = (testCase.custom_expected || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (stepIndex >= 0 && stepIndex < stepLines.length) {
        return {
            content: stepLines[stepIndex],
            expected: stepIndex < expectedLines.length ? expectedLines[stepIndex] : 'No expected result',
            step_number: stepNoStr
        };
    }
    throw new Error('Step ' + stepNoStr + ' not found in test case');
}

function extractAllSteps(testCase) {
    const stepsArr = testCase.custom_steps_separated;
    if (Array.isArray(stepsArr) && stepsArr.length > 0) {
        return stepsArr.map((s, i) => `${i + 1}. ${s.content || ''}`.trim()).join('\n');
    }
    const stepLines = (testCase.custom_steps || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.toLowerCase().startsWith('prerequisite') && !l.toLowerCase().startsWith('note:'));
    if (stepLines.length > 0) {
        return stepLines.map((l, i) => `${i + 1}. ${l}`).join('\n');
    }
    return '';
}

async function callLambda(testCase, step, caseId, creds) {
    const rawFilePath = testCase.custom_filepath || testCase.file_path || '';
    const filePath = rawFilePath.replace(/!\[\]\([^)]*\)/g, '').trim();
    const platform = testCase.custom_platform || '[Filled by tester]';
    const allSteps = extractAllSteps(testCase);
    const testrailUrl = getTestrailUrl(caseId);

    const payload = {
        title: testCase.title || '',
        step_content: step.content,
        all_steps: allSteps,
        expected: step.expected,
        platform: platform,
        file_path: filePath,
        case_id: String(testCase.id),
        step_number: step.step_number,
        testrail_url: testrailUrl
    };

    const response = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Lasso-Token': creds.jira_api_token
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 401 || response.status === 403) {
        throw new Error('Amazon auth failed — your Midway token may have expired. Open Options and click Force Refresh.');
    }
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Lambda call failed: ' + response.status);
    }
    return response.json();
}

async function searchJira(caseId, creds) {
    return new Promise((resolve, reject) => {
        api.runtime.sendMessage({
            type: 'SEARCH_JIRA',
            jiraUrl: creds.jira_url,
            jiraToken: creds.jira_api_token,
            caseId
        }, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response) return reject(new Error('No response from background script'));
            if (response.error) return reject(new Error(response.error));
            resolve(response.issues);
        });
    });
}

async function postToJira(caseId, stepNo, bugTitle, description, creds, jiraProject) {
    return new Promise((resolve, reject) => {
        api.runtime.sendMessage({
            type: 'CREATE_JIRA',
            jiraUrl: creds.jira_url,
            jiraToken: creds.jira_api_token,
            jiraProject: jiraProject,
            caseId,
            stepNo,
            bugTitle,
            description
        }, (response) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response) return reject(new Error('No response from background script'));
            if (response.error) return reject(new Error(response.error));
            resolve(response);
        });
    });
}

async function handleCreateJira(caseId, stepNo, jiraProject, button) {
    try {
        const creds = await loadCredentials();
        if (!creds.testrail_email || !creds.jira_api_token) {
            throw new Error('Credentials not set — right-click the extension and open Options');
        }

        button.textContent = '⏳ Checking for duplicates...';
        const existingIssues = await searchJira(caseId, creds);

        if (existingIssues.length > 0) {
            const sameStepIssue = existingIssues.find(i => i.stepNo === String(stepNo));
            if (sameStepIssue) {
                button.disabled = false;
                button.textContent = '🐛 Create JIRA';
                showSameStepWarning(sameStepIssue, creds, caseId, stepNo, jiraProject, button);
            } else {
                button.disabled = false;
                button.textContent = '🐛 Create JIRA';
                showDuplicateDialog(existingIssues, creds, caseId, stepNo, jiraProject, button);
            }
            return;
        }

        await createJiraIssue(caseId, stepNo, jiraProject, button, creds);

    } catch (error) {
        alert('❌ Error: ' + error.message);
        button.disabled = false;
        button.textContent = '🐛 Create JIRA';
    }
}

async function createJiraIssue(caseId, stepNo, jiraProject, button, creds) {
    button.disabled = true;

    button.textContent = '⏳ Fetching test case...';
    const testCase = await fetchTestRailCase(caseId, creds);

    button.textContent = '⏳ Generating with Claude...';
    const step = extractStep(testCase, stepNo);
    const { bug_title, description } = await callLambda(testCase, step, caseId, creds);

    button.textContent = '⏳ Creating Jira issue...';
    const issue = await postToJira(caseId, stepNo, bug_title, description, creds, jiraProject);

    const issueKey = issue.key;
    const issueUrl = creds.jira_url.replace(/\/$/, '') + '/browse/' + issueKey;

    localStorage.setItem('jira_done_' + caseId, 'true');
    showGoldenDialog(issueKey, issueUrl);
    button.textContent = '✅ Jira Bug Created';
    button.style.background = '#00875A';
}

function showSameStepWarning(sameStepIssue, creds, caseId, stepNo, jiraProject, button) {
    const jiraBase = creds.jira_url.replace(/\/$/, '');
    const dialog = document.createElement('div');
    dialog.id = 'same-step-warning-dialog';
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:25px; border-radius:8px; box-shadow:0 4px 25px rgba(0,0,0,0.5); z-index:10000; width:500px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; border-top:4px solid #DE350B;';
    dialog.innerHTML =
        `<h3 style="margin:0 0 8px 0; color:#DE350B; font-size:17px; font-weight:600;">🚨 Bug Already Exists for Step ${stepNo}</h3>
        <p style="margin:0 0 14px 0; color:#555; font-size:13px;">A Jira bug was already created for <strong>Step ${stepNo}</strong> of case <strong>C${caseId}</strong>:</p>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; padding:10px; background:#FFF3F3; border-radius:4px; border:1px solid #FFCDD2;">
            <span style="background:#DE350B; color:white; padding:2px 8px; border-radius:3px; font-size:12px; font-weight:bold;">${sameStepIssue.key}</span>
            <span style="flex:1; font-size:13px; color:#333;">${sameStepIssue.summary}</span>
            <span style="font-size:11px; color:#666;">${sameStepIssue.status}</span>
            <a href="${jiraBase}/browse/${sameStepIssue.key}" target="_blank" style="color:#0052CC; font-size:12px;">Open ↗</a>
        </div>
        <p style="margin:0 0 16px 0; color:#DE350B; font-size:13px; font-weight:bold;">⚠️ Are you sure you want to create another bug for the same step?</p>
        <div style="display:flex; gap:10px;">
            <button id="confirm-same-step-btn" style="flex:1; padding:11px; background:#DE350B; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Yes, Force Create Anyway</button>
            <button id="cancel-same-step-btn" style="flex:1; padding:11px; background:#6B778C; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Cancel</button>
        </div>`;
    document.body.appendChild(dialog);
    document.getElementById('confirm-same-step-btn').onclick = async () => {
        dialog.remove(); button.disabled = true; button.textContent = '⏳ Starting...';
        try { await createJiraIssue(caseId, stepNo, jiraProject, button, creds); }
        catch (error) { alert('❌ Error: ' + error.message); button.disabled = false; button.textContent = '🐛 Create JIRA'; }
    };
    document.getElementById('cancel-same-step-btn').onclick = () => dialog.remove();
}

function showDuplicateDialog(issues, creds, caseId, stepNo, jiraProject, button) {
    const jiraBase = creds.jira_url.replace(/\/$/, '');
    const issueRows = issues.map(i => {
        const stepBadge = i.stepNo
            ? `<span style="background:#6B778C; color:white; padding:2px 6px; border-radius:3px; font-size:11px;">Step ${i.stepNo}</span>`
            : '';
        return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; padding:8px; background:#f4f5f7; border-radius:4px;">
            <span style="background:#0052CC; color:white; padding:2px 8px; border-radius:3px; font-size:12px; font-weight:bold;">${i.key}</span>
            ${stepBadge}
            <span style="flex:1; font-size:13px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${i.summary}</span>
            <span style="font-size:11px; color:#666;">${i.status}</span>
            <a href="${jiraBase}/browse/${i.key}" target="_blank" style="color:#0052CC; font-size:12px;">Open ↗</a>
        </div>`;
    }).join('');
    const dialog = document.createElement('div');
    dialog.id = 'duplicate-dialog';
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:25px; border-radius:8px; box-shadow:0 4px 25px rgba(0,0,0,0.4); z-index:10000; width:540px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    dialog.innerHTML =
        `<h3 style="margin:0 0 6px 0; color:#FF8B00; font-size:17px; font-weight:600;">⚠️ Existing Bug${issues.length > 1 ? 's' : ''} Found for This Test Case</h3>
        <p style="margin:0 0 14px 0; color:#555; font-size:13px;">Bugs already exist for <strong>C${caseId}</strong> (different steps). You're creating for <strong>Step ${stepNo}</strong>.</p>
        <div style="margin-bottom:16px;">${issueRows}</div>
        <div style="display:flex; gap:10px;">
            <button id="force-create-btn" style="flex:1; padding:11px; background:#FF8B00; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">⚡ Create for Step ${stepNo}</button>
            <button id="cancel-duplicate-btn" style="flex:1; padding:11px; background:#6B778C; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Cancel</button>
        </div>`;
    document.body.appendChild(dialog);
    document.getElementById('force-create-btn').onclick = async () => {
        dialog.remove(); button.disabled = true; button.textContent = '⏳ Starting...';
        try { await createJiraIssue(caseId, stepNo, jiraProject, button, creds); }
        catch (error) { alert('❌ Error: ' + error.message); button.disabled = false; button.textContent = '🐛 Create JIRA'; }
    };
    document.getElementById('cancel-duplicate-btn').onclick = () => dialog.remove();
}

function showGoldenDialog(key, url) {
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:25px; border-radius:8px; box-shadow:0 4px 25px rgba(0,0,0,0.4); z-index:10000; min-width:480px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
    dialog.innerHTML =
        '<h3 style="margin:0 0 15px 0; color:#00875A; font-size:18px; font-weight:600;">✅ Jira Issue Created Successfully!</h3>' +
        '<div style="margin-bottom:20px; line-height:1.6;">' +
            '<p style="margin:5px 0; color:#000;"><strong>Issue Key:</strong> ' + key + '</p>' +
            '<p style="margin:5px 0; color:#000; word-break:break-all;"><strong>URL:</strong> ' +
                '<a href="' + url + '" target="_blank" style="color:#0052CC; text-decoration:underline;">' + url + '</a>' +
            '</p>' +
        '</div>' +
        '<div style="display:flex; gap:12px; width:100%;">' +
            '<button id="copy-url-btn" style="flex:1; padding:12px; background:#00875A; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">📋 Copy URL</button>' +
            '<button id="open-jira-btn" style="flex:1; padding:12px; background:#0052CC; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">🔗 Open Jira</button>' +
            '<button id="close-dialog" style="flex:1; padding:12px; background:#6B778C; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Close</button>' +
        '</div>';
    document.body.appendChild(dialog);
    document.getElementById('copy-url-btn').onclick = function () { navigator.clipboard.writeText(url); this.textContent = '✅ Copied!'; };
    document.getElementById('open-jira-btn').onclick = () => window.open(url, '_blank');
    document.getElementById('close-dialog').onclick = () => dialog.remove();
}

const observer = new MutationObserver(() => injectButton());
observer.observe(document.body, { childList: true, subtree: true });
injectButton();