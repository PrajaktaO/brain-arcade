
/*
  Brain Arcade frontend
  All puzzle answers are checked by the Supabase Edge Function.
  Never add a service-role or secret key to this file.
*/

const SUPABASE_URL = "https://medrzrkfuvufrqooegzl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QiA46lLVhKe2tk0m5_yJIA_kKmnv2WV";
const FUNCTION_NAME = "swift-task";
const ARCHIVE_FUNCTION_NAME = "archive-api";

// Past puzzles are built but switched off until the archive backend is live.
const ARCHIVE_ENABLED = false;

const $ = (id) => document.getElementById(id);

const welcomeScreen = $("welcome-screen");
const gameScreen = $("game-screen");
const completionScreen = $("completion-screen");
const archiveScreen = $("archive-screen");

let sessionId = localStorage.getItem("brainArcadeSessionId");
let currentQuestion = "";
let elapsedSeconds = 0;
let timerStartedAt = 0;
let timerInterval = null;
let gameCompleted = false;

// Keep track of all hints already displayed.
let displayedHints = [];
let hintsExhausted = false;

// Empty while playing today's puzzle; the date (YYYY-MM-DD) while playing a past one.
let archiveDate = "";

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
function trackAnalyticsOnce(eventName, parameters = {}, keySuffix = "") {
  if (!sessionId || typeof window.gtag !== "function") return;

  const storageKey = `brainArcadeAnalytics_${eventName}${keySuffix}_${sessionId}`;

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

async function postFunction(functionName, payload) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || "Unable to contact Brain Arcade.");
    error.status = response.status;
    error.code = data.code || "";
    throw error;
  }

  return data;
}

// Daily puzzle, or the past puzzle in archiveDate.
async function callGameFunction(action, extra = {}) {
  if (archiveDate) {
    return postFunction(ARCHIVE_FUNCTION_NAME, { action, sessionId, date: archiveDate, ...extra });
  }

  return postFunction(FUNCTION_NAME, { action, sessionId, ...extra });
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

  // Reset hint display for a newly loaded game screen. A resumed past puzzle brings its shown hints back.
  displayedHints = Array.isArray(data.revealedHints) ? data.revealedHints.filter((hint) => typeof hint === "string") : [];
  hintsExhausted = false;
  $("hint-button").disabled = gameCompleted;
  $("hint-button").textContent = "Need a hint?";

  clearFeedback();

  renderHints();

  const number = puzzleNumber(data.puzzleDate);
  $("game-eyebrow").textContent = archiveDate && number ? `PUZZLE #${number}` : "TODAY'S CHALLENGE";
  $("archive-back-button").hidden = !archiveDate;
  $("share-puzzle-button").hidden = !archiveDate;
  $("share-puzzle-button").textContent = "Share this puzzle";

  welcomeScreen.hidden = true;
  completionScreen.hidden = true;
  archiveScreen.hidden = true;
  gameScreen.hidden = false;

  startVisibleTimer(data.elapsedSeconds || 0);

  // Past puzzles have their own events, so they never change the daily numbers.
  if (archiveDate) {
    if (!gameCompleted) {
      trackAnalyticsOnce("archive_started", {
        game_name: "Brain Arcade",
        puzzle_date: data.puzzleDate,
        puzzle_number: number
      }, `_${data.puzzleDate}`);
    }
  } else if (!gameCompleted) {
    // NEW: Count a puzzle start once per session.
    trackAnalyticsOnce("puzzle_started", {
      game_name: "Brain Arcade",
      puzzle_category: data.category,
      puzzle_date: data.puzzleDate
    });
  }

  // A player coming back to a puzzle that already has progress.
  if (!archiveDate && (data.completed || data.attempts > 0 || data.hintsUsed > 0)) {
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
  trackAnalyticsOnce(archiveDate ? "archive_completed" : "puzzle_completed", {
    game_name: "Brain Arcade",
    puzzle_date: data.puzzleDate,
    solved: Boolean(data.solved),
    attempts_used: data.attempts,
    hints_used: data.hintsUsed || 0,
    completion_time_seconds: data.elapsedSeconds
  }, archiveDate ? `_${data.puzzleDate}` : "");

  const number = puzzleNumber(data.puzzleDate);
  $("solution-eyebrow").textContent = archiveDate ? "THIS PUZZLE" : "TODAY'S PUZZLE";
  $("archive-nav").hidden = !ARCHIVE_ENABLED;
  $("archive-nav-today").hidden = !archiveDate;
  $("archive-nav-calendar").textContent = archiveDate ? "Pick another puzzle" : "Play past puzzles";
  $("closing-note").textContent = archiveDate
    ? "Past puzzles count towards your record, but never change today's streak or rankings."
    : "Thanks for playing Brain Arcade. See you for the next daily challenge!";

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
    $("completion-message").textContent = archiveDate
      ? `Brilliant work! You solved ${number ? `puzzle #${number}` : "this puzzle"}.`
      : "Brilliant work! You solved today's puzzle. Come back tomorrow for another challenge.";
  } else {
    $("completion-icon").textContent = "💔";
    $("completion-eyebrow").textContent = "YOUR ATTEMPTS ARE OVER";
    $("completion-title").textContent = "Don't be disheartened!";
    $("completion-message").textContent = archiveDate
      ? "Some puzzles take a different way of thinking. Try another one from the calendar."
      : "Some puzzles take a different way of thinking. Keep practising, stay curious, and try again with tomorrow's challenge.";
  }

  recordResult(data);

  renderShare(data);
  renderChallengeResult(data);
}

/*
  Result sharing (browser only).
  The message never contains the answer, the explanation or any identifier.
*/
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let shareResult = null;

const SHARE_NOTES = {
  result: "The link carries your result, so your friend can try to beat it.",
  puzzle: "No result is shared. Your friend just gets the puzzle.",
  record: "Only your totals are shared. The link opens the game."
};

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

  if (choice !== "record" && result && DATE_PATTERN.test(result.puzzleDate || "")) {
    url.searchParams.set("d", result.puzzleDate);

    if (choice === "puzzle") {
      // Puzzle only: no result is attached.
    } else {
      url.searchParams.set("a", String(result.attempts));
      url.searchParams.set("h", String(result.hintsUsed));
      url.searchParams.set("t", String(Math.max(1, Math.round(result.elapsedSeconds))));
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

    if (params.has("t") && params.has("a")) {
      const seconds = parseWholeNumber(params.get("t"), 1, 999999);
      const attempts = parseWholeNumber(params.get("a"), 1, 3);
      const hints = parseWholeNumber(params.get("h"), 0, 20);
      return seconds === null || attempts === null || hints === null ? null : { type: "result", date, seconds, attempts, hints };
    }

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

// Nothing to choose: a solved puzzle shares the whole result, a failed one shares the puzzle.
function getShareChoice() {
  return shareResult && !shareResult.solved ? "puzzle" : "result";
}

// Puzzle 1 was 14 Oct 2026 and the numbers follow the calendar.
function puzzleNumber(isoDate) {
  if (!DATE_PATTERN.test(isoDate || "")) return 0;

  const number = daysBetween(PUZZLE_ONE_DATE, isoDate) + 1;
  return number >= 1 ? number : 0;
}

// No puzzle numbers: anyone can start on any day and never feels late.
function puzzleName(isoDate) {
  if (isoDate && isoDate === todayInIndia()) return "today's puzzle";

  const date = formatShortDate(isoDate);
  return date ? `the ${date} puzzle` : "today's puzzle";
}

function shareHeader() {
  return "🧠 🧩 Brain Arcade";
}

function resultPhrase(result, choice) {
  if (choice === "time") {
    return `in ${formatTime(result.elapsedSeconds)}`;
  }

  if (choice === "result") {
    const hintText = result.hintsUsed > 0 ? pluralise(result.hintsUsed, "hint", "hints") : "no hints";
    return `in ${pluralise(result.attempts, "try", "tries")} with ${hintText}, taking ${formatTime(result.elapsedSeconds)}`;
  }

  const hints = result.hintsUsed > 0
    ? pluralise(result.hintsUsed, "hint", "hints")
    : "no hints";

  return `in ${pluralise(result.attempts, "try", "tries")} with ${hints}`;
}

function buildShareText(result, choice) {
  if (choice === "puzzle") {
    return `${shareHeader(result.puzzleDate)}\n\nI couldn't crack this one. Can you?`;
  }

  return `${shareHeader(result.puzzleDate)}\n\nI solved it ${resultPhrase(result, choice)}. Can you beat that?`;
}

// The message and the link, with a blank line before the link.
function buildFullShare(result, choice) {
  return `${buildShareText(result, choice)}\n\n${getShareLink(result, choice)}`;
}

/*
  Personal record (browser only): "Out of 15 puzzles so far, you've played 14
  and solved 12." It is kept in this browser, is not verified and never leaves
  it. Counting starts from the day it was introduced, because earlier days
  were not recorded here. A puzzle is counted once, on the day it is finished.
*/
const RECORD_KEY = "brainArcadeRecord";
const PUZZLE_ONE_DATE = "2026-10-14";

function readRecord() {
  try {
    const stored = JSON.parse(localStorage.getItem(RECORD_KEY) || "{}");
    return stored && typeof stored.puzzles === "object" && stored.puzzles ? stored.puzzles : {};
  } catch (error) {
    return {};
  }
}

function recordResult(data) {
  if (!data || !DATE_PATTERN.test(data.puzzleDate || "")) return;

  const puzzles = readRecord();
  puzzles[data.puzzleDate] = {
    s: data.solved ? 1 : 0,
    a: Number(data.attempts) || 0,
    h: Number(data.hintsUsed) || 0,
    t: Math.round(Number(data.elapsedSeconds) || 0)
  };

  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify({ v: 1, puzzles }));
  } catch (error) {
    // The record is only a convenience.
  }
}

function daysBetween(fromIso, toIso) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
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

// A friend's link to a puzzle from the archive opens that puzzle.
function challengeIsPastPuzzle() {
  const today = todayInIndia();
  return Boolean(ARCHIVE_ENABLED && challenge && today && challenge.date >= PUZZLE_ONE_DATE && challenge.date < today);
}

function startButtonLabel() {
  if (challengeIsPastPuzzle()) return `Play ${puzzleName(challenge.date)}`;
  return "Start today's puzzle";
}

function renderChallengeBanner() {
  if (!challenge) return;

  const choice = challenge.type === "result" ? "result" : challenge.type === "time" ? "time" : "attempts";
  let text = challenge.type === "puzzle"
    ? `Your friend couldn't crack ${puzzleName(challenge.date)}. Can you?`
    : `Your friend solved ${puzzleName(challenge.date)} ${resultPhrase(challengeAsResult(), choice)}. Can you beat that?`;

  if (challengeIsPastPuzzle()) {
    text += " Tap the button to play it.";
  } else {
    const today = todayInIndia();
    if (today && today !== challenge.date) {
      text += " Today's puzzle is a new one, so a direct comparison isn't possible.";
    }
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

  // Fewer tries wins, then fewer hints, then the faster time.
  const mine = challenge.type === "time"
    ? [data.elapsedSeconds]
    : challenge.type === "result"
      ? [data.attempts, data.hintsUsed || 0, data.elapsedSeconds]
      : [data.attempts, data.hintsUsed || 0];
  const theirs = challenge.type === "time"
    ? [challenge.seconds]
    : challenge.type === "result"
      ? [challenge.attempts, challenge.hints, challenge.seconds]
      : [challenge.attempts, challenge.hints];

  for (let index = 0; index < mine.length; index += 1) {
    if (mine[index] < theirs[index]) return "beat";
    if (mine[index] > theirs[index]) return "behind";
  }

  return "tied";
}

let lastChallengeOutcome = "";

function renderChallengeResult(data) {
  const outcome = compareWithChallenge(data);
  const element = $("challenge-result");
  lastChallengeOutcome = outcome || "";

  if (!outcome) {
    element.hidden = true;
    $("rematch-button").hidden = true;
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
  $("rematch-button").hidden = false;

  trackAnalyticsOnce("challenge_completed", {
    game_name: "Brain Arcade",
    challenge_type: challenge.type,
    outcome
  });
}

function updateSharePreview() {
  if (!shareResult) return;

  const choice = getShareChoice();
  const full = buildFullShare(shareResult, choice);

  $("share-preview").textContent = full;
  $("share-note").textContent = SHARE_NOTES[choice] || SHARE_NOTES.result;
  setShareStatus("");
  renderShareImage();
}

/*
  The picture players share: tries, hints and time on a card.
  It never contains the answer, the explanation or any identifier.
*/
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const CARD_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
let shareImage = null;

function roundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function siteAddress() {
  try {
    const url = new URL(getShareLink(null, "record"));
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch (error) {
    return "Brain Arcade";
  }
}

function drawShareCard(result) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const solved = Boolean(result.solved);
  const center = CARD_WIDTH / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  background.addColorStop(0, "#e6e1ff");
  background.addColorStop(1, "#f8f6ff");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = "rgba(101, 88, 211, 0.10)";
  [[110, 120, 190], [980, 300, 140], [1000, 1180, 220], [60, 1230, 120]].forEach(([x, y, radius]) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#20243a";
  ctx.font = `800 92px ${CARD_FONT}`;
  ctx.fillText("Brain Arcade", center, 250);
  ctx.font = `110px ${CARD_FONT}`;
  ctx.fillText("🧠 🧩", center, 150);

  ctx.save();
  ctx.shadowColor = "rgba(60, 50, 140, 0.18)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#ffffff";
  roundedRectPath(ctx, 90, 330, 900, 700, 56);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#20243a";
  ctx.font = `120px ${CARD_FONT}`;
  ctx.fillText(solved ? "🏆" : "🧩", center, 490);
  ctx.font = `800 84px ${CARD_FONT}`;
  ctx.fillText(solved ? "Solved it!" : "Tough one!", center, 610);

  const tiles = [
    ["Tries", String(result.attempts)],
    ["Hints", String(result.hintsUsed)],
    ["Time", formatTime(result.elapsedSeconds)]
  ];
  const tileWidth = 260;
  const gap = 22;
  const startX = 90 + (900 - (tileWidth * 3 + gap * 2)) / 2;

  tiles.forEach(([label, value], index) => {
    const x = startX + index * (tileWidth + gap);
    ctx.fillStyle = "#f1efff";
    roundedRectPath(ctx, x, 665, tileWidth, 190, 32);
    ctx.fill();
    ctx.fillStyle = "#5144ba";
    ctx.font = `800 78px ${CARD_FONT}`;
    ctx.fillText(value, x + tileWidth / 2, 770);
    ctx.fillStyle = "#6d7285";
    ctx.font = `600 34px ${CARD_FONT}`;
    ctx.fillText(label, x + tileWidth / 2, 825);
  });

  ctx.fillStyle = "#20243a";
  ctx.font = `800 62px ${CARD_FONT}`;
  ctx.fillText(solved ? "Can you beat that?" : "Can you crack it?", center, 955);

  ctx.fillStyle = "#6558d3";
  roundedRectPath(ctx, 120, 1100, 840, 96, 48);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 40px ${CARD_FONT}`;
  ctx.fillText(siteAddress(), center, 1162);

  ctx.fillStyle = "#6d7285";
  ctx.font = `500 34px ${CARD_FONT}`;
  ctx.fillText("One puzzle a day. Three attempts.", center, 1270);

  return canvas;
}

function renderShareImage() {
  if (!shareResult) return;

  const target = shareResult;
  const canvas = drawShareCard(target);
  const image = $("share-image");

  const finish = (blob) => {
    if (target !== shareResult) return;

    if (shareImage) URL.revokeObjectURL(shareImage.url);
    shareImage = blob ? { blob, url: URL.createObjectURL(blob) } : null;

    image.hidden = !shareImage;
    $("save-button").hidden = !shareImage;
    if (shareImage) {
      image.src = shareImage.url;
      image.alt = buildShareText(target, getShareChoice()).replace(/\s*\n+\s*/g, " ");
    }
  };

  if (!canvas || typeof canvas.toBlob !== "function") {
    finish(null);
    return;
  }

  canvas.toBlob((blob) => finish(blob), "image/png");
}

// Instagram and similar apps drop links that travel with a picture,
// so the bare link is copied to the clipboard, ready for a link sticker or the bio.
async function copyLinkOnly() {
  if (!shareResult) return false;
  return copyToClipboard(getShareLink(shareResult, getShareChoice()));
}

async function saveShareImage() {
  if (!shareImage) return;

  const linkCopied = await copyLinkOnly();

  const link = document.createElement("a");
  link.href = shareImage.url;
  link.download = "brain-arcade-result.png";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setShareStatus(linkCopied
    ? "Image saved and link copied. On Instagram, add the link with a Link sticker on your story. On WhatsApp, paste it under your status."
    : "Image saved. Use the Copy button to get the link.");
  trackAnalytics("share_result", {
    game_name: "Brain Arcade",
    method: "save_image",
    content: getShareChoice()
  });
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

  $("share-heading").textContent = shareResult.solved ? "Challenge a friend" : "Challenge a friend to try it";

  const canShare = typeof navigator.share === "function";
  $("share-button").hidden = !canShare;
  $("copy-button").className = canShare ? "secondary-button" : "primary-button";
  $("copy-button").textContent = canShare ? "Copy text" : "Copy to share";

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
    setShareStatus("Couldn't copy automatically. Please try again.", true);
  }
}

async function shareResultNatively() {
  if (!shareResult) return;

  const choice = getShareChoice();

  const payload = {
    title: "Brain Arcade",
    text: buildFullShare(shareResult, choice)
  };

  // Instagram ignores the text that travels with a picture, so copy the link as well.
  const linkCopied = await copyLinkOnly();

  // Send the picture where the phone supports it; the text and link travel with it.
  try {
    if (shareImage && typeof File === "function" && typeof navigator.canShare === "function") {
      const file = new File([shareImage.blob], "brain-arcade-result.png", { type: "image/png" });
      if (navigator.canShare({ files: [file] })) payload.files = [file];
    }
  } catch (error) {
    delete payload.files;
  }

  try {
    await navigator.share(payload);

    trackAnalytics("share_result", {
      game_name: "Brain Arcade",
      method: "native",
      content: choice,
      format: payload.files ? "image" : "text"
    });

    if (payload.files && linkCopied) {
      setShareStatus("Link copied too. If an app (like Instagram) drops it, paste it as a link sticker or in the caption.");
    }
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

// One tap from "your friend did better" to a new challenge.
async function challengeBack() {
  if (!shareResult) return;

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("share-panel").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });

  trackAnalytics("challenge_rematch", {
    game_name: "Brain Arcade",
    outcome: lastChallengeOutcome || "none"
  });

  if (typeof navigator.share === "function") {
    await shareResultNatively();
  } else {
    await copyResult();
  }
}

async function startGame() {
  if (challengeIsPastPuzzle()) {
    await startArchivePuzzle(challenge.date, "welcome-error", "start-button");
    return;
  }

  archiveDate = "";
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
    button.textContent = startButtonLabel();
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
    if (!archiveDate) {
      trackAnalytics("answer_submitted", {
        game_name: "Brain Arcade",
        puzzle_date: data.puzzleDate,
        is_correct: Boolean(data.correct),
        attempt_number: data.attempts
      });
    }

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
      if (!archiveDate) {
        trackAnalytics("hint_used", {
          game_name: "Brain Arcade",
          puzzle_date: data.puzzleDate,
          hint_number: displayedHints.length
        });
      }
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

/*
  The archive: a calendar of past puzzles (puzzle 1 was 14 Oct 2026).
  Progress for each day is kept in the browser's personal record.
*/
let archiveList = null;
let calendarMonth = "";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function showOnly(screen) {
  [welcomeScreen, gameScreen, completionScreen, archiveScreen].forEach((element) => {
    element.hidden = element !== screen;
  });
}

function leaveGame() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function showWelcome() {
  leaveGame();
  archiveDate = "";
  showOnly(welcomeScreen);
  $("start-button").textContent = startButtonLabel();
}

function monthOf(isoDate) {
  return isoDate.slice(0, 7);
}

function shiftMonth(month, delta) {
  const [year, number] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
}

function renderCalendar() {
  if (!archiveList) return;

  const puzzles = new Map(archiveList.puzzles.map((puzzle) => [puzzle.date, puzzle]));
  const record = readRecord();
  const [year, monthNumber] = calendarMonth.split("-").map(Number);
  const firstMonth = monthOf(archiveList.startDate);
  const lastMonth = monthOf(archiveList.today);

  $("calendar-title").textContent = `${MONTH_NAMES[monthNumber - 1]} ${year}`;
  $("calendar-prev").disabled = calendarMonth <= firstMonth;
  $("calendar-next").disabled = calendarMonth >= lastMonth;

  const grid = $("calendar-grid");
  grid.replaceChildren();

  WEEKDAYS.forEach((name) => {
    const head = document.createElement("span");
    head.className = "cal-weekday";
    head.textContent = name;
    head.setAttribute("aria-hidden", "true");
    grid.append(head);
  });

  const leading = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  for (let index = 0; index < leading; index += 1) {
    const blank = document.createElement("span");
    blank.className = "cal-blank";
    grid.append(blank);
  }

  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const puzzle = puzzles.get(iso);
    const isToday = iso === archiveList.today;
    const entry = record[iso];
    let cell;

    if (puzzle || isToday) {
      cell = document.createElement("button");
      cell.type = "button";
      cell.dataset.date = iso;
      cell.className = "cal-day";

      const number = puzzle ? puzzle.number : puzzleNumber(iso);
      const state = isToday ? "today" : entry ? (entry.s ? "solved" : "played") : "new";
      if (isToday) cell.classList.add("cal-today");
      if (state === "solved") cell.classList.add("cal-solved");
      if (state === "played") cell.classList.add("cal-played");

      const mark = state === "solved" ? "✓" : state === "played" ? "✗" : isToday ? "•" : "";
      cell.innerHTML = "";
      const label = document.createElement("strong");
      label.textContent = String(day);
      const small = document.createElement("small");
      small.textContent = mark;
      cell.append(label, small);

      const names = { solved: "solved", played: "not solved", new: "not played yet", today: "today's puzzle" };
      cell.setAttribute("aria-label", `Puzzle ${number}, ${day} ${MONTHS[monthNumber - 1]}, ${names[state]}`);
    } else {
      cell = document.createElement("span");
      cell.className = "cal-day cal-off";
      const label = document.createElement("strong");
      label.textContent = String(day);
      cell.append(label);
      cell.setAttribute("aria-hidden", "true");
    }

    grid.append(cell);
  }
}

async function openArchive(trackOpen = true) {
  leaveGame();
  archiveDate = "";
  showOnly(archiveScreen);
  $("archive-error").textContent = "";
  $("archive-retry-button").hidden = true;
  $("calendar-grid").setAttribute("aria-busy", "true");

  if (trackOpen) trackAnalytics("archive_opened", { game_name: "Brain Arcade" });

  try {
    archiveList = await postFunction(ARCHIVE_FUNCTION_NAME, { action: "list" });

    if (!calendarMonth || calendarMonth < monthOf(archiveList.startDate) || calendarMonth > monthOf(archiveList.today)) {
      const latest = archiveList.puzzles.length ? archiveList.puzzles[archiveList.puzzles.length - 1].date : archiveList.today;
      calendarMonth = monthOf(latest);
    }

    renderCalendar();
  } catch (error) {
    console.error(error);
    trackError("archive_list", error);
    archiveList = null;
    $("calendar-grid").replaceChildren();
    $("archive-error").textContent = "Couldn't load the past puzzles. Please check your connection and try again.";
    $("archive-retry-button").hidden = false;
  } finally {
    $("calendar-grid").removeAttribute("aria-busy");
  }
}

async function startArchivePuzzle(date, errorTarget = "archive-error", busyButton = "") {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("brainArcadeSessionId", sessionId);
  }

  const button = busyButton ? $(busyButton) : null;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading puzzle…";
  }
  showError("", errorTarget);
  archiveDate = date;

  try {
    displayGame(await callGameFunction("start"));
  } catch (error) {
    console.error(error);
    trackError("archive_start", error);
    archiveDate = "";

    if (error.code === "use_daily") {
      showWelcome();
      return;
    }

    showError(
      error.code === "rate_limited"
        ? "That's a lot of new puzzles for one day. Please come back tomorrow."
        : "Couldn't open that puzzle. Please try again.",
      errorTarget
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = startButtonLabel();
    }
  }
}

async function sharePuzzleInvite() {
  if (!archiveDate) return;

  const text = `${shareHeader(archiveDate)}\n\nCan you solve this one?\n\n${getShareLink({ puzzleDate: archiveDate }, "puzzle")}`;
  let method = "copy";

  try {
    if (typeof navigator.share === "function") {
      method = "native";
      await navigator.share({ title: "Brain Arcade", text });
    } else {
      if (!(await copyToClipboard(text))) throw new Error("copy failed");
      $("share-puzzle-button").textContent = "Link copied ✓";
    }

    trackAnalytics("share_result", { game_name: "Brain Arcade", method, content: "puzzle_invite" });
  } catch (error) {
    if (error && error.name === "AbortError") return;
    $("share-puzzle-button").textContent = "Couldn't copy. Try again";
  }
}

$("archive-open-button").addEventListener("click", () => openArchive());
$("archive-nav-calendar").addEventListener("click", () => openArchive());
$("archive-back-button").addEventListener("click", () => openArchive(false));
$("archive-nav-today").addEventListener("click", showWelcome);
$("archive-home-button").addEventListener("click", showWelcome);
$("calendar-prev").addEventListener("click", () => { calendarMonth = shiftMonth(calendarMonth, -1); renderCalendar(); });
$("calendar-next").addEventListener("click", () => { calendarMonth = shiftMonth(calendarMonth, 1); renderCalendar(); });
$("archive-retry-button").addEventListener("click", () => openArchive(false));
$("calendar-grid").addEventListener("click", (event) => {
  const cell = event.target.closest("button[data-date]");
  if (!cell) return;

  if (archiveList && cell.dataset.date === archiveList.today) {
    showWelcome();
  } else {
    startArchivePuzzle(cell.dataset.date);
  }
});
$("share-puzzle-button").addEventListener("click", sharePuzzleInvite);

$("start-button").addEventListener("click", startGame);
$("answer-form").addEventListener("submit", submitAnswer);
$("hint-button").addEventListener("click", requestHint);

$("share-button").addEventListener("click", shareResultNatively);
$("copy-button").addEventListener("click", copyResult);
$("save-button").addEventListener("click", saveShareImage);
$("rematch-button").addEventListener("click", challengeBack);

$("archive-open-button").hidden = !ARCHIVE_ENABLED;

renderChallengeBanner();
$("start-button").textContent = startButtonLabel();
