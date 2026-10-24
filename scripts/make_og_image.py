#!/usr/bin/env python3
"""Generate og-image.png (1200x630), the link preview card. Usage: python3 scripts/make_og_image.py [OUT]"""
import pathlib, sys
from playwright.sync_api import sync_playwright

HTML = """<html><body style="margin:0;width:1200px;height:630px;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:linear-gradient(135deg,#ece9fb,#f8f6ff);font-family:'Helvetica Neue',Arial,sans-serif;color:#2b2550">
<div style="font-size:150px;line-height:1">🧠 🧩</div>
<div style="font-size:92px;font-weight:800;margin-top:24px">Brain Arcade</div>
<div style="font-size:42px;margin-top:18px;color:#5b50a8">One puzzle a day. Three attempts.</div>
<div style="font-size:34px;margin-top:34px;padding:12px 36px;border-radius:40px;background:#6a5acd;color:#fff;font-weight:700">Can you beat your friends?</div>
</body></html>"""

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent / "og-image.png")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1200, "height": 630})
    pg.set_content(HTML); pg.screenshot(path=str(out)); b.close()
print("wrote", out)
