"""Shared build only (paw-i7s): the bundled Python never goes online.

dev/share/build-nas.ps1 puts this file at trackers/sitecustomize.py of the shared build. The bundled interpreter's
python/Lib/site-packages/pawtrack.pth puts trackers/ on sys.path, so Python imports this at every start (also under -I),
whatever started it (the app's sidecar, a tracker subprocess, a hand-run command). It is not part of the dev checkout.

Every model loader that fetches a missing file (sam2_mask, tapnext_points, describe: plain urllib) and
anything Hugging Face based is stopped here: a connection to anything but this machine raises OSError with a message
that names the fix (a missing model file: copy the Pawscript folder again). Loopback stays allowed.
"""
import os
import socket

for _k in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
    os.environ[_k] = "1"
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "*"  # never hand a request to a proxy on loopback (it would go online)

_LOCAL = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "::", ""}


def _refuse(host):
    raise OSError(f"Pawscript (shared build) never goes online; blocked a connection to {host}. "
                  "A model file is probably missing from trackers\\.cache or trackers\\.models: copy those folders "
                  "from the download again (see README.txt).")


def _local(host):
    h = str(host).strip("[]").lower()
    return h in _LOCAL or h.startswith("127.")


_getaddrinfo = socket.getaddrinfo


def _guarded_getaddrinfo(host, *a, **k):
    if host is not None and not _local(host if isinstance(host, str) else host.decode("ascii", "replace")):
        _refuse(host)
    return _getaddrinfo(host, *a, **k)


_connect, _connect_ex = socket.socket.connect, socket.socket.connect_ex


def _check(sock, address):
    if sock.family in (socket.AF_INET, socket.AF_INET6) and isinstance(address, tuple) and not _local(address[0]):
        _refuse(address[0])


def _guarded_connect(self, address):
    _check(self, address)
    return _connect(self, address)


def _guarded_connect_ex(self, address):
    _check(self, address)
    return _connect_ex(self, address)


socket.getaddrinfo = _guarded_getaddrinfo
socket.socket.connect = _guarded_connect
socket.socket.connect_ex = _guarded_connect_ex
