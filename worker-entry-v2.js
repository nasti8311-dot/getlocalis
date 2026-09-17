import baseWorker from "./worker-entry.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/provider/experiences") return handleProviderExperiences(request, env);
    if (url.pathname === "/api/provider/bookings") return handleProviderBookings(request, env);
    if (url.pathname === "/api/booking" && request.method === "GET") return handleBookingLookup(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== "GET" || url.pathname.startsWith("/api/")) return response;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;
    const html = await response.text();
    const bridge = `<script src="/meeting-points.js"></script><script>(function(){var labels={de:{meeting:'Treffpunkt',instructions:'Hinweis',arrival:'Bitte vor Beginn da sein',maps:'Auf Google Maps öffnen'},en:{meeting:'Meeting point',instructions:'Instructions',arrival:'Please arrive before the start',maps:'Open in Google Maps'},ro:{meeting:'Punct de întâlnire',instructions:'Instrucțiuni',arrival:'Te rugăm să ajungi înainte de începere',maps:'Deschide în Google Maps'}};function lang(){return(typeof currentLang!=='undefined'&&currentLang)?String(currentLang).slice(0,2):'en'}function getMeeting(){var m=window.__fiiviuMeetingPoint||{};try{if(!m.name&&typeof categoriesData!=='undefined'&&typeof currentCategoryKey!=='undefined'&&typeof currentTourKey!=='undefined'){var c=categoriesData[currentCategoryKey],i=c&&c.items?c.items.find(function(x){return x.id===currentTourKey}):null;if(i&&i.meetingPoint)m=i.meetingPoint}}catch(_){}return m||{}}function mapsUrl(m){if(m.latitude&&m.longitude)return'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(m.latitude+','+m.longitude);var q=[m.name,m.address,m.city,m.country].filter(Boolean).join(', ');return q?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q):''}function esc(v){return String(v==null?'':v).replace(/[&<>\\"']/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#039;'}[ch]})}function render(){var m=getMeeting();window.__fiiviuMeetingPoint=m;var has=!!(m.name||m.address||m.city||m.country||m.instructions),old=document.getElementById('fiiviu-meeting-point-card');if(!has){if(old)old.classList.add('hidden');return}var l=labels[lang()]||labels.en,address=[m.address,m.city,m.country].filter(Boolean).join(', '),map=mapsUrl(m),card=old;if(!card){card=document.createElement('div');card.id='fiiviu-meeting-point-card';card.className='bg-white rounded-2xl border border-black/5 p-5 mt-6 shadow-sm';var anchor=document.getElementById('checkout-summary-date');if(anchor&&anchor.parentElement&&anchor.parentElement.parentElement)anchor.parentElement.parentElement.appendChild(card);else document.body.appendChild(card)}card.classList.remove('hidden');card.innerHTML='<div class="text-xs font-black uppercase tracking-widest text-fii-orange">'+l.meeting+'</div><div class="font-black mt-1">'+esc(m.name||address||'')+'</div>'+(address?'<div class="text-sm text-gray-600 mt-1">'+esc(address)+'</div>':'')+(m.instructions?'<div class="text-sm text-gray-500 mt-2">'+esc(l.instructions)+': '+esc(m.instructions)+'</div>':'')+(m.arrivalMinutesBefore!=null&&m.arrivalMinutesBefore!==''?'<div class="text-sm text-gray-500 mt-2">'+esc(l.arrival)+' '+esc(String(m.arrivalMinutesBefore))+' min.</div>':'')+(map?'<a href="'+map+'" target="_blank" rel="noopener" class="inline-flex mt-3 text-sm font-bold text-fii-orange">'+l.maps+'</a>':'')}window.__fiiviuRefreshMeetingPoint=render;setInterval(render,500);document.addEventListener('DOMContentLoaded',render)})();</script>`;
    const marker="</body>"; const output=html.includes(marker)?html.replace(marker,bridge+marker):html+bridge;
    const headers=new Headers(response.headers); headers.delete("content-length"); headers.set("cache-control","no-cache");
    return new Response(output,{status:response.status,statusText:response.statusText,headers});
  }
};

const providerCors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
function providerJson(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...providerCors,"Content-Type":"application/json"}})}
function providerAuth(request,env){const expected=String(env.PROVIDER_ADMIN_KEY||env.ADMIN_PAYOUT_KEY||"").trim();return !!expected&&request.headers.get("Authorization")==="Bearer "+expected}
async function handleProviderBookings(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:providerCors});
  if(!providerAuth(request,env))return providerJson({error:"Unauthorized"},401);
  if(request.method!=="GET")return providerJson({error:"Method Not Allowed"},405);
  if(!env.DB)return providerJson({error:"D1 database not configured"},500);
  const account=String(new URL(request.url).searchParams.get("providerConnectAccountId")||"").trim();
  if(!account)return providerJson({error:"Missing providerConnectAccountId"},400);
  try{
    await ensureBookingLookupTable(env);
    const result=await env.DB.prepare(`SELECT booking_id,status,payment_status,customer_name,customer_email,experience_name,booking_date,booking_time,guests,amount_cents,currency,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,arrival_minutes_before,meeting_latitude,meeting_longitude FROM bookings WHERE provider_connect_account_id=? AND payment_status='paid' AND status NOT IN ('cancelled','refunded') ORDER BY CASE WHEN booking_date IS NULL THEN 1 ELSE 0 END, booking_date ASC, booking_time ASC, id DESC`).bind(account).all();
    return providerJson({bookings:result.results||[]});
  }catch(error){return providerJson({error:error?.message||"Server error"},500)}
}
async function handleBookingLookup(request,env){
  if(!env.DB)return providerJson({error:"D1 database not configured"},500);
  const bookingId=String(new URL(request.url).searchParams.get("id")||"").trim();
  if(!bookingId)return providerJson({error:"Missing booking id"},400);
  try{
    await ensureBookingLookupTable(env);
    const booking=await env.DB.prepare(`SELECT booking_id,status,payment_status,customer_name,customer_language,experience_name,booking_date,booking_time,guests,amount_cents,currency,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,arrival_minutes_before,meeting_latitude,meeting_longitude FROM bookings WHERE booking_id=? LIMIT 1`).bind(bookingId).first();
    if(!booking)return providerJson({error:"Booking not found"},404);
    if(booking.payment_status!=="paid" || ["cancelled","refunded"].includes(booking.status))return providerJson({error:"Booking is not active"},404);
    return providerJson({booking});
  }catch(error){return providerJson({error:error?.message||"Server error"},500)}
}
async function ensureBookingLookupTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT,booking_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT UNIQUE,status TEXT NOT NULL DEFAULT 'pending',payment_status TEXT NOT NULL DEFAULT 'pending',customer_name TEXT NOT NULL,customer_email TEXT NOT NULL,customer_phone TEXT,customer_language TEXT NOT NULL DEFAULT 'en',experience_name TEXT NOT NULL,booking_date TEXT,booking_time TEXT,guests INTEGER NOT NULL DEFAULT 1,amount_cents INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'eur',meeting_point_name TEXT,meeting_address TEXT,meeting_city TEXT,meeting_country TEXT,meeting_instructions TEXT,arrival_minutes_before INTEGER,meeting_latitude TEXT,meeting_longitude TEXT,partner_ref TEXT,provider_connect_account_id TEXT,confirmation_email_sent_at TEXT,confirmation_email_error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
}
async function handleProviderExperiences(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:providerCors});
  if(!providerAuth(request,env))return providerJson({error:"Unauthorized"},401);
  if(!env.DB)return providerJson({error:"D1 database not configured"},500);
  try{
    await ensureExperiencesTable(env);
    if(request.method==="GET"){const rows=await env.DB.prepare("SELECT * FROM experiences ORDER BY updated_at DESC,id DESC").all();return providerJson({experiences:rows.results||[]})}
    if(request.method!=="POST")return providerJson({error:"Method Not Allowed"},405);
    const body=await request.json();
    const experienceId=String(body.experienceId||"").trim().toLowerCase(), title=String(body.title||"").trim();
    const providerConnectAccountId=String(body.providerConnectAccountId||"").trim();
    const meetingPointName=String(body.meetingPointName||"").trim(), meetingAddress=String(body.meetingAddress||"").trim(), meetingCity=String(body.meetingCity||"").trim(), meetingCountry=String(body.meetingCountry||"").trim(), meetingInstructions=String(body.meetingInstructions||"").trim();
    const arrival=Number(body.arrivalMinutesBefore), arrivalMinutesBefore=Number.isInteger(arrival)&&arrival>=0?arrival:null;
    const lat=String(body.meetingLatitude||"").trim(), lon=String(body.meetingLongitude||"").trim(), publish=body.publish===true;
    if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(experienceId))return providerJson({error:"Ungültige Experience-ID."},400);
    if(!title)return providerJson({error:"Titel fehlt."},400);
    if(publish){if(!providerConnectAccountId)return providerJson({error:"Veröffentlichung blockiert: Stripe Connect Account fehlt."},400);if(!meetingPointName||!meetingAddress||!meetingCity||!meetingCountry)return providerJson({error:"Veröffentlichung blockiert: Treffpunkt, Adresse, Stadt und Land sind erforderlich."},400)}
    const status=publish?"published":"draft";
    await env.DB.prepare(`INSERT INTO experiences (experience_id,provider_connect_account_id,title,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,arrival_minutes_before,meeting_latitude,meeting_longitude,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(experience_id) DO UPDATE SET provider_connect_account_id=excluded.provider_connect_account_id,title=excluded.title,meeting_point_name=excluded.meeting_point_name,meeting_address=excluded.meeting_address,meeting_city=excluded.meeting_city,meeting_country=excluded.meeting_country,meeting_instructions=excluded.meeting_instructions,arrival_minutes_before=excluded.arrival_minutes_before,meeting_latitude=excluded.meeting_latitude,meeting_longitude=excluded.meeting_longitude,status=excluded.status,updated_at=CURRENT_TIMESTAMP`).bind(experienceId,providerConnectAccountId||null,title,meetingPointName||null,meetingAddress||null,meetingCity||null,meetingCountry||null,meetingInstructions||null,arrivalMinutesBefore,lat||null,lon||null,status).run();
    const experience=await env.DB.prepare("SELECT * FROM experiences WHERE experience_id=? LIMIT 1").bind(experienceId).first();
    return providerJson({success:true,experience});
  }catch(error){return providerJson({error:error?.message||"Server error"},500)}
}
async function ensureExperiencesTable(env){await env.DB.prepare(`CREATE TABLE IF NOT EXISTS experiences (id INTEGER PRIMARY KEY AUTOINCREMENT,experience_id TEXT NOT NULL UNIQUE,provider_connect_account_id TEXT,title TEXT NOT NULL,meeting_point_name TEXT,meeting_address TEXT,meeting_city TEXT,meeting_country TEXT,meeting_instructions TEXT,arrival_minutes_before INTEGER,meeting_latitude TEXT,meeting_longitude TEXT,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_experiences_provider ON experiences(provider_connect_account_id)").run();await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_experiences_status ON experiences(status)").run()}
