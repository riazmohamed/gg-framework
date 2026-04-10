// Additional terminals that support OSC 8 hyperlinks but aren't detected by
// the supports-hyperlinks library. Checked against both TERM_PROGRAM and
// LC_TERMINAL (the latter is preserved inside tmux).
const ADDITIONAL_HYPERLINK_TERMINALS = [
  "ghostty",
  "Hyper",
  "kitty",
  "alacritty",
  "iTerm.app",
  "iTerm2",
];

let cached: boolean | undefined;

/**
 * Returns whether stdout supports OSC 8 hyperlinks.
 * Result is cached after first call since terminal support doesn't change.
 */
export function supportsHyperlinks(): boolean {
  if (cached !== undefined) return cached;

  // Check TERM_PROGRAM
  const termProgram = process.env["TERM_PROGRAM"];
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    cached = true;
    return true;
  }

  // LC_TERMINAL is set by some terminals (e.g. iTerm2) and preserved inside tmux,
  // where TERM_PROGRAM is overwritten to 'tmux'.
  const lcTerminal = process.env["LC_TERMINAL"];
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    cached = true;
    return true;
  }

  // Kitty sets TERM=xterm-kitty
  const term = process.env["TERM"];
  if (term?.includes("kitty")) {
    cached = true;
    return true;
  }

  // VS Code terminal supports hyperlinks
  if (process.env["TERM_PROGRAM"] === "vscode") {
    cached = true;
    return true;
  }

  // WezTerm supports hyperlinks
  if (process.env["TERM_PROGRAM"] === "WezTerm") {
    cached = true;
    return true;
  }

  cached = false;
  return false;
}
