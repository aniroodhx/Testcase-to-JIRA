package com.testrail.jira;

import com.google.gson.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.*;

import static spark.Spark.*;

/**
 * Java port of api_server.py.
 * Starts an HTTP server on port 5000 with a single POST /create-jira-bug endpoint.
 *
 * Run:  java -jar testrail-to-jira.jar
 */
public class ApiServer {

    private static final Gson GSON = new Gson();

    public static void main(String[] args) {
        port(5000);

        // Enable CORS for the Chrome extension (same as flask_cors)
        before((req, res) -> {
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
            res.header("Access-Control-Allow-Headers", "Content-Type");
        });
        options("/*", (req, res) -> "OK");

        // POST /create-jira-bug
        post("/create-jira-bug", (req, res) -> {
            res.type("application/json");
            try {
                JsonObject data = JsonParser.parseString(req.body()).getAsJsonObject();

                // Extract case_id (same flexible handling as Python)
                String caseId = extractCaseId(data.get("case_id"));
                String stepNo = data.has("step_no") ? data.get("step_no").getAsString() : null;

                if (caseId == null || stepNo == null) {
                    res.status(400);
                    return error("Missing case_id or step_no");
                }

                System.out.printf("Processed Case ID: %s, Step: %s%n", caseId, stepNo);

                Credentials creds = loadCredentials();
                if (creds == null) {
                    res.status(500);
                    return error("Failed to load credentials");
                }

                TestRailToJira converter = new TestRailToJira(creds);

                JsonObject testCase = converter.getTestCaseDetails(caseId);
                if (testCase == null) {
                    res.status(500);
                    return error("Failed to fetch test case");
                }

                var step = converter.extractStep(testCase, stepNo);
                if (step == null) {
                    res.status(500);
                    return error("Failed to extract step");
                }

                String content = converter.processWithClaude(testCase, step);
                if (content == null) {
                    res.status(500);
                    return error("Failed to process with Claude");
                }

                JsonObject issue = converter.createJiraIssue(content, testCase, stepNo);
                if (issue == null) {
                    res.status(500);
                    return error("Failed to create Jira issue");
                }

                String issueKey = issue.get("key").getAsString();
                String issueUrl = "https://issues.labcollab.net/browse/" + issueKey;

                JsonObject ok = new JsonObject();
                ok.addProperty("success", true);
                ok.addProperty("message", "Jira issue created successfully");
                ok.addProperty("issue_key", issueKey);
                ok.addProperty("issue_url", issueUrl);
                return GSON.toJson(ok);

            } catch (Exception e) {
                System.err.println("Error: " + e.getMessage());
                res.status(500);
                return error(e.getMessage());
            }
        });

        System.out.println("Starting API server on http://localhost:5000");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Load credentials.json from working directory — same as load_credentials() in Python. */
    static Credentials loadCredentials() {
        try {
            String json = Files.readString(Path.of("credentials.json"));
            return GSON.fromJson(json, Credentials.class);
        } catch (Exception e) {
            System.err.println("Error loading credentials: " + e.getMessage());
            return null;
        }
    }

    /**
     * Handle case_id coming in as a string, number, or array — mirrors the Python api_server logic.
     */
    private static String extractCaseId(JsonElement el) {
        if (el == null || el.isJsonNull()) return null;

        if (el.isJsonArray()) {
            JsonArray arr = el.getAsJsonArray();
            return arr.isEmpty() ? null : arr.get(arr.size() - 1).getAsString();
        }

        String raw = el.getAsString();
        Matcher m = Pattern.compile("\\d+").matcher(raw);
        return m.find() ? m.group() : raw;
    }

    private static String error(String msg) {
        JsonObject obj = new JsonObject();
        obj.addProperty("error", msg);
        return GSON.toJson(obj);
    }
}
