const api = typeof browser !== 'undefined' ? browser : chrome;
const LAMBDA_URL = 'https://p39n1seqxd.execute-api.us-west-2.amazonaws.com/generate-description';

function extractCaseId() {
    const match = window.location.href.match(/\/cases\/view\/(\d+)/);
    return match ? match[1] : null;
}

async function loadCredentials() {
    return new Promise((resolve) => {
        api.storage.local.get(
            ['testrail_email', 'testrail_api_key', 'testrail_url', 'jira_url', 'jira_api_token', 'jira_project'],
            resolve
        );
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
        const stepNo = prompt('Enter the failing step number:');
        if (stepNo && !isNaN(stepNo)) {
            button.disabled = true;
            button.textContent = '⏳ Starting...';
            handleCreateJira(caseId, stepNo, button);
        }
    };

    buttonContainer.appendChild(button);
    const insertionPoint = document.querySelector('.content-header') || document.querySelector('#content-inner');
    if (insertionPoint) {
        insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
    }
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

// Lambda call — passes LASSO token as X-Lasso-Token header for Amazon identity verification
// Only YubiKey-authenticated Amazon employees can produce a valid LASSO token
async function callLambda(testCase, step, creds) {
    const rawFilePath = testCase.custom_filepath || testCase.file_path || '';
    const filePath = rawFilePath.replace(/!\[\]\([^)]*\)/g, '').trim();
    const platform = testCase.custom_platform || '[Filled by tester]';

    const payload = {
        title: testCase.title || '',
        step_content: step.content,
        expected: step.expected,
        platform: platform,
        file_path: filePath,
        case_id: String(testCase.id),
        step_number: step.step_number
    };

    const response = await fetch(LAMBDA_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Lasso-Token': creds.jira_api_token  // LASSO token = Amazon Midway identity proof
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
            jiraProject: creds.jira_project || 'KRQ',
            caseId
        }, (response) => {
            if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
            else if (response.error) reject(new Error(response.error));
            else resolve(response.issues);
        });
    });
}

async function postToJira(caseId, stepNo, bugTitle, description, creds) {
    return new Promise((resolve, reject) => {
        api.runtime.sendMessage({
            type: 'CREATE_JIRA',
            jiraUrl: creds.jira_url,
            jiraToken: creds.jira_api_token,
            jiraProject: creds.jira_project || 'KRQ',
            caseId,
            stepNo,
            bugTitle,
            description
        }, (response) => {
            if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
            else if (response.error) reject(new Error(response.error));
            else resolve(response);
        });
    });
}

async function handleCreateJira(caseId, stepNo, button) {
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
                showSameStepWarning(sameStepIssue, existingIssues, creds, caseId, stepNo, button);
            } else {
                button.disabled = false;
                button.textContent = '🐛 Create JIRA';
                showDuplicateDialog(existingIssues, creds, caseId, stepNo, button);
            }
            return;
        }

        await createJiraIssue(caseId, stepNo, button, creds);

    } catch (error) {
        alert('❌ Error: ' + error.message);
        button.disabled = false;
        button.textContent = '🐛 Create JIRA';
    }
}

async function createJiraIssue(caseId, stepNo, button, creds) {
    button.disabled = true;

    button.textContent = '⏳ Fetching test case...';
    const testCase = await fetchTestRailCase(caseId, creds);

    button.textContent = '⏳ Generating with Claude...';
    const step = extractStep(testCase, stepNo);
    const { bug_title, description } = await callLambda(testCase, step, creds);

    button.textContent = '⏳ Creating Jira issue...';
    const issue = await postToJira(caseId, stepNo, bug_title, description, creds);

    const issueKey = issue.key;
    const issueUrl = creds.jira_url.replace(/\/$/, '') + '/browse/' + issueKey;

    localStorage.setItem('jira_done_' + caseId, 'true');
    showGoldenDialog(issueKey, issueUrl);
    button.textContent = '✅ Jira Bug Created';
    button.style.background = '#00875A';
}

function showSameStepWarning(sameStepIssue, allIssues, creds, caseId, stepNo, button) {
    const jiraBase = creds.jira_url.replace(/\/$/, '');
    const dialog = document.createElement('div');
    dialog.id = 'same-step-warning-dialog';
    dialog.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:white; padding:25px; border-radius:8px; box-shadow:0 4px 25px rgba(0,0,0,0.5); z-index:10000; width:500px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; border-top: 4px solid #DE350B;';
    dialog.innerHTML =
        `<h3 style="margin:0 0 8px 0; color:#DE350B; font-size:17px; font-weight:600;">🚨 Bug Already Exists for Step ${stepNo}</h3>
        <p style="margin:0 0 14px 0; color:#555; font-size:13px;">A Jira bug was already created for <strong>Step ${stepNo}</strong> of case <strong>C${caseId}</strong>:</p>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; padding:10px; background:#FFF3F3; border-radius:4px; border:1px solid #FFCDD2;">
            <span style="background:#DE350B; color:white; padding:2px 8px; border-radius:3px; font-size:12px; font-weight:bold; white-space:nowrap;">${sameStepIssue.key}</span>
            <span style="flex:1; font-size:13px; color:#333;">${sameStepIssue.summary}</span>
            <span style="font-size:11px; color:#666; white-space:nowrap;">${sameStepIssue.status}</span>
            <a href="${jiraBase}/browse/${sameStepIssue.key}" target="_blank" style="color:#0052CC; font-size:12px; white-space:nowrap;">Open ↗</a>
        </div>
        <p style="margin:0 0 16px 0; color:#DE350B; font-size:13px; font-weight:bold;">⚠️ Are you sure you want to create another bug for the same step?</p>
        <div style="display:flex; gap:10px;">
            <button id="confirm-same-step-btn" style="flex:1; padding:11px; background:#DE350B; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Yes, Force Create Anyway</button>
            <button id="cancel-same-step-btn" style="flex:1; padding:11px; background:#6B778C; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; font-size:13px;">Cancel</button>
        </div>`;
    document.body.appendChild(dialog);
    document.getElementById('confirm-same-step-btn').onclick = async () => {
        dialog.remove();
        button.disabled = true;
        button.textContent = '⏳ Starting...';
        try { await createJiraIssue(caseId, stepNo, button, creds); }
        catch (error) { alert('❌ Error: ' + error.message); button.disabled = false; button.textContent = '🐛 Create JIRA'; }
    };
    document.getElementById('cancel-same-step-btn').onclick = () => dialog.remove();
}

function showDuplicateDialog(issues, creds, caseId, stepNo, button) {
    const jiraBase = creds.jira_url.replace(/\/$/, '');
    const issueRows = issues.map(i => {
        const stepBadge = i.stepNo
            ? `<span style="background:#6B778C; color:white; padding:2px 6px; border-radius:3px; font-size:11px; white-space:nowrap;">Step ${i.stepNo}</span>`
            : '';
        return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; padding:8px; background:#f4f5f7; border-radius:4px;">
            <span style="background:#0052CC; color:white; padding:2px 8px; border-radius:3px; font-size:12px; font-weight:bold; white-space:nowrap;">${i.key}</span>
            ${stepBadge}
            <span style="flex:1; font-size:13px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${i.summary}">${i.summary}</span>
            <span style="font-size:11px; color:#666; white-space:nowrap;">${i.status}</span>
            <a href="${jiraBase}/browse/${i.key}" target="_blank" style="color:#0052CC; font-size:12px; white-space:nowrap;">Open ↗</a>
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
        try { await createJiraIssue(caseId, stepNo, button, creds); }
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