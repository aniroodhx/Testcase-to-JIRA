package com.testrail.jira;

import com.google.gson.*;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.InvokeModelRequest;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.stream.Collectors;

public class BedrockProcessor {

    private static final String MODEL_ID = "anthropic.claude-sonnet-4-20250514-v1:0";
    private static final Gson GSON = new Gson();

    private final BedrockRuntimeClient bedrock;
    private final String promptTemplate;

    public BedrockProcessor() throws IOException {
        this.bedrock = BedrockRuntimeClient.builder()
                .region(Region.US_WEST_2)
                .build();
        this.promptTemplate = loadPromptTemplate();
    }

    private String loadPromptTemplate() throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("Jira_prompt.txt")) {
            if (is == null) throw new IOException("Jira_prompt.txt not found in resources");
            return new String(is.readAllBytes(), StandardCharsets.UTF_8).strip();
        }
    }

    public String generate(String title, String stepContent, String expected,
                           String platform, String filePath, String caseId, String stepNumber) {
        try {
            String prompt = promptTemplate
                    .replace("{title}", title)
                    .replace("{step_content}", stepContent)
                    .replace("{expected}", expected)
                    .replace("{platform}", platform.isEmpty() ? "[Filled by tester]" : platform)
                    .replace("{file_path}", filePath)
                    .replace("{case_id}", caseId)
                    .replace("{step_number}", stepNumber);

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

            var response = bedrock.invokeModel(InvokeModelRequest.builder()
                    .modelId(MODEL_ID)
                    .contentType("application/json")
                    .body(SdkBytes.fromUtf8String(GSON.toJson(body)))
                    .build());

            JsonObject resp = JsonParser.parseString(response.body().asUtf8String()).getAsJsonObject();
            if (resp.has("content") && resp.get("content").isJsonArray()) {
                return resp.getAsJsonArray("content").get(0).getAsJsonObject().get("text").getAsString();
            }
        } catch (Exception e) {
            System.err.println("Bedrock error: " + e.getMessage());
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

    public String stripBugTitleLine(String content) {
        return Arrays.stream(content.split("\n"))
                .filter(line -> !line.strip().startsWith("Bug Title:"))
                .collect(Collectors.joining("\n"))
                .strip();
    }
}