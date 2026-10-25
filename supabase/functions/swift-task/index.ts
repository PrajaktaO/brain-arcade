
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://prajaktao.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalize = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKC").replace(/[^a-z0-9]/g, "");

function getTodayIndia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getElapsedSeconds(
  startedAt: string,
  completedAt?: string | null,
): number {
  const end = completedAt
    ? new Date(completedAt).getTime()
    : Date.now();

  return Math.max(
    0,
    Math.floor((end - new Date(startedAt).getTime()) / 1000),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceKey) {
      console.error("Missing Supabase server credentials.");
      return json({ error: "Server configuration error." }, 500);
    }

    const db = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await req.json();
    const action = body.action;
    const sessionId = body.sessionId;

    if (
      typeof sessionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sessionId,
      )
    ) {
      return json({ error: "Invalid game session." }, 400);
    }

    const today = getTodayIndia();

    // Fetch the puzzle scheduled for a particular date.
    async function loadDailyPuzzle(
      puzzleDate: string,
      requireActive = false,
    ) {
      let query = db
        .from("daily_puzzle")
        .select(
          "sequence, puzzle_date, category, question, accepted_answers, answer_display, hints, explanation, active",
        )
        .eq("puzzle_date", puzzleDate);

      if (requireActive) {
        query = query.eq("active", true);
      }

      const { data, error } = await query.maybeSingle();

      if (error) throw error;

      return data;
    }

    async function loadSession() {
      const { data, error } = await db
        .from("game_sessions")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (error) throw error;

      return data;
    }

    async function makeResponse(session: any, reveal = false) {
      const puzzle = await loadDailyPuzzle(session.puzzle_date);

      if (!puzzle) {
        throw new Error(
          `Puzzle not found for ${session.puzzle_date}.`,
        );
      }

      const result: Record<string, unknown> = {
        puzzleDate: session.puzzle_date,
        category: puzzle.category,
        question: puzzle.question,
        attempts: session.attempts,
        hintsUsed: session.hints_used,
        completed: session.completed,
        solved: session.solved,
        elapsedSeconds: getElapsedSeconds(
          session.started_at,
          session.completed_at,
        ),
      };

      if (reveal && session.completed) {
        result.answer = puzzle.answer_display;
        result.explanation = puzzle.explanation;
      }

      return result;
    }

    // START: load today's scheduled puzzle and create a session.
    if (action === "start") {
      let session = await loadSession();

      if (session && session.puzzle_date !== today) {
        return json({
          error: "This session belongs to another day. Refresh the page.",
        }, 409);
      }

      if (!session) {
        const puzzle = await loadDailyPuzzle(today, true);

        if (!puzzle) {
          return json({
            error: "No active puzzle is scheduled for today.",
          }, 503);
        }

        const { data: created, error: insertError } = await db
          .from("game_sessions")
          .insert({
            session_id: sessionId,
            puzzle_sequence: puzzle.sequence,
            puzzle_date: today,
          })
          .select("*")
          .single();

        if (insertError) {
          // Another request may have created the session first.
          session = await loadSession();

          if (!session) throw insertError;
        } else {
          session = created;
        }
      }

      return json(await makeResponse(session, session.completed));
    }

    const session = await loadSession();

    if (!session || session.puzzle_date !== today) {
      return json({
        error: "Game session not found. Start today's game first.",
      }, 404);
    }

    if (session.completed) {
      return json(await makeResponse(session, true));
    }

    // HINT: return the next hint without exposing the answer.
    if (action === "hint") {
      const puzzle = await loadDailyPuzzle(session.puzzle_date);

      if (!puzzle) {
        throw new Error("Daily puzzle not found.");
      }

      const hints = Array.isArray(puzzle.hints) ? puzzle.hints : [];
      const hint = hints[session.hint_index];

      if (typeof hint !== "string") {
        return json({
          ...(await makeResponse(session)),
          hint: null,
          message: "No more hints are available.",
        });
      }

      const { data: updated, error: updateError } = await db
        .from("game_sessions")
        .update({
          hint_index: session.hint_index + 1,
          hints_used: session.hints_used + 1,
        })
        .eq("session_id", sessionId)
        .eq("completed", false)
        .select("*")
        .single();

      if (updateError) throw updateError;

      return json({
        ...(await makeResponse(updated)),
        hint,
      });
    }

    // GUESS: validate the answer on the server.
    if (action === "guess") {
      if (
        typeof body.answer !== "string" ||
        !body.answer.trim()
      ) {
        return json({ error: "Enter an answer first." }, 400);
      }

      const puzzle = await loadDailyPuzzle(session.puzzle_date);

      if (!puzzle) {
        throw new Error("Daily puzzle not found.");
      }

      const accepted = Array.isArray(puzzle.accepted_answers)
        ? puzzle.accepted_answers
        : [];

      const guess = normalize(body.answer);
      const isCorrect = accepted.some(
        (answer: string) => normalize(answer) === guess,
      );

      const nextAttempts = session.attempts + 1;
      const completed = isCorrect || nextAttempts >= 3;

      const { data: updated, error: updateError } = await db
        .from("game_sessions")
        .update({
          attempts: nextAttempts,
          completed,
          solved: isCorrect,
          completed_at: completed
            ? new Date().toISOString()
            : null,
        })
        .eq("session_id", sessionId)
        .eq("completed", false)
        .select("*")
        .maybeSingle();

      if (updateError) throw updateError;

      const finalSession = updated ?? await loadSession();

      if (!finalSession) {
        throw new Error("Could not load game session.");
      }

      return json({
        ...(await makeResponse(finalSession, finalSession.completed)),
        correct: isCorrect,
        message: isCorrect
          ? "Correct!"
          : finalSession.completed
            ? "No attempts remaining."
            : "Not quite. Try again.",
      });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Brain Arcade function error:", error);

    return json({
      error: "Something went wrong. Please try again.",
    }, 500);
  }
});
