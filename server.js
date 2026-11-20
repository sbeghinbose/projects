const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./database.db');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'super-secret-mcq-key',
    resave: false,
    saveUninitialized: false
}));

// Initialize Database Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT,
        option_a TEXT,
        option_b TEXT,
        option_c TEXT,
        option_d TEXT,
        correct_option TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        score INTEGER,
        total INTEGER,
        attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Middleware to check authentication
function requireRole(role) {
    return (req, res, next) => {
        if (!req.session.user || req.session.user.role !== role) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        next();
    };
}

// --- AUTH ROUTES ---

app.post('/api/register', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !['student', 'staff'].includes(role)) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    const hashed = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`,
        [username, hashed, role],
        function (err) {
            if (err) return res.status(400).json({ error: 'Username already exists' });
            res.json({ message: 'Registration successful! Please login.' });
        }
    );
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ role: user.role, username: user.username });
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    res.json(req.session.user);
});

// --- STAFF ROUTES ---

// Add single MCQ
app.post('/api/questions', requireRole('staff'), (req, res) => {
    const { question, option_a, option_b, option_c, option_d, correct_option } = req.body;
    db.run(
        `INSERT INTO questions (question, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?)`,
        [question, option_a, option_b, option_c, option_d, correct_option.toUpperCase()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Question added!', id: this.lastID });
        }
    );
});

// Bulk upload MCQs via JSON array
app.post('/api/questions/bulk', requireRole('staff'), (req, res) => {
    const questions = req.body.questions;
    if (!Array.isArray(questions)) return res.status(400).json({ error: 'Expected an array of questions' });

    const stmt = db.prepare(`INSERT INTO questions (question, option_a, option_b, option_c, option_d, correct_option) VALUES (?, ?, ?, ?, ?, ?)`);
    questions.forEach(q => {
        stmt.run(q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option.toUpperCase());
    });
    stmt.finalize();
    res.json({ message: `${questions.length} questions uploaded successfully!` });
});

app.get('/api/questions/all', requireRole('staff'), (req, res) => {
    db.all(`SELECT * FROM questions ORDER BY id DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

// --- STUDENT ROUTES ---

// Get Random Questions (Defaults to 5 random questions per attempt/reattempt)
app.get('/api/quiz', requireRole('student'), (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    // ORDER BY RANDOM() ensures every attempt & reattempt serves a fresh random set
    db.all(
        `SELECT id, question, option_a, option_b, option_c, option_d FROM questions ORDER BY RANDOM() LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Submit Quiz and Calculate Score
app.post('/api/quiz/submit', requireRole('student'), (req, res) => {
    const { answers } = req.body; // Format: { questionId: "A", ... }
    const questionIds = Object.keys(answers);

    if (questionIds.length === 0) {
        return res.status(400).json({ error: 'No answers submitted' });
    }

    const placeholders = questionIds.map(() => '?').join(',');
    db.all(`SELECT id, correct_option FROM questions WHERE id IN (${placeholders})`, questionIds, (err, rows) => {
        let score = 0;
        rows.forEach(row => {
            if (answers[row.id] === row.correct_option) {
                score++;
            }
        });

        const total = rows.length;
        db.run(
            `INSERT INTO scores (student_id, score, total) VALUES (?, ?, ?)`,
            [req.session.user.id, score, total],
            function () {
                res.json({ score, total });
            }
        );
    });
});

// Get Student Dashboard Score History
app.get('/api/scores', requireRole('student'), (req, res) => {
    db.all(
        `SELECT score, total, attempted_at FROM scores WHERE student_id = ? ORDER BY attempted_at DESC`,
        [req.session.user.id],
        (err, rows) => {
            res.json(rows);
        }
    );
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
