"""The training queue: which setting the tuning stage picks, and that every run has its own output."""
from plume.queue import MIN_GAIN, TUNE, final_jobs, pick, tune_jobs


def test_pick_keeps_the_base_unless_clearly_beaten():
    assert pick({"base": [0.30, 0.50], "h128": [0.299, 0.499]}) == "base"          # better, but within MIN_GAIN
    assert pick({"base": [0.30, 0.50], "h128": [0.30, 0.48], "l3": [0.28, 0.48]}) == "l3"
    assert pick({"base": [0.30, 0.50], "h128": [0.35, 0.55]}) == "base"
    assert 0 < MIN_GAIN < 0.1


def test_job_tags_are_unique_and_cover_the_suite():
    tags = [t for t, _, _ in tune_jobs() + final_jobs([])]
    assert len(tags) == len(set(tags))
    assert len(tune_jobs()) == 2 * len(TUNE) and TUNE["base"] == []
    for want in ("eu_wind_s0", "as_wind_s2", "sh_wind_s1", "eu_winter_s0", "as_winter_s2", "eu_none_s1", "as_dist_s2", "eu_unseen_s0"):
        assert want in tags


def test_chosen_setting_reaches_every_final_run():
    for _, cmd, _ in final_jobs(["--hidden", "128"]):
        assert cmd[-2:] == ["--hidden", "128"]
    winter = [cmd for tag, cmd, _ in final_jobs([]) if "_winter_" in tag]
    assert len(winter) == 6 and all(cmd[cmd.index("--scheme") + 1] == "winter" for cmd in winter)
