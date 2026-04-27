# TestRail → Jira (Java)

Java port of the Python `TestCaseToJira` project.  
Same functionality: fetch a TestRail test case, call Claude via AWS Bedrock, create a Jira bug.

## Project layout

```
TestCaseToJira/
├── pom.xml                          # Maven build
├── credentials.json                 # Your API keys (same file as Python version)
├── Jira_prompt.txt                  # Claude prompt template (unchanged)
├── chrome-extension/                # Unchanged – still points to localhost:5000
└── src/main/java/com/testrail/jira/
    ├── Credentials.java             # Maps credentials.json
    ├── TestRailToJira.java          # Core logic (port of functions.py)
    ├── ApiServer.java               # HTTP server on :5000 (port of api_server.py)
    └── Main.java                    # CLI entry point
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

The Chrome extension calls `POST /create-jira-bug` with `{ case_id, step_no }` — identical to the Python version.

### Command line

```bash
java -cp target/testrail-to-jira-1.0.0.jar com.testrail.jira.Main <case_id> <step_no>
# e.g.
java -cp target/testrail-to-jira-1.0.0.jar com.testrail.jira.Main C12345 3
```

## Chrome extension

Load `chrome-extension/` as an unpacked extension in Chrome — no changes needed.  
It still calls `http://localhost:5000/create-jira-bug`.
