package com.testrail.jira;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.google.gson.*;

import java.util.Map;

public class LambdaHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private static final Gson GSON = new Gson();

    // Reuse across warm invocations — expensive to initialize
    private static final BedrockProcessor PROCESSOR;
    static {
        try {
            PROCESSOR = new BedrockProcessor();
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize BedrockProcessor", e);
        }
    }

    @Override
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent event, Context context) {
        Map<String, String> cors = Map.of(
                "Access-Control-Allow-Origin", "*",
                "Access-Control-Allow-Methods", "POST, OPTIONS",
                "Access-Control-Allow-Headers", "Content-Type",
                "Content-Type", "application/json"
        );

        // Handle OPTIONS preflight
        String httpMethod = event.getHttpMethod();
        if (httpMethod == null || httpMethod.isBlank()) {
            Map<String, String> headers = event.getHeaders();
            if (headers != null) {
                httpMethod = headers.getOrDefault("x-http-method", "");
            }
        }
        if ("OPTIONS".equalsIgnoreCase(httpMethod)) {
            return new APIGatewayProxyResponseEvent()
                    .withStatusCode(200)
                    .withHeaders(cors)
                    .withBody("");
        }

        try {
            String rawBody = event.getBody();
            if (rawBody == null || rawBody.isBlank()) {
                return response(400, error("Request body is empty"), cors);
            }

            JsonObject data = JsonParser.parseString(rawBody).getAsJsonObject();

            String title       = getString(data, "title");
            String stepContent = getString(data, "step_content");
            String expected    = getString(data, "expected");
            String platform    = getString(data, "platform");
            String filePath    = getString(data, "file_path");
            String caseId      = getString(data, "case_id");
            String stepNumber  = getString(data, "step_number");

            if (stepContent.isEmpty() || caseId.isEmpty()) {
                return response(400, error("Missing required fields: step_content, case_id"), cors);
            }

            context.getLogger().log("Generating description for case_id=" + caseId + " step=" + stepNumber);

            String claudeOutput = PROCESSOR.generate(title, stepContent, expected, platform, filePath, caseId, stepNumber);
            if (claudeOutput == null) {
                return response(500, error("Bedrock returned null"), cors);
            }

            String bugTitle = PROCESSOR.extractBugTitle(claudeOutput);
            if (bugTitle == null || bugTitle.isEmpty()) {
                bugTitle = "TestCase C" + caseId + " - Step " + stepNumber + ": Issue in " + title;
            }
            String description = PROCESSOR.stripBugTitleLine(claudeOutput);

            JsonObject ok = new JsonObject();
            ok.addProperty("bug_title", bugTitle);
            ok.addProperty("description", description);
            return response(200, GSON.toJson(ok), cors);

        } catch (Exception e) {
            context.getLogger().log("ERROR: " + e.getMessage());
            return response(500, error(e.getMessage()), cors);
        }
    }

    private static String getString(JsonObject obj, String key) {
        if (!obj.has(key) || obj.get(key).isJsonNull()) return "";
        return obj.get(key).getAsString();
    }

    private static APIGatewayProxyResponseEvent response(int status, String body, Map<String, String> headers) {
        return new APIGatewayProxyResponseEvent().withStatusCode(status).withHeaders(headers).withBody(body);
    }

    private static String error(String msg) {
        JsonObject obj = new JsonObject();
        obj.addProperty("error", msg);
        return GSON.toJson(obj);
    }
}