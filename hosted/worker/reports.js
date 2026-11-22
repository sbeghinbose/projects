import {PDFDocument,rgb} from 'pdf-lib';

import fontkit from '@pdf-lib/fontkit';

import fontBytes from '../fonts/NotoSans-Regular.ttf';

import {zipSync,strToU8} from 'fflate';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

const safe=value=>value===null||value===undefined||value===''?'Not recorded':value;

const round=n=>Math.round(n*100)/100;

function utcString(time){return new Date(time).toISOString().slice(0,19).replace('T',' ')}

export function dayRange(date,timeZone){

 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Choose a valid exam date');

 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

 const midnight=day=>{const desired=Date.parse(day+'T00:00:00Z');let value=desired;for(let i=0;i<4;i++){const p=Object.fromEntries(formatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);const delta=desired-represented;if(!delta)break;value+=delta}return utcString(value)};

 const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);return {start:midnight(date),end:midnight(next)};

}

function localTime(value,timeZone){if(!value)return 'Not recorded';return new Intl.DateTimeFormat('en-GB',{timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value.replace(' ','T')+'Z'))}

function analyze(rows,benchmark){

 const values=rows.map(r=>r.percentage),passed=values.filter(p=>p>=benchmark).length;

 const topics=[...new Set(rows.map(r=>r.subject))].map(subject=>{const group=rows.filter(r=>r.subject===subject);return {subject,attempts:group.length,averagePercentage:round(group.reduce((s,r)=>s+r.percentage,0)/group.length),passed:group.filter(r=>r.percentage>=benchmark).length}});

 return {attempts:rows.length,students:new Set(rows.map(r=>r.studentId)).size,averagePercentage:values.length?round(values.reduce((a,b)=>a+b,0)/values.length):null,highestPercentage:values.length?Math.max(...values):null,lowestPercentage:values.length?Math.min(...values):null,passed,belowBenchmark:rows.length-passed,passRate:rows.length?round(passed/rows.length*100):null,benchmark,topics};

}

export async function reportRequest(request,env,login){

 const url=new URL(request.url),kind=url.pathname.split('/').pop(),format=url.searchParams.get('format')||'json';

 if(request.method!=='GET')return json({error:'Method not allowed'},405);

 if(!['admin','staff'].includes(login.role))return json({error:'Staff or administrator access required'},403);

 if(!['json','pdf','docx','xlsx'].includes(format))return json({error:'Choose PDF, Word DOCX or Excel XLSX'},400);

 if(login.role==='staff'&&(!login.can_report||kind!=='exams'||!['json','pdf'].includes(format)))return json({error:'You do not have permission for this report'},403);

 let report;

 const timeZone=url.searchParams.get('timeZone')||'Asia/Kolkata';try{new Intl.DateTimeFormat('en',{timeZone}).format()}catch{return json({error:'Enter a valid timezone, such as Asia/Kolkata'},400)}

 if(kind==='registrations'){

  if(login.role!=='admin')return json({error:'Administrator access required'},403);

  const role=url.searchParams.get('role')||'all';if(!['all','student','staff'].includes(role))return json({error:'Invalid account type'},400);

  const where=role==='all'?"role IN ('student','staff')":'role=?';const statement=env.DB.prepare(`SELECT id,username,display_name,role,email,student_number,class_name,created_at,subject_title,assigned_paper,is_active,can_upload,can_report FROM users WHERE ${where} ORDER BY role,id LIMIT 5001`);

  const users=(await (role==='all'?statement:statement.bind(role)).all()).results;if(users.length>5000)return json({error:'Too many accounts. Filter by account type.'},413);

  const rows=users.map(u=>[u.id,u.display_name||u.username,u.username,u.role,safe(u.email),safe(u.student_number),safe(u.class_name),u.subject_title||'Not assigned',u.assigned_paper||'Not assigned',u.is_active?'Active':'Inactive',u.role==='staff'?(u.can_upload?'Allowed':'Disabled'):'N/A',u.role==='staff'?(u.can_report?'Allowed':'Disabled'):'N/A',localTime(u.created_at,timeZone)]);

  report={kind,title:'Student and Staff Registration Report',subtitle:`Account type: ${role} | Timezone: ${timeZone}`,generatedBy:login.display_name||login.username,summary:[['Accounts',users.length],['Students',users.filter(u=>u.role==='student').length],['Staff',users.filter(u=>u.role==='staff').length],['Registration dates','Earlier accounts show Not recorded when the original date is unavailable.']],headers:['Account ID','Name','Username','Role','Email','Student number','Class','Subject','Paper','Status','Upload access','Report access','Registered'],rows};

 }else if(kind==='exams'){

  const date=url.searchParams.get('date')||'',topic=url.searchParams.get('topic')||'';let range;try{range=dayRange(date,timeZone)}catch{return json({error:'Choose a valid date and timezone'},400)}

  const benchmark=Number(url.searchParams.get('benchmark')||50);if(!Number.isFinite(benchmark)||benchmark<0||benchmark>100)return json({error:'Benchmark must be between 0 and 100 percent'},400);

  let restricted=topic;if(login.role==='staff'&&login.subject_title){const assigned=`${login.assigned_paper} — ${login.subject_title}`;if(topic&&topic!==assigned)return json({error:'Reports are restricted to your assigned subject'},403);restricted=assigned}

  const args=[range.start,range.end];let filter='';if(restricted){filter=' AND s.topic=?';args.push(restricted)}

  const data=(await env.DB.prepare(`SELECT s.id,s.student_id,s.score,s.total,s.topic,s.attempted_at,u.username,u.display_name,u.student_number,u.class_name FROM scores s JOIN users u ON u.id=s.student_id WHERE COALESCE(s.mode,'exam')='exam' AND s.attempted_at>=? AND s.attempted_at<?${filter} ORDER BY s.attempted_at,s.id LIMIT 5001`).bind(...args).all()).results;

  if(data.length>5000)return json({error:'Too many attempts. Select a particular topic.'},413);

  const attempts=data.map(s=>({attemptId:s.id,studentId:s.student_id,name:s.display_name||s.username,username:s.username,studentNumber:s.student_number||'',className:s.class_name||'',subject:s.topic||'General',marks:s.score*2,totalMarks:s.total*2,percentage:s.total?round(s.score/s.total*100):0,time:localTime(s.attempted_at,timeZone)}));

  const analysis=analyze(attempts,benchmark);

  report={kind,date,timeZone,analysis,attempts,title:'Daily Student Marks and Exam Analysis',subtitle:`Exam day: ${date} | Timezone: ${timeZone} | ${restricted||'All permitted subjects'}`,generatedBy:login.display_name||login.username,summary:[['Attempts',analysis.attempts],['Unique students',analysis.students],['Average percentage',analysis.averagePercentage??'N/A'],['Highest percentage',analysis.highestPercentage??'N/A'],['Lowest percentage',analysis.lowestPercentage??'N/A'],['Pass benchmark (%)',benchmark],['At or above benchmark',analysis.passed],['Below benchmark',analysis.belowBenchmark],['Pass rate (%)',analysis.passRate??'N/A'],['Method','Exam attempts submitted on the selected local day are included; repeat attempts count separately. Practice is excluded.']],headers:['Attempt','Student name','Username','Student number','Class','Subject / Paper','Marks','Maximum marks','Percentage','Submission time','Benchmark outcome'],rows:attempts.map(a=>[a.attemptId,a.name,a.username,safe(a.studentNumber),safe(a.className),a.subject,a.marks,a.totalMarks,a.percentage,a.time,a.percentage>=benchmark?'At/above benchmark':'Below benchmark'])};

 }else return json({error:'Report not found'},404);

 report.generatedAt=new Date().toISOString();

 if(format==='json')return json(report);

 const bytes=format==='pdf'?await pdf(report):format==='docx'?docx(report):xlsx(report);

 const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};

 return new Response(bytes,{headers:{'Content-Type':types[format],'Content-Disposition':`attachment; filename="${kind}-${report.date||'accounts'}.${format}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

}

function tables(report){const all=[{name:'Summary',headers:['Measure','Value'],rows:[['Report',report.title],['Selection',report.subtitle],['Generated by',report.generatedBy],['Generated at (UTC)',report.generatedAt],...report.summary]},{name:report.kind==='logins'?'Login activity':report.kind==='exams'?'Student marks':report.kind==='attendance'?'Attendance':'Registrations',headers:report.headers,rows:report.rows}];if(report.analysis)all.push({name:'Topic analysis',headers:['Subject','Attempts','Average percentage','At/above benchmark'],rows:report.analysis.topics.map(t=>[t.subject,t.attempts,t.averagePercentage,t.passed])});return all}

function zip(files){return zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)])),{level:6})}

function column(index){let out='';for(index++;index>0;index=Math.floor((index-1)/26))out=String.fromCharCode(65+(index-1)%26)+out;return out}

export function xlsx(report){

 const sheets=tables(report);const files={'[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,'_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,'xl/_rels/workbook.xml.rels':`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`};

 sheets.forEach((sheet,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.headers.map((_,c)=>`<col min="${c+1}" max="${c+1}" width="${c===0?18:28}" customWidth="1"/>`).join('')}</cols><sheetData>${[sheet.headers,...sheet.rows].map((row,n)=>`<row r="${n+1}">${row.map((value,c)=>typeof value==='number'&&Number.isFinite(value)?`<c r="${column(c)}${n+1}"><v>${value}</v></c>`:`<c r="${column(c)}${n+1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`});return zip(files);

}

export function docx(report){

 const p=(text,bold=false)=>`<w:p><w:r><w:rPr>${bold?'<w:b/>':''}<w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;

 const table=t=>`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="CBD5E1"/>`).join('')}</w:tblBorders></w:tblPr>${[t.headers,...t.rows].map((row,i)=>`<w:tr>${i===0?'<w:trPr><w:tblHeader/></w:trPr>':''}${row.map(v=>`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(v,i===0)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

 return zip({'[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>','_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>','word/document.xml':`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p(report.title,true)}${p(report.subtitle)}${p('Generated by '+report.generatedBy+' | '+report.generatedAt)}${tables(report).map(t=>p(t.name,true)+table(t)+p('')).join('')}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`});

}

export async function pdf(report){

 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(fontBytes,{subset:true});doc.setTitle(report.title);doc.setAuthor('MCQ Portal');let page,y;

 const width=842,height=595,margin=32;const fresh=()=>{page=doc.addPage([width,height]);y=height-margin};fresh();

 function wrap(text,size,max){const lines=[''];for(const word of String(text??'').replace(/[\r\n\t]/g,' ').split(/\s+/)){let last=lines.length-1;const combined=lines[last]?lines[last]+' '+word:word;if(font.widthOfTextAtSize(combined,size)<=max){lines[last]=combined;continue}if(lines[last])lines.push('');for(const char of word){last=lines.length-1;if(font.widthOfTextAtSize(lines[last]+char,size)>max&&lines[last])lines.push(char);else lines[last]+=char}}return lines}

 function line(text,size=10){for(const value of wrap(text,size,width-2*margin)){if(y<margin+20)fresh();page.drawText(value,{x:margin,y,size,font,color:rgb(.08,.14,.23)});y-=size+6}}

 line(report.title,18);line(report.subtitle,10);line('Generated by '+report.generatedBy+' | '+report.generatedAt,9);y-=8;

 for(const source of tables(report)){

  const t=source.name==='Student marks'?{name:source.name,headers:['Attempt','Student / username','Student no.','Class','Subject','Marks','Percent','Time','Outcome'],rows:source.rows.map(r=>[r[0],r[1]+' / '+r[2],r[3],r[4],r[5],r[6]+' / '+r[7],r[8]+'%',String(r[9]).replace(/^.*?,\s*/,''),r[10]])}:source;

  if(y<margin+80)fresh();line(t.name,13);

  // Registration details use record blocks so names and contact fields stay readable.

  if(t.name==='Registrations'){

   if(!t.rows.length)line('No matching registrations.');

   for(const row of t.rows){if(y<margin+80)fresh();line(`${row[0]}. ${row[1]} (${row[2]})`,11);t.headers.forEach((h,i)=>{if(i>2)line(`${h}: ${row[i]}`,10)});y-=10}continue;

  }

  const size=t.headers.length>6?8.5:10,colWidth=(width-margin*2)/t.headers.length;

  const drawRow=(row,header=false)=>{const cells=row.map(v=>wrap(v,size,colWidth-10)),rowHeight=Math.max(...cells.map(c=>c.length))*(size+4)+12;if(y-rowHeight<margin+18){fresh();if(!header)drawRow(t.headers,true)}if(header)page.drawRectangle({x:margin,y:y-rowHeight,width:width-margin*2,height:rowHeight,color:rgb(.90,.94,.99)});cells.forEach((lines,c)=>lines.forEach((text,n)=>page.drawText(text,{x:margin+c*colWidth+5,y:y-12-n*(size+4),size,font,color:rgb(.08,.14,.23)})));y-=rowHeight;page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.4,color:rgb(.8,.84,.9)})};

  drawRow(t.headers,true);if(!t.rows.length)line('No matching records.');for(const row of t.rows)drawRow(row);y-=20;

 }

 const pages=doc.getPages();pages.forEach((p,i)=>p.drawText(`Page ${i+1} of ${pages.length}`,{x:margin,y:15,size:8,font}));return doc.save();

}


export async function exportReport(report,format,filename){
 if(!['pdf','docx','xlsx'].includes(format))return json({error:'Invalid export format'},400);
 report.generatedAt=new Date().toISOString();const bytes=format==='pdf'?await pdf(report):format==='docx'?docx(report):xlsx(report);
 const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 return new Response(bytes,{headers:{'Content-Type':types[format],'Content-Disposition':`attachment; filename="${filename}.${format}"`,'Cache-Control':'no-store'}});
}
