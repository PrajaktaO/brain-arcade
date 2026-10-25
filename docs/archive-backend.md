# Archive backend (release 2): `archive-api`

Status: **written and tested locally, not yet deployed anywhere.** Staging first; production only after the owner approves.

## What it does

Lets a player open and play **past** daily puzzles, from puzzle 1 (14 Oct 2026) up to yesterday (India date). It follows the daily rules: three attempts, hints do not use attempts, and the answer and explanation are sent only after the puzzle is completed.

- Lives in a **new function** (`archive-api`). The live function `swift-task` is not touched.
- Stores progress in a **new table** (`archive_plays`). `game_sessions` is never read or written, so archive play cannot change streaks or rankings.
- Files: `supabase/functions/archive-api/index.ts`, `supabase/migrations/20261020000000_archive_plays.sql`, `tests/test_archive.mjs`.

## Contract

All calls are `POST` with JSON. Errors are `{ "error": "friendly text", "code"?: "..." }`.

| Action | Input | Result |
|---|---|---|
| `list` | none (no session needed) | `{ startDate, today, puzzles: [{ date, number }] }`. Only active puzzles from the start date up to yesterday. No questions or answers. |
| `start` | `sessionId`, `date` | Snapshot. Creates the play, or resumes it. |
| `hint` | `sessionId`, `date` | Snapshot + `hint` (string, or `null` when none are left). |
| `guess` | `sessionId`, `date`, `answer` | Snapshot + `correct`, `message`. |

**Snapshot:** `puzzleDate`, `puzzleNumber`, `category`, `question`, `attempts`, `hintsUsed`, `revealedHints` (hints already shown, so a refresh does not lose them), `completed`, `solved`, `elapsedSeconds`. `answer` and `explanation` are added only when `completed` is true.

| Status | When |
|---|---|
| 400 | Bad session id, bad or missing date, empty or over-long answer, unknown action |
| 404 | No puzzle for that day (before the start date, in the future, inactive, or missing); `hint`/`guess` before `start` |
| 409 (`code: use_daily`) | The date is today. Today's puzzle is played from the main page. |
| 429 (`code: rate_limited`) | One browser opened more than 40 new archive puzzles in 24 hours |
| 500 | Server problem (generic message; details only in the function log) |

## Rules worth knowing

- **Timer:** like the daily game, it keeps running while the page is closed (started to completed, or to now).
- **Attempts and hints are safe against parallel requests.** Every update only succeeds if the counters are still what the request read. A parallel duplicate is not charged twice. The database also refuses more than three attempts.
- **Future days** are not revealed; they look the same as days with no puzzle.
- **Browser-only progress:** the server holds only attempt state per browser id. Which days the player has finished, and showing that on the calendar, is for the front end to keep in the browser.
- **Midnight (India time):** yesterday's puzzle joins the archive at 00:00 and today's moves to the daily game.
- The answer check is the same as the daily game (lowercase, strip everything except a-z and 0-9). Finding F3 in `backend.md` applies to both. A symbols-only answer is never accepted.

## Deploy to STAGING (owner steps)

1. **SQL.** In the staging project's SQL Editor, run `supabase/migrations/20261020000000_archive_plays.sql`. It is safe to run twice. (The baseline and the test puzzles should already be there.)
2. **Function.** Edge Functions, **Deploy a new function**, name it exactly `archive-api`. Paste the whole of `supabase/functions/archive-api/index.ts`.
3. **Verify JWT: switch it OFF**, same as `swift-task`. The site sends only the publishable key in an `apikey` header, which is not a JWT, so with the switch on every call is refused.
4. No secrets to add. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.
5. **Quick check.** Open the staging site, open the browser console, and run (this only reads the list):

```js
fetch("https://gfvcheiqvypmiuckchwr.supabase.co/functions/v1/archive-api", {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: "sb_publishable_DGvpBskL5-0URwaisHjyYg_hZ_qbHW1" },
  body: JSON.stringify({ action: "list" })
}).then(r => r.json()).then(console.log)
```

You should see puzzles from 14 Oct up to yesterday. Then send me the result.

## Production (later, after staging passes)

Same three steps in the production project. The SQL is additive. **Rollback:** delete the `archive-api` function. The table can stay (it is empty and unused), or `drop table public.archive_plays;` if you want it gone.

## Environment settings (optional)

`ALLOWED_ORIGIN` (default `https://prajaktao.github.io`) and `ARCHIVE_START_DATE` (default `2026-10-14`). Leave both unset.

## What has and has not been tested

- **Tested (62 checks, real PostgreSQL 16):** every rule above, including parallel requests, the limit, midnight, SQL-looking input, database constraints, and that the public roles cannot read the table. Run: `node --experimental-strip-types tests/test_archive.mjs` (setup is in the file header).
- **Not tested from here:** the connection code to Supabase (about 60 lines at the bottom of the file) and the web entry point, because this workspace cannot reach Supabase. The staging check above covers them. Expect at most small fixes.
- **Not built yet:** the calendar screen in the browser (release 2, front end).

## Limits to remember

- The list returns at most 1000 days (about 2.7 years). Revisit before then.
- Anyone can reveal an answer by deliberately failing three times, or by making new browser ids. This is the same as the daily game (finding F2) and is acceptable for a friendly archive. It matters if rankings are added later.
