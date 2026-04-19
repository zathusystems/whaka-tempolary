use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[cfg(not(target_os = "android"))]
use std::thread;
#[cfg(not(target_os = "android"))]
use std::time::Duration;
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri::{AppHandle, Listener, PhysicalSize, Size, WebviewWindow};

mod printer;
mod backend;

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedSessionSnapshot {
    entries: BTreeMap<String, String>,
}

fn session_snapshot_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .or_else(|_| app.path().data_dir())
        .map_err(|error| format!("Could not resolve app data directory: {}", error))?;

    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("Could not create app data directory: {}", error))?;

    Ok(base_dir.join("session-snapshot.json"))
}

#[tauri::command]
fn save_session_snapshot(
    app: tauri::AppHandle,
    entries: BTreeMap<String, String>,
) -> Result<(), String> {
    let snapshot_path = session_snapshot_path(&app)?;
    let payload = PersistedSessionSnapshot { entries };
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Could not serialize session snapshot: {}", error))?;

    std::fs::write(&snapshot_path, serialized.as_bytes())
        .map_err(|error| format!("Could not write session snapshot: {}", error))?;

    Ok(())
}

#[tauri::command]
fn load_session_snapshot(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let snapshot_path = session_snapshot_path(&app)?;
    if !snapshot_path.exists() {
        return Ok(BTreeMap::new());
    }

    let raw = std::fs::read_to_string(&snapshot_path)
        .map_err(|error| format!("Could not read session snapshot: {}", error))?;
    let parsed: PersistedSessionSnapshot = serde_json::from_str(&raw)
        .map_err(|error| format!("Could not parse session snapshot: {}", error))?;

    Ok(parsed.entries)
}

#[tauri::command]
fn clear_session_snapshot(app: tauri::AppHandle) -> Result<(), String> {
    let snapshot_path = session_snapshot_path(&app)?;
    if snapshot_path.exists() {
        std::fs::remove_file(&snapshot_path)
            .map_err(|error| format!("Could not remove session snapshot: {}", error))?;
    }

    Ok(())
}

#[tauri::command]
fn save_inventory_template_csv(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let sanitized_filename = filename
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    let fallback_name = "inventory-template.csv".to_string();
    let final_filename = if sanitized_filename.trim().is_empty() {
        fallback_name
    } else {
        sanitized_filename
    };

    let mut target_directories: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = app.path().download_dir() {
        target_directories.push(dir);
    }
    if let Ok(dir) = app.path().document_dir() {
        target_directories.push(dir);
    }
    if let Ok(dir) = app.path().data_dir() {
        target_directories.push(dir);
    }
    if let Ok(dir) = app.path().cache_dir() {
        target_directories.push(dir);
    }

    let mut last_error: Option<String> = None;

    for directory in target_directories {
        if let Err(err) = std::fs::create_dir_all(&directory) {
            last_error = Some(format!(
                "Could not create directory {}: {}",
                directory.display(),
                err
            ));
            continue;
        }

        let output_path = directory.join(&final_filename);
        match std::fs::write(&output_path, content.as_bytes()) {
            Ok(_) => return Ok(output_path.display().to_string()),
            Err(err) => {
                last_error = Some(format!("Failed writing {}: {}", output_path.display(), err));
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| "No writable directory available for template export.".to_string()))
}

#[cfg(not(target_os = "android"))]
fn fit_window_to_monitor(window: &WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    let (Some(monitor), Ok(current_size)) = (monitor, window.outer_size()) else {
        return;
    };

    // Reserve space for desktop bars/window decorations so the window does not overflow.
    let max_width = monitor.size().width.saturating_sub(32);
    let max_height = monitor.size().height.saturating_sub(72);

    if max_width < 320 || max_height < 320 {
        return;
    }

    let target_width = current_size.width.min(max_width);
    let target_height = current_size.height.min(max_height);

    if target_width != current_size.width || target_height != current_size.height {
        let _ = window.set_size(Size::Physical(PhysicalSize::new(
            target_width,
            target_height,
        )));
    }
}

#[cfg(not(target_os = "android"))]
fn center_window_stable(app: AppHandle, label: &'static str) {
    thread::spawn(move || {
        // Some window managers report transient geometry right after show().
        // Retry centering briefly so splash/main end up centered reliably.
        for _ in 0..6 {
            if let Some(window) = app.get_webview_window(label) {
                if label == "main" {
                    fit_window_to_monitor(&window);
                }
                let _ = window.center();
            }
            thread::sleep(Duration::from_millis(80));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[Tauri] Starting Mwaka POS application");

    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        printer::get_printers,
        printer::print_receipt,
        save_session_snapshot,
        load_session_snapshot,
        clear_session_snapshot,
        save_inventory_template_csv,
    ]);

    #[cfg(not(target_os = "android"))]
    let builder = builder.setup(|app| {
        if let Some(backend_state) = backend::maybe_spawn_backend(&app.handle()) {
            app.manage(backend_state);
        }

        let splash_window = app.get_webview_window("splash");
        let main_window = app.get_webview_window("main");

        // Mobile targets and simplified desktop configs may not define a splash window.
        if splash_window.is_none() || main_window.is_none() {
            return Ok(());
        }

        let splash_window = splash_window.expect("validated above");
        let main_window = main_window.expect("validated above");

        let ready_handle = app.handle().clone();
        app.listen("frontend-ready", move |_event| {
            println!("[Tauri] Received frontend-ready event");

            if let Some(main) = ready_handle.get_webview_window("main") {
                let already_visible = main.is_visible().unwrap_or(false);
                if already_visible {
                    return;
                }
            }

            if let Some(splash) = ready_handle.get_webview_window("splash") {
                let _ = splash.hide();
            }

            if let Some(main) = ready_handle.get_webview_window("main") {
                let _ = main.show();
                fit_window_to_monitor(&main);
                let _ = main.center();
                let _ = main.set_focus();
                center_window_stable(ready_handle.clone(), "main");
            }

            println!("[Tauri] Main window shown after frontend-ready event");
        });

        let _ = splash_window.hide();
        let _ = splash_window.show();
        let _ = splash_window.center();
        let _ = splash_window.set_focus();
        center_window_stable(app.handle().clone(), "splash");

        let _ = main_window.hide();

        let fallback_handle = app.handle().clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(25));

            if let Some(main) = fallback_handle.get_webview_window("main") {
                let should_show = main.is_visible().map(|visible| !visible).unwrap_or(true);
                if should_show {
                    println!("[Tauri] frontend-ready timeout after 25s, showing main window");

                    if let Some(splash) = fallback_handle.get_webview_window("splash") {
                        let _ = splash.hide();
                    }

                    let _ = main.show();
                    fit_window_to_monitor(&main);
                    let _ = main.center();
                    let _ = main.set_focus();
                    center_window_stable(fallback_handle.clone(), "main");
                }
            }
        });

        Ok(())
    });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "windows")]
        match event {
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
                if let Some(state) = app_handle.try_state::<backend::BackendState>() {
                    state.stop();
                }
            }
            _ => {}
        }
    });
}
