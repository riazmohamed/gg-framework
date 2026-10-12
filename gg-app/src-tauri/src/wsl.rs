//! WSL mode (fork-only): the shell runs on Windows but its sidecar runs inside
//! a WSL distro (launched through a `GG_NODE_BIN` wrapper that calls `wsl.exe`).
//!
//! In that mode the agent's world is Linux: project paths are Linux paths and
//! `~/.gg` (settings, auth, workspace) lives in the distro. The shell reaches
//! those files through the `\\wsl.localhost\<distro>` share, and translates
//! native-dialog / drag-drop paths into Linux paths before the agent sees them.
//!
//! Enabled by `GG_APP_WSL_DISTRO` + `GG_APP_WSL_HOME` (the distro user's Linux
//! home, e.g. `/home/me`). Both or neither — a half-configured launcher is
//! rejected at startup rather than silently running against Windows paths.

use std::path::PathBuf;
use std::sync::OnceLock;

/// Where the WSL-hosted sidecar lives.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WslTarget {
    pub(crate) distro: String,
    /// Linux home of the distro user, e.g. `/home/me` (no trailing slash).
    pub(crate) home: String,
}

/// Pure: validate the two env values into a target.
/// `Ok(None)` when both are unset/blank (WSL mode off); `Err` when only one is
/// set or the values are malformed.
pub(crate) fn parse_wsl_target(
    distro: Option<String>,
    home: Option<String>,
) -> Result<Option<WslTarget>, String> {
    let distro = distro
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    let home = home.map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    match (distro, home) {
        (None, None) => Ok(None),
        (Some(_), None) => Err("GG_APP_WSL_DISTRO is set but GG_APP_WSL_HOME is not".into()),
        (None, Some(_)) => Err("GG_APP_WSL_HOME is set but GG_APP_WSL_DISTRO is not".into()),
        (Some(distro), Some(home)) => {
            if distro.contains(['\\', '/']) {
                return Err(format!("GG_APP_WSL_DISTRO is not a distro name: {distro}"));
            }
            if !home.starts_with('/') || home.contains('\\') {
                return Err(format!(
                    "GG_APP_WSL_HOME must be an absolute Linux path: {home}"
                ));
            }
            let home = match home.trim_end_matches('/') {
                "" => "/".to_string(),
                trimmed => trimmed.to_string(),
            };
            Ok(Some(WslTarget { distro, home }))
        }
    }
}

static WSL_TARGET: OnceLock<Result<Option<WslTarget>, String>> = OnceLock::new();

/// The process-wide WSL configuration, read once from the environment.
pub(crate) fn wsl_config() -> &'static Result<Option<WslTarget>, String> {
    WSL_TARGET.get_or_init(|| {
        parse_wsl_target(
            std::env::var("GG_APP_WSL_DISTRO").ok(),
            std::env::var("GG_APP_WSL_HOME").ok(),
        )
    })
}

/// The active WSL target, or `None` in normal (native) mode. A misconfigured
/// environment is rejected in `setup` before any caller gets here, so the
/// `Err` arm is unreachable in a running app.
pub(crate) fn wsl_target() -> Option<&'static WslTarget> {
    wsl_config().as_ref().ok().and_then(Option::as_ref)
}

/// Pure: `/home/me/p` → `\\wsl.localhost\<distro>\home\me\p`.
pub(crate) fn linux_to_unc(target: &WslTarget, linux: &str) -> String {
    let rest = linux.trim_start_matches('/').replace('/', "\\");
    format!(r"\\wsl.localhost\{}\{}", target.distro, rest)
}

/// Pure: `\\wsl.localhost\<distro>\home\me` (or the legacy `\\wsl$\…` form,
/// with or without the `\\?\UNC\` prefix) → `/home/me`. `None` for any path
/// that isn't inside this target's distro.
pub(crate) fn unc_to_linux(target: &WslTarget, path: &str) -> Option<String> {
    let normalized = path.replace('/', "\\");
    let body = normalized
        .strip_prefix(r"\\?\UNC\")
        .or_else(|| normalized.strip_prefix(r"\\"))?;
    let (host, rest) = body.split_once('\\')?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let (distro, tail) = rest.split_once('\\').unwrap_or((rest, ""));
    if !distro.eq_ignore_ascii_case(&target.distro) {
        return None;
    }
    let tail = tail.trim_end_matches('\\');
    Some(format!("/{}", tail.replace('\\', "/")))
}

/// Pure: join a Linux base path and a child segment with `/`.
pub(crate) fn join_linux(base: &str, child: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        child.trim_start_matches('/')
    )
}

/// Pure: the path the agent should receive for a path the shell got from the
/// OS (dialog, drag-drop, settings field). WSL share paths become Linux paths;
/// everything else passes through untouched.
pub(crate) fn agent_path_for(target: Option<&WslTarget>, path: &str) -> String {
    target
        .and_then(|t| unc_to_linux(t, path))
        .unwrap_or_else(|| path.to_string())
}

/// Pure: the Windows-visible path for a path the agent uses. Linux absolute
/// paths map onto the WSL share; everything else passes through untouched.
pub(crate) fn fs_path_for(target: Option<&WslTarget>, path: &str) -> PathBuf {
    match target {
        Some(t) if path.starts_with('/') => PathBuf::from(linux_to_unc(t, path)),
        _ => PathBuf::from(path),
    }
}

/// `agent_path_for` against the active target.
pub(crate) fn agent_path(path: &str) -> String {
    agent_path_for(wsl_target(), path)
}

/// `fs_path_for` against the active target.
pub(crate) fn fs_path(path: &str) -> PathBuf {
    fs_path_for(wsl_target(), path)
}

/// The home that holds `~/.gg`: the distro user's home (via the WSL share) in
/// WSL mode, else the native home.
pub(crate) fn gg_home() -> PathBuf {
    match wsl_target() {
        Some(t) => PathBuf::from(linux_to_unc(t, &t.home)),
        None => crate::paths::home_dir(),
    }
}

/// Webview: map a natively picked path (folder dialog) to the path the agent
/// should use. Identity outside WSL mode.
#[tauri::command]
pub(crate) fn app_agent_path(path: String) -> String {
    agent_path(path.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> WslTarget {
        WslTarget {
            distro: "Ubuntu-22.04".into(),
            home: "/home/me".into(),
        }
    }

    #[test]
    fn test_parse_wsl_target_both_unset_disabled() {
        assert_eq!(parse_wsl_target(None, None), Ok(None));
        assert_eq!(
            parse_wsl_target(Some("  ".into()), Some("".into())),
            Ok(None)
        );
    }

    #[test]
    fn test_parse_wsl_target_both_set_trims_values() {
        let got = parse_wsl_target(Some(" Ubuntu-22.04 ".into()), Some("/home/me/ ".into()));
        assert_eq!(got, Ok(Some(target())));
    }

    #[test]
    fn test_parse_wsl_target_root_home_kept() {
        let got = parse_wsl_target(Some("Ubuntu".into()), Some("/".into())).unwrap();
        assert_eq!(got.unwrap().home, "/");
    }

    #[test]
    fn test_parse_wsl_target_only_one_set_errors() {
        assert!(parse_wsl_target(Some("Ubuntu".into()), None).is_err());
        assert!(parse_wsl_target(None, Some("/home/me".into())).is_err());
    }

    #[test]
    fn test_parse_wsl_target_malformed_values_error() {
        assert!(parse_wsl_target(Some("Ubuntu".into()), Some("home/me".into())).is_err());
        assert!(parse_wsl_target(Some("Ubuntu".into()), Some(r"C:\Users\me".into())).is_err());
        assert!(parse_wsl_target(Some(r"..\x".into()), Some("/home/me".into())).is_err());
    }

    #[test]
    fn test_linux_to_unc_maps_onto_share() {
        assert_eq!(
            linux_to_unc(&target(), "/home/me/projects/app"),
            r"\\wsl.localhost\Ubuntu-22.04\home\me\projects\app"
        );
        assert_eq!(
            linux_to_unc(&target(), "/"),
            r"\\wsl.localhost\Ubuntu-22.04\"
        );
    }

    #[test]
    fn test_unc_to_linux_accepts_share_forms() {
        let t = target();
        for p in [
            r"\\wsl.localhost\Ubuntu-22.04\home\me\projects",
            r"\\wsl$\ubuntu-22.04\home\me\projects\",
            r"\\?\UNC\wsl.localhost\Ubuntu-22.04\home\me\projects",
            "//wsl.localhost/Ubuntu-22.04/home/me/projects",
        ] {
            assert_eq!(
                unc_to_linux(&t, p).as_deref(),
                Some("/home/me/projects"),
                "{p}"
            );
        }
        assert_eq!(
            unc_to_linux(&t, r"\\wsl.localhost\Ubuntu-22.04").as_deref(),
            Some("/")
        );
    }

    #[test]
    fn test_unc_to_linux_other_paths_none() {
        let t = target();
        assert_eq!(unc_to_linux(&t, r"C:\Users\me"), None);
        assert_eq!(unc_to_linux(&t, r"\\server\share\x"), None);
        assert_eq!(unc_to_linux(&t, r"\\wsl.localhost\Debian\home"), None);
        assert_eq!(unc_to_linux(&t, "/home/me"), None);
    }

    #[test]
    fn test_join_linux_single_separator() {
        assert_eq!(join_linux("/home/me/", "/app"), "/home/me/app");
        assert_eq!(join_linux("/", "app"), "/app");
    }

    #[test]
    fn test_agent_path_for_converts_only_in_wsl_mode() {
        let t = target();
        let unc = r"\\wsl.localhost\Ubuntu-22.04\home\me\p";
        assert_eq!(agent_path_for(Some(&t), unc), "/home/me/p");
        assert_eq!(agent_path_for(Some(&t), r"C:\x"), r"C:\x");
        assert_eq!(agent_path_for(None, unc), unc);
    }

    #[test]
    fn test_fs_path_for_maps_linux_paths_only_in_wsl_mode() {
        let t = target();
        assert_eq!(
            fs_path_for(Some(&t), "/home/me/p"),
            PathBuf::from(r"\\wsl.localhost\Ubuntu-22.04\home\me\p")
        );
        assert_eq!(fs_path_for(Some(&t), r"C:\x"), PathBuf::from(r"C:\x"));
        assert_eq!(fs_path_for(None, "/home/me/p"), PathBuf::from("/home/me/p"));
    }
}
