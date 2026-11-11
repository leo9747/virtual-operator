def qa_url(page) -> str:
    """Require an explicitly managed test server; never fall back to the live service."""
    return getattr(page, "_qa_origin")


def sign_in(page):
    """Use the synthetic key through the actual access form, never a credential bootstrap."""
    if page.locator(".app-shell").count() > 0:
        return
    page.get_by_label("Local access key", exact=True).fill("isolated-browser-qa-key")
    page.get_by_role("button", name="Open console", exact=True).click()
    page.locator(".app-shell").wait_for(state="visible")
