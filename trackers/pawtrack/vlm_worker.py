"""The VLM worker: `pawtrack serve --role vlm` run by the VLM venv's interpreter (PAWSCRIPT_VLM_PYTHON, default
experiments/vlm/.venv), for when transformers is not importable in the sidecar's own env. Same JSONL framing as
serve; it answers director.ask only (frames decoded here, by reference). Started and killed by pawtrack/director.py.
Needs numpy, av, opencv, scipy, torch, transformers in that venv (the experiments/vlm venv has them)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pawtrack import serve  # noqa: E402

if __name__ == "__main__":
    serve.main(["--role", "vlm"])
