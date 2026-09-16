import { handleStripeWebhook } from "./stripe-webhook.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, PATCH, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"};
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});

    if (url.pathname === "/api/stripe/webhook") {
      return handleStripeWebhook(request, env);
    }

    if (url.pathname === "/api/create-payment-intent") {
      if (request.method !== "POST") return json({error:"Method Not Allowed"},405,corsHeaders);
      try {
        const body=await request.json(); const amount=Number(body.amount); const currency=String(body.currency||"eur").toLowerCase();
        const bookingId=String(body.bookingId||""); const tourName=String(body.tourName||""); const guests=Number(body.guests||1);
        const bodyPartnerRef=typeof body.partnerRef==="string"?body.partnerRef.trim():""; const urlPartnerRef=url.searchParams.get("ref")?.trim()||""; let partnerRef=bodyPartnerRef||urlPartnerRef;
        if(!Number.isInteger(amount)||amount<50)return json({error:"Invalid amount"},400,corsHeaders);
        if(!env.STRIPE_SECRET_KEY)return json({error:"Stripe secret not configured"},500,corsHeaders);
        if(partnerRef && env.DB){
          await ensurePartnersTable(env);
          const partner=await env.DB.prepare("SELECT active FROM partners WHERE partner_ref = ? LIMIT 1").bind(partnerRef).first();
          if(!partner || Number(partner.active)!==1) partnerRef="";
        }
        const params=new URLSearchParams(); params.set("amount",String(amount)); params.set("currency",currency); params.set("metadata[booking_id]",bookingId); params.set("metadata[tour_name]",tourName); params.set("metadata[guests]",String(guests));
        if(partnerRef)params.set("metadata[partner_ref]",partnerRef);
        const configuredProvider=String(env.STRIPE_PROVIDER_CONNECT_ACCOUNT_ID||"").trim();
        if(configuredProvider)params.set("metadata[provider_connect_account_id]",configuredProvider);
        params.set("automatic_payment_methods[enabled]","true");
        const stripeResponse=await fetch("https://api.stripe.com/v1/payment_intents",{method:"POST",headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:params});
        const data=await stripeResponse.json(); if(!stripeResponse.ok)return json({error:data?.error?.message||"Stripe error"},stripeResponse.status,corsHeaders);
        return json({clientSecret:data.client_secret,paymentIntentId:data.id,partnerRef:data.metadata?.partner_ref||""},200,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }

    if (url.pathname === "/api/partner-stats") {
      if(request.method!=="GET")return json({error:"Method Not Allowed"},405,corsHeaders);
      try{const partnerRef=url.searchParams.get("ref")?.trim()||"";if(!partnerRef)return json({error:"Partner-Code fehlt"},400,corsHeaders);return json(await getPartnerStats(env,partnerRef),200,corsHeaders)}catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }

    if (url.pathname === "/api/admin/partners") {
      if(!env.ADMIN_PAYOUT_KEY)return json({error:"Admin key not configured"},500,corsHeaders);
      if(!isAdmin(request,env))return json({error:"Unauthorized"},401,corsHeaders);
      if(!env.DB)return json({error:"D1 database not configured"},500,corsHeaders);
      try{
        await ensurePartnersTable(env);
        if(request.method==="GET"){
          const result=await env.DB.prepare("SELECT id,name,type,partner_ref,contact_name,contact_email,active,created_at FROM partners ORDER BY created_at DESC, id DESC").all();
          return json({partners:result.results||[]},200,corsHeaders);
        }
        if(request.method==="POST"){
          const body=await request.json(); const name=String(body.name||"").trim(); const type=String(body.type||"Hotel").trim(); const contactName=String(body.contactName||"").trim(); const contactEmail=String(body.contactEmail||"").trim();
          let partnerRef=String(body.partnerRef||"").trim().toUpperCase(); if(!name)return json({error:"Partner-Name fehlt"},400,corsHeaders); if(!partnerRef)partnerRef=await generatePartnerRef(env,name);
          if(!/^[A-Z0-9_-]{3,32}$/.test(partnerRef))return json({error:"Ungültiger Partner-Code"},400,corsHeaders);
          const existing=await env.DB.prepare("SELECT id FROM partners WHERE partner_ref = ? LIMIT 1").bind(partnerRef).first(); if(existing)return json({error:"Dieser Partner-Code existiert bereits."},409,corsHeaders);
          const result=await env.DB.prepare("INSERT INTO partners (name,type,partner_ref,contact_name,contact_email,active) VALUES (?,?,?,?,?,1)").bind(name,type||"Hotel",partnerRef,contactName||null,contactEmail||null).run();
          return json({success:true,partner:{id:result.meta?.last_row_id||null,name,type:type||"Hotel",partnerRef,contactName,contactEmail,active:1,link:buildPartnerLink(partnerRef),qrUrl:buildQrUrl(partnerRef)}},201,corsHeaders);
        }
        if(request.method==="PATCH"){
          const body=await request.json(); const id=Number(body.id); if(!Number.isInteger(id)||id<=0)return json({error:"Ungültige Partner-ID"},400,corsHeaders);
          const current=await env.DB.prepare("SELECT * FROM partners WHERE id = ? LIMIT 1").bind(id).first(); if(!current)return json({error:"Partner nicht gefunden"},404,corsHeaders);
          const name=String(body.name ?? current.name).trim(); const type=String(body.type ?? current.type).trim(); const contactName=String(body.contactName ?? current.contact_name ?? "").trim(); const contactEmail=String(body.contactEmail ?? current.contact_email ?? "").trim();
          if(!name)return json({error:"Partner-Name fehlt"},400,corsHeaders);
          const active=body.active===undefined?Number(current.active)!==0:(body.active===true||body.active===1||body.active==="1");
          await env.DB.prepare("UPDATE partners SET name=?,type=?,contact_name=?,contact_email=?,active=? WHERE id=?").bind(name,type||"Hotel",contactName||null,contactEmail||null,active?1:0,id).run();
          const updated=await env.DB.prepare("SELECT id,name,type,partner_ref,contact_name,contact_email,active,created_at FROM partners WHERE id = ? LIMIT 1").bind(id).first();
          return json({success:true,partner:updated},200,corsHeaders);
        }
        return json({error:"Method Not Allowed"},405,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }

    if (url.pathname === "/api/admin/partner-payout") {
      if(!env.ADMIN_PAYOUT_KEY)return json({error:"Payout admin key not configured"},500,corsHeaders);
      if(!isAdmin(request,env))return json({error:"Unauthorized"},401,corsHeaders);
      if(!env.DB)return json({error:"D1 database not configured"},500,corsHeaders);
      try{
        await ensurePayoutsTable(env);
        const partnerRef=url.searchParams.get("ref")?.trim()||"";
        if(request.method==="GET"){
          if(!partnerRef)return json({error:"Partner-Code fehlt"},400,corsHeaders);
          const partner=await env.DB.prepare("SELECT id,name,type,partner_ref,active FROM partners WHERE partner_ref = ? LIMIT 1").bind(partnerRef).first();
          if(!partner)return json({error:"Partner nicht gefunden"},404,corsHeaders);
          const result=await env.DB.prepare("SELECT id,partner_ref,amount_cents,payout_date,status,reference,created_at FROM partner_payouts WHERE partner_ref = ? ORDER BY payout_date DESC, id DESC").bind(partnerRef).all();
          return json({partner,payouts:(result.results||[]).map(p=>({...p,amount:Number(p.amount_cents)/100}))},200,corsHeaders);
        }
        if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
        const body=await request.json(); const bodyPartnerRef=String(body.partnerRef||"").trim(); const amountCents=Number(body.amountCents); const payoutDate=String(body.payoutDate||"").trim(); const reference=String(body.reference||"").trim();
        if(!bodyPartnerRef)return json({error:"Partner-Code fehlt"},400,corsHeaders); if(!Number.isInteger(amountCents)||amountCents<=0)return json({error:"Invalid payout amount"},400,corsHeaders); if(!/^\d{4}-\d{2}-\d{2}$/.test(payoutDate))return json({error:"Invalid payout date"},400,corsHeaders);
        const partner=await env.DB.prepare("SELECT id,name,active FROM partners WHERE partner_ref = ? LIMIT 1").bind(bodyPartnerRef).first();
        if(!partner)return json({error:"Partner nicht gefunden"},404,corsHeaders);
        if(Number(partner.active)!==1)return json({error:"Dieser Partner ist deaktiviert."},400,corsHeaders);
        const stats=await getPartnerStats(env,bodyPartnerRef); const openCommissionCents=Math.round(stats.openCommission*100);
        if(openCommissionCents<0)return json({error:"Für diesen Partner besteht aktuell ein negativer Provisionssaldo durch Rückerstattungen nach früheren Auszahlungen.",openCommission:stats.openCommission,paidCommission:stats.paidCommission},400,corsHeaders);
        if(amountCents>openCommissionCents)return json({error:"Auszahlung ist höher als die offene Provision.",openCommission:stats.openCommission,requestedAmount:amountCents/100},400,corsHeaders);
        if(reference){const existing=await env.DB.prepare("SELECT id FROM partner_payouts WHERE partner_ref = ? AND reference = ? LIMIT 1").bind(bodyPartnerRef,reference).first();if(existing)return json({error:"Diese Auszahlungsreferenz existiert bereits."},409,corsHeaders)}
        const result=await env.DB.prepare("INSERT INTO partner_payouts (partner_ref,amount_cents,payout_date,status,reference) VALUES (?,?,?,'paid',?)").bind(bodyPartnerRef,amountCents,payoutDate,reference||null).run(); const updatedStats=await getPartnerStats(env,bodyPartnerRef);
        return json({success:true,payoutId:result.meta?.last_row_id||null,partnerRef:bodyPartnerRef,amount:amountCents/100,payoutDate,reference:reference||null,openCommission:updatedStats.openCommission,paidCommission:updatedStats.paidCommission},201,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }
    return env.ASSETS.fetch(request);
  }
};

function isAdmin(request,env){return request.headers.get("Authorization")==="Bearer "+env.ADMIN_PAYOUT_KEY}
async function ensurePartnersTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'Hotel',partner_ref TEXT NOT NULL UNIQUE,contact_name TEXT,contact_email TEXT,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  try{await env.DB.prepare("ALTER TABLE partners ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run()}catch(e){}
}
async function ensurePayoutsTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS partner_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT,partner_ref TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),payout_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'cancelled')),reference TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner_ref ON partner_payouts(partner_ref)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_partner_payouts_payout_date ON partner_payouts(payout_date)").run();
}
async function ensureBookingSettlementsTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS booking_settlements (id INTEGER PRIMARY KEY AUTOINCREMENT,booking_id TEXT NOT NULL UNIQUE,payment_intent_id TEXT UNIQUE,total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),provider_amount_cents INTEGER NOT NULL CHECK (provider_amount_cents >= 0),fiiviu_amount_cents INTEGER NOT NULL CHECK (fiiviu_amount_cents >= 0),partner_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (partner_amount_cents >= 0),partner_ref TEXT,settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending','ready','transferred','failed','refunded','cancelled')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (partner_ref) REFERENCES partners(partner_ref))`).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_payment_intent ON booking_settlements(payment_intent_id)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_partner_ref ON booking_settlements(partner_ref)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_booking_settlements_status ON booking_settlements(settlement_status)").run();
}
async function generatePartnerRef(env,name){const base=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"").slice(0,8)||"PARTNER";for(let i=1;i<1000;i++){const candidate=base.slice(0,12)+String(i).padStart(3,"0");const existing=await env.DB.prepare("SELECT id FROM partners WHERE partner_ref = ? LIMIT 1").bind(candidate).first();if(!existing)return candidate}throw new Error("Kein freier Partner-Code verfügbar.")}
function buildPartnerLink(partnerRef){return "https://getlocalis.pages.dev/?ref="+encodeURIComponent(partnerRef)}
function buildQrUrl(partnerRef){return "https://api.qrserver.com/v1/create-qr-code/?size=500x500&data="+encodeURIComponent(buildPartnerLink(partnerRef))}

async function getPartnerStats(env,partnerRef){if(!env.STRIPE_SECRET_KEY)throw new Error("Stripe secret not configured");const payments=await searchPartnerPayments(env,partnerRef);const successful=payments.filter(payment=>payment.status==="succeeded");let revenueCents=0;for(const payment of successful){const receivedCents=Number(payment.amount_received||payment.amount||0);const refundedCents=await getSuccessfulRefundAmount(env,payment.id);revenueCents+=Math.max(receivedCents-refundedCents,0)}const commissionCents=Math.round(revenueCents*0.03);let paidCents=0;if(env.DB){await ensurePayoutsTable(env);const payoutResult=await env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM partner_payouts WHERE partner_ref = ? AND status = 'paid'").bind(partnerRef).first();paidCents=Number(payoutResult?.paid_cents||0)}const openCommissionCents=commissionCents-paidCents;return{partnerRef,bookings:successful.length,revenue:revenueCents/100,commission:commissionCents/100,openCommission:openCommissionCents/100,paidCommission:paidCents/100,currency:"eur"}}
async function searchPartnerPayments(env,partnerRef){const allPayments=[];let page="";for(let i=0;i<100;i++){const query="metadata['partner_ref']:"+"'"+partnerRef.replace(/'/g,"\\'")+"'";const stripeUrl="https://api.stripe.com/v1/payment_intents/search?query="+encodeURIComponent(query)+"&limit=100"+(page?"&page="+encodeURIComponent(page):"");const stripeResponse=await fetch(stripeUrl,{method:"GET",headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY}});const data=await stripeResponse.json();if(!stripeResponse.ok)throw new Error(data?.error?.message||"Stripe error");allPayments.push(...(data.data||[]));if(!data.next_page)break;page=data.next_page}return allPayments}
async function getSuccessfulRefundAmount(env,paymentIntentId){let refundedCents=0;let startingAfter="";for(let i=0;i<100;i++){let stripeUrl="https://api.stripe.com/v1/refunds?payment_intent="+encodeURIComponent(paymentIntentId)+"&limit=100";if(startingAfter)stripeUrl+="&starting_after="+encodeURIComponent(startingAfter);const stripeResponse=await fetch(stripeUrl,{method:"GET",headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY}});const data=await stripeResponse.json();if(!stripeResponse.ok)throw new Error(data?.error?.message||"Stripe refund lookup error");for(const refund of data.data||[])if(refund.status==="succeeded")refundedCents+=Number(refund.amount||0);if(!data.has_more||!(data.data||[]).length)break;startingAfter=data.data[data.data.length-1].id}return refundedCents}
function json(data,status,corsHeaders){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...corsHeaders}})