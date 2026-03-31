import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../../shared/theme";

export function SetupGuidePhase() {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={THEME.primary} paddingX={2} paddingY={1} flexDirection="column">
        <Text color={THEME.primary} bold>{'\u2139'} Azure DevOps Setup Guide</Text>

        <Box marginTop={1} flexDirection="column">
          <Text color="white" bold>1. Create a dedicated user (recommended)</Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Create a new user in Azure DevOps named "Axiom" (or similar).
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}This way, review comments will appear as coming from the Axiom
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}agent rather than your personal account.
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="white" bold>2. Generate a Personal Access Token (PAT)</Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Go to Azure DevOps {'\u2192'} User Settings {'\u2192'} Personal Access Tokens
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Create a new token with the following scopes:
          </Text>
          <Text color={THEME.primary}>{"   "}{'\u2022'} Code (Read)</Text>
          <Text color={THEME.primary}>{"   "}{'\u2022'} Pull Request Threads (Read & Write)</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="white" bold>3. Copy the PAT</Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Copy the generated token. You will need it when configuring Axiom.
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}The token is only shown once, so save it securely.
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="white" bold>4. Configure Axiom</Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Select "Watch repositories" or "Review a PR" from the main menu.
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}Enter your organization name, paste the PAT, and choose an AI provider.
          </Text>
          <Text color={THEME.textDim} wrap="wrap">
            {"   "}For Codex run "codex login". For Claude Code run "claude" and then "/login".
          </Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor={THEME.textDimmer} paddingX={1}>
          <Text color={THEME.warning}>{'\u26a0'} </Text>
          <Text color={THEME.warning} wrap="wrap">
            You can use your own PAT instead, but comments on PRs will appear under your name.
          </Text>
        </Box>
      </Box>

      <Box marginTop={1} gap={2} paddingX={1}>
        <Text color={THEME.textDimmer}>Press</Text>
        <Text color={THEME.primary} bold>esc</Text>
        <Text color={THEME.textDimmer}>or</Text>
        <Text color={THEME.primary} bold>q</Text>
        <Text color={THEME.textDimmer}>to go back</Text>
      </Box>
    </Box>
  );
}
