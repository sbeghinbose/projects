import {exportReport,xlsx} from './reports.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const text=(v,max=160)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const teacher=u=>u.role==='admin'||u.role==='staff';
const allowed=(u,paper,topic)=>u.role==='admin'||!u.subject_title||(u.assigned_paper===paper&&u.subject_title===topic);
const owned=(u,row)=>row&&(u.role==='admin'||row.owner_id===u.id);
const utc=()=>new Date().toISOString().slice(0,19).replace('T',' ');
const millis=s=>s?Date.parse(s.replace(' ','T')+(s.includes('Z')?'':'Z')):null;
const iso=s=>s?new Date(millis(s)).toISOString():null;
const read=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const publicQuestion=q=>({id:q.id,question:q.question,option_a:q.option_a,option_b:q.option_b,option_c:q.option_c,option_d:q.option_d,difficulty:q.difficulty||'unrated'});
const sanitize=(answers,questions)=>Object.fromEntries(questions.filter(q=>['A','B','C','D'].includes(answers?.[q.id])).map(q=>[q.id,answers[q.id]]));
const permission=u=>u.role==='admin'||u.can_upload;
function validateQuestion(q){return q&&['question','option_a','option_b','option_c','option_d','paper','topic'].every(k=>text(q[k],k==='question'?4000:1000))&&typeof q.correct_option==='string'&&/^[ABCD]$/i.test(q.correct_option)&&(!q.difficulty||['easy','medium','hard','unrated'].includes(q.difficulty))&&(!q.explanation||typeof q.explanation==='string'&&q.explanation.length<=5000)}
const topicLabel=(paper,topic)=>`${paper} — ${topic}`;
async function visibleExam(db,u,id){const exam=await one(db,'SELECT * FROM exams WHERE id=?',id);if(!exam||exam.cancelled)return null;if(teacher(u))return owned(u,exam)?exam:null;if(!exam.group_id)return exam;return await one(db,'SELECT 1 yes FROM group_members WHERE group_id=? AND student_id=?',exam.group_id,u.id)?exam:null}
async function scoreAttempt(db,a,proposed){
 if(a.status==='submitted')return a;
 const questions=JSON.parse(a.snapshot_json),late=a.deadline&&Date.now()>=millis(a.deadline);
 const answers=sanitize(late?JSON.parse(a.answers_json):(proposed||JSON.parse(a.answers_json)),questions);
 const review=questions.map((q,i)=>{const selected=answers[q.id]||null,correct=selected===q.correct_option;return {number:i+1,questionId:q.id,question:q.question,selectedOption:selected,selectedAnswer:selected?q['option_'+selected.toLowerCase()]:null,correctOption:q.correct_option,correctAnswer:q['option_'+q.correct_option.toLowerCase()],explanation:q.explanation||'',difficulty:q.difficulty||'unrated',correct,marks:correct?2:0}});
 const score=review.filter(q=>q.correct).length;
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO scores(student_id,score,total,topic,review_json,attempt_id,exam_id,mode) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM learning_attempts WHERE id=? AND status='active')").bind(a.student_id,score,questions.length,topicLabel(a.paper,a.topic),JSON.stringify(review),a.id,a.exam_id,a.mode,a.id),
  db.prepare("UPDATE learning_attempts SET answers_json=?,status='submitted',submitted_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(JSON.stringify(answers),a.id)
 ]);
 return {...a,status:'submitted',answers_json:JSON.stringify(answers)};
}
async function attemptView(db,a,u){
 if(a.status==='active'&&a.deadline&&Date.now()>=millis(a.deadline))a=await scoreAttempt(db,a);
 const exam=a.exam_id?await one(db,'SELECT * FROM exams WHERE id=?',a.exam_id):null;
 const visible=teacher(u)||!exam||exam.release_policy==='immediate'||exam.results_released;
 const result={id:a.id,examId:a.exam_id,title:exam?.title||topicLabel(a.paper,a.topic),paper:a.paper,topic:a.topic,mode:a.mode,status:a.status,startedAt:iso(a.started_at),deadline:iso(a.deadline),serverTime:new Date().toISOString(),answers:JSON.parse(a.answers_json),questions:JSON.parse(a.snapshot_json).map(publicQuestion),resultsAvailable:!!visible};
 if(a.status==='submitted'){
  const score=await one(db,'SELECT * FROM scores WHERE attempt_id=?',a.id);
  if(score&&visible)Object.assign(result,{scoreId:score.id,score:score.score,total:score.total,marks:score.score*2,totalMarks:score.total*2,review:JSON.parse(score.review_json)});
  else result.message='Submitted. Your teacher will release the marks and answer review.';
 }
 return result;
}
async function finalizeExam(db,id){const attempts=await read(db,"SELECT * FROM learning_attempts WHERE exam_id=? AND status='active' AND deadline<=?",id,utc());for(const a of attempts)await scoreAttempt(db,a)}
async function releasedScores(db,student){return read(db,"SELECT s.*,e.release_policy,e.results_released FROM scores s LEFT JOIN exams e ON e.id=s.exam_id WHERE s.student_id=? AND (s.exam_id IS NULL OR e.release_policy='immediate' OR e.results_released=1) ORDER BY s.id DESC LIMIT 1000",student)}
async function wrongQuestions(db,student,paper,topic){const scores=await releasedScores(db,student),latest=new Map();for(const s of scores)for(const q of JSON.parse(s.review_json||'[]'))if(!latest.has(q.question))latest.set(q.question,q.correct);const wrong=[...latest].filter(([,correct])=>!correct).map(([q])=>q);if(!wrong.length)return [];const active=await read(db,'SELECT * FROM questions WHERE archived=0 AND paper=? AND topic=?',paper,topic);return active.filter(q=>wrong.includes(q.question))}
function chooseQuestions(pool,count,difficulty){
 const shuffled=[...pool];for(let i=shuffled.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}
 if(difficulty==='balanced'){const result=[];for(const level of ['easy','medium','hard'])result.push(...shuffled.filter(q=>q.difficulty===level).slice(0,Math.floor(count/3)));return [...result,...shuffled.filter(q=>!result.includes(q))].slice(0,count)}
 return (['easy','medium','hard','unrated'].includes(difficulty)?shuffled.filter(q=>q.difficulty===difficulty):shuffled).slice(0,count);
}
export async function learningRequest(request,env,u,body={}){
 const url=new URL(request.url),path=url.pathname,method=request.method,db=env.DB;
 if(!path.startsWith('/api/learning/')&&!path.startsWith('/api/teaching/')&&!path.startsWith('/api/questions')&&path!=='/api/topics'&&!path.startsWith('/api/scores'))return null;
 if(path==='/api/topics'&&method==='GET'){
  if(u.role==='staff'&&u.subject_title){const row=await one(db,'SELECT COUNT(*) count FROM questions WHERE paper=? AND topic=? AND archived=0',u.assigned_paper,u.subject_title);return json([{paper:u.assigned_paper,topic:u.subject_title,count:row.count}])}
  return json(await read(db,"SELECT COALESCE(paper,'Other') paper,COALESCE(topic,'General') topic,COUNT(*) count FROM questions WHERE archived=0 GROUP BY paper,topic ORDER BY paper,MIN(id)"));
 }
 if(path.startsWith('/api/questions')){
  if(!teacher(u))return json({error:'Staff access required'},403);
  if(path==='/api/questions/all'&&method==='GET'){
   let rows=await read(db,'SELECT * FROM questions ORDER BY id DESC');rows=rows.filter(q=>allowed(u,q.paper,q.topic));return json(rows);
  }
  const edit=path.match(/^\/api\/questions\/(\d+)$/);
  if(method==='POST'&&(path==='/api/questions'||path==='/api/questions/bulk'||edit)){
   if(!permission(u))return json({error:'Question editing is disabled by your administrator'},403);
   if(edit){const old=await one(db,'SELECT * FROM questions WHERE id=?',Number(edit[1]));if(!old)return json({error:'Question not found'},404);if(!allowed(u,old.paper,old.topic))return json({error:'Different subject'},403);
    if(Object.keys(body).length===1&&typeof body.archived==='boolean'){await run(db,'UPDATE questions SET archived=? WHERE id=?',body.archived?1:0,old.id);return json({message:body.archived?'Question archived. Previous results are unchanged.':'Question restored.'})}
    const q={...old,...body};if(!validateQuestion(q)||!allowed(u,q.paper,q.topic))return json({error:'Complete all question fields and use your assigned subject'},400);
    await run(db,'UPDATE questions SET question=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_option=?,paper=?,topic=?,explanation=?,difficulty=? WHERE id=?',q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option.toUpperCase(),q.paper,q.topic,q.explanation||'',q.difficulty||'unrated',old.id);return json({message:'Question updated. Existing attempts retain their original question.'});
   }
   const raw=path.endsWith('/bulk')?body.questions:[body];if(!Array.isArray(raw)||!raw.length||raw.length>500)return json({error:'Import 1 to 500 questions at a time'},400);
   const qs=raw.map(q=>({...q,paper:q.paper||body.paper||u.assigned_paper||'Other',topic:q.topic||body.topic||u.subject_title||'General'}));
   if(!qs.every(validateQuestion))return json({error:'Each question needs four options, an A-D answer, paper and topic. Check difficulty and explanation fields.'},400);
   if(qs.some(q=>!allowed(u,q.paper,q.topic)))return json({error:'You can only upload to your assigned paper and subject'},403);
   for(let i=0;i<qs.length;i+=40)await db.batch(qs.slice(i,i+40).map(q=>db.prepare('INSERT INTO questions(question,option_a,option_b,option_c,option_d,correct_option,paper,topic,explanation,difficulty) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.correct_option.toUpperCase(),q.paper,q.topic,q.explanation||'',q.difficulty||'unrated')));
   return json({message:`${qs.length} question(s) added.`});
  }
  return json({error:'Not found'},404);
 }
 if(path==='/api/scores'&&method==='GET'){
  if(u.role!=='student')return json({error:'Student access required'},403);
  const rows=await read(db,"SELECT s.*,e.release_policy,e.results_released FROM scores s LEFT JOIN exams e ON e.id=s.exam_id WHERE s.student_id=? ORDER BY s.id DESC LIMIT 1000",u.id);
  return json(rows.map(s=>{const released=!s.exam_id||s.release_policy==='immediate'||s.results_released;return {id:s.id,topic:s.topic,attempted_at:s.attempted_at,mode:s.mode,attemptId:s.attempt_id,marks:released?s.score*2:null,totalMarks:s.total*2,score:released?s.score:null,total:s.total,hasReview:released&&!!s.review_json,resultsAvailable:!!released}}));
 }
 if(/^\/api\/scores\/\d+$/.test(path)&&method==='GET'){
  if(u.role!=='student')return json({error:'Student access required'},403);const s=await one(db,'SELECT s.*,e.release_policy,e.results_released FROM scores s LEFT JOIN exams e ON e.id=s.exam_id WHERE s.id=? AND s.student_id=?',Number(path.split('/').pop()),u.id);if(!s)return json({error:'Result not found'},404);if(s.exam_id&&s.release_policy!=='immediate'&&!s.results_released)return json({error:'Your teacher has not released this result'},403);return json({id:s.id,topic:s.topic,score:s.score,total:s.total,marks:s.score*2,totalMarks:s.total*2,review:s.review_json?JSON.parse(s.review_json):null});
 }
 if(path.startsWith('/api/teaching/')){
  if(!teacher(u))return json({error:'Staff access required'},403);
  if(path==='/api/teaching/students'&&method==='GET')return json(await read(db,"SELECT id,username,COALESCE(display_name,username) name,student_number,class_name FROM users WHERE role='student' AND is_active=1 ORDER BY username LIMIT 5000"));
  if(path==='/api/teaching/groups'&&method==='GET'){
   const groups=u.role==='admin'?await read(db,'SELECT * FROM class_groups ORDER BY id DESC'):await read(db,'SELECT * FROM class_groups WHERE owner_id=? ORDER BY id DESC',u.id);for(const g of groups)g.students=(await read(db,'SELECT student_id FROM group_members WHERE group_id=?',g.id)).map(r=>r.student_id);return json(groups);
  }
  if(path==='/api/teaching/groups'&&method==='POST'){
   if(!text(body.name,120)||!Array.isArray(body.students)||body.students.length>2000)return json({error:'Enter a class name and select up to 2000 students'},400);
   const students=[...new Set(body.students.map(Number))];if(students.some(id=>!Number.isSafeInteger(id)))return json({error:'Invalid student selection'},400);
   const all=await read(db,"SELECT id FROM users WHERE role='student' AND is_active=1");if(students.some(id=>!all.some(u=>u.id===id)))return json({error:'Select registered active students'},400);
   let id=Number(body.id)||null;if(id){const group=await one(db,'SELECT * FROM class_groups WHERE id=?',id);if(!owned(u,group))return json({error:'Class not found'},404);await run(db,'UPDATE class_groups SET name=? WHERE id=?',body.name.trim(),id);await run(db,'DELETE FROM group_members WHERE group_id=?',id)}else{const created=await run(db,'INSERT INTO class_groups(owner_id,name) VALUES (?,?)',u.id,body.name.trim());id=created.meta.last_row_id}
   for(let i=0;i<students.length;i+=40)await db.batch(students.slice(i,i+40).map(student=>db.prepare('INSERT OR IGNORE INTO group_members(group_id,student_id) VALUES (?,?)').bind(id,student)));return json({id,message:'Class group saved.'});
  }
  if(path==='/api/teaching/exams'&&method==='GET')return json(u.role==='admin'?await read(db,'SELECT e.*,g.name group_name FROM exams e LEFT JOIN class_groups g ON g.id=e.group_id ORDER BY e.starts_at DESC LIMIT 1000'):await read(db,'SELECT e.*,g.name group_name FROM exams e LEFT JOIN class_groups g ON g.id=e.group_id WHERE e.owner_id=? ORDER BY e.starts_at DESC LIMIT 1000',u.id));
  if(path==='/api/teaching/exams'&&method==='POST'){
   if(!text(body.title,160)||!text(body.paper)||!text(body.topic)||!allowed(u,body.paper,body.topic))return json({error:'Enter exam title and an allowed paper and topic'},400);
   const starts=Date.parse(body.startsAt),ends=Date.parse(body.endsAt),duration=Number(body.durationMinutes),count=Number(body.questionCount),difficulty=body.difficulty||'all';
   if(!Number.isFinite(starts)||!Number.isFinite(ends)||ends<=starts||!Number.isInteger(duration)||duration<1||duration>240||!Number.isInteger(count)||count<1||count>100||!['all','balanced','easy','medium','hard','unrated'].includes(difficulty)||!['immediate','manual'].includes(body.releasePolicy)||typeof body.instructions!=='string'||body.instructions.length>5000)return json({error:'Check exam window, 1-240 minute duration, 1-100 questions and result policy'},400);
   const groupId=body.groupId?Number(body.groupId):null;if(groupId&&!owned(u,await one(db,'SELECT * FROM class_groups WHERE id=?',groupId)))return json({error:'Select one of your class groups'},403);
   const pool=await read(db,'SELECT * FROM questions WHERE paper=? AND topic=? AND archived=0',body.paper,body.topic);if(chooseQuestions(pool,count,difficulty).length<count)return json({error:'Not enough active questions for the selected topic and difficulty'},400);
   const created=await run(db,'INSERT INTO exams(owner_id,title,paper,topic,group_id,starts_at,ends_at,duration_minutes,question_count,difficulty,release_policy,instructions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',u.id,body.title.trim(),body.paper,body.topic,groupId,new Date(starts).toISOString().slice(0,19).replace('T',' '),new Date(ends).toISOString().slice(0,19).replace('T',' '),duration,count,difficulty,body.releasePolicy,body.instructions);return json({id:created.meta.last_row_id,message:'Exam scheduled.'});
  }
  const action=path.match(/^\/api\/teaching\/exams\/(\d+)\/(release|cancel|attendance)$/);
  if(action){const exam=await one(db,'SELECT * FROM exams WHERE id=?',Number(action[1]));if(!owned(u,exam))return json({error:'Exam not found'},404);
   if(action[2]==='release'&&method==='POST'){await run(db,'UPDATE exams SET results_released=1 WHERE id=?',exam.id);return json({message:'Marks and answer reviews released to students.'})}
   if(action[2]==='cancel'&&method==='POST'){await run(db,'UPDATE exams SET cancelled=? WHERE id=?',body.cancelled===false?0:1,exam.id);return json({message:body.cancelled===false?'Exam restored.':'Exam cancelled.'})}
   if(action[2]==='attendance'&&method==='GET'){
    if(u.role==='staff'&&!u.can_report)return json({error:'Reports are disabled by your administrator'},403);await finalizeExam(db,exam.id);
    const students=exam.group_id?await read(db,"SELECT u.id,u.username,COALESCE(u.display_name,u.username) name FROM users u JOIN group_members g ON g.student_id=u.id WHERE g.group_id=? AND u.role='student'",exam.group_id):await read(db,"SELECT id,username,COALESCE(display_name,username) name FROM users WHERE role='student'");
    const attempts=await read(db,'SELECT a.*,s.score,s.total FROM learning_attempts a LEFT JOIN scores s ON s.attempt_id=a.id WHERE a.exam_id=?',exam.id);
    const roster=students.map(s=>{const a=attempts.find(a=>a.student_id===s.id);return {id:s.id,name:s.name,username:s.username,status:a?.status==='submitted'?'Submitted':a?'In progress':Date.now()>millis(exam.ends_at)?'Missed':'Not started',marks:a?.status==='submitted'?a.score*2:null,totalMarks:exam.question_count*2,percentage:a?.status==='submitted'?Math.round(a.score/a.total*10000)/100:null,submittedAt:a?.submitted_at||null}});
    const submitted=roster.filter(s=>s.status==='Submitted'),summary={enrolled:students.length,submitted:submitted.length,inProgress:roster.filter(s=>s.status==='In progress').length,missed:roster.filter(s=>s.status==='Missed').length,notStarted:roster.filter(s=>s.status==='Not started').length,averagePercentage:submitted.length?Math.round(submitted.reduce((n,s)=>n+s.percentage,0)/submitted.length*100)/100:null};
    const format=url.searchParams.get('format');if(!format||format==='json')return json({exam,roster,summary});
    const report={kind:'attendance',title:'Exam Attendance and Marks',subtitle:exam.title+' | '+topicLabel(exam.paper,exam.topic)+' | Times in UTC',generatedBy:u.display_name||u.username,summary:Object.entries(summary),headers:['Student','Username','Status','Marks','Maximum','Percentage','Submitted (UTC)'],rows:roster.map(s=>[s.name,s.username,s.status,s.marks??'Pending',s.totalMarks,s.percentage??'N/A',s.submittedAt||'Not submitted'])};return exportReport(report,format,'exam-'+exam.id+'-attendance');
   }
  }
  if(path==='/api/teaching/announcements'&&method==='GET')return json(u.role==='admin'?await read(db,'SELECT a.*,g.name group_name FROM announcements a LEFT JOIN class_groups g ON g.id=a.group_id ORDER BY a.id DESC LIMIT 200'):await read(db,'SELECT a.*,g.name group_name FROM announcements a LEFT JOIN class_groups g ON g.id=a.group_id WHERE a.owner_id=? ORDER BY a.id DESC LIMIT 200',u.id));
  if(path==='/api/teaching/announcements'&&method==='POST'){
   if(body.id&&typeof body.archived==='boolean'){const a=await one(db,'SELECT * FROM announcements WHERE id=?',Number(body.id));if(!owned(u,a))return json({error:'Announcement not found'},404);await run(db,'UPDATE announcements SET archived=? WHERE id=?',body.archived?1:0,a.id);return json({message:'Announcement updated.'})}
   if(!text(body.title,160)||!text(body.message,5000))return json({error:'Enter title and announcement text'},400);const groupId=body.groupId?Number(body.groupId):null;if(groupId&&!owned(u,await one(db,'SELECT * FROM class_groups WHERE id=?',groupId)))return json({error:'Select your class group'},403);
   await run(db,'INSERT INTO announcements(owner_id,group_id,title,message) VALUES (?,?,?,?)',u.id,groupId,body.title,body.message);return json({message:'Announcement posted.'});
  }
  if(path==='/api/teaching/import-template'&&method==='GET'){
   const report={kind:'template',title:'MCQ Import Template',subtitle:'Replace the sample with your questions. Use easy, medium, hard or unrated.',generatedBy:u.username,generatedAt:new Date().toISOString(),summary:[],headers:['question','option_a','option_b','option_c','option_d','correct_option','explanation','difficulty','paper','topic'],rows:[['What is 2 + 2?','3','4','5','6','B','Adding two and two gives four.','easy',u.assigned_paper||'Paper 1',u.subject_title||'Data Representation']]};const bytes=xlsx(report);return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="mcq-import-template.xlsx"','Cache-Control':'no-store'}});
  }
  return json({error:'Not found'},404);
 }
 if(u.role!=='student')return json({error:'Student access required'},403);
 if(path==='/api/learning/home'&&method==='GET'){
  const exams=await read(db,"SELECT e.*,g.name group_name,a.id attempt_id,a.status attempt_status FROM exams e LEFT JOIN class_groups g ON g.id=e.group_id LEFT JOIN learning_attempts a ON a.exam_id=e.id AND a.student_id=? WHERE e.cancelled=0 AND (e.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=e.group_id AND m.student_id=?)) ORDER BY e.starts_at DESC LIMIT 100",u.id,u.id);
  const announcements=await read(db,'SELECT a.*,g.name group_name FROM announcements a LEFT JOIN class_groups g ON g.id=a.group_id WHERE a.archived=0 AND (a.group_id IS NULL OR EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=a.group_id AND m.student_id=?)) ORDER BY a.id DESC LIMIT 100',u.id);
  const drafts=await read(db,"SELECT * FROM learning_attempts WHERE student_id=? AND status='active' ORDER BY started_at DESC",u.id);const active=[];for(let a of drafts){if(a.deadline&&Date.now()>=millis(a.deadline))await scoreAttempt(db,a);else active.push({id:a.id,title:topicLabel(a.paper,a.topic),mode:a.mode,deadline:iso(a.deadline)})}
  return json({exams:exams.map(e=>({...e,startsAt:iso(e.starts_at),endsAt:iso(e.ends_at)})),announcements,active,serverTime:new Date().toISOString()});
 }
 if(path==='/api/learning/progress'&&method==='GET'){
  const scores=await releasedScores(db,u.id),topics=await read(db,'SELECT paper,topic,COUNT(*) count FROM questions WHERE archived=0 GROUP BY paper,topic');
  return json(topics.map(t=>{const relevant=scores.filter(s=>s.topic===topicLabel(t.paper,t.topic)),seen=new Set(),correct=new Map();for(const s of relevant)for(const q of JSON.parse(s.review_json||'[]')){seen.add(q.question);if(!correct.has(q.question))correct.set(q.question,q.correct)}return {...t,attempts:relevant.length,average:relevant.length?Math.round(relevant.reduce((n,s)=>n+(s.total?s.score/s.total*100:0),0)/relevant.length):null,best:relevant.length?Math.round(Math.max(...relevant.map(s=>s.total?s.score/s.total*100:0))):null,covered:Math.min(seen.size,t.count),correctQuestions:[...correct.values()].filter(Boolean).length}}));
 }
 if(path==='/api/learning/attempts'&&method==='POST'){
  const exam=body.examId?await visibleExam(db,u,Number(body.examId)):null;if(body.examId&&!exam)return json({error:'You are not assigned to this exam'},403);
  if(exam){if(Date.now()<millis(exam.starts_at))return json({error:'The exam has not started yet'},403);const existing=await one(db,'SELECT * FROM learning_attempts WHERE exam_id=? AND student_id=?',exam.id,u.id);if(existing)return json(await attemptView(db,existing,u));if(Date.now()>=millis(exam.ends_at))return json({error:'The exam submission window has closed'},403)}
  const paper=exam?.paper||body.paper,topic=exam?.topic||body.topic;if(!text(paper)||!text(topic))return json({error:'Select a paper and topic'},400);
  if(!exam){const existing=await one(db,"SELECT * FROM learning_attempts WHERE student_id=? AND mode='practice' AND paper=? AND topic=? AND status='active' ORDER BY started_at DESC LIMIT 1",u.id,paper,topic);if(existing)return json(await attemptView(db,existing,u))}
  const difficulty=exam?.difficulty||body.difficulty||'all';if(!['all','balanced','easy','medium','hard','unrated'].includes(difficulty))return json({error:'Invalid difficulty'},400);
  const count=exam?.question_count||Math.min(50,Math.max(1,Number(body.questionCount)||50));let pool=body.retryWrong&&!exam?await wrongQuestions(db,u.id,paper,topic):await read(db,'SELECT * FROM questions WHERE paper=? AND topic=? AND archived=0',paper,topic);const questions=chooseQuestions(pool,count,difficulty);if(exam&&questions.length<exam.question_count)return json({error:'The active question bank has changed. Ask your teacher to restore enough questions.'},400);if(!questions.length)return json({error:body.retryWrong?'No previously incorrect active questions match this selection.':'No active questions match this selection.'},400);
  const id=crypto.randomUUID(),deadline=exam?new Date(Math.min(Date.now()+exam.duration_minutes*60000,millis(exam.ends_at))).toISOString().slice(0,19).replace('T',' '):null;
  try{await run(db,'INSERT INTO learning_attempts(id,student_id,exam_id,paper,topic,mode,started_at,deadline,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)',id,u.id,exam?.id||null,paper,topic,exam?'exam':'practice',utc(),deadline,JSON.stringify(questions))}catch(e){if(exam){const current=await one(db,'SELECT * FROM learning_attempts WHERE exam_id=? AND student_id=?',exam.id,u.id);if(current)return json(await attemptView(db,current,u))}throw e}
  return json(await attemptView(db,await one(db,'SELECT * FROM learning_attempts WHERE id=?',id),u));
 }
 const attemptPath=path.match(/^\/api\/learning\/attempts\/([a-zA-Z0-9-]+)(?:\/(save|submit|check))?$/);
 if(attemptPath){let a=await one(db,'SELECT * FROM learning_attempts WHERE id=? AND student_id=?',attemptPath[1],u.id);if(!a)return json({error:'Attempt not found'},404);
  if(a.deadline&&a.status==='active'&&Date.now()>=millis(a.deadline))a=await scoreAttempt(db,a);
  if(!attemptPath[2]&&method==='GET')return json(await attemptView(db,a,u));
  if(method==='POST'&&attemptPath[2]==='submit'){a=await scoreAttempt(db,a,body.answers);return json(await attemptView(db,a,u))}
  if(a.status!=='active')return json({error:'This attempt has ended. Reload its result.'},409);
  if(method==='POST'&&attemptPath[2]==='save'){if(!body.answers||typeof body.answers!=='object'||Array.isArray(body.answers))return json({error:'Invalid answers'},400);const answers=sanitize(body.answers,JSON.parse(a.snapshot_json));await run(db,"UPDATE learning_attempts SET answers_json=? WHERE id=? AND student_id=? AND status='active'",JSON.stringify(answers),a.id,u.id);return json({savedAt:new Date().toISOString()})}
  if(method==='POST'&&attemptPath[2]==='check'){if(a.mode!=='practice')return json({error:'Answers are only revealed in practice mode'},403);const q=JSON.parse(a.snapshot_json).find(q=>q.id===Number(body.questionId));if(!q||!['A','B','C','D'].includes(body.answer))return json({error:'Select an answer'},400);const answers={...JSON.parse(a.answers_json),[q.id]:body.answer};await run(db,'UPDATE learning_attempts SET answers_json=? WHERE id=?',JSON.stringify(answers),a.id);return json({correct:body.answer===q.correct_option,correctOption:q.correct_option,correctAnswer:q['option_'+q.correct_option.toLowerCase()],explanation:q.explanation||'A detailed explanation has not been added yet.'})}
 }
 return json({error:'Not found'},404);
}
