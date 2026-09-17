import baseWorker from "./worker-entry.js";

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname.startsWith("/api/")) return response;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    const html = await response.text();
    const bridge = `<script src="/meeting-points.js"></script><script>
(function(){
  var labels={de:{meeting:'Treffpunkt',instructions:'Hinweis',arrival:'Bitte vor Beginn da sein',maps:'Auf Google Maps öffnen'},en:{meeting:'Meeting point',instructions:'Instructions',arrival:'Please arrive before the start',maps:'Open in Google Maps'},ro:{meeting:'Punct de întâlnire',instructions:'Instrucțiuni',arrival:'Te rugăm să ajungi înainte de începere',maps:'Deschide în Google Maps'}};
  function lang(){return (typeof currentLang!=='undefined'&&currentLang)?String(currentLang).slice(0,2):'en';}
  function getMeeting(){var m=window.__fiiviuMeetingPoint||{};try{if(!m.name&&typeof categoriesData!=='undefined'&&typeof currentCategoryKey!=='undefined'&&typeof currentTourKey!=='undefined'){var c=categoriesData[currentCategoryKey];var i=c&&c.items?c.items.find(function(x){return x.id===currentTourKey;}):null;if(i&&i.meetingPoint)m=i.meetingPoint;}}catch(_){}return m||{};}
  function mapsUrl(m){if(m.latitude&&m.longitude)return'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(m.latitude+','+m.longitude);var q=[m.name,m.address,m.city,m.country].filter(Boolean).join(', ');return q?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q):'';}
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(ch){return{'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[ch];});}
  function render(){var m=getMeeting();window.__fiiviuMeetingPoint=m;var has=!!(m.name||m.address||m.city||m.country||m.instructions);var old=document.getElementById('fiiviu-meeting-point-card');if(!has){if(old)old.classList.add('hidden');return;}var l=labels[lang()]||labels.en;var address=[m.address,m.city,m.country].filter(Boolean).join(', ');var map=mapsUrl(m);var card=old;if(!card){card=document.createElement('div');card.id='fiiviu-meeting-point-card';card.className='bg-white rounded-2xl border border-black/5 p-5 mt-6 shadow-sm';var anchor=document.getElementById('checkout-summary-date');if(anchor&&anchor.parentElement&&anchor.parentElement.parentElement)anchor.parentElement.parentElement.appendChild(card);else document.body.appendChild(card);}card.classList.remove('hidden');card.innerHTML='<div class="flex items-start gap-4"><div class="w-10 h-10 rounded-xl bg-orange-100 text-fii-orange flex items-center justify-center shrink-0"><i class="fa-solid fa-location-dot"></i></div><div class="min-w-0"><div class="text-xs font-black uppercase tracking-widest text-fii-orange">'+l.meeting+'</div><div class="font-black mt-1">'+esc(m.name||address||'')+'</div>'+(address?'<div class="text-sm text-gray-600 mt-1">'+esc(address)+'</div>':'')+(m.instructions?'<div class="text-sm text-gray-500 mt-2">'+esc(l.instructions)+': '+esc(m.instructions)+'</div>':'')+(m.arrivalMinutesBefore!=null&&m.arrivalMinutesBefore!==''?'<div class="text-sm text-gray-500 mt-2"><i class="fa-regular fa-clock mr-1"></i>'+esc(l.arrival)+' '+esc(String(m.arrivalMinutesBefore))+' min.</div>':'')+(map?'<a href="'+map+'" target="_blank" rel="noopener" class="inline-flex items-center gap-2 mt-3 text-sm font-bold text-fii-orange hover:underline"><i class="fa-solid fa-map"></i>'+l.maps+'</a>':'')+'</div></div>';}
  window.__fiiviuRefreshMeetingPoint=render;setInterval(render,500);document.addEventListener('DOMContentLoaded',render);
})();
</script>`;
    const marker="</body>";
    const output=html.includes(marker)?html.replace(marker,bridge+marker):html+bridge;
    const headers=new Headers(response.headers);headers.delete("content-length");headers.set("cache-control","no-cache");
    return new Response(output,{status:response.status,statusText:response.statusText,headers});
  }
};
