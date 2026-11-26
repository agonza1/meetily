use crate::audio::recording_commands::StopOutcome;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime,
};
#[cfg(target_os = "macos")]
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    LogicalPosition, LogicalSize, Monitor, Rect, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

#[cfg(target_os = "macos")]
const RECORDING_PANEL: &str = "recording-panel";
#[cfg(target_os = "macos")]
const PANEL_SIZE: LogicalSize<f64> = LogicalSize::new(370.0, 490.0);

#[derive(Debug, Clone)]
pub enum RecordingState {
    Stopped,
    Starting,
    Recording,
    Pausing,
    Paused,
    Resuming,
    Stopping,
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Start with default menu, will update with actual state after initialization
    // Pass can_record=true initially, will be updated by update_tray_menu immediately
    let menu = build_menu(app, RecordingState::Stopped, true)?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Meetily")
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()));

    #[cfg(target_os = "macos")]
    let tray = tray
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle().clone();
                // Create the WKWebView after AppKit has finished dispatching the status item click.
                tauri::async_runtime::spawn(async move {
                    let panel_app = app.clone();
                    if let Err(error) = app.run_on_main_thread(move || {
                        if let Err(error) = toggle_recording_panel(&panel_app, rect) {
                            log::error!("Could not open the recording panel: {error}");
                        }
                    }) {
                        log::error!("Could not schedule the recording panel: {error}");
                    }
                });
            }
        });

    tray.build(app)?;

    // Update tray menu with actual recording state after creation
    update_tray_menu(app);

    Ok(())
}

#[cfg(target_os = "macos")]
fn toggle_recording_panel<R: Runtime>(app: &AppHandle<R>, rect: Rect) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(RECORDING_PANEL) {
        if window.is_visible()? {
            return window.hide();
        }
    }

    let primary = app.primary_monitor()?;
    let clicked_monitor = match (&primary, app.cursor_position()) {
        (Some(primary), Ok(cursor)) => {
            // Tao reports the cursor in primary-display pixels on macOS. Monitor lookup
            // and window placement take desktop points, even across mixed display scales.
            let point = cursor.to_logical::<f64>(primary.scale_factor());
            app.monitor_from_point(point.x, point.y)?
        }
        _ => None,
    };
    show_recording_panel(app, Some(rect), clicked_monitor.or(primary))
}

#[cfg(target_os = "macos")]
fn show_recording_panel<R: Runtime>(
    app: &AppHandle<R>,
    rect: Option<Rect>,
    monitor: Option<Monitor>,
) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window(RECORDING_PANEL) {
        if window.is_visible()? {
            return window.set_focus();
        }
        window
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            RECORDING_PANEL,
            WebviewUrl::App(RECORDING_PANEL.into()),
        )
        .title("Meetily Recording")
        .inner_size(PANEL_SIZE.width, PANEL_SIZE.height)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()?;

        let panel = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = panel.hide();
            }
            WindowEvent::Focused(false) => {
                // Allow a status item click to finish toggling before hiding on blur.
                let panel = panel.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
                    if matches!(panel.is_focused(), Ok(false)) {
                        let _ = panel.hide();
                    }
                });
            }
            _ => {}
        });
        window
    };

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        let origin = work_area.position.to_logical::<f64>(scale);
        let available = work_area.size.to_logical::<f64>(scale);
        let gap = 8.0;
        let width = PANEL_SIZE.width.min((available.width - 2.0 * gap).max(1.0));
        let height = PANEL_SIZE
            .height
            .min((available.height - 2.0 * gap).max(1.0));
        let left = origin.x + gap;
        let top = origin.y + gap;
        let right = (origin.x + available.width - width - gap).max(left);
        let bottom = (origin.y + available.height - height - gap).max(top);
        let placement = rect
            .map(|rect| {
                let anchor = rect.position.to_logical::<f64>(scale);
                let icon = rect.size.to_logical::<f64>(scale);
                LogicalPosition::new(
                    (anchor.x + (icon.width - width) / 2.0).clamp(left, right),
                    (anchor.y + icon.height + gap).clamp(top, bottom),
                )
            })
            .unwrap_or_else(|| LogicalPosition::new(right, top));
        window.set_size(LogicalSize::new(width, height))?;
        window.set_position(placement)?;
    } else {
        window.center()?;
    }
    window.show()?;
    window.set_focus()
}

#[tauri::command]
pub(crate) async fn open_recording_companion<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let panel_app = app.clone();
        app.run_on_main_thread(move || {
            let _ = send.send((|| {
                let rect = match panel_app.tray_by_id("main-tray") {
                    Some(tray) => tray.rect()?,
                    None => None,
                };
                let primary = panel_app.primary_monitor()?;
                let monitor = match panel_app.get_webview_window("main") {
                    Some(main) => main.current_monitor()?.or(primary),
                    None => primary,
                };
                show_recording_panel(&panel_app, rect, monitor)
            })());
        })
        .map_err(|error| error.to_string())?;
        receive
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("The recording panel is available on macOS.".into())
    }
}

#[tauri::command]
pub(crate) fn open_recording_companion_settings<R: Runtime>(app: AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if let Some(panel) = app.get_webview_window(RECORDING_PANEL) {
        let _ = panel.hide();
    }
    focus_main_window(&app);
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, item_id: &str) {
    match item_id {
        "toggle_recording" => toggle_recording_handler(app),
        "pause_recording" => pause_recording_handler(app),
        "resume_recording" => resume_recording_handler(app),
        "stop_recording" => stop_recording_handler(app),
        "open_window" => focus_main_window(app),
        "settings" => {
            focus_main_window(app);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.assign('/settings')");
            }
        }
        "check_updates" => check_updates_handler(app),
        "quit" => app.exit(0),
        _ => {}
    }
}
fn toggle_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    focus_main_window(app);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if crate::is_recording().await {
            // Immediately show stopping state
            set_tray_state(&app_clone, RecordingState::Stopping);

            log::info!("Tray toggle: Stopping recording...");

            // Generate save path (same as RecordingControls.tsx)
            let data_dir = match app_clone.path().app_data_dir() {
                Ok(dir) => dir,
                Err(e) => {
                    log::error!("Failed to get app data dir: {}", e);
                    update_tray_menu_async(&app_clone).await;
                    return;
                }
            };

            let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
            let save_path = data_dir.join(format!("recording-{}.wav", timestamp));

            // Call Rust stop_recording command (like pause/resume pattern)
            let stop_result = crate::audio::recording_commands::stop_recording(
                app_clone.clone(),
                crate::audio::recording_commands::RecordingArgs {
                    save_path: save_path.to_string_lossy().to_string(),
                },
            )
            .await;

            // Handle result
            match stop_result {
                Ok(StopOutcome::Stopped) => {
                    log::info!("Tray toggle: Recording stopped successfully");

                    // Trigger frontend post-processing via event (works from any page)
                    // (SQLite save, navigation, analytics)
                    if let Err(e) = app_clone.emit("recording-stop-complete", true) {
                        log::error!("Tray toggle: Failed to emit recording-stop-complete event: {}", e);
                    }
                }
                Ok(StopOutcome::AlreadyStopping) => {},
                Ok(StopOutcome::NotActive) => update_tray_menu_async(&app_clone).await,
                Err(e) => {
                    log::error!("Tray toggle: Failed to stop recording: {}", e);
                    // Revert tray state on error
                    update_tray_menu_async(&app_clone).await;
                }
            }
        } else {
            // Immediately show starting state
            set_tray_state(&app_clone, RecordingState::Starting);

            log::info!("Emitting start recording event from tray");
            if let Some(window) = app_clone.get_webview_window("main") {
                let _ = window.eval("sessionStorage.setItem('autoStartRecording', 'true')"); // Set the flag to start recording automatically
                let _ = window.eval("window.location.assign('/')");
            }
        }
    });
}

fn pause_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show pausing state
    set_tray_state(app, RecordingState::Pausing);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::audio::recording_commands::pause_recording(app_clone.clone()).await {
            log::error!("Failed to pause recording from tray: {}", e);
            // Revert to current state on error
            update_tray_menu_async(&app_clone).await;
        } else {
            log::info!("Recording paused from tray");
            // The pause_recording function will call update_tray_menu, so no need to call it here
        }
    });
}

fn resume_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show resuming state
    set_tray_state(app, RecordingState::Resuming);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::audio::recording_commands::resume_recording(app_clone.clone()).await
        {
            log::error!("Failed to resume recording from tray: {}", e);
            // Revert to current state on error
            update_tray_menu_async(&app_clone).await;
        } else {
            log::info!("Recording resumed from tray");
            // The resume_recording function will call update_tray_menu, so no need to call it here
        }
    });
}

fn stop_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show stopping state
    set_tray_state(app, RecordingState::Stopping);

    focus_main_window(app);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("Tray: Stopping recording...");

        // Generate save path (same as RecordingControls.tsx)
        let data_dir = match app_clone.path().app_data_dir() {
            Ok(dir) => dir,
            Err(e) => {
                log::error!("Failed to get app data dir: {}", e);
                update_tray_menu_async(&app_clone).await;
                return;
            }
        };

        let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
        let save_path = data_dir.join(format!("recording-{}.wav", timestamp));

        // Call Rust stop_recording command (like pause/resume pattern)
        let stop_result = crate::audio::recording_commands::stop_recording(
            app_clone.clone(),
            crate::audio::recording_commands::RecordingArgs {
                save_path: save_path.to_string_lossy().to_string(),
            },
        )
        .await;

        // Handle result
        match stop_result {
            Ok(StopOutcome::Stopped) => {
                log::info!("Tray: Recording stopped successfully");

                // Trigger frontend post-processing via event (works from any page)
                // (SQLite save, navigation, analytics)
                if let Err(e) = app_clone.emit("recording-stop-complete", true) {
                    log::error!("Tray: Failed to emit recording-stop-complete event: {}", e);
                }
            }
            Ok(StopOutcome::AlreadyStopping) => {},
            Ok(StopOutcome::NotActive) => update_tray_menu_async(&app_clone).await,
            Err(e) => {
                log::error!("Tray: Failed to stop recording: {}", e);
                // Revert tray state on error
                update_tray_menu_async(&app_clone).await;
            }
        }
    });
}

fn check_updates_handler<R: Runtime>(app: &AppHandle<R>) {
    focus_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(
            "window.dispatchEvent(new CustomEvent('check-updates-from-tray'))"
        );
    }
}

pub fn update_tray_menu<R: Runtime>(app: &AppHandle<R>) {
    // For sync update, spawn async task to get current state
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // Small delay to ensure recording state has been updated
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        update_tray_menu_async(&app_clone).await;
    });
}

pub fn set_tray_state<R: Runtime>(app: &AppHandle<R>, state: RecordingState) {
    log::info!("Tray: Setting intermediate state: {:?}", state);
    // During recording state transitions, we assume recording is allowed (we're already recording)
    if let Ok(menu) = build_menu(app, state, true) {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let result = tray.set_menu(Some(menu));
            log::info!("Tray: Intermediate state menu update result: {:?}", result);
        } else {
            log::warn!("Tray: Could not find tray with id 'main-tray'");
        }
    } else {
        log::error!("Tray: Failed to build menu for intermediate state");
    }
}

async fn get_current_recording_state() -> RecordingState {
    // Check if currently recording
    let is_recording = crate::audio::recording_commands::is_recording().await;
    log::info!(
        "Tray: get_current_recording_state - is_recording: {}",
        is_recording
    );

    if !is_recording {
        log::info!("Tray: Recording state is Stopped");
        return RecordingState::Stopped;
    }

    // Check if paused
    let is_paused = crate::audio::recording_commands::is_recording_paused().await;
    log::info!("Tray: is_paused: {}", is_paused);

    if is_paused {
        log::info!("Tray: Recording state is Paused");
        RecordingState::Paused
    } else {
        log::info!("Tray: Recording state is Recording");
        RecordingState::Recording
    }
}

/// Check if recording is allowed based on onboarding status and transcription model availability
/// Returns true if:
/// - Onboarding is complete (user may prefer Whisper later), OR
/// - Parakeet transcription model is ready (downloaded)
async fn check_can_record<R: Runtime>(app: &AppHandle<R>) -> bool {
    // First check if onboarding is complete
    let onboarding_complete = match crate::onboarding::load_onboarding_status(app).await {
        Ok(status) => status.completed,
        Err(e) => {
            log::warn!("Tray: Failed to load onboarding status: {}, assuming complete", e);
            true // Assume complete if we can't check (safe default)
        }
    };

    // If onboarding is complete, always allow recording
    // (user may prefer Whisper or have their own transcription setup)
    if onboarding_complete {
        return true;
    }

    // During onboarding, check if Parakeet transcription model is ready
    match crate::parakeet_engine::commands::parakeet_has_available_models().await {
        Ok(has_models) => has_models,
        Err(e) => {
            log::warn!("Tray: Failed to check Parakeet models: {}, assuming not ready", e);
            false
        }
    }
}

pub async fn update_tray_menu_async<R: Runtime>(app: &AppHandle<R>) {
    log::info!("Tray: update_tray_menu_async called");
    // Get the current recording state
    let recording_state = get_current_recording_state().await;
    log::info!("Tray: Current recording state: {:?}", recording_state);

    // Determine if recording should be allowed
    // Only block recording during incomplete onboarding when no transcription model is ready
    let can_record = check_can_record(app).await;
    log::info!("Tray: can_record: {}", can_record);

    if let Ok(menu) = build_menu(app, recording_state, can_record) {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let result = tray.set_menu(Some(menu));
            log::info!("Tray: Menu update result: {:?}", result);
        } else {
            log::warn!("Tray: Could not find tray with id 'main-tray'");
        }
    } else {
        log::error!("Tray: Failed to build menu");
    }
}

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: RecordingState,
    can_record: bool, // True if recording is allowed (onboarding complete OR transcription model ready)
) -> tauri::Result<tauri::menu::Menu<R>> {
    let mut builder = MenuBuilder::new(app);

    // If recording is not allowed (during onboarding, no transcription model), show disabled message
    if !can_record {
        builder = builder.item(
            &MenuItemBuilder::new("⏳ Downloading transcription model...")
                .enabled(false)
                .build(app)?,
        );
    } else {
        match state {
            RecordingState::Stopped => {
                builder = builder
                    .item(&MenuItemBuilder::with_id("toggle_recording", "Start Recording").build(app)?);
            }
            RecordingState::Starting => {
                builder = builder.item(
                    &MenuItemBuilder::new("🔄 Starting Recording...")
                        .enabled(false)
                        .build(app)?,
                );
            }
            RecordingState::Recording => {
                builder = builder
                    .item(&MenuItemBuilder::with_id("pause_recording", "⏸ Pause Recording").build(app)?)
                    .item(&MenuItemBuilder::with_id("stop_recording", "⏹ Stop Recording").build(app)?);
            }
            RecordingState::Pausing => {
                builder = builder
                    .item(
                        &MenuItemBuilder::new("⏸ Pausing...")
                            .enabled(false)
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "⏹ Stop Recording").build(app)?);
            }
            RecordingState::Paused => {
                builder = builder
                    .item(
                        &MenuItemBuilder::with_id("resume_recording", "▶ Resume Recording")
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "⏹ Stop Recording").build(app)?);
            }
            RecordingState::Resuming => {
                builder = builder
                    .item(
                        &MenuItemBuilder::new("▶ Resuming...")
                            .enabled(false)
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "⏹ Stop Recording").build(app)?);
            }
            RecordingState::Stopping => {
                builder = builder.item(
                    &MenuItemBuilder::new("⏹ Stopping...")
                        .enabled(false)
                        .build(app)?,
                );
            }
        }
    }

    builder
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("open_window", "Open Main Window").build(app)?)
        .item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?)
        .item(&MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()
}

pub(crate) fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.unminimize() {
            log::error!("Failed to unminimize main window: {}", e);
        }

        if let Err(e) = window.show() {
            log::error!("Failed to show main window: {}", e);
        }

        if let Err(e) = window.set_focus() {
            log::error!("Failed to focus main window: {}", e);
        }

        if let Err(e) = window.eval("window.focus()") {
            log::error!("Failed to focus main webview: {}", e);
        }
    } else {
        log::warn!("Could not find main window");
    }
}
