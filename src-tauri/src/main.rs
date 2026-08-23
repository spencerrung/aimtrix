// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    aimtrix_lib::prepare_appimage_runtime();

    aimtrix_lib::run();
}
