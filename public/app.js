const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let topics=[];
async function loadTopics(){
 const res=await fetch('/api/topics');if(!res.ok)return;
 topics=await res.json();
 document.getElementById('paperSelect').innerHTML=[...new Set(topics.map(t=>t.paper))].map(p=>`<option>${escapeHtml(p)}</option>`).join('');
 updateTopics();
}
function updateTopics(){
 const paper=document.getElementById('paperSelect').value;
 document.getElementById('topicSelect').innerHTML=topics.filter(t=>t.paper===paper).map(t=>`<option value="${escapeHtml(t.topic)}">${escapeHtml(t.topic)} (${t.count} questions)</option>`).join('');
 topicChanged();
}
function topicChanged(){
 const paper=document.getElementById('paperSelect').value,topic=document.getElementById('topicSelect').value;
 const selected=topics.find(t=>t.paper===paper&&t.topic===topic);
 document.getElementById('topicSummary').textContent=`${paper} — ${topic} · ${selected?.count||0} questions`;
 if(document.getElementById('questionList'))loadAllQuestions();
}
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
        paper: document.getElementById("paperSelect").value,
        topic: document.getElementById("topicSelect").value,
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
            body: JSON.stringify({ questions,paper:document.getElementById("paperSelect").value,topic:document.getElementById("topicSelect").value })
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
    const paper=document.getElementById('paperSelect').value, topic=document.getElementById('topicSelect').value;
    const filtered=questions.filter(q=>(q.paper||'Other')===paper&&(q.topic||'General')===topic).sort((a,b)=>(a.source_number||a.id)-(b.source_number||b.id));
    document.getElementById('qCount').innerText = filtered.length;
    document.getElementById('questionList').innerHTML = filtered.map(q => `
        <div class="q-item">
            <strong>${escapeHtml(q.question)}</strong><br>
            A: ${escapeHtml(q.option_a)} | B: ${escapeHtml(q.option_b)} | C: ${escapeHtml(q.option_c)} | D: ${escapeHtml(q.option_d)} 
            <span style="color:green;">(Ans: ${escapeHtml(q.correct_option)})</span>
        </div>
    `).join('');
}

// --- STUDENT FUNCTIONS ---
let currentQuestions = [];

async function startQuiz() {
    // Each topic attempt contains up to 50 randomized questions.
    const paper=document.getElementById('paperSelect').value,topic=document.getElementById('topicSelect').value;
    if(!topic)return alert('Select a topic first');
    document.getElementById('quizHeading').textContent=`${paper} — ${topic} (50 questions)`;
    const res = await fetch('/api/quiz?'+new URLSearchParams({paper,topic}));
    if(!res.ok)return alert((await res.json()).error);
    currentQuestions = await res.json();

    if (currentQuestions.length === 0) {
        return alert('No questions uploaded by staff yet.');
    }

    document.getElementById('resultView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('quizView').style.display = 'block';

    document.getElementById('quizContainer').innerHTML = currentQuestions.map((q, idx) => `
        <div style="margin-bottom: 18px;">
            <p><strong>${idx + 1}. ${escapeHtml(q.question)}</strong> <small>(2 marks)</small></p>
            <label class="option"><input type="radio" name="q_${q.id}" value="A"> ${escapeHtml(q.option_a)}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="B"> ${escapeHtml(q.option_b)}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="C"> ${escapeHtml(q.option_c)}</label>
            <label class="option"><input type="radio" name="q_${q.id}" value="D"> ${escapeHtml(q.option_d)}</label>
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
    if(!res.ok)return alert(result.error);
    renderResult(result);

    document.getElementById('quizView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';
    loadScores();
}

async function loadScores() {
    const res = await fetch('/api/scores');
    if(!res.ok)return;
    const scores = await res.json();
    document.getElementById("latestMarks").textContent=scores.length?`Latest attempt: ${scores[0].marks} / ${scores[0].totalMarks} marks`:"No quiz attempts yet.";
    document.getElementById('scoreHistory').innerHTML = scores.map((s, idx) => `
        <tr>
            <td>Attempt ${scores.length - idx}</td>
            <td>${escapeHtml(s.topic || "General")}</td><td>${s.marks} / ${s.totalMarks} marks</td>
            <td>${Math.round((s.score / s.total) * 100)}%</td>
            <td>${new Date(s.attempted_at).toLocaleString()}</td><td>${s.hasReview ? `<button onclick="viewResult(${s.id})">Review answers</button>` : "Review unavailable"}</td>
        </tr>
    `).join('');
}

function renderResult(result){
 document.getElementById('resultView').style.display='block';
 document.getElementById('resultTopic').textContent=result.topic;
 document.getElementById('totalMarks').textContent=`Total marks: ${result.marks} / ${result.totalMarks}`;
 document.getElementById('answerSummary').textContent=`${result.score} correct out of ${result.total} questions · 2 marks per correct answer`;
 const wrong=(result.review||[]).filter(q=>!q.correct);
 document.getElementById('wrongAnswers').innerHTML=!result.review?'<p>Answer review is unavailable for this earlier attempt.</p>':wrong.length?wrong.map(q=>`<article class="wrong-answer"><strong>Question ${q.number}. ${escapeHtml(q.question)}</strong><p>Your answer: ${q.selectedOption?`${escapeHtml(q.selectedOption)}. ${escapeHtml(q.selectedAnswer)}`:'Not answered'}</p><p><strong>Correct answer: ${escapeHtml(q.correctOption)}. ${escapeHtml(q.correctAnswer)}</strong></p><p>Marks: 0 / 2</p></article>`).join(''):'<p>All answers are correct. Full marks!</p>';
 document.getElementById('resultView').scrollIntoView({behavior:'smooth',block:'start'});
}
async function viewResult(id){
 const res=await fetch('/api/scores/'+id);const result=await res.json();
 if(!res.ok)return alert(result.error);
 renderResult(result);
}
