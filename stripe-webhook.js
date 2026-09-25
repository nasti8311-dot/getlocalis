const DEFAULT_TOLERANCE_SECONDS = 300;
export { calculateSettlementReleaseAt, parseBookingDateTime };
const PROVIDER_SHARE_PERCENT = 82.5;
const FIIVIU_SHARE_PERCENT = 12.5;
const PARTNER_SHARE_PERCENT = 5;
const CANCELLATION_HOURS = 24;
const BOOKING_TIME_ZONE = "Europe/Bucharest";

export async function handleStripeWebhook(request, env) {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  if (!env.STRIPE_WEBHOOK_SECRET) return webhookError("Stripe webhook secret not configured", 500);
  const signature = request.headers.get("Stripe-Signature");
  if (!signature) return webhookError("Missing Stripe-Signature", 400);
  const rawBody = await request.text();
  if (!await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, DEFAULT_TOLERANCE_SECONDS)) return webhookError("Invalid Stripe signature", 400);
  let event;
  try { event = JSON.parse(rawBody); } catch { return webhookError("Invalid JSON payload", 400); }
  if (!event?.id || !event?.type) return webhookError("Invalid Stripe event", 400);
  const stripeSecretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!stripeSecretKey) return webhookError("Stripe secret key not configured", 500);
  const configuredTestMode = stripeSecretKey.startsWith("sk_test_");
  const eventIsTestMode = event?.livemode === false;
  if (configuredTestMode !== eventIsTestMode) {
    console.error("Stripe webhook mode mismatch; event rejected", { configuredTestMode, eventIsTestMode });
    return webhookError("Stripe webhook mode mismatch", 400);
  }
  if (env.DB) {
    await ensureStripeWebhookEventsTable(env);
    await ensureBookingSettlementsTable(env);
    await ensureStripeRefundEventsTable(env);
    await ensureStripeTransferReversalEventsTable(env);
    await ensureStripePartnerReversalEventsTable(env);
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_webhook_events (event_id,event_type,created_at) VALUES (?,?,CURRENT_TIMESTAMP)"
    ).bind(event.id,event.type).run();
    if (Number(claim.meta?.changes || 0) !== 1) {
      return webhookJson({ received: true, duplicate: true });
    }
  }
  try {
    if (event.type === "payment_intent.succeeded") { await recordPaymentIntentEvent(env,event); await createBookingSettlement(env,event); }
    else if (event.type === "payment_intent.payment_failed") await recordPaymentIntentEvent(env,event);
    else if (["charge.refunded","charge.refund.updated","refund.created","refund.updated"].includes(event.type)) await recordRefundEvent(env,event);
  } catch(error) {
    if (env.DB) {
      try {
        await env.DB.prepare("DELETE FROM stripe_webhook_events WHERE event_id = ?").bind(event.id).run();
      } catch (_) {}
    }
    console.error("Stripe webhook processing failed",error);
    return webhookError(error?.message||"Webhook processing failed",500);
  }
  return webhookJson({received:true});
}

async function recordPaymentIntentEvent(env,event){if(!env.DB)return;await ensureStripePaymentEventsTable(env);const p=event.data?.object||{},m=p.metadata||{};await env.DB.prepare(`INSERT INTO stripe_payment_events (event_id,payment_intent_id,event_type,booking_id,partner_ref,amount,currency,payment_status,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(event_id) DO NOTHING`).bind(event.id,p.id||null,event.type,m.booking_id||null,m.partner_ref||null,Number(p.amount||0),p.currency||null,p.status||null).run();}
async function recordRefundEvent(env,event){if(!env.DB||!env.STRIPE_SECRET_KEY)return;const o=event.data?.object||{},chargeId=["charge.refunded","charge.refund.updated"].includes(event.type)?String(o.id||"").trim():String(o.charge||"").trim();if(!chargeId)throw new Error("Refund event is missing a valid charge ID");await syncChargeRefunds(env,chargeId);}
async function syncChargeRefunds(env,chargeId){let startingAfter="",paymentIntentId="",pages=0;while(pages<20){const params=new URLSearchParams({charge:chargeId,limit:"100"});if(startingAfter)params.set("starting_after",startingAfter);const response=await fetch(`https://api.stripe.com/v1/refunds?${params.toString()}`,{headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY}});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||"Stripe refund reconciliation failed");for(const refund of data.data||[]){const refundPaymentIntentId=String(refund.payment_intent||"").trim();if(refundPaymentIntentId)paymentIntentId=refundPaymentIntentId;if(!refund.id||!refundPaymentIntentId||!Number.isInteger(Number(refund.amount))||Number(refund.amount)<=0)continue;await env.DB.prepare(`INSERT INTO stripe_refund_events (refund_id,payment_intent_id,charge_id,amount,status,event_type,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(refund_id) DO UPDATE SET payment_intent_id=excluded.payment_intent_id,charge_id=excluded.charge_id,amount=excluded.amount,status=excluded.status,event_type=excluded.event_type`).bind(String(refund.id),refundPaymentIntentId,chargeId,Number(refund.amount),String(refund.status||"").trim(),"refund.reconciled").run();}if(!data.has_more||!data.data?.length)break;startingAfter=String(data.data[data.data.length-1].id||"");if(!startingAfter)break;pages++;}if(paymentIntentId)await applyRefundToSettlement(env,paymentIntentId);}
async function applyRefundToSettlement(env,paymentIntentId){const refundRow=await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS refunded_cents FROM stripe_refund_events WHERE payment_intent_id = ? AND status = 'succeeded'").bind(paymentIntentId).first();const refundedCents=Number(refundRow?.refunded_cents||0);const settlement=await env.DB.prepare("SELECT id,total_amount_cents,provider_amount_cents,provider_transfer_amount_cents,provider_transfer_id,partner_amount_cents,partner_ref,settlement_status FROM booking_settlements WHERE payment_intent_id = ? LIMIT 1").bind(paymentIntentId).first();if(!settlement)return;const totalCents=Number(settlement.total_amount_cents||0),providerTransferAmountCents=Number(settlement.provider_transfer_amount_cents||settlement.provider_amount_cents||0);if(totalCents<=0)return;const partnerAmountCents=Number(settlement.partner_amount_cents||0);if(partnerAmountCents>0){const targetPartnerReversal=Math.min(partnerAmountCents,Math.round(partnerAmountCents*Math.min(refundedCents,totalCents)/totalCents));const reversedPartnerRow=await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS reversed_cents FROM stripe_partner_reversal_events WHERE payment_intent_id = ? AND status = 'succeeded'").bind(paymentIntentId).first();const reversedPartner=Number(reversedPartnerRow?.reversed_cents||0);const partnerDelta=targetPartnerReversal-reversedPartner;if(partnerDelta>0)await recordPartnerReversal(env,paymentIntentId,settlement.partner_ref,partnerDelta);await env.DB.prepare("UPDATE booking_settlements SET partner_reversal_amount_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Math.min(partnerAmountCents,reversedPartner+Math.max(partnerDelta,0)),settlement.id).run();}
if(providerTransferAmountCents<=0||!settlement.provider_transfer_id){if(refundedCents>=totalCents)await env.DB.prepare("UPDATE booking_settlements SET settlement_status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();return;}const target=Math.min(providerTransferAmountCents,Math.round(providerTransferAmountCents*Math.min(refundedCents,totalCents)/totalCents));const reversedRow=await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS reversed_cents FROM stripe_transfer_reversal_events WHERE payment_intent_id = ? AND status = 'succeeded'").bind(paymentIntentId).first();const reversed=Number(reversedRow?.reversed_cents||0),delta=target-reversed;if(delta>0)await reverseProviderTransfer(env,settlement.provider_transfer_id,delta,paymentIntentId,refundedCents,totalCents);const newReversed=reversed+Math.max(delta,0);if(refundedCents>=totalCents&&newReversed>=providerTransferAmountCents)await env.DB.prepare("UPDATE booking_settlements SET settlement_status='refunded',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();else if(refundedCents>0)await env.DB.prepare("UPDATE booking_settlements SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(settlement.id).run();}
async function recordPartnerReversal(env,paymentIntentId,partnerRef,amountCents){if(!env.DB||!Number.isInteger(amountCents)||amountCents<=0)return;await env.DB.prepare("INSERT OR IGNORE INTO stripe_partner_reversal_events (reversal_id,payment_intent_id,partner_ref,amount,status,event_type,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(`partner-reversal-${paymentIntentId}-${amountCents}`,paymentIntentId,partnerRef||null,amountCents,"succeeded","partner.refund.reversal").run();}
async function reverseProviderTransfer(env,transferId,amountCents,paymentIntentId,refundedCents,totalCents){if(!env.STRIPE_SECRET_KEY||!transferId||!Number.isInteger(amountCents)||amountCents<=0)return;const params=new URLSearchParams();params.set("amount",String(amountCents));params.set("metadata[payment_intent_id]",paymentIntentId);params.set("metadata[settlement]","provider_refund_reversal");params.set("metadata[refunded_cents]",String(refundedCents));params.set("metadata[total_cents]",String(totalCents));const response=await fetch(`https://api.stripe.com/v1/transfers/${encodeURIComponent(transferId)}/reversals`,{method:"POST",headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`provider-reversal-${paymentIntentId}-${amountCents}`},body:params});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||"Stripe transfer reversal failed");await env.DB.prepare("INSERT OR IGNORE INTO stripe_transfer_reversal_events (reversal_id,payment_intent_id,transfer_id,amount,status,event_type,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(String(data.id),paymentIntentId,transferId,Number(data.amount||amountCents),"succeeded","transfer.reversed").run();}
async function getChargeBalanceTransaction(env,chargeId){if(!env.STRIPE_SECRET_KEY||!chargeId)return null;const response=await fetch(`https://api.stripe.com/v1/balance_transactions?${new URLSearchParams({source:String(chargeId),limit:"1"}).toString()}`,{headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY}});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||"Stripe balance transaction lookup failed");return data.data?.[0]||null;}
async function createBookingSettlement(env,event){if(!env.DB)return;await ensureBookingSettlementsTable(env);const paymentIntent=event.data?.object||{},metadata=paymentIntent.metadata||{},totalAmountCents=Number(paymentIntent.amount_received||paymentIntent.amount||0),bookingId=String(metadata.booking_id||paymentIntent.id||"").trim(),paymentIntentId=String(paymentIntent.id||"").trim();if(!bookingId||!paymentIntentId||!Number.isInteger(totalAmountCents)||totalAmountCents<=0)throw new Error("PaymentIntent is missing a valid booking or amount");const existing=await env.DB.prepare("SELECT id,provider_transfer_id,settlement_status FROM booking_settlements WHERE booking_id = ? OR payment_intent_id = ? LIMIT 1").bind(bookingId,paymentIntentId).first();if(existing?.provider_transfer_id||existing?.settlement_status==="transferred")return;let partnerRef=typeof metadata.partner_ref==="string"?metadata.partner_ref.trim():"";if(partnerRef){const partner=await env.DB.prepare("SELECT partner_ref FROM partners WHERE partner_ref = ? AND active = 1 LIMIT 1").bind(partnerRef).first();if(!partner)partnerRef="";}const partnerAmountCents=partnerRef?Math.round(totalAmountCents*PARTNER_SHARE_PERCENT/100):0,fiiviuAmountCents=partnerRef?Math.round(totalAmountCents*FIIVIU_SHARE_PERCENT/100):Math.round(totalAmountCents*(100-PROVIDER_SHARE_PERCENT)/100),providerBusinessAmountCents=totalAmountCents-fiiviuAmountCents-partnerAmountCents;if(providerBusinessAmountCents<0)throw new Error("Settlement amounts exceed payment amount");const providerConnectAccountId=String(metadata.provider_connect_account_id||"").trim();if(!/^acct_[A-Za-z0-9]+$/.test(providerConnectAccountId))throw new Error("PaymentIntent is missing a valid provider Connect account");let providerTransferId=existing?.provider_transfer_id||null,providerTransferAmountCents=null,providerTransferCurrency=null;const balanceTransaction=await getChargeBalanceTransaction(env,paymentIntent.latest_charge);if(!balanceTransaction?.currency||!Number.isInteger(Number(balanceTransaction.amount))||Number(balanceTransaction.amount)<=0)throw new Error("Stripe balance transaction is missing for provider transfer");providerTransferCurrency=String(balanceTransaction.currency).toLowerCase();providerTransferAmountCents=Math.round(Number(balanceTransaction.amount)*providerBusinessAmountCents/totalAmountCents);if(!Number.isInteger(providerTransferAmountCents)||providerTransferAmountCents<=0)throw new Error("Invalid provider transfer amount");const releaseAt=calculateSettlementReleaseAt(metadata.booking_date,metadata.booking_time);if(!releaseAt)throw new Error("Booking is missing a valid date/time for provider settlement");if(existing?.id){await env.DB.prepare("UPDATE booking_settlements SET payment_intent_id=?,total_amount_cents=?,provider_amount_cents=?,provider_transfer_amount_cents=?,provider_transfer_currency=?,fiiviu_amount_cents=?,partner_amount_cents=?,partner_ref=?,provider_transfer_id=NULL,settlement_status='pending',release_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(paymentIntentId,totalAmountCents,providerBusinessAmountCents,providerTransferAmountCents,providerTransferCurrency,fiiviuAmountCents,partnerAmountCents,partnerRef||null,releaseAt,existing.id).run();return;}await env.DB.prepare("INSERT INTO booking_settlements (booking_id,payment_intent_id,total_amount_cents,provider_amount_cents,provider_transfer_amount_cents,provider_transfer_currency,fiiviu_amount_cents,partner_amount_cents,partner_ref,provider_transfer_id,settlement_status,release_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,'pending',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(booking_id) DO UPDATE SET payment_intent_id=excluded.payment_intent_id,total_amount_cents=excluded.total_amount_cents,provider_amount_cents=excluded.provider_amount_cents,provider_transfer_amount_cents=excluded.provider_transfer_amount_cents,provider_transfer_currency=excluded.provider_transfer_currency,fiiviu_amount_cents=excluded.fiiviu_amount_cents,partner_amount_cents=excluded.partner_amount_cents,partner_ref=excluded.partner_ref,settlement_status=excluded.settlement_status,release_at=excluded.release_at,updated_at=CURRENT_TIMESTAMP").bind(bookingId,paymentIntentId,totalAmountCents,providerBusinessAmountCents,providerTransferAmountCents,providerTransferCurrency,fiiviuAmountCents,partnerAmountCents,partnerRef||null,releaseAt).run();
}

async function createProviderTransfer(env,{amountCents,currency,destination,bookingId,paymentIntentId,sourceTransaction}){if(!env.STRIPE_SECRET_KEY)throw new Error("Stripe secret not configured");if(!sourceTransaction)throw new Error("Provider transfer is missing source transaction");const params=new URLSearchParams();params.set("amount",String(amountCents));params.set("currency",currency);params.set("destination",destination);params.set("source_transaction",sourceTransaction);params.set("metadata[booking_id]",bookingId);params.set("metadata[payment_intent_id]",paymentIntentId);params.set("metadata[settlement]","provider_82_5_percent_fiiviu_12_5_partner_5");const response=await fetch("https://api.stripe.com/v1/transfers",{method:"POST",headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded","Idempotency-Key":`provider-transfer-${paymentIntentId}`},body:params});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||"Stripe transfer failed");return data;}
async function requireTableColumns(env,table,required){
  const rows=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1").bind(table).all();
  if(!(rows.results||[]).length)throw new Error("Required D1 table is missing: "+table);
  const columns=await env.DB.prepare("PRAGMA table_info("+table+")").all();
  const existing=new Set((columns.results||[]).map(row=>String(row.name||"")));
  const missing=required.filter(name=>!existing.has(name));
  if(missing.length)throw new Error("D1 table schema is incomplete: "+table+" missing "+missing.join(", "));
}
async function ensureStripeWebhookEventsTable(env){await requireTableColumns(env,"stripe_webhook_events",["event_id","event_type","created_at"]);}
async function ensureStripePaymentEventsTable(env){await requireTableColumns(env,"stripe_payment_events",["event_id","payment_intent_id","event_type","booking_id","partner_ref","amount","currency","payment_status","created_at"]);}
async function ensureStripeRefundEventsTable(env){await requireTableColumns(env,"stripe_refund_events",["refund_id","payment_intent_id","charge_id","amount","status","event_type","created_at"]);}
async function ensureStripeTransferReversalEventsTable(env){await requireTableColumns(env,"stripe_transfer_reversal_events",["reversal_id","payment_intent_id","transfer_id","amount","status","event_type","created_at"]);}
async function ensureStripePartnerReversalEventsTable(env){await requireTableColumns(env,"stripe_partner_reversal_events",["reversal_id","payment_intent_id","partner_ref","amount","status","event_type","created_at"]);}
async function ensureBookingSettlementsTable(env){await requireTableColumns(env,"booking_settlements",["booking_id","payment_intent_id","total_amount_cents","provider_amount_cents","fiiviu_amount_cents","provider_connect_account_id","provider_transfer_id","settlement_status","release_at","settlement_error","settlement_test_transfer_id"]);}
async function verifyStripeSignature(payload,header,secret,tolerance){const parts=header.split(","),timestampPart=parts.find(part=>part.startsWith("t=")),signatures=parts.filter(part=>part.startsWith("v1=")).map(part=>part.slice(3));if(!timestampPart||!signatures.length)return false;const timestamp=Number(timestampPart.slice(2));if(!Number.isInteger(timestamp)||Math.abs(Math.floor(Date.now()/1000)-timestamp)>tolerance)return false;const expected=await hmacSha256Hex(secret,`${timestamp}.${payload}`);return signatures.some(signature=>timingSafeEqualHex(signature,expected));}
async function hmacSha256Hex(secret,message){const encoder=new TextEncoder(),key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]),signature=await crypto.subtle.sign("HMAC",key,encoder.encode(message));return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
function timingSafeEqualHex(a,b){if(!/^[0-9a-f]+$/i.test(a)||!/^[0-9a-f]+$/i.test(b)||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function webhookError(message,status){return new Response(JSON.stringify({error:message}),{status,headers:{"Content-Type":"application/json"}})}
function webhookJson(data){return new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}})}

export async function releaseDueProviderSettlements(env){
  if(!env.DB||!env.STRIPE_SECRET_KEY)return {processed:0,transferred:0,tested:0};
  await ensureBookingSettlementsTable(env);
  const rows=await env.DB.prepare("SELECT * FROM booking_settlements WHERE settlement_status='pending' AND release_at IS NOT NULL AND release_at<=CURRENT_TIMESTAMP AND provider_transfer_id IS NULL AND settlement_test_transfer_id IS NULL ORDER BY id ASC LIMIT 50").all();
  let transferred=0,tested=0,processed=0;
  for(const candidate of rows.results||[]){
    const claim=await env.DB.prepare("UPDATE booking_settlements SET settlement_status='releasing',settlement_last_attempt_at=CURRENT_TIMESTAMP,settlement_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='pending' AND provider_transfer_id IS NULL AND settlement_test_transfer_id IS NULL").bind(candidate.id).run();
    if(Number(claim.meta?.changes||0)!==1)continue;
    processed++;
    const row=await env.DB.prepare("SELECT * FROM booking_settlements WHERE id=? LIMIT 1").bind(candidate.id).first();
    try{
      const settlementTotalCents=Number(row?.total_amount_cents||0);
      if(Number.isInteger(settlementTotalCents)&&settlementTotalCents>0){
        const partnerCents=Number(row?.partner_amount_cents||0);
        const fiiviuCents=partnerCents>0?Math.round(settlementTotalCents*FIIVIU_SHARE_PERCENT/100):Math.round(settlementTotalCents*(100-PROVIDER_SHARE_PERCENT)/100);
        const providerCents=settlementTotalCents-fiiviuCents-partnerCents;
        if(providerCents>0&&(Number(row.provider_amount_cents)!==providerCents||Number(row.fiiviu_amount_cents)!==fiiviuCents)){
          await env.DB.prepare("UPDATE booking_settlements SET provider_amount_cents=?,fiiviu_amount_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(providerCents,fiiviuCents,row.id).run();
        }
      }
      const pi=await stripeGetPaymentIntent(env,row.payment_intent_id);
      if(pi?.status!=="succeeded")throw new Error("PaymentIntent is not succeeded");
      const latestChargeId=String(pi?.latest_charge||"").trim();
      if(latestChargeId)await syncChargeRefunds(env,latestChargeId);
      const refundRow=await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS refunded_cents FROM stripe_refund_events WHERE payment_intent_id=? AND status='succeeded'").bind(String(row.payment_intent_id)).first();
      if(Number(refundRow?.refunded_cents||0)>0){
        await env.DB.prepare("UPDATE booking_settlements SET settlement_status='pending',settlement_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind("Refund detected before provider transfer; settlement held for refund reconciliation",row.id).run();
        continue;
      }
      const provider=String(pi?.metadata?.provider_connect_account_id||row.provider_connect_account_id||"").trim();
      if(!/^acct_[A-Za-z0-9]+$/.test(provider))throw new Error("Missing provider Connect account");
      if(provider!==String(row.provider_connect_account_id||"").trim())await env.DB.prepare("UPDATE booking_settlements SET provider_connect_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(provider,row.id).run();
      const totalCents=Number(row.total_amount_cents||0),partnerCents=Number(row.partner_amount_cents||0),fiiviuCents=partnerCents>0?Math.round(totalCents*FIIVIU_SHARE_PERCENT/100):Math.round(totalCents*(100-PROVIDER_SHARE_PERCENT)/100),providerBusinessCents=totalCents-fiiviuCents-partnerCents,transferCurrency=String(row.provider_transfer_currency||pi.currency||"eur").toLowerCase();
      const balanceTransaction=await getChargeBalanceTransaction(env,pi.latest_charge);
      if(!balanceTransaction?.currency||!Number.isInteger(Number(balanceTransaction.amount))||Number(balanceTransaction.amount)<=0)throw new Error("Stripe balance transaction is missing for provider transfer");
      const providerTransferAmountCents=Math.round(Number(balanceTransaction.amount)*providerBusinessCents/totalCents);
      if(!Number.isInteger(providerTransferAmountCents)||providerTransferAmountCents<=0)throw new Error("Invalid provider transfer amount");
      if(String(env.STRIPE_SECRET_KEY||"").startsWith("sk_test_")){
        const testTransferId="test_transfer_"+String(row.booking_id).replace(/[^A-Za-z0-9_-]/g,"_");
        await env.DB.prepare("UPDATE booking_settlements SET provider_amount_cents=?,fiiviu_amount_cents=?,provider_transfer_amount_cents=?,provider_transfer_currency=?,settlement_test_transfer_id=?,settlement_status='pending',settlement_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(providerBusinessCents,fiiviuCents,providerTransferAmountCents,transferCurrency,testTransferId,row.id).run();
        tested++;continue;
      }
      await env.DB.prepare("UPDATE booking_settlements SET provider_amount_cents=?,fiiviu_amount_cents=?,provider_transfer_amount_cents=?,provider_transfer_currency=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(providerBusinessCents,fiiviuCents,providerTransferAmountCents,transferCurrency,row.id).run();
      const transfer=await createProviderTransfer(env,{amountCents:providerTransferAmountCents,currency:transferCurrency,destination:provider,bookingId:String(row.booking_id),paymentIntentId:String(row.payment_intent_id),sourceTransaction:String(pi.latest_charge||"")});
      await env.DB.prepare("UPDATE booking_settlements SET provider_transfer_id=?,settlement_status='transferred',settlement_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(String(transfer.id),row.id).run();
      transferred++;
    }catch(error){
      const message=String(error?.message||error||"Unknown settlement error").slice(0,1000);
      try{await env.DB.prepare("UPDATE booking_settlements SET settlement_status='pending',settlement_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND settlement_status='releasing'").bind(message,row.id).run();}catch{}
      console.error("Due provider settlement failed",row.booking_id,message);
    }
  }
  return {processed,transferred,tested};
}
async function stripeGetPaymentIntent(env,id){const response=await fetch("https://api.stripe.com/v1/payment_intents/"+encodeURIComponent(id),{headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY}});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||"PaymentIntent lookup failed");return data;}
function calculateSettlementReleaseAt(dateValue,timeValue){const start=parseBookingDateTime(dateValue,timeValue);if(!start)return null;return start.toISOString().replace("T"," ").replace("Z","");}
function parseBookingDateTime(dateValue,timeValue){let date=String(dateValue||"").trim(),time=String(timeValue||"").trim();if(/^\d{2}\.\d{2}\.\d{4}$/.test(date)){const p=date.split(".");date=p[2]+"-"+p[1]+"-"+p[0];}if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,2}:\d{2}$/.test(time))return null;const [h,m]=time.padStart(5,"0").split(":").map(Number);const guess=Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10)),h,m);const parts=new Intl.DateTimeFormat("en-US",{timeZone:BOOKING_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));const offset=Date.UTC(Number(v.year),Number(v.month)-1,Number(v.day),Number(v.hour),Number(v.minute),Number(v.second))-guess;return new Date(guess-offset);}
