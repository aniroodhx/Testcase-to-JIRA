/**
 * TestRail to Jira - KRQ Project Injection Script
 * THE PIXEL-PERFECT RESTORE: White Background Dialog + Bold Black Labels + Persistent State
 */

function extractCaseId() {
    const currentUrl = window.location.href;
    // Only match the case view URL — NOT /tests/view/ (test run) or any other page
    const match = currentUrl.match(/\/cases\/view\/(\d+)/);
    return match ? match[1] : null;
}

function injectButton() {
    const caseId = extractCaseId();
    // Remove button if we're not on a case view page
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
        button.disabled = true;
    }

    button.onclick = function() {
        const stepNo = prompt('Enter the failing step number:');
        if (stepNo && !isNaN(stepNo)) {
            button.disabled = true;
            button.textContent = '⏳ Creating Jira Bug...';
            createJiraIssue(caseId, stepNo, button);
        }
    };

    buttonContainer.appendChild(button);

    const insertionPoint = document.querySelector('.content-header') || document.querySelector('#content-inner');
    if (insertionPoint) {
        insertionPoint.parentNode.insertBefore(buttonContainer, insertionPoint);
    }
}

async function createJiraIssue(caseId, stepNo, button) {
    try {
        const response = await fetch('http://localhost:5000/create-jira-bug', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ case_id: caseId, step_no: stepNo })
        });

        const data = await response.json();
        if (response.ok) {
            localStorage.setItem('jira_done_' + caseId, 'true');
            showGoldenDialog(data.issue_key, data.issue_url);
            button.textContent = '✅ Jira Bug Created';
            button.style.background = '#00875A';
        } else {
            throw new Error(data.error || 'Failed');
        }
    } catch (error) {
        alert('❌ Error: ' + error.message);
        button.disabled = false;
        button.textContent = '🐛 Create JIRA';
    }
}

function showGoldenDialog(key, url) {
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 25px rgba(0,0,0,0.4); z-index: 10000; min-width: 480px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

    dialog.innerHTML =
        '<h3 style="margin: 0 0 15px 0; color: #00875A; font-size: 18px; font-weight: 600;">✅ Jira Issue Created Successfully!</h3>' +
        '<div style="margin-bottom: 20px; line-height: 1.6;">' +
            '<p style="margin: 5px 0; color: #000;"><strong>Issue Key:</strong> ' + key + '</p>' +
            '<p style="margin: 5px 0; color: #000; word-break: break-all;"><strong>URL:</strong> ' +
                '<a href="' + url + '" target="_blank" style="color: #0052CC; text-decoration: underline;">' + url + '</a>' +
            '</p>' +
        '</div>' +
        '<div style="display: flex; gap: 12px; width: 100%;">' +
            '<button id="copy-url-btn" style="flex: 1; padding: 12px; background: #00875A; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">📋 Copy URL</button>' +
            '<button id="open-jira-btn" style="flex: 1; padding: 12px; background: #0052CC; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">🔗 Open Jira</button>' +
            '<button id="close-dialog" style="flex: 1; padding: 12px; background: #6B778C; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">Close</button>' +
        '</div>';

    document.body.appendChild(dialog);

    document.getElementById('copy-url-btn').onclick = function() {
        navigator.clipboard.writeText(url);
        this.textContent = '✅ Copied!';
    };

    document.getElementById('open-jira-btn').onclick = function() {
        window.open(url, '_blank');
    };

    document.getElementById('close-dialog').onclick = function() { dialog.remove(); };
}

const observer = new MutationObserver(() => injectButton());
observer.observe(document.body, { childList: true, subtree: true });
injectButton();