"""Atomic writes for the download caches. Each download step skips files that already exist, and the notebook
checkpoints those files while the steps run, so a file must exist either complete or not at all."""
import os
from pathlib import Path


def atomic(path, write):
    """Write through `write(fileobj)` to a temporary name, then rename into place."""
    path = Path(path)
    tmp = path.with_name(path.name + ".part")
    with open(tmp, "wb") as fh:
        write(fh)
    os.replace(tmp, path)
