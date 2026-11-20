# Device playback

The Device panel (right dock, `Device` tab) plays the stroke axis on a machine in sync with the video: the playhead
drives it, rate changes and seeks are followed, pause stops it. Two outputs: a toy through the built-in Buttplug server
(`Device` section), or a **Valence hub** (`Valence hub` section). A live Valence hub with control is used ahead of a
Buttplug device. Nothing moves until you connect **and** turn on `Play on device with the video` (`Ctrl+Alt+D`);
neither is remembered across launches.

The `Playback` section applies to both: latency offset (`+` = the machine moves later), range (the share of the
stroke the script uses), invert, follow scrubbing while paused. `Shift+Esc` (or `Pause`) is the panic stop from
anywhere, text fields included.

## Buttplug

`Connect` starts the in-process server and scans Bluetooth LE, serial and HID; pick a device with a position axis.
Close Intiface Central first: a device it holds is invisible here. Moves are held to the device profile's speed and
message gap (`Profile` section); the planner profile `nucleus-capstan` is not speed-limited.

## Valence hub

Valence is the OpenValence hub-and-spoke protocol for machines (Nucleus, its `neutrino-sim` twin). Pawscript is a
Valence client: it connects over WebSocket, adopts the hub's catalog and safety state, and streams the script as timed
segments the hub plans itself.

1. Type the hub's address and port (Nucleus: port `82`) and press `Connect` (or the command `playback.valence`,
   menu Play). `Link` reads `Connecting…`, `Syncing…` (catalog), then `Live`. Address and port are remembered.
2. `Access` starts at `watch`: you see the machine but cannot drive it. Press `Request control`; approve the request
   from the hub's own app (or press the hub's pair control: in a push-to-pair window it is granted at once). The token
   is remembered per address and port, so the next connect is `control` straight away.
3. Turn on `Play on device with the video` and play. `Stream` shows the granted rate and the lead; the status bar
   chip reads `Valence · playing`.

**What is sent.** Each span between two points is one segment `{target, duration, end velocity}` on the hub's motion
segments stream, found in its catalog by role. `target = pos / 100` through the range and invert settings, so
**pos 0 (deepest) plays at the window's 0 end** (`window.min`, the home end) and 100 at the far end: the same
convention as Phosphor's player and MultiFunPlayer. If your machine is mounted the other way, use `Invert` (or the
hub's own flip). The end velocity is the script's smooth tangent through a point that continues in the same
direction, and rest at a reversal, a hold, a gap over 0.5 s or the end. The hub owns the kinematics: it clamps to its
window and its speed, acceleration and jerk limits; Pawscript limits nothing itself on this path.

**Timing.** Segments are stamped 100 ms ahead of hub time plus the hub's declared scheduling latency; that sum is the
`lead`, and the script is sent that much early so the machine moves on the frame. Use `Latency offset` to trim by eye.

**What is shown is the hub's word.** `Position` and the thin mark in the Live meter are the machine's reported
position against its reported window, dimmed once older than a second; `–` means the hub sent nothing. `Refused`
shows the hub's last refusal (for example `SOURCE_CONFLICT` when something else owns the rail).

**Safety.**

- `Pause` / `Resume` is one control: Pause latches the hub's PAUSE (it stops and holds; any session may pause),
  Resume clears it. Pawscript never resumes on its own.
- The stop control reads `E-Stop` on a hub that cuts motor power, `Halt` on one that brakes. Press latches it
  (`Halted`); hold it for 3 s to release, which lands in PAUSE (then Resume).
- The panic stop (`Shift+Esc`) also pauses the hub.
- Pausing the video sends one short stop segment and then nothing; the hub settles and releases the rail after
  half a second. If the link drops, playback turns off and the hub settles on its own; the link reconnects by
  itself but never restarts motion: turn playback on again.

Not supported yet: hub discovery (type the address), PIN pairing, the samples stream, the oscillator axes (`V8` /
`V9`), multi-axis.
