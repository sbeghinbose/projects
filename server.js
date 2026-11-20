const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
if (production) app.set('trust proxy', 1);
const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'database.db'));
const fs = require('fs');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 }
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

// Add topic metadata without changing existing accounts or questions.
const ready = new Promise((resolve, reject) => {
 db.all('PRAGMA table_info(questions)', async (err, columns) => {
  if (err) return reject(err);
  const run = (sql, args=[]) => new Promise((ok, fail) => db.run(sql,args,function(e){e?fail(e):ok(this)}));
  try {
   for (const [name,type] of Object.entries({paper:'TEXT',topic:'TEXT',source_number:'INTEGER',source_key:'TEXT'})) {
    if (!columns.some(c=>c.name===name)) await run(`ALTER TABLE questions ADD COLUMN ${name} ${type}`);
   }
   await run('CREATE UNIQUE INDEX IF NOT EXISTS question_source ON questions(source_key)');
   await run("ALTER TABLE scores ADD COLUMN topic TEXT").catch(e=>{if(!e.message.includes('duplicate column'))throw e});
   await run("ALTER TABLE scores ADD COLUMN review_json TEXT").catch(e=>{if(!e.message.includes('duplicate column'))throw e});
   const questions=JSON.parse(fs.readFileSync(path.join(__dirname,'questions.json'),'utf8'));
   await run('BEGIN TRANSACTION');
   for (const q of questions) await run(`INSERT OR IGNORE INTO questions (question,option_a,option_b,option_c,option_d,correct_option,paper,topic,source_number,source_key) VALUES (?,?,?,?,?,?,?,?,?,?)`,[q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option,q.paper,q.topic,q.source_number,`${q.paper}:${q.source_number}`]);
   await run('COMMIT'); resolve();
  } catch(e) { db.run('ROLLBACK'); reject(e); }
 });
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
    const { username, password } = req.body;
    if (req.body.role !== undefined && req.body.role !== 'student') {
        return res.status(403).json({ error: 'Only student registration is available. Staff accounts are managed separately.' });
    }
    const role = 'student';
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
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
    const { question, option_a, option_b, option_c, option_d, correct_option, paper, topic } = req.body;
    db.run(
        `INSERT INTO questions (question, option_a, option_b, option_c, option_d, correct_option,paper,topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [question, option_a, option_b, option_c, option_d, correct_option.toUpperCase(),paper || "Other",topic || "General"],
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

    const stmt = db.prepare(`INSERT INTO questions (question, option_a, option_b, option_c, option_d, correct_option,paper,topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    questions.forEach(q => {
        stmt.run(q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option.toUpperCase(),q.paper || req.body.paper || "Other",q.topic || req.body.topic || "General");
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

app.get('/api/topics', (req,res)=>{
 if(!req.session.user) return res.status(401).json({error:'Not logged in'});
 db.all("SELECT COALESCE(paper,'Other') paper, COALESCE(topic,'General') topic, COUNT(*) count FROM questions GROUP BY paper,topic ORDER BY paper,MIN(id)",[],(err,rows)=>err?res.status(500).json({error:'Could not load topics'}):res.json(rows));
});

app.get('/api/quiz',requireRole('student'),(req,res)=>{
 const {paper,topic}=req.query;
 if(!paper||!topic) return res.status(400).json({error:'Select a paper and topic'});
 db.all('SELECT id,question,option_a,option_b,option_c,option_d FROM questions WHERE paper=? AND topic=? ORDER BY RANDOM() LIMIT 50',[paper,topic],(err,rows)=>{
  if(err) return res.status(500).json({error:'Could not load quiz'});
  req.session.quiz={ids:rows.map(q=>q.id),paper,topic};
  res.json(rows);
 });
});

app.post('/api/quiz/submit',requireRole('student'),(req,res)=>{
 const quiz=req.session.quiz;
 if(!quiz?.ids.length) return res.status(400).json({error:'Start a quiz first'});
 const answers=req.body.answers;
 if(!answers||typeof answers!=='object'||Array.isArray(answers)) return res.status(400).json({error:'Invalid answers'});
 db.all(`SELECT id,question,option_a,option_b,option_c,option_d,correct_option FROM questions WHERE id IN (${quiz.ids.map(()=>'?').join(',')})`,quiz.ids,(err,rows)=>{
  if(err) return res.status(500).json({error:'Could not grade quiz'});
  const score=rows.filter(q=>answers[q.id]===q.correct_option).length;
  const total=quiz.ids.length;
  const topic=`${quiz.paper} — ${quiz.topic}`;
  const review=quiz.ids.map((id,index)=>{
   const q=rows.find(row=>row.id===id);
   const selected=['A','B','C','D'].includes(answers[id])?answers[id]:null;
   const correct=selected===q.correct_option;
   return {number:index+1,question:q.question,selectedOption:selected,
    selectedAnswer:selected?q['option_'+selected.toLowerCase()]:null,
    correctOption:q.correct_option,correctAnswer:q['option_'+q.correct_option.toLowerCase()],
    correct,marks:correct?2:0};
  });
  db.run('INSERT INTO scores(student_id,score,total,topic,review_json) VALUES (?,?,?,?,?)',[req.session.user.id,score,total,topic,JSON.stringify(review)],function(err){
   if(err) return res.status(500).json({error:'Could not save score'});
   delete req.session.quiz;
   res.json({id:this.lastID,score,total,marks:score*2,totalMarks:total*2,topic,review});
  });
 });
});

// Get Student Dashboard Score History
app.get('/api/scores', requireRole('student'), (req, res) => {
    db.all(
        `SELECT id, score, total, score*2 marks, total*2 totalMarks, attempted_at, topic, review_json IS NOT NULL hasReview FROM scores WHERE student_id = ? ORDER BY id DESC`,
        [req.session.user.id],
        (err, rows) => {
            res.json(rows);
        }
    );
});

app.get('/api/scores/:id',requireRole('student'),(req,res)=>{
 db.get('SELECT id,score,total,topic,review_json FROM scores WHERE id=? AND student_id=?',[req.params.id,req.session.user.id],(err,row)=>{
  if(err)return res.status(500).json({error:'Could not load result'});
  if(!row)return res.status(404).json({error:'Result not found'});
  res.json({id:row.id,score:row.score,total:row.total,topic:row.topic,marks:row.score*2,totalMarks:row.total*2,review:row.review_json?JSON.parse(row.review_json):null});
 });
});

app.get('/health', (req,res)=>res.json({status:'ok'}));
const PORT = process.env.PORT || 3000;
ready.then(()=>app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))).catch(e=>{console.error(e);process.exit(1)});
