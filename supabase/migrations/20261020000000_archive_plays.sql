-- =====================================================================
-- Brain Arcade: archive plays (release 2, the puzzle archive)
--
-- ADDITIVE ONLY. This creates one new table and two indexes. It does not
-- touch daily_puzzle or game_sessions, so the live game (the swift-task
-- function) is unaffected. Safe to run in production once reviewed.
--
-- WHY A SEPARATE TABLE
--   game_sessions has session_id as its primary key, so one browser can
--   hold only one row there. Archive play needs one row per browser per
--   past date. Keeping it apart also guarantees that archive play can
--   never change streaks or rankings, which only read game_sessions.
--
-- Written and read only by the archive-api Edge Function (service role).
-- Run in the SQL Editor of the STAGING project first.
-- =====================================================================

create table if not exists public.archive_plays (
    session_id      uuid         not null,
    puzzle_date     date         not null,
    puzzle_sequence integer,
    attempts        integer      not null default 0,
    hints_used      integer      not null default 0,
    hint_index      integer      not null default 0,
    completed       boolean      not null default false,
    solved          boolean      not null default false,
    started_at      timestamptz  not null default now(),
    completed_at    timestamptz,
    constraint archive_plays_pkey primary key (session_id, puzzle_date),
    -- Database-level safety net for the three-attempt rule.
    constraint archive_plays_attempts_range check (attempts between 0 and 3),
    constraint archive_plays_hints_range check (hints_used >= 0 and hint_index >= 0),
    constraint archive_plays_solved_needs_completed check (not solved or completed)
);

-- Used by the "how many puzzles has this browser opened recently" limit.
create index if not exists archive_plays_session_started_idx
    on public.archive_plays (session_id, started_at);

-- Used by future per-puzzle statistics.
create index if not exists archive_plays_puzzle_date_idx
    on public.archive_plays (puzzle_date);

-- Same lock-down as the other game tables: no policies, no browser access.
alter table public.archive_plays enable row level security;

revoke all on public.archive_plays from anon, authenticated;
