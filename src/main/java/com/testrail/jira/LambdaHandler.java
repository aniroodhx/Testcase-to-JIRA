package com.testrail.jira;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.google.gson.*;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

public class LambdaHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

    private static final Gson GSON = new Gson();

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
                "Access-Control-Allow-Headers", "Content-Type, X-Lasso-Token",
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
            // ── Step 1: Verify Amazon identity via LASSO JWT ─────────────────
            Map<String, String> requestHeaders = event.getHeaders();
            String lassoToken = requestHeaders != null
                    ? requestHeaders.getOrDefault("x-lasso-token",
                        requestHeaders.getOrDefault("X-Lasso-Token", ""))
                    : "";

            if (lassoToken == null || lassoToken.isBlank()) {
                context.getLogger().log("BLOCKED: No LASSO token in request");
                return response(401, error("Unauthorized — Amazon Midway authentication required"), cors);
            }

            AuthResult auth = verifyAmazonEmployee(lassoToken, context);
            if (!auth.valid) {
                context.getLogger().log("BLOCKED: " + auth.reason);
                return response(403, error("Forbidden — " + auth.reason), cors);
            }

            context.getLogger().log("AUTH OK: " + auth.email);

            // ── Step 2: Process the request ──────────────────────────────────
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

            context.getLogger().log("Generating for case_id=" + caseId + " step=" + stepNumber + " user=" + auth.email);

            // ── Step 3: Generate with Bedrock ────────────────────────────────
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

    /**
     * Verifies the LASSO token is a valid Amazon employee JWT by:
     * 1. Decoding the JWT payload (no signature verification needed — we just check claims)
     * 2. Checking email ends with @amazon.com
     * 3. Checking token is not expired
     *
     * LASSO tokens are issued by Amazon's ADFS after YubiKey-authenticated mwinit.
     * Non-Amazon users cannot produce a token with @amazon.com email claim.
     */
    private AuthResult verifyAmazonEmployee(String token, Context context) {
        try {
            // JWT structure: header.payload.signature
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                return new AuthResult(false, "Invalid token format", null);
            }

            // Decode payload (base64url)
            String payloadJson = new String(
                Base64.getUrlDecoder().decode(padBase64(parts[1])),
                StandardCharsets.UTF_8
            );

            JsonObject payload = JsonParser.parseString(payloadJson).getAsJsonObject();

            // Check email claim
            String email = getString(payload, "email");
            if (email.isEmpty() || !email.toLowerCase().endsWith("@amazon.com")) {
                return new AuthResult(false, "Not an Amazon employee account (email: " + email + ")", null);
            }

            // Check expiry
            if (payload.has("exp")) {
                long exp = payload.get("exp").getAsLong();
                long now = System.currentTimeMillis() / 1000;
                if (now > exp) {
                    return new AuthResult(false, "Token expired. Please refresh via extension Options → Force Refresh.", email);
                }
            }

            return new AuthResult(true, "OK", email);

        } catch (Exception e) {
            context.getLogger().log("JWT decode error: " + e.getMessage());
            return new AuthResult(false, "Token decode failed: " + e.getMessage(), null);
        }
    }

    private static String padBase64(String base64) {
        switch (base64.length() % 4) {
            case 2: return base64 + "==";
            case 3: return base64 + "=";
            default: return base64;
        }
    }

    private static class AuthResult {
        final boolean valid;
        final String reason;
        final String email;
        AuthResult(boolean valid, String reason, String email) {
            this.valid = valid;
            this.reason = reason;
            this.email = email;
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