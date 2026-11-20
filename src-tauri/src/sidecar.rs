//! The tracker sidecar: one run at a time. Each run goes to the resident
//! `pawtrack serve` (started on the first run, models stay loaded between runs,
//! killed after PAWTRACK_SERVE_IDLE_S without a run); when it cannot start, the
//! run is a one-shot process as before (request on stdin). Either way each
//! stdout line of the run goes to the frontend, and each stderr line as a
//! synthetic `{"type":"log","line":...}` line (uv installs, model loads and GPU
//! waits are visible, and any line is a heartbeat). Every child runs in a
//! kill-on-close process tree (a Windows Job Object), so cancel, app exit, a
//! crash, a `tauri dev` rebuild or Task Manager never leave uv / python holding the GPU.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------- process trees

/// A process and everything it starts. Windows: a Job Object with
/// KILL_ON_JOB_CLOSE (the kernel kills the tree when the last handle closes,
/// i.e. when this is dropped or the app dies). Elsewhere: the pid.
pub struct Tree {
  #[cfg(windows)]
  job: usize, // HANDLE; 0 = no job (creation or assignment failed): taskkill /T fallback
  pid: u32,
}

impl Tree {
  #[cfg(windows)]
  fn job() -> usize {
    use windows_sys::Win32::System::JobObjects::*;
    // SAFETY: plain Win32 calls on a handle we own; the struct is plain data.
    unsafe {
      let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if h.is_null() {
        return 0;
      }
      let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let ok = SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32);
      if ok == 0 {
        windows_sys::Win32::Foundation::CloseHandle(h);
        return 0;
      }
      h as usize
    }
  }

  /// Puts `child` in a new tree. ponytail: assigned right after spawn, so a
  /// grandchild started in that first instant would escape; CREATE_SUSPENDED +
  /// resume closes the gap if it ever matters (uv takes far longer to start python).
  pub fn new(child: &Child) -> Tree {
    #[cfg(windows)]
    {
      let job = Self::job();
      Tree { job: if job != 0 && Self::adopt(job, child) { job } else { 0 }, pid: child.id() }
    }
    #[cfg(not(windows))]
    Tree { pid: child.id() }
  }

  #[cfg(windows)]
  fn adopt(job: usize, child: &Child) -> bool {
    use std::os::windows::io::AsRawHandle;
    // SAFETY: both handles are valid for the duration of the call.
    unsafe { windows_sys::Win32::System::JobObjects::AssignProcessToJobObject(job as _, child.as_raw_handle() as _) != 0 }
  }

  /// Kills every process in the tree (idempotent).
  pub fn kill(&self) {
    #[cfg(windows)]
    {
      if self.job != 0 {
        // SAFETY: our own job handle, open until drop.
        unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job as _, 1) };
        return;
      }
      use std::os::windows::process::CommandExt;
      let _ = Command::new("taskkill").args(["/PID", &self.pid.to_string(), "/T", "/F"]).creation_flags(0x0800_0000).status();
    }
    #[cfg(not(windows))]
    let _ = Command::new("kill").args(["-9", &self.pid.to_string()]).status();
  }
}

#[cfg(windows)]
impl Drop for Tree {
  fn drop(&mut self) {
    if self.job != 0 {
      // SAFETY: closing our own handle once; KILL_ON_JOB_CLOSE reaps leftovers.
      unsafe { windows_sys::Win32::Foundation::CloseHandle(self.job as _) };
    }
  }
}

/// One tree the app never closes: the kernel kills its members when the app
/// exits for any reason (ffmpeg children: a proxy transcode must not outlive us).
pub fn reap_on_exit(child: &Child) {
  #[cfg(windows)]
  {
    static JOB: LazyLock<usize> = LazyLock::new(Tree::job);
    if *JOB != 0 {
      Tree::adopt(*JOB, child);
    }
  }
  #[cfg(not(windows))]
  let _ = child;
}

// ---------------------------------------------------------------- the run slot

type Stop = Arc<dyn Fn() + Send + Sync>;
type Sink = Arc<dyn Fn(String) -> bool + Send + Sync>;

struct Run {
  gen: u64,
  token: Option<String>, // the front end's id for this run (paw-1sa9): a cancel naming another id leaves it alone
  cancelled: Arc<AtomicBool>,
  stop: Option<Stop>, // one-shot: kill its tree; resident: cooperative cancel, kill after GRACE
}

/// The current run. Each run has its own generation and cancelled flag, so a
/// cancelled run that is still dying can never clear or mislabel the next one.
#[derive(Default)]
pub struct Running {
  slot: Mutex<Option<Run>>,
  next: AtomicU64,
  serve: Arc<Mutex<Option<Serve>>>, // held for the whole of a resident run
  serve_tree: Mutex<Option<Arc<Tree>>>, // the same tree, for a kill that must not wait for the run
  serve_off: AtomicBool,            // it failed to start once: one-shot runs for the rest of the session
}

impl Running {
  fn lock(&self) -> std::sync::MutexGuard<'_, Option<Run>> {
    self.slot.lock().unwrap_or_else(|e| e.into_inner())
  }
  /// Claims the slot before anything is spawned.
  fn reserve(&self, token: Option<String>) -> Result<(u64, Arc<AtomicBool>), String> {
    let mut slot = self.lock();
    if slot.is_some() {
      return Err("a tracker run is already active".into());
    }
    let gen = self.next.fetch_add(1, Ordering::SeqCst) + 1;
    let cancelled = Arc::new(AtomicBool::new(false));
    *slot = Some(Run { gen, token, cancelled: cancelled.clone(), stop: None });
    Ok((gen, cancelled))
  }
  /// False when the run was cancelled while it was starting (the caller stops it).
  fn attach(&self, gen: u64, stop: Stop) -> bool {
    match self.lock().as_mut() {
      Some(r) if r.gen == gen => {
        r.stop = Some(stop);
        true
      }
      _ => false,
    }
  }
  fn release(&self, gen: u64) {
    let mut slot = self.lock();
    if slot.as_ref().is_some_and(|r| r.gen == gen) {
      *slot = None;
    }
  }
  /// Cancels the current run: marks it, frees the slot, stops it (one-shot: kills its whole tree). `token`: only when
  /// the current run is that one (a cancel aimed at a run that has ended never reaches the next); None: whatever runs.
  pub fn kill(&self, token: Option<&str>) {
    let run = {
      let mut slot = self.lock();
      if token.is_some() && slot.as_ref().is_some_and(|r| r.token.as_deref() != token) {
        return;
      }
      slot.take()
    };
    if let Some(r) = run {
      r.cancelled.store(true, Ordering::SeqCst);
      if let Some(stop) = r.stop {
        stop();
      }
    }
  }
  /// App exit / window closed: cancel the run and kill the resident serve (its VRAM goes now).
  pub fn shutdown(&self) {
    self.kill(None);
    if let Some(t) = self.serve_tree.lock().unwrap_or_else(|e| e.into_inner()).take() {
      t.kill();
    }
  }
  /// paw-cdot: the models folder or its files changed: an idle serve goes (Drop kills its tree, as watch_idle does), so
  /// the next run starts one that sees them; a resident run holds the lock, and keeps its serve.
  pub fn drop_idle_serve(&self) {
    if let Ok(mut g) = self.serve.try_lock() {
      *g = None;
    }
  }
}

#[derive(Debug, serde::Serialize)]
pub struct Exit {
  pub code: Option<i32>,
  pub stderr_tail: String,
  pub cancelled: bool,
}

// ---------------------------------------------------------------- running

/// Project root: the exe's folder when it holds `trackers/` (portable build), else in a debug build the checkout
/// (compile-time path), else the exe's folder. A release exe carries no build-machine path (paw-59g1).
pub fn root() -> PathBuf {
  let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));
  if let Some(d) = exe_dir.as_ref().filter(|d| d.join("trackers").is_dir()) {
    return d.clone();
  }
  dev_root().or(exe_dir).unwrap_or_default()
}

#[cfg(debug_assertions)]
fn dev_root() -> Option<PathBuf> {
  Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

#[cfg(not(debug_assertions))]
fn dev_root() -> Option<PathBuf> {
  None
}

/// PAWTRACK_CMD (whitespace-split) when set: PAWTRACK_CMD="node test/fake-pawtrack.mjs" points the app at the fake
/// sidecar. Else a bundled `python/python.exe -m pawtrack.cli` (portable build, deps installed into it), else
/// `uv run --project trackers --extra sam2 --extra describe pawtrack` (explicit extras: they are never dropped).
fn command() -> Command {
  let root = root();
  let py = crate::gpu::python_exe(&root);
  let words: Vec<String> = match std::env::var("PAWTRACK_CMD") {
    Ok(s) if !s.trim().is_empty() => s.split_whitespace().map(String::from).collect(),
    _ if py.is_file() => vec![py.to_string_lossy().into_owned(), "-m".into(), "pawtrack.cli".into()],
    _ => ["uv", "run", "--project", "trackers", "--extra", "sam2", "--extra", "describe", "pawtrack"].map(String::from).to_vec(),
  };
  let mut c = Command::new(&words[0]);
  // paw-cdot: where .cache\ and .models\ are (Settings > Models; default <root>\trackers, as before)
  c.args(&words[1..]).current_dir(&root).env("PAWTRACK_MODELS", crate::models::folder());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  c
}

/// Calls `f` with each non-blank line (lossy UTF-8, so one bad byte cannot end
/// the stream) until it returns false. True when the stream ended (EOF).
fn lines(r: impl Read, mut f: impl FnMut(String) -> bool) -> bool {
  let mut r = BufReader::new(r);
  let mut buf = Vec::new();
  loop {
    buf.clear();
    match r.read_until(b'\n', &mut buf) {
      Ok(0) => return true,
      Ok(_) => {}
      Err(_) => return false,
    }
    let s = String::from_utf8_lossy(&buf);
    let s = s.trim_end_matches(['\r', '\n']);
    if !s.trim().is_empty() && !f(s.to_string()) {
      return false;
    }
  }
}

/// One run of `cmd` (blocking): `send` gets every stdout line and every stderr
/// line wrapped as a log event; false from it (the webview is gone) kills the
/// tree, so a full pipe can never hang the run.
pub fn run(running: &Running, token: Option<String>, mut cmd: Command, body: &str, send: &(dyn Fn(String) -> bool + Sync)) -> Result<Exit, String> {
  let (gen, cancelled) = running.reserve(token)?;
  let out = (|| {
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("cannot start the tracker: {e}"))?;
    let tree = Arc::new(Tree::new(&child));
    let t = tree.clone();
    if !running.attach(gen, Arc::new(move || t.kill())) {
      tree.kill();
    }
    let mut stdin = child.stdin.take().expect("piped");
    let stdout = child.stdout.take().expect("piped");
    let stderr = child.stderr.take().expect("piped");
    let (code, stderr_tail) = std::thread::scope(|s| {
      // stderr: drained on its own thread (a full pipe would stall the child), forwarded, tail kept
      let err = s.spawn(|| {
        let mut tail = String::new();
        lines(stderr, |l| {
          let _ = send(serde_json::json!({ "type": "log", "line": l }).to_string());
          tail.push_str(&l);
          tail.push('\n');
          if tail.len() > 8000 {
            tail = tail[tail.ceil_char_boundary(tail.len() - 4000)..].to_string();
          }
          true
        });
        tail
      });
      let _ = stdin.write_all(body.as_bytes());
      drop(stdin);
      if !lines(stdout, send) {
        tree.kill();
      }
      let code = child.wait().ok().and_then(|s| s.code());
      tree.kill(); // strays left after the sidecar exited (and their hold on the stderr pipe)
      (code, err.join().unwrap_or_default())
    });
    Ok(Exit { code, stderr_tail, cancelled: cancelled.load(Ordering::SeqCst) })
  })();
  running.release(gen);
  out
}

// ---------------------------------------------------------------- the resident serve

/// The resident `pawtrack serve` (trackers/pawtrack/serve.py, PROTOCOL "pawtrack serve"): JSON Lines both ways, one
/// request per line with an `id`, its events echo the id, a result / error line closes it. Models stay loaded
/// between runs; serve itself unloads them after its own idle time, and this side kills the process after
/// PAWTRACK_SERVE_IDLE_S (default 600) without a run, so an idle app holds no VRAM and no python.
struct Serve {
  tree: Arc<Tree>,
  child: Child,
  stdin: Arc<Mutex<ChildStdin>>,
  lines: mpsc::Receiver<String>, // stdout; disconnected = the process is gone
  log: Arc<Mutex<Log>>,
  last: Instant,
}

/// Where serve's stderr goes: the running job's channel (as log lines), and a tail for its error message.
#[derive(Default)]
struct Log {
  send: Option<Sink>,
  tail: String,
}

impl Drop for Serve {
  fn drop(&mut self) {
    self.tree.kill();
    let _ = self.child.wait();
  }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  m.lock().unwrap_or_else(|e| e.into_inner())
}

/// PAWTRACK_SERVE=0 turns the resident off (one process per run, as before); =1 forces it. Default: on, except with
/// PAWTRACK_CMD (the fake sidecar answers one request per process).
fn serve_wanted() -> bool {
  match std::env::var("PAWTRACK_SERVE").as_deref() {
    Ok("0") => false,
    Ok("1") => true,
    _ => std::env::var("PAWTRACK_CMD").map_or(true, |s| s.trim().is_empty()),
  }
}

fn env_secs(name: &str, default: u64) -> Duration {
  Duration::from_secs(std::env::var(name).ok().and_then(|s| s.parse().ok()).unwrap_or(default))
}

/// How long a cancelled resident run may take to stop at its next event before the process is killed.
const GRACE: Duration = Duration::from_secs(5);
/// How long a serve that said `restart` may take to exit by itself before it is killed.
const RESTART_WAIT: Duration = Duration::from_secs(10);

/// Spawns serve and waits for its hello (stderr goes to `send` meanwhile: uv installs show). Err = it did not come up.
fn start(mut cmd: Command, send: &Sink, running: &Running, gen: u64) -> Result<Serve, String> {
  let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("cannot start serve: {e}"))?;
  let tree = Arc::new(Tree::new(&child));
  let t = tree.clone();
  running.attach(gen, Arc::new(move || t.kill())); // a cancel while it starts kills it
  let (stdout, stderr) = (child.stdout.take().expect("piped"), child.stderr.take().expect("piped"));
  let (tx, lines_rx) = mpsc::channel();
  std::thread::spawn(move || lines(stdout, |l| tx.send(l).is_ok()));
  let log = Arc::new(Mutex::new(Log { send: Some(send.clone()), tail: String::new() }));
  let lg = log.clone();
  std::thread::spawn(move || {
    lines(stderr, |l| {
      let mut g = lock(&lg);
      if let Some(s) = &g.send {
        let _ = s(serde_json::json!({ "type": "log", "line": l }).to_string());
      }
      g.tail.push_str(&l);
      g.tail.push('\n');
      if g.tail.len() > 8000 {
        g.tail = g.tail[g.tail.ceil_char_boundary(g.tail.len() - 4000)..].to_string();
      }
      true
    })
  });
  let stdin = Arc::new(Mutex::new(child.stdin.take().expect("piped")));
  let s = Serve { tree, child, stdin, lines: lines_rx, log, last: Instant::now() };
  // ponytail: no hello timeout of its own; the front end's start timeout (no line for 180 s) cancels a stuck start
  let hello = s.lines.recv().map_err(|_| format!("serve exited at start\n{}", lock(&s.log).tail))?;
  let v: serde_json::Value = serde_json::from_str(&hello).unwrap_or_default();
  if !v["protocol"].as_str().is_some_and(|p| p.starts_with("pawtrack-serve/")) {
    return Err(format!("serve said {hello:?} instead of hello"));
  }
  Ok(s)
}

/// Kills the serve after `idle` without a run (checks every 15 s; a running job holds the lock, so it is never idle).
fn watch_idle(slot: Arc<Mutex<Option<Serve>>>, pid: u32, idle: Duration) {
  std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(15).min(idle));
    let Ok(mut g) = slot.try_lock() else { continue };
    match g.as_ref() {
      Some(s) if s.child.id() == pid => {
        if s.last.elapsed() >= idle {
          *g = None; // Drop kills the tree
          return;
        }
      }
      _ => return, // replaced or gone
    }
  });
}

/// A line of run `id` told from serve's own prefix (`{"id":"<id>","type":"<type>"`: pawtrack/serve.py writes the id
/// first) without parsing it -> (type, the rest after the id member). A TAPNext scene's frames are ~75 KB lines,
/// thousands of them, and a full parse of each only to read the id took longer than sending it (debug build:
/// 231 MB of frames 13.5 s -> 4.6 s, paw-iyl3). None: another id or another layout, which the parse handles as before.
fn own<'a>(line: &'a str, id: &str) -> Option<(&'a str, &'a str)> {
  let body = line.strip_prefix("{\"id\":\"")?.strip_prefix(id)?.strip_prefix("\",")?;
  let ty = body.strip_prefix("\"type\":\"")?.split('"').next()?;
  Some((ty, body))
}

fn close_of(ty: &str) -> Option<i32> {
  match ty {
    "result" => Some(0),
    "error" => Some(1),
    _ => None,
  }
}

fn cancelled_exit() -> Option<Result<Exit, String>> {
  Some(Ok(Exit { code: None, stderr_tail: String::new(), cancelled: true }))
}

/// One run on the resident serve (started first if needed). None = serve could not start and nothing was sent: the
/// caller runs it as a one-shot process (and so does every later run this session).
fn run_resident(running: &Running, token: Option<String>, cmd: impl FnOnce() -> Command, request: &serde_json::Value, send: Sink, grace: Duration) -> Option<Result<Exit, String>> {
  if running.serve_off.load(Ordering::SeqCst) || !request.is_object() {
    return None;
  }
  let (gen, cancelled) = match running.reserve(token) {
    Ok(x) => x,
    Err(e) => return Some(Err(e)),
  };
  let out = (|| {
    let slot = running.serve.clone();
    let mut g = lock(&slot);
    if g.as_mut().is_some_and(|s| s.child.try_wait().ok().flatten().is_some()) {
      *g = None; // died since the last run
    }
    if g.is_none() {
      match start(cmd(), &send, running, gen) {
        Ok(s) => {
          *lock(&running.serve_tree) = Some(s.tree.clone());
          watch_idle(slot.clone(), s.child.id(), env_secs("PAWTRACK_SERVE_IDLE_S", 600));
          *g = Some(s);
        }
        Err(_) if cancelled.load(Ordering::SeqCst) => return cancelled_exit(),
        Err(e) => {
          running.serve_off.store(true, Ordering::SeqCst);
          let _ = send(serde_json::json!({ "type": "log", "line": format!("pawtrack serve unavailable, one process per run: {e}") }).to_string());
          return None;
        }
      }
    }
    let s = g.as_mut().expect("started");
    let id = format!("app{gen}");
    let mut req = request.clone();
    req["id"] = id.clone().into();
    {
      let mut l = lock(&s.log);
      l.send = Some(send.clone());
      l.tail.clear();
    }
    let closed = Arc::new(AtomicBool::new(false));
    let stop: Stop = {
      let (stdin, tree, closed, id) = (s.stdin.clone(), s.tree.clone(), closed.clone(), id.clone());
      Arc::new(move || {
        let _ = lock(&stdin).write_all(format!("{}\n", serde_json::json!({ "id": format!("{id}-x"), "cmd": "cancel", "target": id })).as_bytes());
        let (tree, closed) = (tree.clone(), closed.clone());
        std::thread::spawn(move || {
          std::thread::sleep(grace);
          if !closed.load(Ordering::SeqCst) {
            tree.kill(); // it did not stop at its next event (a long model load, a hang): the process goes
          }
        });
      })
    };
    if !running.attach(gen, stop.clone()) {
      return cancelled_exit();
    }
    let (mut code, mut restart) = (None, false);
    if lock(&s.stdin).write_all(format!("{req}\n").as_bytes()).is_ok() {
      let mut forward = true;
      while let Ok(mut line) = s.lines.recv() {
        // results get stored (scene describe): the closing line goes out without the id, as a one-shot run's
        let close = if let Some((ty, body)) = own(&line, &id) {
          let c = close_of(ty);
          if c.is_some() {
            line = format!("{{{body}");
          }
          c
        } else {
          let mut v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
          if v["id"].as_str() != Some(id.as_str()) {
            continue;
          }
          let c = close_of(v["type"].as_str().unwrap_or(""));
          if c.is_some() {
            v.as_object_mut().map(|o| o.remove("id"));
            line = v.to_string();
          }
          c
        };
        if close.is_some() {
          // paw-ldfs: serve exits itself after this error (a broken CUDA context)
          restart = serde_json::from_str::<serde_json::Value>(&line).is_ok_and(|v| v["restart"] == true);
        }
        if forward && !send(line) {
          forward = false; // the webview is gone: stop the job, keep draining to its close
          stop();
        }
        if close.is_some() {
          code = close;
          break;
        }
      }
    }
    closed.store(true, Ordering::SeqCst);
    let tail = {
      let mut l = lock(&s.log);
      l.send = None;
      std::mem::take(&mut l.tail)
    };
    s.last = Instant::now();
    if code.is_none() {
      code = s.child.wait().ok().and_then(|x| x.code()); // died mid-run: the next run starts a new one
      *g = None;
    } else if restart {
      // paw-i5hm: let it finish exiting (its VRAM goes with it), bounded, then drop it (kills what is left): the next
      // run starts a new serve instead of writing to a process on its way out
      let t = Instant::now();
      while s.child.try_wait().ok().flatten().is_none() && t.elapsed() < RESTART_WAIT {
        std::thread::sleep(Duration::from_millis(20));
      }
      *g = None;
    }
    Some(Ok(Exit { code, stderr_tail: tail, cancelled: cancelled.load(Ordering::SeqCst) }))
  })();
  running.release(gen);
  out
}

/// Writes `request` (one JSON object) to stdin, closes it, sends each output
/// line over `on_line` as it arrives, then `{"type":"exit"}` (channel messages
/// are ordered: the front end drains until it sees it). Resolves when the
/// process exits. `run`: the front end's id for this run, which `sidecar_cancel` names (an older front end sends none).
#[tauri::command]
pub async fn sidecar_run(app: AppHandle, request: serde_json::Value, on_line: Channel<String>, run: Option<String>) -> Result<Exit, String> {
  tauri::async_runtime::spawn_blocking(move || {
    // the shared build's first start: python\ appears only when its one-time setup is done (portable.rs)
    if let Err(m) = crate::portable::wait_ready() {
      let _ = on_line.send(r#"{"type":"exit"}"#.into());
      return Err(m);
    }
    let running = app.state::<Running>();
    let ch = on_line.clone();
    let send: Sink = Arc::new(move |l| ch.send(l).is_ok());
    let serve = || {
      let mut c = command();
      c.arg("serve");
      c
    };
    let r = match serve_wanted().then(|| run_resident(&running, run.clone(), serve, &request, send.clone(), GRACE)).flatten() {
      Some(r) => r,
      None => self::run(&running, run, command(), &request.to_string(), &*send),
    };
    let _ = on_line.send(r#"{"type":"exit"}"#.into());
    r
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Kills the current run's whole process tree (async: Esc must not block the window). `run`: only when the current run
/// is that one (sidecar_run's `run`); none: whatever runs (an older front end, the sweep after a reload).
#[tauri::command]
pub async fn sidecar_cancel(app: AppHandle, run: Option<String>) {
  let _ = tauri::async_runtime::spawn_blocking(move || app.state::<Running>().kill(run.as_deref())).await;
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{Duration, Instant};

  #[test]
  fn generations_keep_runs_apart() {
    let r = Running::default();
    let (a, ca) = r.reserve(None).unwrap();
    assert!(r.reserve(None).is_err(), "one run at a time");
    r.kill(None); // A cancelled, slot free at once
    let (b, cb) = r.reserve(None).unwrap();
    r.release(a); // the dying A finishes late
    assert!(r.reserve(None).is_err(), "A must not clear B's slot");
    assert!(ca.load(Ordering::SeqCst) && !cb.load(Ordering::SeqCst), "only A is cancelled");
    r.kill(None);
    assert!(cb.load(Ordering::SeqCst));
    r.release(b);
    assert!(r.reserve(None).is_ok());
  }

  /// paw-1sa9: a cancel names its run; one aimed at a run that has ended (tab A's, as tab B's starts) is a no-op.
  #[test]
  fn a_cancel_by_id_reaches_only_that_run() {
    let r = Running::default();
    let (a, ca) = r.reserve(Some("A".into())).unwrap();
    r.release(a); // A ends
    let (b, cb) = r.reserve(Some("B".into())).unwrap(); // B starts
    r.kill(Some("A")); // A's cancel arrives late
    assert!(!ca.load(Ordering::SeqCst) && !cb.load(Ordering::SeqCst), "a stale id cancels nothing");
    assert!(r.reserve(None).is_err(), "B keeps the slot");
    r.kill(Some("B"));
    assert!(cb.load(Ordering::SeqCst), "the current id cancels its run");
    let (c, cc) = r.reserve(None).unwrap();
    r.kill(Some("B")); // an id against a run without one (an older front end's): no-op
    assert!(!cc.load(Ordering::SeqCst));
    r.kill(None); // no id: whatever runs, as before
    assert!(cc.load(Ordering::SeqCst));
    r.release(b);
    r.release(c);
  }

  /// The same with processes: a stale id leaves the running child alone, its own id kills it.
  #[test]
  fn a_cancel_by_id_kills_only_its_process() {
    let r = Arc::new(Running::default());
    let pid = Arc::new(Mutex::new(None::<u32>));
    let (r2, p2) = (r.clone(), pid.clone());
    let h = std::thread::spawn(move || {
      run(&r2, Some("B".into()), node("console.log(JSON.stringify({pid:process.pid})); setInterval(()=>{},1000)"), "{}", &|l| {
        let v: serde_json::Value = serde_json::from_str(&l).unwrap_or_default();
        if let Some(p) = v["pid"].as_u64() {
          *p2.lock().unwrap() = Some(p as u32);
        }
        true
      })
    });
    let t = Instant::now();
    let pid = loop {
      if let Some(p) = *pid.lock().unwrap() {
        break p;
      }
      assert!(t.elapsed() < Duration::from_secs(20), "child never started");
      std::thread::sleep(Duration::from_millis(20));
    };
    r.kill(Some("A"));
    std::thread::sleep(Duration::from_millis(300));
    assert!(alive(pid) && !h.is_finished(), "a stale id must not touch the run");
    r.kill(Some("B"));
    let ex = h.join().unwrap().unwrap();
    assert!(ex.cancelled);
  }

  #[test]
  fn serve_lines_are_read_from_their_prefix_without_a_parse() {
    let f = r#"{"id":"app3","type":"frame","t_ms":0,"overlay":{"pts":[[0.1,0.2,1]]}}"#;
    assert_eq!(own(f, "app3").map(|x| x.0), Some("frame"));
    let (ty, body) = own(r#"{"id":"app3","type":"result","x":[1,{"id":"q"}]}"#, "app3").unwrap();
    assert_eq!((ty, close_of(ty)), ("result", Some(0)));
    let out = format!("{{{body}");   // what goes out: the same JSON less the id member
    assert_eq!(serde_json::from_str::<serde_json::Value>(&out).unwrap(), serde_json::json!({ "type": "result", "x": [1, { "id": "q" }] }));
    assert_eq!(own(r#"{"id":"app3","type":"error","message":"m"}"#, "app3").map(|x| close_of(x.0)), Some(Some(1)));
    for l in [r#"{"id":"app31","type":"frame"}"#, r#"{"id":"app4","type":"frame"}"#, r#"{"type":"frame","id":"app3"}"#, r#"{"id":"app3"}"#, "not json"] {
      assert!(own(l, "app3").is_none(), "{l}: the parse decides");
    }
  }

  fn node(script: &str) -> Command {
    let mut c = Command::new("node");
    c.args(["-e", script]);
    c
  }

  #[test]
  fn rejected_second_run_spawns_nothing() {
    let r = Running::default();
    let _ = r.reserve(None).unwrap();
    let e = run(&r, None, Command::new("pawscript-no-such-program"), "{}", &|_| true).unwrap_err();
    assert_eq!(e, "a tracker run is already active"); // not "cannot start": nothing was spawned
  }

  #[test]
  fn stderr_is_streamed_as_log_lines() {
    let r = Running::default();
    let got = Mutex::new(Vec::new());
    let ex = run(&r, None, node("console.error('waiting for the GPU'); console.log('{\"type\":\"result\"}')"), "{}", &|l| {
      got.lock().unwrap().push(l);
      true
    })
    .unwrap();
    let got = got.into_inner().unwrap();
    let log = serde_json::json!({ "type": "log", "line": "waiting for the GPU" });
    assert!(got.iter().any(|l| serde_json::from_str::<serde_json::Value>(l).ok() == Some(log.clone())), "{got:?}");
    assert!(got.contains(&r#"{"type":"result"}"#.to_string()));
    assert_eq!((ex.code, ex.cancelled), (Some(0), false));
    assert!(ex.stderr_tail.contains("waiting for the GPU"));
  }

  #[test]
  fn gone_frontend_kills_a_chatty_child() {
    let r = Running::default();
    let t = Instant::now();
    let ex = run(&r, None, node("const s='x'.repeat(200)+'\\n'; for(;;) process.stdout.write(s)"), "{}", &|_| false).unwrap();
    assert!(t.elapsed() < Duration::from_secs(20), "the run must end, not hang on a full pipe");
    assert_ne!(ex.code, Some(0));
    assert!(r.reserve(None).is_ok(), "slot freed");
  }

  /// App death = the job handle closes: the orphaned grandchild must die with it.
  #[cfg(windows)]
  #[test]
  fn closing_the_tree_kills_orphans() {
    let mut c = Command::new("cmd");
    c.args(["/C", "node", "-e", "console.log(process.pid); setInterval(()=>{},1000)"]).stdout(Stdio::piped());
    let mut child = c.spawn().unwrap();
    let tree = Tree::new(&child);
    assert_ne!(tree.job, 0, "job object assigned");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let pid: u32 = line.trim().parse().unwrap();
    child.kill().unwrap(); // the parent only, like taskkill without /T
    let _ = child.wait();
    std::thread::sleep(Duration::from_millis(300));
    assert!(alive(pid), "orphan still running before the handle closes");
    drop(tree);
    let t = Instant::now();
    while alive(pid) {
      assert!(t.elapsed() < Duration::from_secs(5), "orphan {pid} survived the job handle closing");
      std::thread::sleep(Duration::from_millis(50));
    }
  }

  fn alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
      let out = Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output().unwrap();
      String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
    }
    #[cfg(not(windows))]
    Command::new("kill").args(["-0", &pid.to_string()]).status().unwrap().success()
  }

  /// A fake `pawtrack serve`: hello, `slow` answers cancel, `stuck` ignores it, anything else returns its pid.
  const FAKE_SERVE: &str = r#"
    const out = (o) => console.log(JSON.stringify(o)); let cur = null;
    out({ type: 'hello', protocol: 'pawtrack-serve/1', pid: process.pid });
    require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
      const r = JSON.parse(l);
      if (r.cmd === 'cancel') { if (r.target === cur?.id && cur.cmd === 'slow') { out({ id: cur.id, type: 'error', message: 'cancelled', cancelled: true }); cur = null; } return; }
      if (r.cmd === 'slow' || r.cmd === 'stuck') { cur = r; console.error('working'); out({ id: r.id, type: 'progress', done: 0, total: 1 }); return; }
      out({ id: r.id, type: 'result', pid: process.pid });
    });"#;

  fn collect() -> (Arc<Mutex<Vec<serde_json::Value>>>, Sink) {
    let got = Arc::new(Mutex::new(Vec::new()));
    let g = got.clone();
    (got, Arc::new(move |l: String| { g.lock().unwrap().push(serde_json::from_str(&l).unwrap()); true }))
  }

  fn resident(r: &Running, cmd: &str, sink: Sink) -> Exit {
    run_resident(r, None, || node(FAKE_SERVE), &serde_json::json!({ "cmd": cmd }), sink, Duration::from_millis(500)).expect("resident").unwrap()
  }

  fn pid_of(got: &Arc<Mutex<Vec<serde_json::Value>>>) -> u64 {
    got.lock().unwrap().iter().rev().find_map(|e| e["pid"].as_u64()).expect("a result with a pid")
  }

  fn wait_for(got: &Arc<Mutex<Vec<serde_json::Value>>>, ty: &str) {
    let t = Instant::now();
    while !got.lock().unwrap().iter().any(|e| e["type"] == ty) {
      assert!(t.elapsed() < Duration::from_secs(20), "no {ty} event");
      std::thread::sleep(Duration::from_millis(20));
    }
  }

  #[test]
  fn resident_runs_share_one_process_and_cancel_cooperatively() {
    let r = Arc::new(Running::default());
    let (got, sink) = collect();
    let ex = resident(&r, "a", sink.clone());
    assert_eq!((ex.code, ex.cancelled), (Some(0), false));
    assert!(got.lock().unwrap().last().unwrap().get("id").is_none(), "the result line goes out as a one-shot run's");
    let pid = pid_of(&got);
    resident(&r, "b", sink.clone());
    assert_eq!(pid_of(&got), pid, "the second run reuses the process");
    // cooperative cancel: the job closes itself, the process stays
    let (r2, s2) = (r.clone(), sink.clone());
    let h = std::thread::spawn(move || resident(&r2, "slow", s2));
    wait_for(&got, "progress");
    r.kill(None);
    let ex = h.join().unwrap();
    assert!(ex.cancelled);
    assert!(got.lock().unwrap().iter().any(|e| e["type"] == "log" && e["line"] == "working"), "stderr comes as log lines");
    resident(&r, "c", sink.clone());
    assert_eq!(pid_of(&got), pid, "a cooperative cancel keeps the process");
    // a job that ignores the cancel: the process is killed after the grace time, the next run starts a new one
    got.lock().unwrap().clear();
    let (r2, s2) = (r.clone(), sink.clone());
    let h = std::thread::spawn(move || resident(&r2, "stuck", s2));
    wait_for(&got, "progress");
    r.kill(None);
    assert!(h.join().unwrap().cancelled);
    assert!(!alive(pid as u32) || { std::thread::sleep(Duration::from_millis(500)); !alive(pid as u32) }, "the stuck serve was killed");
    resident(&r, "d", sink.clone());
    assert_ne!(pid_of(&got), pid, "a new serve after the kill");
    r.shutdown();
  }

  /// paw-i5hm: after an error with `restart: true` serve stops reading and exits a moment later (a broken CUDA
  /// context); a run sent at once must get a fresh serve, not the one on its way out.
  #[test]
  fn a_run_right_after_a_restart_error_gets_a_fresh_serve() {
    let fake = r#"
      const out = (o) => console.log(JSON.stringify(o));
      out({ type: 'hello', protocol: 'pawtrack-serve/1' });
      const rl = require('readline').createInterface({ input: process.stdin });
      rl.on('line', (l) => {
        const r = JSON.parse(l);
        if (r.cmd === 'boom') { out({ id: r.id, type: 'error', message: 'CUDA error', restart: true }); rl.close(); setTimeout(() => process.exit(3), 400); return; }
        out({ id: r.id, type: 'result', pid: process.pid });
      });"#;
    let r = Running::default();
    let (got, sink) = collect();
    let go = |cmd: &str| run_resident(&r, None, || node(fake), &serde_json::json!({ "cmd": cmd }), sink.clone(), GRACE).expect("resident").unwrap();
    assert_eq!(go("a").code, Some(0));
    let pid = pid_of(&got);
    let ex = go("boom");
    assert_eq!((ex.code, ex.cancelled), (Some(1), false));
    let ex = go("b");
    assert_eq!(ex.code, Some(0), "the run after the restart error succeeds");
    assert_ne!(pid_of(&got), pid, "on a new serve");
    assert!(!alive(pid as u32), "the old serve is gone");
    r.shutdown();
  }

  #[test]
  fn resident_that_cannot_start_falls_back() {
    let r = Running::default();
    let (_, sink) = collect();
    assert!(run_resident(&r, None, || node("process.exit(3)"), &serde_json::json!({ "cmd": "a" }), sink.clone(), GRACE).is_none());
    assert!(run_resident(&r, None, || panic!("not tried again"), &serde_json::json!({ "cmd": "a" }), sink, GRACE).is_none());
    assert!(r.reserve(None).is_ok(), "slot freed for the one-shot run");
  }

  /// A uv-like parent (cmd / sh) whose child (node) prints its pid and sleeps:
  /// cancel must kill both, and report the run as cancelled.
  #[test]
  fn cancel_kills_the_whole_tree() {
    let r = Arc::new(Running::default());
    let script = "console.log(JSON.stringify({type:'pid',pid:process.pid})); setInterval(()=>{},1000)";
    #[cfg(windows)]
    let parent = {
      let mut c = Command::new("cmd");
      c.args(["/C", "node", "-e", script]);
      c
    };
    #[cfg(not(windows))]
    let parent = {
      let mut c = Command::new("sh");
      c.args(["-c", &format!("node -e \"{script}\"; true")]);
      c
    };
    let child_pid = Arc::new(Mutex::new(None::<u32>));
    let (r2, cp) = (r.clone(), child_pid.clone());
    let h = std::thread::spawn(move || {
      run(&r2, None, parent, "{}", &|l| {
        let v: serde_json::Value = serde_json::from_str(&l).unwrap_or_default();
        if let Some(p) = v.get("pid").and_then(|p| p.as_u64()) {
          *cp.lock().unwrap() = Some(p as u32);
        }
        true
      })
    });
    let t = Instant::now();
    let pid = loop {
      if let Some(p) = *child_pid.lock().unwrap() {
        break p;
      }
      assert!(t.elapsed() < Duration::from_secs(20), "child never started");
      std::thread::sleep(Duration::from_millis(20));
    };
    assert!(alive(pid));
    r.kill(None);
    let ex = h.join().unwrap().unwrap();
    assert!(ex.cancelled);
    let t = Instant::now();
    while alive(pid) {
      assert!(t.elapsed() < Duration::from_secs(5), "grandchild {pid} survived the cancel");
      std::thread::sleep(Duration::from_millis(50));
    }
  }
}
