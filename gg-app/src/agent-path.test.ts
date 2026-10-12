import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toAgentPath, toAgentPaths } from "./agent-path";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("toAgentPath", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("test_toAgentPath_wslSharePath_returnsShellMappedPath", async () => {
    invokeMock.mockResolvedValueOnce("/home/me/app");
    await expect(toAgentPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\app")).resolves.toBe(
      "/home/me/app",
    );
    expect(invokeMock).toHaveBeenCalledWith("app_agent_path", {
      path: "\\\\wsl.localhost\\Ubuntu\\home\\me\\app",
    });
  });

  it("test_toAgentPaths_multiplePaths_mapsEachInOrder", async () => {
    invokeMock.mockImplementation((_cmd, args) =>
      Promise.resolve(`mapped:${(args as { path: string }).path}`),
    );
    await expect(toAgentPaths(["a", "b"])).resolves.toEqual(["mapped:a", "mapped:b"]);
  });

  it("test_toAgentPath_shellError_rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(toAgentPath("C:\\x")).rejects.toThrow("boom");
  });
});
