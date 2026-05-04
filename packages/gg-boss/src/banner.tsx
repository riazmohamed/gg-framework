import React from "react";
import { Box, Text } from "ink";
import { AUTHOR, BRAND, COLORS, GRADIENT, LOGO_GAP, LOGO_LINES, VERSION } from "./branding.js";

interface BossBannerProps {
  /** Second line text (e.g. "Link projects", "Orchestrator"). */
  subtitle: string;
  /** Third line text (e.g. "↑↓ navigate · enter save"). */
  hint?: string;
}

/** Ink banner — for use inside Ink-rendered screens. */
export function BossBanner({ subtitle, hint }: BossBannerProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <GradientText text={LOGO_LINES[0]!} />
        <Text>{LOGO_GAP}</Text>
        <Text color={COLORS.primary} bold>
          {BRAND}
        </Text>
        <Text color={COLORS.textDim}> v{VERSION}</Text>
        <Text color={COLORS.textDim}> · By </Text>
        <Text color={COLORS.text} bold>
          {AUTHOR}
        </Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[1]!} />
        <Text>{LOGO_GAP}</Text>
        <Text color={COLORS.accent}>{subtitle}</Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[2]!} />
        <Text>{LOGO_GAP}</Text>
        <Text color={COLORS.textDim}>{hint ?? ""}</Text>
      </Box>
    </Box>
  );
}

function GradientText({ text }: { text: string }): React.ReactElement {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}
