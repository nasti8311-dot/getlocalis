import baseWorker from "./worker-entry.js";
import partnerWorker from "./worker.js";
import { authenticateProviderSession } from "./provider-auth.js";

const CORS={"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Cache-Control":"no-store","Vary":"Origin"};

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});if(url.pathname==="/api/partner-stats"||url.pathname==="/api/partner-visit"||url.pathname==="/api/partner-login"||url.pathname==="/api/partner-logout"||url.pathname.startsWith("/api/admin/partner-"))return partnerWorker.fetch(request,env,ctx);if(request.method==="GET"&&url.pathname==="/api/offers")return handlePublicOffers(request,env);
if(request.method==="POST"&&url.pathname==="/api/create-payment-intent")return createMarketplacePaymentIntent(request,env,ctx);if(request.method==="POST"&&url.pathname==="/api/stripe/webhook")return handleMarketplaceWebhook(request,env,ctx);if(request.method==="GET"&&url.pathname==="/"&&url.searchParams.get("ref"))ctx.waitUntil(recordPartnerScan(env,url.searchParams.get("ref")));const response=await baseWorker.fetch(request,env,ctx);if(request.method==="GET"&&isHtml(response,url))return injectMarketplaceCheckoutBridge(response,url);return response;}};

async function handleProviderRoute(request,env,ctx){
  const url=new URL(request.url);
  const account=await resolveProviderAccount(request,env);
  if(!account)return json({error:"Unauthorized provider credentials"},401);
  if(url.pathname!=="/api/provider/experiences")return json({error:"Method Not Allowed"},405);
  if(!env.DB)return json({error:"D1 database not configured"},500);
  try{
    await ensureExperiencesTable(env);
    if(request.method==="GET"){
      const rows=await env.DB.prepare("SELECT * FROM experiences WHERE provider_connect_account_id=? ORDER BY updated_at DESC,id DESC").bind(account).all();
      const provider=await env.DB.prepare("SELECT id,name,type,provider_ref,contact_name,contact_email,connect_account_id,active FROM providers WHERE connect_account_id=? AND active=1 ORDER BY id ASC LIMIT 1").bind(account).first();
      return json({experiences:rows.results||[],provider:provider||null,provider_connect_account_id:account});
    }
    if(request.method!=="POST")return json({error:"Method Not Allowed"},405);
    const body=await request.json();
    const experienceId=String(body.experienceId||"").trim().toLowerCase();
    const title=String(body.title||"").trim();
    const priceCents=Number(body.priceCents);
    const currency=String(body.currency||"eur").trim().toLowerCase();
    const meetingPointName=String(body.meetingPointName||"").trim();
    const meetingAddress=String(body.meetingAddress||"").trim();
    const meetingCity=String(body.meetingCity||"").trim();
    const meetingCountry=String(body.meetingCountry||"").trim();
    const meetingInstructions=String(body.meetingInstructions||"").trim();
    const category=String(body.category||"explore").trim().toLowerCase();
    const description=String(body.description||"").trim();
    const imageUrl=String(body.imageUrl||"").trim();
    const galleryUrls=String(body.galleryUrls||"").trim();
    const availableTimes=String(body.availableTimes||"").trim();
    const arrival=Number(body.arrivalMinutesBefore);
    const arrivalMinutesBefore=Number.isInteger(arrival)&&arrival>=0&&arrival<=180?arrival:null;
    const latitude=String(body.meetingLatitude||"").trim();
    const longitude=String(body.meetingLongitude||"").trim();
    const publish=body.publish===true;
    if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(experienceId))return json({error:"Ungültige Experience-ID."},400);
    if(!title)return json({error:"Titel fehlt."},400);
    if(!Number.isInteger(priceCents)||priceCents<50)return json({error:"Preis muss mindestens 0,50 betragen."},400);
    if(!["eur","ron","usd","gbp"].includes(currency))return json({error:"Nicht unterstützte Währung."},400);
    if(!["explore","relax","nightlife","adventure","vip"].includes(category))return json({error:"Ungültige Kategorie."},400);
    if(publish){
      if(!meetingPointName||!meetingAddress||!meetingCity||!meetingCountry)return json({error:"Veröffentlichung blockiert: Treffpunkt, Adresse, Stadt und Land sind erforderlich."},400);
    }
    const status=publish?"published":"draft";
    let providerName=String(body.providerName||"").trim();
    if(!providerName){
      const provider=await env.DB.prepare("SELECT name FROM providers WHERE connect_account_id=? AND active=1 LIMIT 1").bind(account).first();
      providerName=String(provider?.name||"").trim();
    }
    await env.DB.prepare(`INSERT INTO experiences (
      experience_id,provider_connect_account_id,provider_name,title,description,category,image_url,gallery_urls,available_times,
      price_cents,currency,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,
      arrival_minutes_before,meeting_latitude,meeting_longitude,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(experience_id) DO UPDATE SET
      provider_connect_account_id=excluded.provider_connect_account_id,
      provider_name=excluded.provider_name,title=excluded.title,description=excluded.description,category=excluded.category,
      image_url=excluded.image_url,gallery_urls=excluded.gallery_urls,available_times=excluded.available_times,
      price_cents=excluded.price_cents,currency=excluded.currency,meeting_point_name=excluded.meeting_point_name,
      meeting_address=excluded.meeting_address,meeting_city=excluded.meeting_city,meeting_country=excluded.meeting_country,
      meeting_instructions=excluded.meeting_instructions,arrival_minutes_before=excluded.arrival_minutes_before,
      meeting_latitude=excluded.meeting_latitude,meeting_longitude=excluded.meeting_longitude,status=excluded.status,
      updated_at=CURRENT_TIMESTAMP
    `).bind(experienceId,account,providerName||null,title,description||null,category,imageUrl||null,galleryUrls||null,availableTimes||null,priceCents,currency,meetingPointName||null,meetingAddress||null,meetingCity||null,meetingCountry||null,meetingInstructions||null,arrivalMinutesBefore,latitude||null,longitude||null,status).run();
    const experience=await env.DB.prepare("SELECT * FROM experiences WHERE experience_id=? LIMIT 1").bind(experienceId).first();
    return json({success:true,experience});
  }catch(error){return json({error:error?.message||"Server error"},500)}
}
async function resolveProviderAccount(request,env){
  const sessionProviderRef=await authenticateProviderSession(request,env).catch(()=>null);
  if(!sessionProviderRef||!env.DB)return "";
  const sessionProvider=await env.DB.prepare("SELECT connect_account_id FROM providers WHERE provider_ref=? AND active=1 LIMIT 1").bind(sessionProviderRef).first();
  const sessionAccount=String(sessionProvider?.connect_account_id||"").trim();
  return /^acct_[A-Za-z0-9]+$/.test(sessionAccount)?sessionAccount:"";
}

async function handlePublicOffers(request,env){
  if(request.method!=="GET")return json({error:"Method Not Allowed"},405);
  if(!env.DB)return json({offers:[]});
  try{
    await ensureExperiencesTable(env);
    const legacy=await env.DB.prepare("SELECT o.id,o.provider_ref,p.name AS provider_name,o.title,o.title_en,o.title_ro,o.description,o.description_en,o.description_ro,o.price_cents,o.currency,o.available_times,o.meeting_point_name,o.meeting_point_name_en,o.meeting_point_name_ro,o.meeting_address,o.meeting_city,o.meeting_country,o.meeting_instructions,o.meeting_instructions_en,o.meeting_instructions_ro,o.arrival_minutes_before,o.category,o.image_url,o.gallery_urls,o.active FROM offers o INNER JOIN providers p ON p.provider_ref=o.provider_ref AND p.active=1 WHERE o.active=1").all();
    const experiences=await env.DB.prepare("SELECT e.id,e.experience_id,e.provider_connect_account_id,e.provider_name,e.title,e.description,e.price_cents,e.currency,e.available_times,e.meeting_point_name,e.meeting_address,e.meeting_city,e.meeting_country,e.meeting_instructions,e.arrival_minutes_before,e.category,e.image_url,e.gallery_urls,e.status FROM experiences e INNER JOIN providers p ON p.connect_account_id=e.provider_connect_account_id AND p.active=1 WHERE e.status='published'").all();
    const legacyOffers=(legacy.results||[]).map(x=>({...x,source:"offer"}));
    const providerExperiences=(experiences.results||[]).map(x=>({
      id:x.id,experience_id:x.experience_id,provider_ref:"",provider_name:x.provider_name||"",
      title:x.title,title_en:"",title_ro:"",description:x.description||"",description_en:"",description_ro:"",
      price_cents:x.price_cents,currency:x.currency||"eur",available_times:x.available_times||"",
      meeting_point_name:x.meeting_point_name||"",meeting_point_name_en:"",meeting_point_name_ro:"",
      meeting_address:x.meeting_address||"",meeting_city:x.meeting_city||"",meeting_country:x.meeting_country||"",
      meeting_instructions:x.meeting_instructions||"",meeting_instructions_en:"",meeting_instructions_ro:"",
      arrival_minutes_before:x.arrival_minutes_before,category:x.category||"explore",image_url:x.image_url||"",
      gallery_urls:x.gallery_urls||"",active:1,source:"experience"
    }));
    return json({offers:[...legacyOffers,...providerExperiences]});
  }catch(error){return json({offers:[],error:error?.message||"Catalog failed"});}
}

async function createMarketplacePaymentIntent(request,env,ctx){
  let body;
  try{ body=await request.json(); }catch(_){ return json({error:"Invalid JSON payload"},400); }
  if(!env.DB)return json({error:"D1 database not configured"},500);

  let experienceId=String(body.experienceId||body.tourKey||body.experienceKey||body.experience_id||"").trim().toLowerCase();
  const offerIdRaw=String(body.offerId||"").trim();
  let experience=null;

  try{
    await ensureExperiencesTable(env);

    // Current public catalog uses the legacy D1 "offers" table. Accept its
    // offer id here so checkout cannot fail with "Missing experienceId".
    const numericOfferId=offerIdRaw.replace(/^offer-/i,"").trim();
    if(numericOfferId && /^\d+$/.test(numericOfferId)){
      const offer=await env.DB.prepare(`
        SELECT id,provider_ref,title,price_cents,currency,meeting_point_name,
               meeting_address,meeting_city,meeting_country,meeting_instructions,
               arrival_minutes_before,available_times,active
        FROM offers WHERE id=? LIMIT 1
      `).bind(Number(numericOfferId)).first();

      if(offer){
        const provider=await env.DB.prepare(
          "SELECT provider_ref,name,connect_account_id,active FROM providers WHERE provider_ref=? AND active=1 LIMIT 1"
        ).bind(String(offer.provider_ref||"")).first();

        experienceId="offer-"+String(offer.id);
        experience={
          experience_id:experienceId,
          title:String(offer.title||""),
          provider_connect_account_id:String(provider?.connect_account_id||""),
          provider_name:String(provider?.name||""),
          price_cents:Number(offer.price_cents||0),
          currency:String(offer.currency||"eur").toLowerCase(),
          meeting_point_name:String(offer.meeting_point_name||""),
          meeting_address:String(offer.meeting_address||""),
          meeting_city:String(offer.meeting_city||""),
          meeting_country:String(offer.meeting_country||""),
          meeting_instructions:String(offer.meeting_instructions||""),
          arrival_minutes_before:offer.arrival_minutes_before,
          available_times:String(offer.available_times||""),
          meeting_latitude:"",
          meeting_longitude:"",
          status:Number(offer.active)!==0 ? "published" : "draft"
        };
      }
    }

    if(!experience && !experienceId){
      const legacyTitle=String(body.tourName||body.experienceName||"").split(" · ")[0].trim();
      if(legacyTitle){
        const legacyExperienceIds={
          "Bukarest Old Town Story Walk":"old-town-walk",
          "Bucharest Old Town Story Walk":"old-town-walk",
          "Turul cu povești al Centrului Vechi":"old-town-walk",
          "Bucharest Bike Story":"bike-bucharest",
          "Therme București – Relax Day":"therme-vip",
          "Therme Bucharest – Relax Day":"therme-vip",
          "Therme București – Zi de Relaxare":"therme-vip",
          "Bucharest Night Out":"night-out",
          "Bucharest Kart Grand Prix":"kart-grand-prix"
        };
        experienceId=String(legacyExperienceIds[legacyTitle]||"").trim().toLowerCase();
      }
      if(!experienceId && legacyTitle){
        const matches=await env.DB.prepare(
          "SELECT experience_id FROM experiences WHERE status='published' AND lower(title)=lower(?) LIMIT 2"
        ).bind(legacyTitle).all();
        if((matches.results||[]).length===1)experienceId=String(matches.results[0].experience_id||"").trim().toLowerCase();
      }
    }

    if(!experience && !experienceId)return json({error:"Missing experienceId"},400);

    if(!experience){
      experience=await env.DB.prepare(
        "SELECT experience_id,title,provider_connect_account_id,provider_name,price_cents,currency,meeting_point_name,meeting_address,meeting_city,meeting_country,meeting_instructions,arrival_minutes_before,available_times,meeting_latitude,meeting_longitude,status FROM experiences WHERE experience_id=? LIMIT 1"
      ).bind(experienceId).first();
    }

    if(!experience)return json({error:"Experience is not configured for marketplace checkout"},409);
    if(String(experience.status)!=="published")return json({error:"Experience is not currently bookable"},409);

    const providerAccount=String(experience.provider_connect_account_id||"").trim();
    if(!/^acct_[A-Za-z0-9]+$/.test(providerAccount)){
      return json({error:"Experience is missing a valid provider Connect account"},409);
    }

    // A published experience must remain bookable only while its provider is
    // active. The public catalog already applies this rule; enforce the same
    // invariant again at checkout so a stale/direct experience ID cannot bypass
    // provider deactivation.
    const activeProvider=await env.DB.prepare(
      "SELECT provider_ref,name,connect_account_id,active FROM providers WHERE connect_account_id=? AND active=1 LIMIT 1"
    ).bind(providerAccount).first();
    if(!activeProvider){
      return json({error:"Experience provider is not currently active"},409);
    }

    const validProviderAccount=String(activeProvider.connect_account_id||"").trim();
    const bodyProviderName=String(activeProvider.name||experience.provider_name||"").trim();

    // Partner attribution is client-supplied for first-touch tracking, but the
    // server must verify it against the active partner table before it can affect
    // financial settlement. Never persist an arbitrary ref from the browser.
    const submittedPartnerRef=String(body.partnerRef||"").trim().toUpperCase();
    let partnerRef="";
    if(submittedPartnerRef){
      const partner=await env.DB.prepare(
        "SELECT partner_ref FROM partners WHERE partner_ref=? AND active=1 LIMIT 1"
      ).bind(submittedPartnerRef).first();
      if(!partner)return json({error:"Unknown partner referral"},400);
      partnerRef=String(partner.partner_ref||"").trim().toUpperCase();
    }
    body.partnerRef=partnerRef;

    const guests=Number(body.guests||1);
    if(!Number.isInteger(guests)||guests<1||guests>50)return json({error:"Invalid guest count"},400);

    const bookingDate=String(body.bookingDate||"").trim();
    const bookingTime=String(body.bookingTime||"").trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(bookingTime)){
      return json({error:"Ein gültiges Buchungsdatum und eine gültige Uhrzeit sind erforderlich."},400);
    }
    const bookingStart=toBucharestDate(bookingDate,bookingTime);
    if(!bookingStart||bookingStart.getTime()<=Date.now())return json({error:"Das Erlebnisdatum muss in der Zukunft liegen."},409);

    const configuredTimes=normalizeAvailableTimes(experience.available_times);
    if(configuredTimes.length && !configuredTimes.includes(bookingTime)){
      return json({error:"Die gewählte Uhrzeit ist für dieses Erlebnis nicht verfügbar."},409);
    }

    const unitPrice=Number(experience.price_cents);
    if(!Number.isInteger(unitPrice)||unitPrice<50)return json({error:"Experience has no valid server-side price"},409);

    const totalAmount=unitPrice*guests;
    if(!Number.isSafeInteger(totalAmount)||totalAmount<50)return json({error:"Invalid calculated amount"},409);

    // Never trust a client-supplied booking ID: it is persisted as a unique
    // booking identifier after payment succeeds. Generate it server-side so a
    // forged ID cannot collide with or interfere with an existing booking.
    body.bookingId = "FV-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    body.experienceId=experienceId;
    body.offerId=offerIdRaw || (experienceId.startsWith("offer-") ? experienceId.slice(6) : "");
    body.providerConnectAccountId=validProviderAccount;
    body.providerName=String(bodyProviderName||experience.provider_name||"");
    body.experienceName=experience.title||body.tourName||"";
    body.amount=totalAmount;
    body.currency=String(experience.currency||"eur").toLowerCase();
    body.guests=guests;
    body.meetingPointName=String(experience.meeting_point_name||"");
    body.meetingAddress=String(experience.meeting_address||"");
    body.meetingCity=String(experience.meeting_city||"");
    body.meetingCountry=String(experience.meeting_country||"");
    body.meetingInstructions=String(experience.meeting_instructions||"");
    body.arrivalMinutesBefore=experience.arrival_minutes_before==null?"":String(experience.arrival_minutes_before);
    body.meetingLatitude=String(experience.meeting_latitude||"");
    body.meetingLongitude=String(experience.meeting_longitude||"");

    return baseWorker.fetch(new Request(request,{method:"POST",headers:request.headers,body:JSON.stringify(body)}),env,ctx);
  }catch(error){
    console.error("FiiViu marketplace payment routing failed",error);
    return json({error:error?.message||"Marketplace payment routing failed"},500);
  }
}
function normalizeAvailableTimes(value){
  if(Array.isArray(value))return value.map(String).map(v=>v.trim()).filter(Boolean);
  const raw=String(value||"").trim();
  if(!raw)return [];
  try{
    const parsed=JSON.parse(raw);
    if(Array.isArray(parsed))return parsed.map(String).map(v=>v.trim()).filter(Boolean);
  }catch(_){ }
  return raw.split(",").map(v=>v.trim()).filter(Boolean);
}
function toBucharestDate(dateValue,timeValue){
  const date=String(dateValue||"").trim(), time=String(timeValue||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
  const [y,m,d]=date.split("-").map(Number),[hh,mm]=time.split(":").map(Number);
  const guess=Date.UTC(y,m-1,d,hh,mm);
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Bucharest",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const offset=Date.UTC(Number(v.year),Number(v.month)-1,Number(v.day),Number(v.hour),Number(v.minute),Number(v.second))-guess;
  return new Date(guess-offset);
}
async function handleMarketplaceWebhook(request,env,ctx){let body;try{body=await request.text();const event=JSON.parse(body);if(event?.type==="payment_intent.succeeded"){const provider=String(event?.data?.object?.metadata?.provider_connect_account_id||"").trim();if(!/^acct_[A-Za-z0-9]+$/.test(provider))return json({error:"Payment succeeded without a valid provider Connect account"},400)}}catch(_){return json({error:"Invalid webhook payload"},400)}const response=await baseWorker.fetch(new Request(request,{method:"POST",headers:request.headers,body}),env,ctx);if(response.ok){try{const event=JSON.parse(body);if(event?.type==="payment_intent.succeeded")ctx.waitUntil(persistMarketplaceBookingProvider(env,event))}catch(_){}}return response}
async function persistMarketplaceBookingProvider(env,event){if(!env.DB)return;const paymentIntentId=String(event?.data?.object?.id||"").trim(),provider=String(event?.data?.object?.metadata?.provider_connect_account_id||"").trim();if(!paymentIntentId||!/^acct_[A-Za-z0-9]+$/.test(provider))return;try{for(let attempt=0;attempt<12;attempt++){try{const result=await env.DB.prepare("UPDATE bookings SET provider_connect_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE payment_intent_id=?").bind(provider,paymentIntentId).run();if(Number(result?.meta?.changes||0)>0)return}catch(error){if(attempt===11)throw error}await new Promise(resolve=>setTimeout(resolve,250))}}catch(error){console.error("FiiViu marketplace provider booking sync failed",error)}}
async function injectMarketplaceCheckoutBridge(response,url){
  const html=await response.text();
  const bridge=`<script>(function(){var previousFetch=window.fetch.bind(window);window.fetch=function(input,init){try{var target=typeof input==='string'?input:(input&&input.url)||'';if(target.indexOf('/api/create-payment-intent')!==-1&&init&&typeof init.body==='string'){var data=JSON.parse(init.body);var key=(typeof currentTourKey!=='undefined'?String(currentTourKey||'').trim():'');if(key)data.experienceId=key.toLowerCase();init.body=JSON.stringify(data)}}catch(_){}return previousFetch(input,init)}})();</script>`;
  const marker="</body>";
  const output=html.includes(marker)?html.replace(marker,bridge+marker):html+bridge;
  const headers=new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control","no-cache");
  return new Response(output,{status:response.status,statusText:response.statusText,headers});
}

async function recordPartnerScan(env,ref){
  if(!env.DB)return;
  const partnerRef=String(ref||"").trim().toUpperCase();
  if(!partnerRef)return;
  try{
    const partner=await env.DB.prepare("SELECT partner_ref,active FROM partners WHERE partner_ref=? LIMIT 1").bind(partnerRef).first();
    if(!partner||Number(partner.active)!==1)return;
    await env.DB.prepare("INSERT INTO partner_scan_events (partner_ref) VALUES (?)").bind(partnerRef).run();
  }catch(error){console.error("FiiViu partner scan tracking failed",error)}
}
function isHtml(response,url){if(url.pathname.startsWith("/api/"))return false;return(response.headers.get("content-type")||"").includes("text/html")}
async function ensureExperiencesTable(env){
  const columns=await env.DB.prepare("PRAGMA table_info(experiences)").all();
  const required=["experience_id","provider_connect_account_id","provider_name","title","description","category","image_url","gallery_urls","available_times","price_cents","currency","meeting_point_name","meeting_address","meeting_city","meeting_country","meeting_instructions","arrival_minutes_before","meeting_latitude","meeting_longitude","status"];
  const existing=new Set((columns.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Experiences schema is incomplete: "+missing.join(", "));
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}})}
