// Tests for the archive-api game rules against a REAL local PostgreSQL database.
//
// Setup (once): a local PostgreSQL with a database named archive_test, roles
// "anon" and "authenticated", and these files loaded in order:
//   supabase/migrations/20261017000000_baseline_current_schema.sql
//   supabase/migrations/20261020000000_archive_plays.sql
//   supabase/seed/staging_test_puzzles.sql
// Run:  node --experimental-strip-types tests/test_archive.mjs
//
// The Supabase-specific store is not exercised here (it needs a Supabase
// project); the staging project test covers it. Everything else is.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handleArchive } from "../supabase/functions/archive-api/index.ts";

const run = promisify(execFile);
const results = [];

function check(name, ok, detail = "") {
  results.push(ok);
  console.log((ok ? "PASS " : "FAIL ") + name + (!ok && detail ? `  [${detail}]` : ""));
}

const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function sql(statement) {
  const { stdout } = await run("runuser", [
    "-u", "postgres", "--", "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", "archive_test", "-c", statement,
  ]);
  return stdout.trim();
}

async function rows(statement) {
  const out = await sql(`select coalesce(json_agg(t), '[]') from (${statement}) t`);
  return JSON.parse(out);
}

const COLUMNS = ["attempts", "hints_used", "hint_index", "completed", "solved", "completed_at"];

const store = {
  listPuzzleDates: (start, end) =>
    rows(`select puzzle_date::text, sequence from daily_puzzle where active and puzzle_date >= ${q(start)} and puzzle_date < ${q(end)} order by puzzle_date`),
  async getPuzzle(date) {
    const r = await rows(`select sequence, puzzle_date::text, category, question, accepted_answers, answer_display, hints, explanation, active from daily_puzzle where puzzle_date = ${q(date)}`);
    return r[0] ?? null;
  },
  async getPlay(sessionId, date) {
    const r = await rows(`select session_id, puzzle_date::text, puzzle_sequence, attempts, hints_used, hint_index, completed, solved, started_at, completed_at from archive_plays where session_id = ${q(sessionId)} and puzzle_date = ${q(date)}`);
    return r[0] ?? null;
  },
  async countPlaysSince(sessionId, since) {
    return Number(await sql(`select count(*) from archive_plays where session_id = ${q(sessionId)} and started_at >= ${q(since)}`));
  },
  async insertPlay(row) {
    await sql(`insert into archive_plays (session_id, puzzle_date, puzzle_sequence) values (${q(row.session_id)}, ${q(row.puzzle_date)}, ${row.puzzle_sequence}) on conflict do nothing`);
  },
  async updatePlayIf(sessionId, date, expected, changes) {
    const sets = Object.entries(changes).map(([key, value]) => {
      if (!COLUMNS.includes(key)) throw new Error("unexpected column " + key);
      return `${key} = ${value === null ? "null" : typeof value === "string" ? q(value) : value}`;
    });
    const out = await sql(`with t as (update archive_plays set ${sets.join(", ")} where session_id = ${q(sessionId)} and puzzle_date = ${q(date)} and completed = false and attempts = ${expected.attempts} and hint_index = ${expected.hint_index} returning session_id, puzzle_date::text, puzzle_sequence, attempts, hints_used, hint_index, completed, solved, started_at, completed_at) select coalesce(json_agg(t), '[]') from t`);
    return JSON.parse(out)[0] ?? null;
  },
};

let counter = 0;
const newSession = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const NOW = new Date("2026-10-20T05:00:00Z"); // 10:30 on 20 Oct in India
const call = (input, now = NOW, start) => handleArchive(input, store, now, start);

await sql("truncate archive_plays, game_sessions");

// ---- list ----
let r = await call({ action: "list" });
check("L1 list returns 14 to 19 Oct, numbered 1 to 6", r.status === 200 && JSON.stringify(r.body.puzzles.map((p) => [p.date, p.number])) === JSON.stringify([1, 2, 3, 4, 5, 6].map((n) => [`2026-10-${13 + n}`, n])), JSON.stringify(r.body));
check("L2 list excludes today and the future", !r.body.puzzles.some((p) => p.date >= "2026-10-20"));
check("L3 list has no questions or answers", !JSON.stringify(r.body).match(/question|answer|piano|stamp/i));

await sql("update daily_puzzle set active = false where puzzle_date = '2026-10-16'");
r = await call({ action: "list" });
check("L4 inactive puzzle hidden from list", !r.body.puzzles.some((p) => p.date === "2026-10-16"));
r = await call({ action: "start", sessionId: newSession(), date: "2026-10-16" });
check("L5 inactive puzzle cannot be started", r.status === 404);
await sql("update daily_puzzle set active = true where puzzle_date = '2026-10-16'");

r = await call({ action: "list" }, new Date("2026-10-20T18:40:00Z"));
check("L6 after midnight in India the 20th joins the archive", r.body.today === "2026-10-21" && r.body.puzzles.some((p) => p.date === "2026-10-20"));

// ---- start: validation ----
const S = newSession();
const bad = [
  [{ action: "start", sessionId: S, date: "2026-10-20" }, 409, "today uses the daily game"],
  [{ action: "start", sessionId: S, date: "2026-10-21" }, 404, "tomorrow"],
  [{ action: "start", sessionId: S, date: "2027-01-01" }, 404, "far future"],
  [{ action: "start", sessionId: S, date: "2026-10-13" }, 404, "before the archive start"],
  [{ action: "start", sessionId: S, date: "2026-10-12" }, 404, "12 Oct skipped"],
  [{ action: "start", sessionId: S, date: "2026-02-30" }, 400, "impossible date"],
  [{ action: "start", sessionId: S, date: "tomorrow" }, 400, "not a date"],
  [{ action: "start", sessionId: S }, 400, "no date"],
  [{ action: "start", sessionId: S, date: ["2026-10-15"] }, 400, "date as array"],
  [{ action: "start", sessionId: "not-a-uuid", date: "2026-10-15" }, 400, "bad session"],
  [{ action: "start", date: "2026-10-15" }, 400, "no session"],
  [{ action: "explode", sessionId: S, date: "2026-10-15" }, 400, "unknown action"],
  [{ sessionId: S, date: "2026-10-15" }, 400, "no action"],
  [{ action: "start", sessionId: S, date: "2026-10-15' or '1'='1" }, 400, "SQL-looking date"],
];
for (const [input, status, label] of bad) {
  r = await call(input);
  check(`V ${label} -> ${status}`, r.status === status, `${r.status} ${JSON.stringify(r.body)}`);
}
check("V use_daily code for today", (await call({ action: "start", sessionId: S, date: "2026-10-20" })).body.code === "use_daily");
check("V nothing was stored by rejected requests", (await sql("select count(*) from archive_plays")) === "0");

// ---- start: the snapshot never leaks ----
const A = newSession();
r = await call({ action: "start", sessionId: A, date: "2026-10-14" });
const text = JSON.stringify(r.body);
check("S1 start returns the puzzle", r.status === 200 && r.body.puzzleNumber === 1 && r.body.question === "What has keys but cannot open locks?" && r.body.attempts === 0 && r.body.completed === false);
check("S2 no answer, explanation or accepted answers before completion", !("answer" in r.body) && !("explanation" in r.body) && !/piano|accepted/i.test(text.replace(r.body.question, "")), text);
check("S3 no hints revealed yet", Array.isArray(r.body.revealedHints) && r.body.revealedHints.length === 0);
const first = await store.getPlay(A, "2026-10-14");
await call({ action: "start", sessionId: A, date: "2026-10-14" });
const again = await store.getPlay(A, "2026-10-14");
check("S4 starting again resumes the same play", first.started_at === again.started_at && (await sql("select count(*) from archive_plays")) === "1");

// ---- hints ----
r = await call({ action: "hint", sessionId: A, date: "2026-10-14" });
check("H1 first hint", r.body.hint === "It makes music." && r.body.hintsUsed === 1 && r.body.attempts === 0, JSON.stringify(r.body));
check("H1b hint response still has no answer", !("answer" in r.body));
r = await call({ action: "hint", sessionId: A, date: "2026-10-14" });
check("H2 second hint", r.body.hint === "You press its keys with your fingers." && r.body.hintsUsed === 2);
r = await call({ action: "hint", sessionId: A, date: "2026-10-14" });
check("H3 no more hints", r.body.hint === null && r.body.hintsUsed === 2 && /No more hints/.test(r.body.message));
r = await call({ action: "start", sessionId: A, date: "2026-10-14" });
check("H4 reopening restores the hints already shown", JSON.stringify(r.body.revealedHints) === JSON.stringify(["It makes music.", "You press its keys with your fingers."]));

// ---- guesses ----
r = await call({ action: "guess", sessionId: A, date: "2026-10-14", answer: "violin" });
check("G1 wrong guess uses an attempt", r.body.correct === false && r.body.attempts === 1 && r.body.completed === false && !("answer" in r.body));
r = await call({ action: "guess", sessionId: A, date: "2026-10-14", answer: "  A  Piano! " });
check("G2 correct answer (case, spaces, punctuation ignored)", r.body.correct === true && r.body.solved === true && r.body.attempts === 2 && r.body.answer === "A piano" && !!r.body.explanation, JSON.stringify(r.body));
r = await call({ action: "guess", sessionId: A, date: "2026-10-14", answer: "violin" });
check("G3 guessing after completion changes nothing", r.body.attempts === 2 && r.body.solved === true && r.body.completed === true);
r = await call({ action: "hint", sessionId: A, date: "2026-10-14" });
check("G4 hinting after completion changes nothing", r.body.hintsUsed === 2 && r.body.completed === true);

const B = newSession();
await call({ action: "start", sessionId: B, date: "2026-10-15" });
for (const word of ["a", "b"]) {
  r = await call({ action: "guess", sessionId: B, date: "2026-10-15", answer: word });
}
check("G5 two wrong guesses leave the puzzle open", r.body.attempts === 2 && r.body.completed === false && !("answer" in r.body));
r = await call({ action: "guess", sessionId: B, date: "2026-10-15", answer: "c" });
check("G6 third wrong guess completes it unsolved and reveals the answer", r.body.completed === true && r.body.solved === false && r.body.attempts === 3 && r.body.answer === "Footsteps" && r.body.message === "No attempts remaining.", JSON.stringify(r.body));
r = await call({ action: "guess", sessionId: B, date: "2026-10-15", answer: "footsteps" });
check("G7 cannot get a fourth attempt", r.body.attempts === 3 && r.body.solved === false);

r = await call({ action: "guess", sessionId: newSession(), date: "2026-10-16", answer: "towel" });
check("G8 guess before starting is refused", r.status === 404);
r = await call({ action: "hint", sessionId: newSession(), date: "2026-10-16" });
check("G8b hint before starting is refused", r.status === 404);

const C = newSession();
await call({ action: "start", sessionId: C, date: "2026-10-16" });
check("G9 empty answer", (await call({ action: "guess", sessionId: C, date: "2026-10-16", answer: "   " })).status === 400);
check("G9b non-string answer", (await call({ action: "guess", sessionId: C, date: "2026-10-16", answer: 42 })).status === 400);
check("G9c over-long answer", (await call({ action: "guess", sessionId: C, date: "2026-10-16", answer: "x".repeat(201) })).status === 400);
r = await call({ action: "guess", sessionId: C, date: "2026-10-16", answer: "!!!" });
check("G10 symbols-only answer is not accepted", r.body.correct === false && r.body.attempts === 1);
check("G11 no attempt used by rejected input", (await store.getPlay(C, "2026-10-16")).attempts === 1);

// ---- parallel requests ----
const D = newSession();
await call({ action: "start", sessionId: D, date: "2026-10-17" });
await Promise.all(Array.from({ length: 6 }, (_, i) => call({ action: "guess", sessionId: D, date: "2026-10-17", answer: "wrong" + i })));
let play = await store.getPlay(D, "2026-10-17");
check("P1 six parallel wrong guesses never exceed three attempts", play.attempts >= 1 && play.attempts <= 3, String(play.attempts));
check("P1b parallel guesses were not all counted (no double charge)", play.attempts < 6);

const E = newSession();
await call({ action: "start", sessionId: E, date: "2026-10-17" });
await Promise.all(Array.from({ length: 6 }, () => call({ action: "hint", sessionId: E, date: "2026-10-17" })));
play = await store.getPlay(E, "2026-10-17");
check("P2 parallel hints stay consistent", play.hints_used === play.hint_index && play.hint_index <= 2, JSON.stringify(play));

const F = newSession();
await call({ action: "start", sessionId: F, date: "2026-10-18" });
const bursts = await Promise.all(Array.from({ length: 5 }, () => call({ action: "guess", sessionId: F, date: "2026-10-18", answer: "clock" })));
play = await store.getPlay(F, "2026-10-18");
check("P3 parallel correct answers: solved once, one attempt", play.solved && play.attempts === 1, JSON.stringify(play));
check("P3b every parallel reply reports the solved state", bursts.every((b) => b.body.solved === true && b.body.answer === "A clock"));

// ---- timer ----
const T = newSession();
await call({ action: "start", sessionId: T, date: "2026-10-19" }, NOW);
await sql(`update archive_plays set started_at = ${q(NOW.toISOString())} where session_id = ${q(T)}`); // the database stamps real time; pin it to the test clock
r = await call({ action: "start", sessionId: T, date: "2026-10-19" }, new Date(NOW.getTime() + 3600 * 1000));
check("T1 timer keeps running while the page is closed", r.body.elapsedSeconds === 3600, String(r.body.elapsedSeconds));

// ---- rate limit (needs more than 40 puzzles, so add synthetic ones) ----
await sql(`insert into daily_puzzle (sequence, category, question, accepted_answers, answer_display, hints, explanation, puzzle_date)
           select 100 + n, 'Synthetic', 'Q' || n, array['x'], 'X', '[]'::jsonb, 'e', date '2026-01-01' + n from generate_series(0, 44) n`);
const R = newSession();
let blocked = null;
let opened = 0;
for (let n = 0; n < 45; n++) {
  const date = new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
  r = await call({ action: "start", sessionId: R, date }, NOW, "2026-01-01");
  if (r.status === 429) { blocked = n; break; }
  opened++;
}
check("R1 41st new puzzle in 24 hours is refused", blocked === 40 && opened === 40, `blocked at ${blocked}, opened ${opened}`);
check("R2 refusal is friendly and coded", r.body.code === "rate_limited" && /come back tomorrow/i.test(r.body.error));
r = await call({ action: "start", sessionId: R, date: "2026-01-02" }, NOW, "2026-01-01");
check("R3 resuming an already opened puzzle is still allowed", r.status === 200);
r = await call({ action: "start", sessionId: R, date: "2026-01-05" }, new Date(NOW.getTime() + 25 * 3600 * 1000), "2026-01-01");
check("R4 the limit resets after 24 hours", r.status === 200);
await sql("delete from daily_puzzle where sequence >= 100");

// ---- isolation from the daily game ----
const G = newSession();
await sql(`insert into game_sessions (session_id, puzzle_sequence, puzzle_date, attempts, completed, solved) values (${q(G)}, 6, '2026-10-20', 1, true, true)`);
const before = await sql("select md5(string_agg(t::text, ',')) from game_sessions t");
await call({ action: "start", sessionId: G, date: "2026-10-14" });
await call({ action: "guess", sessionId: G, date: "2026-10-14", answer: "piano" });
const after = await sql("select md5(string_agg(t::text, ',')) from game_sessions t");
check("I1 archive play never changes game_sessions (streaks and rankings read only that)", before === after);
check("I2 same browser can hold today's daily session and an archive play", (await store.getPlay(G, "2026-10-14")).solved === true);

// ---- database safety ----
let failed = false;
try { await sql(`update archive_plays set attempts = 4 where session_id = ${q(A)}`); } catch { failed = true; }
check("D1 database refuses more than three attempts", failed);
failed = false;
try { await sql(`update archive_plays set solved = true, completed = false where session_id = ${q(C)}`); } catch { failed = true; }
check("D2 database refuses solved without completed", failed);
failed = false;
try { await sql("set role anon; select count(*) from archive_plays"); } catch { failed = true; }
check("D3 the public (anon) role cannot read archive_plays", failed);
failed = false;
try { await sql("set role authenticated; insert into archive_plays (session_id, puzzle_date) values ('00000000-0000-4000-8000-0000000000aa', '2026-10-14')"); } catch { failed = true; }
check("D4 the authenticated role cannot write archive_plays", failed);
check("D5 row level security is on", (await sql("select relrowsecurity from pg_class where relname = 'archive_plays'")) === "t");

const passed = results.filter(Boolean).length;
console.log(`\n${passed} passed, ${results.length - passed} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
