// https://www.rfc-editor.org/rfc/rfc6238
// RFC 6238 TOTP: SHA-1, 30-second steps, six digits. Test vectors exercise the eight-digit form.
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out}
function decode(s){let bits=0,value=0,out=[];for(const c of s){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}}return new Uint8Array(out)}
export async function totp(secret,time=Date.now(),digits=6){const counter=BigInt(Math.floor(time/30000)),data=new Uint8Array(8);new DataView(data.buffer).setBigUint64(0,counter);const key=await crypto.subtle.importKey('raw',decode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,data)),offset=mac[19]&15;const number=((mac[offset]&127)<<24)|(mac[offset+1]<<16)|(mac[offset+2]<<8)|mac[offset+3];return String(number%10**digits).padStart(digits,'0')}
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const hex=b=>Array.from(b,n=>n.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
async function wrappingKey(env){if(!env.ADMIN_PASSWORD_HASH)throw Error('MFA encryption key unavailable');const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('beghin-mfa-v1:'+env.ADMIN_PASSWORD_HASH));return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}
async function seal(secret,env){const iv=crypto.getRandomValues(new Uint8Array(12));return hex(iv)+':'+hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await wrappingKey(env),new TextEncoder().encode(secret))))}
async function open(value,env){const [iv,data]=value.split(':');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv)},await wrappingKey(env),unhex(data)))}
async function counterFor(secret,code){if(typeof code!=='string'||!/^\d{6}$/.test(code))return -1;const now=Math.floor(Date.now()/30000);for(const delta of [0,-1,1])if(await totp(secret,(now+delta)*30000)===code)return now+delta;return -1}
export async function verifyMfa(env,userId,code){
 const db=env.DB,row=await db.prepare('SELECT * FROM user_mfa WHERE user_id=?').bind(userId).first();if(!row?.enabled)return true;if(row.blocked_until>Date.now())return false;
 let okay=false;
 if(typeof code==='string'&&/^\d{6}$/.test(code)){
  const counter=await counterFor(await open(row.secret,env),code);if(counter>row.last_counter){const saved=await db.prepare('UPDATE user_mfa SET last_counter=?,failures=0,blocked_until=0 WHERE user_id=? AND last_counter<? AND enabled=1').bind(counter,userId,counter).run();okay=saved.meta.changes===1}
 }else if(typeof code==='string'&&/^[a-fA-F0-9-]{24,30}$/.test(code)){
  const codes=JSON.parse(row.recovery_hashes),hash=await sha(code.replace(/-/g,'').toLowerCase());if(codes.includes(hash)){const saved=await db.prepare('UPDATE user_mfa SET recovery_hashes=?,failures=0,blocked_until=0 WHERE user_id=? AND recovery_hashes=? AND enabled=1').bind(JSON.stringify(codes.filter(c=>c!==hash)),userId,row.recovery_hashes).run();okay=saved.meta.changes===1}
 }
 if(!okay&&code)await db.prepare('UPDATE user_mfa SET failures=failures+1,blocked_until=CASE WHEN failures>=4 THEN ? ELSE blocked_until END WHERE user_id=?').bind(Date.now()+300000,userId).run();
 return okay;
}
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function mfaRequest(request,env,u,b,verify){
 const p=new URL(request.url).pathname;if(!p.startsWith('/api/mfa/'))return null;if(!u||u.role!=='admin')return json({error:'Administrator access required'},403);
 const db=env.DB,row=await db.prepare('SELECT * FROM user_mfa WHERE user_id=?').bind(u.id).first();
 if(p==='/api/mfa/status'&&request.method==='GET')return json({enabled:!!row?.enabled,recoveryCodesRemaining:row?.enabled?JSON.parse(row.recovery_hashes).length:0});
 if(request.method!=='POST')return json({error:'Not found'},404);
 const account=await db.prepare('SELECT password FROM users WHERE id=?').bind(u.id).first();if(typeof b.currentPassword!=='string'||!await verify(b.currentPassword,account.password))return json({error:'Enter your current administrator password.'},403);
 if(p==='/api/mfa/begin'){
  if(row?.enabled)return json({error:'Two-factor authentication is already enabled.'},409);
  const secret=base32(crypto.getRandomValues(new Uint8Array(20))),encrypted=await seal(secret,env);await db.prepare('INSERT INTO user_mfa(user_id,pending_secret,pending_expires) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_expires=excluded.pending_expires').bind(u.id,encrypted,Date.now()+600000).run();return json({secret,account:'Beghin MCQ: '+u.username,issuer:'Beghin MCQ',algorithm:'SHA1',digits:6,period:30,message:'Enter this setup key manually in your authenticator app, then confirm a six-digit code within ten minutes.'});
 }
 if(p==='/api/mfa/enable'){
  if(row?.enabled||!row?.pending_secret||row.pending_expires<Date.now())return json({error:'Start a fresh authenticator setup.'},400);
  if(row.blocked_until>Date.now())return json({error:'Too many failed codes. Wait five minutes.'},429);
  const secret=await open(row.pending_secret,env),counter=await counterFor(secret,b.code);if(counter<0){await db.prepare('UPDATE user_mfa SET failures=failures+1,blocked_until=CASE WHEN failures>=4 THEN ? ELSE blocked_until END WHERE user_id=?').bind(Date.now()+300000,u.id).run();return json({error:'The authenticator code is invalid or expired.'},400)}
  const codes=Array.from({length:8},()=>hex(crypto.getRandomValues(new Uint8Array(12)))),hashes=await Promise.all(codes.map(sha));
  await db.batch([db.prepare("UPDATE user_mfa SET enabled=1,secret=pending_secret,pending_secret=NULL,pending_expires=NULL,last_counter=?,recovery_hashes=?,failures=0,blocked_until=0 WHERE user_id=?").bind(counter,JSON.stringify(hashes),u.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]);return json({recoveryCodes:codes,message:'Two-factor authentication enabled. Save these one-use recovery codes privately. All sessions are signed out. Wait for the next authenticator code, then sign in again.'});
 }
 if(p==='/api/mfa/disable'){
  if(!row?.enabled)return json({error:'Two-factor authentication is not enabled.'},400);if(!await verifyMfa(env,u.id,b.code))return json({error:'Enter a fresh authenticator code or an unused recovery code. After repeated failures, wait five minutes.'},403);
  await db.batch([db.prepare('DELETE FROM user_mfa WHERE user_id=?').bind(u.id),db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id)]);return json({message:'Two-factor authentication disabled. All sessions are signed out. Please sign in again.'});
 }
 return json({error:'Not found'},404);
}
