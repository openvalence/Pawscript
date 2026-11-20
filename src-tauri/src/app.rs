//! App plumbing: files given on the command line ("Open with", file association,
//! a second launch), and the close guard the front end arms while the document
//! is dirty.

use crate::files::path_str;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, Window};

pub const OPEN_PATHS: &str = "pawscript://open-paths";
pub const CLOSE_REQUESTED: &str = "pawscript://close-requested";

/// Paths waiting for the front end to ask (`launch_paths`).
#[derive(Default)]
pub struct Launch(pub Mutex<Vec<String>>);

/// Armed (the front end's say), a close already held back (paw-a82t), the last sign of life (ms: the front end's "still
/// writing" beat, or a shell write starting or ending), the held close's generation (a cancel or a close ends its watch)
/// and the shell writes in flight (paw-hzz3).
#[derive(Default)]
pub struct CloseGuard(pub AtomicBool, pub AtomicBool, pub AtomicI64, pub AtomicU64, pub AtomicU64);

/// How long a held-back close waits for a sign of life from the front end before the window closes anyway (paw-a82t: a
/// hung or dead renderer never answers; the files are written copy-on-write (paw-ee14), so a forced close keeps the last
/// complete version). A front end that is writing beats every second (`close_heartbeat`) and is waited for. paw-hzz3: the
/// beat is a webview timer, which WebView2 throttles to once a minute in a window minimised for minutes and a long task
/// on the page holds up, so the shell's own writes (`Writing`, in commands.rs) count as life too: a close is held while
/// one is in flight and for `CLOSE_WAIT` after each.
pub const CLOSE_WAIT: Duration = Duration::from_secs(3);

impl CloseGuard {
  /// A shell write begins: life, and the close waits until it ends.
  pub fn write_begins(&self) {
    self.4.fetch_add(1, Ordering::SeqCst);
    self.2.store(crate::files::now_ms(), Ordering::SeqCst);
  }
  /// It ended (written or not): life now; the time is set before the count drops, so the watcher never sees neither.
  pub fn write_ends(&self) {
    self.2.store(crate::files::now_ms(), Ordering::SeqCst);
    self.4.fetch_sub(1, Ordering::SeqCst);
  }
  /// The front end is gone or hung: no write in flight and no sign of life for `CLOSE_WAIT`.
  pub fn gone(&self, now_ms: i64) -> bool {
    self.4.load(Ordering::SeqCst) == 0 && silent(self.2.load(Ordering::SeqCst), now_ms)
  }
}

/// paw-hzz3: one shell write in flight, for the close guard (begun on creation, ended on drop: an error or a panic too).
pub struct Writing(AppHandle);
impl Writing {
  pub fn new(app: &AppHandle) -> Writing {
    app.state::<CloseGuard>().write_begins();
    Writing(app.clone())
  }
}
impl Drop for Writing {
  fn drop(&mut self) {
    self.0.state::<CloseGuard>().write_ends();
  }
}

/// Existing files/folders among `args` (flags skipped), made absolute against `cwd`.
pub fn args_to_paths<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
  args
    .into_iter()
    .filter(|a| !a.is_empty() && !a.starts_with('-'))
    .map(|a| {
      let p = PathBuf::from(&a);
      if p.is_absolute() {
        p
      } else {
        cwd.join(p)
      }
    })
    .filter(|p| p.exists())
    .map(|p| path_str(&std::path::absolute(&p).unwrap_or(p)))
    .collect()
}

pub fn initial_paths() -> Vec<String> {
  let cwd = std::env::current_dir().unwrap_or_default();
  args_to_paths(std::env::args().skip(1), &cwd)
}

fn focus(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// Paths arriving while the app runs: a second launch, or macOS "Open With".
pub fn deliver(app: &AppHandle, paths: Vec<String>) {
  if paths.is_empty() {
    focus(app);
    return;
  }
  let _ = app.emit(OPEN_PATHS, paths.clone());
  // Also queue them, in case the webview is still loading and misses the event.
  app.state::<Launch>().0.lock().unwrap_or_else(|e| e.into_inner()).extend(paths);
  focus(app);
}

pub fn second_instance(app: &AppHandle, argv: Vec<String>, cwd: String) {
  deliver(app, args_to_paths(argv.into_iter().skip(1), Path::new(&cwd)));
}

/// Returns and forgets the paths the app was launched with (and any that arrived
/// since). Call once at startup, then listen for `pawscript://open-paths`.
#[tauri::command]
pub fn launch_paths(launch: State<'_, Launch>) -> Vec<String> {
  std::mem::take(&mut *launch.0.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Armed: closing the window is held back and `pawscript://close-requested` is
/// emitted instead; the front end asks the user, then calls `window_close_now`.
#[tauri::command]
pub fn close_guard(armed: bool, guard: State<'_, CloseGuard>) {
  guard.0.store(armed, Ordering::SeqCst);
}

#[tauri::command]
pub fn window_close_now(window: WebviewWindow, guard: State<'_, CloseGuard>) -> Result<(), crate::error::Error> {
  guard.0.store(false, Ordering::SeqCst);
  guard.3.fetch_add(1, Ordering::SeqCst);
  window.destroy().map_err(|e| crate::error::Error::new("internal", e.to_string()))
}

/// paw-ee14: the front end is alive and still writing (every second while its "Writing your project" panel shows): a held
/// close waits on, until the write ends or the beats stop for `CLOSE_WAIT`.
#[tauri::command]
pub fn close_heartbeat(guard: State<'_, CloseGuard>) {
  guard.2.store(crate::files::now_ms(), Ordering::SeqCst);
}

/// paw-ee14: the user cancelled the close (the panel's Cancel): the app stays, the next close request is held again.
#[tauri::command]
pub fn close_cancel(guard: State<'_, CloseGuard>) {
  cancel(&guard);
}
pub fn cancel(g: &CloseGuard) {
  g.3.fetch_add(1, Ordering::SeqCst);
  g.1.store(false, Ordering::SeqCst);
}

/// No beat for `CLOSE_WAIT`: the front end is gone or hung.
pub fn silent(last_beat_ms: i64, now_ms: i64) -> bool {
  now_ms - last_beat_ms >= CLOSE_WAIT.as_millis() as i64
}

pub fn guard_armed(app: &AppHandle) -> bool {
  app.state::<CloseGuard>().0.load(Ordering::SeqCst)
}

/// The first close request while armed: true (hold it, ask the front end). A second one is not held (paw-a82t).
pub fn first_close(held: &AtomicBool) -> bool {
  !held.swap(true, Ordering::SeqCst)
}

/// A close request while armed: held back once, and the window is destroyed once the front end has given no sign of life
/// for `CLOSE_WAIT` (a front end that writes beats, `close_heartbeat`); a second request closes it at once; a cancel
/// (`close_cancel`) ends the watch. -> hold it (prevent_close).
pub fn hold_close(w: &Window) -> bool {
  let g = w.state::<CloseGuard>();
  if !first_close(&g.1) {
    return false;
  }
  g.2.store(crate::files::now_ms(), Ordering::SeqCst);
  let gen = g.3.fetch_add(1, Ordering::SeqCst) + 1;
  let w = w.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_millis(200));
    let g = w.state::<CloseGuard>();
    if g.3.load(Ordering::SeqCst) != gen {
      return; // cancelled, or the front end closed the window
    }
    if g.gone(crate::files::now_ms()) {
      let _ = w.destroy(); // already gone: an error, ignored
      return;
    }
  });
  true
}

/// paw-frhy: what "Copy bug report" says about this machine, nothing that names a person or a file: the Windows version,
/// the GPUs nvidia-smi lists (name, VRAM, driver) and the shared build's runtime / code stamps (empty in a dev build).
#[derive(Debug, Default, serde::Serialize)]
pub struct SystemInfo {
  pub windows: String,
  pub gpus: Vec<String>,
  pub runtime: Vec<String>,
}

fn quiet(exe: &str) -> std::process::Command {
  let mut c = std::process::Command::new(exe);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  c
}

/// nvidia-smi's `name, memory.total, driver_version` CSV lines -> "name, 12282 MiB VRAM, driver 581.57".
pub fn gpu_lines(csv: &str) -> Vec<String> {
  csv
    .lines()
    .filter_map(|l| {
      let f: Vec<&str> = l.split(',').map(str::trim).collect();
      (f.len() == 3 && !f[0].is_empty()).then(|| format!("{}, {} VRAM, driver {}", f[0], f[1], f[2]))
    })
    .collect()
}

#[tauri::command]
pub async fn system_info() -> SystemInfo {
  tauri::async_runtime::spawn_blocking(|| {
    let out = |c: &mut std::process::Command| c.output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let windows = out(quiet("cmd").args(["/C", "ver"])).unwrap_or_default();
    let gpus = out(quiet("nvidia-smi").args(["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"])).map_or_else(Vec::new, |s| gpu_lines(&s));
    let runtime = crate::portable::stamps();
    SystemInfo { windows, gpus, runtime }
  })
  .await
  .unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn args_become_existing_absolute_paths() {
    let t = tempfile::tempdir().unwrap();
    std::fs::write(t.path().join("clip 夏.mp4"), b"").unwrap();
    std::fs::write(t.path().join("p.pawproj"), b"").unwrap();
    let args = ["clip 夏.mp4", "--flag", "missing.mp4", "", &path_str(&t.path().join("p.pawproj"))].map(String::from);
    let got = args_to_paths(args, t.path());
    assert_eq!(got.len(), 2);
    assert!(got.iter().all(|p| Path::new(p).is_absolute()));
    assert!(got[0].ends_with("clip 夏.mp4") && got[1].ends_with("p.pawproj"));
  }

  /// paw-a82t: the first close request is held for the front end, a second one goes through.
  #[test]
  fn a_second_close_request_is_not_held() {
    let g = CloseGuard::default();
    assert!(first_close(&g.1));
    assert!(!first_close(&g.1));
    // paw-ee14: a cancelled close is held again the next time
    cancel(&g);
    assert!(first_close(&g.1));
  }

  /// paw-ee14: a writing front end beats and is waited for; silence for CLOSE_WAIT closes.
  #[test]
  fn a_silent_front_end_is_closed_a_beating_one_is_waited_for() {
    let w = CLOSE_WAIT.as_millis() as i64;
    assert!(!silent(1000, 1000 + w - 1));
    assert!(silent(1000, 1000 + w));
  }

  /// paw-hzz3: a shell write in flight holds the close however long it takes (the webview's beat may be throttled to once
  /// a minute); once it ends the front end has CLOSE_WAIT for the next write or beat; no write and no beat: closed.
  #[test]
  fn a_write_in_flight_holds_the_close_and_its_end_counts_as_life() {
    let g = CloseGuard::default();
    let w = CLOSE_WAIT.as_millis() as i64;
    let now = crate::files::now_ms();
    g.2.store(now - 10 * w, Ordering::SeqCst); // the last beat long ago (a minimised window)
    assert!(g.gone(now), "a silent front end with nothing in flight is closed");
    g.write_begins();
    assert!(!g.gone(now + 60 * w), "closed while a write was in flight");
    g.write_begins(); // a second, overlapping write
    g.write_ends();
    assert!(!g.gone(now + 60 * w));
    g.write_ends();
    let end = g.2.load(Ordering::SeqCst);
    assert!(!g.gone(end + w - 1) && g.gone(end + w), "the end of a write is life for CLOSE_WAIT, then a hung page closes");
  }

  /// paw-frhy: nvidia-smi's CSV as the bug report's GPU line; anything else is dropped.
  #[test]
  fn gpu_lines_from_nvidia_smi() {
    let csv = "NVIDIA GeForce RTX 4070, 12282 MiB, 581.57
No devices were found
";
    assert_eq!(gpu_lines(csv), ["NVIDIA GeForce RTX 4070, 12282 MiB VRAM, driver 581.57"]);
    assert!(gpu_lines("").is_empty());
  }
}
