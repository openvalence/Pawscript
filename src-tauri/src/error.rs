//! The one error type every command returns. Serialises to `{code, message}`:
//! `code` is a stable machine string the UI can switch on (listed in API.md),
//! `message` is human text that names the path or tool involved.

use std::{fmt, io, path::Path};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Error {
  pub code: &'static str,
  pub message: String,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
  pub fn new(code: &'static str, message: impl Into<String>) -> Self {
    Error { code, message: message.into() }
  }
  pub fn invalid(message: impl Into<String>) -> Self {
    Error::new("invalid_input", message)
  }
  pub fn cancelled() -> Self {
    Error::new("cancelled", "cancelled")
  }
  pub fn io(e: io::Error, path: &Path) -> Self {
    // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION: another program holds the file.
    let busy = cfg!(windows) && matches!(e.raw_os_error(), Some(32 | 33));
    let code = match e.kind() {
      _ if busy => "busy",
      io::ErrorKind::NotFound => "not_found",
      io::ErrorKind::PermissionDenied => "permission_denied",
      io::ErrorKind::AlreadyExists => "exists",
      io::ErrorKind::IsADirectory | io::ErrorKind::NotADirectory => "invalid_input",
      io::ErrorKind::StorageFull => "disk_full",
      _ => "io",
    };
    let what = if busy { "the file is in use by another program".to_string() } else { e.to_string() };
    Error::new(code, format!("{}: {what}", path.display()))
  }
}

impl fmt::Display for Error {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}: {}", self.code, self.message)
  }
}

impl std::error::Error for Error {}

/// `io_result.at(path)?` — attach the path and classify the error.
pub trait At<T> {
  fn at(self, path: &Path) -> Result<T>;
}

impl<T> At<T> for io::Result<T> {
  fn at(self, path: &Path) -> Result<T> {
    self.map_err(|e| Error::io(e, path))
  }
}

/// Runs blocking work off the main thread (sync Tauri commands run on it).
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
  tauri::async_runtime::spawn_blocking(f).await.map_err(|e| Error::new("internal", e.to_string()))?
}
