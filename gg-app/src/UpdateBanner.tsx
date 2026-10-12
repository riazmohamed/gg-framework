import type { CSSProperties } from "react";
import { Badge } from "./Badge";
import { renderCritterFrame, renderPixelGrid } from "./critter-sprites";
import { BIOMES } from "./critter-terrain";
import { critterById } from "./PopCritter";
import type { UpdateInfo } from "./update";

// The banner's crew: a frog, a bee and an axolotl, hopping on a strip of the
// home screen's meadow. Built once; the art never changes.
const CREW = ["frog", "bee", "axolotl"].map((id) => {
  const critter = critterById(id);
  return { id, frames: [renderCritterFrame(critter, 0), renderCritterFrame(critter, 1)] as const };
});
const MEADOW_PALETTE = BIOMES.find((biome) => biome.id === "meadow")?.palette ?? {};
/** One 12-cell tile of grass over soil, repeated along the banner's bottom edge. */
const GRASS_ROWS = ["g.G..g.G.gG.", "GgGGgGGgGGgG", "gdggdgdggdgg", "dDddDdDdddDd"];
const GRASS_SRC = renderPixelGrid(GRASS_ROWS, MEADOW_PALETTE, { width: 12, height: 4 });
const GRASS_STYLE: CSSProperties = { backgroundImage: `url("${GRASS_SRC}")` };

function Grass(): React.ReactElement {
  return <span className="update-banner-grass" style={GRASS_STYLE} aria-hidden="true" />;
}

/** One critter of the crew. Walking stacks the second leg frame and blinks it. */
function Crew({ walking }: { walking: boolean }): React.ReactElement {
  return (
    <>
      {CREW.map(({ id, frames }, i) => (
        <span
          key={id}
          className={`update-banner-critter${walking ? " walking" : " hopping"}`}
          style={{ animationDelay: `${i * 180}ms` }}
        >
          <img src={frames[0]} alt="" draggable={false} />
          {walking && <img className="step" src={frames[1]} alt="" draggable={false} />}
        </span>
      ))}
    </>
  );
}

/**
 * The footer's "Ken just updated GG Coder!" bar. The crew hops beside the words
 * while an update waits, then marches along the grass at the front of the
 * download fill. The slot stays mounted from "available" through "installing",
 * so the bar dissolves in once and the swap to the progress bar never replays it.
 */
export function UpdateBanner({
  appUpdate,
}: {
  appUpdate: Pick<UpdateInfo, "phase" | "version" | "progress" | "install">;
}): React.ReactElement | null {
  const { phase, version, progress } = appUpdate;
  if (phase !== "available" && phase !== "installing") return null;
  const pct = progress ?? 0;
  return (
    <div className="update-banner-slot">
      {phase === "available" ? (
        <button
          className="update-banner"
          title={`Update to ${version ?? "the latest version"} — installs and restarts the app`}
          onClick={() => void appUpdate.install()}
        >
          <Grass />
          <span className="update-banner-crew" aria-hidden="true">
            <Crew walking={false} />
          </span>
          {"Ken just updated GG Coder!"}
          <Badge>Install</Badge>
        </button>
      ) : (
        // Same .update-banner box (padding/font) as the available state, so
        // banner → progress bar swaps content with zero layout shift. The fill
        // and the crew are absolutely positioned; only the percentage is in flow.
        <div
          className="update-banner update-banner-busy update-banner-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Downloading update"
        >
          <span className="update-banner-fill" style={{ width: `${pct}%` }} />
          <Grass />
          <span className="update-banner-march" style={{ left: `${pct}%` }} aria-hidden="true">
            <Crew walking />
          </span>
          <span className="update-banner-pct">{`${pct}%`}</span>
        </div>
      )}
    </div>
  );
}
