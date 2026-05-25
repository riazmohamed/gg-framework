import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VersionList } from "./VersionList";

describe("VersionList", () => {
  it("renders the Electron runtime versions", () => {
    const markup = renderToStaticMarkup(
      <VersionList
        versions={{
          chrome: "142.0.0",
          electron: "42.0.0",
          node: "25.0.0",
        }}
      />,
    );

    expect(markup).toContain("Electron");
    expect(markup).toContain("42.0.0");
    expect(markup).toContain("Chromium");
    expect(markup).toContain("142.0.0");
    expect(markup).toContain("Node.js");
    expect(markup).toContain("25.0.0");
  });
});
