// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { error as logError } from "@tauri-apps/plugin-log";
import { authStatus, getSettings } from "./agent";
import { HomeScreen } from "./HomeScreen";

vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn(async () => undefined) }));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "1.0.0") }));
vi.mock("./AsciiLogo", () => ({ AsciiLogo: () => null }));
vi.mock("./HomeScenery", () => ({ HomeScenery: () => null, withScenery: (b: unknown) => b }));
vi.mock("./HomeCritters", () => ({ HomeCritters: () => null }));
vi.mock("./RankBadge", () => ({ RankBadge: () => null }));
vi.mock("./ScorecardModal", () => ({ ScorecardModal: () => null }));
vi.mock("./update", () => ({ useAppUpdate: () => ({ status: "idle" }) }));
vi.mock("./toast", () => ({ toast: vi.fn() }));
vi.mock("./agent", () => ({
  openUrl: vi.fn(),
  waitForReady: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  authStatus: vi.fn(),
  openWhatsNewWindow: vi.fn(),
  getProgress: vi.fn(async () => null),
  setRemoteActive: vi.fn(),
  getServeStatus: vi.fn(async () => ({ running: false })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeScreen", () => {
  it("logs a failed setup check instead of swallowing it", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("settings unreadable"));
    vi.mocked(authStatus).mockResolvedValue([]);

    render(
      <HomeScreen
        onProjects={vi.fn()}
        onGoals={vi.fn()}
        onChat={vi.fn()}
        onMotion={vi.fn()}
        onSettings={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(logError).toHaveBeenCalledWith("Home setup check failed: Error: settings unreadable"),
    );
    expect(screen.getByRole("button", { name: "Code" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("offers Motion beside Code and Chat and opens it once set up", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    vi.mocked(authStatus).mockResolvedValue([
      {
        value: "anthropic",
        label: "Anthropic",
        description: "",
        methods: [],
        connected: true,
        connectedMethods: [],
      },
    ]);
    const onMotion = vi.fn();

    render(
      <HomeScreen
        onProjects={vi.fn()}
        onGoals={vi.fn()}
        onChat={vi.fn()}
        onMotion={onMotion}
        onSettings={vi.fn()}
      />,
    );

    const motion = screen.getByRole("button", { name: "Motion" });
    expect(screen.getByRole("button", { name: "Code" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Chat" })).toBeDefined();
    await waitFor(() => expect(motion.getAttribute("aria-disabled")).toBeNull());

    fireEvent.click(motion);

    expect(onMotion).toHaveBeenCalledOnce();
  });

  it("orders the workspaces Code, Goals, Chat, Motion and opens Goals", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    vi.mocked(authStatus).mockResolvedValue([
      {
        value: "anthropic",
        label: "Anthropic",
        description: "",
        methods: [],
        connected: true,
        connectedMethods: [],
      },
    ]);
    const onGoals = vi.fn();

    render(
      <HomeScreen
        onProjects={vi.fn()}
        onGoals={onGoals}
        onChat={vi.fn()}
        onMotion={vi.fn()}
        onSettings={vi.fn()}
      />,
    );

    const names = ["Code", "Goals", "Chat", "Motion"];
    const buttons = names.map((name) => screen.getByRole("button", { name }));
    for (let i = 1; i < buttons.length; i++) {
      const prev = buttons[i - 1];
      const next = buttons[i];
      if (!prev || !next) throw new Error("missing workspace button");
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const goals = screen.getByRole("button", { name: "Goals" });
    await waitFor(() => expect(goals.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(goals);
    expect(onGoals).toHaveBeenCalledOnce();
  });

  it("says under the Goals button that Goals is in beta", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "/workspaces", configured: true });
    vi.mocked(authStatus).mockResolvedValue([]);

    render(
      <HomeScreen
        onProjects={vi.fn()}
        onGoals={vi.fn()}
        onChat={vi.fn()}
        onMotion={vi.fn()}
        onSettings={vi.fn()}
      />,
    );

    const note = await screen.findByText("In beta");
    expect(note.id).not.toBe("");
    // Screen readers hear it with the Goals button, and only with that one.
    expect(screen.getByRole("button", { name: "Goals" }).getAttribute("aria-describedby")).toBe(
      note.id,
    );
    expect(screen.queryByText("Still in process")).toBeNull();
    expect(screen.getByRole("button", { name: "Motion" }).hasAttribute("aria-describedby")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Code" }).hasAttribute("aria-describedby")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Chat" }).hasAttribute("aria-describedby")).toBe(
      false,
    );
  });
});
