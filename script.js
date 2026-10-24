
/*
  Brain Arcade frontend
  All puzzle answers are checked by the Supabase Edge Function.
  Never add a service-role or secret key to this file.
*/

const SUPABASE_URL = "https://medrzrkfuvufrqooegzl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QiA46lLVhKe2tk0m5_yJIA_kKmnv2WV";
const FUNCTION_NAME = "swift-task";

const $ = (id) => document.getElementById(id);

const welcomeScreen = $("welcome-screen");
const gameScreen = $("game-screen");
const completionScreen = $("completion-screen");

let sessionId = localStorage.getItem("brainArcadeSessionId");
let currentQuestion = "";
let elapsedSeconds = 0;
let timerStartedAt = 0;
let timerInterval = null;
let gameCompleted = false;

// Keep track of all hints already displayed.
let displayedHints = [];
let hintsExhausted = false;

// NEW: Google Analytics helper.
function trackAnalytics(eventName, parameters = {}) {
  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, parameters);
  }
}

// Record a failed request without sending any message text or identifier.
function trackError(action, error) {
  trackAnalytics("game_error", {
    game_name: "Brain Arcade",
    action,
    status_code: (error && error.status) || 0
  });
}

// NEW: Prevent duplicate events for the same session.
function trackAnalyticsOnce(eventName, parameters = {}) {
  if (!sessionId || typeof window.gtag !== "function") return;

  const storageKey = `brainArcadeAnalytics_${eventName}_${sessionId}`;

  try {
    if (localStorage.getItem(storageKey) === "1") return;

    trackAnalytics(eventName, parameters);
    localStorage.setItem(storageKey, "1");
  } catch (error) {
    // Analytics must never interrupt gameplay.
    trackAnalytics(eventName, parameters);
  }
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function startVisibleTimer(serverElapsedSeconds = 0) {
  clearInterval(timerInterval);

  elapsedSeconds = serverElapsedSeconds;
  timerStartedAt = Date.now();

  const update = () => {
    const total = elapsedSeconds +
      Math.floor((Date.now() - timerStartedAt) / 1000);

    $("timer").textContent = formatTime(total);
  };

  update();
  timerInterval = setInterval(update, 1000);
}

function stopVisibleTimer(serverElapsedSeconds) {
  clearInterval(timerInterval);
  timerInterval = null;

  if (Number.isFinite(serverElapsedSeconds)) {
    elapsedSeconds = serverElapsedSeconds;
  } else {
    elapsedSeconds += Math.floor((Date.now() - timerStartedAt) / 1000);
  }

  $("timer").textContent = formatTime(elapsedSeconds);
}

async function callGameFunction(action, extra = {}) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({
        action,
        sessionId,
        ...extra
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || "Unable to contact Brain Arcade.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function showError(message, target = "welcome-error") {
  $(target).textContent = message;
}

function clearFeedback() {
  $("feedback").textContent = "";
  $("feedback").className = "feedback";
}

function updateAttempts(data) {
  const remaining = Math.max(0, 3 - data.attempts);
  $("attempts").textContent = `Attempts remaining: ${remaining}`;
}

// Render all previously revealed hints together.
function renderHints() {
  const hintLines = displayedHints.map(
    (hint, index) => `Hint ${index + 1}: ${hint}`
  );

  if (hintsExhausted) {
    hintLines.push("No more hints available.");
  }

  $("hint-text").textContent = hintLines.join("\n\n");
  $("hint-box").hidden = hintLines.length === 0;
}

function displayGame(data) {
  currentQuestion = data.question;
  gameCompleted = Boolean(data.completed);

  $("category").textContent = data.category;
  $("question").textContent = data.question;
  updateAttempts(data);

  $("hint-box").hidden = true;
  $("hint-text").textContent = "";
  $("answer-input").value = "";
  $("answer-input").disabled = gameCompleted;
  $("submit-button").disabled = gameCompleted;

  // Reset hint display for a newly loaded game screen.
  displayedHints = [];
  hintsExhausted = false;
  $("hint-button").disabled = gameCompleted;
  $("hint-button").textContent = "Need a hint?";

  clearFeedback();

  welcomeScreen.hidden = true;
  completionScreen.hidden = true;
  gameScreen.hidden = false;

  startVisibleTimer(data.elapsedSeconds || 0);

  // NEW: Count a puzzle start once per session.
  if (!gameCompleted) {
    trackAnalyticsOnce("puzzle_started", {
      game_name: "Brain Arcade",
      puzzle_category: data.category,
      puzzle_date: data.puzzleDate
    });
  }

  // A player coming back to a puzzle that already has progress.
  if (data.completed || data.attempts > 0 || data.hintsUsed > 0) {
    trackAnalytics("puzzle_resumed", {
      game_name: "Brain Arcade",
      puzzle_date: data.puzzleDate,
      state: data.completed ? "completed" : "in_progress"
    });
  }

  if (gameCompleted) {
    renderCompletion(data);
  } else {
    $("answer-input").focus();
  }
}

function renderCompletion(data) {
  gameCompleted = true;
  stopVisibleTimer(data.elapsedSeconds);

  // NEW: Record the outcome once per session.
  trackAnalyticsOnce("puzzle_completed", {
    game_name: "Brain Arcade",
    puzzle_date: data.puzzleDate,
    solved: Boolean(data.solved),
    attempts_used: data.attempts,
    hints_used: data.hintsUsed || 0,
    completion_time_seconds: data.elapsedSeconds
  });

  gameScreen.hidden = true;
  completionScreen.hidden = false;

  $("completed-question").textContent = data.question || currentQuestion;
  $("completed-answer").textContent = data.answer || "Answer unavailable";
  $("completed-explanation").textContent =
    data.explanation || "No explanation is available.";

  $("completion-time").textContent = formatTime(data.elapsedSeconds || 0);

  if (data.solved) {
    $("completion-icon").textContent = "🏆";
    $("completion-eyebrow").textContent = "PUZZLE SOLVED";
    $("completion-title").textContent = "Congratulations!";
    $("completion-message").textContent =
      "Brilliant work! You solved today's puzzle. Come back tomorrow for another challenge.";
  } else {
    $("completion-icon").textContent = "💔";
    $("completion-eyebrow").textContent = "YOUR ATTEMPTS ARE OVER";
    $("completion-title").textContent = "Don't be disheartened!";
    $("completion-message").textContent =
      "Some puzzles take a different way of thinking. Keep practising, stay curious, and try again with tomorrow's challenge.";
  }

  renderShare(data);
  renderChallengeResult(data);
}

/*
  Result sharing (browser only).
  The message never contains the answer, the explanation or any identifier.
*/
const SHARE_CHOICE_KEY = "brainArcadeShareChoice";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let shareResult = null;

function pluralise(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function formatShortDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || "");
  if (!match) return "";

  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month}` : "";
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The link carries the player's chosen result so a friend can try to beat it:
//   ?d=2026-10-19&t=134        (time in seconds)
//   ?d=2026-10-19&a=2&h=1      (attempts and hints)
//   ?d=2026-10-19              (puzzle only, shared by a player who did not solve it)
// These values come from the link, are not verified, and are for friendly
// challenges only. They never contain the answer or any identifier.
function getShareLink(result, choice) {
  let url;

  try {
    url = new URL(window.location.href);
  } catch (error) {
    return window.location.href;
  }

  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/index\.html$/, "");

  if (result && DATE_PATTERN.test(result.puzzleDate || "")) {
    url.searchParams.set("d", result.puzzleDate);

    if (choice === "puzzle") {
      // Puzzle only: no result is attached.
    } else if (choice === "time") {
      url.searchParams.set("t", String(Math.round(result.elapsedSeconds)));
    } else {
      url.searchParams.set("a", String(result.attempts));
      url.searchParams.set("h", String(result.hintsUsed));
    }
  }

  return url.toString();
}

function parseWholeNumber(value, min, max) {
  if (!/^\d{1,6}$/.test(value || "")) return null;

  const number = Number(value);
  return number >= min && number <= max ? number : null;
}

// Read a friend's challenge from the page address. Anything invalid is ignored.
function readChallenge() {
  try {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("d") || "";
    const day = Number(date.slice(8, 10));

    if (!DATE_PATTERN.test(date) || !formatShortDate(date) || day < 1 || day > 31) return null;

    if (params.has("t")) {
      const seconds = parseWholeNumber(params.get("t"), 1, 999999);
      return seconds === null ? null : { type: "time", date, seconds };
    }

    if (params.has("a")) {
      const attempts = parseWholeNumber(params.get("a"), 1, 3);
      const hints = parseWholeNumber(params.get("h"), 0, 20);
      return attempts === null || hints === null ? null : { type: "attempts", date, attempts, hints };
    }

    if ([...params.keys()].every((key) => key === "d")) {
      return { type: "puzzle", date };
    }
  } catch (error) {
    // A bad link simply starts a normal game.
  }

  return null;
}

const challenge = readChallenge();

function todayInIndia() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (error) {
    return "";
  }
}

function getShareChoice() {
  if (shareResult && !shareResult.solved) return "puzzle";

  const selected = document.querySelector('input[name="share-content"]:checked');
  return selected && selected.value === "time" ? "time" : "attempts";
}

function puzzleName(isoDate) {
  const date = formatShortDate(isoDate);
  return date ? `the ${date} puzzle` : "today's puzzle";
}

function resultPhrase(result, choice) {
  if (choice === "time") {
    return `in ${formatTime(result.elapsedSeconds)}`;
  }

  const hints = result.hintsUsed > 0
    ? pluralise(result.hintsUsed, "hint", "hints")
    : "no hints";

  return `in ${pluralise(result.attempts, "try", "tries")} with ${hints}`;
}

function buildShareText(result, choice) {
  if (choice === "puzzle") {
    return `🧠 🧩 Brain Arcade\n\nI couldn't crack ${puzzleName(result.puzzleDate)}. Can you?`;
  }

  return `🧠 🧩 Brain Arcade\n\nI solved ${puzzleName(result.puzzleDate)} ${resultPhrase(result, choice)}. Can you beat that?`;
}

// The message and the link, with a blank line before the link.
function buildFullShare(result, choice) {
  return `${buildShareText(result, choice)}\n\n${getShareLink(result, choice)}`;
}

// ---- Receiving a challenge ----

function challengeAsResult() {
  return {
    puzzleDate: challenge.date,
    attempts: challenge.attempts,
    hintsUsed: challenge.hints,
    elapsedSeconds: challenge.seconds
  };
}

function renderChallengeBanner() {
  if (!challenge) return;

  const choice = challenge.type === "time" ? "time" : "attempts";
  let text = challenge.type === "puzzle"
    ? `Your friend couldn't crack ${puzzleName(challenge.date)}. Can you?`
    : `Your friend solved ${puzzleName(challenge.date)} ${resultPhrase(challengeAsResult(), choice)}. Can you beat that?`;

  const today = todayInIndia();
  if (today && today !== challenge.date) {
    text += " Today's puzzle is a new one, so a direct comparison isn't possible.";
  }

  $("challenge-banner").textContent = text;
  $("challenge-banner").hidden = false;

  trackAnalytics("challenge_opened", {
    game_name: "Brain Arcade",
    challenge_type: challenge.type
  });
}

// How did this player do against the friend's result? Fewer is better.
function compareWithChallenge(data) {
  if (!challenge || data.puzzleDate !== challenge.date) return null;
  if (challenge.type === "puzzle") return data.solved ? "cracked" : "also_unsolved";
  if (!data.solved) return "unsolved";

  const mine = challenge.type === "time"
    ? [data.elapsedSeconds]
    : [data.attempts, data.hintsUsed || 0];
  const theirs = challenge.type === "time"
    ? [challenge.seconds]
    : [challenge.attempts, challenge.hints];

  for (let index = 0; index < mine.length; index += 1) {
    if (mine[index] < theirs[index]) return "beat";
    if (mine[index] > theirs[index]) return "behind";
  }

  return "tied";
}

function renderChallengeResult(data) {
  const outcome = compareWithChallenge(data);
  const element = $("challenge-result");

  if (!outcome) {
    element.hidden = true;
    return;
  }

  const messages = {
    beat: "🎉 You beat your friend's result!",
    tied: "🤝 You matched your friend's result!",
    behind: "Your friend's result was a little better this time. Challenge them back!",
    unsolved: "Your friend solved this one. Try again with tomorrow's puzzle!",
    cracked: "🎉 You cracked the puzzle your friend couldn't!",
    also_unsolved: "This one was a tough one for both of you. Try again with tomorrow's puzzle!"
  };

  element.textContent = messages[outcome];
  element.hidden = false;

  trackAnalyticsOnce("challenge_completed", {
    game_name: "Brain Arcade",
    challenge_type: challenge.type,
    outcome
  });
}

function updateSharePreview() {
  if (!shareResult) return;

  $("share-preview").textContent = buildFullShare(shareResult, getShareChoice());
  setShareStatus("");
}

function setShareStatus(message, isError = false) {
  $("share-status").textContent = message;
  $("share-status").className = isError ? "share-status error" : "share-status";
}

function renderShare(data) {
  const panel = $("share-panel");

  // Players who solved it can share their result; others can share the puzzle only.
  shareResult = {
    solved: Boolean(data.solved),
    puzzleDate: data.puzzleDate,
    attempts: Math.max(1, Number(data.attempts) || 1),
    hintsUsed: Math.max(0, Number(data.hintsUsed) || 0),
    elapsedSeconds: Number.isFinite(data.elapsedSeconds) ? data.elapsedSeconds : 0
  };

  try {
    const saved = localStorage.getItem(SHARE_CHOICE_KEY);
    const radio = document.querySelector(`input[name="share-content"][value="${saved === "time" ? "time" : "attempts"}"]`);
    if (radio) radio.checked = true;
  } catch (error) {
    // A saved choice is only a convenience.
  }

  $("share-choice").hidden = !shareResult.solved;
  $("share-heading").textContent = shareResult.solved ? "Challenge a friend" : "Challenge a friend to try it";
  $("share-note").textContent = shareResult.solved
    ? "The link carries your result, so your friend can try to beat it."
    : "No result is shared. Your friend just gets the puzzle.";

  const canShare = typeof navigator.share === "function";
  $("share-button").hidden = !canShare;
  $("copy-button").className = canShare ? "secondary-button" : "primary-button";
  $("copy-button").textContent = canShare ? "Copy result" : "Copy result to share";

  updateSharePreview();
  panel.hidden = false;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    // Fall back to the older copy command for browsers without clipboard access.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (copyError) {
      copied = false;
    }

    document.body.removeChild(field);
    return copied;
  }
}

async function copyResult() {
  if (!shareResult) return;

  const choice = getShareChoice();
  const text = buildFullShare(shareResult, choice);
  const copied = await copyToClipboard(text);

  if (copied) {
    setShareStatus("Copied! Paste it into a chat to challenge someone.");
    trackAnalytics("share_result", {
      game_name: "Brain Arcade",
      method: "copy",
      content: choice
    });
  } else {
    setShareStatus("Couldn't copy automatically. Select the text above and copy it.", true);
  }
}

async function shareResultNatively() {
  if (!shareResult) return;

  const choice = getShareChoice();

  try {
    await navigator.share({
      title: "Brain Arcade",
      text: buildFullShare(shareResult, choice)
    });

    trackAnalytics("share_result", {
      game_name: "Brain Arcade",
      method: "native",
      content: choice
    });
  } catch (error) {
    // Closing the share sheet is not an error.
    if (error && error.name === "AbortError") {
      trackAnalytics("share_dismissed", {
        game_name: "Brain Arcade",
        content: choice
      });
      return;
    }
    await copyResult();
  }
}

function saveShareChoice() {
  try {
    localStorage.setItem(SHARE_CHOICE_KEY, getShareChoice());
  } catch (error) {
    // A saved choice is only a convenience.
  }

  updateSharePreview();

  trackAnalytics("share_choice_changed", {
    game_name: "Brain Arcade",
    content: getShareChoice()
  });
}

async function startGame() {
  const button = $("start-button");
  button.disabled = true;
  button.textContent = "Loading puzzle…";
  showError("");

  try {
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem("brainArcadeSessionId", sessionId);
    }

    let data;

    try {
      data = await callGameFunction("start");
    } catch (error) {
      // The saved session may belong to yesterday.
      if (error.status !== 409) throw error;

      sessionId = crypto.randomUUID();
      localStorage.setItem("brainArcadeSessionId", sessionId);
      data = await callGameFunction("start");
    }

    displayGame(data);
  } catch (error) {
    console.error(error);
    trackError("start", error);
    showError(
      `${error.message} Check your Supabase URL, publishable key and Edge Function deployment.`
    );
  } finally {
    button.disabled = false;
    button.textContent = "Start today's puzzle";
  }
}

async function submitAnswer(event) {
  event.preventDefault();

  if (gameCompleted) return;

  const input = $("answer-input");
  const answer = input.value.trim();

  if (!answer) {
    input.focus();
    return;
  }

  $("submit-button").disabled = true;
  $("hint-button").disabled = true;
  clearFeedback();
  $("feedback").textContent = "Checking your answer…";

  try {
    const data = await callGameFunction("guess", { answer });

    updateAttempts(data);
    startVisibleTimer(data.elapsedSeconds || 0);

    // NEW: Record each answer submission without sending the answer text.
    trackAnalytics("answer_submitted", {
      game_name: "Brain Arcade",
      puzzle_date: data.puzzleDate,
      is_correct: Boolean(data.correct),
      attempt_number: data.attempts
    });

    if (data.completed) {
      renderCompletion(data);
      return;
    }

    $("feedback").textContent = data.correct
      ? "Correct!"
      : data.message || "Not quite. Try again.";

    $("feedback").className =
      `feedback ${data.correct ? "success" : "error"}`;

    input.value = "";
    input.focus();
  } catch (error) {
    console.error(error);
    trackError("guess", error);
    $("feedback").textContent =
      `${error.message} Your answer may not have been recorded.`;
    $("feedback").className = "feedback error";
  } finally {
    if (!gameCompleted) {
      $("submit-button").disabled = false;
      $("hint-button").disabled = hintsExhausted;
    }
  }
}

async function requestHint() {
  if (gameCompleted || hintsExhausted) return;

  $("hint-button").disabled = true;
  $("feedback").textContent = "";

  try {
    const data = await callGameFunction("hint");

    updateAttempts(data);

    if (data.hint && data.hint.trim()) {
      const newHint = data.hint.trim();

      if (!displayedHints.includes(newHint)) {
        displayedHints.push(newHint);
      }

      renderHints();

      // NEW: Count a hint only when the server returns one.
      trackAnalytics("hint_used", {
        game_name: "Brain Arcade",
        puzzle_date: data.puzzleDate,
        hint_number: displayedHints.length
      });
    } else {
      hintsExhausted = true;
      renderHints();
      $("hint-button").textContent = "No more hints";
    }

    startVisibleTimer(data.elapsedSeconds || 0);
  } catch (error) {
    console.error(error);
    trackError("hint", error);
    $("feedback").textContent = error.message;
    $("feedback").className = "feedback error";
  } finally {
    if (!gameCompleted && !hintsExhausted) {
      $("hint-button").disabled = false;
    }
  }
}

$("start-button").addEventListener("click", startGame);
$("answer-form").addEventListener("submit", submitAnswer);
$("hint-button").addEventListener("click", requestHint);

document.querySelectorAll('input[name="share-content"]').forEach((radio) => {
  radio.addEventListener("change", saveShareChoice);
});
$("share-button").addEventListener("click", shareResultNatively);
$("copy-button").addEventListener("click", copyResult);

renderChallengeBanner();
