// buttplug.rs -- the embedded buttplug server for device playback (src/features/playback): toys from the
// btleplug, serial and hid managers, driven in process. Trimmed from Phosphor's src-tauri/src/buttplug.rs
// (same fork, same calls): no websocket listener, no virtual machine device, no saved device config.
//
// Constraints:
// - In process only: nothing listens on a port, so no other app can reach the device through us. Intiface
//   Central and this server cannot both hold one BLE toy: the panel says so when a scan finds nothing.
// - Starts only when the webview asks (bp_start, the Device panel's Connect); never at launch.
// - Every command is async: buttplug spawns on the ambient tokio runtime, and Tauri runs sync commands on the
//   main thread, outside it.
// - Motion goes through `op`, a handshaken server over the device manager, so every command gets upstream's
//   range checks (a position outside the feature's step range is refused there, not clamped).
// - stop_all() is the hard stop: the main window's Destroyed event calls it (hooked at start) as well as the webview.
// Events: bp://devices (Device[]), bp://scanning (bool).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use buttplug_core::message::{
  ButtplugClientMessageV4, ButtplugMessageSpecVersion, ButtplugServerMessageV4, DeviceFeature, DeviceFeatureOutput,
  DeviceListV4, OutputCmdV4, OutputCommand, OutputHwPositionWithDuration, OutputType, RequestDeviceListV0,
  RequestServerInfoV4, StartScanningV0, StopCmdV4, StopScanningV0,
};
use buttplug_server::device::{ServerDeviceManager, ServerDeviceManagerBuilder};
use buttplug_server::message::spec_enums::ButtplugCheckedClientMessageV4;
use buttplug_server::message::{ButtplugClientMessageVariant, ButtplugServerMessageVariant};
use buttplug_server::{ButtplugServer, ButtplugServerBuilder};
use buttplug_server_device_config::load_protocol_configs;
use futures::StreamExt;
use serde::Serialize;
use tauri::async_runtime::{JoinHandle, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

const SERVER_NAME: &str = "Pawscript";

/// A position actuator: `range` in the steps bp_linear takes, `ms` its duration range.
#[derive(Clone, Serialize)]
pub struct Linear {
  feature: u32,
  range: [i32; 2],
  ms: Option<[i32; 2]>,
}

#[derive(Clone, Serialize)]
pub struct Device {
  index: u32,
  name: String,
  /// Upstream batches a device's commands in this window (ms).
  gap_ms: u32,
  linear: Vec<Linear>,
  /// Every other output type the device has (Vibrate, Rotate, ...): listed, never driven.
  other: Vec<String>,
}

fn linear_of(f: &DeviceFeature) -> Option<Linear> {
  let t = OutputType::HwPositionWithDuration;
  if !f.contains_output(t) {
    return None;
  }
  let r = f.get_output_limits(t)?.step_limit();
  let ms = match f.get_output(t) {
    Some(DeviceFeatureOutput::HwPositionWithDuration(p)) => Some([p.duration().start(), p.duration().end()]),
    _ => None,
  };
  Some(Linear { feature: f.feature_index(), range: [r.start(), r.end()], ms })
}

fn device_list(dl: &DeviceListV4) -> Vec<Device> {
  let mut out: Vec<Device> = dl
    .devices()
    .values()
    .map(|d| {
      let feats = d.device_features().values();
      let linear: Vec<Linear> = feats.clone().filter_map(linear_of).collect();
      let mut other: Vec<String> = Vec::new();
      for f in feats {
        if let Ok(serde_json::Value::Object(m)) = serde_json::to_value(f) {
          if let Some(serde_json::Value::Object(o)) = m.get("Output") {
            other.extend(o.keys().filter(|k| k.as_str() != "HwPositionWithDuration").cloned());
          }
        }
      }
      other.sort();
      other.dedup();
      Device {
        index: d.device_index(),
        name: d.device_display_name().clone().unwrap_or_else(|| d.device_name().clone()),
        gap_ms: d.device_message_timing_gap(),
        linear,
        other,
      }
    })
    .collect();
  out.sort_by_key(|d| d.index);
  out
}

async fn op_call(op: &ButtplugServer, msg: ButtplugClientMessageV4) -> Result<ButtplugServerMessageV4, String> {
  match op.parse_message(ButtplugClientMessageVariant::V4(msg)).await {
    Ok(ButtplugServerMessageVariant::V4(m)) => Ok(m),
    Err(ButtplugServerMessageVariant::V4(ButtplugServerMessageV4::Error(e))) => Err(e.error_message().clone()),
    other => Err(format!("unexpected reply {:?}", other)),
  }
}

struct Run {
  dm: Arc<ServerDeviceManager>,
  op: Arc<ButtplugServer>,
  watch: JoinHandle<()>,
}

#[derive(Default)]
pub struct Buttplug {
  run: Mutex<Option<Run>>,
  /// The main window's Destroyed hook is in (once per process).
  hooked: AtomicBool,
}

impl Buttplug {
  async fn start(&self, app: AppHandle) -> Result<(), String> {
    let mut run = self.run.lock().await;
    if run.is_some() {
      return Ok(());
    }
    // Hard stop on close: a moving toy must not outlive the window. Hooked here, not in lib.rs's
    // on_window_event, so this module stays the only Rust the device bridge touches.
    if !self.hooked.swap(true, Ordering::Relaxed) {
      if let Some(w) = app.get_webview_window("main") {
        let h = app.clone();
        w.on_window_event(move |e| {
          if matches!(e, tauri::WindowEvent::Destroyed) {
            let _ = tauri::async_runtime::block_on(h.state::<Buttplug>().stop_all());
          }
        });
      }
    }
    let dcm = load_protocol_configs(&None, &None, false).and_then(|mut b| b.finish()).map_err(|e| e.to_string())?;
    let mut b = ServerDeviceManagerBuilder::new(dcm);
    {
      use buttplug_server_hwmgr_btleplug::BtlePlugCommunicationManagerBuilder;
      use buttplug_server_hwmgr_hid::HidCommunicationManagerBuilder;
      use buttplug_server_hwmgr_serial::SerialPortCommunicationManagerBuilder;
      b.comm_manager(BtlePlugCommunicationManagerBuilder::default());
      b.comm_manager(SerialPortCommunicationManagerBuilder::default());
      b.comm_manager(HidCommunicationManagerBuilder::default());
    }
    let dm = Arc::new(b.finish().map_err(|e| e.to_string())?);
    let op = Arc::new(
      ButtplugServerBuilder::with_shared_device_manager(dm.clone()).name(SERVER_NAME).finish().map_err(|e| e.to_string())?,
    );
    let rsi = RequestServerInfoV4::new(SERVER_NAME, ButtplugMessageSpecVersion::Version4, 0);
    op.parse_message(ButtplugClientMessageVariant::V4(ButtplugClientMessageV4::RequestServerInfo(rsi)))
      .await
      .map_err(|e| format!("handshake: {:?}", e))?;
    let events = dm.event_stream();
    let watch = tauri::async_runtime::spawn(async move {
      futures::pin_mut!(events);
      while let Some(ev) = events.next().await {
        match ev {
          ButtplugServerMessageV4::DeviceList(dl) => {
            let _ = app.emit("bp://devices", device_list(&dl));
          }
          ButtplugServerMessageV4::ScanningFinished(_) => {
            let _ = app.emit("bp://scanning", false);
          }
          _ => {}
        }
      }
    });
    *run = Some(Run { dm, op, watch });
    Ok(())
  }

  async fn parts(&self) -> Result<(Arc<ServerDeviceManager>, Arc<ButtplugServer>), String> {
    let run = self.run.lock().await;
    let r = run.as_ref().ok_or("the device server is not running")?;
    Ok((r.dm.clone(), r.op.clone()))
  }

  async fn scan(&self, on: bool) -> Result<(), String> {
    let (dm, _) = self.parts().await?;
    let msg = if on {
      ButtplugCheckedClientMessageV4::StartScanning(StartScanningV0::default())
    } else {
      ButtplugCheckedClientMessageV4::StopScanning(StopScanningV0::default())
    };
    dm.parse_message(msg).await.map(|_| ()).map_err(|e| format!("{:?}", e))
  }

  async fn devices(&self) -> Vec<Device> {
    let Ok((dm, _)) = self.parts().await else { return vec![] };
    let msg = ButtplugCheckedClientMessageV4::RequestDeviceList(RequestDeviceListV0::default());
    match dm.parse_message(msg).await {
      Ok(ButtplugServerMessageV4::DeviceList(dl)) => device_list(&dl),
      _ => vec![],
    }
  }

  async fn linear(&self, index: u32, feature: u32, position: u32, ms: u32) -> Result<(), String> {
    let (_, op) = self.parts().await?;
    let cmd = OutputCommand::HwPositionWithDuration(OutputHwPositionWithDuration::new(position, ms));
    op_call(&op, ButtplugClientMessageV4::OutputCmd(OutputCmdV4::new(index, feature, cmd))).await.map(|_| ())
  }

  /// Every device's stop set; Ok when the server is not running (nothing can move).
  pub async fn stop_all(&self) -> Result<(), String> {
    let Ok((_, op)) = self.parts().await else { return Ok(()) };
    op_call(&op, ButtplugClientMessageV4::StopCmd(StopCmdV4::default())).await.map(|_| ())
  }

  async fn shutdown(&self) {
    let _ = self.stop_all().await;
    let Some(run) = self.run.lock().await.take() else { return };
    run.watch.abort();
    let _ = run.op.shutdown().await;
  }
}

#[tauri::command]
pub async fn bp_start(app: AppHandle, bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.start(app).await
}

#[tauri::command]
pub async fn bp_shutdown(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.shutdown().await;
  Ok(())
}

#[tauri::command]
pub async fn bp_scan(bp: State<'_, Buttplug>, on: bool) -> Result<(), String> {
  bp.scan(on).await
}

#[tauri::command]
pub async fn bp_devices(bp: State<'_, Buttplug>) -> Result<Vec<Device>, String> {
  Ok(bp.devices().await)
}

#[tauri::command]
pub async fn bp_linear(bp: State<'_, Buttplug>, index: u32, feature: u32, position: u32, ms: u32) -> Result<(), String> {
  bp.linear(index, feature, position, ms).await
}

#[tauri::command]
pub async fn bp_stop_all(bp: State<'_, Buttplug>) -> Result<(), String> {
  bp.stop_all().await
}
