import React from "react";
import { EyesOverlay } from "./EyesOverlay.js";
import { PlanOverlay } from "./PlanOverlay.js";
import { SkillsOverlay } from "./SkillsOverlay.js";

export type FullScreenOverlayKind = "eyes" | "skills" | "plan";

interface FullScreenOverlayRouterProps {
  overlay: FullScreenOverlayKind | null;
  version: string;
  cwd: string;
  agentRunning: boolean;
  planAutoExpand: boolean;
  onCloseEyes: () => void;
  onQueueEyesMessage: (msg: string) => void;
  onCloseSkills: () => void;
  onClosePlan: () => void;
  onApprovePlan: (planPath: string) => void;
  onRejectPlan: (planPath: string, feedback: string) => void;
}

export function FullScreenOverlayRouter({
  overlay,
  cwd,
  planAutoExpand,
  onCloseEyes,
  onQueueEyesMessage,
  onCloseSkills,
  onClosePlan,
  onApprovePlan,
  onRejectPlan,
}: FullScreenOverlayRouterProps) {
  if (overlay === "eyes") {
    return <EyesOverlay cwd={cwd} onClose={onCloseEyes} onQueueMessage={onQueueEyesMessage} />;
  }

  if (overlay === "skills") {
    return <SkillsOverlay cwd={cwd} onClose={onCloseSkills} />;
  }

  if (overlay === "plan") {
    return (
      <PlanOverlay
        cwd={cwd}
        autoExpandNewest={planAutoExpand}
        onClose={onClosePlan}
        onApprove={onApprovePlan}
        onReject={onRejectPlan}
      />
    );
  }

  return null;
}
