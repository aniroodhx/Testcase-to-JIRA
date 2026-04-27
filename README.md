# Testcase To JIRA

Automatically creates bugs (Jira) from TestRail test cases using Claude AI (AWS Bedrock).

## Project layout

```
TestcaseToJIRA/
├── pom.xml                          # Maven build
├── credentials.json                 # Your API keys (not committed)
├── chrome-extension/                # Chrome extension — injects button on TestRail
└── src/main/
    ├── resources/Jira_prompt.txt    # Claude prompt template
    └── java/com/testrail/jira/
        ├── Credentials.java         # Maps credentials.json
        ├── TestRailToJira.java      # Core logic: TestRail → Claude → Jira
        ├── ApiServer.java           # HTTP server on :5000
        └── Main.java                # CLI entry point
```

## Prerequisites

- Java 17+
- Maven 3.8+
- AWS credentials configured (`~/.aws/credentials` or env vars) with Bedrock access in `us-west-2`

## Build

```bash
mvn package -q
# Produces: target/testrail-to-jira-1.0.0.jar
```

## Run

### API server (used by the Chrome extension)

```bash
java -jar target/testrail-to-jira-1.0.0.jar
# Listening on http://localhost:5000
```

### Command line

```bash
java -cp target/testrail-to-jira-1.0.0.jar com.testrail.jira.Main <case_id> <step_no>
# e.g.
java -cp target/testrail-to-jira-1.0.0.jar com.testrail.jira.Main C12345 3
```

## Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. Navigate to any TestRail case (`/cases/view/<id>`) — the **🐛 Create JIRA** button will appear

## License

Copyright © 2026 Anirudh S. Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
