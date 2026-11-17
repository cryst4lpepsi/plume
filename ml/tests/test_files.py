"""Download caches are written atomically: a failed write leaves no file that a resumed run would skip."""
import numpy as np
import pytest
from plume_data.files import atomic


def test_atomic_writes_whole_files(tmp_path):
    f = tmp_path / "x.npz"
    atomic(f, lambda fh: np.savez_compressed(fh, a=np.arange(3)))
    assert np.load(f)["a"].tolist() == [0, 1, 2] and not (tmp_path / "x.npz.part").exists()


def test_failed_write_leaves_no_file(tmp_path):
    f = tmp_path / "y.npy"
    def boom(fh):
        fh.write(b"half")
        raise OSError("disk full")
    with pytest.raises(OSError):
        atomic(f, boom)
    assert not f.exists()
