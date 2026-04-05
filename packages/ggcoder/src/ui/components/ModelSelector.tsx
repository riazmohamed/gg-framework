import React from "react";
import type { Provider } from "@abukhaled/gg-ai";
import { MODELS } from "../../core/model-registry.js";
import { SelectList } from "./SelectList.js";

interface ModelSelectorProps {
  onSelect: (modelId: string) => void;
  onCancel: () => void;
  loggedInProviders: Provider[];
  currentModel: string;
  currentProvider: Provider;
}

export function ModelSelector({
  onSelect,
  onCancel,
  loggedInProviders,
  currentModel,
  currentProvider,
}: ModelSelectorProps) {
  const filtered = MODELS.filter((m) => loggedInProviders.includes(m.provider));

  const currentValue = `${currentProvider}:${currentModel}`;

  const providerLabel: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    glm: "Z.AI",
    moonshot: "Moonshot",
    xiaomi: "Xiaomi",
  };

  const items = filtered.map((m) => {
    const value = `${m.provider}:${m.id}`;
    const isCurrent = value === currentValue;
    return {
      label: `${isCurrent ? "* " : "  "}${m.id}`,
      value,
      description: `${providerLabel[m.provider] ?? m.provider}`,
    };
  });

  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === currentValue),
  );

  return (
    <SelectList items={items} onSelect={onSelect} onCancel={onCancel} initialIndex={initialIndex} />
  );
}
