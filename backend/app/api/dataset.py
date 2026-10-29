from fastapi import APIRouter, HTTPException, Path, status

from app.core.config import settings
from app.schemas.dataset import DatasetSummary, SampleIn, SampleOut, Sign
from app.services import dataset

# Dev-only (mounted when ENABLE_DEV_TOOLS is true): used to build the training set on a developer machine.
router = APIRouter(prefix="/dataset", tags=["dataset"])

SLUG = r"^[a-z0-9_-]{1,32}$"


@router.get("/vocabulary")
def vocabulary() -> list[Sign]:
    return dataset.load_vocabulary()


@router.get("/summary")
def summary() -> DatasetSummary:
    return dataset.summarize(settings.dataset_dir)


@router.post("/samples", status_code=status.HTTP_201_CREATED)
def create_sample(sample: SampleIn) -> SampleOut:
    if sample.sign not in {s.id for s in dataset.load_vocabulary()}:
        raise HTTPException(status_code=422, detail=f"unknown sign '{sample.sign}'")
    sample_id = dataset.save_sample(sample, settings.dataset_dir)
    return SampleOut(id=sample_id, sign=sample.sign, signer=sample.signer)


@router.delete("/samples/{sign}/{signer}/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sample(
    sign: str = Path(pattern=SLUG),
    signer: str = Path(pattern=SLUG),
    sample_id: str = Path(max_length=40),
) -> None:
    if not dataset.delete_sample(settings.dataset_dir, sign, signer, sample_id):
        raise HTTPException(status_code=404, detail="sample not found")
