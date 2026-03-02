import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectItem {
  label: string;
  value: string;
  description?: string;
  icon?: string;
}

interface SelectInputProps {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  accentColor?: string;
}

export function SelectInput({ items, onSelect, accentColor = '#00d4ff' }: SelectInputProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setActiveIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
    }
    if (key.downArrow || input === 'j') {
      setActiveIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
    }
    if (key.return) {
      onSelect(items[activeIndex]);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <Box key={item.value} gap={1}>
            <Text color={isActive ? accentColor : '#555555'}>
              {isActive ? '\u276f' : ' '}
            </Text>
            {item.icon && (
              <Text color={isActive ? accentColor : '#888888'}>
                {item.icon}
              </Text>
            )}
            <Text color={isActive ? 'white' : '#888888'} bold={isActive}>
              {item.label}
            </Text>
            {item.description && (
              <Text color={isActive ? '#666666' : '#444444'}>
                {item.description}
              </Text>
            )}
          </Box>
        );
      })}
      <Box marginTop={1} gap={2}>
        <Text color="#555555">\u2191\u2193 navigate</Text>
        <Text color="#555555">\u21b5 select</Text>
      </Box>
    </Box>
  );
}
