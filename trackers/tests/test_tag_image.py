"""PROTOCOL v4.40: tag_image's pure side (count_scores) and the command table (the tagger itself needs the GPU)."""
from pawtrack import cli, describe


def test_count_scores_keeps_count_tags_and_best_pairings():
    names = ["solo", "duo", "trio", "group", "male/male", "male/female", "female/female", "cat", "a/b", "duo_focus"]
    probs = [0.1, 0.9, 0.0, 0.0, 0.3, 0.8, 0.2, 0.99, 0.99, 0.5]
    out = describe.count_scores(names, probs, top=2)
    assert out["duo"] == 0.9 and out["solo"] == 0.1 and out["duo_focus"] == 0.5
    assert set(out) - set(describe.COUNT_TAGS) == {"male/female", "male/male"}   # top 2; "cat" and "a/b" are not pairings
    assert "cat" not in out and "a/b" not in out


def test_tag_image_is_a_command_and_validates():
    assert "tag_image" in cli.COMMANDS
    import pytest
    with pytest.raises(ValueError):
        cli.cmd_tag_image({}, lambda e: None)
