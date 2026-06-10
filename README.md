# Testcase to JIRA
### Defect generation system

A Chrome/Firefox extension that lets testers create Jira bugs from TestRail test cases with one click. Claude AI (AWS Bedrock, Claude 3 Sonnet) automatically generates the bug title and structured description from the failing test step — reducing bug creation time from ~25 minutes to ~2 minutes.

---

## Features

- ✅ **AI-generated bug reports** — Claude 3 Sonnet generates the bug title and full Jira description including all test case steps
- ✅ **One-click Jira creation** — no copy-pasting, no manual formatting
- ✅ **Dynamic project dropdown** — shows all Jira projects you have access to (cached every 24h), no hardcoding
- ✅ **Auto Jira token refresh** — LASSO token auto-fetched on startup and refreshed silently every 6 hours (must be on VPN)
- ✅ **Cross-project duplicate prevention** — searches Jira across all projects before creating; step-level tagging (TC-{caseId}-S{stepNo}); same-step red warning; Force Create for different steps
- ✅ **YubiKey-backed security** — Lambda verifies every request via Amazon Midway LASSO JWT; only Amazon employees can invoke the backend
- ✅ **Multi TestRail support** — works on both `testrail.p2r.amazon.dev` and `testrail.kindle.amazon.dev`
- ✅ **Chrome + Firefox support** — single codebase with browser compatibility shim
- ✅ **Serverless** — AWS Lambda handles AI generation; no local server to run or maintain

---

## Architecture

```
Chrome/Firefox Extension (user on VPN/mwinit)
    │
    ├── 1. Fetch TestRail case       → directly from browser (VPN)
    ├── 2. POST test case data       → AWS Lambda
    │         └── Verifies LASSO JWT (@amazon.com)
    │         └── Bedrock (Claude 3 Sonnet) generates bug_title + description
    ├── 3. POST to Jira              → background service worker (VPN, bypasses CORS)
    └── 4. Show success dialog with Jira URL
```

Lambda only handles Bedrock AI generation — TestRail and Jira are called directly from the browser because they require Amazon's internal VPN. The background service worker bypasses browser CORS restrictions for the Jira call.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome/Firefox Extension | MV3, content.js, background.js, options page |
| AI Generation | AWS Bedrock — Claude 3 Sonnet (`anthropic.claude-3-sonnet-20240229-v1:0`) |
| Backend | Java 17 + AWS Lambda (via SAM) |
| Build | Maven (fat JAR via maven-shade-plugin) |
| AWS SDK | AWS SDK v2 |
| APIs | TestRail REST API, Jira REST API v2 |

---

## AWS Setup

| Resource | Value |
|---|---|
| Account | BCX-GenAI-experiments (721937028696) |
| Region | us-west-2 |
| Lambda | `testcase-to-jira` |
| API Endpoint | `https://p39n1seqxd.execute-api.us-west-2.amazonaws.com/generate-description` |
| Bedrock Model | `anthropic.claude-3-sonnet-20240229-v1:0` |
| IAM User | `Jira_to_TC` |

---

## Team Installation (No Setup Required)

The backend (AWS Lambda) is already hosted — teammates only need the Chrome or Firefox extension.

1. **Download** — [Click here to download the repo as ZIP](https://github.com/aniroodhx/Testcase-to-JIRA/archive/refs/heads/main.zip), unzip it
2. **Load Extension**
   - **Chrome:** Go to `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → select the `chrome-extension/` folder
   - **Firefox:** Go to `about:debugging` → **This Firefox** → **Load Temporary Add-on** → select `manifest.json`
3. **Configure** — Right-click the extension icon → **Options**, fill in:
   - TestRail Email + API Key
   - TestRail URL (`https://testrail.p2r.amazon.dev` or `https://testrail.kindle.amazon.dev`)
   - Jira URL (`https://issues.labcollab.net`)
   - Click **🔄 Auto-fetch** for the Jira token (must be on VPN)
4. **Connect to VPN** (mwinit) before using

That's it. No Python, no Java, no server to run.

---

## Project Structure

```
TestcasetoJIRA/
├── pom.xml
├── template.yaml                        ← SAM template
├── chrome-extension/
│   ├── manifest.json                    ← MV3, permissions + host_permissions
│   ├── content.js                       ← Injects button, fetches TestRail, calls Lambda
│   ├── background.js                    ← Jira POST, auto token fetch, project cache
│   ├── options.html                     ← Settings page
│   ├── options.js                       ← Saves/loads credentials + auto-fetch token
│   └── styles.css
└── src/main/java/com/testrail/jira/
    ├── LambdaHandler.java               ← API Gateway handler, LASSO JWT verification
    ├── BedrockProcessor.java            ← Bedrock/Claude logic
    └── resources/Jira_prompt.txt        ← Prompt template
```

---

## Setup & Installation (For Lambda Maintainer)

### 1. Deploy Lambda

```bash
mvn clean package -DskipTests && sam deploy
```

### 2. Load Chrome Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder

### 3. Configure Settings

1. Right-click extension icon → **Options**
2. Fill in:
   - **TestRail Email** — your Amazon email
   - **TestRail API Key** — from TestRail profile settings
   - **TestRail URL** — `https://testrail.p2r.amazon.dev`
   - **Jira URL** — `https://issues.labcollab.net`
   - **Jira Bearer Token** — click **🔄 Auto-fetch** (must be on VPN)
3. Click **💾 Save Settings**

---

## Usage

1. Connect to VPN (mwinit)
2. Open any test case on TestRail
3. Click **🐛 Create JIRA**
4. Enter the failing step number and select the Jira project from the dropdown
5. Claude generates the bug title, description, and all test case steps
6. Jira issue is created automatically with labels `TC-{caseId}` and `TC-{caseId}-S{stepNo}`
7. Success dialog shows the issue key and URL

**Duplicate detection:**
- If a bug already exists for the same step → red warning dialog requires confirmation
- If a bug exists for a different step → orange dialog shows existing bugs; Force Create proceeds

---

## Security

Every request to Lambda is authenticated via Amazon Midway LASSO JWT:

```
YubiKey touch → mwinit → Midway session → LASSO token (signed by Amazon ADFS)
→ Extension sends token to Lambda
→ Lambda verifies @amazon.com email + expiry
→ Non-Amazon users blocked at every request
```

Credentials are stored in `chrome.storage.local` — encrypted, never written to disk, never in any repository.

---

## Jira Token

The LASSO token auto-refreshes every 6 hours silently in the background. To force refresh:

1. Open Extension Options
2. Click **🔄 Force Refresh** next to the Jira Bearer Token field

Must be on VPN for this to work.

---

## Known Limitations

- Lambda must have IAM `bedrock:InvokeModel` permission for Claude 3 Sonnet in `us-west-2`
- Firefox extension is temporary (reloads on browser restart) — requires loading via `about:debugging` each session
- Duplicate prevention has a rare race condition if two testers click at the exact same millisecond
- Some Jira projects require mandatory custom fields not supported by this tool (e.g. SBR) — create those manually
