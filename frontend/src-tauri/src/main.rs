#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    #[cfg(target_os = "macos")]
    if let Some(result) = app_lib::run_google_meet_chrome_host() {
        if let Err(error) = result {
            eprintln!("Meetily Chrome bridge: {error}");
            std::process::exit(1);
        }
        return;
    }
    app_lib::run();
}
