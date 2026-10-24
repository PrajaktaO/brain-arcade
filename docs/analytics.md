# Brain Arcade: user activity tracking (Google Analytics 4)

Property: the existing Brain Arcade GA4 property (`G-HDVV4TEHEP`). Tracking is sent from `script.js` with `gtag("event", ...)`. The staging site sends nothing.

## Privacy rules (do not break these)

- Never send the player's answer text, the session id, the puzzle answer, or a name or email in any event.
- Only counts, flags, dates and categories are sent. Puzzle date and category are public information.
- Tracking must never stop the game: if Google Analytics is blocked, the game works as before.

## Events

Every event also carries `game_name = "Brain Arcade"`. Events marked **once** are sent at most once per browser per day (the browser remembers).

| Event | Fires when | Parameters | What it tells you |
|---|---|---|---|
| `page_view` (built in) | Any page opens | automatic | Visits, including friends arriving from a shared link |
| `puzzle_started` **once** | The player taps Start and gets a puzzle | `puzzle_date`, `puzzle_category` | Real players today (not just visitors). Start rate = this / visitors |
| `puzzle_resumed` | The page opens a puzzle that already has progress | `puzzle_date`, `state` (`in_progress` or `completed`) | People coming back to finish, or to look at their result |
| `hint_used` | The server gives a hint | `puzzle_date`, `hint_number` | How hard the puzzle felt; hint demand |
| `answer_submitted` | An answer is checked | `puzzle_date`, `is_correct`, `attempt_number` | Where players fail: first try, second, third |
| `puzzle_completed` **once** | The puzzle ends (solved or out of attempts) | `puzzle_date`, `solved`, `attempts_used`, `hints_used`, `completion_time_seconds` | Solve rate, time, difficulty per day |
| `share_choice_changed` | The player flips the Attempts & hints / Time switch | `content` (`time` or `attempts`) | What people prefer to share |
| `share_result` | A share or copy actually happens | `method` (`copy` or `native`), `content` (`time`, `attempts` or `puzzle`) | Share rate and what is shared. `puzzle` means shared after failing |
| `share_dismissed` | The phone's share sheet is closed without sharing | `content` | Friction: opened the share sheet but did not share |
| `challenge_opened` | Someone opens a friend's challenge link | `challenge_type` (`time`, `attempts`, `puzzle`) | Virality: how many shares bring people in |
| `challenge_completed` **once** | A challenged player finishes the same day's puzzle | `challenge_type`, `outcome` (`beat`, `tied`, `behind`, `unsolved`, `cracked`, `also_unsolved`) | Whether challenges are fun and finished |
| `game_error` | A request to the game server failed | `action` (`start`, `guess`, `hint`), `status_code` | Reliability. A rising count means players are being blocked |

Planned for the archive (not built yet): `archive_opened`, `archive_day_selected` (with `puzzle_date`), `archive_completed` (with `solved`, `attempts_used`, `hints_used`).

## One-time GA4 setup

**1. Custom dimensions** (Admin, Data display, Custom definitions, Create custom dimension; scope **Event**; the parameter name must match exactly). Only data after registering is broken down.

`puzzle_date`, `puzzle_category`, `solved`, `is_correct`, `state`, `method`, `content`, `challenge_type`, `outcome`, `action`, `status_code`

**2. Custom metrics** (same page, Custom metrics tab; scope Event):

| Parameter | Unit |
|---|---|
| `completion_time_seconds` | Seconds |
| `attempts_used` | Standard |
| `hints_used` | Standard |

**3. Key events** (Admin, Data display, Events, mark as key event): `puzzle_started`, `puzzle_completed`, `share_result`, `challenge_opened`.

**4. Funnel** (Explore, Funnel exploration): steps `page_view`, `puzzle_started`, `puzzle_completed`, `share_result`. Add a breakdown by `puzzle_date` to see which days lose people.

**5. Audiences** (optional, Admin, Audiences): "Solvers" = `puzzle_completed` where `solved` = true; "Came from a challenge" = `challenge_opened`.

## What to look at, and how

| Question | Where | Formula |
|---|---|---|
| Is anyone playing? | Reports, Realtime | Users and events in the last 30 minutes |
| How many people really play? | Engagement, Events | Users who triggered `puzzle_started` per day |
| Do visitors start? | Funnel | `puzzle_started` / `page_view` users |
| Do players finish? | Funnel | `puzzle_completed` / `puzzle_started` |
| Is a puzzle too hard? | Explore, table by `puzzle_date` | Solve rate, average attempts, hints, time |
| Do people share? | Events | `share_result` / solved `puzzle_completed` |
| Does sharing bring people? | Events | `challenge_opened` / `share_result` |
| Do challenged people play? | Events by `outcome` | `challenge_completed` / `challenge_opened` |
| Do people come back? | Reports, Retention | Returning users by day; `puzzle_resumed` |
| Is the game healthy? | Events by `action` and `status_code` | `game_error` count; should be near zero |

## Limits to remember

- GA counts a "user" by browser, not by person. Someone on two devices counts twice.
- `puzzle_started` and `puzzle_completed` use the browser's memory to avoid duplicates. Clearing site data can send them again.
- Ad blockers hide some players, so GA shows fewer than the real number. The database (`game_sessions`) is the true count of plays.
- Reports (not Realtime) can run several hours late. Small numbers swing widely; judge by the week.
