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
}

const LOGO_LINES = ["", "", ""];

// Gradient steps across the logo: primary -> secondary -> primary, giving a
// smooth ping-pong. Derived from the active theme's tokens rather than a fixed
// palette, so light, ansi and daltonized themes all get a readable ramp.
const GRADIENT_STEPS = 7;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `#${((1 << 24) | (mix(r1, r2) << 16) | (mix(g1, g2) << 8) | mix(b1, b2)).toString(16).slice(1)}`;
}

/** Ping-pong ramp from `from` to `to` and back, `2 * (steps - 1)` entries. */
function buildGradient(from: string, to: string): string[] {
  const oneWay: string[] = [];
  for (let i = 0; i < GRADIENT_STEPS; i++) {
    oneWay.push(lerpColor(from, to, i / (GRADIENT_STEPS - 1)));
  }
  return [...oneWay, ...oneWay.slice(1, -1).reverse()];
}

const GAP = "   ";
// Logo is 9 visible chars wide + GAP (3) = 12 chars before info text
const LOGO_WIDTH = 9;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 62; // room for the shortcut hint row

export function Banner({ version, model, cwd }: BannerProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const modelInfo = getModel(model);
  const modelName = modelInfo?.name ?? model;

  const home = process.env.HOME ?? "";
  const displayPath = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;

  // Static gradient — no animation needed since the banner is rendered once
  // into Ink's Static area. Animating here would waste CPU and could cause
  // visual duplicates on terminal resize.
  const shift = 0;

  // At narrow widths, stack logo above info instead of side-by-side
  if (columns < SIDE_BY_SIDE_MIN) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
        <GradientText text={LOGO_LINES[0]} shift={shift} />
        <GradientText text={LOGO_LINES[1]} shift={shift} />
        <GradientText text={LOGO_LINES[2]} shift={shift} />
        <Box marginTop={1}>
          <Text color={theme.primary} bold>
            OG Coder
          </Text>
          <Text color={theme.textDim}> v{version}</Text>
        </Box>
        <Box>
          <Text color={theme.secondary}>{modelName}</Text>
          <Text color={theme.textDim}>{"  "}</Text>
          <Text color={theme.textDim} wrap="truncate">
            {displayPath}
          </Text>
        </Box>
        <ShortcutHints />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
      <Box>
        <GradientText text={LOGO_LINES[0]} shift={shift} />
        <Text>{GAP}</Text>
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
        <GradientText text={LOGO_LINES[1]} shift={shift} />
        <Text>{GAP}</Text>
        <Text color={theme.secondary}>{modelName}</Text>
        <Text color={theme.textDim}>{"  "}</Text>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[2]} shift={shift} />
        <Text>{GAP}</Text>
        <ShortcutHints />
      </Box>
    </Box>
  );
}

function ShortcutHints() {
  const theme = useTheme();

  return (
    <Box>
      <Text color={theme.primary}>Ctrl+T</Text>
      <Text color={theme.textDim}> tasks</Text>
      <Text color={theme.textDim}> · </Text>
      <Text color={theme.primary}>Ctrl+S</Text>
      <Text color={theme.textDim}> skills</Text>
      <Text color={theme.textDim}> · </Text>
      <Text color={theme.primary}>Shift+Tab</Text>
      <Text color={theme.textDim}> toggle thinking</Text>
    </Box>
  );
}

function GradientText({ text, shift = 0 }: { text: string; shift?: number }) {
  const theme = useTheme();
  const gradient = React.useMemo(() => buildGradient(theme.primary, theme.secondary), [theme]);
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = gradient[(colorIdx + shift) % gradient.length];
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
