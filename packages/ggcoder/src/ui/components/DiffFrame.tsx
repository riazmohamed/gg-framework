import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";

/**
 * Reusable frame for diff content — dashed top/bottom borders, no left/right.
 * Matches Claude Code's DiffFrame pattern.
 */
export function DiffFrame({
  children,
  placeholder,
}: {
  children?: React.ReactNode;
  placeholder?: boolean;
}) {
  const theme = useTheme();
  return (
    <Box
      flexDirection="column"
      borderColor={theme.subtle}
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
    >
      {placeholder ? <Text dimColor>...</Text> : children}
    </Box>
  );
}
