// Brain Arcade: archive-api Edge Function (release 2, the puzzle archive).
//
// Lets a player open and play PAST daily puzzles. It follows the same rules
// as the daily game: three attempts, hints do not use attempts, and the
// answer and explanation are sent only after the puzzle is completed.
//
// Archive play is kept in its own table (archive_plays), so it can never
// change streaks or rankings.
//
// Everything is in one file so it can be pasted into the Supabase dashboard.
// The game rules (handleArchive) take a small "store" object, which lets them
// be tested without a Supabase project.

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------
const DEFAULT_ARCHIVE_START = "2026-10-14"; // puzzle 1
const MAX_ATTEMPTS = 3;
const MAX_NEW_PLAYS_PER_DAY = 40; // new archive puzzles one browser may open per 24 hours
const MAX_ANSWER_LENGTH = 200;
const MAX_LIST_ROWS = 1000;

const SESSION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface PuzzleRow {
  sequence: number;
  puzzle_date: string;
  category: string;
  question: string;
  accepted_answers: string[];
  answer_display: string;
  hints: unknown;
  explanation: string;
  active: boolean;
}

export interface PlayRow {
  session_id: string;
  puzzle_date: string;
  puzzle_sequence: number | null;
  attempts: number;
  hints_used: number;
  hint_index: number;
  completed: boolean;
  solved: boolean;
  started_at: string;
  completed_at: string | null;
}

export interface Store {
  // Active puzzles with start <= date < endExclusive, oldest first.
  listPuzzleDates(
    start: string,
    endExclusive: string,
  ): Promise<Array<{ puzzle_date: string; sequence: number }>>;
  getPuzzle(date: string): Promise<PuzzleRow | null>;
  getPlay(sessionId: string, date: string): Promise<PlayRow | null>;
  countPlaysSince(sessionId: string, sinceIso: string): Promise<number>;
  // Insert a new play; do nothing if it already exists.
  insertPlay(row: {
    session_id: string;
    puzzle_date: string;
    puzzle_sequence: number;
  }): Promise<void>;
  // Update only if the play is still uncompleted AND still has the expected
  // counters (this is what makes attempts and hints safe against parallel
  // requests). Returns the updated row, or null if nothing matched.
  updatePlayIf(
    sessionId: string,
    date: string,
    expected: { attempts: number; hint_index: number },
    changes: Partial<PlayRow>,
  ): Promise<PlayRow | null>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
// Same rule as the daily game (swift-task). See docs/backend.md finding F3.
export const normalize = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKC").replace(/[^a-z0-9]/g, "");

export function todayInIndia(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function elapsedSeconds(startedAt: string, completedAt: string | null, now: Date) {
  const end = completedAt ? new Date(completedAt).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
}

function hintList(puzzle: PuzzleRow): string[] {
  return Array.isArray(puzzle.hints)
    ? (puzzle.hints as unknown[]).filter((hint): hint is string => typeof hint === "string")
    : [];
}

function fail(status: number, message: string, code?: string): Reply {
  return { status, body: code ? { error: message, code } : { error: message } };
}

// What the browser may see. The answer and explanation are added only once
// the play is completed, and never before.
function snapshot(play: PlayRow, puzzle: PuzzleRow, now: Date): Record<string, unknown> {
  const result: Record<string, unknown> = {
    puzzleDate: play.puzzle_date,
    puzzleNumber: puzzle.sequence,
    category: puzzle.category,
    question: puzzle.question,
    attempts: play.attempts,
    hintsUsed: play.hints_used,
    revealedHints: hintList(puzzle).slice(0, play.hint_index),
    completed: play.completed,
    solved: play.solved,
    elapsedSeconds: elapsedSeconds(play.started_at, play.completed_at, now),
  };

  if (play.completed) {
    result.answer = puzzle.answer_display;
    result.explanation = puzzle.explanation;
  }

  return result;
}

// ---------------------------------------------------------------------
// The game rules
// ---------------------------------------------------------------------
export async function handleArchive(
  input: Record<string, unknown>,
  store: Store,
  now: Date,
  archiveStart: string = DEFAULT_ARCHIVE_START,
): Promise<Reply> {
  const action = input.action;
  const today = todayInIndia(now);

  // LIST: which past days have a puzzle. No questions or answers.
  if (action === "list") {
    const rows = await store.listPuzzleDates(archiveStart, today);
    return {
      status: 200,
      body: {
        startDate: archiveStart,
        today,
        puzzles: rows.slice(0, MAX_LIST_ROWS).map((row) => ({
          date: row.puzzle_date,
          number: row.sequence,
        })),
      },
    };
  }

  if (action !== "start" && action !== "hint" && action !== "guess") {
    return fail(400, "Unknown action.");
  }

  const sessionId = input.sessionId;
  if (typeof sessionId !== "string" || !SESSION_PATTERN.test(sessionId)) {
    return fail(400, "Invalid game session.");
  }

  const date = input.date;
  if (typeof date !== "string" || !isRealDate(date)) {
    return fail(400, "Please choose a day from the calendar.");
  }

  // Only past days from the first archive day. Today's puzzle is the daily
  // game; future days must not be revealed or even confirmed to exist.
  if (date === today) {
    return fail(409, "Today's puzzle is played from the main page.", "use_daily");
  }
  if (date > today || date < archiveStart) {
    return fail(404, "There is no puzzle for that day.");
  }

  const puzzle = await store.getPuzzle(date);
  if (!puzzle || !puzzle.active) {
    return fail(404, "There is no puzzle for that day.");
  }

  // START: open (or resume) this puzzle.
  if (action === "start") {
    let play = await store.getPlay(sessionId, date);

    if (!play) {
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const recent = await store.countPlaysSince(sessionId, since);

      if (recent >= MAX_NEW_PLAYS_PER_DAY) {
        return fail(
          429,
          "You've opened a lot of puzzles today. Please come back tomorrow.",
          "rate_limited",
        );
      }

      await store.insertPlay({
        session_id: sessionId,
        puzzle_date: date,
        puzzle_sequence: puzzle.sequence,
      });
      play = await store.getPlay(sessionId, date);
    }

    if (!play) throw new Error("Could not create the archive play.");
    return { status: 200, body: snapshot(play, puzzle, now) };
  }

  // HINT and GUESS need a puzzle that was started first.
  const play = await store.getPlay(sessionId, date);
  if (!play) {
    return fail(404, "Please open this puzzle from the calendar first.");
  }

  if (play.completed) {
    return { status: 200, body: snapshot(play, puzzle, now) };
  }

  // HINT: reveal the next hint. Hints never use attempts.
  if (action === "hint") {
    const hints = hintList(puzzle);
    const hint = hints[play.hint_index];

    if (typeof hint !== "string") {
      return {
        status: 200,
        body: { ...snapshot(play, puzzle, now), hint: null, message: "No more hints are available." },
      };
    }

    const updated = await store.updatePlayIf(
      sessionId,
      date,
      { attempts: play.attempts, hint_index: play.hint_index },
      { hint_index: play.hint_index + 1, hints_used: play.hints_used + 1 },
    );

    if (!updated) {
      // Another request got there first. Show the current state; no hint is lost or charged twice.
      const current = (await store.getPlay(sessionId, date)) ?? play;
      return {
        status: 200,
        body: { ...snapshot(current, puzzle, now), hint: null, message: "Please try that again." },
      };
    }

    return { status: 200, body: { ...snapshot(updated, puzzle, now), hint } };
  }

  // GUESS: check the answer on the server.
  if (typeof input.answer !== "string" || !input.answer.trim()) {
    return fail(400, "Enter an answer first.");
  }
  if (input.answer.length > MAX_ANSWER_LENGTH) {
    return fail(400, "That answer is too long.");
  }

  const guess = normalize(input.answer);
  const accepted = Array.isArray(puzzle.accepted_answers) ? puzzle.accepted_answers : [];
  const isCorrect = guess !== "" &&
    accepted.some((answer) => normalize(answer) === guess);

  const nextAttempts = play.attempts + 1;
  const completed = isCorrect || nextAttempts >= MAX_ATTEMPTS;

  const updated = await store.updatePlayIf(
    sessionId,
    date,
    { attempts: play.attempts, hint_index: play.hint_index },
    {
      attempts: nextAttempts,
      completed,
      solved: isCorrect,
      completed_at: completed ? now.toISOString() : null,
    },
  );

  if (!updated) {
    // A parallel guess already used this attempt. Report the real state; do not charge another.
    const current = (await store.getPlay(sessionId, date)) ?? play;
    return {
      status: 200,
      body: {
        ...snapshot(current, puzzle, now),
        correct: current.solved,
        message: current.completed
          ? (current.solved ? "Correct!" : "No attempts remaining.")
          : "Please try that again.",
      },
    };
  }

  return {
    status: 200,
    body: {
      ...snapshot(updated, puzzle, now),
      correct: isCorrect,
      message: isCorrect
        ? "Correct!"
        : updated.completed
        ? "No attempts remaining."
        : "Not quite. Try again.",
    },
  };
}

// ---------------------------------------------------------------------
// Supabase store (used only when running as an Edge Function)
// ---------------------------------------------------------------------
async function makeSupabaseStore(url: string, serviceKey: string): Promise<Store> {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const check = <T>(result: { data: T; error: unknown }): T => {
    if (result.error) throw result.error;
    return result.data;
  };

  return {
    async listPuzzleDates(start, endExclusive) {
      return check(
        await db
          .from("daily_puzzle")
          .select("puzzle_date, sequence")
          .eq("active", true)
          .gte("puzzle_date", start)
          .lt("puzzle_date", endExclusive)
          .order("puzzle_date", { ascending: true })
          .limit(MAX_LIST_ROWS),
      ) as Array<{ puzzle_date: string; sequence: number }>;
    },

    async getPuzzle(date) {
      return check(
        await db
          .from("daily_puzzle")
          .select(
            "sequence, puzzle_date, category, question, accepted_answers, answer_display, hints, explanation, active",
          )
          .eq("puzzle_date", date)
          .maybeSingle(),
      ) as PuzzleRow | null;
    },

    async getPlay(sessionId, date) {
      return check(
        await db
          .from("archive_plays")
          .select("*")
          .eq("session_id", sessionId)
          .eq("puzzle_date", date)
          .maybeSingle(),
      ) as PlayRow | null;
    },

    async countPlaysSince(sessionId, sinceIso) {
      const { count, error } = await db
        .from("archive_plays")
        .select("session_id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .gte("started_at", sinceIso);
      if (error) throw error;
      return count ?? 0;
    },

    async insertPlay(row) {
      const { error } = await db
        .from("archive_plays")
        .upsert(row, { onConflict: "session_id,puzzle_date", ignoreDuplicates: true });
      if (error) throw error;
    },

    async updatePlayIf(sessionId, date, expected, changes) {
      return check(
        await db
          .from("archive_plays")
          .update(changes)
          .eq("session_id", sessionId)
          .eq("puzzle_date", date)
          .eq("completed", false)
          .eq("attempts", expected.attempts)
          .eq("hint_index", expected.hint_index)
          .select("*")
          .maybeSingle(),
      ) as PlayRow | null;
    },
  };
}

// ---------------------------------------------------------------------
// Web entry point (skipped when the file is imported by tests)
// ---------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
const deno = (globalThis as any).Deno;

if (deno && typeof deno.serve === "function") {
  const allowedOrigin = deno.env.get("ALLOWED_ORIGIN") ?? "https://prajaktao.github.io";
  const archiveStart = deno.env.get("ARCHIVE_START_DATE") ?? DEFAULT_ARCHIVE_START;

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  const send = (reply: Reply) =>
    new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let storePromise: Promise<Store> | null = null;

  deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return send(fail(405, "Use POST."));
    }

    try {
      const url = deno.env.get("SUPABASE_URL");
      const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!url || !serviceKey) {
        console.error("Missing Supabase server credentials.");
        return send(fail(500, "Server configuration error."));
      }

      storePromise ??= makeSupabaseStore(url, serviceKey);

      let input: unknown;
      try {
        input = await req.json();
      } catch {
        return send(fail(400, "Invalid request."));
      }

      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return send(fail(400, "Invalid request."));
      }

      return send(
        await handleArchive(
          input as Record<string, unknown>,
          await storePromise,
          new Date(),
          archiveStart,
        ),
      );
    } catch (error) {
      console.error("Brain Arcade archive error:", error);
      return send(fail(500, "Something went wrong. Please try again."));
    }
  });
}
