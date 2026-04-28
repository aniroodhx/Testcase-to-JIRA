package com.testrail.jira;

import com.google.gson.*;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.client5.http.ssl.NoopHostnameVerifier;
import org.apache.hc.client5.http.ssl.SSLConnectionSocketFactoryBuilder;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.http.io.entity.StringEntity;
import org.apache.hc.core5.ssl.SSLContextBuilder;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.util.*;

public class TestRailToJira {

    private static final String MODEL_ID = "anthropic.claude-3-sonnet-20240229-v1:0";
    
    // Set this to true to test without AWS access
    private boolean isMockMode = true; 

    private final Credentials creds;
    private BedrockRuntimeClient bedrock;
    private final CloseableHttpClient http;
    private final String promptTemplate;
    private final Gson gson = new Gson();

    public TestRailToJira(Credentials creds) throws Exception {
        this.creds = creds;
        this.creds.testrail_url = creds.testrail_url.replaceAll("/$", "");
        this.creds.jira_url = creds.jira_url.replaceAll("/$", "");

        // Only initialize AWS if not in mock mode
        if (!isMockMode) {
            try {
                this.bedrock = BedrockRuntimeClient.builder()
                        .region(Region.US_WEST_2)
                        .build();
            } catch (Exception e) {
                System.err.println("Warning: AWS Bedrock Client failed to initialize. Reverting to Mock Mode.");
            }
        }

        var sslContext = SSLContextBuilder.create()
                .loadTrustMaterial(null, (chain, authType) -> true)
                .build();
        var connManager = PoolingHttpClientConnectionManagerBuilder.create()
                .setSSLSocketFactory(SSLConnectionSocketFactoryBuilder.create()
                        .setSslContext(sslContext)
                        .setHostnameVerifier(NoopHostnameVerifier.INSTANCE)
                        .build())
                .build();
        this.http = HttpClients.custom()
                .setConnectionManager(connManager)
                .build();

        this.promptTemplate = loadPromptTemplate();
    }

    private String loadPromptTemplate() throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("Jira_prompt.txt")) {
            if (is == null) {
                throw new IOException("Resource not found: Jira_prompt.txt in src/main/resources/");
            }
            return new String(is.readAllBytes(), StandardCharsets.UTF_8).strip();
        }
    }

    public JsonObject getTestCaseDetails(String caseIdRaw) {
        try {
            int caseId = Integer.parseInt(caseIdRaw.replace("C", "").strip());
            String url = creds.testrail_url + "/index.php?/api/v2/get_case/" + caseId;
            var req = new HttpGet(url);
            String basicToken = Base64.getEncoder().encodeToString(
                    (creds.testrail_email + ":" + creds.testrail_api_key).getBytes(StandardCharsets.UTF_8));
            req.setHeader("Authorization", "Basic " + basicToken);
            req.setHeader("Content-Type", "application/json");

            try (var resp = http.executeOpen(null, req, null)) {
                String body = EntityUtils.toString(resp.getEntity());
                JsonObject tc = JsonParser.parseString(body).getAsJsonObject();
                tc.addProperty("platform", getStringOrEmpty(tc, "custom_platform"));
                tc.addProperty("file_path", getStringOrEmpty(tc, "custom_filepath"));
                return tc;
            }
        } catch (Exception e) {
            System.err.println("Error fetching test case: " + e.getMessage());
            return null;
        }
    }

    public Map<String, String> extractStep(JsonObject testCase, String stepNoStr) {
        try {
            int stepIndex = Integer.parseInt(stepNoStr) - 1;
            JsonElement stepsEl = testCase.get("custom_steps_separated");
            if (stepsEl != null && stepsEl.isJsonArray()) {
                JsonArray arr = stepsEl.getAsJsonArray();
                if (stepIndex >= 0 && stepIndex < arr.size()) {
                    JsonObject s = arr.get(stepIndex).getAsJsonObject();
                    return Map.of(
                            "content", getStringOrEmpty(s, "content"),
                            "expected", getStringOrEmpty(s, "expected"),
                            "step_number", stepNoStr
                    );
                }
                return null;
            }
            String stepsText = firstNonEmpty(testCase, "custom_steps", "steps", "custom_steps_separated");
            String expectedText = firstNonEmpty(testCase, "custom_expected", "expected", "expected_result");
            List<String> stepLines = splitLines(stepsText);
            List<String> expectedLines = splitLines(expectedText);

            if (stepIndex >= 0 && stepIndex < stepLines.size()) {
                String expected = stepIndex < expectedLines.size() ? expectedLines.get(stepIndex) : "No expected result";
                return Map.of("content", stepLines.get(stepIndex), "expected", expected, "step_number", stepNoStr);
            }
        } catch (Exception e) {
            System.err.println("Error extracting step: " + e.getMessage());
        }
        return null;
    }

    public String processWithClaude(JsonObject testCase, Map<String, String> step) {
        if (isMockMode || bedrock == null) {
            System.out.println("⚠️ RUNNING IN MOCK MODE: Generating dummy response...");
            return "Bug Title: [Feature] - Mock issue found in " + step.get("content") + "\n\n" +
                    "*Caught by:* [Filled by tester]\n" +
                    "*Found in ASIN:* " + getStringOrEmpty(testCase, "file_path") + "\n" +
                    "*Repro rate:* [Filled by tester]\n" +
                    "*Issue found in Platform:* " + getStringOrEmpty(testCase, "platform") + "\n" +
                    "*Device Specific (Yes/No):* [Filled by tester]\n" +
                    "*Issue specific to Capability:* [Filled by tester]\n" +
                    "*Test Account:* [Filled by tester]\n\n" +
                    "*Build & Device used:*\n[Filled by tester]\n\n" +
                    "*Steps to Reproduce:*\n" + step.get("content") + "\n\n" +
                    "*Actual Result:* [Filled by tester]\n" +
                    "*Expected Result:* " + step.get("expected") + "\n\n" +
                    "*Attachments:* [Filled by tester]";
        }

        try {
            String title = getStringOrEmpty(testCase, "title");
            String platform = getStringOrEmpty(testCase, "platform");
            String filePath = getStringOrEmpty(testCase, "file_path");
            String stepNumber = step.get("step_number");
            String stepContent = step.get("content");
            String expected = step.get("expected");
            String caseId = testCase.get("id").toString();

            System.out.printf("%nProcessing Step %s:%n", stepNumber);
            String prompt = promptTemplate.replace("{title}", title).replace("{step_content}", stepContent)
                    .replace("{expected}", expected).replace("{case_id}", caseId)
                    .replace("{platform}", platform).replace("{file_path}", filePath).replace("{step_number}", stepNumber);

            JsonObject body = new JsonObject();
            body.addProperty("anthropic_version", "bedrock-2023-05-31");
            body.addProperty("max_tokens", 2000);
            body.addProperty("temperature", 0.7);
            body.addProperty("top_p", 0.9);
            JsonArray messages = new JsonArray();
            JsonObject msg = new JsonObject();
            msg.addProperty("role", "user");
            msg.addProperty("content", prompt);
            messages.add(msg);
            body.add("messages", messages);

            InvokeModelResponse response = bedrock.invokeModel(InvokeModelRequest.builder()
                    .modelId(MODEL_ID).contentType("application/json")
                    .body(SdkBytes.fromUtf8String(gson.toJson(body))).build());

            JsonObject resp = JsonParser.parseString(response.body().asUtf8String()).getAsJsonObject();
            if (resp.has("content") && resp.get("content").isJsonArray()) {
                return resp.getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString();
            }
        } catch (Exception e) {
            System.err.println("Error processing with Claude: " + e.getMessage());
        }
        return null;
    }

    public String extractBugTitle(String content) {
        for (String line : content.split("\n")) {
            if (line.strip().startsWith("Bug Title:")) {
                return line.replace("Bug Title:", "").replace("**", "").strip();
            }
        }
        return null;
    }

    public JsonObject createJiraIssue(String processedContent, JsonObject testCase, String stepNo) {
        try {
            String bugTitle = extractBugTitle(processedContent);
            if (bugTitle == null || bugTitle.isEmpty()) {
                bugTitle = String.format("TestCase C%s - Step %s: Issue in %s",
                        testCase.get("id").getAsString(), stepNo, getStringOrEmpty(testCase, "title"));
            }

            JsonObject fields = new JsonObject();
            JsonObject project = new JsonObject();
            project.addProperty("key", "KRQ");
            fields.add("project", project);
            fields.addProperty("summary", bugTitle);
            fields.addProperty("description", processedContent);
            JsonObject issueType = new JsonObject();
            issueType.addProperty("name", "Bug");
            fields.add("issuetype", issueType);
            JsonArray labels = new JsonArray();
            labels.add("automated_creation");
            fields.add("labels", labels);

            JsonObject payload = new JsonObject();
            payload.add("fields", fields);

            var post = new HttpPost(creds.jira_url + "/rest/api/2/issue");
            
            // Reverted to use Personal Access Token (Bearer)
            post.setHeader("Authorization", "Bearer " + creds.jira_api_token);
            post.setHeader("Content-Type", "application/json");
            post.setEntity(new StringEntity(gson.toJson(payload), ContentType.APPLICATION_JSON));

            try (var resp = http.executeOpen(null, post, null)) {
                String respBody = EntityUtils.toString(resp.getEntity());
                if (resp.getCode() == 201) {
                    JsonObject issue = JsonParser.parseString(respBody).getAsJsonObject();
                    System.out.println("Jira URL: " + creds.jira_url + "/browse/" + issue.get("key").getAsString());
                    return issue;
                } else {
                    System.err.println("Jira Error: " + respBody);
                }
            }
        } catch (Exception e) {
            System.err.println("Error creating Jira issue: " + e.getMessage());
        }
        return null;
    }

    public boolean generateAndCreateJira(String caseId, String stepNo) {
        JsonObject testCase = getTestCaseDetails(caseId);
        if (testCase == null) return false;
        Map<String, String> step = extractStep(testCase, stepNo);
        if (step == null) return false;
        String content = processWithClaude(testCase, step);
        return content != null && createJiraIssue(content, testCase, stepNo) != null;
    }

    private String getStringOrEmpty(JsonObject obj, String key) {
        if (obj == null || !obj.has(key) || obj.get(key).isJsonNull()) return "";
        return obj.get(key).getAsString();
    }

    private String firstNonEmpty(JsonObject obj, String... keys) {
        for (String k : keys) {
            String v = getStringOrEmpty(obj, k);
            if (!v.isEmpty()) return v;
        }
        return "";
    }

    private List<String> splitLines(String text) {
        if (text == null || text.isBlank()) return List.of();
        return Arrays.stream(text.split("\n")).map(String::strip).filter(s -> !s.isEmpty()).toList();
    }
}