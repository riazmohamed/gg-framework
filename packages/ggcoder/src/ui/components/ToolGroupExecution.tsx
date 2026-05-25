import React, { useMemo } from "react";
import { Text, Box } from "ink";
import { ToolUseLoader } from "./ToolUseLoader.js";
import { Spinner } from "./Spinner.js";
import type { ToolGroupItem } from "../App.js";
import { useTheme } from "../theme/theme.js";
import { buildToolGroupSummary, type SummarySegment } from "../tool-group-summary.js";

type ToolGroupTool = ToolGroupItem["tools"][number];
const RESPONSE_LEFT_PADDING = 1;

// ── Components ───────────────────────────────────────────

function SummaryText({ segments, color }: { segments: SummarySegment[]; color: string }) {
  return (
    <>
      {segments.map((seg, i) => (
        <Text key={i} bold={seg.bold} color={seg.color ?? color}>
          {seg.text}
        </Text>
      ))}
    </>
  );
}

interface ToolGroupExecutionProps {
  tools: ToolGroupTool[];
}

export function ToolGroupExecution({ tools }: ToolGroupExecutionProps) {
  const theme = useTheme();
  const allDone = tools.every((t) => t.status === "done");
  const hasError = tools.some((t) => t.isError);
  const status = allDone ? (hasError ? "error" : "done") : "running";
  const staticDisplay = status !== "running";

  const segments = useMemo(() => buildToolGroupSummary(tools, allDone), [tools, allDone]);
  const labelColor =
    status === "error" ? theme.error : status === "done" ? theme.success : theme.toolName;

  return (
    <Box paddingLeft={RESPONSE_LEFT_PADDING} marginBottom={1} flexDirection="row">
      {status === "running" ? (
        <Box width={2} flexShrink={0}>
          <Spinner staticDisplay={staticDisplay} />
        </Box>
      ) : (
        <ToolUseLoader status={status} />
      )}
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">
          <SummaryText segments={segments} color={labelColor} />
        </Text>
      </Box>
    </Box>
  );
}
