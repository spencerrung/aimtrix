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

fn keyring_entry(key: &str) -> Result<Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err("unsupported secure storage key".to_string());
    }
    Entry::new(KEYRING_SERVICE, key)
        .map_err(|_| "secure credential storage is unavailable".to_string())
}

#[tauri::command]
fn secure_credential_load(key: String) -> Result<Option<String>, String> {
    let entry = keyring_entry(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("secure credential storage is unavailable".to_string()),
    }
}

#[tauri::command]
fn secure_credential_save(key: String, value: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    entry
        .set_password(&value)
        .map_err(|_| "secure credential storage is unavailable".to_string())
}

#[tauri::command]
fn secure_credential_clear(key: String) -> Result<(), String> {
    let entry = keyring_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("secure credential storage is unavailable".to_string()),
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
