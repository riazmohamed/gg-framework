import React, { useState, useRef, useEffect, useMemo } from "react";
import { Text, Box, useInput, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";
import type { ImageAttachment } from "../../utils/image.js";
import { extractImagePaths, readImageFile, getClipboardImage } from "../../utils/image.js";
import { SlashCommandMenu, filterCommands, type SlashCommandInfo } from "./SlashCommandMenu.js";

const MAX_VISIBLE_LINES = 5;
const PROMPT = "❯ ";

interface InputAreaProps {
  onSubmit: (value: string, images: ImageAttachment[]) => void;
  onAbort: () => void;
  disabled?: boolean;
  isActive?: boolean;
  onDownAtEnd?: () => void;
  onShiftTab?: () => void;
  cwd: string;
  commands?: SlashCommandInfo[];
}

// Border (1 each side) + padding (1 each side) = 4 characters of overhead
const BOX_OVERHEAD = 4;

/**
 * Split text into visual lines based on terminal width.
 * Accounts for the prompt prefix, border, and padding.
 */
function wrapLine(text: string, contentWidth: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= contentWidth) {
      lines.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf(" ", contentWidth);
    if (breakAt <= 0) {
      breakAt = contentWidth;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    } else {
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt + 1);
    }
  }

  return lines;
}

function getVisualLines(text: string, columns: number): string[] {
  const contentWidth = columns - PROMPT.length - BOX_OVERHEAD;
  if (contentWidth <= 0) return [text];
  if (text.length === 0) return [""];

  // Split on real newlines first, then wrap each
  const hardLines = text.split("\n");
  const result: string[] = [];
  for (const line of hardLines) {
    result.push(...wrapLine(line, contentWidth));
  }
  return result;
}

export function InputArea({
  onSubmit,
  onAbort,
  disabled = false,
  isActive = true,
  onDownAtEnd,
  onShiftTab,
  cwd,
  commands = [],
}: InputAreaProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const lastEscRef = useRef(0);
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const [menuIndex, setMenuIndex] = useState(0);

  // Detect if we're in slash command mode
  const isSlashMode = value.startsWith("/") && !value.includes(" ") && commands.length > 0;
  const slashFilter = isSlashMode ? value.slice(1) : "";
  const filteredCommands = useMemo(
    () => (isSlashMode ? filterCommands(commands, slashFilter) : []),
    [isSlashMode, commands, slashFilter],
  );

  // Reset menu index when filter changes
  useEffect(() => {
    setMenuIndex(0);
  }, [slashFilter]);

  // Border color pulse (when idle/waiting for input)
  const borderPulseColors = useMemo(
    () => [theme.primary, theme.accent, theme.secondary, theme.accent],
    [theme.primary, theme.accent, theme.secondary],
  );
  const [borderFrame, setBorderFrame] = useState(0);
  useEffect(() => {
    if (disabled) return;
    const timer = setInterval(() => {
      setBorderFrame((f) => (f + 1) % borderPulseColors.length);
    }, 800);
    return () => clearInterval(timer);
  }, [disabled, borderPulseColors]);

  // Cursor blink
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    if (disabled) {
      setCursorVisible(true);
      return;
    }
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(timer);
  }, [disabled]);

  // Auto-detect image paths as they're pasted/typed — debounce so full paste arrives
  const extractingRef = useRef(false);
  useEffect(() => {
    if (disabled || !value || extractingRef.current) return;
    const timer = setTimeout(() => {
      extractingRef.current = true;
      extractImagePaths(value, cwd)
        .then(async ({ imagePaths, cleanText }) => {
          if (imagePaths.length === 0) return;
          const newImages: ImageAttachment[] = [];
          for (const imgPath of imagePaths) {
            try {
              newImages.push(await readImageFile(imgPath));
            } catch {
              // Not a valid image file — leave in text
            }
          }
          if (newImages.length > 0) {
            setImages((prev) => [...prev, ...newImages]);
            setValue(cleanText);
          }
        })
        .finally(() => {
          extractingRef.current = false;
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, cwd, disabled]);

  useInput(
    (input, key) => {
      if (disabled) {
        if ((key.ctrl && input === "c") || key.escape) {
          onAbort();
        }
        return;
      }

      if (key.return && (key.shift || key.meta)) {
        setValue((v) => v + "\n");
        return;
      }

      if (key.return) {
        // If slash menu is open and a command is selected, fill it in
        if (isSlashMode && filteredCommands.length > 0) {
          const selected = filteredCommands[Math.min(menuIndex, filteredCommands.length - 1)];
          const cmd = "/" + selected.name;
          // Submit the command directly
          historyRef.current.push(cmd);
          historyIndexRef.current = -1;
          onSubmit(cmd, []);
          setValue("");
          setImages([]);
          return;
        }

        const trimmed = value.trim();
        if (trimmed || images.length > 0) {
          if (trimmed) historyRef.current.push(trimmed);
          historyIndexRef.current = -1;
          onSubmit(trimmed, [...images]);
          setValue("");
          setImages([]);
        }
        return;
      }

      // Ctrl+I — paste image from clipboard
      if (key.ctrl && input === "i") {
        getClipboardImage().then((img) => {
          if (img) setImages((prev) => [...prev, img]);
        });
        return;
      }

      if (key.ctrl && input === "c") {
        if (value) {
          setValue("");
        } else {
          onAbort();
        }
        return;
      }

      if (key.ctrl && input === "d") {
        process.exit(0);
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }

      if (key.upArrow) {
        // If slash menu is open, navigate it
        if (isSlashMode && filteredCommands.length > 0) {
          setMenuIndex((i) => Math.max(0, i - 1));
          return;
        }
        const history = historyRef.current;
        if (history.length === 0) return;
        const newIndex =
          historyIndexRef.current === -1
            ? history.length - 1
            : Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = newIndex;
        setValue(history[newIndex]);
        return;
      }

      if (key.downArrow) {
        // If slash menu is open, navigate it
        if (isSlashMode && filteredCommands.length > 0) {
          setMenuIndex((i) => Math.min(filteredCommands.length - 1, i + 1));
          return;
        }
        const history = historyRef.current;
        if (historyIndexRef.current === -1) {
          if (onDownAtEnd) onDownAtEnd();
          return;
        }
        const newIndex = historyIndexRef.current + 1;
        if (newIndex >= history.length) {
          historyIndexRef.current = -1;
          setValue("");
        } else {
          historyIndexRef.current = newIndex;
          setValue(history[newIndex]);
        }
        return;
      }

      if (key.escape) {
        const now = Date.now();
        if (value && now - lastEscRef.current < 400) {
          setValue("");
        }
        lastEscRef.current = now;
        return;
      }

      if (key.tab && key.shift) {
        onShiftTab?.();
        return;
      }

      // Tab completion for slash commands
      if (key.tab) {
        if (isSlashMode && filteredCommands.length > 0) {
          const selected = filteredCommands[Math.min(menuIndex, filteredCommands.length - 1)];
          setValue("/" + selected.name);
        }
        return;
      }

      if (key.leftArrow || key.rightArrow) {
        return;
      }

      if (input) {
        setValue((v) => v + input);
      }
    },
    { isActive },
  );

  // Calculate visual lines and cap at MAX_VISIBLE_LINES (scroll to bottom)
  const visualLines = getVisualLines(value, columns);
  const totalLines = visualLines.length;
  const startLine = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;
  const displayLines = visualLines.slice(startLine);

  // Determine if the entire input is a slash command (for coloring)
  const isCommand = value.startsWith("/");

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={disabled ? theme.textDim : borderPulseColors[borderFrame]}
        paddingLeft={1}
        paddingRight={1}
      >
        {images.length > 0 && (
          <Box>
            <Text color={theme.accent}>{images.map((_, i) => `[Image #${i + 1}]`).join(" ")}</Text>
          </Box>
        )}
        {displayLines.map((line, i) => (
          <Box key={i}>
            {/* Show prompt on first visible line only */}
            <Text color={disabled ? theme.textDim : theme.inputPrompt} bold>
              {i === 0 ? PROMPT : "  "}
            </Text>
            <Text color={isCommand ? theme.commandColor : theme.text} bold={isCommand}>
              {line}
              {/* Blinking cursor at end of last line */}
              {i === displayLines.length - 1 && !disabled ? (cursorVisible ? "\u2588" : " ") : ""}
            </Text>
          </Box>
        ))}
      </Box>
      {/* Slash command menu — shown below the input box */}
      {isSlashMode && !disabled && filteredCommands.length > 0 && (
        <SlashCommandMenu commands={commands} filter={slashFilter} selectedIndex={menuIndex} />
      )}
    </Box>
  );
}
