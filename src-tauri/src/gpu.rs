//! paw-vdb3.3: which runtime fits this PC, decided before anything is downloaded (Python is not installed yet). DXGI lists
//! the display adapters (vendor id, name, dedicated video memory); a discrete NVIDIA card picks the CUDA runtime, a
//! discrete AMD card the ROCm one, anything else the CUDA runtime (its CPU path runs anywhere). The setting
//! `models.runtime` (Settings > Models) overrides the pick; the sidecar starts from the chosen runtime's folder.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const CUDA: &str = "runtime";
pub const ROCM: &str = "runtime-rocm";
const NVIDIA: u32 = 0x10DE;
const AMD: u32 = 0x1002;
const BASIC_RENDER: u32 = 0x1414;
/// A card with less dedicated memory than this is an iGPU (UMA frame buffers: 0.5 - 2 GB, measured 1.95 GB on a Ryzen 9
/// 9950X3D) or a software adapter; the trackers want 4 GB and more anyway.
/// ponytail: a size heuristic; an iGPU given a 4 GiB+ frame buffer in the BIOS would count as discrete.
const DISCRETE_MIN: u64 = 4 << 30;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
  pub vendor: u32,
  pub name: String,
  pub vram: u64,
  /// the software rasterizer (Microsoft Basic Render Driver, WARP)
  pub software: bool,
}

impl Adapter {
  fn discrete(&self) -> bool {
    !self.software && self.vendor != BASIC_RENDER && self.vram >= DISCRETE_MIN
  }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
  pub adapters: Vec<Adapter>,
  /// the runtime id to use when the user has not chosen: `runtime` or `runtime-rocm`
  pub runtime: &'static str,
  /// the discrete card that decided it (None: none found, the CPU path)
  pub name: Option<String>,
  pub vram: u64,
}

/// NVIDIA first (the shipped, tested runtime), then AMD; the biggest card of that vendor.
pub fn pick(adapters: Vec<Adapter>) -> Probe {
  let best = |v: u32| adapters.iter().filter(|a| a.discrete() && a.vendor == v).max_by_key(|a| a.vram).cloned();
  let (runtime, card) = match (best(NVIDIA), best(AMD)) {
    (Some(c), _) => (CUDA, Some(c)),
    (None, Some(c)) => (ROCM, Some(c)),
    _ => (CUDA, None),
  };
  Probe { runtime, name: card.as_ref().map(|c| c.name.clone()), vram: card.map_or(0, |c| c.vram), adapters }
}

#[cfg(windows)]
fn adapters() -> Vec<Adapter> {
  use std::ffi::c_void;
  use windows_sys::core::GUID;
  // windows-sys has no DXGI: the one entry point and the one struct (dxgi.h) declared here
  #[repr(C)]
  struct Desc1 {
    description: [u16; 128],
    vendor_id: u32,
    device_id: u32,
    sub_sys_id: u32,
    revision: u32,
    dedicated_video_memory: usize,
    dedicated_system_memory: usize,
    shared_system_memory: usize,
    luid: [u32; 2],
    flags: u32,
  }
  #[link(name = "dxgi")]
  extern "system" {
    fn CreateDXGIFactory1(riid: *const GUID, factory: *mut *mut c_void) -> i32;
  }
  type Fun = unsafe extern "system" fn();
  type Enum = unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32;
  type GetDesc = unsafe extern "system" fn(*mut c_void, *mut Desc1) -> i32;
  type Release = unsafe extern "system" fn(*mut c_void) -> u32;
  // COM by vtable slot: IUnknown 0-2 (Release = 2); IDXGIFactory1::EnumAdapters1 = 12; IDXGIAdapter1::GetDesc1 = 10.
  unsafe fn slot(o: *mut c_void, i: usize) -> Fun {
    unsafe { *(*(o as *mut *const Fun)).add(i) }
  }
  let mut out = Vec::new();
  unsafe {
    const IID_FACTORY1: GUID = GUID::from_u128(0x770aae78_f26f_4dba_a829_253c83d1b387);
    let mut f: *mut c_void = std::ptr::null_mut();
    if CreateDXGIFactory1(&IID_FACTORY1, &mut f) < 0 || f.is_null() {
      return out;
    }
    let enum1: Enum = std::mem::transmute(slot(f, 12));
    for i in 0..64 {
      let mut a: *mut c_void = std::ptr::null_mut();
      if enum1(f, i, &mut a) < 0 || a.is_null() {
        break;
      }
      let mut d: Desc1 = std::mem::zeroed();
      let desc: GetDesc = std::mem::transmute(slot(a, 10));
      if desc(a, &mut d) >= 0 {
        let n = d.description.iter().position(|&c| c == 0).unwrap_or(128);
        out.push(Adapter { vendor: d.vendor_id, name: String::from_utf16_lossy(&d.description[..n]), vram: d.dedicated_video_memory as u64, software: d.flags & 2 != 0 });
      }
      let release: Release = std::mem::transmute(slot(a, 2));
      release(a);
    }
    let release: Release = std::mem::transmute(slot(f, 2));
    release(f);
  }
  out
}

#[cfg(not(windows))]
fn adapters() -> Vec<Adapter> {
  Vec::new()
}

fn probed() -> &'static Probe {
  static P: OnceLock<Probe> = OnceLock::new();
  P.get_or_init(|| pick(adapters()))
}

/// The front end asks before it downloads anything.
#[tauri::command]
pub fn gpu_probe() -> Probe {
  probed().clone()
}

pub fn is_runtime(id: &str) -> bool {
  id == CUDA || id == ROCM
}

/// The runtime's folder beside the exe.
pub fn folder_of(id: &str) -> &'static str {
  if id == ROCM {
    "python-rocm"
  } else {
    "python"
  }
}

/// The python.exe the sidecar starts: the chosen runtime's (setting `models.runtime`, else the probe's pick), else the
/// other one when only that is unpacked, else the chosen path (not there: the caller falls back to uv).
pub fn python_exe(root: &Path) -> PathBuf {
  let set = crate::models::setting("models.runtime").unwrap_or_default();
  let want = if is_runtime(&set) { set } else { probed().runtime.to_string() };
  choose_exe(root, &want)
}

fn choose_exe(root: &Path, want: &str) -> PathBuf {
  let exe = |id: &str| root.join(folder_of(id)).join("python.exe");
  let other = if want == ROCM { CUDA } else { ROCM };
  if !exe(want).is_file() && exe(other).is_file() {
    exe(other)
  } else {
    exe(want)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  fn a(vendor: u32, name: &str, gb: u64) -> Adapter {
    Adapter { vendor, name: name.into(), vram: gb << 30, software: false }
  }

  #[test]
  fn nvidia_only_is_cuda() {
    let p = pick(vec![a(NVIDIA, "NVIDIA GeForce RTX 4090", 24), a(BASIC_RENDER, "Microsoft Basic Render Driver", 0)]);
    assert_eq!((p.runtime, p.name.as_deref()), (CUDA, Some("NVIDIA GeForce RTX 4090")));
  }

  #[test]
  fn amd_card_with_an_igpu_is_rocm_and_names_the_card() {
    let p = pick(vec![a(AMD, "AMD Radeon(TM) Graphics", 2), a(AMD, "AMD Radeon RX 9070 XT", 16)]);
    assert_eq!((p.runtime, p.name.as_deref(), p.vram), (ROCM, Some("AMD Radeon RX 9070 XT"), 16 << 30));
  }

  #[test]
  fn an_amd_igpu_alone_and_intel_only_and_none_are_cuda_cpu() {
    for list in [vec![a(AMD, "AMD Radeon(TM) Graphics", 2)], vec![a(0x8086, "Intel(R) Arc(TM) A770", 16), a(0x8086, "Intel UHD", 0)], vec![]] {
      let p = pick(list);
      assert_eq!((p.runtime, p.name), (CUDA, None));
    }
  }

  #[test]
  fn both_vendors_prefer_nvidia_and_a_software_adapter_never_counts() {
    assert_eq!(pick(vec![a(AMD, "AMD Radeon RX 9070 XT", 16), a(NVIDIA, "NVIDIA GeForce RTX 3060", 12)]).runtime, CUDA);
    let soft = Adapter { software: true, ..a(AMD, "WARP", 16) };
    assert_eq!(pick(vec![soft]).name, None);
  }

  #[test]
  fn the_real_probe_runs_and_lists_this_pcs_adapters() {
    let p = pick(adapters());
    println!("{p:?}");
    #[cfg(windows)]
    assert!(!p.adapters.is_empty());
  }

  #[test]
  fn the_launcher_uses_the_chosen_folder_else_the_one_that_exists() {
    let t = tempfile::tempdir().unwrap();
    let r = t.path();
    assert_eq!(choose_exe(r, ROCM), r.join("python-rocm").join("python.exe")); // none unpacked: the chosen path, uv follows
    std::fs::create_dir_all(r.join("python")).unwrap();
    std::fs::write(r.join("python").join("python.exe"), "").unwrap();
    assert_eq!(choose_exe(r, ROCM), r.join("python").join("python.exe"), "only the other is there");
    std::fs::create_dir_all(r.join("python-rocm")).unwrap();
    std::fs::write(r.join("python-rocm").join("python.exe"), "").unwrap();
    assert_eq!(choose_exe(r, ROCM), r.join("python-rocm").join("python.exe"));
    assert_eq!(choose_exe(r, CUDA), r.join("python").join("python.exe"));
  }
}
