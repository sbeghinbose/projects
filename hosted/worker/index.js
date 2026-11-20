import bcrypt from 'bcryptjs';
import bank from '../questions.json';
import assets from '../assets.json';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
async function digest(s){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))}
async function hash(password,salt=hex(crypto.getRandomValues(new Uint8Array(16)))){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2$${salt}$${hex(new Uint8Array(bits))}`;
}
async function verify(password,stored){
 if(stored.startsWith('pbkdf2$'))return await hash(password,stored.split('$')[1])===stored;
 return bcrypt.compare(password,stored);
}
async function initialize(env){
 if(await env.DB.prepare("SELECT value FROM metadata WHERE key='initialized-v1'").first())return;
 for(let i=0;i<bank.length;i+=40) await env.DB.batch(bank.slice(i,i+40).map(q=>env.DB.prepare('INSERT OR IGNORE INTO questions(question,option_a,option_b,option_c,option_d,correct_option,paper,topic,source_number,source_key) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option,q.paper,q.topic,q.source_number,`${q.paper}:${q.source_number}`)));
 const initial=env.INITIAL_DATA?JSON.parse(env.INITIAL_DATA):{users:[],scores:[],questions:[]};
 for(const u of initial.users) await env.DB.prepare('INSERT OR IGNORE INTO users(id,username,password,role) VALUES (?,?,?,?)').bind(u.id,u.username,u.password,u.role).run();
 for(const q of initial.questions||[]) await env.DB.prepare('INSERT OR IGNORE INTO questions(question,option_a,option_b,option_c,option_d,correct_option,paper,topic,source_number,source_key) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option,q.paper,q.topic,q.source_number,`migrated:${q.id}`).run();
 for(const s of initial.scores) await env.DB.prepare('INSERT OR IGNORE INTO scores(id,student_id,score,total,attempted_at,topic,review_json) VALUES (?,?,?,?,?,?,?)').bind(s.id,s.student_id,s.score,s.total,s.attempted_at,s.topic,s.review_json).run();
 await env.DB.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES ('initialized-v1','done')").run();
}
async function initializeAdmin(env){
 if(!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH)return;
 if(await env.DB.prepare("SELECT value FROM metadata WHERE key='admin-initialized-v1'").first())return;
 await env.DB.prepare("INSERT OR IGNORE INTO users(username,password,role,display_name) VALUES (?,?,'admin','Portal Administrator')").bind(env.ADMIN_USERNAME,env.ADMIN_PASSWORD_HASH).run();
 const admin=await env.DB.prepare('SELECT role FROM users WHERE username=?').bind(env.ADMIN_USERNAME).first();
 if(admin?.role!=='admin')throw new Error('Administrator username is already in use');
 await env.DB.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES ('admin-initialized-v1','done')").run();
}
const staffView=u=>({id:u.id,username:u.username,name:u.display_name||u.username,subjectTitle:u.subject_title||'',paper:u.assigned_paper||'',canUpload:!!u.can_upload,active:!!u.is_active});
const staffFields=b=>typeof b.name==='string'&&b.name.trim()&&b.name.length<=120&&typeof b.subjectTitle==='string'&&b.subjectTitle.trim()&&b.subjectTitle.length<=160&&typeof b.paper==='string'&&b.paper.trim()&&b.paper.length<=80&&typeof b.canUpload==='boolean'&&typeof b.active==='boolean';
const cookie=(token,age=28800)=>`mcq_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const result=row=>({id:row.id,score:row.score,total:row.total,topic:row.topic,marks:row.score*2,totalMarks:row.total*2,review:row.review_json?JSON.parse(row.review_json):null});
const validQuestion=q=>q&&['question','option_a','option_b','option_c','option_d'].every(k=>typeof q[k]==='string'&&q[k].trim())&&typeof q.correct_option==='string'&&/^[ABCD]$/i.test(q.correct_option);
async function handle(request,env){
 const url=new URL(request.url),route=url.pathname,method=request.method;
 if(method==='GET'&&assets[route])return new Response(assets[route],{headers:{'Content-Type':route.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
 if(route==='/health')return json({status:'ok'});
 if(!route.startsWith('/api/'))return json({error:'Not found'},404);
 if(method==='POST'&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Invalid origin'},403);
 if(Number(request.headers.get('Content-Length')||0)>250000)return json({error:'Request too large'},413);
 await initialize(env);
 await initializeAdmin(env);
 const rawToken=request.headers.get('Cookie')?.match(/(?:^|;\s*)mcq_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 const token=rawToken?await digest(rawToken):null;
 const login=token?await env.DB.prepare('SELECT sessions.token,sessions.quiz_json,users.id,users.username,users.role,users.display_name,users.subject_title,users.assigned_paper,users.can_upload,users.is_active FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.is_active=1').bind(token,Date.now()).first():null;
 let body={};
 if(method==='POST'){try{body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body))throw Error()}catch{return json({error:'Invalid request'},400)}}
 if(route==='/api/register'&&method==='POST'){
  if(body.role!==undefined&&body.role!=='student')return json({error:'Only student registration is available.'},403);
  if(typeof body.username!=='string'||!body.username.trim()||body.username.length>80||typeof body.password!=='string'||!body.password||body.password.length>256)return json({error:'Enter a username and password'},400);
  try{await env.DB.prepare("INSERT INTO users(username,password,role) VALUES (?,?,'student')").bind(body.username.trim(),await hash(body.password)).run()}catch(e){if(String(e).includes('UNIQUE'))return json({error:'Username already exists'},400);throw e}
  return json({message:'Registration successful! Please login.'});
 }
 if(route==='/api/login'&&method==='POST'){
  if(typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>256)return json({error:'Invalid credentials'},401);
  const u=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(body.username.trim()).first();
  if(!u||!u.is_active||!await verify(body.password,u.password))return json({error:'Invalid credentials'},401);
  if(body.portal && body.portal!==u.role)return json({error:'Use the '+(u.role==='admin'?'Administrator':u.role==='staff'?'Staff':'Student')+' login for this account.'},403);
  if(!u.password.startsWith('pbkdf2$'))await env.DB.prepare('UPDATE users SET password=? WHERE id=?').bind(await hash(body.password),u.id).run();
  if(token)await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  const value=hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').bind(await digest(value),u.id,Date.now()+28800000).run();
  return json({role:u.role,username:u.username},200,{'Set-Cookie':cookie(value)});
 }
 if(route==='/api/logout'&&method==='POST'){
  if(token)await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  return json({message:'Logged out'},200,{'Set-Cookie':cookie('',0)});
 }
 if(!login)return json({error:'Not logged in'},401);
 if(route==='/api/me'&&method==='GET')return json({...staffView(login),role:login.role});
 if(route.startsWith('/api/admin/')){
  if(login.role!=='admin')return json({error:'Administrator access required'},403);
  if(route==='/api/admin/staff'&&method==='GET')return json((await env.DB.prepare("SELECT * FROM users WHERE role='staff' ORDER BY id").all()).results.map(staffView));
  if(route==='/api/admin/staff'&&method==='POST'){
   if(!staffFields(body)||typeof body.username!=='string'||!body.username.trim()||body.username.length>80||typeof body.password!=='string'||body.password.length<10||body.password.length>256)return json({error:'Enter staff name, username, subject, paper and a password of at least 10 characters.'},400);
   try{await env.DB.prepare("INSERT INTO users(username,password,role,display_name,subject_title,assigned_paper,can_upload,is_active) VALUES (?,?,'staff',?,?,?,?,?)").bind(body.username.trim(),await hash(body.password),body.name.trim(),body.subjectTitle.trim(),body.paper.trim(),body.canUpload?1:0,body.active?1:0).run()}catch(e){if(String(e).includes('UNIQUE'))return json({error:'Username already exists'},400);throw e}
   return json({message:'Staff account created. Share its username and password privately.'},201);
  }
  if(/^\/api\/admin\/staff\/\d+$/.test(route)&&method==='POST'){
   const id=Number(route.split('/').pop());
   if(!staffFields(body))return json({error:'Enter staff name, subject and paper.'},400);
   const staff=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='staff'").bind(id).first();
   if(!staff)return json({error:'Staff account not found'},404);
   await env.DB.prepare("UPDATE users SET display_name=?,subject_title=?,assigned_paper=?,can_upload=?,is_active=? WHERE id=? AND role='staff'").bind(body.name.trim(),body.subjectTitle.trim(),body.paper.trim(),body.canUpload?1:0,body.active?1:0,id).run();
   return json({message:'Staff details and permissions updated.'});
  }
  return json({error:'Not found'},404);
 }
 if(route==='/api/topics'&&method==='GET'){
  if(login.role==='staff'&&login.subject_title){
   const row=await env.DB.prepare('SELECT COUNT(*) count FROM questions WHERE paper=? AND topic=?').bind(login.assigned_paper,login.subject_title).first();
   return json([{paper:login.assigned_paper,topic:login.subject_title,count:row.count}]);
  }
  const topics=(await env.DB.prepare("SELECT COALESCE(paper,'Other') paper,COALESCE(topic,'General') topic,COUNT(*) count FROM questions GROUP BY paper,topic ORDER BY paper,MIN(id)").all()).results;
  return json(topics);
 }
 if(route.startsWith('/api/questions')){
  if(!['staff','admin'].includes(login.role))return json({error:'Unauthorized'},403);
  if(route==='/api/questions/all'&&method==='GET'){
   const statement=login.role==='staff'&&login.subject_title?env.DB.prepare('SELECT * FROM questions WHERE paper=? AND topic=? ORDER BY id DESC').bind(login.assigned_paper,login.subject_title):env.DB.prepare('SELECT * FROM questions ORDER BY id DESC');return json((await statement.all()).results);
  }
  if(method==='POST'&&(route==='/api/questions'||route==='/api/questions/bulk')){
   if(login.role==='staff'&&!login.can_upload)return json({error:'Your administrator has disabled question uploads.'},403);
   const qs=route.endsWith('/bulk')?body.questions:[body];
   if(!Array.isArray(qs)||qs.length<1||qs.length>500||!qs.every(validQuestion))return json({error:'Provide complete questions with correct answer A, B, C, or D'},400);
   if(login.role==='staff'&&login.subject_title&&qs.some(q=>(q.paper||body.paper||'Other')!==login.assigned_paper||(q.topic||body.topic||'General')!==login.subject_title))return json({error:'You can only upload to your assigned paper and subject.'},403);
   for(let i=0;i<qs.length;i+=40)await env.DB.batch(qs.slice(i,i+40).map(q=>env.DB.prepare('INSERT INTO questions(question,option_a,option_b,option_c,option_d,correct_option,paper,topic) VALUES (?,?,?,?,?,?,?,?)').bind(q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option.toUpperCase(),q.paper||body.paper||'Other',q.topic||body.topic||'General')));
   return json({message:`${qs.length} question(s) added!`});
  }
 }
 if(login.role!=='student')return json({error:'Unauthorized'},403);
 if(route==='/api/quiz'&&method==='GET'){
  const paper=url.searchParams.get('paper'),topic=url.searchParams.get('topic');
  if(!paper||!topic)return json({error:'Select a paper and topic'},400);
  const qs=(await env.DB.prepare('SELECT id,question,option_a,option_b,option_c,option_d FROM questions WHERE paper=? AND topic=? ORDER BY RANDOM() LIMIT 50').bind(paper,topic).all()).results;
  await env.DB.prepare('UPDATE sessions SET quiz_json=? WHERE token=?').bind(JSON.stringify({ids:qs.map(q=>q.id),paper,topic}),token).run();return json(qs);
 }
 if(route==='/api/quiz/submit'&&method==='POST'){
  const quiz=login.quiz_json?JSON.parse(login.quiz_json):null;
  if(!quiz?.ids?.length)return json({error:'Start a quiz first'},400);
  const answers=body.answers;if(!answers||typeof answers!=='object'||Array.isArray(answers))return json({error:'Invalid answers'},400);
  const rows=(await env.DB.prepare(`SELECT * FROM questions WHERE id IN (${quiz.ids.map(()=>'?').join(',')})`).bind(...quiz.ids).all()).results;
  const review=quiz.ids.map((id,index)=>{const q=rows.find(q=>q.id===id);const selected=['A','B','C','D'].includes(answers[id])?answers[id]:null;const correct=selected===q.correct_option;return {number:index+1,question:q.question,selectedOption:selected,selectedAnswer:selected?q['option_'+selected.toLowerCase()]:null,correctOption:q.correct_option,correctAnswer:q['option_'+q.correct_option.toLowerCase()],correct,marks:correct?2:0}});
  const score=review.filter(q=>q.correct).length,total=review.length,topic=`${quiz.paper} — ${quiz.topic}`;
  // Atomically consume the attempt; a simultaneous second submit inserts no row.
  await env.DB.batch([
   env.DB.prepare('INSERT INTO scores(student_id,score,total,topic,review_json) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions WHERE token=? AND quiz_json=?)').bind(login.id,score,total,topic,JSON.stringify(review),token,login.quiz_json),
   env.DB.prepare('UPDATE sessions SET quiz_json=NULL WHERE token=? AND quiz_json=?').bind(token,login.quiz_json)
  ]);
  const saved=await env.DB.prepare('SELECT id FROM scores WHERE student_id=? ORDER BY id DESC LIMIT 1').bind(login.id).first();
  return json({id:saved.id,score,total,marks:score*2,totalMarks:total*2,topic,review});
 }
 if(route==='/api/scores'&&method==='GET')return json((await env.DB.prepare('SELECT id,score,total,score*2 marks,total*2 totalMarks,attempted_at,topic,review_json IS NOT NULL hasReview FROM scores WHERE student_id=? ORDER BY id DESC').bind(login.id).all()).results);
 if(/^\/api\/scores\/\d+$/.test(route)&&method==='GET'){
  const row=await env.DB.prepare('SELECT * FROM scores WHERE id=? AND student_id=?').bind(Number(route.split('/').pop()),login.id).first();return row?json(result(row)):json({error:'Result not found'},404);
 }
 return json({error:'Not found'},404);
}
export default {async fetch(request,env){try{return await handle(request,env)}catch(e){console.error('Portal request failed',e.message);return json({error:'Unable to complete request. Please try again.'},500)}}};
