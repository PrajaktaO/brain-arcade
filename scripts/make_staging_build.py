#!/usr/bin/env python3
"""Build a STAGING copy of the site from this repository.

Usage:
  python3 scripts/make_staging_build.py OUT_DIR SUPABASE_URL PUBLISHABLE_KEY

What it changes in the copy (this repository is never modified):
  * points the game at the staging Supabase project (URL and publishable key only);
  * removes Google Analytics, so testing never counts as real traffic;
  * adds a small "STAGING" badge and a "[STAGING]" title prefix.

Only the three site files are copied. Never pass a secret or service-role key:
the publishable key is public by design.
"""
import pathlib
import re
import sys

SITE_FILES = ["index.html", "script.js", "style.css"]


def replace_once(text, pattern, replacement, label):
    new, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Could not find {label}; the site files changed shape. Update this script.")
    return new


def main(out_dir, url, key):
    if not url.startswith("https://") or "/" in url[8:] or not url.endswith(".supabase.co"):
        raise SystemExit("SUPABASE_URL must look like https://xxxx.supabase.co (no path).")
    if not key.startswith("sb_publishable_"):
        raise SystemExit("Only a publishable key (sb_publishable_...) may be used. Never use a secret key.")

    src = pathlib.Path(__file__).resolve().parent.parent
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    script = (src / "script.js").read_text(encoding="utf-8")
    script = replace_once(script, r'const SUPABASE_URL = "[^"]*";', f'const SUPABASE_URL = "{url}";', "SUPABASE_URL")
    script = replace_once(script, r'const SUPABASE_PUBLISHABLE_KEY = "[^"]*";', f'const SUPABASE_PUBLISHABLE_KEY = "{key}";', "SUPABASE_PUBLISHABLE_KEY")

    html = (src / "index.html").read_text(encoding="utf-8")
    html = replace_once(html, r'\s*<script async src="https://www\.googletagmanager\.com/gtag/js\?id=[^"]*"></script>', "", "Google Analytics loader")
    html = replace_once(html, r"\s*gtag\('js', new Date\(\)\);\s*gtag\('config', '[^']*'\);", "", "Google Analytics config")
    html = replace_once(html, r"<title>(.*?)</title>", "<title>[STAGING] \\1</title>".replace("\\1", "Brain Arcade — Daily Puzzle"), "title")
    badge = ('<div style="position:fixed;right:8px;bottom:8px;z-index:10;padding:4px 8px;border-radius:8px;'
             'background:#20243a;color:#fff;font:700 11px sans-serif">STAGING</div>')
    html = replace_once(html, r"<body>", "<body>\n  " + badge, "body tag")

    (out / "script.js").write_text(script, encoding="utf-8")
    (out / "index.html").write_text(html, encoding="utf-8")
    if (src / "og-image.png").exists():
        (out / "og-image.png").write_bytes((src / "og-image.png").read_bytes())
    (out / "style.css").write_text((src / "style.css").read_text(encoding="utf-8"), encoding="utf-8")
    (out / "README.md").write_text(
        "# brain-arcade-staging\n\nTest copy of the Brain Arcade site, built from the `v2-development` branch of "
        "`brain-arcade` by `scripts/make_staging_build.py`. It talks to the staging Supabase project and has no "
        "analytics. Generated files: do not edit by hand.\n",
        encoding="utf-8",
    )
    print("Staging build written to", out)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
