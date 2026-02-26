import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  errors: Array<{ timestamp: number; message: string }>;
}

export function StatusBar({ errors }: StatusBarProps) {
  const lastError = errors.length > 0 ? errors[errors.length - 1] : undefined;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text dimColor>
        <Text bold>q</Text>:quit
        <Text bold>p</Text>:pause/resume
        <Text bold>r</Text>:refresh
      </Text>
      {lastError && (
        <Text color="red" wrap="wrap">
          Last error: {lastError.message}
        </Text>
      )}
    </Box>
  );
}
