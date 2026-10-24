"""Headless-browser tests for the share feature, with the Supabase function mocked.

Run from the repository root:  python3 tests/test_share.py
Needs Python with the playwright package and a Chromium browser. Not part of the website.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(tempfile.gettempdir(), "brain-arcade-shots")
os.makedirs(SHOTS, exist_ok=True)
PORT = 8765
BASE = f"http://localhost:{PORT}/"
results = []
TODAY = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if (detail and not condition) else ""))


def snapshot(**kw):
    base = dict(puzzleDate="2026-10-19", category="Wordplay", question="What has keys but cannot open locks?",
                attempts=0, hintsUsed=0, completed=False, solved=False, elapsedSeconds=5)
    base.update(kw)
    return base


SOLVED = dict(completed=True, solved=True, correct=True, answer="A piano", explanation="Keys of a piano.")


def make_context(browser, steps, init_script=None, storage=None, viewport=None):
    ctx = browser.new_context(viewport=viewport or {"width": 1024, "height": 800}, permissions=["clipboard-read", "clipboard-write"])
    if init_script:
        ctx.add_init_script(init_script)
    if storage:
        ctx.add_init_script("; ".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)})" for k, v in storage.items()))
    page = ctx.new_page()
    queue = {k: list(v) for k, v in steps.items()}
    calls = []

    def handle(route):
        req = route.request
        if req.method == "OPTIONS":
            route.fulfill(status=200, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
            return
        body = json.loads(req.post_data or "{}")
        action = body.get("action")
        calls.append(body)
        data = queue[action].pop(0) if queue.get(action) else {"error": "unexpected call"}
        status = 200 if "error" not in data else 500
        route.fulfill(status=status, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(data))

    page.route("**/functions/v1/swift-task", handle)
    page.route("**/www.googletagmanager.com/**", lambda r: r.abort())
    page.on("pageerror", lambda e: check("no page errors", False, str(e)))
    return ctx, page, calls


def play_to_solution(page, solved=True):
    page.goto(BASE)
    page.click("#start-button")
    page.wait_for_selector("#game-screen:not([hidden])")
    page.fill("#answer-input", "piano")
    page.click("#submit-button")
    page.wait_for_selector("#completion-screen:not([hidden])")


server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--directory", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---- A. solved: default choice, switching, copy ----
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)],
        })
        play_to_solution(page)
        check("A1 share panel visible after a solve", page.is_visible("#share-panel"))
        check("A2 default is my result", page.is_checked('input[value="result"]'))
        preview = page.inner_text("#share-preview")
        full = "🧠 🧩 Brain Arcade #6\n\nI solved it in 2 tries with 1 hint, taking 02:14. Can you beat that?\n\n" + BASE + "?d=2026-10-19&a=2&h=1&t=134"
        check("A3 result preview has tries, hints and time", preview == full, repr(preview))
        check("A4 attempts and time are no longer separate choices", page.locator('input[value="time"], input[value="attempts"]').count() == 0)
        check("A6 native share button hidden when unsupported", not page.is_visible("#share-button"))
        check("A7 copy button is the primary action when sharing unsupported", "primary-button" in page.get_attribute("#copy-button", "class"))
        page.click("#copy-button")
        page.wait_for_function("document.getElementById('share-status').textContent.length > 0")
        copied = page.evaluate("navigator.clipboard.readText()")
        check("A8 clipboard text has message and a link carrying the time", copied == full, repr(copied))
        check("A9 copied status shown", "Copied" in page.inner_text("#share-status"))
        check("A10 answer and explanation never in share text", "piano" not in copied.lower() and "keys" not in copied.lower())
        radios = page.get_by_role("radio").all()
        check("A11 radios have accessible names", [r.evaluate("e => e.labels[0].innerText") for r in radios] == ["My result", "My record"])
        page.focus('input[value="result"]')
        page.keyboard.press("ArrowRight")
        check("A12 keyboard arrow changes choice", page.is_checked('input[value="record"]'))
        page.screenshot(path=os.path.join(SHOTS, "desktop_completion.png"), full_page=True)
        ctx.close()

        # ---- B. failed puzzle: share the puzzle only, no result ----
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=3, completed=True, solved=False, correct=False, answer="A piano", explanation="x")],
        })
        play_to_solution(page)
        check("B1 share panel shown when unsolved", page.is_visible("#share-panel"))
        check("B2 no result choice offered when unsolved", [l.strip() for l in page.eval_on_selector_all(".choice:not([hidden])", "els => els.map(e => e.innerText)")] == ["Puzzle only", "My record"])
        preview = page.inner_text("#share-preview")
        check("B3 puzzle-only preview", preview == "🧠 🧩 Brain Arcade #6\n\nI couldn't crack this one. Can you?\n\n" + BASE + "?d=2026-10-19", repr(preview))
        check("B4 note says no result shared", "No result is shared" in page.inner_text("#share-note"))
        page.click("#copy-button")
        page.wait_for_function("document.getElementById('share-status').textContent.length > 0")
        copied = page.evaluate("navigator.clipboard.readText()")
        check("B5 copied text matches preview, no answer", copied == preview and "piano" not in copied.lower(), repr(copied))
        ctx.close()

        # ---- C. reload of a completed puzzle restores the panel ----
        ctx, page, calls = make_context(browser, {
            "start": [snapshot(attempts=1, hintsUsed=0, elapsedSeconds=61, **SOLVED)],
        }, storage={"brainArcadeSessionId": "11111111-1111-4111-8111-111111111111"})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#completion-screen:not([hidden])")
        check("C1 panel visible after reload of a solved puzzle", page.is_visible("#share-panel"))
        check("C2 result is the default after reload", page.is_checked('input[value="result"]'))
        check("C3 result preview after reload", "01:01" in page.inner_text("#share-preview") and "1 try with no hints" in page.inner_text("#share-preview"))
        ctx.close()

        # ---- D. singular and plural wording ----
        for attempts, hints, expected in [(1, 0, "in 1 try with no hints"), (3, 2, "in 3 tries with 2 hints"), (2, 1, "in 2 tries with 1 hint")]:
            ctx, page, calls = make_context(browser, {
                "start": [snapshot()],
                "guess": [snapshot(attempts=attempts, hintsUsed=hints, elapsedSeconds=90, **SOLVED)],
            })
            play_to_solution(page)
            check(f"D wording {expected}", expected in page.inner_text("#share-preview"), page.inner_text("#share-preview"))
            ctx.close()

        # ---- E. native share ----
        stub = """
        window.__shared = [];
        navigator.share = (data) => { window.__shared.push(data); return window.__shareBehaviour ? window.__shareBehaviour() : Promise.resolve(); };
        """
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)],
        }, init_script=stub)
        play_to_solution(page)
        check("E1 native share button visible when supported", page.is_visible("#share-button"))
        check("E2 copy is secondary when native share exists", "secondary-button" in page.get_attribute("#copy-button", "class"))
        page.click("#share-button")
        page.wait_for_function("window.__shared.length === 1")
        shared = page.evaluate("window.__shared[0]")
        check("E3 native share payload", shared == {"title": "Brain Arcade", "text": "🧠 🧩 Brain Arcade #6\n\nI solved it in 2 tries with 1 hint, taking 02:14. Can you beat that?\n\n" + BASE + "?d=2026-10-19&a=2&h=1&t=134"}, repr(shared))
        # user cancels the share sheet: no error, no copy
        page.evaluate("(() => { window.__shareBehaviour = () => Promise.reject(Object.assign(new Error('cancel'), {name: 'AbortError'})); })()")
        page.click("#share-button")
        page.wait_for_function("window.__shared.length === 2")
        page.wait_for_timeout(200)
        check("E4 cancelling the share sheet shows nothing", page.inner_text("#share-status") == "")
        # share fails for another reason: falls back to copy
        page.evaluate("(() => { window.__shareBehaviour = () => Promise.reject(Object.assign(new Error('nope'), {name: 'NotAllowedError'})); })()")
        page.click("#share-button")
        page.wait_for_function("document.getElementById('share-status').textContent.includes('Copied')")
        check("E5 other share failure falls back to copy", "Copied" in page.inner_text("#share-status"))
        page.screenshot(path=os.path.join(SHOTS, "desktop_native_share.png"), full_page=True)
        ctx.close()

        # ---- F. clipboard unavailable: friendly message, no crash ----
        block = """
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
        document.execCommand = () => false;
        """
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)],
        }, init_script=block)
        play_to_solution(page)
        page.click("#copy-button")
        page.wait_for_function("document.getElementById('share-status').textContent.length > 0")
        check("F1 copy failure shows a friendly error", "Couldn't copy" in page.inner_text("#share-status") and "error" in page.get_attribute("#share-status", "class"))
        ctx.close()

        # ---- G. phone layout ----
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)],
        }, init_script=stub, viewport={"width": 320, "height": 640})
        play_to_solution(page)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("G1 no horizontal scroll at 320 px", overflow <= 0, f"overflow {overflow}px")
        box = page.eval_on_selector("#share-panel", "e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }")
        check("G2 share panel inside the 320 px screen", box[0] >= 0 and box[1] <= 320, str(box))
        widths = page.eval_on_selector_all(".choice:not([hidden])", "els => els.map(e => Math.round(e.getBoundingClientRect().width))")
        check("G3b both choices the same width, side by side", len(set(widths)) == 1, str(widths))
        sizes = page.eval_on_selector_all(".choice:not([hidden]), #share-button, #copy-button, #whatsapp-button", "els => els.map(e => e.getBoundingClientRect().height)")
        check("G3 touch targets at least 44 px", all(s >= 44 for s in sizes), str(sizes))
        page.screenshot(path=os.path.join(SHOTS, "phone_completion.png"), full_page=True)
        ctx.close()

        # ---- H. challenge links: receiving a friend's result ----
        def open_challenge(query, final=None, init=None):
            steps = {"start": [snapshot(puzzleDate=TODAY)]}
            if final is not None:
                steps["guess"] = [snapshot(puzzleDate=TODAY, **final)]
            ctx, page, calls = make_context(browser, steps, init_script=init)
            page.goto(BASE + query)
            return ctx, page

        def finish(page):
            page.click("#start-button")
            page.wait_for_selector("#game-screen:not([hidden])")
            page.fill("#answer-input", "anything")
            page.click("#submit-button")
            page.wait_for_selector("#completion-screen:not([hidden])")

        def datalayer(page):
            return page.evaluate("Array.from(window.dataLayer || []).map(a => Array.from(a))")

        ctx, page = open_challenge(f"?d={TODAY}&t=134")
        banner = page.inner_text("#challenge-banner") if page.is_visible("#challenge-banner") else ""
        pn = "puzzle #" + str((datetime.strptime(TODAY, "%Y-%m-%d") - datetime(2026, 10, 14)).days + 1)
        day = int(TODAY[8:]); mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][int(TODAY[5:7]) - 1]
        check("H1 time challenge banner", banner == f"Your friend solved {pn} in 02:14. Can you beat that?", repr(banner))
        check("H1b opening a challenge is recorded", ["event", "challenge_opened", {"game_name": "Brain Arcade", "challenge_type": "time"}] in datalayer(page))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}&a=2&h=1")
        check("H2 attempts challenge banner", page.is_visible("#challenge-banner") and "in 2 tries with 1 hint. Can you beat that?" in page.inner_text("#challenge-banner"))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}")
        check("H2a puzzle-only challenge banner", page.is_visible("#challenge-banner") and "Your friend couldn't crack" in page.inner_text("#challenge-banner") and page.inner_text("#challenge-banner").endswith("Can you?"), page.inner_text("#challenge-banner"))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}", win0 := dict(attempts=2, hintsUsed=0, elapsedSeconds=50, **SOLVED))
        finish(page)
        check("H2c solving a puzzle-only challenge", "cracked the puzzle your friend couldn't" in page.inner_text("#challenge-result"))
        check("H2d puzzle challenge recorded", ["event", "challenge_completed", {"game_name": "Brain Arcade", "challenge_type": "puzzle", "outcome": "cracked"}] in datalayer(page))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}", dict(attempts=3, completed=True, solved=False, correct=False, answer="x", explanation="y"))
        finish(page)
        check("H2e both unsolved", "tough one for both" in page.inner_text("#challenge-result"))
        ctx.close()

        ctx, page = open_challenge("?d=2020-01-05&t=134")
        check("H2b other-day challenge says it is not comparable", "new one" in page.inner_text("#challenge-banner"))
        ctx.close()

        bad = ["?d=" + TODAY + "&t=abc", "?d=2026-13-40&t=5", "?d=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&t=5", "?a=2&h=1",
               "?d=" + TODAY + "&a=9&h=1", "?d=" + TODAY + "&t=0", "?d=" + TODAY + "&a=2", "?d=" + TODAY + "&t=99999999", "?d=" + TODAY + "&t=-5", "?d=" + TODAY + "&x=1", "?d=" + TODAY + "&h=1"]
        for q in bad:
            ctx, page = open_challenge(q)
            check(f"H3 invalid link ignored {q[:34]}", not page.is_visible("#challenge-banner") and page.query_selector("img") is None)
            ctx.close()

        win = dict(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)
        cases = [
            (f"?d={TODAY}&t=200", win, "beat"), (f"?d={TODAY}&t=134", win, "tied"), (f"?d={TODAY}&t=100", win, "behind"),
            (f"?d={TODAY}&a=2&h=1", win, "tied"), (f"?d={TODAY}&a=3&h=0", win, "beat"), (f"?d={TODAY}&a=2&h=0", win, "behind"),
            (f"?d={TODAY}&a=1&h=0", win, "behind"), (f"?d={TODAY}&a=2&h=3", win, "beat"),
            (f"?d={TODAY}&a=2&h=1", dict(attempts=3, completed=True, solved=False, correct=False, answer="x", explanation="y"), "unsolved"),
        ]
        expect_text = {"beat": "You beat your friend", "tied": "You matched your friend", "behind": "Challenge them back", "unsolved": "Try again with tomorrow"}
        for q, final, outcome in cases:
            ctx, page = open_challenge(q, final)
            finish(page)
            visible = page.is_visible("#challenge-result")
            text = page.inner_text("#challenge-result") if visible else ""
            check(f"H4 {q[12:]} -> {outcome}", visible and expect_text[outcome] in text, text)
            ctx.close()

        ctx, page = open_challenge("?d=2020-01-05&t=134", win)
        finish(page)
        check("H5 no comparison when the puzzle day differs", not page.is_visible("#challenge-result"))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}&t=200", win)
        finish(page)
        events = datalayer(page)
        check("H6 completion outcome recorded", ["event", "challenge_completed", {"game_name": "Brain Arcade", "challenge_type": "time", "outcome": "beat"}] in events, str(events))
        page.click("#copy-button")
        page.wait_for_function("document.getElementById('share-status').textContent.length > 0")
        copied = page.evaluate("navigator.clipboard.readText()")
        check("H7 new link carries own result, not the friend's", "t=134" in copied and "t=200" not in copied and "a=2" in copied, copied)
        check("H8 sharing is recorded with method and content", ["event", "share_result", {"game_name": "Brain Arcade", "method": "copy", "content": "result"}] in datalayer(page))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}&t=200", dict(attempts=1, hintsUsed=0, elapsedSeconds=30, **SOLVED))
        page.screenshot(path=os.path.join(SHOTS, "phone_challenge_welcome.png"))
        ctx.close()

        # ---- I. activity tracking ----
        def events(page):
            return [(a[1], a[2] if len(a) > 2 else {}) for a in page.evaluate("Array.from(window.dataLayer || []).map(a => Array.from(a))") if a and a[0] == "event"]

        def names(page):
            return [n for n, _ in events(page)]

        def first(page, name):
            return next((p for n, p in events(page) if n == name), None)

        SESSION = "22222222-2222-4222-8222-222222222222"
        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "hint": [dict(snapshot(hintsUsed=1), hint="It makes music.")],
            "guess": [dict(snapshot(attempts=1, hintsUsed=1), correct=False, message="Not quite."),
                      snapshot(attempts=2, hintsUsed=1, elapsedSeconds=90, **SOLVED)],
        }, storage={"brainArcadeSessionId": SESSION})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#game-screen:not([hidden])")
        page.click("#hint-button")
        page.wait_for_selector("#hint-box:not([hidden])")
        for word in ("secretguess", "piano"):
            page.fill("#answer-input", word)
            page.click("#submit-button")
            page.wait_for_timeout(250)
        page.wait_for_selector("#completion-screen:not([hidden])")
        ev = names(page)
        check("I1 funnel events in order", [n for n in ev if n in ("puzzle_started", "hint_used", "answer_submitted", "puzzle_completed")] == ["puzzle_started", "hint_used", "answer_submitted", "answer_submitted", "puzzle_completed"], str(ev))
        check("I2 started carries category and puzzle date", first(page, "puzzle_started") == {"game_name": "Brain Arcade", "puzzle_category": "Wordplay", "puzzle_date": "2026-10-19"}, str(first(page, "puzzle_started")))
        check("I3 completed carries date, attempts, hints, time", first(page, "puzzle_completed") == {"game_name": "Brain Arcade", "puzzle_date": "2026-10-19", "solved": True, "attempts_used": 2, "hints_used": 1, "completion_time_seconds": 90}, str(first(page, "puzzle_completed")))
        check("I4 hint and answer events carry the puzzle date", first(page, "hint_used")["puzzle_date"] == "2026-10-19" and first(page, "answer_submitted")["puzzle_date"] == "2026-10-19")
        check("I5 a fresh play is not reported as resumed", "puzzle_resumed" not in ev)
        blob = json.dumps(events(page))
        check("I6 no answer text, session id or answer in any event", "secretguess" not in blob and SESSION not in blob and "piano" not in blob.lower() and "A piano" not in blob, blob[:200])
        page.check('input[value="record"]', force=True)
        check("I7 changing the share choice is recorded", {"game_name": "Brain Arcade", "content": "record"} in [p for n, p in events(page) if n == "share_choice_changed"])
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot(attempts=1, hintsUsed=1)]}, storage={"brainArcadeSessionId": SESSION})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#game-screen:not([hidden])")
        check("I8 returning to a game in progress", first(page, "puzzle_resumed") == {"game_name": "Brain Arcade", "puzzle_date": "2026-10-19", "state": "in_progress"}, str(first(page, "puzzle_resumed")))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot(attempts=1, elapsedSeconds=61, **SOLVED)]}, storage={"brainArcadeSessionId": SESSION})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#completion-screen:not([hidden])")
        check("I9 returning to a finished puzzle", first(page, "puzzle_resumed") == {"game_name": "Brain Arcade", "puzzle_date": "2026-10-19", "state": "completed"}, str(first(page, "puzzle_resumed")))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [{"error": "boom"}]})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_function("document.getElementById('welcome-error').textContent.length > 0")
        check("I10 failed start is recorded with status only", first(page, "game_error") == {"game_name": "Brain Arcade", "action": "start", "status_code": 500}, str(first(page, "game_error")))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [{"error": "boom"}]})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#game-screen:not([hidden])")
        page.fill("#answer-input", "x")
        page.click("#submit-button")
        page.wait_for_function("document.getElementById('feedback').textContent.includes('may not have been recorded')")
        check("I11 failed answer is recorded", first(page, "game_error") == {"game_name": "Brain Arcade", "action": "guess", "status_code": 500}, str(first(page, "game_error")))
        ctx.close()

        ctx, page, calls = make_context(browser, {
            "start": [snapshot()],
            "guess": [snapshot(attempts=1, elapsedSeconds=20, **SOLVED)],
        }, init_script=stub)
        play_to_solution(page)
        page.evaluate("(() => { window.__shareBehaviour = () => Promise.reject(Object.assign(new Error('cancel'), {name: 'AbortError'})); })()")
        page.click("#share-button")
        page.wait_for_function("window.__shared.length === 1")
        page.wait_for_timeout(200)
        check("I12 closing the share sheet is recorded as dismissed, not shared", "share_dismissed" in names(page) and "share_result" not in names(page), str(names(page)))
        ctx.close()

        # ---- J. personal record: "Out of N puzzles so far, you have played X and solved Y" ----
        from datetime import date as _date
        N = (datetime.now(ZoneInfo("Asia/Kolkata")).date() - _date(2026, 10, 14)).days + 1

        def sentence(played, solved):
            return f"Out of {N} puzzle{'s' if N != 1 else ''} so far, you've played {played} and solved {solved}."

        def record_text(page, which):
            sel = "#record-" + which
            return page.get_attribute(sel, "aria-label") if page.is_visible(sel) else ""

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=2, elapsedSeconds=90, **SOLVED)]})
        page.goto(BASE)
        check("J0 no record shown to a brand new player", record_text(page, "welcome") == "")
        page.click("#start-button")
        page.wait_for_selector("#game-screen:not([hidden])")
        page.fill("#answer-input", "piano")
        page.click("#submit-button")
        page.wait_for_selector("#completion-screen:not([hidden])")
        check("J1 first solved puzzle is counted", record_text(page, "completion") == sentence(1, 1), record_text(page, "completion"))
        stored = page.evaluate("JSON.parse(localStorage.getItem('brainArcadeRecord'))")
        check("J1b only counts are stored, no answer or identifier", stored == {"v": 1, "puzzles": {"2026-10-19": {"s": 1, "a": 2, "h": 0, "t": 90}}}, str(stored))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=3, completed=True, solved=False, correct=False, answer="A piano", explanation="x")]})
        play_to_solution(page)
        check("J2 a failed puzzle counts as played, not solved", record_text(page, "completion") == sentence(1, 0), record_text(page, "completion"))
        ctx.close()

        seeded = json.dumps({"v": 1, "puzzles": {
            "2026-10-14": {"s": 1, "a": 1, "h": 0, "t": 30}, "2026-10-15": {"s": 0, "a": 3, "h": 1, "t": 200}, "2026-10-16": {"s": 1, "a": 2, "h": 0, "t": 80},
            "2026-10-10": {"s": 1, "a": 1, "h": 0, "t": 10}, "2099-01-01": {"s": 1, "a": 1, "h": 0, "t": 10}, "not-a-date": {"s": 1}}})
        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=2, elapsedSeconds=90, **SOLVED)]}, storage={"brainArcadeRecord": seeded})
        page.goto(BASE)
        check("J3 welcome screen shows the saved record (before the start, after the end and bad dates ignored)", record_text(page, "welcome") == sentence(3, 2), record_text(page, "welcome"))
        page.click("#start-button")
        page.wait_for_selector("#game-screen:not([hidden])")
        page.fill("#answer-input", "piano")
        page.click("#submit-button")
        page.wait_for_selector("#completion-screen:not([hidden])")
        check("J4 today's result is added to the earlier ones", record_text(page, "completion") == sentence(4, 3), record_text(page, "completion"))
        ctx.close()

        again = json.dumps({"v": 1, "puzzles": {"2026-10-19": {"s": 1, "a": 1, "h": 0, "t": 30}}})
        ctx, page, calls = make_context(browser, {"start": [snapshot(attempts=1, elapsedSeconds=30, **SOLVED)]}, storage={"brainArcadeRecord": again})
        page.goto(BASE)
        page.click("#start-button")
        page.wait_for_selector("#completion-screen:not([hidden])")
        check("J5 reopening a finished puzzle does not count it twice", record_text(page, "completion") == sentence(1, 1), record_text(page, "completion"))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=1, elapsedSeconds=20, **SOLVED)]}, storage={"brainArcadeRecord": "this is not json"})
        play_to_solution(page)
        check("J6 a damaged record does not break the game", page.is_visible("#completion-screen") and record_text(page, "completion") == sentence(1, 1), record_text(page, "completion"))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=1, elapsedSeconds=20, **SOLVED)]})
        play_to_solution(page)
        page.screenshot(path=os.path.join(SHOTS, "record_completion.png"), full_page=True)
        ctx.close()

        # ---- L. combined result links (tries, hints and time) ----
        for q, final, want in [
            (f"?d={TODAY}&a=2&h=1&t=134", dict(attempts=2, hintsUsed=1, elapsedSeconds=100, **SOLVED), "beat"),
            (f"?d={TODAY}&a=2&h=1&t=134", dict(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED), "tied"),
            (f"?d={TODAY}&a=2&h=1&t=134", dict(attempts=2, hintsUsed=1, elapsedSeconds=200, **SOLVED), "behind"),
            (f"?d={TODAY}&a=2&h=1&t=134", dict(attempts=1, hintsUsed=2, elapsedSeconds=500, **SOLVED), "beat"),
        ]:
            ctx, page = open_challenge(q)
            if q.endswith("t=134") and want == "beat" and final["elapsedSeconds"] == 100:
                check("L1 combined challenge banner", page.inner_text("#challenge-banner") == f"Your friend solved {pn} in 2 tries with 1 hint, taking 02:14. Can you beat that?", page.inner_text("#challenge-banner"))
            ctx.close()
            ctx, page = open_challenge(q, final)
            finish(page)
            got = page.inner_text("#challenge-result")
            msg = {"beat": "beat", "tied": "matched", "behind": "a little better"}[want]
            check(f"L2 combined challenge {want} ({final['attempts']} tries, {final['elapsedSeconds']}s)", msg in got, got)
            ctx.close()

        # ---- K. WhatsApp, record sharing, rematch, link preview ----
        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=2, hintsUsed=1, elapsedSeconds=134, **SOLVED)]}, init_script=stub)
        play_to_solution(page)
        href = page.get_attribute("#whatsapp-button", "href")
        from urllib.parse import urlparse, parse_qs
        wa = parse_qs(urlparse(href).query).get("text", [""])[0]
        check("K1 WhatsApp link carries the full share text", href.startswith("https://wa.me/?text=") and wa == page.inner_text("#share-preview"), href)
        check("K1b WhatsApp opens in a new tab safely", page.get_attribute("#whatsapp-button", "target") == "_blank" and "noopener" in page.get_attribute("#whatsapp-button", "rel"))
        page.click('label:has(input[value="record"])')
        rec = page.inner_text("#share-preview")
        total = (datetime.strptime(TODAY, "%Y-%m-%d") - datetime(2026, 10, 14)).days + 1
        check("K2 record share text and plain link", rec == f"🧠 🧩 Brain Arcade\n\nI've solved 1 of {total} puzzles so far. Can you beat that?\n\n" + BASE, repr(rec))
        check("K2b WhatsApp link follows the choice", "solved 1 of" in parse_qs(urlparse(page.get_attribute("#whatsapp-button", "href")).query)["text"][0])
        page.evaluate("window.dataLayer = []")
        page.evaluate("document.getElementById('whatsapp-button').addEventListener('click', e => e.preventDefault())")
        page.click("#whatsapp-button")
        check("K3 WhatsApp share is recorded", ["event", "share_result", {"game_name": "Brain Arcade", "method": "whatsapp", "content": "record"}] in datalayer(page), str(datalayer(page)))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()], "guess": [snapshot(attempts=3, completed=True, solved=False, correct=False, answer="A piano", explanation="x")]}, init_script=stub)
        play_to_solution(page)
        page.click('label:has(input[value="record"])')
        check("K4 failed players can share their record", "solved 0 of" in page.inner_text("#share-preview"), page.inner_text("#share-preview"))
        ctx.close()

        ctx, page = open_challenge(f"?d={TODAY}&t=134", dict(attempts=1, hintsUsed=0, elapsedSeconds=50, **SOLVED), init=stub)
        check("K5 rematch button hidden before playing", not page.is_visible("#rematch-button"))
        finish(page)
        check("K5b rematch button shown with the challenge result", page.is_visible("#rematch-button"))
        page.evaluate("window.dataLayer = []")
        page.click("#rematch-button")
        check("K5c rematch is recorded", any(e[:2] == ["event", "challenge_rematch"] for e in datalayer(page)), str(datalayer(page)))
        ctx.close()

        ctx, page, calls = make_context(browser, {"start": [snapshot()]})
        page.goto(BASE)
        metas = page.evaluate("Object.fromEntries(Array.from(document.querySelectorAll('meta[property^=og], meta[name^=twitter]')).map(m => [m.getAttribute('property') || m.name, m.content]))")
        check("K6 link preview tags present", metas.get("og:image", "").endswith("/og-image.png") and metas.get("og:title") and metas.get("twitter:card") == "summary_large_image", str(metas))
        check("K6b og-image file exists", os.path.exists(os.path.join(os.path.dirname(__file__), "..", "og-image.png")))
        ctx.close()

        browser.close()
finally:
    server.terminate()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
