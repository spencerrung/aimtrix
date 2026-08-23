use keyring::Entry;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Runtime,
};

const KEYRING_SERVICE: &str = "dev.alucard.aimtrix";
const ALLOWED_KEYS: [&str; 3] = [
    "aimtrix.matrix-session.v1",
    "aimtrix.sso-pending.v1",
    "aimtrix.native-push-token.v1",
];

#[cfg(target_os = "linux")]
fn should_use_native_wayland(
    session_type: Option<&std::ffi::OsStr>,
    wayland_display: Option<&std::ffi::OsStr>,
    force_x11: bool,
) -> bool {
    !force_x11
        && session_type.is_some_and(|value| value == "wayland")
        && wayland_display.is_some_and(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
fn configure_webview_runtime() {
    let force_x11 = std::env::var_os("AIMTRIX_FORCE_X11").is_some_and(|value| value == "1");
    if should_use_native_wayland(
        std::env::var_os("XDG_SESSION_TYPE").as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        force_x11,
    ) {
        std::env::set_var("GDK_BACKEND", "wayland");
    } else if force_x11 {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    let nvidia_driver_loaded = std::path::Path::new("/proc/driver/nvidia/version").is_file()
        || std::path::Path::new("/sys/module/nvidia").exists();
    if nvidia_driver_loaded && std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
}

#[cfg(target_os = "linux")]
fn configure_gstreamer_runtime() {
    let resource_root = std::env::var_os("APPDIR")
        .map(std::path::PathBuf::from)
        .map(|app_dir| app_dir.join("usr/lib/Aimtrix/gstreamer"))
        .or_else(|| {
            std::env::current_exe()
                .ok()?
                .parent()?
                .join("../lib/Aimtrix/gstreamer")
                .canonicalize()
                .ok()
        });
    let Some(resource_root) = resource_root else {
        return;
    };
    let plugins = resource_root.join("plugins");
    let scanner = resource_root.join("gst-plugin-scanner");
    if !plugins.is_dir() || !scanner.is_file() {
        return;
    }

    std::env::set_var("GST_PLUGIN_PATH_1_0", &plugins);
    std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);
    std::env::set_var("GST_PLUGIN_SCANNER", scanner);

    let cache_root = std::env::var_os("XDG_CACHE_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".cache"))
        });
    if let Some(cache_root) = cache_root {
        let cache = cache_root.join("aimtrix");
        if std::fs::create_dir_all(&cache).is_ok() {
            std::env::set_var("GST_REGISTRY", cache.join("gstreamer-registry.bin"));
        }
    }
}

fn keyring_entry(key: &str) -> Result<Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err("unsupported secure storage key".to_string());
    }
    Entry::new(KEYRING_SERVICE, key)
        .map_err(|_| "secure credential storage is unavailable".to_string())
}

#[cfg(target_os = "linux")]
fn keyutils_entry(key: &str) -> Result<Entry, String> {
    let credential =
        keyring::keyutils::KeyutilsCredential::new_with_target(None, KEYRING_SERVICE, key)
            .map_err(|_| "secure credential storage is unavailable".to_string())?;
    Ok(Entry::new_with_credential(Box::new(credential)))
}

#[cfg(target_os = "linux")]
fn load_linux_fallback(key: &str) -> Result<Option<String>, String> {
    match keyutils_entry(key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("secure credential storage is unavailable".to_string()),
    }
}

#[tauri::command]
fn secure_credential_load(key: String) -> Result<Option<String>, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => {
            #[cfg(target_os = "linux")]
            return load_linux_fallback(&key);

            #[cfg(not(target_os = "linux"))]
            Err("secure credential storage is unavailable".to_string())
        }
    }
}

#[tauri::command]
fn secure_credential_save(key: String, value: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    if entry.set_password(&value).is_ok() {
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    return keyutils_entry(&key)?
        .set_password(&value)
        .map_err(|_| "secure credential storage is unavailable".to_string());

    #[cfg(not(target_os = "linux"))]
    Err("secure credential storage is unavailable".to_string())
}

#[tauri::command]
fn secure_credential_clear(key: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => {
            #[cfg(target_os = "linux")]
            return match keyutils_entry(&key)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("secure credential storage is unavailable".to_string()),
            };

            #[cfg(not(target_os = "linux"))]
            Err("secure credential storage is unavailable".to_string())
        }
    }
}

fn configure_tray<R: Runtime>(app: &mut tauri::App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Aimtrix", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Aimtrix", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Aimtrix")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        configure_webview_runtime();
        configure_gstreamer_runtime();
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            secure_credential_load,
            secure_credential_save,
            secure_credential_clear,
        ]);

    builder
        .setup(|app| {
            #[cfg(desktop)]
            configure_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::should_use_native_wayland;
    use std::ffi::OsStr;

    #[test]
    fn native_wayland_requires_a_wayland_session_and_display() {
        assert!(should_use_native_wayland(
            Some(OsStr::new("wayland")),
            Some(OsStr::new("wayland-1")),
            false,
        ));
        assert!(!should_use_native_wayland(
            Some(OsStr::new("x11")),
            Some(OsStr::new("wayland-1")),
            false,
        ));
        assert!(!should_use_native_wayland(
            Some(OsStr::new("wayland")),
            None,
            false,
        ));
    }

    #[test]
    fn x11_escape_hatch_overrides_wayland_detection() {
        assert!(!should_use_native_wayland(
            Some(OsStr::new("wayland")),
            Some(OsStr::new("wayland-1")),
            true,
        ));
    }
}
