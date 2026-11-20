(()=>{

const el=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url,body){const res=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await res.json();if(!res.ok)throw Error(value.error||'Request failed');return value}

function status(id,text,error=false){el(id).textContent=text;el(id).style.color=error?'#b91c1c':'#166534'}

function table(headers,rows){return '<table><thead><tr>'+headers.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}

async function download(url,format,statusId){status(statusId,'Preparing '+format.toUpperCase()+' report…');try{const response=await fetch(url);if(!response.ok)throw Error((await response.json()).error||'Export failed');const blob=await response.blob(),link=document.createElement('a'),objectUrl=URL.createObjectURL(blob);link.href=objectUrl;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'report.'+format;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);status(statusId,'Report downloaded.')}catch(e){status(statusId,e.message,true)}}

function examUrl(format='json'){const date=el('examDate').value;if(!date)throw Error('Select an exam date');return '/api/reports/exams?'+new URLSearchParams({date,timeZone:el('examTimezone').value,topic:el('examSubject').value,benchmark:el('examBenchmark').value,format})}

window.refreshReportAccounts=async()=>{if(!el('resetAccount'))return;const users=await api('/api/admin/users');el('resetAccount').innerHTML='<option value="">Choose an account</option>'+users.map(u=>`<option value="${u.id}">${esc(u.display_name||u.username)} — ${esc(u.username)} (${esc(u.role)})</option>`).join('')};

async function setup(){const user=await api('/api/me');const isAdmin=user.role==='admin';document.querySelectorAll('[data-admin-only]').forEach(node=>node.hidden=!isAdmin);

 if(el('examReportForm')){

  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));el('examDate').value=parts.year+'-'+parts.month+'-'+parts.day;

  if(!isAdmin&&!user.canReport){el('examReportForm').hidden=true;status('examStatus','Your administrator has disabled student marks reports.',true)}else{

   const topics=await api('/api/topics');el('examSubject').innerHTML='<option value="">All permitted subjects</option>'+topics.map(t=>`<option value="${esc(t.paper+' — '+t.topic)}">${esc(t.paper+' — '+t.topic)}</option>`).join('');

   el('examReportForm').onsubmit=async event=>{event.preventDefault();status('examStatus','Loading exam results…');try{const report=await api(examUrl());const a=report.analysis;el('examAnalysis').innerHTML='<div class="analysis-grid">'+[['Attempts',a.attempts],['Students',a.students],['Average',a.averagePercentage===null?'N/A':a.averagePercentage+'%'],['Highest',a.highestPercentage===null?'N/A':a.highestPercentage+'%'],['Lowest',a.lowestPercentage===null?'N/A':a.lowestPercentage+'%'],['At/above '+a.benchmark+'%',a.passed],['Pass rate',a.passRate===null?'N/A':a.passRate+'%']].map(([k,v])=>'<p>'+esc(k)+'<br><strong>'+esc(v)+'</strong></p>').join('')+'</div>';el('examPreview').innerHTML=report.rows.length?table(report.headers,report.rows):'<p>No student exam submissions on this date for the selected subject.</p>';status('examStatus',report.subtitle)}catch(e){el('examAnalysis').textContent='';el('examPreview').textContent='';status('examStatus',e.message,true)}};

   document.querySelectorAll('[data-exam-format]').forEach(button=>button.onclick=()=>{try{if(!el('examReportForm').reportValidity())return;download(examUrl(button.dataset.examFormat),button.dataset.examFormat,'examStatus')}catch(e){status('examStatus',e.message,true)}})

  }

 }

 if(!isAdmin)return;

 await window.refreshReportAccounts();

 el('resetPassword').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{if(form.elements.password.value!==form.elements.confirmPassword.value)throw Error('The two new passwords do not match');const result=await api('/api/admin/users/'+el('resetAccount').value+'/password',{password:form.elements.password.value});form.reset();status('resetStatus',result.message)}catch(e){status('resetStatus',e.message,true)}};

 el('changeAdminPassword').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{if(form.elements.password.value!==form.elements.confirmPassword.value)throw Error('The two new passwords do not match');await api('/api/account/password',{currentPassword:form.elements.currentPassword.value,password:form.elements.password.value});location.href='/?role=admin'}catch(e){status('ownPasswordStatus',e.message,true)}};

 const registrationUrl=format=>'/api/reports/registrations?'+new URLSearchParams({role:el('registrationRole').value,timeZone:'Asia/Kolkata',format});

 el('previewRegistrations').onclick=async()=>{try{const report=await api(registrationUrl('json'));el('registrationPreview').innerHTML=report.rows.length?table(report.headers,report.rows):'<p>No matching registrations.</p>';status('registrationStatus',report.rows.length+' accounts. Earlier registration dates may be unavailable.')}catch(e){status('registrationStatus',e.message,true)}};

 document.querySelectorAll('[data-registration-format]').forEach(button=>button.onclick=()=>download(registrationUrl(button.dataset.registrationFormat),button.dataset.registrationFormat,'registrationStatus'));

}

setup().catch(e=>{const node=el('examStatus');if(node)node.textContent=e.message});

})();