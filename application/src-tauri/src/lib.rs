use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn start_update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check_for_updates(app).await {
            eprintln!("Fast Drive updater error: {error}");
        }
    });
}

async fn check_for_updates(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(update) = app.updater()?.check().await? {
        let mut downloaded = 0usize;

        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    if let Some(content_length) = content_length {
                        println!(
                            "Fast Drive update: {downloaded} of {content_length} bytes downloaded"
                        );
                    }
                },
                || println!("Fast Drive update download finished"),
            )
            .await?;

        app.restart();
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_linux_graphics_backend() {
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_xwayland = std::env::var_os("DISPLAY").is_some();
   
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    if has_wayland && has_xwayland {
        std::env::set_var("GDK_BACKEND", "x11");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    configure_linux_graphics_backend();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Abrir Fast Drive", true, None::<&str>)?;
            let update_item = MenuItem::with_id(
                app,
                "check-for-updates",
                "Procurar atualizações",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &update_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Fast Drive")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "check-for-updates" => start_update_check(app.clone()),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray.app_handle());
                    }
                })
                .build(app)?;

            #[cfg(not(debug_assertions))]
            {
                let update_app = app.handle().clone();
                start_update_check(update_app);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Fast Drive");
}
