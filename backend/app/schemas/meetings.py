from datetime import datetime

from pydantic import BaseModel

from app.models import MeetingStatus


class MeetingOut(BaseModel):
    code: str
    status: MeetingStatus
    host_name: str
    is_host: bool
    created_at: datetime
