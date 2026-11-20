"""TAPNext++ point tracker (tapnext_points): the same synthetic checks as CoTracker3. Needs the `tapnext`
extra and a CUDA GPU (skipped otherwise)."""
import pytest

from test_cli import video  # noqa: F401 (fixture)
from test_points_cotracker import check_blob, check_proj, check_rod, gpu


@gpu("tapnet")
@pytest.mark.parametrize("model", ["256", "512"])
def test_tapnext_blob(video, model):
    check_blob("tapnext_points", video, model=model)


@gpu("tapnet")
@pytest.mark.parametrize("model", ["256", "512"])
def test_tapnext_rod(tmp_path, model):
    check_rod("tapnext_points", tmp_path, model=model)


@gpu("tapnet")
def test_tapnext_proj(video):
    check_proj("tapnext_points", video, model="256")
