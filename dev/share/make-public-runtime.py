"""dev/share/make-public-runtime.py -- the PUBLIC build's runtime archive (paw-vdr4): the private runtime-<date>.zip less
CoTracker3 (its `cotracker` package and dist-info: CC-BY-NC 4.0, never in a public build), copied entry by entry into a
NEW zip (streamed, every CRC checked on read and compared after), with its own runtime.stamp so an exe never takes one for
the other. The input is only read. Run it at below-normal priority:

  python -I dev/share/make-public-runtime.py dev/share/runtime/runtime-2026-11-17.zip dev/share/runtime/runtime-public-2026-11-18.zip
"""
import re
import shutil
import sys
import time
import zipfile

DROP = re.compile(r"^python/Lib/site-packages/cotracker(/|-[^/]*\.dist-info/)", re.I)
src, dst = sys.argv[1], sys.argv[2]
t0 = time.time()
with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst + ".part", "x", allowZip64=True) as b:
    old = a.infolist()
    gone = [i for i in old if DROP.match(i.filename)]
    for i in old:
        if DROP.match(i.filename):
            continue
        z = zipfile.ZipInfo(i.filename, i.date_time)
        z.compress_type, z.external_attr, z.create_system = i.compress_type, i.external_attr, i.create_system
        if i.filename == "runtime.stamp":   # "runtime <date> public python..." (the exe re-unpacks when it changes)
            b.writestr(z, re.sub(r"^(runtime \S+)", r"\1 public", a.read(i).decode().strip()) + "\n")
        elif i.is_dir():
            b.writestr(z, b"")
        else:
            with a.open(i) as r, b.open(z, "w", force_zip64=i.file_size >= zipfile.ZIP64_LIMIT) as w:
                shutil.copyfileobj(r, w, 1 << 20)
with zipfile.ZipFile(dst + ".part") as b:   # the check: every other entry there, same content (CRC), nothing of CoTracker
    new = {i.filename: i for i in b.infolist()}
    keep = [i for i in old if not DROP.match(i.filename)]
    assert len(new) == len(keep) == len(old) - len(gone), (len(new), len(keep), len(old), len(gone))
    assert all(new[i.filename].CRC == i.CRC for i in keep if i.filename != "runtime.stamp")
    assert not any("cotracker" in n.lower() for n in new), "a cotracker entry is left"
    stamp = b.read("runtime.stamp").decode().strip()
shutil.move(dst + ".part", dst)
print(f"{dst}: {len(new)} entries ({len(old)} - {len(gone)} cotracker), {sum(i.file_size for i in keep)} bytes unpacked; "
      f"stamp {stamp!r}; {time.time() - t0:.0f} s")
