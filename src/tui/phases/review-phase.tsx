import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "../components/text-input";
import { Spinner } from "../components/spinner";
import { THEME } from "../../shared/theme";
import { SEVERITY_STYLES } from "../../shared/constants";
import type { ReviewResult, ReviewComment } from "../../types";

interface ReviewUrlPhaseProps {
  onSubmit: (url: string) => void;
  onBack: () => void;
}

export function ReviewUrlPhase({ onSubmit, onBack }: ReviewUrlPhaseProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>
          {"\u2691"} Review a Pull Request
        </Text>
      </Box>
      <TextInput
        label="PR URL"
        hint="https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}"
        onSubmit={onSubmit}
        onBack={onBack}
      />
    </Box>
  );
}

interface ReviewingPhaseProps {
  prInfo: { prId: number; project: string; repo: string } | null;
  status: string;
}

export function ReviewingPhase({ prInfo, status }: ReviewingPhaseProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>
          {"\u2691"} Review in Progress
        </Text>
      </Box>
      {prInfo && (
        <Box gap={1}>
          <Text color={THEME.textSecondary}>PR</Text>
          <Text color="white" bold>
            #{prInfo.prId}
          </Text>
          <Text color={THEME.textDimmer}>in</Text>
          <Text color={THEME.primary}>
            {prInfo.project}/{prInfo.repo}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Spinner label={status} showDots />
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color={THEME.textDimmer}>Press</Text>
        <Text color={THEME.primary} bold>esc</Text>
        <Text color={THEME.textDimmer}>to cancel</Text>
      </Box>
    </Box>
  );
}

interface ReviewErrorPhaseProps {
  error: string;
}

export function ReviewErrorPhase({ error }: ReviewErrorPhaseProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box
        borderStyle="round"
        borderColor={THEME.error}
        paddingX={1}
        flexDirection="column"
      >
        <Text bold color={THEME.error}>
          {"\u2717"} Review Failed
        </Text>
        <Box marginTop={1}>
          <Text color="#ff8888" wrap="wrap">
            {error}
          </Text>
        </Box>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color={THEME.textDimmer}>Press</Text>
        <Text color={THEME.primary} bold>esc</Text>
        <Text color={THEME.textDimmer}>or</Text>
        <Text color={THEME.primary} bold>q</Text>
        <Text color={THEME.textDimmer}>to go back</Text>
      </Box>
    </Box>
  );
}

function CommentRow({ comment }: { comment: ReviewComment }) {
  const config = SEVERITY_STYLES[comment.severity] ?? {
    color: THEME.textSecondary,
    icon: "\u25cb",
    label: comment.severity.toUpperCase(),
  };

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <Box gap={1}>
        <Text color={config.color} bold>
          {config.icon} {config.label}
        </Text>
        <Text color={THEME.primary}>{comment.filePath}</Text>
        <Text color={THEME.textDimmer}>:{comment.lineNumber}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap" color={THEME.text}>
          {comment.message}
        </Text>
      </Box>
    </Box>
  );
}

interface ReviewDonePhaseProps {
  result: ReviewResult;
  prInfo: { prId: number; project: string; repo: string } | null;
}

export function ReviewDonePhase({ result, prInfo }: ReviewDonePhaseProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor={THEME.primary} paddingX={1}>
        <Box gap={1}>
          <Text color={THEME.primary} bold>
            {"\u2713"} Review Complete
          </Text>
          {prInfo && (
            <Text color={THEME.textDimmer}>
              {"\u2502"} PR #{prInfo.prId} in {prInfo.project}/{prInfo.repo}
            </Text>
          )}
        </Box>
      </Box>

      {/* Comments */}
      <Box flexDirection="column" marginTop={1}>
        <Box gap={1} marginBottom={1}>
          <Text color="white" bold>
            Comments
          </Text>
          <Text color={THEME.textDimmer}>({result.comments.length})</Text>
        </Box>
        {result.comments.length === 0 ? (
          <Box gap={1}>
            <Text color={THEME.success}>{"\u2713"}</Text>
            <Text color={THEME.success}>No issues found. Code looks good!</Text>
          </Box>
        ) : (
          result.comments.map((comment, i) => (
            <CommentRow key={i} comment={comment} />
          ))
        )}
      </Box>

      {/* Footer */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={THEME.border}
        paddingX={1}
        gap={2}
      >
        <Text color={THEME.textDimmer}>Press</Text>
        <Text color={THEME.primary} bold>esc</Text>
        <Text color={THEME.textDimmer}>or</Text>
        <Text color={THEME.primary} bold>q</Text>
        <Text color={THEME.textDimmer}>to go back</Text>
      </Box>
    </Box>
  );
}
