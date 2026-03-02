import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  errors: Array<{ timestamp: number; message: string }>;
}

function KeyBadge({ keyChar, label }: { keyChar: string; label: string }) {
  return (
    <Box gap={0}>
      <Text color="#00d4ff" bold> {keyChar} </Text>
      <Text color="#888888">{label}</Text>
    </Box>
  );
}

export function StatusBar({ errors }: StatusBarProps) {
  const lastError = errors.length > 0 ? errors[errors.length - 1] : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#333333"
      paddingX={1}
      marginTop={1}
    >
      <Box gap={2}>
        <KeyBadge keyChar="q" label="quit" />
        <Text color="#333333">{'\u2502'}</Text>
        <KeyBadge keyChar="p" label="pause/resume" />
        <Text color="#333333">{'\u2502'}</Text>
        <KeyBadge keyChar="r" label="refresh" />
      </Box>
      {lastError && (
        <Box marginTop={1}>
          <Text color="red" bold>{'\u2717'} </Text>
          <Text color="red" wrap="wrap">{lastError.message}</Text>
        </Box>
      )}
    </Box>
  );
}
