import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { THEME } from '../../shared/theme';

export interface SelectItem {
  label: string;
  value: string;
  description?: string;
  icon?: string;
  kind?: 'item' | 'heading';
}

interface SelectInputProps {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  onBack?: () => void;
  accentColor?: string;
}

type InputKey = {
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
};

export function SelectInput({ items, onSelect, onBack, accentColor = THEME.primary }: SelectInputProps) {
  const getSelectableIndexes = () =>
    items
      .map((item, index) => (item.kind === 'heading' ? -1 : index))
      .filter((index) => index >= 0);

  const [activeIndex, setActiveIndex] = useState(() => getSelectableIndexes()[0] ?? 0);

  // Reset selection when items change (e.g. after delete, or navigating back)
  useEffect(() => {
    const selectableIndexes = getSelectableIndexes();
    if (selectableIndexes.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (!selectableIndexes.includes(activeIndex)) {
      setActiveIndex(selectableIndexes[0]);
    }
  }, [items.length, activeIndex]);

  useInput((input: string, key: InputKey) => {
    if (key.escape && onBack) {
      onBack();
      return;
    }
    const selectableIndexes = getSelectableIndexes();
    if (selectableIndexes.length === 0) return;
    if (key.upArrow || input === 'k') {
      setActiveIndex((prev) => {
        const currentPos = selectableIndexes.indexOf(prev);
        const nextPos =
          currentPos <= 0 ? selectableIndexes.length - 1 : currentPos - 1;
        return selectableIndexes[nextPos];
      });
    }
    if (key.downArrow || input === 'j') {
      setActiveIndex((prev) => {
        const currentPos = selectableIndexes.indexOf(prev);
        const nextPos =
          currentPos >= selectableIndexes.length - 1 ? 0 : currentPos + 1;
        return selectableIndexes[nextPos];
      });
    }
    if (key.return) {
      onSelect(items[activeIndex]);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {items.map((item, index) => {
        if (item.kind === 'heading') {
          return (
            <Box key={item.value} marginTop={index === 0 ? 0 : 1}>
              <Text color={THEME.textDimmer} bold>
                {item.label}
              </Text>
            </Box>
          );
        }

        const isActive = index === activeIndex;
        return (
          <Box key={item.value} gap={1}>
            <Text color={isActive ? accentColor : THEME.textDimmer}>
              {isActive ? '\u276f' : ' '}
            </Text>
            {item.icon && (
              <Text color={isActive ? accentColor : THEME.textSecondary}>
                {item.icon}
              </Text>
            )}
            <Text color={isActive ? 'white' : THEME.textSecondary} bold={isActive}>
              {item.label}
            </Text>
            {item.description && (
              <Text color={isActive ? THEME.textMuted : THEME.textDarkest}>
                - {item.description}
              </Text>
            )}
          </Box>
        );
      })}
      <Box marginTop={1} gap={2}>
        <Text color={THEME.textDimmer}>{'\u2191\u2193'} navigate</Text>
        <Text color={THEME.textDimmer}>{'\u21b5'} select</Text>
        {onBack && <Text color={THEME.textDimmer}>esc back</Text>}
      </Box>
    </Box>
  );
}
