"""Every test starts with the optional taggerine pack 'not installed' (pawtrack/taggerine.py WEIGHTS pointing nowhere), so a developer machine
that has the 5 GB pack and a GPU still runs the seeder tests on the built-in Hydra source. Tests that need the pack patch it back."""
import pytest

from pawtrack import taggerine


@pytest.fixture(autouse=True)
def no_taggerine_pack(tmp_path, monkeypatch):
    monkeypatch.setattr(taggerine, "WEIGHTS", tmp_path / "no-pack" / "tagger_proto.safetensors")
