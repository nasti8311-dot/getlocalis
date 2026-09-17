import marketplaceWorker from "./marketplace-entry.js";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization"
};

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

    return marketplaceWorker.fetch(request,env,ctx);
  }
};
