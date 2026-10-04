// Local isolated-stack smoke check only. Supply synthetic reviewer credentials.
import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:10000';
const html = await fetch(base);
assert.equal(html.status, 200);
assert.match(await html.text(), /<div id="root"/);
const ready = await fetch(`${base}/api/health/ready`);
assert.equal(ready.status, 200);
assert.equal((await ready.json()).database, 'ok');
const login = await fetch(`${base}/api/auth/login`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:process.env.STAGING_REVIEWER_EMAIL,password:process.env.STAGING_REVIEWER_PASSWORD})});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie');
assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Strict/i);
for (const path of ['/auth/me','/platform/summary','/users','/roles','/settings','/clients','/establishments','/projects','/buildings','/floors','/floor-plans']) {
 const res = await fetch(`${base}/api${path}`, {headers:{cookie:cookie.split(';')[0]}});
 assert.equal(res.status,200,path);
}
const sharp = (await import('sharp')).default;
assert.ok((await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer()).length);
console.log('PASS: web, /api, PostGIS readiness, login, secure session cookie, authenticated navigation and Sharp without MinIO');
