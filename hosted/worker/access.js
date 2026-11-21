const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const one=(db,s,...a)=>db.prepare(s).bind(...a).first();
const read=async(db,s,...a)=>(await db.prepare(s).bind(...a).all()).results;
export async function permittedExam(db,studentId,examId){return one(db,'SELECT e.* FROM exams e JOIN exam_students p ON p.exam_id=e.id WHERE e.id=? AND p.student_id=? AND p.revoked=0 AND e.cancelled=0',examId,studentId)}
export async function selectedStudents(db,ids){if(!Array.isArray(ids)||!ids.length||ids.length>2000)return null;const clean=[...new Set(ids.map(Number))];if(clean.some(id=>!Number.isSafeInteger(id)||id<1))return null;const registered=new Set((await read(db,"SELECT id FROM users WHERE role='student' AND is_active=1")).map(u=>u.id));return clean.every(id=>registered.has(id))?clean:null}
export function grantStatements(db,examId,studentIds,actorId){const statements=[];for(let i=0;i<studentIds.length;i+=25){const ids=studentIds.slice(i,i+25);statements.push(db.prepare('INSERT INTO exam_students(exam_id,student_id,granted_by) VALUES '+ids.map(()=>'(?,?,?)').join(',')+' ON CONFLICT(exam_id,student_id) DO UPDATE SET revoked=0,granted_by=excluded.granted_by,granted_at=CURRENT_TIMESTAMP').bind(...ids.flatMap(id=>[examId,id,actorId])))}return statements}
// Every student request passes this boundary before legacy learning/support routes.
export async function studentBoundary(request,env,u,b){
 if(u?.role!=='student')return null;const p=new URL(request.url).pathname,db=env.DB;
 if(['/api/me','/api/logout','/api/account/password','/api/learning/home','/api/scores','/api/access/status'].includes(p))return null;
 if(p==='/api/learning/attempts'||p==='/api/classroom/ready'){
  if(!Number.isSafeInteger(Number(b.examId))||!b.examId||b.assignmentId||!await permittedExam(db,u.id,Number(b.examId)))return json({error:'Your teacher must select you for this exam. Open an approved exam from your dashboard.'},403);return null;
 }
 const attempt=p.match(/^\/api\/learning\/attempts\/([a-zA-Z0-9-]+)(?:\/(save|submit|check))?$/);
 if(attempt){const a=await one(db,'SELECT exam_id,status FROM learning_attempts WHERE id=? AND student_id=?',attempt[1],u.id);if(!a?.exam_id||!await permittedExam(db,u.id,a.exam_id))return json({error:'Exam permission is unavailable or has been revoked by your teacher.'},403);if(attempt[2]==='check')return json({error:'Answers are shown only after submission and teacher release.'},403);return null}
 const score=p.match(/^\/api\/scores\/(\d+)$/);
 if(score){const s=await one(db,'SELECT exam_id FROM scores WHERE id=? AND student_id=?',Number(score[1]),u.id);if(!s?.exam_id||!await permittedExam(db,u.id,s.exam_id))return json({error:'Question review requires permission for the original exam.'},403);return null}
 return json({error:'This learning tool is locked. Only staff-approved exams and released results are available to students.'},403);
}
export async function accessRequest(request,env,u,b={}){
 const url=new URL(request.url),p=url.pathname,db=env.DB;if(!p.startsWith('/api/access/'))return null;if(!u)return json({error:'Not logged in'},401);
 if(p==='/api/access/status'&&u.role==='student'&&request.method==='GET'){const id=Number(url.searchParams.get('examId'));return json({allowed:Number.isSafeInteger(id)&&id>0?!!await permittedExam(db,u.id,id):false,serverTime:new Date().toISOString()})}
 const match=p.match(/^\/api\/access\/exams\/(\d+)\/students$/);if(!match||!['staff','admin'].includes(u.role))return json({error:'Staff access required'},403);
 const exam=await one(db,'SELECT * FROM exams WHERE id=?',Number(match[1]));if(!exam||!(u.role==='admin'||exam.owner_id===u.id))return json({error:'Exam not found'},404);
 if(request.method==='GET')return json({examId:exam.id,students:(await read(db,'SELECT p.student_id,u.username,COALESCE(u.display_name,u.username) name FROM exam_students p JOIN users u ON u.id=p.student_id WHERE p.exam_id=? AND p.revoked=0 ORDER BY u.username',exam.id))});
 if(request.method==='POST'){
  const ids=Array.isArray(b.studentIds)&&b.studentIds.length===0?[]:await selectedStudents(db,b.studentIds);if(!ids)return json({error:'Select up to 2000 active registered students. An empty selection revokes access for everyone.'},400);
  await db.batch([db.prepare('UPDATE exam_students SET revoked=1 WHERE exam_id=?').bind(exam.id),...grantStatements(db,exam.id,ids,u.id)]);return json({message:`Exam access saved for ${ids.length} selected student(s). Unselected students cannot open or submit this exam.`});
 }
 return json({error:'Not found'},404);
}
const quotes=['Every question you practise is another step towards understanding.','Small steps, taken consistently, lead to stronger skills.','A mistake is useful when you learn why it happened.','Read carefully, think clearly, and solve one step at a time.','Progress begins with curiosity and grows with practice.','Understand the idea, then test it with a new example.','Good problem-solvers ask questions before they write answers.','Your next discovery may begin with one more attempt.'];
export function learningQuote(){return quotes[crypto.getRandomValues(new Uint32Array(1))[0]%quotes.length]}
