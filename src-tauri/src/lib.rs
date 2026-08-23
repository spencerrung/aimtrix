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
const WAYLAND_ABI_REEXEC: &str = "AIMTRIX_WAYLAND_ABI_REEXEC";

#[cfg(target_os = "linux")]
const WAYLAND_LIBRARIES: [&str; 4] = [
    "libwayland-client.so.0",
    "libwayland-egl.so.1",
    "libwayland-cursor.so.0",
    "libwayland-server.so.0",
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
fn should_preload_host_wayland(
    use_native_wayland: bool,
    appimage: Option<&std::ffi::OsStr>,
    appdir: Option<&std::ffi::OsStr>,
    reexec_marker: Option<&std::ffi::OsStr>,
) -> bool {
    use_native_wayland
        && !reexec_marker.is_some_and(|value| value == "1")
        && appimage.is_some_and(|value| !value.is_empty())
        && appdir.is_some_and(|value| !value.is_empty())
}

#[cfg(target_os = "linux")]
fn find_host_wayland_libraries(
    directories: &[std::path::PathBuf],
) -> Option<Vec<std::path::PathBuf>> {
    directories.iter().find_map(|directory| {
        let libraries = WAYLAND_LIBRARIES
            .iter()
            .map(|library| directory.join(library))
            .collect::<Vec<_>>();
        libraries
            .iter()
            .all(|path| path.is_file())
            .then_some(libraries)
    })
}

#[cfg(target_os = "linux")]
fn build_wayland_preload(
    existing: Option<&std::ffi::OsStr>,
    libraries: &[std::path::PathBuf],
) -> std::ffi::OsString {
    let mut preload = existing
        .filter(|value| !value.is_empty())
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_default();
    for library in libraries {
        if !preload.is_empty() {
            preload.push(":");
        }
        preload.push(library.as_os_str());
    }
    preload
}

#[cfg(target_os = "linux")]
pub fn prepare_appimage_runtime() {
    let force_x11 = std::env::var_os("AIMTRIX_FORCE_X11").is_some_and(|value| value == "1");
    let use_native_wayland = should_use_native_wayland(
        std::env::var_os("XDG_SESSION_TYPE").as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").as_deref(),
        force_x11,
    );
    let should_preload = should_preload_host_wayland(
        use_native_wayland,
        std::env::var_os("APPIMAGE").as_deref(),
        std::env::var_os("APPDIR").as_deref(),
        std::env::var_os(WAYLAND_ABI_REEXEC).as_deref(),
    );
    if !should_preload {
        return;
    }

    let directories = [
        "/usr/lib",
        "/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/lib/x86_64-linux-gnu",
    ]
    .map(std::path::PathBuf::from);
    let Some(libraries) = find_host_wayland_libraries(&directories) else {
        eprintln!("Aimtrix could not find a complete host Wayland ABI; continuing without preload");
        return;
    };
    let preload = build_wayland_preload(std::env::var_os("LD_PRELOAD").as_deref(), &libraries);
    let Ok(executable) = std::env::current_exe() else {
        eprintln!(
            "Aimtrix could not resolve its executable; continuing without Wayland ABI preload"
        );
        return;
    };

    use std::os::unix::process::CommandExt;
    let error = std::process::Command::new(executable)
        .args(std::env::args_os().skip(1))
        .env("LD_PRELOAD", preload)
        .env(WAYLAND_ABI_REEXEC, "1")
        .exec();
    eprintln!("Aimtrix could not restart with the host Wayland ABI: {error}");
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
    if std::env::var_os(WAYLAND_ABI_REEXEC).is_some_and(|value| value == "1") {
        std::env::remove_var(WAYLAND_ABI_REEXEC);
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
    use super::{
        build_wayland_preload, find_host_wayland_libraries, should_preload_host_wayland,
        should_use_native_wayland, WAYLAND_LIBRARIES,
    };
    use std::{ffi::OsStr, path::PathBuf};

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

    #[test]
    fn preload_is_scoped_to_native_wayland_appimages_before_reexec() {
        let appimage = Some(OsStr::new("/tmp/Aimtrix.AppImage"));
        let appdir = Some(OsStr::new("/tmp/.mount_Aimtrix"));
        assert!(should_preload_host_wayland(true, appimage, appdir, None));
        assert!(!should_preload_host_wayland(false, appimage, appdir, None));
        assert!(!should_preload_host_wayland(true, None, appdir, None));
        assert!(!should_preload_host_wayland(true, appimage, None, None));
        assert!(!should_preload_host_wayland(
            true,
            appimage,
            appdir,
            Some(OsStr::new("1"))
        ));
        assert!(should_preload_host_wayland(
            true,
            appimage,
            appdir,
            Some(OsStr::new(""))
        ));
        assert!(should_preload_host_wayland(
            true,
            appimage,
            appdir,
            Some(OsStr::new("unexpected"))
        ));
    }

    #[test]
    fn host_wayland_libraries_must_be_complete_in_one_directory() {
        let root = std::env::temp_dir().join(format!("aimtrix-wayland-{}", std::process::id()));
        let partial = root.join("partial");
        let complete = root.join("complete");
        std::fs::create_dir_all(&partial).unwrap();
        std::fs::create_dir_all(&complete).unwrap();
        std::fs::write(partial.join(WAYLAND_LIBRARIES[0]), []).unwrap();
        for library in WAYLAND_LIBRARIES {
            std::fs::write(complete.join(library), []).unwrap();
        }

        let result = find_host_wayland_libraries(&[partial, complete.clone()]).unwrap();
        assert_eq!(
            result,
            WAYLAND_LIBRARIES
                .iter()
                .map(|library| complete.join(library))
                .collect::<Vec<PathBuf>>()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preload_preserves_existing_entries_before_host_wayland_libraries() {
        let libraries = [
            PathBuf::from("/usr/lib/libwayland-client.so.0"),
            PathBuf::from("/usr/lib/libwayland-egl.so.1"),
        ];
        assert_eq!(
            build_wayland_preload(Some(OsStr::new("/opt/tracer.so")), &libraries),
            OsStr::new(
                "/opt/tracer.so:/usr/lib/libwayland-client.so.0:/usr/lib/libwayland-egl.so.1"
            )
        );
        assert_eq!(
            build_wayland_preload(None, &libraries),
            OsStr::new("/usr/lib/libwayland-client.so.0:/usr/lib/libwayland-egl.so.1")
        );
    }
}
