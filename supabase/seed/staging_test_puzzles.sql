-- =====================================================================
-- Brain Arcade: TEST puzzles for the STAGING Supabase project only.
--
-- DO NOT RUN THIS IN PRODUCTION.
--   These are made-up test puzzles. Sequences 1 to 12 and the dates
--   14 to 25 October 2026 overlap with real puzzles. In production this
--   statement fails on the first clash and inserts nothing (it is one
--   INSERT, so it is all or nothing), but do not rely on that.
--
-- Run it once in the SQL Editor of the staging project, after the
-- baseline schema (supabase/migrations/20261017000000_baseline_current_schema.sql).
--
-- Puzzle n is scheduled for 13 October 2026 + n days, so puzzle 1 is
-- 14 October and puzzle 12 is 25 October (Asia/Kolkata calendar dates).
-- =====================================================================

insert into public.daily_puzzle
  (sequence, category, question, accepted_answers, answer_display, hints, explanation, puzzle_date)
values
  (1,  'Test riddles', 'What has keys but cannot open locks?',
       array['piano','a piano'], 'A piano',
       '["It makes music.","You press its keys with your fingers."]'::jsonb,
       'A piano has keys, but they play notes. They cannot open anything.', '2026-10-14'),
  (2,  'Test riddles', 'The more you take, the more you leave behind. What am I?',
       array['footsteps','steps','footprints'], 'Footsteps',
       '["Think about walking.","You leave them on sand."]'::jsonb,
       'Every step you take leaves another footstep behind you.', '2026-10-15'),
  (3,  'Test riddles', 'What gets wetter the more it dries?',
       array['towel','a towel'], 'A towel',
       '["You use it after a bath."]'::jsonb,
       'A towel dries you, and in doing so it gets wet.', '2026-10-16'),
  (4,  'Test riddles', 'I speak without a mouth and hear without ears. What am I?',
       array['echo','an echo'], 'An echo',
       '["You can make one in a canyon.","It repeats what you shout."]'::jsonb,
       'An echo repeats sound without having a mouth or ears.', '2026-10-17'),
  (5,  'Test riddles', 'What has hands but cannot clap?',
       array['clock','a clock','watch','a watch'], 'A clock',
       '["It tells you something all day.","Its hands move in circles."]'::jsonb,
       'A clock has hands that point to the time, but they cannot clap.', '2026-10-18'),
  (6,  'Test riddles', 'What can travel around the world while staying in a corner?',
       array['stamp','a stamp','postage stamp','a postage stamp'], 'A stamp',
       '["You find it on an envelope."]'::jsonb,
       'A stamp sits in the corner of a letter while the letter travels the world.', '2026-10-19'),
  (7,  'Test riddles', 'What has a head and a tail but no body?',
       array['coin','a coin'], 'A coin',
       '["You can flip it.","It helps you decide."]'::jsonb,
       'A coin has a head side and a tail side.', '2026-10-20'),
  (8,  'Test riddles', 'What goes up but never comes down?',
       array['age','your age'], 'Your age',
       '["It increases every year."]'::jsonb,
       'Your age only ever goes up.', '2026-10-21'),
  (9,  'Test riddles', 'What begins with T, ends with T, and has T in it?',
       array['teapot','a teapot'], 'A teapot',
       '["You pour from it.","It is usually found in a kitchen."]'::jsonb,
       'A teapot begins with T, ends with T, and holds tea.', '2026-10-22'),
  (10, 'Test riddles', 'What can you catch but not throw?',
       array['cold','a cold'], 'A cold',
       '["It makes you sneeze."]'::jsonb,
       'You can catch a cold, but you cannot throw it.', '2026-10-23'),
  (11, 'Test riddles', 'What has many teeth but cannot bite?',
       array['comb','a comb'], 'A comb',
       '["You use it on your hair."]'::jsonb,
       'A comb has teeth, but they only untangle hair.', '2026-10-24'),
  (12, 'Test riddles', 'What building has the most stories?',
       array['library','a library'], 'A library',
       '["Think of a different meaning of the word stories.","You can borrow things there."]'::jsonb,
       'A library holds the most stories (books), not floors.', '2026-10-25');
