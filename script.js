
const questions = [
    {
        type: "word",
        icon: "🔤",
        category: "WORD SCRAMBLE",
        question: "Crack the scrambled word!",
        instruction: "A large striped cat that lives in the wild.",
        scrambled: "G I T E R",
        options: ["TIGER", "GREAT", "GRITE", "TRIBE"],
        answer: "TIGER"
    },
    {
        type: "trivia",
        icon: "🌍",
        category: "TRIVIA TEMPLE",
        question: "Which planet is known as the Red Planet?",
        instruction: "Think about the colour of its dusty surface!",
        options: ["Venus", "Mars", "Jupiter", "Saturn"],
        answer: "Mars"
    },
    {
        type: "riddle",
        icon: "🗝️",
        category: "RIDDLE CAVE",
        question: "I have keys but open no locks. What am I?",
        instruction: "You might use me to play your favourite song.",
        options: ["A treasure chest", "A keyboard", "A map", "A clock"],
        answer: "A keyboard"
    },
    {
        type: "emoji",
        icon: "🚀",
        category: "EMOJI ISLAND",
        question: "Decode these emojis!",
        instruction: "🌙 + ⭐",
        options: ["Sunflower", "Night sky", "Rainbow", "Ocean"],
        answer: "Night sky"
    },
    {
        type: "odd",
        icon: "🦊",
        category: "ODD-ONE-OUT FOREST",
        question: "Which one does not belong?",
        instruction: "🐶   🐱   🐰   🥕",
        options: ["Dog", "Cat", "Rabbit", "Carrot"],
        answer: "Carrot"
    }
];

let roundQuestions = [];
let currentQuestion = 0;
let score = 0;
let answered = false;

let totalStars =
    Number(localStorage.getItem("brainArcadeStars")) || 0;

let bestScore =
    Number(localStorage.getItem("brainArcadeBest")) || 0;

const totalStarsDisplay = document.getElementById("totalStars");
const bestScoreDisplay = document.getElementById("bestScore");
const levelBadge = document.getElementById("levelBadge");
const roundLabel = document.getElementById("roundLabel");
const progressBar = document.getElementById("progressBar");
const challengeIcon = document.getElementById("challengeIcon");
const category = document.getElementById("category");
const questionTitle = document.getElementById("question");
const instruction = document.getElementById("instruction");
const scrambledWord = document.getElementById("scrambledWord");
const answers = document.getElementById("answers");
const feedback = document.getElementById("feedback");
const startButton = document.getElementById("startButton");
const nextButton = document.getElementById("nextButton");

function updateStats() {
    totalStarsDisplay.textContent = totalStars;
    bestScoreDisplay.textContent = bestScore;
}

function startGame() {
    currentQuestion = 0;
    score = 0;
    answered = false;

    // Make a copy so the original question bank stays unchanged.
    roundQuestions = [...questions];

    // Shuffle the five mini-games for a surprise round.
    for (let i = roundQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [roundQuestions[i], roundQuestions[j]] =
            [roundQuestions[j], roundQuestions[i]];
    }

    startButton.hidden = true;
    nextButton.hidden = true;

    showQuestion();
}

function showQuestion() {
    const q = roundQuestions[currentQuestion];

    answered = false;

    levelBadge.textContent = "LEVEL 1";
    roundLabel.textContent =
        `Challenge ${currentQuestion + 1} of ${roundQuestions.length}`;

    progressBar.style.width =
        `${(currentQuestion / roundQuestions.length) * 100}%`;

    challengeIcon.textContent = q.icon;
    category.textContent = q.category;
    questionTitle.textContent = q.question;
    instruction.textContent = q.instruction;

    // Only word scrambles need a scrambled-word display.
    scrambledWord.textContent = q.scrambled || "";

    feedback.textContent = "";
    answers.replaceChildren();

    q.options.forEach(option => {
        const button = document.createElement("button");

        button.className = "answer-button";
        button.textContent = option;

        button.addEventListener("click", () => {
            checkAnswer(option, button);
        });

        answers.appendChild(button);
    });

    nextButton.hidden = true;
}

function checkAnswer(choice, selectedButton) {
    if (answered) return;

    answered = true;

    const q = roundQuestions[currentQuestion];
    const correct = choice === q.answer;
    const allButtons = answers.querySelectorAll("button");

    allButtons.forEach(button => {
        button.disabled = true;

        if (button.textContent === q.answer) {
            button.classList.add("correct");
        }
    });

    if (correct) {
        score += 10;
        totalStars += 1;

        localStorage.setItem("brainArcadeStars", totalStars);

        feedback.textContent = "🎉 Brilliant! +10 points and +1 star!";
        challengeIcon.textContent = "🌟";
    } else {
        selectedButton.classList.add("wrong");

        feedback.textContent =
            `Good try! The answer was ${q.answer}.`;

        challengeIcon.textContent = "💪";
    }

    updateStats();

    nextButton.textContent =
        currentQuestion === roundQuestions.length - 1
            ? "See My Results 🏆"
            : "Next Challenge ➜";

    nextButton.hidden = false;
}

function nextQuestion() {
    if (!answered) return;

    currentQuestion++;

    if (currentQuestion < roundQuestions.length) {
        showQuestion();
    } else {
        finishGame();
    }
}

function finishGame() {
    progressBar.style.width = "100%";

    if (score > bestScore) {
        bestScore = score;
        localStorage.setItem("brainArcadeBest", bestScore);
    }

    updateStats();

    levelBadge.textContent = "LEVEL COMPLETE";
    roundLabel.textContent = "Adventure finished!";

    challengeIcon.textContent = score === 50 ? "🏆" : "🎯";
    category.textContent = "YOUR RESULTS";

    questionTitle.textContent =
        score === 50
            ? "Perfect score, Brain Explorer!"
            : score >= 30
                ? "Amazing brain power!"
                : "Great adventure!";

    instruction.textContent =
        `You scored ${score} out of 50 points.`;

    scrambledWord.textContent = "";
    answers.replaceChildren();

    feedback.textContent =
        `⭐ You collected ${score / 10} stars this round!`;

    nextButton.hidden = true;
    startButton.textContent = "Play Again 🔁";
    startButton.hidden = false;
}

startButton.addEventListener("click", startGame);
nextButton.addEventListener("click", nextQuestion);

updateStats();
