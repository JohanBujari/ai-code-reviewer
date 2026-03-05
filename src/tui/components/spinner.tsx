import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../shared/theme';

const FRAMES = ['\u2839', '\u2838', '\u2834', '\u2826', '\u2807', '\u280f', '\u2819', '\u2839'];
const DOTS_FRAMES = ['.  ', '.. ', '...', '   '];

interface SpinnerProps {
  label?: string;
  color?: string;
  showDots?: boolean;
}

export function Spinner({ label, color = THEME.primary, showDots = false }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [dotFrame, setDotFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showDots) return;
    const dotsTimer = setInterval(() => {
      setDotFrame((prev) => (prev + 1) % DOTS_FRAMES.length);
    }, 400);
    return () => clearInterval(dotsTimer);
  }, [showDots]);

  return (
    <Box gap={1}>
      <Text color={color} bold>{FRAMES[frame]}</Text>
      {label && <Text color="white">{label}</Text>}
      {showDots && <Text color={THEME.textDimmer}>{DOTS_FRAMES[dotFrame]}</Text>}
    </Box>
  );
}
