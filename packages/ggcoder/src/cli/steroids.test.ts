import { describe, expect, it } from "vitest";
import { formatSteroidsStatus } from "./steroids.js";

describe("ogcoder steroids", () => {
  it("points at the install command when it is missing", () => {
    expect(formatSteroidsStatus({ installed: false, connected: false })).toEqual([
      "Agent Steroids is not installed.",
      "Install it with: ogcoder steroids install",
    ]);
  });

  it("reports the corpus size, an empty corpus, and a binary that does not run", () => {
    const base = { installed: true, version: "1.2.0", path: "/bin/steroids" };
    expect(formatSteroidsStatus({ ...base, connected: true, repos: 3, documents: 120 })).toEqual([
      "Agent Steroids 1.2.0 at /bin/steroids",
      "Corpus: 3 repos, 120 documents.",
    ]);
    expect(
      formatSteroidsStatus({
        ...base,
        connected: true,
        repos: 3,
        documents: 120,
        diskSize: "2.0GB",
      })[1],
    ).toBe("Corpus: 3 repos, 120 documents, 2.0GB on disk.");
    expect(formatSteroidsStatus({ ...base, connected: false, repos: 0 })[1]).toBe(
      "The corpus is empty. Run /steroids inside ogcoder to add repos.",
    );
    expect(formatSteroidsStatus({ ...base, connected: false, error: "bad CPU type" })).toEqual([
      "Agent Steroids 1.2.0 at /bin/steroids",
      "It did not run: bad CPU type",
      "Reinstall with: ogcoder steroids install",
    ]);
  });
});
