#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;

#[cfg(not(debug_assertions))]
fn start_update_check(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check_for_updates(app).await {
            eprintln!("Fast Drive updater error: {error}");
        }
    });
}

#[cfg(not(debug_assertions))]
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
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            {
                let update_app = _app.handle().clone();
                start_update_check(update_app);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fast Drive");
}
