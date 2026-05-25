import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGoalReferenceContext,
  referencesRequiringAcknowledgement,
} from "./goal-references.js";
import type { ImageAttachment } from "../utils/image.js";

let tmpProject: string;

beforeEach(async () => {
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "goal-references-test-"));
});

afterEach(async () => {
  await fs.rm(tmpProject, { recursive: true, force: true });
});

describe("goal reference context", () => {
  it("extracts URLs, persists attachments, and formats mandatory prompt context", async () => {
    const attachment: ImageAttachment = {
      kind: "text",
      fileName: "notes.md",
      filePath: path.join(tmpProject, "notes.md"),
      mediaType: "text/markdown",
      data: "Match this documented behavior.",
    };

    const context = await buildGoalReferenceContext({
      cwd: tmpProject,
      originalGoalPrompt:
        "Build this like https://github.com/acme/reference-ui and explain https://example.com/docs.",
      attachments: [attachment],
    });

    const kinds = context.references.map((reference) => reference.kind);
    expect(kinds).toEqual(expect.arrayContaining(["prompt", "repo", "url", "text"]));
    expect(context.promptSection).toContain("## Goal References (MANDATORY)");
    expect(context.promptSection).toContain("https://github.com/acme/reference-ui");
    expect(context.promptSection).toContain("Match this documented behavior.");
    const textReference = context.references.find((reference) => reference.kind === "text");
    expect(textReference?.path).toMatch(/^\.gg\/goal-references\/text-/);
    expect(await fs.readFile(path.join(tmpProject, textReference?.path ?? ""), "utf-8")).toBe(
      "Match this documented behavior.",
    );
    expect(
      referencesRequiringAcknowledgement(context.references).map((reference) => reference.kind),
    ).toEqual(expect.arrayContaining(["repo", "url", "text"]));
    expect(
      referencesRequiringAcknowledgement(context.references).map((reference) => reference.kind),
    ).not.toContain("prompt");
  });

  it("covers prompt, URL/repo, screenshot image, attached document, and X/Y/Z feature-fix references", async () => {
    const imageAttachment: ImageAttachment = {
      kind: "image",
      fileName: "liked-ui.png",
      filePath: path.join(tmpProject, "liked-ui.png"),
      mediaType: "image/png",
      data: Buffer.from("fake-png-reference").toString("base64"),
    };
    const documentAttachment: ImageAttachment = {
      kind: "text",
      fileName: "feature-fix-x-y-z.md",
      filePath: path.join(tmpProject, "feature-fix-x-y-z.md"),
      mediaType: "text/markdown",
      data: "Fix feature based on X: keyboard flow, Y: empty state copy, Z: error recovery.",
    };

    const context = await buildGoalReferenceContext({
      cwd: tmpProject,
      originalGoalPrompt:
        "Fix this feature based off X, Y, Z. Match https://example.com/design-system and repo https://github.com/acme/product-reference.",
      attachments: [imageAttachment, documentAttachment],
    });

    expect(context.references.map((reference) => reference.kind)).toEqual(
      expect.arrayContaining(["prompt", "url", "repo", "image", "text"]),
    );
    expect(context.promptSection).toContain("Goal References (MANDATORY)");
    expect(context.promptSection).toContain(
      "success criteria, worker tasks, evidence paths, verifier, and final audit",
    );
    expect(context.promptSection).toContain("https://example.com/design-system");
    expect(context.promptSection).toContain("https://github.com/acme/product-reference");
    expect(context.promptSection).toContain("Attached image reference liked-ui.png");
    expect(context.promptSection).toContain("feature-fix-x-y-z.md");
    expect(context.promptSection).toContain(
      "X: keyboard flow, Y: empty state copy, Z: error recovery",
    );

    const imageReference = context.references.find((reference) => reference.kind === "image");
    const textReference = context.references.find((reference) => reference.kind === "text");
    expect(imageReference?.path).toMatch(/^\.gg\/goal-references\/image-/);
    expect(textReference?.path).toMatch(/^\.gg\/goal-references\/text-/);
    await expect(fs.stat(path.join(tmpProject, imageReference?.path ?? ""))).resolves.toMatchObject(
      {
        size: Buffer.from("fake-png-reference").length,
      },
    );
    await expect(
      fs.readFile(path.join(tmpProject, textReference?.path ?? ""), "utf-8"),
    ).resolves.toContain("X: keyboard flow, Y: empty state copy, Z: error recovery");

    expect(
      referencesRequiringAcknowledgement(context.references).map((reference) => reference.kind),
    ).toEqual(expect.arrayContaining(["url", "repo", "image", "text"]));
  });
});
