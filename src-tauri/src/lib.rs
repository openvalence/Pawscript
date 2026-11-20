//! The Rust side. This file: the app setup. The tracker sidecar is in
//! sidecar.rs (protocol and state live in JS); editor commands (safe file IO,
//! autosave, settings, media helpers, fingerprints) are in the modules below;
//! API in ../API.md.

mod app;
mod buttplug;
mod cache;
mod commands;
mod cow;
mod datasets;
mod error;
mod ffmpeg;
mod files;
mod gpu;
mod ident;
mod media;
#[cfg(test)]
mod media_it;
mod models;
mod pack;
mod portable;
mod repeats;
mod sidecar;
mod store;
mod transitions;
mod update;

/// Window size/position/maximised (tauri-plugin-window-state), in the app config dir.
pub const WINDOW_STATE_FILE: &str = "window-state.json";

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  use tauri_plugin_window_state::StateFlags;
  let app = tauri::Builder::default()
    // First: a second launch hands its arguments over and exits before anything else starts.
    .plugin(tauri_plugin_single_instance::init(app::second_instance))
    .plugin(
      tauri_plugin_window_state::Builder::new()
        .with_filename(WINDOW_STATE_FILE)
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    // paw-cdot: Help > Check for updates (update.rs); its Rust API only, no webview permission is granted
    .plugin(tauri_plugin_updater::Builder::new().build())
    .manage(update::Pending::default())
    .manage(buttplug::Buttplug::default())
    .manage(sidecar::Running::default())
    .manage(app::Launch(std::sync::Mutex::new(app::initial_paths())))
    .manage(app::CloseGuard::default())
    // paw-855t: the seeder's old flat label layout becomes dataset v1 once, and v2 is the new default (datasets.rs; nothing is deleted)
    .setup(|app| {
      portable::start(); // the shared build unpacks runtime.zip / code.zip beside the exe once (paw-i7s); a dev build has none
      update::clean_after_update();
      if let Ok(p) = commands::places(app.handle()) {
        models::remember_settings(p.settings.clone()); // the sidecar's models folder (setting models.dir, paw-cdot)
        datasets::run(&p.data_dir.join("seeder"));
      }
      Ok(())
    })
    .on_window_event(|w, e| match e {
      // closing the window must not leave a sidecar (and python) running
      tauri::WindowEvent::Destroyed => w.state::<sidecar::Running>().shutdown(),
      // a document is open: hold the close and let the front end write it (paw-up1r); held once, and for at most
      // app::CLOSE_WAIT, so a hung or dead renderer cannot keep the window open (paw-a82t)
      tauri::WindowEvent::CloseRequested { api, .. } if app::guard_armed(w.app_handle()) && app::hold_close(w) => {
        api.prevent_close();
        let _ = tauri::Emitter::emit(w, app::CLOSE_REQUESTED, ());
      }
      _ => {}
    })
    .invoke_handler(tauri::generate_handler![
      sidecar::sidecar_run,
      sidecar::sidecar_cancel,
      portable::portable_status,
      app::launch_paths,
      app::close_guard,
      app::window_close_now,
      app::close_heartbeat,
      app::close_cancel,
      app::system_info,
      commands::read_text,
      commands::write_text_atomic,
      commands::write_with_backup,
      commands::read_bytes,
      commands::write_bytes_atomic,
      commands::runs_append,
      commands::runs_stage_write,
      commands::runs_stage_copy,
      commands::runs_stage_commit,
      commands::runs_stage_drop,
      commands::list_backups,
      commands::file_stat,
      commands::list_dir,
      commands::list_dir_stream,
      commands::image_thumbnail,
      commands::make_dir,
      commands::remove_file,
      commands::reveal_path,
      commands::open_path,
      commands::app_paths,
      commands::settings_get,
      commands::settings_set,
      commands::recent_list,
      commands::recent_add,
      commands::recent_remove,
      commands::autosave_write,
      commands::autosave_list,
      commands::autosave_clear,
      commands::media_tools,
      commands::media_probe,
      commands::media_frame_times,
      commands::waveform_peaks,
      commands::media_repeats,
      commands::thumbnail_strip,
      commands::extract_frame,
      commands::save_frame,
      commands::transcode_preview,
      commands::remux_mp4,
      commands::scrub_cache,
      commands::job_cancel,
      commands::media_cache_info,
      commands::media_cache_clear,
      commands::media_cache_limit,
      commands::media_cache_open,
      commands::media_cache_evicted,
      commands::media_cache_of,
      commands::media_cache_remove_of,
      commands::remove_recoverably,
      commands::pack_write,
      commands::pack_manifest,
      commands::pack_unpack,
      commands::file_fingerprint,
      commands::file_sha256,
      commands::relink_search,
      buttplug::bp_start,
      buttplug::bp_shutdown,
      buttplug::bp_scan,
      buttplug::bp_devices,
      buttplug::bp_linear,
      buttplug::bp_stop_all,
      models::models_info,
      models::models_scan,
      models::models_manifest,
      models::models_download,
      models::models_import,
      models::models_verify,
      models::models_cancel,
      models::models_remove,
      models::models_changed,
      portable::runtime_status,
      portable::runtime_unpack,
      portable::runtime_remove,
      gpu::gpu_probe,
      models::open_url,
      update::update_check,
      update::update_download,
      update::update_restart,
    ])
    .build(tauri::generate_context!())
    .expect("error while running Pawscript");
  app.run(|_app, _event| {
    // the graceful path (the job objects cover crashes and kills)
    if let tauri::RunEvent::Exit = _event {
      _app.state::<sidecar::Running>().shutdown();
    }
    // macOS delivers "Open With" / file-association opens as an event, not argv.
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = &_event {
      let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| files::path_str(&p)).collect();
      app::deliver(_app, paths);
    }
  });
}
