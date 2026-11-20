"""paw-k393: a penis group's knot SECTION (g.knot, the knot brush since v4.54) trains the seeder's knot class, from an image label and from
a project frame alike; the penis label keeps its whole mask (knot included), as the old separate knot labels lay inside their penis."""
from pawtrack import seeder

from test_seeder import G, box_mask, rle, write_proj
from test_seeder_images import grp, label, make_image


def _parts(groups):
    return {(g["who"], g["part"]): g["mask"] for g in groups}


def test_image_label_section_is_the_knot_class(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    a, b = make_image(tmp_path / "a.png"), make_image(tmp_path / "b.png")
    pen = (.1, .2, .5, .4)
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c1_penis", pen, knot=rle(box_mask(.1, .2, .2, .4)))])
    label(labels, "ibbbbbbbbbbbbbb", b, [grp("c1_penis", pen)])   # no section: no knot
    fr, _ = seeder.image_labels(str(labels))
    p = _parts(fr[0]["groups"])
    assert sorted(p) == [("c1", "knot"), ("c1", "penis")]
    assert (p[("c1", "penis")] == box_mask(*pen)).all(), "the penis mask is unchanged (knot included)"
    assert (p[("c1", "knot")] == box_mask(.1, .2, .2, .4)).all()
    assert sorted(_parts(fr[1]["groups"])) == [("c1", "penis")]


def test_section_is_clipped_to_the_penis_and_the_fingerprint_follows_it(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    a = make_image(tmp_path / "a.png")
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c2_penis", (.3, .3, .6, .5))])
    f0 = seeder.fingerprint(seeder.image_labels(str(labels))[0])
    label(labels, "iaaaaaaaaaaaaaa", a, [grp("c2_penis", (.3, .3, .6, .5), knot=rle(box_mask(.2, .3, .4, .5)))])
    fr, _ = seeder.image_labels(str(labels))
    k = _parts(fr[0]["groups"])[("c2", "knot")]
    assert (k == box_mask(.3, .3, .4, .5)).all(), "never outside the penis"
    assert seeder.fingerprint(fr) != f0, "a new knot section retrains"


def test_project_frame_section_is_the_knot_class(tmp_path):
    p = write_proj(tmp_path / "a.pawproj", [G("c1_penis", (.1, .2, .5, .4), source="user", knot=rle(box_mask(.4, .2, .5, .4)))])
    fr, _ = seeder.project_labels(p)
    assert sorted(_parts(fr[0]["groups"])) == [("c1", "knot"), ("c1", "penis")]
