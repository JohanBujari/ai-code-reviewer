import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../../shared/theme";

const LOGO_LINES = [
  "     _          _                 ",
  "    / \\   __  _(_) ___  _ __ ___  ",
  "   / _ \\  \\ \\/ / |/ _ \\| '_ ` _ \\ ",
  "  / ___ \\  >  <| | (_) | | | | | |",
  " /_/   \\_\\/_/\\_\\_|\\___/|_| |_| |_|",
];

const GRADIENT = [...THEME.bannerGradient];

interface BannerProps {
  version?: string;
}

export function Banner({ version = process.env.APP_VERSION ?? "0.0.0" }: BannerProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.primary}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
    >
      {/* Logo with gradient lines */}
      <Box flexDirection="column" alignItems="center">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={GRADIENT[i]} bold>
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box justifyContent="center" marginTop={1}>
        <Text color={THEME.textSecondary}>{"  "}~</Text>
        <Text color="white" bold>
          {" "}
          AI-Powered Code Review{" "}
        </Text>
        <Text color={THEME.textSecondary}>~{"  "}</Text>
      </Box>

      {/* Version + divider */}
      <Box justifyContent="center">
        <Text dimColor>v{version}</Text>
      </Box>
    </Box>
  );
}
