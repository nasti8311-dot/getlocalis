import marketplaceWorker from "./marketplace-entry.js";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization"
};

const LEGACY_EXPERIENCE_IDS={
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

async function enrichLegacyCheckout(request){
  if(request.method!=="POST")return request;
  const url=new URL(request.url);
  if(url.pathname!=="/api/create-payment-intent")return request;
  try{
    const body=await request.clone().json();
    if(body&&typeof body==="object"&&!body.experienceId&&!body.tourKey&&!body.experienceKey&&!body.experience_id){
      const title=String(body.tourName||body.experienceName||"").split(" · ")[0].trim();
      const experienceId=LEGACY_EXPERIENCE_IDS[title]||"";
      if(experienceId){
        body.experienceId=experienceId;
        return new Request(request,{method:"POST",headers:request.headers,body:JSON.stringify(body)});
      }
    }
  }catch(_){ }
  return request;
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);

    // Partner statistics contain internal financial/booking data and are only
    // used by the admin UI. Do not expose them through the public API.
    if(url.pathname==="/api/partner-stats"){
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
      if(request.method!=="GET")return new Response(JSON.stringify({error:"Method Not Allowed"}),{status:405,headers:{...CORS,"Content-Type":"application/json"}});
      const expected=String(env.ADMIN_PAYOUT_KEY||"").trim();
      const provided=String(request.headers.get("Authorization")||"");
      if(!expected||provided!=="Bearer "+expected){
        return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{...CORS,"Content-Type":"application/json"}});
      }
    }

    const enriched=await enrichLegacyCheckout(request);
    return marketplaceWorker.fetch(enriched,env,ctx);
  }
};
