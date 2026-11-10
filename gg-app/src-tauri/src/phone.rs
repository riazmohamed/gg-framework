//! Phone control (pew2): window commands the sidecar hands to the shell as
//! `GG_APP_PHONE <json>` lines on its stdout. See
//! `packages/ggcoder/src/app-sidecar/phone-control.ts`.

use crate::*;

#[derive(serde::Deserialize, Debug, PartialEq)]
#[serde(tag = "op", rename_all = "lowercase")]
pub(crate) enum PhoneCommand {
    Open {
        #[serde(rename = "requestId")]
        request_id: String,
        mode: WorkspaceMode,
        cwd: String,
        #[serde(rename = "sessionPath")]
        session_path: Option<String>,
    },
    Focus {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Close {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

pub(crate) fn parse_phone_command(line: &str) -> Option<PhoneCommand> {
    serde_json::from_str(line.strip_prefix("GG_APP_PHONE ")?).ok()
}

/// The label of the window whose daemon session is `session_id`.
fn label_for_session(app: &tauri::AppHandle, session_id: &str) -> Option<String> {
    let windows: State<Windows> = app.state();
    let map = windows.map.lock_or_recover();
    map.iter()
        .find(|(_, w)| w.session_id.as_deref() == Some(session_id))
        .map(|(label, _)| label.clone())
}

fn bring_to_front(win: &WebviewWindow) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

pub(crate) fn dispatch_phone_command(app: tauri::AppHandle, command: PhoneCommand) {
    match command {
        PhoneCommand::Focus { session_id } => {
            if let Some(win) = label_for_session(&app, &session_id)
                .and_then(|label| app.get_webview_window(&label))
            {
                bring_to_front(&win);
            }
        }
        PhoneCommand::Close { session_id } => {
            if let Some(win) = label_for_session(&app, &session_id)
                .and_then(|label| app.get_webview_window(&label))
            {
                let _ = win.close();
            }
        }
        PhoneCommand::Open {
            request_id,
            mode,
            cwd,
            session_path,
        } => {
            // Window building must not run on the caller's thread (see `new_window`).
            tauri::async_runtime::spawn(async move {
                let result = open_phone_window(&app, mode, cwd, session_path).await;
                report_opened(&app, &request_id, result).await;
            });
        }
    }
}

/// Open a window straight into `cwd` (+ conversation), the same way a restored
/// window opens: the restore target makes the webview skip Home.
async fn open_phone_window(
    app: &tauri::AppHandle,
    mode: WorkspaceMode,
    cwd: String,
    session_path: Option<String>,
) -> Result<String, String> {
    let label = next_window_label(app);
    register_restore_target(
        &mut app.state::<RestoreTargets>().map.lock_or_recover(),
        label.clone(),
        RestoreEntry {
            mode,
            chat_agent: ChatAgent::General,
            cwd: cwd.clone(),
            session_path: session_path.clone(),
        },
    );
    let win = match build_app_window(app, &label) {
        Ok(win) => win,
        Err(error) => {
            remove_restore_target(
                &mut app.state::<RestoreTargets>().map.lock_or_recover(),
                &label,
            );
            return Err(error);
        }
    };
    let cwd_path = PathBuf::from(&cwd);
    let generation = prepare_window_session(
        app,
        &label,
        mode,
        ChatAgent::General,
        &cwd_path,
        session_path.as_deref(),
    );
    bring_to_front(&win);
    broadcast_window_order(app);
    finish_window_session(
        app.clone(),
        label.clone(),
        mode,
        ChatAgent::General,
        cwd_path,
        session_path,
        generation,
    )
    .await?;
    let windows: State<Windows> = app.state();
    let map = windows.map.lock_or_recover();
    map.get(&label)
        .and_then(|w| w.session_id.clone())
        .ok_or_else(|| "window session missing".to_string())
}

async fn report_opened(app: &tauri::AppHandle, request_id: &str, result: Result<String, String>) {
    let Some(port) = *app.state::<Daemon>().port.lock_or_recover() else {
        return;
    };
    let body = match result {
        Ok(session_id) => serde_json::json!({ "requestId": request_id, "sessionId": session_id }),
        Err(error) => serde_json::json!({ "requestId": request_id, "error": error }),
    };
    let client = app.state::<reqwest::Client>().inner().clone();
    let _ = client
        .post(format!("{}/phone-shell/opened", sidecar_base(port)))
        .json(&body)
        .send()
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_phone_commands() {
        assert_eq!(
            parse_phone_command(
                r#"GG_APP_PHONE {"op":"open","requestId":"r1","mode":"code","cwd":"/a","sessionPath":null}"#
            ),
            Some(PhoneCommand::Open {
                request_id: "r1".into(),
                mode: WorkspaceMode::Code,
                cwd: "/a".into(),
                session_path: None,
            })
        );
        assert_eq!(
            parse_phone_command(r#"GG_APP_PHONE {"op":"focus","sessionId":"s"}"#),
            Some(PhoneCommand::Focus {
                session_id: "s".into()
            })
        );
        assert_eq!(
            parse_phone_command(r#"GG_APP_PHONE {"op":"close","sessionId":"s"}"#),
            Some(PhoneCommand::Close {
                session_id: "s".into()
            })
        );
        assert_eq!(parse_phone_command("GG_APP_PHONE nope"), None);
        assert_eq!(parse_phone_command("other"), None);
    }
}
