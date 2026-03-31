import React, { useEffect } from "react";
import { Box, Text } from "ink";
import {
  isProviderReady,
  type ProviderSnapshot,
} from "../../ai/provider-status";
import { SelectInput } from "../components/select-input";
import { THEME } from "../../shared/theme";

interface ProviderCheckPhaseProps {
  snapshot: ProviderSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
  onContinue: () => void;
  onBack: () => void;
}

export function ProviderCheckPhase({
  snapshot,
  loading,
  onRefresh,
  onContinue,
  onBack,
}: ProviderCheckPhaseProps) {
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  const canContinue = snapshot ? isProviderReady(snapshot) : false;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>
          {"\u26a1"} Provider Readiness
        </Text>
      </Box>

      {loading && (
        <Text color={THEME.textSecondary}>
          Checking provider installation and authentication status...
        </Text>
      )}

      {!loading && snapshot && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="white" bold>
            Provider: {snapshot.provider}
          </Text>
          <Text color={snapshot.installed ? THEME.success : THEME.error}>
            CLI available: {snapshot.installed ? "yes" : "no"}
          </Text>
          {snapshot.binaryPath && (
            <Text color={THEME.textSecondary}>
              Binary: {snapshot.binaryPath}
            </Text>
          )}
          <Text color={THEME.textSecondary}>
            Version: {snapshot.version ?? "unknown"}
          </Text>
          <Text
            color={
              snapshot.status === "ready"
                ? THEME.success
                : snapshot.status === "warning"
                  ? THEME.warning
                  : THEME.error
            }
          >
            Status: {snapshot.status}
          </Text>
          <Text color={THEME.textSecondary}>
            Auth: {snapshot.auth.status}
          </Text>
          {snapshot.message && (
            <Box marginTop={1}>
              <Text color={THEME.textDim} wrap="wrap">
                {snapshot.message}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {!loading && (
        <SelectInput
          items={[
            ...(canContinue
              ? [
                  {
                    label: "Continue",
                    value: "continue",
                    icon: "\u25b6",
                    description: "Start with this provider",
                  },
                ]
              : []),
            {
              label: "Re-check",
              value: "refresh",
              icon: "\u21bb",
              description: "Run provider checks again",
            },
            {
              label: "Back",
              value: "back",
              icon: "\u2190",
              description: "Return to the previous step",
            },
          ]}
          onSelect={(item) => {
            if (item.value === "continue") {
              onContinue();
            } else if (item.value === "refresh") {
              onRefresh();
            } else {
              onBack();
            }
          }}
          onBack={onBack}
        />
      )}
    </Box>
  );
}
