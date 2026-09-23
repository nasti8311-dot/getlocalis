export async function hashProviderPassword(password,salt){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),{name:"PBKDF2"},false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(String(salt||"")),iterations:100000,hash:"SHA-256"},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function hashProviderSession(token){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(token||"")));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
export function providerRandomHex(bytes=32){
  const value=new Uint8Array(bytes); crypto.getRandomValues(value);
  return Array.from(value,b=>b.toString(16).padStart(2,"0")).join("");
}
export async function ensureProviderAuthTables(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS provider_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT,provider_ref TEXT NOT NULL UNIQUE,email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_provider_accounts_provider_ref ON provider_accounts(provider_ref)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_provider_accounts_email ON provider_accounts(email)").run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS provider_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,provider_ref TEXT NOT NULL,session_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_provider_sessions_provider_ref ON provider_sessions(provider_ref)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_provider_sessions_expires_at ON provider_sessions(expires_at)").run();
}
export function providerSessionCookie(value,maxAge=2592000){
  return "fiiviu_provider_session="+encodeURIComponent(String(value||""))+"; Path=/; Domain=fiiviu.ro; Max-Age="+maxAge+"; HttpOnly; Secure; SameSite=Lax";
}
export function providerSessionFromRequest(request){
  const cookie=String(request.headers.get("Cookie")||"");
  const match=cookie.match(/(?:^|;\s*)fiiviu_provider_session=([^;]+)/);
  return match?decodeURIComponent(match[1]):"";
}
export async function createProviderSession(env,providerRef){
  await ensureProviderAuthTables(env);
  const raw=providerRandomHex(32), hash=await hashProviderSession(raw), expires=Math.floor(Date.now()/1000)+2592000;
  await env.DB.prepare("DELETE FROM provider_sessions WHERE provider_ref=? OR expires_at<?").bind(providerRef,Math.floor(Date.now()/1000)).run();
  await env.DB.prepare("INSERT INTO provider_sessions (provider_ref,session_hash,expires_at) VALUES (?,?,?)").bind(providerRef,hash,expires).run();
  return {raw,expires};
}
export async function authenticateProviderSession(request,env){
  if(!env.DB)return null;
  const raw=providerSessionFromRequest(request); if(!raw)return null;
  await ensureProviderAuthTables(env);
  const row=await env.DB.prepare("SELECT s.provider_ref,p.active FROM provider_sessions s JOIN providers p ON p.provider_ref=s.provider_ref WHERE s.session_hash=? AND s.expires_at>? LIMIT 1").bind(await hashProviderSession(raw),Math.floor(Date.now()/1000)).first();
  if(!row||Number(row.active)!==1)return null;
  return String(row.provider_ref||"");
}
