from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def validate_workbook_payload(payload: dict) -> None:
    sheets = payload.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        raise ValueError("Spreadsheet payload requires at least one sheet")
    for spec in sheets:
        name = spec.get("name")
        rows = spec.get("rows")
        if not isinstance(name, str) or not name or len(name) > 31:
            raise ValueError("Sheet names must contain 1 to 31 characters")
        if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
            raise ValueError("Sheet rows must be arrays of arrays")


def create_workbook(draft_id: str, payload: dict, artifacts_dir: Path) -> Path:
    sheets = payload.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        raise ValueError("Spreadsheet payload requires at least one sheet")
    workbook = Workbook()
    workbook.remove(workbook.active)
    for spec in sheets:
        name = spec.get("name")
        rows = spec.get("rows")
        if not isinstance(name, str) or not name or len(name) > 31:
            raise ValueError("Sheet names must contain 1 to 31 characters")
        if not isinstance(rows, list):
            raise ValueError("Sheet rows must be an array")
        sheet = workbook.create_sheet(name)
        for row in rows:
            if not isinstance(row, list):
                raise ValueError("Each sheet row must be an array")
            sheet.append(row)
        if rows:
            sheet.freeze_panes = "A2"
            sheet.auto_filter.ref = sheet.dimensions
            for cell in sheet[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="24483D")
                cell.alignment = Alignment(vertical="center")
        for index, column in enumerate(sheet.columns, start=1):
            width = max((len(str(cell.value or "")) for cell in column), default=8)
            sheet.column_dimensions[get_column_letter(index)].width = min(max(width + 2, 10), 42)
    workbook.calculation.fullCalcOnLoad = True
    artifacts_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    artifacts_dir.chmod(0o700)
    path = artifacts_dir / f"{draft_id}.xlsx"
    workbook.save(path)
    path.chmod(0o600)
    return path
