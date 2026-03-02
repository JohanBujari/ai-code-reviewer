import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectItem {
  label: string;
  value: string;
  description?: string;
}

interface SelectInputProps {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
}

export function SelectInput({ items, onSelect }: SelectInputProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setActiveIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
    }
    if (key.downArrow) {
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
            <Text color={isActive ? 'cyan' : 'gray'}>
              {isActive ? '>' : ' '}
            </Text>
            <Text color={isActive ? 'cyan' : 'white'} bold={isActive}>
              {item.label}
            </Text>
            {item.description && (
              <Text dimColor>
                {item.description}
              </Text>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>Use arrow keys to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
