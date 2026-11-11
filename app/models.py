from typing import Literal

from pydantic import BaseModel, Field


DraftKind = Literal["email", "notion", "slack", "whatsapp", "spreadsheet", "airtable"]
NativeTarget = Literal["gmail", "google_sheets"]


class DraftInput(BaseModel):
    kind: DraftKind
    title: str = Field(min_length=1, max_length=240)
    context: str = Field(default="", max_length=50000)
    payload: dict
    native_target: NativeTarget | None = None
