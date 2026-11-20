PAWSCRIPT (early access)
========================

Pawscript is a funscript editor and semi-automatic scripter: open a video, let the trackers follow the motion, fix
what they got wrong, and play the result on your device. Published by OpenValence. Free, and always will be.

For adults (18+) only. Using Pawscript means you accept TERMS.txt (short: no warranty, devices at your own risk, the
panic stop is Shift+Esc or Pause, what you make is yours, nothing leaves your PC).

New here? Press F1 in the app for the quick start, from a video to a written .funscript. The whole guide is in the
Guide folder beside this file (plain text: quick-start.md first, requirements.md when something does not work).


WHAT YOU NEED
-------------
- Windows 10 or 11, 64-bit. No installer, no admin rights, no Python or CUDA install.
- An NVIDIA GTX 16xx / RTX 20xx or newer for the ML trackers, with driver 580 or newer. RTX 50-series cards (5060 ...
  5090) are supported. About 6 GB of video memory is the floor for the default settings.
  Older cards (GTX 9xx, GTX 10xx, Titan V) are not covered: the tracker tests your card at start and tells you when it
  cannot use it; the editor, playback and the CPU trackers still work.
- About 15 GB of free disk space (the folder, plus what its first start unpacks).
- The folder on a local drive, in a folder of its own, with a short path, and NOT inside OneDrive, Dropbox, Google
  Drive or iCloud (on many PCs Desktop and Documents ARE OneDrive). Good: C:\Pawscript or D:\Pawscript.


GETTING IT
----------
Two ways, both from https://github.com/openvalence/Pawscript:
- The small download: one zip. Extract it into a folder of its own (below) and start Pawscript.exe: its first start
  asks which models you want and where to keep them, then downloads the runtime (Python, PyTorch, ffmpeg; 2.3 GB) and
  those models, checks every file and sets itself up. An interrupted download carries on at the next start.
- The full folder, for a PC without internet or to pass on by hand: everything already inside, nothing is downloaded.
  The steps for it follow. The three biggest files come in parts
(downloads stop at 2 GB a file): runtime.zip.001 and .002, tapnextpp_ckpt.pt.001 and .002, tapnextpp_512.ckpt.001
and .002. Download every part and keep them all beside Pawscript.exe, with parts.txt, which lists them.

1. Put the whole Pawscript folder somewhere like C:\Pawscript (see above).
2. Double-click Pawscript.exe.
   SmartScreen: the exe is not code-signed. If Windows says "Windows protected your PC", click More info -> Run anyway.
3. The first start sets itself up once: the window says "Setting up, one time: checking the files" while it joins
   the parts back into runtime.zip and the two TAPNext++ models, checks them, and deletes the parts (in place: no
   second copy on the disk). Then it says "unpacking the runtime" for about a minute (longer on a slow disk) while it unpacks
   runtime.zip and code.zip into the folder, and deletes runtime.zip. Every later start is immediate.
   A part missing, cut off or damaged in the download: the window names it. Download that part again, put it beside
   Pawscript.exe and start Pawscript again; it carries on where it stopped.

Pawscript refuses to start from a network share, a folder it cannot write, or a synced folder, and says so.

If setup fails:
- Start Pawscript again: the setup carries on by itself and cleans up after a failed try.
- Still failing: move the folder to C:\Pawscript and start it again.
- If Windows Security's "Controlled folder access" or an antivirus blocks Pawscript.exe, allow it there.
- If the window stays blank, install the "Evergreen WebView2 Runtime" from Microsoft (Windows 11 already has it).
- Still stuck: report it (below) with the line after "Details:" in the window.


YOUR PROJECTS
-------------
Nothing to save by hand: everything you do is written beside the video about a second after you do it:
  <video name>.pawproj      the project
  <video name>.pawruns      the tracker runs (can be about 120 MB)
  <video name>.pawhistory\  undo history, checkpoints and commits
Keep these with the video. Ctrl+S makes a commit (a point you can go back to, with a note). The .funscript beside the
video is written only when you Publish (Ctrl+Alt+S): v1, v2, ...


REPORTING A PROBLEM
-------------------
Help > Copy bug report (also on the crash screen) copies what went wrong, with your version, Windows and graphics
card, to the clipboard; nothing is sent by itself. It contains no file names, paths, project names or tags. Paste it
into a new issue at https://github.com/openvalence/Pawscript/issues (issues there are public), with what you did just before.


UPDATING
--------
Help > Check for updates: shows what is new; Download and install replaces Pawscript.exe and code.zip in this folder,
then Restart (it writes your projects first). A new runtime, when a version needs one, is downloaded at its first start.
By hand also works: close Pawscript and copy the new files over the ones in your folder. VERSION.txt says which build
you have. Your settings, projects and models are never touched.


WHERE YOUR DATA IS
------------------
- Projects and funscripts: beside your videos (above).
- Settings, recent projects, window position: %APPDATA%\app.pawscript.portable
- Logs that never leave your PC (usage, fix log, feedback notes), the part finder's labels, thumbnails, autosaves,
  media cache and the app window's browser data: %LOCALAPPDATA%\app.pawscript.portable
- Nothing goes online unless you ask: Download (the runtime and the models you pick, from the Pawscript models server)
  and Check for updates (Help menu; at start only if you turn it on). The bundled Python cannot open a network
  connection at all. The other connection is to a Valence hub, if you set one up yourself. TERMS.txt has the full list.
- The models: next to the app in trackers\.cache and trackers\.models, or in the folder you chose (Settings > Models).

Uninstall: delete the Pawscript folder, and for your settings and logs too, the two folders above.


WHAT'S IN THE FOLDER
--------------------
Pawscript.exe               the app
runtime.zip.001, .002       Python 3.12 + PyTorch 2.12.1 (CUDA 13.0) + ffmpeg / ffprobe 8.1.1 (gyan.dev, GPL);
                            joined into runtime.zip and unpacked by the first start into python\, ffmpeg.exe, ffprobe.exe
                            (runtime.zip is deleted once unpacked)
code.zip                    the tracker code; unpacked into trackers\pawtrack
trackers\.cache, .models    model weights: SAM 2.1, TAPNext++, Hydra 3.5
tapnextpp_ckpt.pt.001, .002, tapnextpp_512.ckpt.001, .002
                            the two TAPNext++ models in parts; joined into trackers\.cache\tapnext by the first start
parts.txt                   which files come in parts, with their sizes and checksums
Guide\                      the user guide (Markdown; quick-start.md, requirements.md, ...)
.setup\                     made by the first start: which runtime.zip / code.zip are unpacked
VERSION.txt                 which build you have
LICENSE, NOTICE, TERMS.txt  Pawscript's licence (GPL-3.0-or-later) and terms
LICENSES\, LICENSES-SUMMARY.txt   everyone else's licences


KNOWN LIMITS
------------
- With no NVIDIA card the app still runs: editor, playback and the classic trackers (Optical flow, Template match)
  work on the processor; SAM 2.1, TAPNext++ and the tagger need the card.
- CoTracker3 is not included (its licence is non-commercial only); TAPNext++ is the point tracker. Support as a
  separate add-on may come later: Guide\cotracker.md.
- Each tracker run loads its model first (a few seconds).
- Video memory: the default tracker settings use about 4 GB; the 512 TAPNext model (picked by itself for very small
  parts, when it fits) about 8-9 GB. The app caps itself to your card and says when something does not fit.
- Moving the whole folder is fine; do not move files inside it.
- Device playback and the Valence hub link are early: keep the panic stop (Shift+Esc or Pause) in mind.


LICENCE
-------
Pawscript is free and always will be. It is licensed under the GPL: anyone may share it, nobody may make it closed.
If someone sold it to you, you can get it free here: https://github.com/openvalence/Pawscript
Source code, including the written offer for the GPL parts made by others: TERMS.txt, section 8.
