//! The shared Node daemon: spawn/respawn, per-window session lifecycle, session lookups.

use crate::*;

pub(crate) fn sidecar_base(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// The shared daemon port (same for every window). Named `port_for` so the ~35
/// proxy commands keep their call shape; the per-window routing is the session
/// id (`session_for`), attached as the `x-gg-session` header.
pub(crate) fn port_for(webview: &WebviewWindow) -> Option<u16> {
    let daemon: State<Daemon> = webview.state();
    let port = *daemon.port.lock_or_recover();
    port
}

/// The daemon session id for the window that issued a command, or `None` until
/// the daemon's `POST /session` has returned for this window.
pub(crate) fn session_for(webview: &WebviewWindow) -> Option<String> {
    let windows: State<Windows> = webview.state();
    let map = windows.map.lock_or_recover();
    map.get(webview.label()).and_then(|w| w.session_id.clone())
}

pub(crate) fn cwd_for(webview: &WebviewWindow) -> Option<PathBuf> {
    let windows: State<Windows> = webview.state();
    let map = windows.map.lock_or_recover();
    map.get(webview.label()).and_then(|w| w.cwd.clone())
}

/// Await the daemon's HTTP port (set by its `GG_APP_LISTENING` handshake),
/// polling up to ~30s. Returns `None` if the daemon never came up. Mirrors the
/// webview's `waitForReady` poll cadence.
pub(crate) async fn await_daemon_port(app: &tauri::AppHandle) -> Option<u16> {
    for _ in 0..600 {
        if let Some(p) = *app.state::<Daemon>().port.lock_or_recover() {
            return Some(p);
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    None
}

/// Frontend polls this until it returns a port. Returns the daemon port only
/// once THIS window has a session (so `waitForReady` still gates correctly:
/// a window isn't "ready" until its session exists), mirroring `sidecar-ready`.
#[tauri::command]
pub(crate) fn sidecar_port(webview: WebviewWindow) -> Option<u16> {
    session_for(&webview)?;
    port_for(&webview)
}

pub(crate) const DAEMON_STABLE_UPTIME: std::time::Duration = std::time::Duration::from_secs(60);
pub(crate) const DAEMON_MAX_RESPAWNS: u32 = 5;

/// Exponential crash-loop backoff: 1s, 2s, 4s, 8s, 16s, then stop.
/// A hard retry budget prevents a broken sidecar/signature/configuration from
/// turning the desktop shell into an unbounded process-spawn and disk-write loop.
pub(crate) fn daemon_respawn_delay(attempt: u32) -> Option<std::time::Duration> {
    if attempt == 0 || attempt > DAEMON_MAX_RESPAWNS {
        return None;
    }
    Some(std::time::Duration::from_secs(1 << (attempt - 1)))
}

pub(crate) fn emit_daemon_error(app: &tauri::AppHandle, message: &str) {
    for label in app.webview_windows().keys() {
        let _ = app.emit_to(
            EventTarget::webview_window(label.clone()),
            "sidecar-error",
            message,
        );
    }
}

/// Spawn the ONE shared Node daemon. Reads its `GG_APP_LISTENING` handshake to
/// learn the shared port; on an unexpected exit it reaps the dead child, applies
/// bounded exponential backoff, and re-creates every live window's session.
/// Five short-lived respawns exhaust the retry budget; one minute of stable
/// uptime resets it.
///
/// The daemon is a process-group leader (Unix), so `terminate_child` reaps its
/// entire descendant tree (every session's MCP stdio children + LSP servers) in
/// one group-kill — no orphans on quit.
pub(crate) fn spawn_daemon(app: tauri::AppHandle, is_respawn: bool) {
    let started_at = std::time::Instant::now();
    let script = resolve_sidecar(&app);
    let node = resolve_node(&app);
    log::info!("spawning daemon: {} {}", node.display(), script.display());

    let mut cmd = Command::new(node);
    hide_console(&mut cmd);
    cmd.arg(&script)
        // Port 0 → the OS assigns a free port, reported back via the
        // GG_APP_LISTENING handshake.
        .env("GG_APP_PORT", "0")
        .env("GG_APP_TOKEN", &app.state::<Daemon>().token)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = match cmd.spawn() {
        Ok(c) => {
            // Record the sidecar PID (== its process-group id on Unix, since it's
            // a group leader). The startup orphan sweep uses this ledger to
            // recognise this sidecar's MCP/LSP children by lineage if the app is
            // later crashed/force-quit — works for ANY MCP server, no name list.
            record_sidecar_pid(c.id() as i32);
            c
        }
        Err(e) => {
            let message = format!("failed to spawn daemon: {e}");
            log::error!("{message}");
            emit_daemon_error(&app, &message);
            return;
        }
    };

    // Publish the child before starting pipe readers. A process can fail before
    // the reader thread starts; storing first guarantees the crash handler can
    // still take and reap that exact child instead of leaving a zombie behind.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    {
        let daemon: State<Daemon> = app.state();
        *daemon.child.lock_or_recover() = Some(child);
    }

    if let Some(stdout) = stdout {
        let app2 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(rest) = line.strip_prefix("GG_APP_LISTENING ") {
                    // Format: `GG_APP_LISTENING <port> <token>` (token consumed
                    // by non-Rust spawners; ours arrives via GG_APP_TOKEN).
                    if let Ok(port) = rest.split_whitespace().next().unwrap_or("").parse::<u16>() {
                        log::info!("daemon listening on port {port}");
                        *app2.state::<Daemon>().port.lock_or_recover() = Some(port);
                        // On a respawn the windows already exist with (now
                        // stale) sessions — re-create them all. On the initial
                        // spawn `restore_or_default_windows` drives creation.
                        if is_respawn {
                            recreate_all_window_sessions(app2.clone());
                        }
                    }
                } else {
                    log::debug!("[daemon] {line}");
                }
            }

            // stdout closed → the daemon exited (or lost its control pipe). If
            // the app isn't quitting, remove the stale port and reap/terminate
            // the exact child before considering a bounded respawn.
            if app2.state::<AppExiting>().0.load(Ordering::SeqCst) {
                return;
            }

            let attempt = {
                let daemon: State<Daemon> = app2.state();
                *daemon.port.lock_or_recover() = None;
                if let Some(mut old_child) = daemon.child.lock_or_recover().take() {
                    match old_child.try_wait() {
                        Ok(Some(_)) => {
                            let _ = old_child.wait();
                        }
                        _ => terminate_child(old_child),
                    }
                }
                let mut attempts = daemon.respawn_attempts.lock_or_recover();
                if started_at.elapsed() >= DAEMON_STABLE_UPTIME {
                    *attempts = 0;
                }
                *attempts += 1;
                *attempts
            };

            let Some(delay) = daemon_respawn_delay(attempt) else {
                let message =
                    "Agent daemon stopped after repeated crashes. Restart GG Coder to try again.";
                log::error!("daemon crash circuit breaker opened after {attempt} crashes");
                emit_daemon_error(&app2, message);
                return;
            };

            log::warn!(
                "daemon exited unexpectedly — respawn {attempt}/{DAEMON_MAX_RESPAWNS} in {}s",
                delay.as_secs()
            );
            std::thread::sleep(delay);
            if !app2.state::<AppExiting>().0.load(Ordering::SeqCst) {
                spawn_daemon(app2.clone(), true);
            }
        });
    }

    if let Some(stderr) = stderr {
        let app3 = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                log::error!("[daemon:stderr] {line}");
                if line.starts_with("GG_APP_FATAL") {
                    emit_daemon_error(&app3, &line);
                }
            }
        });
    }
}

/// POST /session to the daemon for `cwd` (+ optional resume `session_path`);
/// returns the new session id or the daemon's concrete initialization error.
pub(crate) async fn daemon_create_session(
    app: &tauri::AppHandle,
    port: u16,
    mode: WorkspaceMode,
    chat_agent: ChatAgent,
    cwd: &Path,
    session_path: Option<&str>,
) -> Result<String, String> {
    let client = app.state::<reqwest::Client>().inner().clone();
    let body = serde_json::json!({
        "mode": mode,
        "chatAgent": chat_agent,
        "cwd": cwd.to_string_lossy(),
        "sessionPath": session_path,
    });
    let res = client
        .post(format!("{}/session", sidecar_base(port)))
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = res.status();
    let value = res
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(value
            .get("error")
            .and_then(|error| error.as_str())
            .unwrap_or("failed to create agent session")
            .to_string());
    }
    value
        .get("sessionId")
        .and_then(|session_id| session_id.as_str())
        .map(|session_id| session_id.to_string())
        .ok_or_else(|| "agent daemon returned no session id".to_string())
}

/// DELETE /session/:id on the daemon (best-effort, fire-and-forget).
pub(crate) async fn daemon_delete_session(app: &tauri::AppHandle, port: u16, id: &str) {
    let client = app.state::<reqwest::Client>().inner().clone();
    let _ = client
        .delete(format!(
            "{}/session/{}",
            sidecar_base(port),
            urlencoding(id)
        ))
        .send()
        .await;
}

pub(crate) fn publish_window_session(
    map: &mut HashMap<String, WindowSession>,
    label: &str,
    generation: u64,
    session_id: String,
) -> bool {
    let Some(entry) = map.get_mut(label) else {
        return false;
    };
    if entry.generation != generation {
        return false;
    }
    entry.session_id = Some(session_id);
    true
}

/// Record a pending window session synchronously. This invalidates older starts
/// before any daemon request is allowed to publish its response.
pub(crate) fn prepare_window_session(
    app: &tauri::AppHandle,
    label: &str,
    mode: WorkspaceMode,
    chat_agent: ChatAgent,
    cwd: &Path,
    session_path: Option<&str>,
) -> u64 {
    let windows: State<Windows> = app.state();
    let generation = windows.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut map = windows.map.lock_or_recover();
    let entry = map.entry(label.to_string()).or_default();
    entry.generation = generation;
    entry.mode = mode;
    entry.chat_agent = chat_agent;
    entry.cwd = Some(cwd.to_path_buf());
    entry.session_path = session_path.map(str::to_string);
    entry.session_id = None;
    log::info!(
        "window session starting label={label} generation={generation} mode={mode:?} cwd={} elapsed_ms=0",
        cwd.display()
    );
    generation
}

/// Finish a prepared session and publish it only if its generation is current.
/// Returning the daemon error lets picker commands remain on the session list
/// instead of entering a loading screen that can never hydrate.
pub(crate) async fn finish_window_session(
    app: tauri::AppHandle,
    label: String,
    mode: WorkspaceMode,
    chat_agent: ChatAgent,
    cwd: PathBuf,
    session_path: Option<String>,
    generation: u64,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let Some(port) = await_daemon_port(&app).await else {
        let message = "daemon did not start in time".to_string();
        let current = app
            .state::<Windows>()
            .map
            .lock_or_recover()
            .get(&label)
            .is_some_and(|entry| entry.generation == generation);
        log::error!(
            "window session daemon unavailable label={label} generation={generation} mode={mode:?} cwd={} elapsed_ms={}",
            cwd.display(),
            started_at.elapsed().as_millis()
        );
        if current {
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                "sidecar-error",
                &message,
            );
        }
        return Err(message);
    };

    let id = match daemon_create_session(
        &app,
        port,
        mode,
        chat_agent,
        &cwd,
        session_path.as_deref(),
    )
    .await
    {
        Ok(id) => id,
        Err(message) => {
            let current = app
                .state::<Windows>()
                .map
                .lock_or_recover()
                .get(&label)
                .is_some_and(|entry| entry.generation == generation);
            log::error!(
                "daemon session creation failed label={label} generation={generation} mode={mode:?} cwd={} error={message} elapsed_ms={}",
                cwd.display(),
                started_at.elapsed().as_millis()
            );
            if current {
                let _ = app.emit_to(
                    EventTarget::webview_window(label.clone()),
                    "sidecar-error",
                    &message,
                );
            }
            return Err(message);
        }
    };

    let published = {
        let windows: State<Windows> = app.state();
        let mut map = windows.map.lock_or_recover();
        publish_window_session(&mut map, &label, generation, id.clone())
    };
    if !published {
        log::warn!(
            "stale window session discarded label={label} generation={generation} mode={mode:?} cwd={} daemon_session_id={id} elapsed_ms={}",
            cwd.display(),
            started_at.elapsed().as_millis()
        );
        daemon_delete_session(&app, port, &id).await;
        return Err("session selection was superseded".to_string());
    }

    log::info!(
        "window session ready label={label} generation={generation} mode={mode:?} cwd={} daemon_session_id={id} elapsed_ms={}",
        cwd.display(),
        started_at.elapsed().as_millis()
    );
    start_event_bridge(app.clone(), label.clone(), port, id);
    let _ = app.emit_to(EventTarget::webview_window(label), "sidecar-ready", port);
    Ok(())
}

/// Create (or re-point) one window's session in the background.
pub(crate) fn start_window_session(
    app: tauri::AppHandle,
    label: String,
    mode: WorkspaceMode,
    chat_agent: ChatAgent,
    cwd: PathBuf,
    session_path: Option<String>,
) {
    let generation = prepare_window_session(
        &app,
        &label,
        mode,
        chat_agent,
        &cwd,
        session_path.as_deref(),
    );
    tauri::async_runtime::spawn(async move {
        let _ = finish_window_session(app, label, mode, chat_agent, cwd, session_path, generation)
            .await;
    });
}

/// After a daemon respawn, re-create a session for every live window from its
/// stored `{mode, cwd, session_path}` so each webview re-hydrates.
pub(crate) fn recreate_all_window_sessions(app: tauri::AppHandle) {
    let targets: Vec<(String, WorkspaceMode, ChatAgent, PathBuf, Option<String>)> = {
        let windows: State<Windows> = app.state();
        let map = windows.map.lock_or_recover();
        map.iter()
            .filter_map(|(label, window)| {
                window.cwd.clone().map(|cwd| {
                    (
                        label.clone(),
                        window.mode,
                        window.chat_agent,
                        cwd,
                        window.session_path.clone(),
                    )
                })
            })
            .collect()
    };
    for (label, mode, chat_agent, cwd, session_path) in targets {
        start_window_session(app.clone(), label, mode, chat_agent, cwd, session_path);
    }
}

/// Boot the app's windows. If a workspace snapshot has restorable windows (each
/// with a cwd that still exists on disk), reopen one window per entry — pointed
/// at its project + session, with saved geometry — and record a per-window
/// restore target so the webview skips the picker. Otherwise fall back to the
/// single default `main` window at the boot cwd (the picker then shows).
pub(crate) fn restore_or_default_windows(app: &tauri::AppHandle) -> Result<(), String> {
    let ws = read_workspace();
    let entries = filter_restorable(ws.windows, |c| Path::new(c).exists());
    if entries.is_empty() {
        // Fresh boot / nothing to restore: the usual single main window.
        build_app_window(app, "main")?;
        start_window_session(
            app.clone(),
            "main".into(),
            WorkspaceMode::Code,
            ChatAgent::General,
            default_cwd(),
            None,
        );
        broadcast_window_order(app);
        return Ok(());
    }

    let count = entries.len();
    let mut any_geometry = false;
    for (i, entry) in entries.into_iter().enumerate() {
        // First restored window reclaims `main`; the rest get project-N.
        let label = if i == 0 {
            "main".to_string()
        } else {
            format!("project-{i}")
        };
        // Register the target before constructing the webview: even a hidden
        // webview may execute immediately after build() returns.
        {
            let state: State<RestoreTargets> = app.state();
            register_restore_target(
                &mut state.map.lock_or_recover(),
                label.clone(),
                RestoreEntry {
                    mode: entry.mode,
                    chat_agent: entry.chat_agent,
                    cwd: entry.cwd.clone(),
                    session_path: entry.session_path.clone(),
                },
            );
        }
        let win = match build_app_window_with_visibility(app, &label, false) {
            Ok(win) => win,
            Err(error) => {
                remove_restore_target(
                    &mut app.state::<RestoreTargets>().map.lock_or_recover(),
                    &label,
                );
                return Err(error);
            }
        };
        start_window_session(
            app.clone(),
            label.clone(),
            entry.mode,
            entry.chat_agent,
            PathBuf::from(&entry.cwd),
            entry.session_path.clone(),
        );
        // Apply saved geometry when present; else we tile after the loop.
        if let (Some(x), Some(y)) = (entry.x, entry.y) {
            any_geometry = true;
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        if let (Some(w), Some(h)) = (entry.width, entry.height) {
            any_geometry = true;
            let _ = win.set_size(tauri::PhysicalSize::new(w, h));
        }
        let _ = win.show();
    }
    if !any_geometry {
        arrange_windows(app, count);
    }
    broadcast_window_order(app);
    Ok(())
}

/// Before the final exit snapshot, re-read each live session's `/state` (via the
/// shared daemon, keyed by the window's `x-gg-session` header) so a window that
/// started a new session mid-run (changing its session file) is recorded at its
/// CURRENT session, not the one it was created with. Best-effort + time-boxed:
/// any window we can't reach keeps its last-known session_path.
pub(crate) fn refresh_live_sessions(app: &tauri::AppHandle) {
    let Some(port) = *app.state::<Daemon>().port.lock_or_recover() else {
        return;
    };
    let targets: Vec<(String, String)> = {
        let state: State<Windows> = app.state();
        let map = state.map.lock_or_recover();
        map.iter()
            .filter_map(|(label, w)| w.session_id.clone().map(|id| (label.clone(), id)))
            .collect()
    };
    if targets.is_empty() {
        return;
    }
    let client = app.state::<reqwest::Client>().inner().clone();
    // The exit callback runs on the main event-loop thread (outside the async
    // runtime), so block_on is safe here. Each request is time-boxed so a hung
    // session can't stall quit.
    let results: Vec<(String, Option<String>, Option<PathBuf>)> =
        tauri::async_runtime::block_on(async {
            let mut out = Vec::with_capacity(targets.len());
            for (label, sid) in targets {
                let url = format!("{}/state", sidecar_base(port));
                let req = client
                    .get(&url)
                    .header("x-gg-session", &sid)
                    .timeout(std::time::Duration::from_millis(400))
                    .send()
                    .await;
                let Ok(res) = req else {
                    continue;
                };
                let Ok(body) = res.json::<serde_json::Value>().await else {
                    continue;
                };
                let session_path = body
                    .get("sessionPath")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                let cwd = body
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(PathBuf::from);
                out.push((label, session_path, cwd));
            }
            out
        });
    let state: State<Windows> = app.state();
    let mut map = state.map.lock_or_recover();
    for (label, session_path, cwd) in results {
        if let Some(inst) = map.get_mut(&label) {
            if session_path.is_some() {
                inst.session_path = session_path;
            }
            if let Some(cwd) = cwd {
                inst.cwd = Some(cwd);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_respawns_with_bounded_exponential_backoff() {
        let delays: Vec<u64> = (1..=DAEMON_MAX_RESPAWNS)
            .map(|attempt| daemon_respawn_delay(attempt).unwrap().as_secs())
            .collect();
        assert_eq!(delays, vec![1, 2, 4, 8, 16]);
    }

    #[test]
    fn daemon_crash_loop_opens_circuit_breaker() {
        assert!(daemon_respawn_delay(0).is_none());
        assert!(daemon_respawn_delay(DAEMON_MAX_RESPAWNS + 1).is_none());
    }

    // ── Window↔session map (daemon model) ──────────────────────────────────
    // The `Windows` map replaces the old per-window `Sidecars` registry. These
    // lock in the three mutations the lifecycle relies on: a window gets a
    // session id once the daemon answers, `select_project` re-points it to a
    // fresh session (old id taken so its SSE bridge retires), and a window
    // close removes its entry entirely (peers untouched).

    #[test]
    fn window_session_records_project_before_daemon_answers() {
        // start_window_session records cwd/session_path up front, session_id None
        // until POST /session returns — so snapshot/restore can see the target.
        let mut map: HashMap<String, WindowSession> = HashMap::new();
        map.insert(
            "main".into(),
            WindowSession {
                session_id: None,
                mode: WorkspaceMode::Chat,
                chat_agent: ChatAgent::Research,
                cwd: Some(PathBuf::from("/p/a")),
                session_path: Some("/s/a.jsonl".into()),
                generation: 1,
            },
        );
        let w = map.get("main").unwrap();
        assert!(w.session_id.is_none());
        assert_eq!(w.mode, WorkspaceMode::Chat);
        assert_eq!(w.chat_agent, ChatAgent::Research);
        assert_eq!(w.cwd.as_deref(), Some(Path::new("/p/a")));
        assert_eq!(w.session_path.as_deref(), Some("/s/a.jsonl"));
    }

    #[test]
    fn select_project_repoints_to_a_fresh_session() {
        // Mirrors select_project: take the old id (retires its bridge), then the
        // new session id + cwd land on the SAME window entry.
        let mut map: HashMap<String, WindowSession> = HashMap::new();
        map.insert(
            "main".into(),
            WindowSession {
                session_id: Some("old-id".into()),
                mode: WorkspaceMode::Code,
                chat_agent: ChatAgent::General,
                cwd: Some(PathBuf::from("/p/a")),
                session_path: None,
                generation: 1,
            },
        );
        // select_project takes the old id so the old SSE bridge retires.
        let old = map.get_mut("main").and_then(|w| w.session_id.take());
        assert_eq!(old.as_deref(), Some("old-id"));
        assert!(map.get("main").unwrap().session_id.is_none());
        // start_window_session then records the new project + session id.
        let entry = map.get_mut("main").unwrap();
        entry.mode = WorkspaceMode::Chat;
        entry.chat_agent = ChatAgent::Therapist;
        entry.cwd = Some(PathBuf::from("/p/b"));
        entry.session_id = Some("new-id".into());
        let w = map.get("main").unwrap();
        assert_eq!(w.session_id.as_deref(), Some("new-id"));
        assert_eq!(w.mode, WorkspaceMode::Chat);
        assert_eq!(w.chat_agent, ChatAgent::Therapist);
        assert_eq!(w.cwd.as_deref(), Some(Path::new("/p/b")));
    }

    #[test]
    fn closing_one_window_leaves_peers_intact() {
        // Destroyed removes only the closed window's entry; other windows keep
        // their sessions (the shared daemon process is never touched here).
        let mut map: HashMap<String, WindowSession> = HashMap::new();
        map.insert(
            "main".into(),
            WindowSession {
                session_id: Some("id-1".into()),
                cwd: Some(PathBuf::from("/p/a")),
                session_path: None,
                ..Default::default()
            },
        );
        map.insert(
            "project-1".into(),
            WindowSession {
                session_id: Some("id-2".into()),
                cwd: Some(PathBuf::from("/p/b")),
                session_path: None,
                ..Default::default()
            },
        );
        let removed = map.remove("main").and_then(|w| w.session_id);
        assert_eq!(removed.as_deref(), Some("id-1"));
        assert!(!map.contains_key("main"));
        // Peer survives with its own session.
        assert_eq!(
            map.get("project-1").unwrap().session_id.as_deref(),
            Some("id-2")
        );
    }

    #[test]
    fn restore_target_survives_repeated_webview_mounts_until_cleanup() {
        let mut targets = HashMap::new();
        let entry = RestoreEntry {
            mode: WorkspaceMode::Code,
            chat_agent: ChatAgent::General,
            cwd: "/project".into(),
            session_path: Some("/sessions/one.jsonl".into()),
        };

        register_restore_target(&mut targets, "main".into(), entry);
        assert_eq!(
            restore_target(&targets, "main").map(|target| target.cwd),
            Some("/project".into())
        );
        assert_eq!(
            restore_target(&targets, "main").map(|target| target.cwd),
            Some("/project".into())
        );
        assert!(remove_restore_target(&mut targets, "main").is_some());
        assert!(restore_target(&targets, "main").is_none());
    }

    #[test]
    fn stale_window_session_generation_cannot_overwrite_newer_result() {
        let mut map = HashMap::new();
        map.insert(
            "main".into(),
            WindowSession {
                generation: 2,
                cwd: Some(PathBuf::from("/new-project")),
                ..Default::default()
            },
        );

        assert!(publish_window_session(
            &mut map,
            "main",
            2,
            "new-session".into()
        ));
        assert!(!publish_window_session(
            &mut map,
            "main",
            1,
            "stale-session".into()
        ));
        assert_eq!(
            map.get("main").unwrap().session_id.as_deref(),
            Some("new-session")
        );
    }
}
