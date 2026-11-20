# Requirements and troubleshooting

What the shared (portable) build needs, and what to do when something does not work. This release is for Windows with an NVIDIA card. The facts come from the build's own README (`dev/share/README.txt`), the shell and the tracker code. Anything marked *unconfirmed* is not measured or checked in the repo.

## What you need

| | |
|---|---|
| System | Windows 10 or 11, 64-bit. No installer, no admin rights, no Python or CUDA install. |
| WebView2 | Microsoft Edge WebView2 draws the window. Windows 11 has it; on Windows 10 install the "Evergreen WebView2 Runtime" from Microsoft if the window stays blank. |
| GPU | An NVIDIA GTX 16xx / RTX 20xx or newer for the ML trackers (TAPNext++, SAM 2.1) and the taggers, with driver 580 or newer. RTX 50xx (5060 to 5090) is supported. The bundled PyTorch 2.12.1 (CUDA 13.0) covers GTX 16xx / RTX 20xx (Turing) to RTX 50xx (Blackwell). |
| Older cards | GTX 9xx, GTX 10xx and Titan V are not covered. The tracker tests your card at start and tells you when it cannot use it: a note at the top of the Tracking panel, the GPU trackers grayed out. The editor, playback and the CPU trackers still work, as with no NVIDIA GPU. |
| No NVIDIA GPU | The app starts; the editor, playback and the CPU trackers work: **Optical flow (box)**, **Template match (box)** and **Optical flow (distance between 2 points)**. TAPNext++, SAM 2.1 and the taggers need the card (TAPNext++ on 4 CPU threads: about 0.7 frames a second, some 45 minutes for a minute of video). |
| CoTracker3 | Not included: its license is non-commercial only. TAPNext++ is the point tracker. See [CoTracker3](cotracker.md). |
| Disk | About 10 GB to copy, plus about 5 GB the first start unpacks beside it (about 15 GB in all). The media cache (proxies, stills, scrub frames) takes up to 2 GiB more in `%LOCALAPPDATA%\app.pawscript.portable`. |
| Folder | On a local drive you can write to, with a short path (under about 100 characters), for example `C:\Pawscript`. Not on a network share, not inside OneDrive, Dropbox, Google Drive or iCloud (on many PCs Desktop and Documents are OneDrive): the app refuses to start there and says so. |
| RAM, CPU | *Unconfirmed*: no minimum is measured in the repo. |

### Graphics memory per tracker setting

The figures the tracker asks the card for (its own estimate: the measured peak + 15 % + 0.5 GB, chunk 8; the app caps itself to what the card has and says so when a run does not fit, it never spills into system memory):

| Setting | VRAM |
|---|---|
| TAPNext++ model 256, 512 points (the default Track, `T`) | about 3.8 GB |
| TAPNext++ model 256, 1024 points | about 4.5 GB |
| TAPNext++ model 512, 512 points | about 8 GB |
| TAPNext++ model 512, 1024 points | about 8.7 GB |
| SAM 2.1 mask (default chunk) | about 3 GB |
| Describe / Suggest (the tagger) | about 2 to 3 GB |

The model setting defaults to **auto**: 256, or 512 for a shot whose smallest painted part is under about 2.7 % of the frame across, and only when 512 fits the card (else 256, and Run details says why). A 6 GB card is enough for the 256 model; the 512 model wants about 8 GB or more.

## When something goes wrong

**Windows protected your PC.** The exe is not code-signed. Click **More info**, then **Run anyway**.

**"Copy this folder to your own drive first", or a refusal about OneDrive / Dropbox.** Move the whole Pawscript folder to a local folder outside the synced ones (for example `C:\Pawscript`) and start it again.

**The first start fails or stops.** Start it again: the setup carries on and cleans up after a failed try. If Windows Security's Controlled folder access or an antivirus blocks `Pawscript.exe`, allow it there. The window shows the error after "Details:".

**The window stays blank.** Install the Evergreen WebView2 Runtime from Microsoft.

**A video does not play, or stutters.** Use the film button under the video and make a proxy (480p is the smoothest; File menu: **Make a proxy of this video**). The tracker still reads the original. Videos Pawscript opens: mp4, m4v, mkv, webm, mov, avi.

**The Tracking panel says the graphics card cannot be used.** The tracker tried a few small GPU operations at start and this build cannot run them on your card (see Older cards above). The GPU trackers are grayed out; use the CPU trackers or another PC, and report it with Help › **Copy bug report**.

**The Tracking panel says no graphics card was found, and you have an NVIDIA card.** Update the NVIDIA driver to 580 or newer, then start Pawscript again: this build's PyTorch (CUDA 13.0) does not see the card with an older driver.

**"The graphics driver reported an error".** That job failed; the next one starts a fresh tracker. If it keeps happening, lower the points or the TAPNext++ model, or update the driver.

**A run says it does not fit on the card.** Use the default TAPNext++ model (256) or fewer points, or close what else uses the GPU (games, other ML tools). The first run of a session also loads the model, a few seconds.

**`T` does nothing.** It works in the Track tab (`Ctrl+2`) with a point tracker listed and no job running; the Track button's tooltip says why when it cannot.

**No NVIDIA card.** Track with **Optical flow (box)**: paint the moving part with Groups (`Tab`), press `Ctrl+T` (Track ROI): with no GPU it follows the part's bounds on the CPU.

**The script is upside down, or the depth is off.** See step 5 of the [quick start](quick-start.md): `F` flips, `Alt+0` / `Alt+Shift+0` anchor fully in / out.

**My `.funscript` did not change.** The project writes itself; the `.funscript` beside the video is written only by Publish, `Ctrl+Alt+S` (or `Ctrl+E`, export; `Ctrl+S` only commits inside the project). Tracked shots go into it as they play: nothing needs accepting or baking first.

**Reporting a problem.** Help › **Copy bug report** copies the build, Windows and graphics card and what went wrong, with no file names; nothing is sent by itself. Help › **About Pawscript** shows the version and build.

**Where my files are.** Settings and recent files in `%APPDATA%\app.pawscript.portable`; autosave snapshots, backups, the media cache and a daily usage log (local only) in `%LOCALAPPDATA%\app.pawscript.portable`. Projects and funscripts sit beside your videos. Help › About shows the real paths. Nothing goes online unless you press Download (Settings › Models) or Check for updates (Help).

<!-- guide-keys: test/guide-keys.test.mjs checks every line against the command registry, and that every key written in backticks above is listed here.
T = track.gridFrame
Ctrl+2 = mode.track
Ctrl+T = track.run
Tab = tracking.groups
F = track.flipAtPlayhead
Alt+0 = tracking.anchorIn
Alt+Shift+0 = tracking.anchorOut
Ctrl+S = file.save
Ctrl+Alt+S = file.publish
Ctrl+E = file.export
"Make a proxy of this video" = video.proxy
"About Pawscript" = help.about
"Copy bug report" = help.bugReport
-->
