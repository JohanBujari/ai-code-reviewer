import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../../shared/theme';

interface TextInputProps {
  label: string;
  hint?: string;
  mask?: boolean;
  optional?: boolean;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onBack?: () => void;
  accentColor?: string;
}

export function TextInput({ label, hint, mask, optional, validate, onSubmit, onBack, accentColor = THEME.primary }: TextInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blinking cursor
  useEffect(() => {
    const timer = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(timer);
  }, []);

  useInput((input, key) => {
    if (key.return) {
      // Allow empty submit for optional fields
      if (value.length === 0 && !optional) return;
      if (value.length > 0 && validate) {
        const err = validate(value);
        if (err) { setError(err); return; }
      }
      setError(null);
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      if (error) setError(null);
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
      if (error) setError(null);
    }
  });

  const displayValue = mask ? '\u2022'.repeat(value.length) : value;
  const cursor = cursorVisible ? '\u2588' : ' ';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color={accentColor} bold>{label}</Text>
        {hint && <Text color={THEME.textDimmer}>({hint})</Text>}
      </Box>
      <Box gap={0} marginTop={0}>
        <Text color={accentColor}>{'\u276f'} </Text>
        <Text color="white">{displayValue}</Text>
        <Text color={accentColor}>{cursor}</Text>
      </Box>
      {error && (
        <Text color={THEME.error}>  {'\u2717'} {error}</Text>
      )}
      {!error && value.length === 0 && (
        <Text color={THEME.textDarkest}>  {optional ? 'Press Enter to skip' : 'Type your value and press Enter'}{onBack ? ' · Esc to go back' : ''}</Text>
      )}
    </Box>
  );
}
