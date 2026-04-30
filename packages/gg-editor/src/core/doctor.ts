/**
 * First-run doctor — environment probes + actionable install hints.
 *
 * The CLI runs onboarding on first launch (no `~/.gg/auth.json` and no
 * `~/.gg/onboarded-ggeditor` marker). The same checks are exposed via
 * `ggeditor doctor` so users can re-run it any time.
 *
 * Design rules:
 *   - Probes only. We never auto-install anything — surprise sudo
 *     prompts are worse than a missing dep.
 *   - Each check carries `severity`:
 *       block    — nothing meaningful works without it (none currently;
 *                  the agent can run with zero deps)
 *       required — most tools need it (ffmpeg / ffprobe)
 *       optional — unlocks a feature group (openai-key, resolve,
 *                  premiere, whisper-cpp, whisperx)
 *       info     — purely informational (auth status)
 *   - Each check tells the user EXACTLY what to do to fix it, including
 *     the platform-appropriate install command.
 *   - Pure module — no I/O writes, no side effects beyond `spawnSync` /
 *     `existsSync` probes.
 */

import { existsSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectHost } from "./hosts/detect.js";
import { checkFfmpeg, checkFfprobe } from "./media/ffmpeg.js";

export type CheckSeverity = "block" | "required" | "optional" | "info";

export type CheckStatus = "ok" | "missing" | "warn";

export interface DoctorCheck {
  /** Stable id (also the check key). */
  id: string;
  /** ≤30 char display label. */
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  /** One-line current state ("v6.1.1 found", "not on PATH", …). */
  detail: string;
  /**
   * What this check unlocks for the user. Always present, even when
   * status=ok — gives the user the mental model.
   */
  unlocks: string;
  /**
   * Fix instruction. Multi-line ok. Empty when status=ok.
   * Platform-appropriate (macOS / linux / win32).
   */
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** True when no `severity=required` check is missing. */
  ready: boolean;
  /** Where the marker file was/should be written. */
  markerPath: string;
  /** Whether onboarding has been completed before. */
  onboarded: boolean;
}

const ONBOARDED_MARKER = "onboarded-ggeditor";

export function onboardedMarkerPath(home: string = homedir()): string {
  return join(home, ".gg", ONBOARDED_MARKER);
}

export function isOnboarded(home: string = homedir()): boolean {
  try {
    return statSync(onboardedMarkerPath(home)).isFile();
  } catch {
    return false;
  }
}

/**
 * Run every check. Synchronous and quick — only spawns short-lived
 * `--version` style probes.
 */
export function runDoctor(home: string = homedir()): DoctorReport {
  const checks: DoctorCheck[] = [
    checkFfmpegProbe(),
    checkFfprobeProbe(),
    checkOpenAIKey(),
    checkAnthropicKey(),
    checkPython(),
    checkResolve(),
    checkPremiere(),
    checkWhisperCpp(),
    checkWhisperX(),
    checkAuthFile(home),
  ];

  const ready = checks.every((c) => c.severity !== "required" || c.status === "ok");
  return {
    checks,
    ready,
    markerPath: onboardedMarkerPath(home),
    onboarded: isOnboarded(home),
  };
}

// ── Individual probes ──────────────────────────────────────

function checkFfmpegProbe(): DoctorCheck {
  const ok = checkFfmpeg();
  return {
    id: "ffmpeg",
    label: "ffmpeg",
    status: ok ? "ok" : "missing",
    severity: "required",
    detail: ok ? versionLine("ffmpeg") : "not on PATH",
    unlocks:
      "Most tools (transcoding, captions, color grading, silence/filler cuts, transitions, " +
      "audio mixing, GIF/thumbnail generation). ~70% of the toolkit.",
    fix: ok ? undefined : ffmpegInstallHint(),
  };
}

function checkFfprobeProbe(): DoctorCheck {
  const ok = checkFfprobe();
  return {
    id: "ffprobe",
    label: "ffprobe",
    status: ok ? "ok" : "missing",
    severity: "required",
    detail: ok ? versionLine("ffprobe") : "not on PATH",
    unlocks: "probe_media (fps / duration / codec detection — runs on every input file).",
    fix: ok ? undefined : ffmpegInstallHint(),
  };
}

function checkOpenAIKey(): DoctorCheck {
  const present = !!process.env.OPENAI_API_KEY;
  return {
    id: "openai-key",
    label: "OPENAI_API_KEY",
    status: present ? "ok" : "missing",
    severity: "optional",
    detail: present ? "set in environment" : "not set",
    unlocks:
      "Vision tools: analyze_hook (retention scoring), score_shot, color_match, " +
      "grade_skin_tones, match_clip_color, and the OpenAI transcription backend.",
    fix: present
      ? undefined
      : "Get a key at https://platform.openai.com/api-keys, then:\n" +
        "  export OPENAI_API_KEY=sk-...\n" +
        "  # add to ~/.zshrc / ~/.bashrc to persist",
  };
}

function checkAnthropicKey(): DoctorCheck {
  // Anthropic auth normally goes through OAuth (~/.gg/auth.json). The env
  // var only matters for users who prefer raw API keys. We mark it as
  // info — auth status is what really matters.
  const present = !!process.env.ANTHROPIC_API_KEY;
  return {
    id: "anthropic-key",
    label: "ANTHROPIC_API_KEY",
    status: present ? "ok" : "missing",
    severity: "info",
    detail: present
      ? "set in environment (overrides OAuth token if present)"
      : "not set (OAuth is the recommended path)",
    unlocks: "Direct Anthropic API auth without OAuth. Most users should `ggeditor login` instead.",
    fix: undefined,
  };
}

function checkPython(): DoctorCheck {
  const candidates = platform() === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, cmd === "py" ? ["-3", "--version"] : ["--version"], {
      encoding: "utf8",
    });
    if (r.status === 0) {
      const out = (r.stdout || r.stderr).trim();
      return {
        id: "python",
        label: "Python 3",
        status: "ok",
        severity: "optional",
        detail: `${cmd}: ${out}`,
        unlocks:
          "DaVinci Resolve scripting bridge (host integration). Without Python, file-only " +
          "mode still works.",
      };
    }
  }
  return {
    id: "python",
    label: "Python 3",
    status: "missing",
    severity: "optional",
    detail: "no python3 / python / py interpreter found",
    unlocks:
      "DaVinci Resolve scripting bridge (host integration). File-only mode works without it.",
    fix:
      platform() === "darwin"
        ? "brew install python@3.12   # or use python.org installer"
        : platform() === "linux"
          ? "sudo apt install python3   # debian/ubuntu — your distro's package manager otherwise"
          : "winget install Python.Python.3   # or python.org installer",
  };
}

function checkResolve(): DoctorCheck {
  const detected = detectHost();
  if (detected.name === "resolve") {
    return {
      id: "resolve",
      label: "DaVinci Resolve",
      status: "ok",
      severity: "optional",
      detail: "running",
      unlocks:
        "Live timeline editing on Resolve: cut, marker, append, color grade, smart reframe, render.",
    };
  }
  // Resolve isn't running — but is it INSTALLED? Check the canonical
  // install path so the message is precise.
  const installed = isResolveInstalled();
  return {
    id: "resolve",
    label: "DaVinci Resolve",
    status: "missing",
    severity: "optional",
    detail: installed ? "installed but not running" : "not installed",
    unlocks:
      "Live timeline editing on Resolve. Open Resolve before launching ggeditor (or " +
      "mid-session — the agent re-detects every 2s).",
    fix: installed
      ? "Open DaVinci Resolve, then re-run ggeditor (or just keep going — ggeditor will pick " +
        "it up automatically within a few seconds)."
      : "Install the free version from https://www.blackmagicdesign.com/products/davinciresolve",
  };
}

function checkPremiere(): DoctorCheck {
  const detected = detectHost();
  if (detected.name === "premiere") {
    return {
      id: "premiere",
      label: "Adobe Premiere Pro",
      status: "ok",
      severity: "optional",
      detail: "running",
      unlocks:
        "Live timeline editing on Premiere via the gg-editor UXP panel (insert / cut / marker " +
        "/ render). Requires the panel installed (`ggeditor-premiere-panel install`).",
    };
  }
  // Premiere is paid; we don't try to detect installation. Just note it.
  return {
    id: "premiere",
    label: "Adobe Premiere Pro",
    status: "missing",
    severity: "optional",
    detail: "not running",
    unlocks: "Live timeline editing on Premiere. Open Premiere + install the gg-editor panel.",
    fix: "Open Premiere Pro, then install the panel:\n  npx @kenkaiiii/gg-editor-premiere-panel install",
  };
}

function checkWhisperCpp(): DoctorCheck {
  for (const cmd of ["whisper-cli", "whisper", "main"]) {
    const r = spawnSync(cmd, ["--help"], { encoding: "utf8" });
    if (r.status === 0 && (r.stdout + r.stderr).toLowerCase().includes("whisper")) {
      return {
        id: "whisper-cpp",
        label: "whisper.cpp",
        status: "ok",
        severity: "optional",
        detail: `${cmd} on PATH`,
        unlocks:
          "Local transcription (free, fast, private). Without it, transcribe falls back to " +
          "the OpenAI API (requires OPENAI_API_KEY).",
      };
    }
  }
  return {
    id: "whisper-cpp",
    label: "whisper.cpp",
    status: "missing",
    severity: "optional",
    detail: "not on PATH",
    unlocks:
      "Local transcription. Without it, transcribe uses the OpenAI API (requires OPENAI_API_KEY).",
    fix:
      platform() === "darwin"
        ? "brew install whisper-cpp   # then download a model from https://huggingface.co/ggerganov/whisper.cpp"
        : "Build from source: https://github.com/ggml-org/whisper.cpp",
  };
}

function checkWhisperX(): DoctorCheck {
  const r = spawnSync("whisperx", ["--help"], { encoding: "utf8" });
  const ok = r.status === 0;
  const hfToken = !!process.env.HF_TOKEN;
  if (ok && hfToken) {
    return {
      id: "whisperx",
      label: "whisperx + HF_TOKEN",
      status: "ok",
      severity: "optional",
      detail: "whisperx on PATH, HF_TOKEN set",
      unlocks:
        "Speaker diarization (transcribe with diarize=true). Required for read_transcript with " +
        "speaker filters.",
    };
  }
  if (ok && !hfToken) {
    return {
      id: "whisperx",
      label: "whisperx + HF_TOKEN",
      status: "warn",
      severity: "optional",
      detail: "whisperx on PATH but HF_TOKEN not set",
      unlocks: "Speaker diarization (transcribe with diarize=true).",
      fix:
        "Get a token at https://huggingface.co/settings/tokens (free), then:\n" +
        "  export HF_TOKEN=hf_...\n" +
        "Also accept the pyannote model terms: https://huggingface.co/pyannote/speaker-diarization-3.1",
    };
  }
  return {
    id: "whisperx",
    label: "whisperx + HF_TOKEN",
    status: "missing",
    severity: "optional",
    detail: "whisperx not on PATH",
    unlocks: "Speaker diarization (transcribe with diarize=true).",
    fix:
      "pip install whisperx\n" +
      "export HF_TOKEN=hf_...   # https://huggingface.co/settings/tokens\n" +
      "Then accept https://huggingface.co/pyannote/speaker-diarization-3.1 model terms.",
  };
}

function checkAuthFile(home: string): DoctorCheck {
  const path = join(home, ".gg", "auth.json");
  const exists = (() => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  })();
  return {
    id: "auth",
    label: "Auth (~/.gg/auth.json)",
    status: exists ? "ok" : "missing",
    severity: "required",
    detail: exists ? `present at ${path}` : "not configured",
    unlocks: "The agent itself. Without auth, ggeditor can't talk to a model provider.",
    fix: exists
      ? undefined
      : "Run `ggeditor login` and pick a provider (Anthropic OAuth recommended; OpenAI / GLM / " +
        "Moonshot also supported). Auth is shared with ggcoder via ~/.gg/auth.json — log in once.",
  };
}

// ── Helpers ────────────────────────────────────────────────

function versionLine(cmd: string): string {
  const r = spawnSync(cmd, ["-version"], { encoding: "utf8" });
  if (r.status !== 0) return "found";
  const first = (r.stdout.split(/\r?\n/)[0] || "").trim();
  return first || "found";
}

function ffmpegInstallHint(): string {
  switch (platform()) {
    case "darwin":
      return "brew install ffmpeg";
    case "linux":
      return "sudo apt install ffmpeg   # debian/ubuntu — your distro's package manager otherwise";
    case "win32":
      return "winget install ffmpeg   # or scoop install ffmpeg";
    default:
      return "Install ffmpeg from https://ffmpeg.org/download.html";
  }
}

function isResolveInstalled(): boolean {
  if (platform() === "darwin") {
    return existsSync("/Applications/DaVinci Resolve/DaVinci Resolve.app");
  }
  if (platform() === "win32") {
    return existsSync("C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe");
  }
  // Linux: Resolve installs into /opt/resolve by default.
  return existsSync("/opt/resolve/bin/resolve");
}
