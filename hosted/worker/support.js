import {snapshotVersion} from './classroom.js';
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const rows=async(db,s,...a)=>(await db.prepare(s).bind(...a).all()).results;
const one=(db,s,...a)=>db.prepare(s).bind(...a).first();
const run=(db,s,...a)=>db.prepare(s).bind(...a).run();
const teacher=u=>['admin','staff'].includes(u.role);
const scope=(u,q)=>u.role==='admin'||!u.subject_title||(u.assigned_paper===q.paper&&u.subject_title===q.topic);
const valid=(s,n=4000)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
export const activeQuestion="archived=0 AND approval_state='approved'";
export function shuffleOptions(q){const letters=['A','B','C','D'],order=[...letters];for(let i=3;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[order[i],order[j]]=[order[j],order[i]]}const out={...q};for(let i=0;i<4;i++)out['option_'+letters[i].toLowerCase()]=q['option_'+order[i].toLowerCase()];out.correct_option=letters[order.indexOf(q.correct_option)];return out}
async function released(db,id){return rows(db,"SELECT s.* FROM scores s LEFT JOIN exams e ON e.id=s.exam_id WHERE s.student_id=? AND (s.exam_id IS NULL OR e.release_policy='immediate' OR e.results_released=1 OR EXISTS(SELECT 1 FROM score_approvals p WHERE p.score_id=s.id)) ORDER BY s.id DESC LIMIT 1000",id)}
export async function revisionItems(db,id){
 const latest=new Map();for(const s of await released(db,id))for(const q of JSON.parse(s.review_json||'[]')){const key=q.questionId?'id:'+q.questionId:'text:'+q.question;if(!latest.has(key))latest.set(key,{...q,at:s.attempted_at,topicLabel:s.topic})}
 const bank=await rows(db,'SELECT * FROM questions WHERE '+activeQuestion),now=Date.now();
 return bank.flatMap(q=>{const r=latest.get('id:'+q.id)||latest.get('text:'+q.question);if(!r)return [];const days=r.correct?7:2,due=Date.parse(r.at.replace(' ','T')+'Z')+days*86400000;return [{id:q.id,paper:q.paper,topic:q.topic,correct:!!r.correct,dueAt:new Date(due).toISOString(),due:due<=now}]});
}
const tables=['users','questions','scores','metadata','class_groups','group_members','exams','learning_attempts','announcements','password_reset_audit','question_submissions','question_flags','resources','accommodations','recovery_requests','revision_assignments','mistake_notebook','question_versions','exam_students','login_activity'];
export async function supportRequest(request,env,u,body,{hash,verify}={}){
 const url=new URL(request.url),p=url.pathname,m=request.method,db=env.DB;
 // Recovery requests never reveal whether a username exists. No password is changed here.
 if(p==='/api/recovery'&&m==='POST'){
  if(!valid(body.username,80)||!valid(body.message,1000))return json({error:'Enter your username and a message for the administrator.'},400);
  const account=await one(db,"SELECT id FROM users WHERE username=? AND role IN ('student','staff')",body.username.trim());
  if(account){const existing=await one(db,"SELECT id FROM recovery_requests WHERE user_id=? AND (status='open' OR created_at>datetime('now','-1 day'))",account.id);if(!existing)await run(db,'INSERT INTO recovery_requests(user_id,message) VALUES (?,?)',account.id,body.message.trim())}
  return json({message:'If this account exists, a request has been sent to the administrator. Contact your school to verify your identity and collect your new password.'});
 }
 if(!p.startsWith('/api/support/'))return null;
 if(!u)return json({error:'Not logged in'},401);
 if(p==='/api/support/revision'&&m==='GET'){
  if(u.role!=='student')return json({error:'Student access required'},403);
  const items=await revisionItems(db,u.id),topics=await rows(db,'SELECT paper,topic,COUNT(*) total FROM questions WHERE '+activeQuestion+' GROUP BY paper,topic');
  const plan=topics.map(t=>{const seen=items.filter(i=>i.paper===t.paper&&i.topic===t.topic),wrong=seen.filter(i=>!i.correct).length;return {...t,covered:seen.length,wrong,due:seen.filter(i=>i.due).length,accuracy:seen.length?Math.round((seen.length-wrong)/seen.length*100):null,priority:wrong*3+seen.filter(i=>i.due).length+(seen.length?0:1)}}).sort((a,b)=>b.priority-a.priority);
  return json({plan,dueCount:items.filter(i=>i.due).length,nextReview:items.filter(i=>!i.due).sort((a,b)=>a.dueAt.localeCompare(b.dueAt))[0]?.dueAt||null,policy:'Incorrect answers return after 2 days; correct answers return after 7 days. Only released results are used.'});
 }
 if(p==='/api/support/resources'){
  if(m==='GET'){let list=await rows(db,'SELECT * FROM resources ORDER BY id DESC LIMIT 2000');if(!teacher(u))list=list.filter(r=>!r.archived);else list=list.filter(r=>scope(u,r));return json(list)}
  if(m==='POST'&&teacher(u)){
   if(body.id&&typeof body.archived==='boolean'){const r=await one(db,'SELECT * FROM resources WHERE id=?',Number(body.id));if(!r||!(u.role==='admin'||r.owner_id===u.id))return json({error:'Resource not found'},404);await run(db,'UPDATE resources SET archived=? WHERE id=?',body.archived?1:0,r.id);return json({message:'Resource updated.'})}
   if(!valid(body.title,160)||!valid(body.body,10000)||!valid(body.paper,160)||!valid(body.topic,160)||!scope(u,body))return json({error:'Enter a title, notes and your assigned paper/topic.'},400);
   let link=null;if(body.url){try{const t=new URL(body.url);if(t.protocol!=='https:'||t.username||t.password)throw Error();link=t.href}catch{return json({error:'Use a complete HTTPS resource link.'},400)}}
   await run(db,'INSERT INTO resources(owner_id,paper,topic,title,body,url) VALUES (?,?,?,?,?,?)',u.id,body.paper,body.topic,body.title,body.body,link);return json({message:'Learning resource published.'});
  }
 }
 if(p==='/api/support/flags'){
  if(m==='POST'&&u.role==='student'){
   if(!valid(body.message,2000)||!valid(body.attemptId,100))return json({error:'Describe the question problem.'},400);
   const a=await one(db,'SELECT * FROM learning_attempts WHERE id=? AND student_id=?',body.attemptId,u.id),q=a&&JSON.parse(a.snapshot_json).find(q=>q.id===Number(body.questionId));if(!q)return json({error:'Choose a question from your attempt.'},404);
   if(await one(db,"SELECT id FROM question_flags WHERE student_id=? AND question_id=? AND status='open'",u.id,q.id))return json({error:'You already have an open report for this question.'},409);
   await run(db,'INSERT INTO question_flags(student_id,question_id,question_text,message) VALUES (?,?,?,?)',u.id,q.id,q.question,body.message);return json({message:'Question reported. Staff will review it.'});
  }
  if(m==='GET'){const list=teacher(u)?await rows(db,'SELECT f.*,q.paper,q.topic,u.username FROM question_flags f LEFT JOIN questions q ON q.id=f.question_id JOIN users u ON u.id=f.student_id ORDER BY f.id DESC LIMIT 1000'):await rows(db,'SELECT * FROM question_flags WHERE student_id=? ORDER BY id DESC LIMIT 200',u.id);return json(teacher(u)?list.filter(q=>scope(u,q)):list)}
 }
 if(p.match(/^\/api\/support\/flags\/\d+$/)&&m==='POST'&&teacher(u)){
  const f=await one(db,'SELECT f.*,q.paper,q.topic FROM question_flags f JOIN questions q ON q.id=f.question_id WHERE f.id=?',Number(p.split('/').pop()));if(!f||!scope(u,f))return json({error:'Report not found'},404);if(!valid(body.response,2000))return json({error:'Enter a reply for the student.'},400);await run(db,"UPDATE question_flags SET status='resolved',response=? WHERE id=?",body.response,f.id);return json({message:'Student report resolved.'});
 }
 if(p==='/api/support/quality'&&m==='GET'&&teacher(u)){
  if(u.role==='staff'&&!u.can_report)return json({error:'Reports disabled by administrator'},403);
  const qs=(await rows(db,'SELECT id,question,paper,topic FROM questions')).filter(q=>scope(u,q)),map=new Map(qs.map(q=>[q.id,{...q,attempts:0,correct:0,unanswered:0}]));
  for(const s of await rows(db,'SELECT review_json FROM scores WHERE review_json IS NOT NULL ORDER BY id DESC LIMIT 5000'))for(const r of JSON.parse(s.review_json)){const q=map.get(r.questionId);if(q){q.attempts++;if(r.correct)q.correct++;if(!r.selectedOption)q.unanswered++}}
  return json([...map.values()].filter(q=>q.attempts).map(q=>({...q,accuracy:Math.round(q.correct/q.attempts*100)})).sort((a,b)=>a.accuracy-b.accuracy));
 }
 if(p==='/api/support/submissions'&&m==='GET'&&teacher(u)){const list=await rows(db,'SELECT s.*,u.username FROM question_submissions s JOIN users u ON u.id=s.author_id ORDER BY s.id DESC LIMIT 1000');return json(u.role==='admin'?list:list.filter(s=>s.author_id===u.id))}
 if(p.match(/^\/api\/support\/submissions\/\d+$/)&&m==='POST'&&u.role==='admin'){
  const s=await one(db,"SELECT * FROM question_submissions WHERE id=? AND status='pending'",Number(p.split('/').pop()));if(!s)return json({error:'Pending submission not found'},404);
  if(!['approve','reject'].includes(body.action)||typeof (body.note||'')!=='string'||(body.note||'').length>2000)return json({error:'Choose approve or reject.'},400);
  const q=JSON.parse(s.payload),stmts=[];if(body.action==='approve'){const current=await one(db,'SELECT * FROM questions WHERE id=?',s.question_id);if(current)stmts.push(snapshotVersion(db,current,u,'Before approving staff submission '+s.id))}
  if(body.action==='approve')stmts.push(db.prepare("UPDATE questions SET question=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_option=?,paper=?,topic=?,explanation=?,difficulty=?,approval_state='approved' WHERE id=?").bind(q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option.toUpperCase(),q.paper,q.topic,q.explanation||'',q.difficulty||'unrated',s.question_id));
  else stmts.push(db.prepare("UPDATE questions SET approval_state='rejected' WHERE id=? AND approval_state='pending'").bind(s.question_id));
  stmts.push(db.prepare('UPDATE question_submissions SET status=?,note=? WHERE id=?').bind(body.action==='approve'?'approved':'rejected',body.note||'',s.id));await db.batch(stmts);return json({message:'Question submission '+(body.action==='approve'?'approved.':'rejected.')});
 }
 if(p.match(/^\/api\/support\/exams\/\d+\/accommodations$/)&&teacher(u)){
  const exam=await one(db,'SELECT * FROM exams WHERE id=?',Number(p.split('/')[4]));if(!exam||!(u.role==='admin'||exam.owner_id===u.id))return json({error:'Exam not found'},404);
  if(m==='GET')return json(await rows(db,'SELECT a.*,u.username FROM accommodations a JOIN users u ON u.id=a.student_id WHERE a.exam_id=?',exam.id));
  if(m==='POST'){
   const student=await one(db,"SELECT id FROM users WHERE id=? AND role='student' AND is_active=1",Number(body.studentId)),extra=Number(body.extraMinutes);if(!student||!Number.isInteger(extra)||extra<0||extra>240)return json({error:'Select a student and 0–240 extra minutes.'},400);
   if(exam.group_id&&!await one(db,'SELECT 1 yes FROM group_members WHERE group_id=? AND student_id=?',exam.group_id,student.id))return json({error:'Student is not in this exam group.'},403);
   if(await one(db,'SELECT id FROM learning_attempts WHERE exam_id=? AND student_id=?',exam.id,student.id))return json({error:'Set extra time before the student starts the exam.'},409);
   await run(db,'INSERT INTO accommodations(exam_id,student_id,extra_minutes) VALUES (?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET extra_minutes=excluded.extra_minutes',exam.id,student.id,extra);return json({message:'Extra time saved. The exam closing time remains the final deadline.'});
  }
 }
 if(u.role==='admin'&&p==='/api/support/recovery'&&m==='GET')return json(await rows(db,'SELECT r.*,u.username,u.display_name,u.email,u.student_number,u.role FROM recovery_requests r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 1000'));
 if(u.role==='admin'&&p.match(/^\/api\/support\/recovery\/\d+$/)&&m==='POST'){
  const r=await one(db,"SELECT r.*,u.role FROM recovery_requests r JOIN users u ON u.id=r.user_id WHERE r.id=? AND r.status='open'",Number(p.split('/').pop()));if(!r||r.role==='admin')return json({error:'Request not found'},404);
  if(body.action==='dismiss'){await run(db,"UPDATE recovery_requests SET status='dismissed' WHERE id=?",r.id);return json({message:'Request dismissed.'})}
  if(body.identityVerified!==true||typeof body.password!=='string'||body.password.length<10||body.password.length>256)return json({error:'Verify the person’s identity through your school, then assign a password of 10–256 characters.'},400);
  await db.batch([db.prepare('UPDATE users SET password=? WHERE id=?').bind(await hash(body.password),r.user_id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(r.user_id),db.prepare('INSERT INTO password_reset_audit(actor_id,target_id) VALUES (?,?)').bind(u.id,r.user_id),db.prepare("UPDATE recovery_requests SET status='resolved' WHERE id=?").bind(r.id)]);return json({message:'Password reset. Share the new password privately with the verified account holder.'});
 }
 if(u.role==='admin'&&p==='/api/support/backup'&&m==='POST'){
  const account=await one(db,'SELECT password FROM users WHERE id=?',u.id);if(typeof body.currentPassword!=='string'||!await verify(body.currentPassword,account.password))return json({error:'Current administrator password is required.'},403);
  const data={format:'beghin-mcq-backup-v1',createdAt:new Date().toISOString(),tables:{}};
  const snapshot=await db.batch(tables.map(t=>db.prepare('SELECT * FROM '+t)));for(let i=0;i<tables.length;i++)data.tables[tables[i]]=snapshot[i].results;
  return json(data);
 }
 if(u.role==='admin'&&p==='/api/support/restore'&&m==='POST'){
  const account=await one(db,'SELECT * FROM users WHERE id=?',u.id);if(typeof body.currentPassword!=='string'||!await verify(body.currentPassword,account.password))return json({error:'Current administrator password is required.'},403);
  const b=body.backup;if(b?.format!=='beghin-mcq-backup-v1'||!b.tables||tables.some(t=>!Array.isArray(b.tables[t])))return json({error:'Unsupported backup file.'},400);
  const count=tables.reduce((n,t)=>n+b.tables[t].length,0);if(count>20000)return json({error:'This backup is too large for browser restore. Contact the administrator for a managed restore.'},413);
  if(!b.tables.users.some(a=>a.id===u.id&&a.username===u.username&&a.role==='admin'))return json({error:'This backup does not contain the current administrator account.'},400);
  const protectedAdmins=await rows(db,'SELECT u.id,u.username FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE m.enabled=1');if(protectedAdmins.some(a=>!b.tables.users.some(x=>x.id===a.id&&x.username===a.username&&x.role==='admin')))return json({error:'This backup does not preserve every administrator with two-factor authentication enabled.'},400);
  const columns={};for(const t of tables)columns[t]=(await rows(db,'PRAGMA table_info('+t+')')).map(c=>c.name);
  for(const t of tables)for(const row of b.tables[t])if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==columns[t].length||columns[t].some(c=>!Object.hasOwn(row,c)||(row[c]!==null&&!['string','number'].includes(typeof row[c]))))return json({error:'Backup schema does not match this website.'},400);
  for(const r of b.tables.resources)if(r.url){try{const link=new URL(r.url);if(link.protocol!=='https:'||link.username||link.password)throw Error()}catch{return json({error:'Backup contains an invalid resource link.'},400)}}
  if(b.tables.users.some(a=>!['admin','staff','student'].includes(a.role)||typeof a.password!=='string')||b.tables.questions.some(q=>!['A','B','C','D'].includes(q.correct_option)||!['approved','pending','rejected'].includes(q.approval_state)))return json({error:'Backup contains invalid account or question values.'},400);
  for(const t of ['learning_attempts','scores','question_submissions'])for(const r of b.tables[t]){try{if(t==='learning_attempts'){if(!Array.isArray(JSON.parse(r.snapshot_json)))throw Error();JSON.parse(r.answers_json)}else if(t==='scores'&&r.review_json){if(!Array.isArray(JSON.parse(r.review_json)))throw Error()}else if(t==='question_submissions')JSON.parse(r.payload)}catch{return json({error:'Backup contains invalid saved question or answer data.'},400)}}
  if(body.preview===true)return json({counts:Object.fromEntries(tables.map(t=>[t,b.tables[t].length])),createdAt:b.createdAt});
  if(body.confirmation!=='RESTORE ALL DATA')return json({error:'Type RESTORE ALL DATA after reviewing the backup.'},400);
  // Keep the current administrator password so an older backup cannot lock the owner out.
  b.tables.users.find(a=>a.id===u.id).password=account.password;b.tables.users.find(a=>a.id===u.id).is_active=1;
  const stmts=[db.prepare('DELETE FROM sessions'),...tables.slice().reverse().map(t=>db.prepare('DELETE FROM '+t))];
  for(const t of tables){const cols=columns[t],size=Math.max(1,Math.floor(90/cols.length));for(let i=0;i<b.tables[t].length;i+=size){const batch=b.tables[t].slice(i,i+size);stmts.push(db.prepare('INSERT INTO '+t+' ('+cols.join(',')+') VALUES '+batch.map(()=> '('+cols.map(()=>'?').join(',')+')').join(',')).bind(...batch.flatMap(row=>cols.map(c=>row[c]))))}}
  await db.batch(stmts);return json({message:'Backup restored. All sessions were signed out. Sign in again using your current administrator password.'});
 }
 return json({error:'Not found or access denied'},403);
}
