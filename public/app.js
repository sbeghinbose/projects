async function checkAuth(expectedRole) {
    const res = await fetch('/api/me');
    if (!res.ok) return window.location.href = '/';
    const user = await res.json();
    if (user.role !== expectedRole) return window.location.href = '/';
    const welcome = document.getElementById('welcomeText');
    if (welcome) welcome.innerText = `Welcome, ${user.username}`;
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
}

// --- STAFF FUNCTIONS ---
async function addQuestion() {
    const payload = {
        question: document.getElementById('question').value,
        option_a: document.getElementById('optA').value,
        option_b: document.getElementById('optB').value,
        option_c: document.getElementById('optC').value,
        option_d: document.getElementById('optD').value,
        correct_option: document.getElementById('correct').value
    };
    const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) {
        alert('Question added!');
        document.querySelectorAll('input').forEach(i => i.value = '');
        loadAllQuestions();
    }
}

async function bulkUpload() {
    try {
        const questions = JSON.parse(document.getElementById('bulkJson').value);
        const res = await fetch('/api/questions/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ questions })
        });
        const data = await res.json();
        alert(data.message || data.error);
        loadAllQuestions();
    } catch (e) {
        alert('Invalid JSON format.');
    }
}

async function loadAllQuestions() {
    const res = await fetch('/api/questions/all');
    const questions = await res.json();
    document.getElementById('qCount').innerText = questions.length;
    document.getElementById('questionList').innerHTML = questions.map(q => `
        <div class="q-item">
            <strong>${q.question}</strong><br>
            A: ${q.option_a} | B: ${q.option_b} | C: ${q.option_c} | D: ${q.option_d} 
            <span style="color:green;">(Ans: ${q.correct_option})</span>
        </div>
    `).join('');
}

// --- STUDENT FUNCTIONS ---
let currentQuestions = [];

async function startQuiz() {
    // Fetches 5 random questions each time the student starts or reattempts
    const res = await fetch('/api/quiz?limit=5');
    currentQuestions = await res.json();

    if (currentQuestions.length === 0) {
        return alert('No questions uploaded by staff yet.');
    }

    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('quizView').style.display = 'block';

    document.getElementById('quizContainer').innerHTML = currentQuestions.map((q, idx) => `
        <div style="margin-bottom: 18px;">
            <p><strong>${idx + 1}. ${q.question}</strong></p>
            <label class="option"><input type="radio" name="q_${q.id}" value="A"> ${q.option_a}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="B"> ${q.option_b}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="C"> ${q.option_c}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="D"> ${q.option_d}</label>
        </div>
    `).join('');
}

async function submitQuiz() {
    const answers = {};
    currentQuestions.forEach(q => {
        const selected = document.querySelector(`input[name="q_${q.id}"]:checked`);
        if (selected) answers[q.id] = selected.value;
    });

    const res = await fetch('/api/quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
    });
    const result = await res.json();
    alert(`Quiz Submitted! You scored ${result.score} out of ${result.total}`);

    document.getElementById('quizView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';
    loadScores();
}

async function loadScores() {
    const res = await fetch('/api/scores');
    const scores = await res.json();
    document.getElementById('scoreHistory').innerHTML = scores.map((s, idx) => `
        <tr>
            <td>Attempt ${scores.length - idx}</td>
            <td>${s.score} / ${s.total}</td>
            <td>${Math.round((s.score / s.total) * 100)}%</td>
            <td>${new Date(s.attempted_at).toLocaleString()}</td>
        </tr>
    `).join('');
}
