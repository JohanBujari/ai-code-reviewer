import React from "react";
import { Box } from "ink";
import { Spinner } from "../components/spinner";

export function LaunchingPhase() {
  return (
    <Box paddingX={1} gap={1}>
      <Spinner label="Launching watcher" showDots />
    </Box>
  );
}
