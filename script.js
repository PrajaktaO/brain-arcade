
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
  $("hint-button").disabled = gameCompleted;
  clearFeedback();

  welcomeScreen.hidden = true;
  completionScreen.hidden = true;
  gameScreen.hidden = false;

  startVisibleTimer(data.elapsedSeconds || 0);

  if (gameCompleted) {
    renderCompletion(data);
  } else {
    $("answer-input").focus();
  }
}

function renderCompletion(data) {
  gameCompleted = true;
  stopVisibleTimer(data.elapsedSeconds);

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
    $("completion-icon").textContent = "💪";
    $("completion-eyebrow").textContent = "PUZZLE COMPLETE";
    $("completion-title").textContent = "Don't be disheartened!";
    $("completion-message").textContent =
      "Some puzzles take a different way of thinking. Keep practising, stay curious, and try again with tomorrow's challenge.";
  }
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
    $("feedback").textContent =
      `${error.message} Your answer may not have been recorded.`;
    $("feedback").className = "feedback error";
  } finally {
    if (!gameCompleted) {
      $("submit-button").disabled = false;
      $("hint-button").disabled = false;
    }
  }
}

async function requestHint() {
  if (gameCompleted) return;

  $("hint-button").disabled = true;
  $("feedback").textContent = "";

  try {
    const data = await callGameFunction("hint");

    updateAttempts(data);

    $("hint-box").hidden = false;
    $("hint-text").textContent =
      data.hint || data.message || "No more hints are available.";

    startVisibleTimer(data.elapsedSeconds || 0);
  } catch (error) {
    console.error(error);
    $("feedback").textContent = error.message;
    $("feedback").className = "feedback error";
  } finally {
    if (!gameCompleted) $("hint-button").disabled = false;
  }
}

$("start-button").addEventListener("click", startGame);
$("answer-form").addEventListener("submit", submitAnswer);
$("hint-button").addEventListener("click", requestHint);
