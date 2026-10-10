
const questions = [
  {
    icon: "🃏",
    category: "WORD CONNECTION",
    question: "What has kings, queens, jacks and aces, but no royal palace?",
    instruction: "Type your answer below. You have three attempts.",
    answer: "Cards",
    hints: [
      "You might use them for a game at a table.",
      "A deck usually contains 52 of them."
    ],
    explanation:
      "A standard deck of playing cards contains kings, queens, jacks and aces. They are playing cards, not people living in a palace."
  },
  {
    icon: "🧠",
    category: "LOGIC",
    question: "Alex is older than Ben. Ben is older than Sam. Who is the youngest?",
    instruction: "Read the relationships carefully.",
    answer: "Sam",
    hints: [
      "Compare Ben's age with Sam's age first.",
      "The youngest person is younger than both others."
    ],
    explanation:
      "Alex is older than Ben, and Ben is older than Sam. Therefore, Sam is the youngest."
  },
  {
    icon: "👨‍👩‍👧‍👦",
    category: "LATERAL THINKING",
    question: "A family has four daughters. Each daughter has exactly one brother. How many children are there in the family?",
    instruction: "Think about whether each daughter needs a different brother.",
    answer: "5",
    hints: [
      "The brother can be shared by all four daughters.",
      "Count the daughters and the brother."
    ],
    explanation:
      "There are four daughters and one brother. All four daughters share the same brother, so there are five children in total."
  },
  {
    icon: "🔢",
    category: "NUMBER PATTERN",
    question: "What number comes next in this sequence?",
    instruction: "2, 6, 12, 20, 30, ?",
    answer: "42",
    hints: [
      "Look at the differences between consecutive numbers.",
      "The differences are 4, 6, 8 and 10. What comes next?"
    ],
    explanation:
      "The differences increase by 2 each time: +4, +6, +8, +10 and then +12. Therefore, 30 + 12 = 42."
  },
  {
    icon: "🔤",
    category: "WORDPLAY",
    question: "What word becomes shorter when you add two letters to it?",
    instruction: "The answer is a word, not a measurement.",
    answer: "Short",
    hints: [
      "The word describes length.",
      "Try adding the letters E and R."
    ],
    explanation:
      "Adding E and R to SHORT creates SHORTER. The word gets longer, but its meaning describes something shorter."
  },
  {
    icon: "🔐",
    category: "CODE BREAKER",
    question: "Using A = 1, B = 2, C = 3 and so on, how would you write DOG as a number code?",
    instruction: "Enter the three numbers in order, separated by hyphens.",
    answer: "4-15-7",
    hints: [
      "Find the position of each letter in the alphabet.",
      "D is 4, O is 15, and G is 7."
    ],
    explanation:
      "D is the 4th letter, O is the 15th letter, and G is the 7th letter. The code is 4-15-7."
  },
  {
    icon: "🪄",
    category: "WORDPLAY",
    question: "Which word becomes EVEN when you remove its first letter?",
    instruction: "Look for a number written as a word.",
    answer: "Seven",
    hints: [
      "The word has five letters.",
      "Remove the first letter S."
    ],
    explanation:
      "SEVEN becomes EVEN when its first letter, S, is removed."
  }
];

// ========================================
// HTML ELEMENTS
// ========================================

const timer = document.getElementById("timer");
const levelRow = document.getElementById("levelRow");
const progressTrack = document.getElementById("progressTrack");
const progressBar = document.getElementById("progressBar");

const welcomeScreen = document.getElementById("welcomeScreen");
const gameContent = document.getElementById("gameContent");

const challengeIcon = document.getElementById("challengeIcon");
const category = document.getElementById("category");
const completionTime = document.getElementById("completionTime");
const completionMessage = document.getElementById("completionMessage");
const questionTitle = document.getElementById("question");
const instruction = document.getElementById("instruction");

const feedback = document.getElementById("feedback");
const answerForm = document.getElementById("answerForm");
const answerInput = document.getElementById("answerInput");
const submitButton = document.getElementById("submitButton");
const attemptsText = document.getElementById("attemptsText");

const startButton = document.getElementById("startButton");

const hintArea = document.getElementById("hintArea");
const hintButton = document.getElementById("hintButton");
const hintText = document.getElementById("hintText");

const explanation = document.getElementById("explanation");
const answerText = document.getElementById("answerText");
const explanationText = document.getElementById("explanationText");

// ========================================
// GAME STATE
// ========================================

let dailyQuestion;
let attemptsUsed = 0;
let hintsUsed = 0;
let elapsedSeconds = 0;
let gameStarted = false;
let gameCompleted = false;
let timerInterval = null;

// ========================================
// SELECT DAILY QUESTION
// ========================================

function getDailyQuestion() {
  const startDate = Date.UTC(2026, 0, 1);
  const today = new Date();

  const todayUTC = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );

  const daysPassed = Math.floor(
    (todayUTC - startDate) / 86400000
  );

  const index =
    ((daysPassed % questions.length) + questions.length) %
    questions.length;

  return questions[index];
}

// ========================================
// TIMER
// ========================================

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );
}

function stopTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  stopTimer();

  timerInterval = setInterval(() => {
    if (!gameStarted || gameCompleted) {
      stopTimer();
      return;
    }

    elapsedSeconds++;
    timer.textContent = formatTime(elapsedSeconds);
  }, 1000);
}

// ========================================
// ANSWER CHECKING
// ========================================

function normalizeAnswer(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function answersMatch(userAnswer, correctAnswer) {
  return normalizeAnswer(userAnswer) ===
    normalizeAnswer(correctAnswer);
}

// ========================================
// LOAD / RESET PUZZLE
// ========================================

function loadPuzzle() {
  stopTimer();

  dailyQuestion = getDailyQuestion();

  attemptsUsed = 0;
  hintsUsed = 0;
  elapsedSeconds = 0;

  gameStarted = false;
  gameCompleted = false;

  timer.textContent = "00:00";

  // Welcome screen is the only main screen shown initially.
  welcomeScreen.hidden = false;
  gameContent.hidden = true;

  answerForm.hidden = true;
  hintArea.hidden = true;
  feedback.hidden = true;
  explanation.hidden = true;

  levelRow.hidden = false;
  progressTrack.hidden = false;
  progressBar.style.width = "0%";

  // Prepare today's question.
  challengeIcon.textContent = dailyQuestion.icon;
  category.textContent = dailyQuestion.category;
  questionTitle.textContent = dailyQuestion.question;
  instruction.textContent = dailyQuestion.instruction;

  // Reset completion content.
  completionTime.hidden = true;
  completionTime.textContent = "";

  completionMessage.hidden = true;
  completionMessage.textContent = "";

  challengeIcon.classList.remove("completed-icon");
  category.classList.remove(
    "completion-heading",
    "success",
    "encouragement"
  );
  questionTitle.classList.remove("completed-question");

  // Reset input.
  answerInput.value = "";
  answerInput.disabled = false;
  submitButton.disabled = false;

  attemptsText.textContent = "3 attempts remaining";

  // Reset feedback.
  feedback.textContent = "";
  feedback.className = "feedback";

  // Reset hints.
  hintText.textContent = "";
  hintButton.disabled = false;
  hintButton.textContent = "Need a hint?";

  // Reset explanation.
  answerText.textContent = "";
  explanationText.textContent = "";
}

// ========================================
// START GAME
// ========================================

function startGame() {
  if (gameStarted || gameCompleted) {
    return;
  }

  gameStarted = true;

  welcomeScreen.hidden = true;
  gameContent.hidden = false;

  answerForm.hidden = false;
  hintArea.hidden = false;
  feedback.hidden = false;

  startButton.hidden = true;

  startTimer();
  answerInput.focus();
}

// ========================================
// SUBMIT ANSWER
// ========================================

answerForm.addEventListener("submit", function (event) {
  event.preventDefault();

  if (!gameStarted || gameCompleted) {
    return;
  }

  const userAnswer = answerInput.value.trim();

  if (!userAnswer) {
    feedback.textContent = "Please enter an answer first.";
    feedback.className = "feedback incorrect";
    return;
  }

  attemptsUsed++;

  const attemptsRemaining = 3 - attemptsUsed;

  progressBar.style.width =
    `${(attemptsUsed / 3) * 100}%`;

  if (answersMatch(userAnswer, dailyQuestion.answer)) {
    completePuzzle("solved");
    return;
  }

  if (attemptsRemaining > 0) {
    feedback.textContent =
      `Not quite. Try again — ${attemptsRemaining} ` +
      (attemptsRemaining === 1 ? "attempt" : "attempts") +
      " remaining.";

    feedback.className = "feedback incorrect";
    attemptsText.textContent =
      `${attemptsRemaining} attempts remaining`;

    answerInput.value = "";
    answerInput.focus();

    return;
  }

  // All three attempts were incorrect.
  completePuzzle("not-solved");
});

// ========================================
// HINTS
// ========================================

function showHint() {
  if (!gameStarted || gameCompleted) {
    return;
  }

  if (hintsUsed >= dailyQuestion.hints.length) {
    return;
  }

  hintText.textContent =
    `Hint ${hintsUsed + 1}: ${dailyQuestion.hints[hintsUsed]}`;

  hintsUsed++;

  if (hintsUsed >= dailyQuestion.hints.length) {
    hintButton.disabled = true;
    hintButton.textContent = "No more hints";
  } else {
    hintButton.textContent = "Need another hint?";
  }
}

// ========================================
// COMPLETION SCREEN
// ========================================

function completePuzzle(result) {
  if (gameCompleted) {
    return;
  }

  // Lock the game and stop the timer.
  gameCompleted = true;
  gameStarted = false;
  stopTimer();

  // Hide every gameplay control.
  welcomeScreen.hidden = true;
  answerForm.hidden = true;
  hintArea.hidden = true;
  feedback.hidden = true;

  // Hide progress indicators.
  levelRow.hidden = true;
  progressTrack.hidden = true;

  // IMPORTANT: show the completion content.
  gameContent.hidden = false;

  // Remove previous completion styling.
  category.classList.remove("success", "encouragement");
  category.classList.add("completion-heading");

  questionTitle.classList.add("completed-question");
  challengeIcon.classList.add("completed-icon");

  // Show the question again on the completion page.
  questionTitle.textContent = dailyQuestion.question;

  // Reveal the correct answer and explanation in both outcomes.
  answerText.textContent = `Answer: ${dailyQuestion.answer}`;
  explanationText.textContent = dailyQuestion.explanation;
  explanation.hidden = false;

  // CORRECT ANSWER
  if (result === "solved") {
    challengeIcon.textContent = "🏆";

    category.textContent = "CONGRATULATIONS!";
    category.classList.add("success");

    completionMessage.textContent =
      "Brilliant work! You cracked today's brain teaser.";

    completionTime.textContent =
      `You solved the puzzle in ${formatTime(elapsedSeconds)}.`;

    completionTime.hidden = false;

    completionMessage.hidden = true;
    completionMessage.textContent = "";

    

  } else {
    // THREE INCORRECT ATTEMPTS
    challengeIcon.textContent = "💪";

    category.textContent = "DON'T BE DISHEARTENED!";
    category.classList.add("encouragement");

    completionTime.hidden = true;
    completionTime.textContent = "";

    completionMessage.textContent =
      "Every attempt is a chance to learn something new. " +
      "Take a look at the solution, keep your curiosity alive, " +
      "and come back ready for another challenge.";

    completionMessage.hidden = false;

    //instruction.textContent =
    //  "You gave it a go. Here's the answer and how to solve it.";
  }
}

// ========================================
// EVENT LISTENERS
// ========================================

startButton.addEventListener("click", startGame);
hintButton.addEventListener("click", showHint);

// Initialize the welcome screen.
loadPuzzle();
