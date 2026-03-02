import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  label: string;
  hint?: string;
  mask?: boolean;
  onSubmit: (value: string) => void;
}

export function TextInput({ label, hint, mask, onSubmit }: TextInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      if (value.length > 0) {
        onSubmit(value);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    // Ignore control characters
    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
      return;
    }
    if (input) {
      setValue((prev) => prev + input);
    }
  });

  const displayValue = mask ? '*'.repeat(value.length) : value;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color="cyan" bold>{label}:</Text>
        {hint && <Text dimColor>({hint})</Text>}
      </Box>
      <Box gap={1}>
        <Text color="green">&gt;</Text>
        <Text>{displayValue}</Text>
        <Text color="cyan">|</Text>
      </Box>
    </Box>
  );
}
