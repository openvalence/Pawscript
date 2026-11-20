"""The frontend re-derive's parity fixture (rederive_fixture.py) still matches the sidecar's projection maths."""
import json

import numpy as np

from rederive_fixture import OUT, build


def test_fixture_matches_sidecar():
    got, ref = build(), json.loads(OUT.read_text())
    for variant in ("auto", "custom"):
        for k, pairs in ref[variant]["channels"].items():
            a = np.array([np.nan if v is None else v for _, v in got[variant]["channels"][k]], float)
            b = np.array([np.nan if v is None else v for _, v in pairs], float)
            assert np.array_equal(np.isnan(a), np.isnan(b)), k
            assert np.allclose(a[~np.isnan(a)], b[~np.isnan(b)], rtol=1e-6, atol=1e-9), (variant, k)
