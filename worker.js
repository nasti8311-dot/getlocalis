import { handleStripeWebhook } from "./stripe-webhook.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS","Cache-Control":"no-store","Access-Control-Allow-Headers":"Content-Type, Authorization"};
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders});

    if (url.pathname === "/api/partner-visit") {
      if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
      if(!env.DB)return json({error:"D1 database not configured"},500,corsHeaders);
      try{
        const body=await request.json();
        const partnerRef=String(body.ref||"").trim().toUpperCase();
        const visitorId=String(body.visitorId||"").trim();
        if(!partnerRef||!visitorId||visitorId.length>128)return json({error:"Invalid partner visit"},400,corsHeaders);
        await ensurePartnerTrackingTable(env);
        const partner=await env.DB.prepare("SELECT partner_ref,active FROM partners WHERE partner_ref=? LIMIT 1").bind(partnerRef).first();
        if(!partner||Number(partner.active)!==1)return json({error:"Unknown partner"},404,corsHeaders);
        await env.DB.prepare("INSERT INTO partner_scan_events (partner_ref) VALUES (?)").bind(partnerRef).run();
        await env.DB.prepare("INSERT OR IGNORE INTO partner_visitors (partner_ref,visitor_id,first_seen_at,last_seen_at) VALUES (?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(partnerRef,visitorId).run();
        await env.DB.prepare("UPDATE partner_visitors SET last_seen_at=CURRENT_TIMESTAMP WHERE partner_ref=? AND visitor_id=?").bind(partnerRef,visitorId).run();
        return json({success:true},200,corsHeaders);
      }catch(error){return json({error:error?.message||"Partner tracking failed"},500,corsHeaders)}
    }

    if (url.pathname === "/api/stripe/webhook") {
      return handleStripeWebhook(request, env);
    }

    if (url.pathname === "/api/create-payment-intent") {
      return json(
        { error: "Legacy payment endpoint disabled. Use the marketplace checkout." },
        410,
        corsHeaders
      );
    }

    if (url.pathname === "/api/admin/translate-offers") {
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405, corsHeaders);
  const expected = String(env.ADMIN_PAYOUT_KEY || "").trim();
  const provided = String(request.headers.get("Authorization") || "");
  if (!expected || provided !== "Bearer " + expected) return json({ error: "Unauthorized" }, 401, corsHeaders);
  try {
    await ensureOffersTable(env);
    const rows = await env.DB.prepare("SELECT id,title,description,meeting_point_name,meeting_instructions,title_en,title_ro,description_en,description_ro,meeting_point_name_en,meeting_point_name_ro,meeting_instructions_en,meeting_instructions_ro FROM offers").all();
    let updated = 0;
    for (const row of (rows.results || [])) {
      const translated = await translateOfferFields(row, { force: true });
      const missing = !String(row.title_en || "").trim() || !String(row.title_ro || "").trim() ||
        !String(row.description_en || "").trim() || !String(row.description_ro || "").trim() ||
        !String(row.meeting_point_name_en || "").trim() || !String(row.meeting_point_name_ro || "").trim() ||
        !String(row.meeting_instructions_en || "").trim() || !String(row.meeting_instructions_ro || "").trim();
      if (!missing) continue;
      await env.DB.prepare("UPDATE offers SET title_en=?,title_ro=?,description_en=?,description_ro=?,meeting_point_name_en=?,meeting_point_name_ro=?,meeting_instructions_en=?,meeting_instructions_ro=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(translated.titleEn, translated.titleRo, translated.descriptionEn, translated.descriptionRo, translated.meetingPointNameEn, translated.meetingPointNameRo, translated.meetingInstructionsEn, translated.meetingInstructionsRo, row.id).run();
      updated++;
    }
    return json({ ok: true, updated }, 200, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || "Übersetzung fehlgeschlagen." }, 500, corsHeaders);
  }
}

if (url.pathname === "/api/offer-translation-status") {
  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, 405, corsHeaders);
  if (!env.DB) return json({ ready: false }, 200, corsHeaders);
  try {
    await ensureOffersTable(env);
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    if (!id) return json({ error: "id is required" }, 400, corsHeaders);
    const row = await env.DB.prepare("SELECT id,title,title_en,title_ro,description,description_en,description_ro,meeting_point_name,meeting_point_name_en,meeting_point_name_ro,meeting_instructions,meeting_instructions_en,meeting_instructions_ro FROM offers WHERE id=? LIMIT 1").bind(id).first();
    if (!row) return json({ error: "Offer not found" }, 404, corsHeaders);
    return json({
      ready: Boolean(String(row.title_en||"").trim() && String(row.title_ro||"").trim() &&
        String(row.description_en||"").trim() && String(row.description_ro||"").trim() &&
        String(row.meeting_point_name_en||"").trim() && String(row.meeting_point_name_ro||"").trim() &&
        String(row.meeting_instructions_en||"").trim() && String(row.meeting_instructions_ro||"").trim()),
      offer: row
    }, 200, corsHeaders);
  } catch (error) {
    return json({ error: error?.message || "Status failed" }, 500, corsHeaders);
  }
}

if (url.pathname === "/api/offers") {
      if(request.method!=="GET")return json({error:"Method Not Allowed"},405,corsHeaders);
      if(!env.DB)return json({offers:[]},200,corsHeaders);
      try{
        await ensureOffersTable(env);
        const result=await env.DB.prepare("SELECT o.id,o.provider_ref,p.name AS provider_name,o.title,o.title_en,o.title_ro,o.description,o.description_en,o.description_ro,o.price_cents,o.currency,o.available_times,o.meeting_point_name,o.meeting_point_name_en,o.meeting_point_name_ro,o.meeting_address,o.meeting_city,o.meeting_country,o.meeting_instructions,o.meeting_instructions_en,o.meeting_instructions_ro,o.arrival_minutes_before,o.category,o.image_url,o.gallery_urls,o.active FROM offers o LEFT JOIN providers p ON p.provider_ref=o.provider_ref AND p.active=1 WHERE o.active=1 ORDER BY o.category ASC, o.title ASC, o.id ASC").all();
        const offers=result.results||[];
        for(const offer of offers){
          const missing=!String(offer.title_en||"").trim()||!String(offer.title_ro||"").trim()||
            !String(offer.description_en||"").trim()||!String(offer.description_ro||"").trim()||
            !String(offer.meeting_point_name_en||"").trim()||!String(offer.meeting_point_name_ro||"").trim()||
            !String(offer.meeting_instructions_en||"").trim()||!String(offer.meeting_instructions_ro||"").trim();
          const stale =
            String(offer.title_en||"").trim()===String(offer.title||"").trim() ||
            String(offer.title_ro||"").trim()===String(offer.title||"").trim() ||
            String(offer.description_en||"").trim()===String(offer.description||"").trim() ||
            String(offer.description_ro||"").trim()===String(offer.description||"").trim() ||
            String(offer.meeting_point_name_en||"").trim()===String(offer.meeting_point_name||"").trim() ||
            String(offer.meeting_point_name_ro||"").trim()===String(offer.meeting_point_name||"").trim() ||
            String(offer.meeting_instructions_en||"").trim()===String(offer.meeting_instructions||"").trim() ||
            String(offer.meeting_instructions_ro||"").trim()===String(offer.meeting_instructions||"").trim();
          if(!missing && !stale) continue;
          try{
            const translated=await translateOfferFields(offer);
            await env.DB.prepare("UPDATE offers SET title_en=?,title_ro=?,description_en=?,description_ro=?,meeting_point_name_en=?,meeting_point_name_ro=?,meeting_instructions_en=?,meeting_instructions_ro=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .bind(translated.titleEn,translated.titleRo,translated.descriptionEn,translated.descriptionRo,translated.meetingPointNameEn,translated.meetingPointNameRo,translated.meetingInstructionsEn,translated.meetingInstructionsRo,offer.id).run();
            Object.assign(offer,{
              title_en:translated.titleEn,title_ro:translated.titleRo,
              description_en:translated.descriptionEn,description_ro:translated.descriptionRo,
              meeting_point_name_en:translated.meetingPointNameEn,meeting_point_name_ro:translated.meetingPointNameRo,
              meeting_instructions_en:translated.meetingInstructionsEn,meeting_instructions_ro:translated.meetingInstructionsRo
            });
          }catch(_){}
        }
        return json({offers},200,corsHeaders);
      }catch(error){
        return json({offers:[]},200,corsHeaders);
      }
    }

    if (url.pathname === "/api/admin/offers") {
      if(!env.ADMIN_PAYOUT_KEY)return json({error:"Admin key not configured"},500,corsHeaders);
      if(!isAdmin(request,env))return json({error:"Unauthorized"},401,corsHeaders);
      if(!env.DB)return json({error:"D1 database not configured"},500,corsHeaders);
      try{
        await ensureOffersTable(env);
        if(request.method==="GET"){
          const providerRef=url.searchParams.get("provider_ref")?.trim()||"";
          const result=providerRef
            ? await env.DB.prepare("SELECT * FROM offers WHERE provider_ref=? ORDER BY active DESC, title ASC, id ASC").bind(providerRef).all()
            : await env.DB.prepare("SELECT * FROM offers ORDER BY provider_ref ASC, active DESC, title ASC, id ASC").all();
          return json({offers:result.results||[]},200,corsHeaders);
        }
        const body=await request.json();
        if(request.method==="POST"){
          const providerRef=String(body.providerRef||"").trim();
          const title=String(body.title||"").trim();
          const priceCents=Number(body.priceCents);
          if(!providerRef||!title)return json({error:"Veranstalter und Titel sind erforderlich."},400,corsHeaders);
          if(!Number.isInteger(priceCents)||priceCents<50)return json({error:"Ungültiger Preis."},400,corsHeaders);
          const translated = body.autoTranslate === true ? await translateOfferFields(body) : null;
          if (translated) Object.assign(body, translated);
          const provider=await env.DB.prepare("SELECT provider_ref FROM providers WHERE provider_ref=? AND active=1 LIMIT 1").bind(providerRef).first();
          if(!provider)return json({error:"Aktiver Veranstalter nicht gefunden."},404,corsHeaders);
          const result=await env.DB.prepare("INSERT INTO offers (provider_ref,title,title_en,title_ro,description,description_en,description_ro,price_cents,currency,available_times,meeting_point_name,meeting_point_name_en,meeting_point_name_ro,meeting_address,meeting_city,meeting_country,meeting_instructions,meeting_instructions_en,meeting_instructions_ro,arrival_minutes_before,category,image_url,gallery_urls,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)").bind(providerRef,title,String(body.titleEn||"").trim()||null,String(body.titleRo||"").trim()||null,String(body.description||"").trim()||null,String(body.descriptionEn||"").trim()||null,String(body.descriptionRo||"").trim()||null,priceCents,String(body.currency||"eur").toLowerCase(),String(body.availableTimes||"").trim()||null,String(body.meetingPointName||"").trim()||null,String(body.meetingPointNameEn||"").trim()||null,String(body.meetingPointNameRo||"").trim()||null,String(body.meetingAddress||"").trim()||null,String(body.meetingCity||"").trim()||null,String(body.meetingCountry||"").trim()||null,String(body.meetingInstructions||"").trim()||null,String(body.meetingInstructionsEn||"").trim()||null,String(body.meetingInstructionsRo||"").trim()||null,Number.isInteger(Number(body.arrivalMinutesBefore))?Number(body.arrivalMinutesBefore):null,String(body.category||"explore").trim().toLowerCase()||"explore",String(body.imageUrl||"").trim()||null,String(body.galleryUrls||"").trim()||null).run();
          const offer=await env.DB.prepare("SELECT * FROM offers WHERE id=? LIMIT 1").bind(result.meta?.last_row_id).first();
          return json({success:true,offer},201,corsHeaders);
        }
        if(request.method==="DELETE"){
          const id=Number(body.id);
          if(!Number.isInteger(id)||id<=0)return json({error:"Ungültige Angebots-ID."},400,corsHeaders);
          const current=await env.DB.prepare("SELECT id,title,provider_ref,active FROM offers WHERE id=? LIMIT 1").bind(id).first();
          if(!current)return json({error:"Angebot nicht gefunden."},404,corsHeaders);
          const provider=await env.DB.prepare("SELECT name FROM providers WHERE provider_ref=? LIMIT 1")
            .bind(String(current.provider_ref||"")).first();
          const booking=await env.DB.prepare(
            "SELECT booking_id FROM bookings WHERE experience_name=? AND provider_name=? LIMIT 1"
          ).bind(String(current.title||""),String(provider?.name||"")).first();
          if(booking){
            await env.DB.prepare(
              "UPDATE offers SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?"
            ).bind(id).run();
            return json({
              success:true,
              deleted:false,
              deactivated:true,
              message:"Dieses Inserat ist mit einer bestehenden Buchung verknüpft und wurde deshalb nur deaktiviert."
            },200,corsHeaders);
          }
          await env.DB.prepare("DELETE FROM offers WHERE id=?").bind(id).run();
          return json({success:true,deleted:true,deactivated:false,offer_id:id},200,corsHeaders);
        }
        if(request.method==="PATCH"){
          const id=Number(body.id); if(!Number.isInteger(id)||id<=0)return json({error:"Ungültige Angebots-ID."},400,corsHeaders);
          const current=await env.DB.prepare("SELECT * FROM offers WHERE id=? LIMIT 1").bind(id).first(); if(!current)return json({error:"Angebot nicht gefunden."},404,corsHeaders);
          const providerRef=String(body.providerRef || current.provider_ref || "").trim();
          const title=String(body.title || current.title || "").trim();
          const rawPriceCents=body.priceCents;
          const parsedPriceCents=Number(rawPriceCents);
          const priceCents=Number.isFinite(parsedPriceCents) ? Math.round(parsedPriceCents) : Number(current.price_cents);
          const active=body.active===undefined?Number(current.active)!==0:(body.active===true||body.active===1||body.active==="1");
          if(!providerRef)return json({error:"Veranstalter fehlt."},400,corsHeaders); if(!title)return json({error:"Titel fehlt."},400,corsHeaders); if(!Number.isInteger(priceCents)||priceCents<50)return json({error:"Ungültiger Preis: "+String(body.priceCents)},400,corsHeaders);
          const translated = body.autoTranslate === true ? await translateOfferFields(body) : null;
          if (translated) Object.assign(body, translated);
          await env.DB.prepare("UPDATE offers SET provider_ref=?,title=?,title_en=?,title_ro=?,description=?,description_en=?,description_ro=?,price_cents=?,currency=?,available_times=?,meeting_point_name=?,meeting_point_name_en=?,meeting_point_name_ro=?,meeting_address=?,meeting_city=?,meeting_country=?,meeting_instructions=?,meeting_instructions_en=?,meeting_instructions_ro=?,arrival_minutes_before=?,category=?,image_url=?,gallery_urls=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(providerRef,title,String(body.titleEn ?? current.title_en ?? "").trim()||null,String(body.titleRo ?? current.title_ro ?? "").trim()||null,String(body.description ?? current.description ?? "").trim()||null,String(body.descriptionEn ?? current.description_en ?? "").trim()||null,String(body.descriptionRo ?? current.description_ro ?? "").trim()||null,priceCents,String(body.currency ?? current.currency ?? "eur").toLowerCase(),String(body.availableTimes ?? current.available_times ?? "").trim()||null,String(body.meetingPointName ?? current.meeting_point_name ?? "").trim()||null,String(body.meetingPointNameEn ?? current.meeting_point_name_en ?? "").trim()||null,String(body.meetingPointNameRo ?? current.meeting_point_name_ro ?? "").trim()||null,String(body.meetingAddress ?? current.meeting_address ?? "").trim()||null,String(body.meetingCity ?? current.meeting_city ?? "").trim()||null,String(body.meetingCountry ?? current.meeting_country ?? "").trim()||null,String(body.meetingInstructions ?? current.meeting_instructions ?? "").trim()||null,String(body.meetingInstructionsEn ?? current.meeting_instructions_en ?? "").trim()||null,String(body.meetingInstructionsRo ?? current.meeting_instructions_ro ?? "").trim()||null,Number.isInteger(Number(body.arrivalMinutesBefore ?? current.arrival_minutes_before))?Number(body.arrivalMinutesBefore ?? current.arrival_minutes_before):null,String(body.category ?? current.category ?? "explore").trim().toLowerCase()||"explore",String(body.imageUrl ?? current.image_url ?? "").trim()||null,String(body.galleryUrls ?? current.gallery_urls ?? "").trim()||null,active?1:0,id).run();
          const offer=await env.DB.prepare("SELECT * FROM offers WHERE id=? LIMIT 1").bind(id).first();
          return json({success:true,offer},200,corsHeaders);
        }
        return json({error:"Method Not Allowed"},405,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }

    if (url.pathname === "/api/partner-login") {
      if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
      try{
        if(!env.DB)return json({error:"D1 database not configured"},500,corsHeaders);
        await ensurePartnersTable(env); await ensurePartnerAccountsTable(env); await ensurePartnerSessionsTable(env);
        const body=await request.json();
        const email=String(body.email||"").trim().toLowerCase();
        const password=String(body.password||"");
        if(!email||!password)return json({error:"E-Mail und Passwort sind erforderlich."},400,corsHeaders);
        const account=await env.DB.prepare("SELECT a.partner_ref,a.password_salt,a.password_hash,p.active FROM partner_accounts a JOIN partners p ON p.partner_ref=a.partner_ref WHERE lower(a.email)=? LIMIT 1").bind(email).first();
        if(!account||Number(account.active)!==1)return json({error:"E-Mail oder Passwort ist falsch."},401,corsHeaders);
        const candidate=await hashPassword(password,account.password_salt);
        if(candidate!==String(account.password_hash||""))return json({error:"E-Mail oder Passwort ist falsch."},401,corsHeaders);
        const session=await createPartnerSession(env,String(account.partner_ref));
        return new Response(JSON.stringify({success:true,partnerRef:String(account.partner_ref),sessionToken:session.raw}),{status:200,headers:{"Content-Type":"application/json",...corsHeaders,"Set-Cookie":partnerSessionCookie(session.raw)}});
      }catch(error){return json({error:error?.message||"Login fehlgeschlagen."},500,corsHeaders)}
    }

    if (url.pathname === "/api/partner-logout") {
      if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
      try{
        if(env.DB){
          await ensurePartnerSessionsTable(env);
          const cookie=String(request.headers.get("Cookie")||"");
          const match=cookie.match(/(?:^|;\s*)fiiviu_partner_session=([^;]+)/);
          if(match)await env.DB.prepare("DELETE FROM partner_sessions WHERE session_hash=?").bind(await hashText(decodeURIComponent(match[1]))).run();
        }
      }catch(_){}
      return new Response(JSON.stringify({success:true}),{status:200,headers:{"Content-Type":"application/json",...corsHeaders,"Set-Cookie":partnerSessionCookie("",0)}});
    }

    if (url.pathname === "/api/partner-stats") {
      if(request.method!=="GET")return json({error:"Method Not Allowed"},405,corsHeaders);
      try{
        const requestedRef=url.searchParams.get("ref")?.trim()||"";
        if(isAdmin(request,env)){
          if(!requestedRef)return json({error:"Partner-Code fehlt"},400,corsHeaders);
          return json(await getPartnerStats(env,requestedRef),200,corsHeaders);
        }
        const authenticatedRef=await authenticatePartner(request,env);
        if(!authenticatedRef)return json({error:"Unauthorized"},401,corsHeaders);
        if(requestedRef&&authenticatedRef!==requestedRef)return json({error:"Unauthorized"},401,corsHeaders);
        return json(await getPartnerStats(env,authenticatedRef),200,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }

    if (url.pathname === "/api/admin/partner-password") {
      if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
      if(!env.ADMIN_PAYOUT_KEY)return json({error:"Admin key not configured"},500,corsHeaders);
      if(!isAdmin(request,env))return json({error:"Unauthorized"},401,corsHeaders);
      try{
        await ensurePartnersTable(env); await ensurePartnerAccountsTable(env);
        const body=await request.json();
        const partnerRef=String(body.partnerRef||"").trim().toUpperCase();
        if(!partnerRef)return json({error:"Partner-Code fehlt"},400,corsHeaders);
        const partner=await env.DB.prepare("SELECT partner_ref,contact_email,active FROM partners WHERE partner_ref=? LIMIT 1").bind(partnerRef).first();
        if(!partner)return json({error:"Partner nicht gefunden"},404,corsHeaders);
        if(Number(partner.active)!==1)return json({error:"Dieser Partner ist deaktiviert."},400,corsHeaders);
        const submittedEmail=String(body.email||body.contactEmail||"").trim().toLowerCase();
        const storedEmail=String(partner.contact_email||"").trim().toLowerCase();
        const email=submittedEmail||storedEmail;
        if(submittedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail))return json({error:"Bitte eine gültige E-Mail-Adresse eingeben."},400,corsHeaders);
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Für diesen Partner muss zuerst eine gültige E-Mail-Adresse hinterlegt werden."},400,corsHeaders);
        if(submittedEmail && submittedEmail!==storedEmail){
          await env.DB.prepare("UPDATE partners SET contact_email=? WHERE partner_ref=?").bind(submittedEmail,partnerRef).run();
        }
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Für diesen Partner muss zuerst eine gültige E-Mail-Adresse hinterlegt werden."},400,corsHeaders);
        const password=generateTemporaryPassword();
        const salt=randomHex(16), passwordHash=await hashPassword(password,salt);
        const existing=await env.DB.prepare("SELECT partner_ref FROM partner_accounts WHERE lower(email)=? AND partner_ref!=? LIMIT 1").bind(email,partnerRef).first();
        if(existing)return json({error:"Diese E-Mail-Adresse ist bereits einem anderen Partner zugeordnet."},409,corsHeaders);
        await env.DB.prepare("INSERT INTO partner_accounts (partner_ref,email,password_salt,password_hash,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(partner_ref) DO UPDATE SET email=excluded.email,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=CURRENT_TIMESTAMP").bind(partnerRef,email,salt,passwordHash).run();
        if(!env.EMAIL)return json({error:"E-Mail-Versand ist noch nicht konfiguriert.",partnerRef,email},500,corsHeaders);
        await sendPartnerLoginEmail(env,{email,partnerRef,password,loginUrl:"https://fiiviu.ro/partner.html"});
        return json({success:true,partnerRef,email,emailSent:true,temporaryPassword:password,loginUrl:"/partner.html"},200,corsHeaders);
      }catch(error){return json({error:error?.message||"Login-Zugang konnte nicht erzeugt werden."},500,corsHeaders)}
    }

    if (url.pathname === "/api/admin/partner-token") {
      if(request.method!=="POST")return json({error:"Method Not Allowed"},405,corsHeaders);
      if(!env.ADMIN_PAYOUT_KEY)return json({error:"Admin key not configured"},500,corsHeaders);
      if(!isAdmin(request,env))return json({error:"Unauthorized"},401,corsHeaders);
      try{
        await ensurePartnersTable(env);
        await ensurePartnerAuthTable(env);
        const body=await request.json();
        const partnerRef=String(body.partnerRef||"").trim().toUpperCase();
        if(!partnerRef)return json({error:"Partner-Code fehlt"},400,corsHeaders);
        const partner=await env.DB.prepare("SELECT partner_ref,active FROM partners WHERE partner_ref=? LIMIT 1").bind(partnerRef).first();
        if(!partner)return json({error:"Partner nicht gefunden"},404,corsHeaders);
        if(Number(partner.active)!==1)return json({error:"Dieser Partner ist deaktiviert."},400,corsHeaders);
        const token=generatePartnerToken();
        const tokenHash=await hashPartnerToken(token);
        await env.DB.prepare("INSERT INTO partner_auth_tokens (partner_ref,token_hash,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(partner_ref) DO UPDATE SET token_hash=excluded.token_hash,updated_at=CURRENT_TIMESTAMP").bind(partnerRef,tokenHash).run();
        return json({success:true,partnerRef,dashboardUrl:"/partner.html?ref="+encodeURIComponent(partnerRef)+"#token="+token,token},200,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
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
        if(openCommissionCents<0)return json({error:"Für diesen Partner besteht aktuell ein negativer Provisionssaldo durch Rückerstattungen nach früheren Auszahlungen.",openCommission:stats.openCommission,paidCommission:stats.paidCommission,pendingCommission:stats.pendingCommission},400,corsHeaders);
        if(amountCents>openCommissionCents)return json({error:"Auszahlung ist höher als die aktuell auszahlbare Provision.",openCommission:stats.openCommission,pendingCommission:stats.pendingCommission,requestedAmount:amountCents/100},400,corsHeaders);
        if(reference){const existing=await env.DB.prepare("SELECT id FROM partner_payouts WHERE partner_ref = ? AND reference = ? LIMIT 1").bind(bodyPartnerRef,reference).first();if(existing)return json({error:"Diese Auszahlungsreferenz existiert bereits."},409,corsHeaders)}
        const result=await env.DB.prepare("INSERT INTO partner_payouts (partner_ref,amount_cents,payout_date,status,reference) VALUES (?,?,?,'paid',?)").bind(bodyPartnerRef,amountCents,payoutDate,reference||null).run(); const updatedStats=await getPartnerStats(env,bodyPartnerRef);
        return json({success:true,payoutId:result.meta?.last_row_id||null,partnerRef:bodyPartnerRef,amount:amountCents/100,payoutDate,reference:reference||null,openCommission:updatedStats.openCommission,pendingCommission:updatedStats.pendingCommission,paidCommission:updatedStats.paidCommission},201,corsHeaders);
      }catch(error){return json({error:error?.message||"Server error"},500,corsHeaders)}
    }
    return env.ASSETS.fetch(request);
  }
};

async function translateOfferText(text, target) {
  const source = String(text || "").trim();
  if (!source) return "";
  const common = {
    "ro": {
      "Vor dem Haus": "În fața casei",
      "Vor dem Cafe": "În fața cafenelei",
      "Bitte an wetterfeste Kleidung denken": "Vă rugăm să purtați îmbrăcăminte adecvată vremii",
      "Bitte einfach nur gute Laune mitbringen!": "Vă rugăm să aduceți doar voie bună!",
      "Das ist ein Test und hat keine Bedeutung.": "Acesta este un test și nu are nicio semnificație.",
      "Test erlebnis bukarest": "Experiență de test în București",
      "Erkunde bei unserer Tour die schönsten Sehenswürdigkeiten und Orte, die die Stadt zu bieten hat. Dauer: ca. 3 Stunden": "Descoperă în turul nostru cele mai frumoase obiective și locuri pe care le oferă orașul. Durată: aproximativ 3 ore"
    },
    "en": {
      "Vor dem Haus": "In front of the house",
      "Vor dem Cafe": "In front of the cafe",
      "Bitte an wetterfeste Kleidung denken": "Please remember to wear weather-appropriate clothing",
      "Bitte einfach nur gute Laune mitbringen!": "Please just bring a good mood!",
      "Das ist ein Test und hat keine Bedeutung.": "This is a test and has no meaning.",
      "Test erlebnis bukarest": "Test experience in Bucharest",
      "Erkunde bei unserer Tour die schönsten Sehenswürdigkeiten und Orte, die die Stadt zu bieten hat. Dauer: ca. 3 Stunden": "Explore the most beautiful sights and places the city has to offer on our tour. Duration: approx. 3 hours"
    }
  };
  if (common[target]?.[source]) return common[target][source];

  const encoded = encodeURIComponent(source);

  // Provider 1: MyMemory
  try {
    const url = "https://api.mymemory.translated.net/get?q=" + encoded + "&langpair=de|" + encodeURIComponent(target);
    const response = await fetch(url, { headers: { "Accept": "application/json" }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (response.ok) {
      const data = await response.json();
      const translated = String(data?.responseData?.translatedText || "").trim();
      if (translated && translated !== source && !/^MYMEMORY/i.test(translated)) return translated;
    }
  } catch (_) {}

  // Provider 2: LibreTranslate public mirrors. Cloudflare Workers can call
  // third-party HTTP APIs directly from the request handler.
  const mirrors = [
    "https://translate.argosopentech.com/translate",
    "https://libretranslate.de/translate"
  ];
  for (const endpoint of mirrors) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ q: source, source: "de", target, format: "text" }),
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (response.ok) {
        const data = await response.json();
        const translated = String(data?.translatedText || "").trim();
        if (translated && translated !== source) return translated;
      }
    } catch (_) {}
  }

  // Provider 3: Google Translate endpoint as a final fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const googleUrl = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=" + encodeURIComponent(target) + "&dt=t&q=" + encoded;
      const response = await fetch(googleUrl, { headers: { "Accept": "application/json" }, cf: { cacheTtl: 0, cacheEverything: false } });
      if (response.ok) {
        const data = await response.json();
        const translated = Array.isArray(data?.[0])
          ? data[0].map(part => Array.isArray(part) ? String(part[0] || "") : "").join("").trim()
          : "";
        if (translated && translated !== source) return translated;
      }
    } catch (_) {}
  }

  // Never silently store German as an "EN/RO translation".
  return "";
}
async function translateOfferFields(source, options = {}) {
  const force = options.force === true;
  const title = String(source.title || "").trim();
  const description = String(source.description || "").trim();
  const meetingPointName = String(source.meetingPointName || source.meeting_point_name || "").trim();
  const meetingInstructions = String(source.meetingInstructions || source.meeting_instructions || "").trim();

  // If the admin/provider already supplied EN/RO text, use it directly.
  // Translation is only a fallback for fields that are still empty.
  let titleEn = force ? "" : String(source.titleEn || source.title_en || "").trim();
  let titleRo = force ? "" : String(source.titleRo || source.title_ro || "").trim();
  let descriptionEn = force ? "" : String(source.descriptionEn || source.description_en || "").trim();
  let descriptionRo = force ? "" : String(source.descriptionRo || source.description_ro || "").trim();
  let pointEn = force ? "" : String(source.meetingPointNameEn || source.meeting_point_name_en || "").trim();
  let pointRo = force ? "" : String(source.meetingPointNameRo || source.meeting_point_name_ro || "").trim();
  let instructionsEn = force ? "" : String(source.meetingInstructionsEn || source.meeting_instructions_en || "").trim();
  let instructionsRo = force ? "" : String(source.meetingInstructionsRo || source.meeting_instructions_ro || "").trim();

  const jobs = [];
  if (title && !titleEn) jobs.push(translateOfferText(title, "en").then(v => { titleEn = v; }));
  if (title && !titleRo) jobs.push(translateOfferText(title, "ro").then(v => { titleRo = v; }));
  if (description && !descriptionEn) jobs.push(translateOfferText(description, "en").then(v => { descriptionEn = v; }));
  if (description && !descriptionRo) jobs.push(translateOfferText(description, "ro").then(v => { descriptionRo = v; }));
  if (meetingPointName && !pointEn) jobs.push(translateOfferText(meetingPointName, "en").then(v => { pointEn = v; }));
  if (meetingPointName && !pointRo) jobs.push(translateOfferText(meetingPointName, "ro").then(v => { pointRo = v; }));
  if (meetingInstructions && !instructionsEn) jobs.push(translateOfferText(meetingInstructions, "en").then(v => { instructionsEn = v; }));
  if (meetingInstructions && !instructionsRo) jobs.push(translateOfferText(meetingInstructions, "ro").then(v => { instructionsRo = v; }));
  await Promise.all(jobs);

  // A translation service being temporarily unavailable must never block saving.
  // The original text is used only when no translated text was supplied or returned.
  return {
    titleEn: titleEn || title,
    titleRo: titleRo || title,
    descriptionEn: descriptionEn || description,
    descriptionRo: descriptionRo || description,
    meetingPointNameEn: pointEn || meetingPointName,
    meetingPointNameRo: pointRo || meetingPointName,
    meetingInstructionsEn: instructionsEn || meetingInstructions,
    meetingInstructionsRo: instructionsRo || meetingInstructions
  };
}


async function ensureOffersTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(offers)").all();
  const required=["provider_ref","title","description","price_cents","currency","available_times","meeting_point_name","meeting_address","meeting_city","meeting_country","meeting_instructions","arrival_minutes_before","title_en","title_ro","description_en","description_ro","meeting_point_name_en","meeting_point_name_ro","meeting_instructions_en","meeting_instructions_ro","image_url","gallery_urls","category","active"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Offers schema is incomplete: "+missing.join(", "));
}
async function sendPartnerLoginEmail(env,{email,partnerRef,password,loginUrl}){
  const safe=(value)=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const subject="Accesul dumneavoastră de partener FiiViu";
  const text=[
    "Bun venit la FiiViu.",
    "",
    "Accesul dumneavoastră de partener a fost configurat.",
    "Cod partener: "+partnerRef,
    "E-Mail: "+email,
    "Parolă temporară: "+password,
    "",
    "Login: "+loginUrl,
    "",
    "Vă rugăm să păstrați parola temporară într-un loc sigur.",
    "Cu stimă,",
    "FiiViu"
  ].join("\n");
  const html=`<!doctype html><html lang="de"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#222">
    <h2>Ihr FiiViu Partner-Zugang</h2>
    <p>Bun venit la FiiViu. Accesul dumneavoastră de partener a fost configurat.</p>
    <p><strong>Cod partener:</strong> ${safe(partnerRef)}<br>
    <strong>E-Mail:</strong> ${safe(email)}<br>
    <strong>Parolă temporară:</strong> ${safe(password)}</p>
    <p><a href="${safe(loginUrl)}" style="display:inline-block;padding:12px 18px;background:#d95d1f;color:#fff;text-decoration:none;border-radius:6px">Autentificare partener</a></p>
    <p>Link de autentificare: ${safe(loginUrl)}</p>
    <p>Vă rugăm să păstrați parola temporară într-un loc sigur.</p>
    <p>Cu stimă,<br>FiiViu</p>
  </body></html>`;
  await env.EMAIL.send({
    from:"noreply@fiiviu.ro",
    to:email,
    subject,
    text,
    html
  });
}

function isAdmin(request,env){return request.headers.get("Authorization")==="Bearer "+env.ADMIN_PAYOUT_KEY}
async function ensurePartnerTrackingTable(env){
  for(const [table,required] of [["partner_scan_events",["partner_ref","created_at"]],["partner_visitors",["partner_ref","visitor_id","first_seen_at","last_seen_at"]]]){
    const rows=await env.DB.prepare("PRAGMA table_info("+table+")").all();
    const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
    const missing=required.filter(name=>!existing.has(name));
    if(missing.length)throw new Error("Partner tracking schema is incomplete: "+table+" missing "+missing.join(", "));
  }
}
async function ensurePartnersTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(partners)").all();
  const required=["name","type","partner_ref","contact_name","contact_email","active"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Partners schema is incomplete: "+missing.join(", "));
}
async function ensurePartnerAuthTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(partner_auth_tokens)").all();
  const required=["partner_ref","token_hash","created_at","updated_at"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Partner auth schema is incomplete: "+missing.join(", "));
}
function generatePartnerToken(){
  const bytes=new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashPartnerToken(token){
  const data=new TextEncoder().encode(String(token||""));
  const digest=await crypto.subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function ensurePartnerAccountsTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(partner_accounts)").all();
  const required=["partner_ref","email","password_salt","password_hash"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Partner account schema is incomplete: "+missing.join(", "));
}
async function ensurePartnerSessionsTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(partner_sessions)").all();
  const required=["partner_ref","session_hash","expires_at"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Partner session schema is incomplete: "+missing.join(", "));
}
function randomHex(bytesLength=32){
  const bytes=new Uint8Array(bytesLength); crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashText(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||"")));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashPassword(password,salt){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password||"")),{name:"PBKDF2"},false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:new TextEncoder().encode(String(salt||"")),iterations:100000,hash:"SHA-256"},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,"0")).join("");
}
function generateTemporaryPassword(){
  return randomHex(9);
}
async function createPartnerSession(env,partnerRef){
  await ensurePartnerSessionsTable(env);
  const raw=randomHex(32), hash=await hashText(raw);
  const expires=Math.floor(Date.now()/1000)+60*60*24*30;
  await env.DB.prepare("DELETE FROM partner_sessions WHERE partner_ref=? OR expires_at<?").bind(partnerRef,Math.floor(Date.now()/1000)).run();
  await env.DB.prepare("INSERT INTO partner_sessions (partner_ref,session_hash,expires_at) VALUES (?,?,?)").bind(partnerRef,hash,expires).run();
  return {raw,expires};
}
async function authenticatePartner(request,env){
  if(!env.DB)return null;
  await ensurePartnerSessionsTable(env);
  const cookie=String(request.headers.get("Cookie")||"");
  const match=cookie.match(/(?:^|;\s*)fiiviu_partner_session=([^;]+)/);
  const bearer=String(request.headers.get("Authorization")||"");
  const bearerMatch=bearer.match(/^Bearer\s+(.+)$/i);
  const session=bearerMatch?String(bearerMatch[1]).trim():(match?decodeURIComponent(match[1]):"");
  if(!session)return null;
  const hash=await hashText(session);
  const partner=await env.DB.prepare("SELECT p.partner_ref,p.active FROM partner_sessions s JOIN partners p ON p.partner_ref=s.partner_ref WHERE s.session_hash=? AND s.expires_at>? LIMIT 1").bind(hash,Math.floor(Date.now()/1000)).first();
  if(!partner||Number(partner.active)!==1)return null;
  return String(partner.partner_ref||"");
}
function partnerSessionCookie(value,maxAge=2592000){
  return "fiiviu_partner_session="+encodeURIComponent(value)+"; Path=/; Domain=fiiviu.ro; Max-Age="+maxAge+"; HttpOnly; Secure; SameSite=Lax";
}
async function ensurePayoutsTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(partner_payouts)").all();
  const required=["partner_ref","amount_cents","payout_date","status","reference"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Partner payout schema is incomplete: "+missing.join(", "));
}
async function ensureBookingSettlementsTable(env){
  const rows=await env.DB.prepare("PRAGMA table_info(booking_settlements)").all();
  const required=["booking_id","payment_intent_id","total_amount_cents","provider_amount_cents","fiiviu_amount_cents","partner_amount_cents","partner_ref","settlement_status"];
  const existing=new Set((rows.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("Booking settlement schema is incomplete: "+missing.join(", "));
}
async function generatePartnerRef(env,name){const base=name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g,"").slice(0,8)||"PARTNER";for(let i=1;i<1000;i++){const candidate=base.slice(0,12)+String(i).padStart(3,"0");const existing=await env.DB.prepare("SELECT id FROM partners WHERE partner_ref = ? LIMIT 1").bind(candidate).first();if(!existing)return candidate}throw new Error("Kein freier Partner-Code verfügbar.")}
function buildPartnerLink(partnerRef){return "https://fiiviu.ro/?ref="+encodeURIComponent(partnerRef)}
function buildQrUrl(partnerRef){return "https://api.qrserver.com/v1/create-qr-code/?size=500x500&data="+encodeURIComponent(buildPartnerLink(partnerRef))}

function getBookingEventTimestamp(dateValue,timeValue){
  const date=String(dateValue||"").trim();
  const time=String(timeValue||"").trim();
  const match=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch=time.match(/^(\d{1,2}):(\d{2})/);
  if(!match||!timeMatch)return null;
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  const hour=Number(timeMatch[1]);
  const minute=Number(timeMatch[2]);
  if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day)||!Number.isInteger(hour)||!Number.isInteger(minute))return null;
  const wallUtc=Date.UTC(year,month-1,day,hour,minute,0);
  if(!Number.isFinite(wallUtc))return null;
  const getOffsetMs=(timestamp)=>{
    const parts=new Intl.DateTimeFormat("en-US",{
      timeZone:"Europe/Bucharest",
      year:"numeric",month:"2-digit",day:"2-digit",
      hour:"2-digit",minute:"2-digit",second:"2-digit",
      hourCycle:"h23"
    }).formatToParts(new Date(timestamp));
    const values={};
    for(const part of parts)if(part.type!=="literal")values[part.type]=Number(part.value);
    const localAsUtc=Date.UTC(values.year,values.month-1,values.day,values.hour,values.minute,values.second);
    return localAsUtc-timestamp;
  };
  let utc=wallUtc-getOffsetMs(wallUtc);
  utc=wallUtc-getOffsetMs(utc);
  return Math.floor(utc/1000);
}

function getPartnerHoldDays(env){const value=Number(env.PARTNER_COMMISSION_HOLD_DAYS??14);return Number.isFinite(value)?Math.max(0,Math.min(Math.floor(value),90)):14}
async function getPartnerStats(env,partnerRef){
  if(!env.STRIPE_SECRET_KEY)throw new Error("Stripe secret not configured");
  if(env.DB)await ensurePartnerTrackingTable(env);
  const payments=await searchPartnerPayments(env,partnerRef);
  const successful=payments.filter(payment=>payment.status==="succeeded");
  const holdDays=getPartnerHoldDays(env);
  const cutoff=Math.floor(Date.now()/1000)-(holdDays*86400);
  let revenueCents=0;
  let availableCommissionCents=0;
  let pendingCommissionCents=0;
  const bookingDetails=[];
  for(const payment of successful){
    const receivedCents=Number(payment.amount_received||payment.amount||0);
    const refundedCents=await getSuccessfulRefundAmount(env,payment.id);
    const netCents=Math.max(receivedCents-refundedCents,0);
    const bookingCommissionCents=Math.round(netCents*0.05);
    const bookingDate=String(payment.metadata?.booking_date||"").trim();
    const bookingTime=String(payment.metadata?.booking_time||"").trim();
    const eventTimestamp=getBookingEventTimestamp(bookingDate,bookingTime);
    const commissionAvailable=eventTimestamp!==null
      ? Math.floor(Date.now()/1000)>=eventTimestamp
      : false;
    revenueCents+=netCents;
    if(commissionAvailable)availableCommissionCents+=bookingCommissionCents;else pendingCommissionCents+=bookingCommissionCents;
    bookingDetails.push({
      paymentIntentId:payment.id,
      bookingId:payment.metadata?.booking_id||payment.id,
      tourName:payment.metadata?.tour_name||"Buchung",
      guests:Number(payment.metadata?.guests||1),
      amount:receivedCents/100,
      refunded:refundedCents/100,
      netAmount:netCents/100,
      commission:bookingCommissionCents/100,
      commissionStatus:commissionAvailable?"available":"pending",
      commissionAvailableAt:eventTimestamp===null?null:new Date(eventTimestamp*1000).toISOString(),
      bookingDate,
      bookingTime,
      currency:String(payment.currency||"eur").toLowerCase(),
      created:Number(payment.created||0)
    });
  }
  bookingDetails.sort((a,b)=>b.created-a.created);
  const commissionCents=Math.round(revenueCents*0.05);
  let paidCents=0;
  if(env.DB){
    await ensurePayoutsTable(env);
    const payoutResult=await env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM partner_payouts WHERE partner_ref = ? AND status = 'paid'").bind(partnerRef).first();
    paidCents=Number(payoutResult?.paid_cents||0);
  }
  const openCommissionCents=availableCommissionCents-paidCents;
  let scanCount=0;
  let uniqueVisitors=0;
  if(env.DB){
    const scanResult=await env.DB.prepare("SELECT COUNT(*) AS scan_count FROM partner_scan_events WHERE partner_ref=?").bind(partnerRef).first();
    scanCount=Number(scanResult?.scan_count||0);
    const visitorResult=await env.DB.prepare("SELECT COUNT(*) AS visitor_count FROM partner_visitors WHERE partner_ref=?").bind(partnerRef).first();
    uniqueVisitors=Number(visitorResult?.visitor_count||0);
  }
  return{partnerRef,bookings:successful.length,revenue:revenueCents/100,commission:commissionCents/100,openCommission:openCommissionCents/100,availableCommission:availableCommissionCents/100,pendingCommission:pendingCommissionCents/100,paidCommission:paidCents/100,holdDays,scanCount,uniqueVisitors,currency:"eur",bookingDetails};
}
async function searchPartnerPayments(env,partnerRef){const allPayments=[];let page="";for(let i=0;i<100;i++){const query="metadata['partner_ref']:"+"'"+partnerRef.replace(/'/g,"\\'")+"'";const stripeUrl="https://api.stripe.com/v1/payment_intents/search?query="+encodeURIComponent(query)+"&limit=100"+(page?"&page="+encodeURIComponent(page):"");const stripeResponse=await fetch(stripeUrl,{method:"GET",headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY}});const data=await stripeResponse.json();if(!stripeResponse.ok)throw new Error(data?.error?.message||"Stripe error");allPayments.push(...(data.data||[]));if(!data.next_page)break;page=data.next_page}return allPayments}
async function getSuccessfulRefundAmount(env,paymentIntentId){let refundedCents=0;let startingAfter="";for(let i=0;i<100;i++){let stripeUrl="https://api.stripe.com/v1/refunds?payment_intent="+encodeURIComponent(paymentIntentId)+"&limit=100";if(startingAfter)stripeUrl+="&starting_after="+encodeURIComponent(startingAfter);const stripeResponse=await fetch(stripeUrl,{method:"GET",headers:{"Authorization":"Bearer "+env.STRIPE_SECRET_KEY}});const data=await stripeResponse.json();if(!stripeResponse.ok)throw new Error(data?.error?.message||"Stripe refund lookup error");for(const refund of data.data||[])if(refund.status==="succeeded")refundedCents+=Number(refund.amount||0);if(!data.has_more||!(data.data||[]).length)break;startingAfter=data.data[data.data.length-1].id}return refundedCents}
function json(data,status,corsHeaders){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...corsHeaders}})}