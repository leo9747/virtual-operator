"""Private synthetic saved drafts for browser QA; never reads live operator files."""
from pathlib import Path

from openpyxl import Workbook


def create_saved_review_fixture() -> Path:
    root = Path(__file__).resolve().parent / "output" / "saved-review-source"
    if root.is_symlink():
        raise RuntimeError("Synthetic review fixture cannot be a symbolic link")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    files = {
        "alpha.md": "# Synthetic Alpha\n\n**A safe local draft for browser review.**\n\n- [ ] Check the source before acting.\n- [x] Preserve a local-only record.\n\n[Example citation](https://example.com/review?a=1&b=2)\n\nUntrusted strings stay text: <script>window.__unsafeScriptRan = true</script>\n\n[An unsafe link stays text](javascript:alert('not executed'))\n",
        "tone-prompt.md": "# Synthetic tone prompt\n\nBe concise, warm and specific. Do not send the example.\n",
        "tone-analysis.md": "# Synthetic tone analysis\n\nAggregate QA evidence only; no real mail is present.\n",
        "inventory.csv": 'Task,Comment\nqa-1,"Intro, with comma"\nqa-2,"First line\nSecond line"\n',
        "placeholder.md": "# Empty placeholder\n\nNo substantive source brief was available.\n",
    }
    for name, text in files.items():
        path = root / name
        path.write_text(text, encoding="utf-8")
        path.chmod(0o600)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Evidence"
    sheet.append(["Item", "Comment", "Amount"])
    sheet.append(["Alpha", "Comma, retained", 100])
    sheet.append(["Stored formula, not evaluated", "=1+1", None])
    sheet = workbook.create_sheet("Next steps")
    sheet.append(["Owner", "Action"])
    sheet.append(["Leo", "Confirm source before any external action"])
    workbook.save(root / "payments.xlsx")
    (root / "payments.xlsx").chmod(0o600)
    rows = [
        ("Synthetic Alpha [Priority: P0; due: 2026-11-12]", "https://app.notion.com/p/synthetic-alpha", "alpha.md", "completed", "A question containing an escaped \\| pipe"),
        ("Synthetic tone job", "Not applicable; local sources only", "tone-prompt.md<br>tone-analysis.md", "completed", "Two local documents"),
        ("Synthetic inventory", "https://app.notion.com/p/synthetic-inventory", "inventory.csv", "blocked", "A missing test source"),
        ("Synthetic payments [Priority: P1; due: unscheduled]", "https://app.notion.com/p/synthetic-payments", "payments.xlsx", "blocked", "Evidence required"),
        ("Synthetic empty placeholder [Priority: P3; due: unscheduled]", "https://app.notion.com/p/synthetic-placeholder", "placeholder.md", "skipped", "Nothing to infer"),
    ]
    rendered_rows = []
    prefix = Path("/private/qa-not-used/operator-drafts")
    for title, source, paths, status, blocker in rows:
        absolute_paths = "<br>".join(str(prefix / name) for name in paths.split("<br>"))
        rendered_rows.append("| " + " | ".join((title, source, absolute_paths, status, blocker)) + " |")
    index = "# Synthetic saved drafts\n\n| Task title | Notion URL | Local output path | Status | Blocker/open question |\n|---|---|---|---|---|\n" + "\n".join(rendered_rows) + "\n"
    index = index.replace(str(prefix), str(root))
    (root / "INDEX.md").write_text(index, encoding="utf-8")
    (root / "INDEX.md").chmod(0o600)
    hidden = root / ".work"
    if hidden.is_symlink():
        raise RuntimeError("Synthetic support directory cannot be a symbolic link")
    hidden.mkdir(mode=0o700, exist_ok=True)
    hidden.chmod(0o700)
    (hidden / "private.json").write_text('{"live_data": "must not appear"}\n', encoding="utf-8")
    (hidden / "private.json").chmod(0o600)
    return root
