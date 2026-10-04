async function countPaidOfferGuests(env,offerId,date,time){
  const offer=await env.DB.prepare("SELECT title,title_en,title_ro FROM offers WHERE id=? LIMIT 1").bind(offerId).first();
  const names=[offer?.title,offer?.title_en,offer?.title_ro];
  const rows=await env.DB.prepare(
    "SELECT guests,booking_date,booking_time,offer_id FROM bookings WHERE payment_status='paid' AND status NOT IN ('cancelled','canceled','refunded') AND CAST(offer_id AS INTEGER)=?"
  ).bind(offerId).all();
  const targetDate=normalizeAvailabilityDate(date);
  const targetTime=normalizeAvailabilityTime(time);
  return Math.max(0,(rows.results||[]).reduce((sum,booking)=>{
    return normalizeAvailabilityDate(booking?.booking_date)===targetDate &&
      normalizeAvailabilityTime(booking?.booking_time)===targetTime
      ?sum+Number(booking?.guests||0):sum;
  },0)) + await countPaidNamedGuests(env,names,date,time);
}
async function countPaidOfferGuests(env,offerId,date,time){
  const offer=await env.DB.prepare("SELECT title,title_en,title_ro FROM offers WHERE id=? LIMIT 1").bind(offerId).first();
  const names=[offer?.title,offer?.title_en,offer?.title_ro].map(normalizeAvailabilityName).filter(Boolean);
  const rows=await env.DB.prepare(
    "SELECT booking_id,guests,booking_date,booking_time,offer_id,experience_name FROM bookings WHERE payment_status='paid' AND status NOT IN ('cancelled','canceled','refunded') AND (CAST(offer_id AS INTEGER)=? OR lower(trim(experience_name)) IN (lower(trim(?)),lower(trim(?)),lower(trim(?))))"
  ).bind(offerId,names[0]||"",names[1]||names[0]||"",names[2]||names[0]||"").all();
  const targetDate=normalizeAvailabilityDate(date);
  const targetTime=normalizeAvailabilityTime(time);
  const seen=new Set();
  return Math.max(0,(rows.results||[]).reduce((sum,booking)=>{
    const id=String(booking?.booking_id||"");
    if(id&&seen.has(id))return sum;
    if(id)seen.add(id);
    if(normalizeAvailabilityDate(booking?.booking_date)!==targetDate)return sum;
    if(normalizeAvailabilityTime(booking?.booking_time)!==targetTime)return sum;
    return sum+Number(booking?.guests||0);
  },0));
}
async function countPaidExperienceGuests(env,experienceId,date,time){
  const experience=await env.DB.prepare("SELECT title,title_en,title_ro FROM experiences WHERE experience_id=? LIMIT 1").bind(experienceId).first();
  return countPaidNamedGuests(env,[experience?.title,experience?.title_en,experience?.title_ro],date,time);
}
async function handleOfferAvailability(request,env){
  if(!env.DB)return json({error:"D1 database not configured"},500);
  const params=new URL(request.url).searchParams;
  const offerId=Number(params.get("offerId")||0);
  const experienceId=String(params.get("experienceId")||"").trim();
  const date=String(params.get("date")||"").trim();
  const time=String(params.get("time")||"").trim();
  if((!Number.isInteger(offerId)||offerId<1)&&!experienceId)return json({error:"Ungültiges Angebot oder Erlebnis."},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"Ungültiges Datum."},400);

  let source="offer";
  let item;
  if(Number.isInteger(offerId)&&offerId>0){
    item=await env.DB.prepare("SELECT id,capacity,available_times,active FROM offers WHERE id=? LIMIT 1").bind(offerId).first();
  }else{
    source="experience";
    item=await env.DB.prepare("SELECT experience_id,capacity,available_times,status,title,title_en,title_ro FROM experiences WHERE experience_id=? LIMIT 1").bind(experienceId).first();
  }
  if(!item||((source==="offer"&&Number(item.active)!==1)||(source==="experience"&&String(item.status||"")!=="published"))){
    return json({error:"Inserat nicht gefunden."},404);
  }

  const times=normalizeAvailableTimes(item.available_times);
  const targetTimes=time ? times.filter(value=>normalizeAvailabilityTime(value)===normalizeAvailabilityTime(time)) : times;
  if(time&&!targetTimes.length)return json({error:"Diese Uhrzeit ist für das Inserat nicht verfügbar."},409);

  const capacity=Number(item.capacity);
  const result={
    offerId:source==="offer"?Number(item.id):null,
    experienceId:source==="experience"?String(item.experience_id||experienceId):null,
    date,
    capacity:Number.isInteger(capacity)&&capacity>0?capacity:null,
    slots:{}
  };
  for(const slotTime of targetTimes){
    const normalized=String(slotTime).trim();
    if(!result.capacity){
      result.slots[normalized]={capacity:null,booked:0,remaining:null,soldOut:false};
      continue;
    }
    const booked=source==="offer"
      ? await countPaidOfferGuests(env,Number(item.id),date,normalized)
      : await countPaidExperienceGuests(env,String(item.experience_id||experienceId),date,normalized);
    const remaining=Math.max(result.capacity-booked,0);
    result.slots[normalized]={capacity:result.capacity,booked,remaining,soldOut:remaining<=0};
  }
  return json(result);
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
  const required=["experience_id","provider_connect_account_id","provider_name","title","description","category","image_url","gallery_urls","available_times","price_cents","currency","meeting_point_name","meeting_address","meeting_city","meeting_country","meeting_instructions","arrival_minutes_before","meeting_latitude","meeting_longitude","status","title_en","title_ro","description_en","description_ro","meeting_point_name_en","meeting_point_name_ro","meeting_instructions_en","meeting_instructions_ro","updated_at"];
  const existing=new Set((columns.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  for(const name of missing){
    const type=name==="updated_at"?"TEXT":"TEXT";
    await env.DB.prepare("ALTER TABLE experiences ADD COLUMN "+name+" "+type).run();
  }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}})}
