package com.testrail.jira;

/**
 * Command-line entry point — mirrors the if __name__ == "__main__" block in functions.py.
 *
 * Usage:  java -cp testrail-to-jira.jar com.testrail.jira.Main <case_id> <step_no>
 */
public class Main {

    public static void main(String[] args) {
        if (args.length != 2) {
            System.out.println("Usage: java -cp testrail-to-jira.jar com.testrail.jira.Main <testcase_id> <step_no>");
            return;
        }

        String caseId = args[0];
        String stepNo = args[1];

        Credentials creds = ApiServer.loadCredentials();
        if (creds == null) {
            System.out.println("Failed to load credentials from credentials.json");
            return;
        }

        // Single, clean check for all required fields
        if (creds.testrail_email == null || creds.testrail_api_key == null ||
            creds.testrail_url == null || creds.jira_url == null ||
            creds.jira_user == null || creds.jira_api_token == null) {
            System.out.println("Error: One or more required credentials are missing in credentials.json");
            return;
        }

        try {
            TestRailToJira converter = new TestRailToJira(creds);
            boolean success = converter.generateAndCreateJira(caseId, stepNo);
            if (success) {
                System.out.println("Successfully generated content and created Jira issue!");
            } else {
                System.out.println("Failed to complete the process. Check logs for details.");
            }
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
        }
    }
}