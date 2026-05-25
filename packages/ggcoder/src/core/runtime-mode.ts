export type GoalMode = "off" | "planner" | "setup" | "coordinator";

export interface RuntimeModeRefs {
  goalModeRef?: { current: GoalMode };
}

export function getActiveGoalMode(goalModeRef?: { current: GoalMode }): GoalMode {
  return goalModeRef?.current ?? "off";
}

export function isGoalModeActive(goalModeRef?: { current: GoalMode }): boolean {
  return getActiveGoalMode(goalModeRef) !== "off";
}

export function goalModeRestriction(toolName: string, action: string): string {
  return `Error: ${toolName} is restricted in Goal mode. The parent session is planning/orchestration-only; use the appropriate Goal phase for ${action} and let Goal workers perform implementation.`;
}
