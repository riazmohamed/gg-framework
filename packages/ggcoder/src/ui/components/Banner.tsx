import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";
import { getModel } from "../../core/model-registry.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import type { Provider } from "@abukhaled/gg-ai";

interface BannerProps {
  version: string;
  model: string;
  provider: Provider;
  cwd: string;
  taskCount?: number;
}

const LOGO_LINES = [
  " \u2584\u2580\u2580\u2584 \u2584\u2580\u2580\u2580",
  " \u2588  \u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

// Extended gradient with reverse path for smooth animation loop
const GRADIENT = [
  "#60a5fa",
  "#6da1f9",
  "#7a9df7",
  "#8799f5",
  "#9495f3",
  "#a18ff1",
  "#a78bfa",
  "#a18ff1",
  "#9495f3",
  "#8799f5",
  "#7a9df7",
  "#6da1f9",
];

export function Banner({ version, model, cwd, taskCount }: BannerProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const modelInfo = getModel(model);
  const modelName = modelInfo?.name ?? model;

  const home = process.env.HOME ?? "";
  const displayPath = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

  const shift = 0;

  // Always use stacked layout: logo on top, info below.
  // Side-by-side layout breaks in split-pane terminals (e.g. Warp) where
  // stdout.columns reports full terminal width, not individual pane width,
  // causing rows to wrap and destroying the logo's vertical alignment.
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
      <Box flexDirection="column">
        <GradientText text={LOGO_LINES[0]} shift={shift} />
        <GradientText text={LOGO_LINES[1]} shift={shift} />
        <GradientText text={LOGO_LINES[2]} shift={shift} />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.primary} bold>
          OG Coder
        </Text>
        <Text color={theme.textDim}> v{version}</Text>
        <Text color={theme.textDim}> · By </Text>
        <Text color={theme.text} bold>
          Abu Khaled
        </Text>
      </Box>
      <Box>
        <Text color={theme.secondary}>{modelName}</Text>
        <Text color={theme.textDim}>{"  "}</Text>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
      </Box>
      <Box>
        <Text color={theme.primary}>^T</Text>
        <Text color={theme.textDim}> tasks</Text>
        {taskCount !== undefined && taskCount > 0 && (
          <Text color={theme.secondary}> ({taskCount})</Text>
        )}
        <Text color={theme.textDim}>{"  "}</Text>
        <Text color={theme.primary}>^S</Text>
        <Text color={theme.textDim}> skills</Text>
        <Text color={theme.textDim}>{"  "}</Text>
        <Text color={theme.primary}>^P</Text>
        <Text color={theme.textDim}> plan mode</Text>
        <Text color={theme.textDim}>{"  "}</Text>
        <Text color={theme.primary}>⇧Tab</Text>
        <Text color={theme.textDim}> thinking</Text>
      </Box>
    </Box>
  );
}

function GradientText({ text, shift = 0 }: { text: string; shift?: number }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[(colorIdx + shift) % GRADIENT.length];
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
