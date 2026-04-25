import { describe, it, expect } from "vitest";
import {
  XIAOMI_REGIONS,
  XIAOMI_REGION_IDS,
  getXiaomiBaseUrl,
  isXiaomiRegion,
} from "./xiaomi-regions.js";

describe("xiaomi-regions", () => {
  it("maps ams to the Amsterdam token-plan URL", () => {
    expect(getXiaomiBaseUrl("ams")).toBe("https://token-plan-ams.xiaomimimo.com/v1");
  });

  it("maps sgp to the Singapore token-plan URL", () => {
    expect(getXiaomiBaseUrl("sgp")).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
  });

  it("exposes human-readable labels for UI rendering", () => {
    expect(XIAOMI_REGIONS.ams.label).toMatch(/Amsterdam/);
    expect(XIAOMI_REGIONS.sgp.label).toMatch(/Singapore/);
  });

  it("lists region ids in a stable order for selectors", () => {
    expect(XIAOMI_REGION_IDS).toEqual(["ams", "sgp"]);
  });

  it("validates arbitrary strings against known regions", () => {
    expect(isXiaomiRegion("ams")).toBe(true);
    expect(isXiaomiRegion("sgp")).toBe(true);
    expect(isXiaomiRegion("tokyo")).toBe(false);
    expect(isXiaomiRegion("")).toBe(false);
  });
});
