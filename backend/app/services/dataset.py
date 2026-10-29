import json
import re
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from app.core.config import settings
from app.schemas.dataset import DatasetSummary, SampleIn, Sign

SAMPLE_ID = re.compile(r"^[0-9]{8}T[0-9]{6}_[0-9a-f]{8}$")


@lru_cache
def load_vocabulary() -> list[Sign]:
    data = json.loads(settings.vocabulary_file.read_text(encoding="utf-8"))
    return [Sign(**s) for s in data["signs"]]


def save_sample(sample: SampleIn, root: Path) -> str:
    now = datetime.now(UTC)
    sample_id = f"{now:%Y%m%dT%H%M%S}_{uuid.uuid4().hex[:8]}"
    folder = root / sample.sign / sample.signer
    folder.mkdir(parents=True, exist_ok=True)
    record = {"id": sample_id, "recordedAt": now.isoformat(), **sample.model_dump()}
    (folder / f"{sample_id}.json").write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
    return sample_id


def delete_sample(root: Path, sign: str, signer: str, sample_id: str) -> bool:
    if not SAMPLE_ID.match(sample_id):
        return False
    path = root / sign / signer / f"{sample_id}.json"
    if not path.is_file():
        return False
    path.unlink()
    return True


def summarize(root: Path) -> DatasetSummary:
    counts: dict[str, dict[str, int]] = {}
    total = 0
    if root.is_dir():
        for sign_dir in (d for d in root.iterdir() if d.is_dir()):
            for signer_dir in (d for d in sign_dir.iterdir() if d.is_dir()):
                n = sum(1 for _ in signer_dir.glob("*.json"))
                if n:
                    counts.setdefault(sign_dir.name, {})[signer_dir.name] = n
                    total += n
    return DatasetSummary(total=total, counts=counts)
