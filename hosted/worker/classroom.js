import {permittedExam} from './access.js';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const read=async(db,s,...a)=>(await db.prepare(s).bind(...a).all()).results;
const one=(db,s,...a)=>db.prepare(s).bind(...a).first();
const run=(db,s,...a)=>db.prepare(s).bind(...a).run();
const teacher=u=>u.role==='admin'||u.role==='staff';
const scope=(u,q)=>u.role==='admin'||!u.subject_title||(u.assigned_paper===q.paper&&u.subject_title===q.topic);
const own=(u,r)=>r&&(u.role==='admin'||r.owner_id===u.id);
const valid=(s,n=160)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
export const snapshotVersion=(db,q,u,reason)=>db.prepare('INSERT INTO question_versions(question_id,actor_id,snapshot_json,reason) VALUES (?,?,?,?)').bind(q.id,u.id,JSON.stringify(q),reason);
const normalized=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function duplicateWarnings(incoming,bank){
 const candidates=bank.map(q=>({id:q.id,text:q.question,n:normalized(q.question),tokens:new Set(normalized(q.question).split(' '))})),warnings=[];
 for(let i=0;i<incoming.length;i++){const q=incoming[i],n=normalized(q.question),tokens=new Set(n.split(' '));if(!n)continue;for(const c of candidates){const intersection=[...tokens].filter(t=>c.tokens.has(t)).length,union=new Set([...tokens,...c.tokens]).size,similarity=union?intersection/union:0;if(n===c.n||(Math.min(tokens.size,c.tokens.size)>=5&&similarity>=0.82)){warnings.push({index:i,questionId:c.id??null,match:c.text,kind:n===c.n?'Exact duplicate':'Similar wording'});break}}candidates.push({id:null,text:q.question,n,tokens})}
 return warnings;
}
export async function classroomRequest(request,env,u,b={}){
 const url=new URL(request.url),p=url.pathname,m=request.method,db=env.DB;if(!p.startsWith('/api/classroom/'))return null;if(!u)return json({error:'Not logged in'},401);
 if(p==='/api/classroom/ready'&&m==='POST'&&u.role==='student'){
  const e=await permittedExam(db,u.id,Number(b.examId));if(!e)return json({error:'Exam not assigned to you'},403);
  const existing=await one(db,'SELECT id,status,deadline FROM learning_attempts WHERE exam_id=? AND student_id=?',e.id,u.id);if(e.access_code&&!existing&&String(b.accessCode||'').toUpperCase()!==e.access_code)return json({error:'Exam access code is incorrect.'},403);
  const sections=e.blueprint_json?JSON.parse(e.blueprint_json):[{paper:e.paper,topic:e.topic,count:e.question_count,difficulty:e.difficulty}],checks=[];
  for(const s of sections){const count=await one(db,"SELECT COUNT(*) count FROM questions WHERE archived=0 AND approval_state='approved' AND paper=? AND topic=? AND (? IN ('all','balanced') OR difficulty=?)",s.paper,s.topic,s.difficulty,s.difficulty);checks.push({topic:s.paper+' / '+s.topic,available:count.count,required:s.count,okay:count.count>=s.count})}
  const time=Date.now(),start=Date.parse(e.starts_at.replace(' ','T')+'Z'),end=Date.parse(e.ends_at.replace(' ','T')+'Z');return json({serverTime:new Date().toISOString(),examTitle:e.title,opensAt:new Date(start).toISOString(),closesAt:new Date(end).toISOString(),canStart:time>=start&&time<end&&checks.every(c=>c.okay),checks,existing,graceMinutes:e.grace_minutes||0,notice:'Two extra minutes are added to the exam timer and the closing deadline. This check does not start the timer. A successful connection check cannot guarantee that your connection will remain available.'});
 }
 if(p==='/api/classroom/notebook'){
  if(u.role!=='student')return json({error:'Student access required'},403);
  if(m==='GET')return json((await read(db,'SELECT * FROM mistake_notebook WHERE student_id=? ORDER BY updated_at DESC LIMIT 1000',u.id)).map(r=>({...r,question:JSON.parse(r.snapshot_json)})));
  if(m==='POST'){
   if(typeof b.notes!=='string'||b.notes.length>5000)return json({error:'Notes must contain at most 5000 characters.'},400);
   const old=await one(db,'SELECT * FROM mistake_notebook WHERE student_id=? AND question_id=?',u.id,Number(b.questionId));if(old&&!b.attemptId){await run(db,'UPDATE mistake_notebook SET notes=?,updated_at=CURRENT_TIMESTAMP WHERE student_id=? AND question_id=?',b.notes,u.id,Number(b.questionId));return json({message:'Notebook notes saved.'})}
   const a=await one(db,'SELECT a.*,e.release_policy,e.results_released,(SELECT p.approved_at FROM score_approvals p JOIN scores s ON s.id=p.score_id WHERE s.attempt_id=a.id) approved_at FROM learning_attempts a LEFT JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND a.student_id=?',String(b.attemptId||''),u.id);if(!a)return json({error:'Attempt not found'},404);
   if(a.mode==='exam'&&(a.status!=='submitted'||(a.release_policy!=='immediate'&&!a.results_released&&!a.approved_at)))return json({error:'Save exam questions after submitting and after your teacher releases the result.'},403);
   const q=JSON.parse(a.snapshot_json).find(q=>q.id===Number(b.questionId));if(!q)return json({error:'Question not found in your attempt'},404);
   const saved={id:q.id,paper:q.paper,topic:q.topic,question:q.question,correctAnswer:q['option_'+q.correct_option.toLowerCase()],explanation:q.explanation||'',diagram_data_uri:q.diagram_data_uri||null,diagram_alt:q.diagram_alt||null};await run(db,'INSERT INTO mistake_notebook(student_id,question_id,snapshot_json,notes) VALUES (?,?,?,?) ON CONFLICT(student_id,question_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,notes=excluded.notes,updated_at=CURRENT_TIMESTAMP',u.id,q.id,JSON.stringify(saved),b.notes);return json({message:'Question and your notes saved to your private notebook.'});
  }
 }
 if(p==='/api/classroom/assignments'){
  if(m==='POST')return json({error:'Assign students to a scheduled exam in the teaching workspace. Unrestricted practice assignments are disabled.'},403);
  if(m==='GET'){
   let list=teacher(u)?await read(db,'SELECT a.*,g.name group_name FROM revision_assignments a JOIN class_groups g ON g.id=a.group_id ORDER BY a.id DESC LIMIT 1000'):await read(db,'SELECT a.*,g.name group_name,x.id attempt_id,x.status attempt_status,x.submitted_at FROM revision_assignments a JOIN class_groups g ON g.id=a.group_id JOIN group_members m ON m.group_id=g.id LEFT JOIN learning_attempts x ON x.assignment_id=a.id AND x.student_id=? WHERE m.student_id=? AND a.archived=0 ORDER BY a.due_at,a.id',u.id,u.id);return json(teacher(u)?list.filter(a=>own(u,a)):list);
  }
  if(m==='POST'&&teacher(u)){
   if(b.id&&typeof b.archived==='boolean'){const a=await one(db,'SELECT * FROM revision_assignments WHERE id=?',Number(b.id));if(!own(u,a))return json({error:'Assignment not found'},404);await run(db,'UPDATE revision_assignments SET archived=? WHERE id=?',b.archived?1:0,a.id);return json({message:'Assignment updated.'})}
   const group=await one(db,'SELECT * FROM class_groups WHERE id=?',Number(b.groupId)),count=Number(b.questionCount),due=Date.parse(b.dueAt);if(!own(u,group)||!scope(u,b)||!valid(b.title)||!valid(b.paper)||!valid(b.topic)||!Number.isInteger(count)||count<1||count>50||!Number.isFinite(due)||due<=Date.now()||typeof b.instructions!=='string'||b.instructions.length>5000)return json({error:'Choose your class and subject, a future due date, and 1–50 questions.'},400);
   const pool=await one(db,"SELECT COUNT(*) count FROM questions WHERE archived=0 AND approval_state='approved' AND paper=? AND topic=?",b.paper,b.topic);if(pool.count<count)return json({error:'Not enough approved questions in this topic.'},400);
   const r=await run(db,'INSERT INTO revision_assignments(owner_id,group_id,title,paper,topic,question_count,due_at,instructions) VALUES (?,?,?,?,?,?,?,?)',u.id,group.id,b.title.trim(),b.paper,b.topic,count,new Date(due).toISOString(),b.instructions);return json({id:r.meta.last_row_id,message:'Revision assigned to the selected class.'});
  }
 }
 if(p.match(/^\/api\/classroom\/assignments\/\d+\/report$/)&&m==='GET'&&teacher(u)){
  if(u.role==='staff'&&!u.can_report)return json({error:'Reports are disabled by your administrator'},403);const a=await one(db,'SELECT * FROM revision_assignments WHERE id=?',Number(p.split('/')[4]));if(!own(u,a))return json({error:'Assignment not found'},404);
  const roster=await read(db,"SELECT u.id,u.username,COALESCE(u.display_name,u.username) name,x.id attempt_id,x.status,x.submitted_at,s.score*2 marks,s.total*2 totalMarks FROM group_members g JOIN users u ON u.id=g.student_id LEFT JOIN learning_attempts x ON x.assignment_id=? AND x.student_id=u.id LEFT JOIN scores s ON s.attempt_id=x.id WHERE g.group_id=? AND u.role='student' ORDER BY u.username",a.id,a.group_id);return json({assignment:a,roster:roster.map(r=>({...r,status:r.status==='submitted'?(Date.parse(r.submitted_at.replace(' ','T')+'Z')>Date.parse(a.due_at)?'Completed late':'Completed'):r.status==='active'?'In progress':'Not started'}))});
 }
 if(p.match(/^\/api\/classroom\/groups\/\d+\/performance$/)&&m==='GET'&&teacher(u)){
  if(u.role==='staff'&&!u.can_report)return json({error:'Reports disabled by administrator'},403);const g=await one(db,'SELECT * FROM class_groups WHERE id=?',Number(p.split('/')[4]));if(!own(u,g))return json({error:'Class not found'},404);
  const roster=await read(db,"SELECT u.id,u.username,COALESCE(u.display_name,u.username) name FROM group_members m JOIN users u ON u.id=m.student_id WHERE m.group_id=? AND u.role='student'",g.id);
  const scores=await read(db,'SELECT s.* FROM scores s JOIN group_members m ON m.student_id=s.student_id WHERE m.group_id=? ORDER BY s.id DESC LIMIT 5000',g.id),questions=await read(db,'SELECT id,paper,topic,question FROM questions'),lookup=new Map(questions.map(q=>[q.id,q])),topics=new Map(),latest=new Map();
  for(const s of scores)for(const r of JSON.parse(s.review_json||'[]')){const current=lookup.get(r.questionId)||questions.find(q=>q.question===r.question),paper=r.paper||current?.paper,topic=r.topic||current?.topic;if(!paper||!topic||!scope(u,{paper,topic}))continue;const key=s.student_id+':'+(r.questionId||r.question);if(latest.has(key))continue;latest.set(key,true);const label=paper+' / '+topic;if(!topics.has(label))topics.set(label,{paper,topic,answers:0,correct:0,students:new Set(),weak:new Set()});const t=topics.get(label);t.answers++;if(r.correct)t.correct++;t.students.add(s.student_id);if(!r.correct)t.weak.add(s.student_id)}
  return json({group:g,studentCount:roster.length,scope:'Latest answer per student and question across up to 5,000 recent scored attempts, including practice. Teacher analysis includes submitted results awaiting release.',topics:[...topics.values()].map(t=>({...t,students:t.students.size,studentsWithMistakes:t.weak.size,weak:undefined,accuracy:Math.round(t.correct/t.answers*100)})).sort((a,b)=>a.accuracy-b.accuracy)});
 }
 if(p==='/api/classroom/duplicates'&&m==='POST'&&teacher(u)){
  if(!Array.isArray(b.questions)||b.questions.length>500)return json({error:'Check up to 500 questions.'},400);const bank=(await read(db,'SELECT id,paper,topic,question FROM questions')).filter(q=>scope(u,q));return json({warnings:duplicateWarnings(b.questions,bank)});
 }
 const history=p.match(/^\/api\/classroom\/questions\/(\d+)\/history$/);
 if(history&&teacher(u)){
  const q=await one(db,'SELECT * FROM questions WHERE id=?',Number(history[1]));if(!q||!scope(u,q))return json({error:'Question not found'},404);
  if(m==='GET')return json({current:q,versions:(await read(db,'SELECT v.*,u.username FROM question_versions v LEFT JOIN users u ON u.id=v.actor_id WHERE v.question_id=? ORDER BY v.id DESC LIMIT 200',q.id)).map(v=>({...v,snapshot:JSON.parse(v.snapshot_json)}))});
  if(m==='POST'&&u.role==='admin'){
   const v=await one(db,'SELECT * FROM question_versions WHERE id=? AND question_id=?',Number(b.versionId),q.id);if(!v)return json({error:'Version not found'},404);const old=JSON.parse(v.snapshot_json);
   const keys=['question','option_a','option_b','option_c','option_d','correct_option','paper','topic','explanation','difficulty','archived','approval_state','diagram_data_uri','diagram_alt'];await db.batch([snapshotVersion(db,q,u,'Before restoring version '+v.id),db.prepare('UPDATE questions SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').bind(...keys.map(k=>old[k]??null),q.id)]);return json({message:'Earlier question version restored. Existing attempts retain their snapshots.'});
  }
 }
 return json({error:'Not found or access denied'},403);
}
