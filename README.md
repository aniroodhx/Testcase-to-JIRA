# Testcase to JIRA
### Defect generation system

A Chrome extension that lets testers create Jira bugs from TestRail test cases with one click. Claude AI (AWS Bedrock, Claude 4 Sonnet) automatically generates the bug title and description from the failing test step.

---

## Features

- ✅ **AI-generated bug reports** — Claude 4 Sonnet generates the bug title and full Jira description from the TestRail test case and failing step
- ✅ **One-click Jira creation** — no copy-pasting, no manual formatting
- ✅ **Auto Jira token fetch** — fetches your LASSO token from KAM automatically (must be on VPN)
- ✅ **Duplicate prevention** — searches Jira before creating; shows existing bugs and offers Force Create for different steps
- ✅ **Dynamic Jira project selection** — configure any project key in Options (default: KRQ)
- ✅ **Multi TestRail support** — works on both `testrail.p2r.amazon.dev` and `testrail.kindle.amazon.dev`
- ✅ **VPN-aware architecture** — TestRail and Jira are called from the browser (VPN session); Bedrock is called via Lambda

---

## Architecture

```
Chrome Extension (user on VPN/mwinit)
    │
    ├── 1. Fetch TestRail case       → directly from browser (VPN)
    ├── 2. POST test case data       → AWS Lambda
    │         └── Bedrock (Claude 4 Sonnet) generates bug_title + description
    ├── 3. POST to Jira              → background service worker (VPN, no CORS)
    └── 4. Show success dialog with Jira URL
```

Lambda only handles Bedrock — TestRail and Jira are called from the extension because they require Amazon's internal network (VPN). The background service worker bypasses browser CORS restrictions for the Jira call.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Chrome Extension | MV3, content.js, background.js, options page |
| AI Generation | AWS Bedrock — Claude 4 Sonnet (`anthropic.claude-sonnet-4-20250514-v1:0`) |
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
| Bedrock Model | `anthropic.claude-sonnet-4-20250514-v1:0` |
| IAM User | `Jira_to_TC` |

---

## Team Installation (No Setup Required)

The backend (AWS Lambda) is already hosted — teammates only need the Chrome extension.

1. **Download** — [Click here to download the repo as ZIP](https://github.com/aniroodhx/Testcase-to-JIRA/archive/refs/heads/main.zip), unzip it
2. **Load Extension** — Go to `chrome://extensions` → Enable **Developer mode** → Click **Load unpacked** → select the `chrome-extension/` folder
3. **Configure** — Click the extension icon → **Options**, fill in:
   - TestRail Email + API Key
   - TestRail URL (`https://testrail.p2r.amazon.dev`)
   - Jira URL (`https://issues.labcollab.net`)
   - Jira Project Key (e.g. `KRQ`)
   - Click **🔄 Auto-fetch** for the Jira token (must be on VPN)
4. **Connect to VPN** (mwinit) before using

That's it. No Python, no Java, no server to run.

---

## Project Structure

```
TestcasetoJIRA/
├── pom.xml
├── template.yaml                        ← SAM template
├── samconfig.toml
├── chrome-extension/
│   ├── manifest.json                    ← MV3, permissions + host_permissions
│   ├── content.js                       ← Injects button, fetches TestRail, calls Lambda
│   ├── background.js                    ← Handles Jira POST + auto token fetch (no CORS)
│   ├── options.html                     ← Settings page
│   ├── options.js                       ← Saves/loads credentials + auto-fetch token
│   └── styles.css
└── src/main/java/com/testrail/jira/
    ├── LambdaHandler.java               ← API Gateway handler, Bedrock-only
    ├── BedrockProcessor.java            ← Bedrock/Claude logic
    └── resources/Jira_prompt.txt        ← Prompt template
```

---

## Setup & Installation

### 1. Deploy Lambda

```bash
mvn clean package -DskipTests && sam deploy
```

### 2. Load Chrome Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder

### 3. Configure Settings

1. Click the extension icon → **Options** (or right-click → Extension options)
2. Fill in:
   - **TestRail Email** — your Amazon email
   - **TestRail API Key** — from TestRail profile settings
   - **TestRail URL** — `https://testrail.p2r.amazon.dev`
   - **Jira URL** — `https://issues.labcollab.net`
   - **Jira Bearer Token** — click **🔄 Auto-fetch** (must be on VPN)
   - **Jira Project Key** — e.g. `KRQ`
3. Click **💾 Save Settings**

---

## Usage

1. Connect to VPN (mwinit)
2. Open any test case on TestRail
3. Click **🐛 Create JIRA**
4. Enter the failing step number
5. Claude generates the bug title and description
6. Jira issue is created automatically
7. Success dialog shows the issue key and URL

If a bug already exists for that test case, a warning dialog shows existing issues. Click **⚡ Force Create New Bug** to create another one for a different step.

---

## Refreshing the Jira Token

The Jira LASSO token expires every 12 hours. To refresh:

1. Open Extension Options
2. Click **🔄 Auto-fetch** next to the Jira Bearer Token field
3. Token is fetched from `kam.labcollab.net` and saved automatically

Must be on VPN for this to work.

---

## Known Limitations

- Jira token expires every 12 hours (auto-fetch handles this)
- Duplicate prevention has a rare race condition if two testers click at the exact same millisecond (server-side lock not implemented)
- Lambda must have IAM permissions for Bedrock in `us-west-2`
