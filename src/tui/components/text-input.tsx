import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  label: string;
  hint?: string;
  mask?: boolean;
  onSubmit: (value: string) => void;
  onBack?: () => void;
  accentColor?: string;
}

export function TextInput({ label, hint, mask, onSubmit, onBack, accentColor = '#00d4ff' }: TextInputProps) {
  const [value, setValue] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blinking cursor
  useEffect(() => {
    const timer = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(timer);
  }, []);

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
    if (key.escape && onBack) {
      onBack();
      return;
    }
    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
      return;
    }
    if (input) {
      setValue((prev) => prev + input);
    }
  });

  const displayValue = mask ? '\u2022'.repeat(value.length) : value;
  const cursor = cursorVisible ? '\u2588' : ' ';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color={accentColor} bold>{label}</Text>
        {hint && <Text color="#555555">({hint})</Text>}
      </Box>
      <Box gap={0} marginTop={0}>
        <Text color={accentColor}>{'\u276f'} </Text>
        <Text color="white">{displayValue}</Text>
        <Text color={accentColor}>{cursor}</Text>
      </Box>
      {value.length === 0 && (
        <Text color="#444444">  Type your value and press Enter{onBack ? ' · Esc to go back' : ''}</Text>
      )}
    </Box>
  );
}
