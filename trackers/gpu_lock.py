"""Shared VRAM budget, machine-wide.  Usage:  python trackers/gpu_lock.py [--gb N] <command> [args...]

Reserves N GB of VRAM (default 12), waits until it fits, runs the command, releases.
Several jobs run side by side as long as their reservations fit; nothing is admitted that
would push the card into system-memory fallback (everything gets ~10x slower and the
owner's Sunshine remote session suffers).

The owner's app does not take this lock. His rule (2026-11-16): "just use the gpu as long as my app
is idle": while his app's tracker is WORKING (owner_busy) nothing new is admitted; while it is idle
(a warm model it holds is counted through nvidia-smi like any other use) or not running, a job is
admitted when it fits beside what is in use plus a small desktop headroom.

Ask for what the job really peaks at, plus a little. The job must cap itself to its reservation:
  torch:        torch.cuda.set_per_process_memory_fraction(float(os.environ["PAWSCRIPT_GPU_FRACTION"]))
  onnxruntime:  provider option gpu_mem_limit = int(os.environ["PAWSCRIPT_GPU_BYTES"])
"""
import json, msvcrt, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
# .gpu.mutex is held only for the instant of a ledger update (the first version of this script
# held .gpu.lock for a whole job; jobs still running under it are seen through nvidia-smi instead)
LOCK, LEDGER = os.path.join(HERE, ".gpu.mutex"), os.path.join(HERE, ".gpu.ledger.json")
RESERVE_GB = 2.0   # headroom kept free for the desktop + Sunshine while the owner's app is idle or closed (was a flat
                   # 15 GB for his own TAPNext++ 512 / 1024-point runs, ~12.7 GB + 1.8 GB of Hydra: an overlap spills
                   # into WDDM shared memory ("stuck at loading model", 2026-11-08) or crashes with a CUDA illegal
                   # memory access, 2026-11-07; that case is now owner_busy: no admission while his tracker works)
BUSY_CPU = 0.10    # of one core, over BUSY_S: his sidecar decoding / tracking / grouping is far above, idle is ~0
BUSY_S = 0.6
MAX_JOB_GB = 16.0


def smi():
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], text=True)
    used, total = (float(x) / 1024 for x in out.strip().splitlines()[0].split(","))
    return used, total


def alive(pid):
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
    return str(pid) in out


def _cpu_s(pid):
    """CPU seconds a process has used so far (kernel + user), None when it cannot be opened."""
    import ctypes
    from ctypes import wintypes
    k = ctypes.windll.kernel32
    k.OpenProcess.restype = wintypes.HANDLE
    h = k.OpenProcess(0x1000, False, int(pid))   # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return None
    try:
        ft = [wintypes.FILETIME() for _ in range(4)]
        if not k.GetProcessTimes(wintypes.HANDLE(h), *[ctypes.byref(x) for x in ft]):
            return None
        return sum((x.dwHighDateTime << 32 | x.dwLowDateTime) for x in ft[2:]) / 1e7
    finally:
        k.CloseHandle(wintypes.HANDLE(h))


def owner_sidecars():
    """PIDs of the tracker sidecars that belong to the owner's running app: a python process whose command line
    names pawtrack and that has pawscript.exe among its ancestors (an agent's own tracker job is a child of this
    script, not of the app; the test app runs a fake sidecar). [] when the app is closed or the query fails."""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
            text=True, timeout=20, stderr=subprocess.DEVNULL)
        rows = json.loads(out)
    except Exception:
        return []
    rows = rows if isinstance(rows, list) else [rows]
    by = {r["ProcessId"]: r for r in rows}

    def under_app(pid):
        seen = set()
        while pid in by and pid not in seen:
            seen.add(pid)
            if (by[pid].get("Name") or "").lower() == "pawscript.exe":
                return True
            pid = by[pid].get("ParentProcessId")
        return False

    return [r["ProcessId"] for r in rows
            if (r.get("Name") or "").lower().startswith("python") and "pawtrack" in (r.get("CommandLine") or "").lower()
            and under_app(r["ProcessId"])]


def owner_busy():
    """Is the owner's app tracker working right now (not merely holding a warm model)? CPU use of its sidecar(s)
    over BUSY_S. Errs to False only when there is no sidecar; a sidecar that cannot be read counts as busy."""
    pids = owner_sidecars()
    if not pids:
        return False
    a = {p: _cpu_s(p) for p in pids}
    time.sleep(BUSY_S)
    for p in pids:
        b = _cpu_s(p)
        if a[p] is None or b is None or (b - a[p]) / BUSY_S > BUSY_CPU:
            return True
    return False


def ledger(update):
    """Run update(entries) -> result under the file mutex; entries = {pid: {"gb", "t"}} of live jobs."""
    with open(LOCK, "a+b") as f:
        while True:
            try:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                time.sleep(0.2)
        try:
            try:
                entries = json.load(open(LEDGER))
            except (OSError, ValueError):
                entries = {}
            entries = {p: e for p, e in entries.items() if alive(int(p))}
            result = update(entries)
            json.dump(entries, open(LEDGER, "w"))
            return result
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def fits(entries, gb, total):
    used, _ = smi()
    # a job admitted moments ago may not have allocated yet: count the unspent part of young reservations
    pending = sum(e["gb"] for e in entries.values() if not e.get("wait") and time.time() - e["t"] < 90)
    return used + pending + gb + RESERVE_GB <= total


STARVE_S = 180  # a job that has waited this long goes first: later arrivals may no longer slip past it


def main():
    args, gb = sys.argv[1:], 12.0
    if args[:1] == ["--gb"]:
        gb, args = float(args[1]), args[2:]
    if not args:
        sys.exit(__doc__)
    if gb > MAX_JOB_GB:
        sys.exit(f"gpu_lock: {gb} GB is over the {MAX_JOB_GB} GB per-job limit for this machine")
    total, me, said, t0 = smi()[1], str(os.getpid()), False, time.time()

    def admit(entries):
        # Waiters sit in the ledger too. Small jobs used to keep slipping in ahead of a big one for
        # over an hour; now anything that has waited STARVE_S blocks every later arrival until it runs.
        now = time.time()
        starving = any(e.get("wait") and e["t"] < t0 and now - e["t"] > STARVE_S for p, e in entries.items() if p != me)
        if not starving and fits(entries, gb, total):
            entries[me] = {"gb": gb, "t": now}
            return True
        entries[me] = {"gb": gb, "t": t0, "wait": True}

    while True:
        busy = owner_busy()   # outside the mutex: it takes a moment
        if not busy and ledger(admit):
            break
        if busy:
            ledger(lambda entries: entries.__setitem__(me, {"gb": gb, "t": t0, "wait": True}))
        if said != busy + 1:
            print(f"gpu_lock: waiting for {gb:g} GB of VRAM" + (" (the owner's tracker is working)" if busy else ""), file=sys.stderr, flush=True)
            said = busy + 1
        time.sleep(3)
    env = dict(os.environ, PAWSCRIPT_GPU_FRACTION=str(gb / total), PAWSCRIPT_GPU_BYTES=str(int(gb * 2**30)))
    try:
        code = subprocess.call(args, env=env)
    finally:
        ledger(lambda entries: entries.pop(me, None))
    sys.exit(code)


if __name__ == "__main__":
    main()
