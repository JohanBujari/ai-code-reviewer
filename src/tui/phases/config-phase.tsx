import React from "react";
import { Box, Text } from "ink";
import { SelectInput } from "../components/select-input";
import { TextInput } from "../components/text-input";
import { THEME } from "../../shared/theme";
import type { VarDef } from "../config-vars";

interface ConfigPhaseProps {
  missingVars: VarDef[];
  configIndex: number;
  configAnswers: Record<string, string>;
  onAnswer: (value: string) => void;
  onBack: () => void;
}

export function ConfigPhase({ missingVars, configIndex, configAnswers, onAnswer, onBack }: ConfigPhaseProps) {
  if (missingVars.length === 0) return null;

  const currentVar = missingVars[configIndex];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} gap={1}>
        <Text color={THEME.primary} bold>
          {"\u2699"} Configuration
        </Text>
        <Text color={THEME.textDimmer}>
          [{configIndex + 1}/{missingVars.length}]
        </Text>
      </Box>

      {/* Progress bar */}
      <Box marginBottom={1}>
        <Text color={THEME.primary}>{"\u2588".repeat(configIndex)}</Text>
        <Text color={THEME.border}>
          {"\u2591".repeat(missingVars.length - configIndex)}
        </Text>
      </Box>

      {/* Completed fields */}
      {missingVars.slice(0, configIndex).map((def) => (
        <Box key={def.key} gap={1}>
          <Text color={THEME.success}>{"\u2713"}</Text>
          <Text color={THEME.textMuted}>{def.label}:</Text>
          <Text color={THEME.textSecondary}>
            {def.type === "secret"
              ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
              : configAnswers[def.key]}
          </Text>
        </Box>
      ))}

      {/* Current field */}
      {currentVar && (
        <Box marginTop={configIndex > 0 ? 1 : 0}>
          {currentVar.type === "select" ? (
            <Box flexDirection="column">
              <Text color={THEME.primary} bold>
                {currentVar.label}
              </Text>
              <SelectInput
                items={[
                  ...(currentVar.optional
                    ? [
                        {
                          label: "Use default",
                          value: "",
                          description: currentVar.hint ?? "Leave this unset",
                        },
                      ]
                    : []),
                  ...(currentVar.selectItems ??
                    (currentVar.choices ?? []).map((c) => ({
                      label: c,
                      value: c,
                    }))),
                ]}
                onSelect={(item) => onAnswer(item.value)}
                onBack={onBack}
              />
            </Box>
          ) : (
            <TextInput
              key={currentVar.key}
              label={currentVar.label}
              hint={currentVar.hint}
              mask={currentVar.type === "secret"}
              optional={currentVar.optional}
              validate={currentVar.validate}
              onSubmit={onAnswer}
              onBack={onBack}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
