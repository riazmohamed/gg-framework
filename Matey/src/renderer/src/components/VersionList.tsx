interface VersionListProps {
  readonly versions: Readonly<Record<string, string | undefined>>;
}

const versionItems = [
  { key: "electron", label: "Electron" },
  { key: "chrome", label: "Chromium" },
  { key: "node", label: "Node.js" },
] as const;

export function VersionList({ versions }: VersionListProps): React.JSX.Element {
  return (
    <dl className="version-list" aria-label="Runtime versions">
      {versionItems.map(({ key, label }) => (
        <div className="version-item" key={key}>
          <dt>{label}</dt>
          <dd>{versions[key] ?? "Unknown"}</dd>
        </div>
      ))}
    </dl>
  );
}
