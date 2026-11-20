//! ffmpeg / ffprobe as an optional external tool, plus the cancellable job
//! registry every long operation (media helpers, full-file hashing) runs under.
//!
//! Tools are found as `PAWSCRIPT_FFMPEG` / `PAWSCRIPT_FFPROBE` when set, else
//! next to the exe (portable build), else on PATH. A missing tool is the error code `ffmpeg_missing`. Every input is opened
//! with `-protocol_whitelist file`: a playlist or concat file cannot make ffmpeg
//! touch the network (privacy, outline §12).

use crate::error::{Error, Result};
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

// ---------------------------------------------------------------- jobs

#[derive(Default)]
pub struct Job {
  cancelled: AtomicBool,
  children: Mutex<Vec<Arc<Mutex<Child>>>>,
  below_normal: AtomicBool,
}

impl Job {
  /// paw-mh1a: the tools this job starts from now on run at below-normal priority (Windows; a no-op elsewhere).
  pub fn below_normal(&self) {
    self.below_normal.store(true, Ordering::SeqCst);
  }
  pub fn is_below_normal(&self) -> bool {
    self.below_normal.load(Ordering::SeqCst)
  }
  pub fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::SeqCst)
  }
  pub fn check(&self) -> Result<()> {
    if self.is_cancelled() {
      Err(Error::cancelled())
    } else {
      Ok(())
    }
  }
  pub fn cancel(&self) {
    self.cancelled.store(true, Ordering::SeqCst);
    for c in self.children.lock().unwrap_or_else(|e| e.into_inner()).iter() {
      let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
  }
  /// paw-mh1a: kills the tools running now without cancelling the job (it may start more).
  pub fn stop_children(&self) {
    for c in self.children.lock().unwrap_or_else(|e| e.into_inner()).iter() {
      let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
  }
  fn adopt(&self, c: &Arc<Mutex<Child>>) {
    self.children.lock().unwrap_or_else(|e| e.into_inner()).push(c.clone());
    if self.is_cancelled() {
      let _ = c.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
  }
  fn release(&self, c: &Arc<Mutex<Child>>) {
    self.children.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| !Arc::ptr_eq(x, c));
  }
}

static JOBS: LazyLock<Mutex<HashMap<String, Arc<Job>>>> = LazyLock::new(Default::default);

/// A registered job; unregisters itself when dropped.
pub struct JobGuard {
  id: Option<String>,
  pub job: Arc<Job>,
}

impl Drop for JobGuard {
  fn drop(&mut self) {
    if let Some(id) = &self.id {
      JOBS.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }
  }
}

/// Registers `id` (chosen by the caller, any unique string) so `cancel(id)` can
/// stop it. `None` makes an anonymous, uncancellable job.
pub fn start_job(id: Option<String>) -> Result<JobGuard> {
  let job = Arc::new(Job::default());
  if let Some(id) = &id {
    let mut jobs = JOBS.lock().unwrap_or_else(|e| e.into_inner());
    if jobs.contains_key(id) {
      return Err(Error::new("busy", format!("a job with id {id} is already running")));
    }
    jobs.insert(id.clone(), job.clone());
  }
  Ok(JobGuard { id, job })
}

/// Cancels a running job; false when no such job (already finished).
pub fn cancel(id: &str) -> bool {
  let job = JOBS.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned();
  job.map(|j| j.cancel()).is_some()
}

// ---------------------------------------------------------------- tools

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tool {
  Ffmpeg,
  Ffprobe,
}

impl Tool {
  fn name(self) -> &'static str {
    match self {
      Tool::Ffmpeg => "ffmpeg",
      Tool::Ffprobe => "ffprobe",
    }
  }
  fn program(self) -> OsString {
    let var = match self {
      Tool::Ffmpeg => "PAWSCRIPT_FFMPEG",
      Tool::Ffprobe => "PAWSCRIPT_FFPROBE",
    };
    std::env::var_os(var)
      .filter(|v| !v.is_empty())
      .or_else(|| beside_exe(&format!("{}{}", self.name(), std::env::consts::EXE_SUFFIX)))
      .unwrap_or_else(|| self.name().into())
  }
}

/// A tool shipped next to the app's exe (portable build).
fn beside_exe(file: &str) -> Option<OsString> {
  let p = std::env::current_exe().ok()?.parent()?.join(file);
  p.is_file().then(|| p.into_os_string())
}

/// Where the OS would find `program` (for display; spawning does its own lookup).
fn which(program: &OsStr) -> Option<PathBuf> {
  let p = Path::new(program);
  if p.components().count() > 1 {
    return p.is_file().then(|| p.to_path_buf());
  }
  let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat", ""] } else { &[""] };
  std::env::split_paths(&std::env::var_os("PATH")?).find_map(|dir| {
    exts.iter().map(|e| dir.join(format!("{}{e}", p.to_string_lossy()))).find(|c| c.is_file())
  })
}

pub fn command(tool: Tool) -> Command {
  let mut c = Command::new(tool.program());
  c.stdin(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  c
}

fn spawn_error(tool: Tool, e: std::io::Error) -> Error {
  if e.kind() == std::io::ErrorKind::NotFound {
    Error::new(
      "ffmpeg_missing",
      format!("{} was not found. Install ffmpeg and put it on PATH (or set PAWSCRIPT_{}).", tool.name(), tool.name().to_uppercase()),
    )
  } else {
    Error::new("ffmpeg_failed", format!("cannot start {}: {e}", tool.name()))
  }
}

#[derive(Debug, serde::Serialize)]
pub struct ToolInfo {
  pub path: Option<String>,
  pub version: String,
}

#[derive(Debug, serde::Serialize)]
pub struct Tools {
  pub ffmpeg: Option<ToolInfo>,
  pub ffprobe: Option<ToolInfo>,
}

fn info(tool: Tool) -> Option<ToolInfo> {
  let out = command(tool).arg("-version").stdout(Stdio::piped()).stderr(Stdio::null()).output().ok()?;
  let first = String::from_utf8_lossy(&out.stdout).lines().next()?.to_string();
  // "ffmpeg version 8.1.1-full_build-www.gyan.dev Copyright ..."
  let version = first.split_whitespace().nth(2).unwrap_or("").to_string();
  out.status.success().then(|| ToolInfo { path: which(&tool.program()).map(|p| p.to_string_lossy().into_owned()), version })
}

pub fn tools() -> Tools {
  Tools { ffmpeg: info(Tool::Ffmpeg), ffprobe: info(Tool::Ffprobe) }
}

/// An input argument ffmpeg cannot mistake for an option or a URL.
pub fn input_arg(path: &Path) -> OsString {
  let abs = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
  let mut s = OsString::from("file:");
  s.push(abs.as_os_str());
  s
}

// ---------------------------------------------------------------- running

/// A `-progress` line (`key=value`, key of lowercase letters, digits, `_`).
fn progress_kv(line: &str) -> Option<(&str, &str)> {
  let (k, v) = line.split_once('=')?;
  (!k.is_empty() && k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')).then_some((k, v.trim()))
}

/// Seconds of output written so far, from a progress line.
pub fn progress_seconds(line: &str) -> Option<f64> {
  match progress_kv(line)? {
    ("out_time_us", v) | ("out_time_ms", v) => v.parse::<f64>().ok().filter(|t| *t >= 0.0).map(|us| us / 1e6),
    _ => None,
  }
}

/// Runs `tool args`, feeding stdout to `sink` as it arrives and output time (s)
/// to `on_time` (pass `-progress pipe:2 -nostats` in args to get it). Errors:
/// `cancelled` if the job was cancelled, `ffmpeg_missing`, `ffmpeg_failed` with
/// the last lines of stderr, or whatever `sink` returned.
pub fn run(job: &Job, tool: Tool, args: &[OsString], mut sink: impl FnMut(&[u8]) -> Result<()>, on_time: impl FnMut(f64) + Send) -> Result<()> {
  job.check()?;
  let mut cmd = command(tool);
  #[cfg(windows)]
  if job.is_below_normal() {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000 | 0x0000_4000); // CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS
  }
  let mut child = cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| spawn_error(tool, e))?;
  crate::sidecar::reap_on_exit(&child);
  let mut out = child.stdout.take().expect("piped");
  let err = child.stderr.take().expect("piped");
  let child = Arc::new(Mutex::new(child));
  job.adopt(&child);
  let (status, tail, sink_err) = std::thread::scope(|s| {
    let mut on_time = on_time;
    let reader = s.spawn(move || {
      let mut tail: Vec<String> = Vec::new();
      for line in BufReader::new(err).lines().map_while(|l| l.ok()) {
        if let Some(t) = progress_seconds(&line) {
          on_time(t);
        } else if progress_kv(&line).is_none() && !line.trim().is_empty() {
          tail.push(line);
          if tail.len() > 12 {
            tail.remove(0);
          }
        }
      }
      tail.join("\n")
    });
    let mut buf = vec![0u8; 1 << 16];
    let mut sink_err = None;
    loop {
      match out.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          if let Err(e) = sink(&buf[..n]) {
            sink_err = Some(e);
            break;
          }
        }
        Err(e) => {
          sink_err = Some(Error::new("ffmpeg_failed", format!("reading {} output: {e}", tool.name())));
          break;
        }
      }
    }
    if sink_err.is_some() {
      let _ = child.lock().unwrap_or_else(|e| e.into_inner()).kill();
    }
    drop(out);
    // Poll rather than wait(): a blocking wait would hold the lock cancel() needs.
    let status = loop {
      match child.lock().unwrap_or_else(|e| e.into_inner()).try_wait() {
        Ok(Some(s)) => break Ok(s),
        Ok(None) => {}
        Err(e) => break Err(e),
      }
      std::thread::sleep(Duration::from_millis(5));
    };
    (status, reader.join().unwrap_or_default(), sink_err)
  });
  job.release(&child);
  job.check()?;
  if let Some(e) = sink_err {
    return Err(e);
  }
  let status = status.map_err(|e| Error::new("ffmpeg_failed", e.to_string()))?;
  if !status.success() {
    let why = if tail.is_empty() { format!("exit status {status}") } else { tail };
    return Err(Error::new("ffmpeg_failed", format!("{} failed: {why}", tool.name())));
  }
  Ok(())
}

/// `run` collecting stdout into memory.
pub fn output(job: &Job, tool: Tool, args: &[OsString]) -> Result<Vec<u8>> {
  let mut v = Vec::new();
  run(
    job,
    tool,
    args,
    |b| {
      v.extend_from_slice(b);
      Ok(())
    },
    |_| {},
  )?;
  Ok(v)
}

pub fn args<I: IntoIterator<Item = S>, S: Into<OsString>>(a: I) -> Vec<OsString> {
  a.into_iter().map(Into::into).collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn progress_parsing() {
    assert_eq!(progress_seconds("out_time_us=1500000"), Some(1.5));
    assert_eq!(progress_seconds("out_time_ms=250000"), Some(0.25));
    assert_eq!(progress_seconds("out_time_us=N/A"), None);
    assert_eq!(progress_seconds("frame=12"), None);
    assert!(progress_kv("progress=continue").is_some());
    assert!(progress_kv("[mp4 @ 0x1] stream 0, offset=12: bad").is_none());
    assert!(progress_kv("Error opening input: x=y").is_none());
  }

  #[test]
  fn input_arg_is_absolute_file_url() {
    let a = input_arg(Path::new("clip.mp4")).to_string_lossy().into_owned();
    assert!(a.starts_with("file:"));
    assert!(Path::new(&a[5..]).is_absolute());
  }

  #[test]
  fn jobs_register_cancel_and_unregister() {
    let g = start_job(Some("t-1".into())).unwrap();
    assert_eq!(start_job(Some("t-1".into())).err().unwrap().code, "busy");
    assert!(cancel("t-1"));
    assert_eq!(g.job.check().unwrap_err().code, "cancelled");
    drop(g);
    assert!(!cancel("t-1"));
    assert!(start_job(Some("t-1".into())).is_ok());
  }

  #[test]
  fn missing_tool_is_a_clean_error() {
    let job = Job::default();
    let mut c = Command::new("pawscript-no-such-tool-xyz");
    let e = c.spawn().map_err(|e| spawn_error(Tool::Ffmpeg, e)).unwrap_err();
    assert_eq!(e.code, "ffmpeg_missing");
    assert!(job.check().is_ok());
  }
}
