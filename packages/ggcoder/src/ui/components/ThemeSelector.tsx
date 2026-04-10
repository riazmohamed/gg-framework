import React from "react";
import type { ThemeName } from "../theme/theme.js";
import { SelectList } from "./SelectList.js";

interface ThemeSelectorProps {
  onSelect: (themeName: ThemeName) => void;
  onCancel: () => void;
  currentTheme: string;
}

const THEME_OPTIONS: { name: ThemeName; label: string; description: string }[] = [
  { name: "dark", label: "Dark", description: "Bold accents, deep contrast" },
  { name: "light", label: "Light", description: "Softer accents, pastel tones" },
  { name: "dark-ansi", label: "Dark ANSI", description: "For 16-color terminals" },
  { name: "light-ansi", label: "Light ANSI", description: "Softer palette, 16-color terminals" },
  { name: "dark-daltonized", label: "Dark Colorblind", description: "Blue/orange (no red/green)" },
  {
    name: "light-daltonized",
    label: "Light Colorblind",
    description: "Pastel blue/orange (no red/green)",
  },
];

export function ThemeSelector({ onSelect, onCancel, currentTheme }: ThemeSelectorProps) {
  const items = THEME_OPTIONS.map((t) => ({
    label: `${t.name === currentTheme ? "* " : "  "}${t.label}`,
    value: t.name,
    description: t.description,
  }));

  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === currentTheme),
  );

  return (
    <SelectList
      items={items}
      onSelect={(value) => onSelect(value as ThemeName)}
      onCancel={onCancel}
      initialIndex={initialIndex}
    />
  );
}
