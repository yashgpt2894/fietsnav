/* ===================================================================
   FietsNav — personal bike navigation
   Routing: BRouter | Search: Photon | POIs: Overpass | Map: OSM/CyclOSM
   =================================================================== */
'use strict';

/* ---------- config ---------- */
const BROUTER = 'https://brouter.de/brouter';
const PHOTON  = 'https://photon.komoot.io/api/';
const PHOTON_REV = 'https://photon.komoot.io/reverse';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NL_CENTER = [52.13, 5.29];
const NL_BBOX = '3.31,50.74,7.23,53.58';      // minLon,minLat,maxLon,maxLat
const STORE_KEY = 'fietsnav.v1';

/* ---------- tiny helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const R = 6371000;
const toRad = d => d * Math.PI / 180;
function haversine(a, b){
  const dLat = toRad(b[0]-a[0]), dLon = toRad(b[1]-a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function bearing(a, b){
  const la1=toRad(a[0]), la2=toRad(b[0]), dLon=toRad(b[1]-a[1]);
  const y = Math.sin(dLon)*Math.cos(la2);
  const x = Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
const compass = b => ['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round(b/45)%8];
function fmtD(m){ if(m==null) return '—'; if(m<950) return Math.round(m/10)*10+' m'; return (m/1000).toFixed(m<9500?1:0)+' km'; }
function fmtT(s){ s=Math.round(s); const h=Math.floor(s/3600), m=Math.round((s%3600)/60); return h?`${h} h ${m} min`:`${m} min`; }
function etaClock(sec){ return new Date(Date.now()+sec*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
const isMobile = () => (typeof window!=='undefined' && window.matchMedia) ? window.matchMedia('(max-width:759px)').matches : (innerWidth<760);
function haptic(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

/* ---------- persistent store ---------- */
let store = { settings:{ base:'cycl', voice:true, theme:'auto', keepAwake:true }, places:{}, routes:[], recents:[] };
try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if(s){ store = Object.assign(store, s); store.settings = Object.assign({base:'cycl',voice:true,theme:'auto',keepAwake:true}, s.settings||{}); store.recents = s.recents||[]; } } catch(e){}
const saveStore = () => { try{ localStorage.setItem(STORE_KEY, JSON.stringify(store)); }catch(e){} };

/* ---------- app state ---------- */
const state = {
  from:null, to:null, vias:[],          // each {lat,lon,label}
  profile:'scenic',                      // scenic-only app: always route through parks/water
  routes:[], activeAlt:0, routeLabels:[], // parsed route objects + their scenic-tier labels
  route:null,
  nav:false, watchId:null, lastSnapIdx:0, offCount:0, rerouting:false,
  routing:false,                         // a route is currently being computed (find button → spinner)
  userPos:null, userMarker:null, userAcc:null, heading:null,
  announced:{}, follow:true, programmaticMove:false,
  navZoom:17, navZoomed:false,   // navigation view: zoomed-in, follows the rider
  courseUp:true, compassHeading:null,   // course-up rotates the map so travel direction is up
  pois:{ nodes:false, parking:false, ferry:false, station:false },
  overlays:{ cycleroutes:false },
  compare:null, showRoadRoute:false,
};

/* =========================================================
   MAP
   ========================================================= */
// fadeAnimation:false — tiles render at full opacity immediately; the fade-in otherwise gets
// stuck at opacity 0 when the map pans rapidly during navigation, leaving the map black.
const map = L.map('map', { zoomControl:false, attributionControl:true, preferCanvas:false, fadeAnimation:false }).setView(NL_CENTER, 8);
L.control.zoom({ position:'bottomleft' }).addTo(map);
map.attributionControl.setPrefix('');

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const tileOpts = { maxZoom:20, updateWhenIdle:false, keepBuffer:3 };
const baseLayers = {
  cycl: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        Object.assign({}, tileOpts, { subdomains:'abc', attribution:'CyclOSM | '+OSM_ATTR })),
  light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        Object.assign({}, tileOpts, { subdomains:'abcd', attribution:'&copy; CARTO | '+OSM_ATTR })),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        Object.assign({}, tileOpts, { maxZoom:19, attribution:OSM_ATTR })),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        Object.assign({}, tileOpts, { subdomains:'abcd', attribution:'&copy; CARTO | '+OSM_ATTR })),
};
const overlayLayers = {
  cycleroutes: L.tileLayer('https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
        { maxZoom:18, opacity:0.75, attribution:'&copy; waymarkedtrails.org' }),
};
let currentBase = store.settings.base in baseLayers ? store.settings.base : 'cycl';
baseLayers[currentBase].addTo(map);

/* layers for route + markers + pois */
const routePane = map.createPane('routePane'); routePane.style.zIndex = 450;
const routeLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map);
const poiLayer = L.layerGroup().addTo(map);

/* track user vs programmatic map moves (for the re-center button in nav) */
map.on('dragstart', ()=>{ if(state.nav){ state.follow=false; showRecenter(true); } });
/* remember the user's own pinch-zoom during nav so it sticks as they keep moving */
map.on('zoomend', ()=>{ if(state.nav && !state.programmaticMove){ state.navZoom = map.getZoom(); state.navZoomed = true; } });

/* =========================================================
   GEOCODING (Photon) + autocomplete
   ========================================================= */
const geoCache = new Map();          // query -> results (speed: avoid re-fetching as user types)
let geoAbort = null;
async function geocode(q){
  const key = q.toLowerCase();
  if(geoCache.has(key)) return geoCache.get(key);
  const c = map.getCenter();
  const url = `${PHOTON}?q=${encodeURIComponent(q)}&lang=en&limit=6&lat=${c.lat}&lon=${c.lng}&zoom=12&bbox=${NL_BBOX}`;
  try{ if(geoAbort) geoAbort.abort(); }catch(e){}
  let signal;
  try{ geoAbort = new AbortController(); signal = geoAbort.signal; }catch(e){ geoAbort=null; }
  const r = await fetch(url, signal?{signal}:undefined);
  if(!r.ok) throw new Error('search failed');
  const j = await r.json();
  const out = (j.features||[]).map(f=>{
    const p = f.properties||{}, g = f.geometry||{};
    const lon = g.coordinates ? g.coordinates[0] : null;
    const lat = g.coordinates ? g.coordinates[1] : null;
    const name = p.name || p.street || p.city || 'Unnamed';
    const bits = [];
    if(p.street && p.name!==p.street) bits.push(p.housenumber ? `${p.street} ${p.housenumber}` : p.street);
    if(p.postcode) bits.push(p.postcode);
    if(p.city && p.city!==name) bits.push(p.city);
    else if(p.county) bits.push(p.county);
    if(p.state && !bits.includes(p.state)) bits.push(p.state);
    return { lat, lon, label:name, sub:bits.join(', '), cc:p.countrycode };
  }).filter(x=>x.lat!=null);
  geoCache.set(key, out);
  if(geoCache.size>200) geoCache.delete(geoCache.keys().next().value);  // FIFO cap
  return out;
}

const revCache = new Map();
async function reverseGeocode(lat, lon){
  const k = lat.toFixed(4)+','+lon.toFixed(4);
  if(revCache.has(k)) return revCache.get(k);
  try{
    const r = await fetch(`${PHOTON_REV}?lat=${lat}&lon=${lon}&lang=en`);
    const j = await r.json();
    const p = (j.features&&j.features[0]&&j.features[0].properties)||{};
    const name = p.name || p.street || p.city;
    const out = name ? (p.housenumber&&p.street ? `${p.street} ${p.housenumber}` : name) : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    revCache.set(k, out);
    if(revCache.size>300) revCache.delete(revCache.keys().next().value);  // FIFO cap
    return out;
  }catch(e){ return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
}

/* autocomplete wiring for a field role: 'from' | 'to' | via index */
function wireField(input, role){
  const ac = input.parentElement.querySelector('.ac');
  let items = [], active = -1;

  const baseItems = () => {
    const list = roleIsFrom(role) ? [{special:true}] : [];
    const recents = (store.recents||[]).slice(0,5).map(r=>({...r, recent:true}));
    return list.concat(recents);
  };
  const render = () => {
    if(!items.length){ ac.classList.remove('open'); ac.innerHTML=''; return; }
    ac.innerHTML = items.map((it,i)=>{
      if(it.special){
        return `<div class="it special" data-i="${i}"><span class="ico">${locIco}</span><div><div class="t">Use my location</div></div></div>`;
      }
      const ico = it.recent ? clockIco : pinIco;
      return `<div class="it ${it.recent?'recent':''} ${i===active?'act':''}" data-i="${i}">
        <span class="ico">${ico}</span>
        <div><div class="t">${esc(it.label)}</div>${it.sub?`<div class="s">${esc(it.sub)}</div>`:''}</div></div>`;
    }).join('');
    ac.classList.add('open');
    $$('.it', ac).forEach(el=>{
      el.addEventListener('mousedown', ev=>{ ev.preventDefault(); pick(parseInt(el.dataset.i)); });
    });
  };
  const pick = (i)=>{
    const it = items[i];
    if(!it) return;
    if(it.special){ useMyLocationFor(role); ac.classList.remove('open'); return; }
    setPoint(role, { lat:it.lat, lon:it.lon, label:it.label });
    input.value = it.label;
    ac.classList.remove('open'); items=[];
    rememberPlace(it);
    maybeRoute();
  };

  const run = debounce(async ()=>{
    const q = input.value.trim();
    if(q.length < 2){ items = baseItems(); active=-1; render(); return; }
    try{
      const res = await geocode(q);
      items = roleIsFrom(role) ? [{special:true}, ...res] : res;
      active = -1; render();
    }catch(e){ if(e.name!=='AbortError'){ items=[]; render(); } }
  }, 220);

  input.addEventListener('input', run);
  input.addEventListener('focus', ()=>{ if(!input.value.trim()){ items=baseItems(); active=-1; render(); } });
  input.addEventListener('keydown', e=>{
    if(!ac.classList.contains('open')) return;
    if(e.key==='ArrowDown'){ active=Math.min(active+1, items.length-1); render(); e.preventDefault(); }
    else if(e.key==='ArrowUp'){ active=Math.max(active-1, 0); render(); e.preventDefault(); }
    else if(e.key==='Enter'){ if(active>=0) pick(active); else if(items.length) pick(items[0].special?1:0); e.preventDefault(); }
    else if(e.key==='Escape'){ ac.classList.remove('open'); }
  });
  input.addEventListener('blur', ()=> setTimeout(()=>ac.classList.remove('open'), 150));

  // via fields wire their own .clr handler in renderViaFields(); only wire from/to here
  // (wiring both would attach two handlers to one button and remove two stops per click).
  const clr = input.parentElement.querySelector('.clr');
  if(clr && typeof role!=='number') clr.addEventListener('click', ()=>{ input.value=''; setPoint(role,null); items=[]; ac.classList.remove('open'); input.focus(); refreshRouteOrClear(); });
}
const roleIsFrom = r => r==='from';
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pinIco = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
const locIco = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
const clockIco = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

function rememberPlace(it){
  if(!it || it.lat==null) return;
  store.recents = (store.recents||[]).filter(r=>r.label!==it.label);
  store.recents.unshift({ lat:it.lat, lon:it.lon, label:it.label, sub:it.sub||'' });
  store.recents = store.recents.slice(0,8);
  saveStore();
}

/* =========================================================
   POINTS (from / to / via) + markers
   ========================================================= */
function setPoint(role, pt){
  if(role==='from') state.from = pt;
  else if(role==='to') state.to = pt;
  else if(typeof role==='number') { if(pt) state.vias[role]=pt; else state.vias.splice(role,1); renderViaFields(); }
  drawEndpoints();
  syncChips();
}
function syncChips(){ const s=$('#styles'); if(s) s.classList.toggle('hidden', !(state.from && state.to)); }
function getInput(role){
  if(role==='from') return $('#inFrom');
  if(role==='to') return $('#inTo');
  return $(`#via-${role}`);
}

function pinIcon(kind, n){
  if(kind==='from') return L.divIcon({className:'', html:`<div class="markpin"><svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#fff" stroke="#0e7c5a" stroke-width="4"/></svg></div>`, iconSize:[26,26], iconAnchor:[13,13]});
  if(kind==='via') return L.divIcon({className:'', html:`<div class="markpin"><svg width="30" height="38" viewBox="0 0 24 30"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 30 12 30s12-10 12-18.4C24 5.2 18.6 0 12 0z" fill="#1971c2"/><text x="12" y="16" font-size="12" fill="#fff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${n}</text></svg></div>`, iconSize:[30,38], iconAnchor:[15,38]});
  return L.divIcon({className:'', html:`<div class="markpin"><svg width="32" height="40" viewBox="0 0 24 30"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 30 12 30s12-10 12-18.4C24 5.2 18.6 0 12 0z" fill="#0e7c5a"/><circle cx="12" cy="11.5" r="4.5" fill="#fff"/></svg></div>`, iconSize:[32,40], iconAnchor:[16,40]});
}
function drawEndpoints(){
  markerLayer.clearLayers();
  if(state.from) L.marker([state.from.lat,state.from.lon], {icon:pinIcon('from'), draggable:true})
    .on('dragend', e=>onPinDrag('from', e)).addTo(markerLayer);
  state.vias.forEach((v,i)=>{ if(v) L.marker([v.lat,v.lon], {icon:pinIcon('via',i+1), draggable:true})
    .on('dragend', e=>onPinDrag(i, e)).addTo(markerLayer); });
  if(state.to) L.marker([state.to.lat,state.to.lon], {icon:pinIcon('to'), draggable:true})
    .on('dragend', e=>onPinDrag('to', e)).addTo(markerLayer);
}
async function onPinDrag(role, e){
  const ll = e.target.getLatLng();
  const label = await reverseGeocode(ll.lat, ll.lng);
  setPoint(role, {lat:ll.lat, lon:ll.lng, label});
  const inp = getInput(role); if(inp) inp.value = label;
  maybeRoute();
}

/* via fields UI */
function renderViaFields(){
  const wrap = $('#viaWrap'); wrap.innerHTML='';
  state.vias.forEach((v,i)=>{
    const div = document.createElement('div');
    div.className='field'; div.dataset.role='via';
    div.innerHTML = `<span class="dot via"></span>
      <input type="text" id="via-${i}" placeholder="Stop ${i+1}" autocomplete="off" value="${v?esc(v.label):''}"/>
      <button class="clr" tabindex="-1" aria-label="Remove stop">✕</button>
      <div class="ac" data-for="via-${i}"></div>`;
    wrap.appendChild(div);
    wireField($(`#via-${i}`, div), i);
    div.querySelector('.clr').addEventListener('click', ()=>{ state.vias.splice(i,1); renderViaFields(); drawEndpoints(); maybeRoute(); });
  });
  syncFindBtn();   // stop-count changed → refresh the CTA label
  // search card height changed while a route sheet is open → keep "full" below the card
  const s=$('#sheet'); if(state.route && isMobile() && s && s.classList && s.classList.contains('show')) setSheetMode(sheetMode);
}

/* map click → set point via popup */
map.on('click', async (e)=>{
  if(state.nav) return;
  const {lat, lng} = e.latlng;
  const html = `<div style="font-size:13px;min-width:158px">
    <div class="lp-title">Drop a point here</div>
    <button class="lp" data-r="from">🟢 Set as start</button>
    <button class="lp" data-r="to">🔴 Set as destination</button>
    <button class="lp" data-r="via">🔵 Add as stop</button></div>`;
  const pop = L.popup({closeButton:true, autoClose:true, closeOnClick:true, className:'clickpop'}).setLatLng(e.latlng).setContent(html).openOn(map);
  setTimeout(()=>{
    $$('.lp').forEach(b=> b.addEventListener('click', async ()=>{
      map.closePopup(pop);
      const label = await reverseGeocode(lat, lng);
      const pt = {lat, lon:lng, label};
      if(b.dataset.r==='from'){ setPoint('from', pt); $('#inFrom').value=label; }
      else if(b.dataset.r==='to'){ setPoint('to', pt); $('#inTo').value=label; }
      else { state.vias.push(pt); renderViaFields(); drawEndpoints(); syncChips(); }
      maybeRoute();
    }));
  }, 0);
});

/* my location */
function useMyLocationFor(role){
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    const label='Your location';
    setPoint(role, {lat, lon, label});
    const inp=getInput(role); if(inp) inp.value=label;
    map.setView([lat,lon], 15);
    maybeRoute();
  }, err=>{ toast('Location unavailable — allow location access'); }, {enableHighAccuracy:true, timeout:10000});
}

/* =========================================================
   ROUTING (BRouter)
   ========================================================= */
function lonlatString(){
  const pts = [state.from, ...state.vias.filter(Boolean), state.to];
  return pts.map(p=>`${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
}

/* Custom BRouter profiles we ship as .brf files, upload on first use, then cache the id:
   - scenic  → maximal greenery (forests/parks + rivers/lakes, bypass big towns, low-noise)
   - hybrid  → "Smart": a lighter green lean (forests/parks + water) WITHOUT the town-bypass
               that costs the most distance — so it's mostly scenic yet noticeably more
               efficient than full Scenic. BRouter does the balancing.
   The id is cached; if BRouter ever forgets it we re-upload. Falls back to a built-in profile. */
const CUSTOM_PROFILES = { scenic:'scenic.brf', hybrid:'smart.brf' };
const CUSTOM_FALLBACK = { scenic:'safety', hybrid:'trekking' };
const customProfileId = {}, customProfilePromise = {};
try{ Object.assign(customProfileId, JSON.parse(localStorage.getItem('fietsnav.customProfiles.v2')||'{}')||{}); }catch(e){}
const saveCustomProfiles = () => { try{ localStorage.setItem('fietsnav.customProfiles.v2', JSON.stringify(customProfileId)); }catch(e){} };
async function uploadCustomProfile(name){
  const txt = await (await fetch(CUSTOM_PROFILES[name])).text();
  const r = await fetch(`${BROUTER}/profile`, { method:'POST', body:txt });
  const j = await r.json();
  if(!j || !j.profileid) throw new Error(name+' profile upload failed');
  customProfileId[name] = j.profileid; saveCustomProfiles();
  return j.profileid;
}
function ensureCustomProfile(name){
  if(customProfileId[name]) return Promise.resolve(customProfileId[name]);
  if(!customProfilePromise[name]) customProfilePromise[name] = uploadCustomProfile(name).finally(()=>{ customProfilePromise[name]=null; });
  return customProfilePromise[name];
}

async function brouterRoute(profile, altIdx, signal, lonlats){
  lonlats = lonlats || lonlatString();
  let p = profile, custom = Object.prototype.hasOwnProperty.call(CUSTOM_PROFILES, profile);
  if(custom){ try{ p = await ensureCustomProfile(profile); }catch(e){ p = CUSTOM_FALLBACK[profile]; custom=false; } }
  const build = pr => `${BROUTER}?lonlats=${lonlats}&profile=${encodeURIComponent(pr)}&alternativeidx=${altIdx}&format=geojson`;
  let r = await fetch(build(p), signal?{signal}:undefined);
  if(custom && r.status>=500){
    // BRouter may have evicted our custom profile — re-upload once and retry
    delete customProfileId[profile]; saveCustomProfiles();
    try{ p = await ensureCustomProfile(profile); r = await fetch(build(p), signal?{signal}:undefined); }catch(e){}
  }
  if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error(t || ('routing failed ('+r.status+')')); }
  return r.json();
}

/* The most direct (shortest) BIKE route — the same kind of route Google Maps' cycling
   mode tends to give. Used as the baseline to show how much extra distance the
   scenic / quiet route adds. Uses BRouter's "shortest" profile so it stays on bikeable ways. */
async function shortestBikeRoute(sig){
  const geo = await brouterRoute('shortest', 0, sig);
  const f = geo.features && geo.features[0];
  if(!f) throw new Error('no shortest route');
  const coords = f.geometry.coordinates.map(c=>[c[1], c[0]]);
  const p = f.properties || {};
  const dist = parseFloat(p['track-length']) || pathLength(coords);
  const time = parseFloat(p['total-time']) || (dist/4.4);
  return { dist, time, coords };
}

/* =========================================================
   PARK DISCOVERY
   BRouter optimises for forest/water but is blind to urban parks (leisure=park).
   So we find big green areas near the route via OpenStreetMap (Overpass) and dip the
   route into their edges — extra greenery for minimal detour ("optimise only when needed").
   ========================================================= */
const PARK_MIN_AREA = 120000;   // ~12 ha: only sizeable parks justify a detour
const PARK_NEAR = 600;          // m: the park must hug the route corridor
const PARK_MAX_DETOUR = 1.20;   // never let the park route exceed base distance × this
                                // (this also rejects "backward" parks behind the start — a dip that
                                //  needs a long loop, e.g. around a lake, blows past the cap and is dropped)
const PARK_DISCOVERY_MAX = 14000;   // ms: wait up to this long for park discovery before showing the route

function polyAreaCentroid(poly){
  const lat0 = poly.reduce((s,p)=>s+p[0],0)/poly.length;
  const kx = 111000*Math.cos(toRad(lat0)), ky = 111000;
  let A=0,cx=0,cy=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const x1=a[1]*kx,y1=a[0]*ky,x2=b[1]*kx,y2=b[0]*ky, cr=x1*y2-x2*y1;
    A+=cr; cx+=(x1+x2)*cr; cy+=(y1+y2)*cr;
  }
  A/=2; if(Math.abs(A)<1) return {area:0, cent:poly[0]};
  return { area:Math.abs(A), cent:[(cy/(6*A))/ky, (cx/(6*A))/kx] };
}
function pointInPoly(pt, poly){
  const x=pt[1], y=pt[0]; let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][1], yi=poly[i][0], xj=poly[j][1], yj=poly[j][0];
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi)) inside=!inside;
  }
  return inside;
}
async function fetchParks(coords, sig){
  let s=90,w=180,n=-90,e=-180;
  coords.forEach(c=>{ if(c[0]<s)s=c[0]; if(c[0]>n)n=c[0]; if(c[1]<w)w=c[1]; if(c[1]>e)e=c[1]; });
  const m=0.02, bbox=`${(s-m).toFixed(4)},${(w-m).toFixed(4)},${(n+m).toFixed(4)},${(e+m).toFixed(4)}`;
  const q=`[out:json][timeout:40];(`
    +`way["leisure"~"^(park|nature_reserve)$"]["name"](${bbox});`
    +`way["landuse"~"^(forest|recreation_ground)$"](${bbox});`
    +`way["natural"~"^(wood|heath)$"](${bbox});`
    +`relation["leisure"~"^(park|nature_reserve)$"]["name"](${bbox});`
    +`relation["landuse"~"^(forest|recreation_ground)$"](${bbox});`
    +`relation["natural"~"^(wood|heath)$"](${bbox}););out geom;`;
  const r = await fetch(OVERPASS, {method:'POST', body:'data='+encodeURIComponent(q), signal:sig});
  const j = await r.json();
  const parks=[];
  (j.elements||[]).forEach(el=>{
    const rings=[];
    if(el.type==='way' && el.geometry) rings.push(el.geometry.map(p=>[p.lat,p.lon]));
    else if(el.type==='relation' && el.members) el.members.forEach(mem=>{ if(mem.role==='outer' && mem.geometry) rings.push(mem.geometry.map(p=>[p.lat,p.lon])); });
    // keep ALL green polygons (with a bbox for fast point tests) — small ones still count toward
    // green-cover scoring; the size filter for *dipping* is applied later in parkDipWaypoints.
    rings.forEach(poly=>{ if(poly.length>=3){
      const ac=polyAreaCentroid(poly);
      let mnLa=90,mxLa=-90,mnLo=180,mxLo=-180;
      for(const p of poly){ if(p[0]<mnLa)mnLa=p[0]; if(p[0]>mxLa)mxLa=p[0]; if(p[1]<mnLo)mnLo=p[1]; if(p[1]>mxLo)mxLo=p[1]; }
      parks.push({area:ac.area, cent:ac.cent, poly, bbox:[mnLa,mxLa,mnLo,mxLo]});
    } });
  });
  return parks;
}
// fraction (0..1) of a route's length that runs through green polygons — the real "green cover".
function greenCover(route, polys){
  if(!route || !route.coords || route.coords.length<2 || !polys || !polys.length) return 0;
  const inGreen = pt => {
    const la=pt[0], lo=pt[1];
    for(const pk of polys){ const b=pk.bbox; if(b && (la<b[0]||la>b[1]||lo<b[2]||lo>b[3])) continue; if(pointInPoly(pt, pk.poly)) return true; }
    return false;
  };
  let green=0, total=0; const c=route.coords;
  for(let i=1;i<c.length;i++){
    const segLen=haversine(c[i-1],c[i]); total+=segLen;
    if(inGreen([(c[i-1][0]+c[i][0])/2,(c[i-1][1]+c[i][1])/2])) green+=segLen;
  }
  return total>0 ? green/total : 0;
}
function parkDipWaypoints(coords, parks){
  parks = (parks||[]).filter(p=>p.area>=PARK_MIN_AREA);   // only sizeable parks justify a detour
  const sample = coords.filter((_,i)=>i%3===0); if(sample.length<2) return [];
  const nearest = cent => { let bi=0,bd=Infinity; for(let i=0;i<sample.length;i++){ const d=haversine(cent,sample[i]); if(d<bd){bd=d;bi=i;} } return {pt:sample[bi], frac:bi/sample.length, dist:bd}; };
  const chosen=[];
  parks.sort((a,b)=>b.area-a.area);
  for(const pk of parks){
    if(chosen.length>=2) break;
    const nr=nearest(pk.cent);
    if(nr.dist<150 || nr.dist>PARK_NEAR) continue;         // already on it / too far
    let wp=null;                                            // dip ~300 m into the park edge (not its centre)
    for(let t=0.05;t<=1.0001;t+=0.05){
      const cand=[ nr.pt[0]+(pk.cent[0]-nr.pt[0])*t, nr.pt[1]+(pk.cent[1]-nr.pt[1])*t ];
      if(pointInPoly(cand, pk.poly) && haversine(cand, nr.pt)>250){ wp=cand; break; }
    }
    if(wp) chosen.push({wp, frac:nr.frac});
  }
  return chosen;
}
async function enrichWithParks(base, sig, parks, maxDetour){
  try{
    if(!state.from || !state.to || base.dist>50000) return null;   // skip very long routes (huge bbox)
    if(!parks) parks = await fetchParks(base.coords, sig);
    const cap = maxDetour || PARK_MAX_DETOUR;
    const dips = parkDipWaypoints(base.coords, parks);
    if(!dips.length) return null;
    // merge park dips with any user stops, in route order, then re-route through them
    const sample = base.coords.filter((_,i)=>i%3===0);
    const fracOf = pt => { let bi=0,bd=Infinity; for(let i=0;i<sample.length;i++){ const d=haversine(pt,sample[i]); if(d<bd){bd=d;bi=i;} } return bi/sample.length; };
    const vias = state.vias.filter(Boolean).map(v=>({wp:[v.lat,v.lon], frac:fracOf([v.lat,v.lon])}));
    const tryDips = async useDips => {
      const ordered = useDips.concat(vias).sort((a,b)=>a.frac-b.frac).map(o=>o.wp);
      const lonlats = [[state.from.lat,state.from.lon], ...ordered, [state.to.lat,state.to.lon]]
        .map(p=>`${(+p[1]).toFixed(6)},${(+p[0]).toFixed(6)}`).join('|');
      return parseRoute(await brouterRoute('scenic', 0, sig, lonlats));
    };
    let pr = await tryDips(dips), used = dips.length;
    if(pr.dist > base.dist*cap && dips.length>1){
      pr = await tryDips([dips[0]]); used = 1;        // combo too long → keep just the biggest park
    }
    if(pr.dist > base.dist*cap) return null;          // still too much detour → keep the direct route
    pr.viaParks = used;
    return pr;
  }catch(e){ return null; }
}

function parseRoute(geo){
  const f = geo.features && geo.features[0];
  if(!f) throw new Error('no route');
  const coords = f.geometry.coordinates.map(c=>[c[1], c[0]]); // -> [lat,lon]
  const p = f.properties || {};
  const dist = parseFloat(p['track-length']) || pathLength(coords);
  const time = parseFloat(p['total-time']) || (dist/4.4); // ~16km/h fallback
  const asc  = parseFloat(p['filtered ascend'] || p['plain-ascend']) || 0;
  const names = namesFromMessages(p.messages, coords);
  const cum = cumulative(coords);
  const turns = buildTurns(coords, cum, names);
  const profile = state.profile;
  const elev = profileFromMessages(p.messages);
  return { coords, cum, dist, time, asc, turns, profile, elev };
}
function pathLength(c){ let s=0; for(let i=1;i<c.length;i++) s+=haversine(c[i-1],c[i]); return s; }
function cumulative(c){ const cum=[0]; for(let i=1;i<c.length;i++) cum[i]=cum[i-1]+haversine(c[i-1],c[i]); return cum; }

/* best-effort street names from BRouter messages (optional, defensive) */
function namesFromMessages(messages, coords){
  const names = new Array(coords.length).fill(null);
  try{
    if(!Array.isArray(messages) || messages.length<2) return names;
    const header = messages[0].map(h=>String(h).toLowerCase());
    const iLon = header.indexOf('longitude'), iLat = header.indexOf('latitude');
    const iTags = header.findIndex(h=>h.includes('waytags'));
    if(iLon<0||iLat<0||iTags<0) return names;
    // for each message row, find nearest coord index and assign parsed name forward
    let lastIdx = 0;
    for(let m=1; m<messages.length; m++){
      const row = messages[m];
      const lat = parseFloat(row[iLat])/1e6, lon = parseFloat(row[iLon])/1e6;
      const tags = String(row[iTags]||'');
      const nm = parseName(tags);
      // nearest coord index (search forward from lastIdx)
      let bi=lastIdx, bd=Infinity;
      for(let i=lastIdx;i<coords.length;i++){
        const d=(coords[i][0]-lat)**2+(coords[i][1]-lon)**2;
        if(d<bd){bd=d;bi=i;}
        if(d>bd && i-bi>30) break;
      }
      for(let i=lastIdx;i<bi;i++) names[i]=names[i]||null;
      names[bi]=nm; lastIdx=bi;
    }
    // forward-fill
    let cur=null; for(let i=0;i<names.length;i++){ if(names[i]) cur=names[i]; else names[i]=cur; }
  }catch(e){ /* names are optional */ }
  return names;
}
function parseName(tags){
  // tags like "highway=cycleway name=Some Street Name surface=asphalt"
  const m = tags.match(/(?:^|\s)name=(.+?)(?:\s+[a-zA-Z_]+=|$)/);
  return m ? m[1].trim() : null;
}

/* elevation + surface profile from BRouter messages (optional, defensive) */
function surfaceClass(tags){
  const m = /(?:^|\s)surface=([a-z_]+)/.exec(tags);
  if(!m){ return /highway=(cycleway|primary|secondary|tertiary|residential|living_street|service|trunk|unclassified|footway|pedestrian)/.test(tags) ? 'paved' : 'unknown'; }
  const s = m[1];
  if(/(asphalt|paved|concrete|paving_stones|sett|metal|wood)/.test(s)) return 'paved';
  if(/(gravel|fine_gravel|compacted|unpaved|ground|dirt|earth|grass|sand|mud|pebblestone|cobblestone)/.test(s)) return 'unpaved';
  return 'unknown';
}
function profileFromMessages(messages){
  // BRouter's "Elevation" column is the ABSOLUTE height in metres (often single digits
  // or negative in the NL polders). We plot it directly and lean on BRouter's smoothed
  // "filtered ascend" for the climb figure; descent is kept consistent via net gain.
  try{
    if(!Array.isArray(messages) || messages.length<3) return null;
    const header = messages[0].map(h=>String(h).toLowerCase());
    const iEle = header.indexOf('elevation');
    const iDist = header.indexOf('distance');
    const iTags = header.findIndex(h=>h.includes('waytags'));
    if(iDist<0) return null;
    const raw=[]; let cum=0, first=null, last=null;
    const surf={paved:0, unpaved:0, unknown:0};
    let hasEle=false;
    for(let m=1;m<messages.length;m++){
      const row=messages[m];
      const segd=parseFloat(row[iDist])||0;
      cum+=segd;
      if(iTags>=0){ surf[surfaceClass(String(row[iTags]||''))]+=segd; }
      let e=null;
      // reject SRTM void/no-data sentinels (e.g. -2048) and other implausible values
      if(iEle>=0){ const v=parseFloat(row[iEle]); if(isFinite(v) && v>-430 && v<5000){ e=v; hasEle=true; if(first==null)first=v; last=v; } }
      raw.push({d:cum, e});
    }
    const surfTot=surf.paved+surf.unpaved+surf.unknown;
    if(!hasEle){ return surfTot>0 ? {pts:[], min:0,max:0,net:0,total:cum,surf} : null; }
    // carry the last known height across gaps so the line stays continuous
    let prev=first; for(const r of raw){ if(r.e==null) r.e=prev; else prev=r.e; }
    // light moving-average smoothing for a clean sparkline (display only)
    const win=Math.max(1, Math.round(raw.length/120));
    const sm=raw.map((r,i)=>{ let s=0,c=0; for(let k=-win;k<=win;k++){ const j=i+k; if(j>=0&&j<raw.length){ s+=raw[j].e; c++; } } return {d:r.d, e:s/c}; });
    let minE=Infinity, maxE=-Infinity; sm.forEach(r=>{ if(r.e<minE)minE=r.e; if(r.e>maxE)maxE=r.e; });
    let pts=sm;
    if(sm.length>400){ const step=Math.ceil(sm.length/400); pts=sm.filter((_,i)=>i%step===0 || i===sm.length-1); }
    return { pts, min:minE, max:maxE, net:(last-first), total:cum, surf };
  }catch(e){ return null; }
}

/* ---- turn computation from geometry (Ramer–Douglas–Peucker corners) ---- */
function localXY(pts){
  const ref = toRad(pts[0][0]);
  return pts.map(p=>[toRad(p[1])*Math.cos(ref)*R, toRad(p[0])*R]);
}
function rdpKeep(pts, eps){
  if(pts.length<3) return pts.map((_,i)=>i);
  const xy = localXY(pts);
  const keep = new Array(pts.length).fill(false);
  keep[0]=keep[pts.length-1]=true;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [s,e]=stack.pop();
    let dmax=0, idx=-1;
    const [x1,y1]=xy[s],[x2,y2]=xy[e];
    const dx=x2-x1, dy=y2-y1, len2=dx*dx+dy*dy||1e-9;
    for(let i=s+1;i<e;i++){
      const [x0,y0]=xy[i];
      const t=((x0-x1)*dx+(y0-y1)*dy)/len2;
      const px=x1+t*dx, py=y1+t*dy;
      const d=Math.hypot(x0-px,y0-py);
      if(d>dmax){dmax=d;idx=i;}
    }
    if(dmax>eps && idx>-1){ keep[idx]=true; stack.push([s,idx],[idx,e]); }
  }
  const out=[]; for(let i=0;i<pts.length;i++) if(keep[i]) out.push(i);
  return out;
}
function classifyTurn(delta){
  const a=Math.abs(delta);
  if(a>=165) return 'uturn';
  if(a>=112) return delta>0?'sharp-right':'sharp-left';
  if(a>=38)  return delta>0?'right':'left';
  if(a>=18)  return delta>0?'slight-right':'slight-left';
  return null;
}
function buildTurns(coords, cum, names){
  const maneuvers=[];
  if(coords.length<2) return maneuvers;
  // depart
  const b0 = bearing(coords[0], coords[Math.min(3, coords.length-1)]);
  maneuvers.push({ type:'depart', lat:coords[0][0], lon:coords[0][1], cum:0, name:names[0]||null, head:compass(b0) });

  const kept = rdpKeep(coords, 12);
  for(let j=1; j<kept.length-1; j++){
    const i=kept[j], prev=kept[j-1], next=kept[j+1];
    const inB = bearing(coords[prev], coords[i]);
    const outB = bearing(coords[i], coords[next]);
    let delta = ((outB-inB+540)%360)-180;
    const type = classifyTurn(delta);
    if(!type) continue;
    const name = names[Math.min(i+1, coords.length-1)] || names[i] || null;
    const last = maneuvers[maneuvers.length-1];
    if(last && last.type!=='depart' && (cum[i]-last.cum)<18){
      // merge very close maneuvers — keep the sharper
      if(Math.abs(delta) > severity(last.type)) { last.type=type; last.lat=coords[i][0]; last.lon=coords[i][1]; last.cum=cum[i]; last.name=name; }
      continue;
    }
    maneuvers.push({ type, lat:coords[i][0], lon:coords[i][1], cum:cum[i], name });
  }
  // arrive
  const end = coords[coords.length-1];
  maneuvers.push({ type:'arrive', lat:end[0], lon:end[1], cum:cum[cum.length-1], name:null });
  // step distances (distance travelled on this step to reach the NEXT maneuver)
  for(let i=0;i<maneuvers.length;i++){
    const nx = maneuvers[i+1];
    maneuvers[i].stepDist = nx ? (nx.cum - maneuvers[i].cum) : 0;
  }
  return maneuvers;
}
function severity(type){ return {'slight-left':25,'slight-right':25,'left':70,'right':70,'sharp-left':130,'sharp-right':130,'uturn':180}[type]||0; }

const ARROWS = {'depart':'⬆','continue':'⬆','slight-left':'↖','left':'⬅','sharp-left':'↙','slight-right':'↗','right':'➡','sharp-right':'↘','uturn':'↩','arrive':'⚑'};
const VERB   = {'continue':'Continue straight','slight-left':'Bear left','left':'Turn left','sharp-left':'Sharp left turn','slight-right':'Bear right','right':'Turn right','sharp-right':'Sharp right turn','uturn':'Make a U-turn','arrive':'Arrive at destination'};
function turnText(t, withName=true){
  if(t.type==='depart') return `Head ${t.head}` + (withName&&t.name?` on ${t.name}`:'');
  if(t.type==='arrive') return 'Arrive at destination';
  let s = VERB[t.type]||'Continue';
  if(withName && t.name && t.type!=='uturn') s += ` onto ${t.name}`;
  return s;
}

/* ---- orchestration ---- */
let routeReqId = 0;
let routeAbort = null;
/* Endpoints/vias changed. We DON'T route automatically — the user presses "Find route".
   So here we just drop any now-stale route, refresh the Find button, and update the panel. */
function maybeRoute(){
  if(state.routes.length) clearRoute();
  syncChips(); syncFindBtn();
  if(state.from && state.to) renderReady();
  else renderEmpty();
}
function refreshRouteOrClear(){ maybeRoute(); }
function clearRoute(){ routeLayer.clearLayers(); state.routes=[]; state.route=null; state.compare=null; }

/* Show/label the "Find route" CTA: visible only when both ends are set and we have no route yet. */
function syncFindBtn(){
  const b=$('#findBtn'); if(!b) return;
  const txt=$('#findBtnTxt');
  if(state.routing){
    b.classList.remove('hide'); b.setAttribute('disabled','');
    if(txt) txt.textContent='Finding the greenest route…';
    return;
  }
  b.removeAttribute('disabled');
  if(txt) txt.textContent = state.vias.filter(Boolean).length ? 'Find scenic route via stops' : 'Find scenic route';
  const show = !!(state.from && state.to) && !state.routes.length;
  b.classList.toggle('hide', !show);
}

// Two routes count as "the same" if they're a near-identical length AND trace nearly the
// same line (sampled points stay close) — used to dedupe the scenic candidates.
function routeSimilar(a, b){
  if(!a || !b || !a.coords || !b.coords) return false;
  const da=a.dist, db=b.dist;
  if(Math.abs(da-db) > Math.max(da,db,1)*0.04) return false;     // >4% length apart → different
  let tot=0, cnt=0;
  for(let k=1;k<8;k++){
    const pa=a.coords[Math.floor(a.coords.length*k/8)];
    const pb=b.coords[Math.floor(b.coords.length*k/8)];
    if(pa && pb){ tot+=haversine(pa,pb); cnt++; }
  }
  return cnt>0 && (tot/cnt) < 80;                                 // avg sampled separation <80 m → same
}
// From a pool of scenic candidates, keep DISTINCT routes ordered least→most green and only
// keep a tier if it's GENUINELY greener (≥ GREEN_MARGIN more green cover) than the one below.
// A tier that can't be made meaningfully greener is dropped — so we never fake a 3rd route.
const GREEN_MARGIN = 0.04;   // need ≥4 percentage points more green cover to justify another tier
function pickScenicTiers(pool, greenPolys){
  const hasGreen = !!(greenPolys && greenPolys.length);
  const uniq=[];
  for(const r of pool.filter(Boolean)){
    r.green = hasGreen ? greenCover(r, greenPolys) : null;
    if(!uniq.some(u=>routeSimilar(u,r))) uniq.push(r);
  }
  if(!uniq.length) return [];
  if(!hasGreen){                                  // no green data → can't rank greenery; offer ≤2 by distance
    uniq.sort((a,b)=>a.dist-b.dist);
    return uniq.length<=2 ? uniq : [uniq[0], uniq[uniq.length-1]];
  }
  // Pareto frontier: drop any route that another beats on BOTH axes (greener-or-equal AND
  // shorter-or-equal) — those are strictly worse. What remains is an honest gradient where
  // getting greener costs distance. We never show a longer route that's also less green.
  const front = uniq.filter(r => !uniq.some(o => o!==r &&
    o.green >= r.green - 1e-9 && o.dist <= r.dist + 1e-9 &&
    (o.green > r.green + 1e-9 || o.dist < r.dist - 1e-9)));
  front.sort((a,b)=> a.green - b.green || a.dist - b.dist);
  if(front.length===1) return front;
  const lo=front[0], hi=front[front.length-1];
  if(hi.green - lo.green < GREEN_MARGIN) return [hi];   // no real green gradient → a single (greenest) route
  // middle tier: the frontier route whose green cover sits nearest the midpoint and clearly between
  const center=(lo.green+hi.green)/2; let mid=null, bestD=Infinity;
  for(const r of front){
    if(r===lo || r===hi) continue;
    if(r.green>=lo.green+GREEN_MARGIN && r.green<=hi.green-GREEN_MARGIN){
      const d=Math.abs(r.green-center); if(d<bestD){ bestD=d; mid=r; }
    }
  }
  return mid ? [lo, mid, hi] : [lo, hi];
}
function tierLabels(n){
  if(n>=3) return ['🍃 Scenic', '🌿 More scenic', '🌳 Most scenic'];
  if(n===2) return ['🍃 Scenic', '🌳 Most scenic'];
  return ['🌳 Scenic route'];
}
// recommended default: the middle "More scenic" when 3 tiers exist (the user's preference); with 2,
// the greener one if it's not a big detour over the more direct, else the direct one.
function recommendedTier(routes){
  const n = routes.length;
  if(n>=3) return 1;
  if(n===2){
    const greener = (routes[1].green||0) >= (routes[0].green||0) ? 1 : 0, other = greener?0:1;
    if(routes[greener].dist <= routes[other].dist) return greener;          // greener AND not longer
    return routes[greener].dist <= routes[other].dist*1.15 ? greener : other;
  }
  return 0;
}

async function computeRoute(){
  if(!state.from || !state.to) return;
  const myId = ++routeReqId;
  state.routing = true; syncFindBtn();
  try{ if(routeAbort) routeAbort.abort(); }catch(e){}
  let sig; try{ routeAbort = new AbortController(); sig = routeAbort.signal; }catch(e){ routeAbort=null; }
  renderLoading();

  // fetch several scenic candidates in parallel: a moderate-green profile (hybrid) plus the
  // full scenic profile and its alternatives — genuinely different paths, so we can offer a
  // gradient (and we don't fall back to a single route when parks aren't nearby).
  const one = async (profile, alt) => {
    try { return parseRoute(await brouterRoute(profile, alt, sig)); }
    catch(e){ if(e && e.name==='AbortError') throw e; return null; }
  };
  let cands;
  try {
    cands = await Promise.all([ one('hybrid',0), one('scenic',0), one('scenic',1) ]);
  } catch(err){ if(err && err.name==='AbortError') return; cands = []; }
  if(myId!==routeReqId) return;
  let scenic0 = cands[1] || cands[2] || cands[0];                 // best base for park discovery
  if(!scenic0){
    // every scenic call failed → fall back to a plain trekking route so the user still gets something
    try{ scenic0 = parseRoute(await brouterRoute('trekking', 0, sig)); if(myId===routeReqId) toast('Scenic routing was unavailable — used a standard route'); }
    catch(e2){ if(e2 && e2.name==='AbortError') return; if(myId===routeReqId) renderError(e2.message); return; }
    if(myId!==routeReqId) return;
    cands = [scenic0];
  }

  // kick off the shortest-route comparison in parallel (doesn't block the render)
  const comparePromise = shortestBikeRoute(sig).catch(()=>null);

  // fetch green areas ONCE (bounded) — used both to dip routes through parks and to SCORE green cover.
  let greenPolys = [];
  try{
    greenPolys = await Promise.race([
      fetchParks(scenic0.coords, sig).catch(()=>[]),
      new Promise(res=>setTimeout(res, PARK_DISCOVERY_MAX, []))
    ]) || [];
  }catch(e){ greenPolys = []; }
  if(myId!==routeReqId) return;

  // build greener candidates by dipping through parks: a moderate pass and a max-greenery pass
  // (bigger detour budget). Scoring then ranks tiers by ACTUAL green cover, not distance.
  let prMod=null, prMax=null;
  if(greenPolys.length){
    [prMod, prMax] = await Promise.all([
      enrichWithParks(scenic0, sig, greenPolys, PARK_MAX_DETOUR).catch(()=>null),
      enrichWithParks(scenic0, sig, greenPolys, 1.45).catch(()=>null),       // allow more detour for max greenery
    ]);
    if(myId!==routeReqId) return;
  }

  const tiers = pickScenicTiers([...cands, prMod, prMax], greenPolys);
  state.routes = tiers.length ? tiers : [scenic0];
  state.routeLabels = tierLabels(state.routes.length);
  state.activeAlt = recommendedTier(state.routes);               // default = "More scenic" (balanced)
  state.route = state.routes[state.activeAlt]; state.compare = null;
  state.routing = false; syncFindBtn();
  drawRoutes(); fitRoute(); renderSummary();

  // apply the distance comparison once it's ready
  comparePromise.then(c=>{ if(myId!==routeReqId || !c) return; state.compare = c; drawRoutes(); renderSummary(); });
}

function drawRoutes(){
  routeLayer.clearLayers();
  if(state.showRoadRoute && state.compare && state.compare.coords && state.compare.coords.length){
    L.polyline(state.compare.coords, {color:'#7048e8', weight:4, opacity:.85, dashArray:'1,9', lineCap:'round', pane:'routePane'})
      .bindTooltip('Shortest bike route', {sticky:true}).addTo(routeLayer);
  }
  state.routes.forEach((r,i)=>{
    const active = i===state.activeAlt;
    if(!active){
      L.polyline(r.coords, {color:'#9aa4ad', weight:6, opacity:.6, pane:'routePane'})
        .on('click', ()=>{ state.activeAlt=i; state.route=r; drawRoutes(); renderSummary(); }).addTo(routeLayer);
    }
  });
  // active on top, with white casing
  const r = state.routes[state.activeAlt]; if(!r) return;
  L.polyline(r.coords, {color:'#ffffff', weight:11, opacity:.95, pane:'routePane', lineCap:'round', lineJoin:'round'}).addTo(routeLayer);
  L.polyline(r.coords, {color:profileColor(r.profile), weight:6.5, opacity:1, pane:'routePane', lineCap:'round', lineJoin:'round'}).addTo(routeLayer);
}
function profileColor(p){ return {trekking:'#0e7c5a', hybrid:'#4263eb', scenic:'#2f9e44', fastbike:'#e8590c', safety:'#1971c2', shortest:'#7048e8'}[p]||'#0e7c5a'; }
function fitRoute(){
  const r=state.route; if(!r) return;
  const m = isMobile();
  map.fitBounds(L.latLngBounds(r.coords).pad(0.08), {
    paddingTopLeft:[m?30:420, m?180:40],
    paddingBottomRight:[m?30:40, m?300:40]
  });
}

/* =========================================================
   RESULTS PANEL RENDER
   ========================================================= */
const results = $('#results');
function renderEmpty(){
  results.innerHTML = `<div class="hint"><span class="big">🌳</span>
    Set a start and destination to get the <b>most scenic</b> bike route — through parks, forests and along the water.<br><br>
    Tip: tap the map to drop a point, or open the menu to save Home &amp; Work.</div>`;
  showSheet(!isMobile());
}
/* both ends set, route not computed yet — prompt the user to press Find (no auto-routing) */
function renderReady(){
  results.innerHTML = `<div class="hint"><span class="big">🚲</span>
    Ready to plan.<br>Tap <b>Find scenic route</b> to map the greenest way there.</div>`;
  showSheet(!isMobile());   // desktop shows the prompt; on mobile the sheet waits for Find
}
function renderLoading(){
  results.innerHTML = `<div class="summary"><div class="sumtop"><span class="time">Finding scenic route…</span></div>
    <div class="cmp-note" style="margin-top:0">Checking parks &amp; cycle paths along the way</div>
    <div class="loadbar"></div></div>`;
  showSheet(true, 'peek');
}
function renderError(msg){
  state.routing = false; syncFindBtn();
  results.innerHTML = `<div class="hint"><span class="big">⚠️</span>Couldn't find a route.<br>${esc(msg||'')}<br><br>Try moving a point onto a road or path.</div>`;
  showSheet(true, 'peek');
}
/* comparison card: this bike route vs the shortest (most direct) bike route */
function compareCard(r){
  const c = state.compare; if(!c) return '';
  if(c.isSame){
    return `<div class="compare"><div class="cmp-head"><span>shortest bike route</span></div>
      <div class="cmp-note">You're already on the <b>shortest</b> bike route (${fmtD(r.dist)}). Switch to Recommended or Quiet to see how much a nicer route would add.</div></div>`;
  }
  const diff = r.dist - c.dist;
  const longer = diff >= 0;
  const diffTxt = `${longer?'+':'−'}${fmtD(Math.abs(diff))}`;
  const pct = c.dist>0 ? Math.round(Math.abs(diff)/c.dist*100) : 0;
  const mx = Math.max(r.dist, c.dist) || 1;
  // Estimate the shortest route's time at the SAME cycling speed as the chosen route,
  // so a shorter distance always reads as less time. BRouter's "shortest" profile reports
  // an unrealistically slow (near-walking) time, which we deliberately do not show.
  const speed = r.time>0 ? r.dist/r.time : 4.5;
  const cTime = c.dist/speed;
  return `<div class="compare">
    <div class="cmp-head"><span>vs. shortest bike route</span>
      <span class="cmp-toggle" id="cmpToggle" role="button" tabindex="0">${state.showRoadRoute?'Hide on map':'Show on map'}</span></div>
    <div class="cmp-line"><span class="lab">🚲</span><div class="track"><div class="fill bike" style="width:${(r.dist/mx*100).toFixed(1)}%"></div></div>
      <span class="val">${fmtD(r.dist)} · ${fmtT(r.time)}</span></div>
    <div class="cmp-line"><span class="lab">📏</span><div class="track"><div class="fill short" style="width:${(c.dist/mx*100).toFixed(1)}%"></div></div>
      <span class="val">${fmtD(c.dist)} · ${fmtT(cTime)}</span></div>
    <div class="cmp-note">This route is <b>${diffTxt}</b> ${longer?'longer':'shorter'}${pct?` (${pct}%)`:''} than the most direct bike route — the extra distance buys you cycle paths and quiet streets.</div>
  </div>`;
}
function setRoadCompare(on){
  state.showRoadRoute = on;
  const opt = $('.opt[data-cmp="road"]', $('#pop')); if(opt){ opt.dataset.on = on?'1':'0'; opt.setAttribute('aria-checked', on?'true':'false'); }
  if(on && !state.compare && state.from && state.to){
    shortestBikeRoute().then(c=>{ state.compare=c; drawRoutes(); renderSummary(); }).catch(()=>toast('Comparison route unavailable'));
  }
  drawRoutes(); renderSummary();
}
/* elevation + surface card */
function elevCard(r){
  const e = r.elev; if(!e) return '';
  let body='';
  if(e.pts && e.pts.length>1){
    const W=300, H=56, pad=2;
    // enforce a minimum vertical range so a near-flat route reads as flat (not alpine)
    const span = Math.max(e.max-e.min, 20);
    const mid = (e.max+e.min)/2, lo = mid - span/2;
    const total = e.total || e.pts[e.pts.length-1].d || 1;
    const x = d => (d/total)*W;
    const y = v => H - pad - ((v-lo)/span)*(H-2*pad);
    let d = `M ${x(e.pts[0].d).toFixed(1)} ${y(e.pts[0].e).toFixed(1)}`;
    for(let i=1;i<e.pts.length;i++) d += ` L ${x(e.pts[i].d).toFixed(1)} ${y(e.pts[i].e).toFixed(1)}`;
    const area = d + ` L ${W} ${H} L 0 ${H} Z`;
    body = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="elgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent)" stop-opacity=".34"/>
        <stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#elgrad)"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }
  // surface bar
  let surfHtml='';
  if(e.surf){
    const tot = e.surf.paved+e.surf.unpaved+e.surf.unknown;
    if(tot>0){
      const seg = (v,col)=> v>0 ? `<span style="width:${(v/tot*100).toFixed(1)}%;background:${col}"></span>` : '';
      const pavedPct = Math.round(e.surf.paved/tot*100);
      surfHtml = `<div class="surfbar">
        ${seg(e.surf.paved,'var(--accent)')}${seg(e.surf.unpaved,'var(--fast)')}${seg(e.surf.unknown,'var(--muted)')}</div>
        <div class="surf-legend">
          <span><i style="background:var(--accent)"></i>Paved ${pavedPct}%</span>
          ${e.surf.unpaved>0?`<span><i style="background:var(--fast)"></i>Unpaved ${Math.round(e.surf.unpaved/tot*100)}%</span>`:''}
          ${e.surf.unknown>0?`<span><i style="background:var(--muted)"></i>Other ${Math.round(e.surf.unknown/tot*100)}%</span>`:''}
        </div>`;
    }
  }
  if(!body && !surfHtml) return '';
  // high/low points from the smoothed absolute profile (always correct);
  // total climb lives in the summary pill via BRouter's smoothed "filtered ascend".
  const range = (e.pts && e.pts.length>1)
    ? `<span class="vals"><span>▲ <b>${Math.round(e.max)} m</b></span><span>▼ ${Math.round(e.min)} m</span></span>` : '';
  return `<div class="elev">
    <div class="eh"><span>Elevation & surface</span>${range}</div>
    ${body}${surfHtml}</div>`;
}
function renderSummary(){
  const r = state.route; if(!r){ renderEmpty(); return; }
  const labels = state.routeLabels || tierLabels(state.routes.length);
  const rec = recommendedTier(state.routes);
  const scenicLabel = i => (labels[i] || `Route ${i+1}`) + (i===rec ? ' · Recommended' : '');
  const alts = state.routes.length>1 ? `<div class="alts">${state.routes.map((x,i)=>{
      const meta = (x.green!=null ? `${Math.round(x.green*100)}% green · ` : '') + fmtD(x.dist);
      return `<button class="altbtn" data-alt="${i}" data-on="${i===state.activeAlt?1:0}">
        <span class="altname">${scenicLabel(i)}</span><span class="altmeta">${meta}</span></button>`;
    }).join('')}</div>` : '';
  results.innerHTML = `
    <div class="summary">
      <div class="sumtop">
        <span class="time">${fmtT(r.time)}</span>
        <span class="dist">${fmtD(r.dist)}</span>
        <span class="pills"><span class="statpill">⬆ ${Math.round(r.asc)} m</span></span>
      </div>
      ${alts}
      <div class="startrow">
        <button class="startbtn" id="goBtn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg> Start</button>
        <button class="startbtn sec" id="gpxBtn" title="Export GPX" aria-label="Export GPX"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg></button>
        <button class="startbtn sec" id="saveRouteBtn" title="Save route" aria-label="Save route">★</button>
      </div>
      ${elevCard(r)}
      ${compareCard(r)}
      <button class="gmaps osmand" id="osmandBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M16 8l-2.5 6.5L8 16l2.5-6.5z" fill="currentColor" stroke="none"/></svg>
        Navigate in OsmAnd <span class="gm-note">· follows this exact route</span>
      </button>
      <a class="gmaps" id="gmapsBtn" href="${esc(googleMapsUrl()||'#')}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>
        Open in Google Maps <span class="gm-note">· approximate</span>
      </a>
    </div>
    <div class="turns">
      <div class="hd" id="turnsHd" role="button" tabindex="0" aria-expanded="true"><span>Directions · ${r.turns.length} steps</span><span id="turnsCaret">▾</span></div>
      <div id="turnList"></div>
    </div>`;
  renderTurnList(r);
  showSheet(true, sheetMode || 'peek');
  $('#goBtn').addEventListener('click', startNav);
  $('#saveRouteBtn').addEventListener('click', saveCurrentRoute);
  $('#gpxBtn').addEventListener('click', exportGPX);
  const os=$('#osmandBtn'); if(os) os.addEventListener('click', openInOsmAnd);
  const gm=$('#gmapsBtn'); if(gm) gm.addEventListener('click', ()=>haptic(10));   // href does the navigation; just a tap buzz
  const ct=$('#cmpToggle'); if(ct) ct.addEventListener('click', ()=>setRoadCompare(!state.showRoadRoute));
  $$('.altbtn').forEach(b=>b.addEventListener('click', ()=>{ state.activeAlt=parseInt(b.dataset.alt); state.route=state.routes[state.activeAlt]; drawRoutes(); renderSummary(); }));
  let open=true; $('#turnsHd').addEventListener('click', ()=>{ open=!open; $('#turnList').style.display=open?'block':'none'; $('#turnsCaret').textContent=open?'▾':'▸'; $('#turnsHd').setAttribute('aria-expanded', open?'true':'false'); });
}
function renderTurnList(r){
  const el = $('#turnList'); if(!el) return;
  el.innerHTML = r.turns.map(t=>{
    const cls = t.type==='depart'?'dep':(t.type==='arrive'?'arr2':'');
    const d = t.type==='arrive' ? '' : `<div class="d">${fmtD(t.stepDist)}</div>`;
    return `<div class="turn"><div class="arr ${cls}">${ARROWS[t.type]||'⬆'}</div>
      <div class="tx"><b>${esc(turnText(t))}</b>${d}</div></div>`;
  }).join('');
}

/* ---- open the same trip in Google Maps (bicycling) ----
   In-app turn-by-turn will never match Google's; this hands the exact start/stops/
   destination to Google Maps cycling directions so you can use it when you prefer. */
/* choose up to maxN waypoints to pin Google to our route: the route's significant turns
   (Ramer–Douglas–Peucker) plus evenly-spaced fillers to cover the long gaps, then trimmed to
   maxN in route order. maxN is kept tiny (≤3) for the Google Maps app — see googleMapsUrl(). */
function shapeWaypoints(coords, maxN){
  const n=coords.length; if(n<=2) return [];
  let eps=120, keep=rdpKeep(coords, eps);
  while(keep.length>maxN+1 && eps<4000){ eps*=1.5; keep=rdpKeep(coords, eps); }
  const idx=new Set(keep.slice(1,-1));                   // turn indices (drop endpoints)
  for(let k=1;k<=maxN && idx.size<maxN;k++) idx.add(Math.round(n*k/(maxN+1)));  // fillers for the gaps
  let arr=[...idx].filter(i=>i>0 && i<n-1).sort((a,b)=>a-b);
  if(arr.length>maxN){ const out=[],step=arr.length/maxN; for(let k=0;k<maxN;k++) out.push(arr[Math.round(k*step)]); arr=out; }
  return arr.map(i=>coords[i]);
}
// The Google Maps app accepts at most 3 intermediate waypoints in a dir/?api=1 link (the "9"
// limit is desktop-only); handing it more makes the mobile app reject/crash on the link. And
// Maps re-snaps each waypoint to roads and recomputes the leg between them anyway — so a few
// well-spaced points trace OUR path better than many clustered ones. So: keep the user's real
// stops if any (capped at 3); otherwise nudge fidelity with up to 3 well-spaced shape points.
const GMAPS_MAX_WP = 3;
const GMAPS_MIN_GAP = 200;   // m — drop shape points clustered closer than this (Maps re-routes
                             // between waypoints anyway; clustered points only add snap ambiguity)
// up to GMAPS_MAX_WP shape points, each ≥GMAPS_MIN_GAP from the endpoints and each other; may be empty
function spacedShapeWaypoints(coords){
  const cand = shapeWaypoints(coords, GMAPS_MAX_WP + 2);   // over-pick, then space-filter down
  const ends = [coords[0], coords[coords.length-1]];
  const kept = [];
  for(const p of cand){
    if(kept.length >= GMAPS_MAX_WP) break;
    if([...ends, ...kept].every(q => haversine(p, q) >= GMAPS_MIN_GAP)) kept.push(p);
  }
  return kept;
}
function googleMapsUrl(){
  if(!state.from || !state.to) return null;
  const f = (lat,lon) => `${(+lat).toFixed(5)},${(+lon).toFixed(5)}`;
  let u = `https://www.google.com/maps/dir/?api=1&origin=${f(state.from.lat,state.from.lon)}&destination=${f(state.to.lat,state.to.lon)}&travelmode=bicycling`;
  const vias = state.vias.filter(Boolean).map(v=>[v.lat,v.lon]);
  const r = state.route;
  let pts;
  if(vias.length) pts = vias.slice(0, GMAPS_MAX_WP);                          // real stops matter most
  else if(r && r.coords && r.coords.length>2) pts = spacedShapeWaypoints(r.coords);  // else a few well-spaced hints
  else pts = [];
  const wps = pts.map(p=>f(p[0],p[1]));
  if(wps.length) u += `&waypoints=${encodeURIComponent(wps.join('|'))}`;      // omit entirely when none survive
  return u;
}

/* ---- GPX (export + hand off to OsmAnd, which follows the EXACT track) ---- */
function buildGPX(){
  const r = state.route; if(!r) return null;
  const name = `${shortLabel(state.from&&state.from.label)} to ${shortLabel(state.to&&state.to.label)}`.trim() || 'FietsNav route';
  // a <rte> (route, with the shape points) + a <trk> (track): OsmAnd's "Navigate by Track" follows
  // the trkseg verbatim; the rte helps apps that prefer route semantics.
  let trk=''; r.coords.forEach(c=>{ trk += `<trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}"></trkpt>\n`; });
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`+
    `<gpx version="1.1" creator="FietsNav" xmlns="http://www.topografix.com/GPX/1/1">\n`+
    `<metadata><name>${esc(name)}</name></metadata>\n`+
    `<trk><name>${esc(name)}</name><trkseg>\n${trk}</trkseg></trk>\n</gpx>\n`;
  const filename = (name.replace(/[^\w\- ]+/g,'').replace(/\s+/g,'_')||'route') + '.gpx';
  return { name, gpx, filename };
}
function downloadFile(content, type, filename){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function exportGPX(){
  const g = buildGPX(); if(!g){ return; }
  try{ downloadFile(g.gpx, 'application/gpx+xml', g.filename); toast('GPX exported ⬇'); haptic(20); }
  catch(e){ toast('Could not export GPX'); }
}
/* Hand the exact route to OsmAnd: prefer the native share sheet with the .gpx file (best on iOS,
   one tap to "Copy to OsmAnd"); otherwise download the file and tell the user how to import it.
   OsmAnd's "Navigate by Track" then follows OUR polyline verbatim with voice. */
async function openInOsmAnd(){
  const g = buildGPX(); if(!g) return;
  haptic(10);
  try{
    if(navigator.canShare && typeof File!=='undefined'){
      const file = new File([g.gpx], g.filename, {type:'application/gpx+xml'});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:g.name, text:'Open in OsmAnd → Navigate by Track'});
        toast('In OsmAnd: ⋮ → Navigate by Track');
        return;
      }
    }
  }catch(e){ if(e && e.name==='AbortError') return; /* fall through to download */ }
  try{
    downloadFile(g.gpx, 'application/gpx+xml', g.filename);
    toast('Saved .gpx — open it in OsmAnd → Plan a route → Navigate by Track');
  }catch(e){ toast('Could not create the GPX file'); }
}

/* =========================================================
   NAVIGATION (GPS follow + voice + reroute)
   ========================================================= */
let wakeLock=null;
async function requestWakeLock(){
  if(!store.settings.keepAwake) return;
  try{ if(navigator.wakeLock){ wakeLock = await navigator.wakeLock.request('screen'); } }catch(e){}
}
function releaseWakeLock(){ try{ if(wakeLock){ wakeLock.release(); wakeLock=null; } }catch(e){} }
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', ()=>{ if(state.nav && document.visibilityState==='visible') requestWakeLock(); });
}

function showRecenter(on){ const b=$('#recenterBtn'); if(b) b.classList.toggle('hide', !on); }

function startNav(){
  if(!state.route){ return; }
  if(!('geolocation' in navigator)){ toast('No GPS on this device'); return; }
  state.nav = true; state.lastSnapIdx = 0; state.offCount=0; state.announced={}; state.follow=true;
  state.navZoom = 17; state.navZoomed = false; state.courseUp = true;
  $('#nav').classList.add('on'); $('#navbar').classList.add('on');
  $('#search').style.display='none';
  showSheet(false);
  $('#layersBtn').classList.add('hide'); $('#locBtn').classList.add('hide');
  $('#compassBtn').classList.remove('hide');
  document.body.classList.add('navmode');
  updateMuteBtn();
  requestWakeLock();
  enableOrientation();                 // this tap also grants iOS compass permission + unlocks speech
  haptic(30);
  // zoom straight in to the nav view if we already have a position, then turn on course-up
  if(state.userPos){ state.programmaticMove=true; state.navZoomed=true; map.setView(state.userPos, state.navZoom, {animate:false}); }
  setCourseUp(true);
  speak('Starting navigation. ' + turnText(state.route.turns[0]));
  state.watchId = navigator.geolocation.watchPosition(onPos, e=>toast('GPS lost — '+e.message),
    {enableHighAccuracy:true, maximumAge:1000, timeout:15000});
}
function stopNav(){
  state.nav=false; state.follow=true; state.navZoomed=false;
  if(state.watchId!=null){ navigator.geolocation.clearWatch(state.watchId); state.watchId=null; }
  disableOrientation();
  // undo course-up: clear rotation + the oversized map, then resize back
  const mapEl = map.getContainer();
  if(mapEl){ if(mapEl.classList) mapEl.classList.remove('courseup'); if(mapEl.style) clearMapSize(mapEl); }
  try{ map.invalidateSize({animate:false}); }catch(e){}
  $('#nav').classList.remove('on'); $('#navbar').classList.remove('on');
  $('#navThen').style.display='none';
  $('#search').style.display='';
  $('#layersBtn').classList.remove('hide'); $('#locBtn').classList.remove('hide');
  $('#compassBtn').classList.add('hide');
  showRecenter(false);
  styleUserMarker();              // arrow puck → plain dot
  document.body.classList.remove('navmode');
  releaseWakeLock();
  if(state.route) showSheet(true, 'peek'); else positionFabs();
  try{ speechSynthesis.cancel(); }catch(e){}
}

function ensureUserMarker(lat, lon){
  if(!state.userMarker){
    const html = '<div class="userwrap"><div class="navarrow">'+
      '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M12 2l7 19-7-4.2L5 21z" fill="#1971c2" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'+
      '</div><div class="userdot"></div></div>';
    state.userMarker = L.marker([lat,lon], {icon:L.divIcon({className:'', html, iconSize:[42,42], iconAnchor:[21,21]}),
      zIndexOffset:1000, rotation:0, rotateWithView:false}).addTo(map);
  } else state.userMarker.setLatLng([lat,lon]);
  styleUserMarker();
}
// the heading we orient by: GPS travel direction when we have it (stable while riding),
// else the device compass (good before the first move / when stationary).
function currentHeading(){
  if(typeof state.heading==='number' && !isNaN(state.heading)) return state.heading;
  if(typeof state.compassHeading==='number' && !isNaN(state.compassHeading)) return state.compassHeading;
  return 0;
}
function styleUserMarker(){
  const m = state.userMarker; if(!m || !m.getElement) return;
  const el = m.getElement(); if(!el || !el.querySelector) return;
  const wrap = el.querySelector('.userwrap'); if(wrap && wrap.classList) wrap.classList.toggle('nav', !!state.nav);
  const arr = el.querySelector('.navarrow');
  if(arr && arr.style){
    // course-up: the map is rotated by -heading, so rotate the arrow by +heading → it points UP.
    // north-up: rotate the arrow to the travel direction.
    const ang = (state.nav && state.courseUp) ? currentHeading() : (state.heading==null ? 0 : state.heading);
    arr.style.transform = 'rotate('+ang.toFixed(1)+'deg)';
  }
}
// course-up: rotate the WHOLE map (CSS transform on the Leaflet container, oversized so the
// rotated corners stay filled). No plugin — leaflet-rotate previously pushed the map off-screen.
function applyMapRotation(){
  const el = map.getContainer(); if(!el || !el.style) return;
  if(state.nav && state.courseUp){ el.style.transform = 'rotate('+(-currentHeading()).toFixed(1)+'deg)'; }
  else { el.style.transform = ''; }
  styleUserMarker();
}
// size the map to a centered SQUARE covering the viewport diagonal, so no rotation angle ever
// exposes a blank corner (a tall, narrow phone needs ~the diagonal, not a fixed %).
function sizeMapForCourseUp(el){
  const W=(typeof innerWidth==='number'&&innerWidth)?innerWidth:375, H=(typeof innerHeight==='number'&&innerHeight)?innerHeight:800;
  const side=Math.ceil(Math.sqrt(W*W+H*H))+6;
  el.style.width=side+'px'; el.style.height=side+'px';
  el.style.left=Math.round((W-side)/2)+'px'; el.style.top=Math.round((H-side)/2)+'px';
  el.style.right='auto'; el.style.bottom='auto';
}
function clearMapSize(el){ ['width','height','left','top','right','bottom','transform'].forEach(k=>{ el.style[k]=''; }); }
function setCourseUp(on){
  state.courseUp = !!on;
  const el = map.getContainer();
  if(el && el.style){
    if(state.nav && state.courseUp){ if(el.classList) el.classList.add('courseup'); sizeMapForCourseUp(el); }
    else { if(el.classList) el.classList.remove('courseup'); clearMapSize(el); }
  }
  try{ map.invalidateSize({animate:false}); }catch(e){}
  if(state.userPos && state.follow){ state.programmaticMove=true; map.panTo(state.userPos, {animate:false}); }
  applyMapRotation();
  const b=$('#compassBtn'); if(b && b.classList) b.classList.toggle('on', state.courseUp);
}
function onDeviceOrientation(e){
  let h=null;
  if(typeof e.webkitCompassHeading==='number' && !isNaN(e.webkitCompassHeading)) h=e.webkitCompassHeading;   // iOS: deg from north, CW
  else if(e.absolute && typeof e.alpha==='number' && !isNaN(e.alpha)) h=(360 - e.alpha)%360;                 // Android absolute
  if(h==null) return;
  state.compassHeading=h;
  if(state.nav && state.courseUp && state.heading==null) applyMapRotation();   // only drive rotation before GPS heading exists
}
async function enableOrientation(){
  try{
    const DOE = (typeof DeviceOrientationEvent!=='undefined') ? DeviceOrientationEvent : null;
    if(DOE && typeof DOE.requestPermission==='function'){      // iOS 13+ needs a user-gesture grant
      let res; try{ res = await DOE.requestPermission(); }catch(e){ res='denied'; }
      if(res!=='granted') return;
    }
    if(typeof window!=='undefined' && window.addEventListener){
      window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
    }
  }catch(e){}
}
function disableOrientation(){
  try{ window.removeEventListener('deviceorientationabsolute', onDeviceOrientation, true); window.removeEventListener('deviceorientation', onDeviceOrientation, true); }catch(e){}
}

function onPos(pos){
  const lat=pos.coords.latitude, lon=pos.coords.longitude;
  const prev = state.userPos;
  state.userPos=[lat,lon];
  // heading: prefer GPS course when actually moving, else infer from movement, else keep last
  let hdg = state.heading;
  const c = pos.coords;
  if(typeof c.heading==='number' && !isNaN(c.heading) && (c.speed==null || c.speed>0.7)) hdg = c.heading;
  else if(prev && haversine(prev,[lat,lon])>4) hdg = bearing(prev,[lat,lon]);
  if(typeof hdg==='number' && !isNaN(hdg)) state.heading = hdg;
  ensureUserMarker(lat,lon);
  if(!state.nav){ return; }
  const r=state.route;
  const snap = snapToRoute([lat,lon], r);
  // off-route?
  if(snap.off > 45){ state.offCount++; if(state.offCount>=3 && !state.rerouting){ reroute(lat,lon); return; } }
  else state.offCount=0;

  if(state.follow){
    state.programmaticMove=true;
    // zoom in to the navigation zoom ONCE; after that only pan, so the user's own
    // pinch-zoom (in or out) sticks even as they keep moving.
    // Instant recentre (no pan/zoom animation). Animated follow can leave tiles blank when GPS
    // updates arrive faster than the animation finishes — instant keeps the map solid.
    state.navZoomed=true;
    if(map.getZoom() < state.navZoom - 0.5) map.setView([lat,lon], state.navZoom, {animate:false});
    else map.panTo([lat,lon], {animate:false});
    if(state.courseUp) applyMapRotation();   // rotate so the travel direction points up
  }
  if(!state.follow) styleUserMarker();        // keep the arrow heading current even when not following

  // find next maneuver (first with cum > along + 4m)
  const along = snap.along;
  let nextIdx = r.turns.findIndex(t=>t.cum > along + 4);
  if(nextIdx<0) nextIdx = r.turns.length-1;
  const t = r.turns[nextIdx];
  const distTo = Math.max(0, t.cum - along);

  // banner
  $('#navArr').textContent = ARROWS[t.type]||'⬆';
  $('#navIn').textContent = t.type==='arrive' ? '' : `In ${fmtD(distTo)}`;
  $('#navMain').textContent = turnText(t, false);
  $('#navName').textContent = (t.type!=='arrive' && t.name) ? (t.type==='depart'? '' : t.name) : '';
  const then = r.turns[nextIdx+1];
  if(then && distTo<400){ $('#navThen').style.display='flex'; $('#navThen').innerHTML = `<span>then</span> ${ARROWS[then.type]} ${esc(turnText(then,false))}`; }
  else $('#navThen').style.display='none';

  // ETA / remaining
  const remain = Math.max(0, r.dist - along);
  const remainTime = r.time * (r.dist>0? remain/r.dist : 0);
  $('#navEta').textContent = etaClock(remainTime);
  $('#navMeta').textContent = `${fmtD(remain)} · ${fmtT(remainTime)} left`;

  // arrival
  if(remain < 22){ speak('You have arrived at your destination.'); toast('You have arrived 🎉'); haptic([40,60,40]); stopNav(); return; }

  // voice announcements per maneuver
  announce(nextIdx, t, distTo);
}

function announce(idx, t, distTo){
  const key = 'm'+idx;
  const st = state.announced[key] || {};
  const txt = turnText(t, true);
  if(t.type==='arrive'){
    if(distTo<120 && !st.near){ st.near=true; speak('Almost there. '+txt); }
  } else {
    if(distTo<=320 && distTo>140 && !st.far){ st.far=true; speak(`In ${fmtD(distTo)}, ${txt}.`); }
    else if(distTo<=140 && distTo>45 && !st.mid){ st.mid=true; if(!st.far) speak(`In ${fmtD(distTo)}, ${txt}.`); }
    else if(distTo<=45 && !st.now){ st.now=true; haptic(40); speak(txt + (t.name && t.type!=='uturn' ? '' : ' now')); }
  }
  state.announced[key]=st;
}

async function reroute(lat, lon){
  state.rerouting=true; toast('Off route — recalculating…');
  setPoint('from', {lat, lon, label:'Your location'});
  try{
    const g = await brouterRoute(state.route.profile, 0);
    const r = parseRoute(g);
    state.routes=[r]; state.activeAlt=0; state.routeLabels=tierLabels(1); state.route=r;
    state.lastSnapIdx=0; state.announced={};
    drawRoutes();
    speak('Route updated.');
  }catch(e){ toast('Reroute failed'); }
  state.rerouting=false; state.offCount=0;
}

/* snap GPS to route polyline → {along (m from start), off (m), idx} */
function snapToRoute(p, r){
  const c=r.coords;
  let lo=Math.max(0, state.lastSnapIdx-40), hi=Math.min(c.length-1, state.lastSnapIdx+120);
  let best={off:Infinity, along:0, idx:lo};
  const scan=(a,b)=>{
    for(let i=a;i<b;i++){
      const seg=projectToSeg(p, c[i], c[i+1]);
      if(seg.dist<best.off){ best={off:seg.dist, along:r.cum[i]+seg.t*haversine(c[i],c[i+1]), idx:i}; }
    }
  };
  scan(lo,hi);
  if(best.off>60){ best={off:Infinity, along:0, idx:0}; scan(0, c.length-1); } // global fallback
  state.lastSnapIdx=best.idx;
  return best;
}
function projectToSeg(p, a, b){
  // local equirectangular around a
  const ref=toRad(a[0]);
  const ax=0, ay=0;
  const bx=(toRad(b[1])-toRad(a[1]))*Math.cos(ref)*R, by=(toRad(b[0])-toRad(a[0]))*R;
  const px=(toRad(p[1])-toRad(a[1]))*Math.cos(ref)*R, py=(toRad(p[0])-toRad(a[0]))*R;
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy||1e-9;
  let t=((px-ax)*dx+(py-ay)*dy)/len2; t=Math.max(0,Math.min(1,t));
  const cx=ax+t*dx, cy=ay+t*dy;
  return { t, dist:Math.hypot(px-cx, py-cy) };
}

/* voice */
function speak(text){
  if(!store.settings.voice) return;
  if(!('speechSynthesis' in window)) return;
  try{
    const u=new SpeechSynthesisUtterance(text);
    u.lang='en-GB'; u.rate=1.02; u.volume=1;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){}
}
function updateMuteBtn(){ const b=$('#muteBtn'); if(b){ const on=!!store.settings.voice; b.classList.toggle('off', !on); b.setAttribute('aria-pressed', on?'true':'false'); b.setAttribute('aria-label', on?'Voice on':'Voice off'); } }

/* =========================================================
   POIs (Overpass)
   ========================================================= */
async function loadPOIs(){
  if(state.nav) return;
  const active = Object.entries(state.pois).filter(([,v])=>v).map(([k])=>k);
  poiLayer.clearLayers();
  if(!active.length) return;
  if(map.getZoom() < 12){ toast('Zoom in to see points of interest'); return; }
  const b=map.getBounds();
  const bbox=`${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  const parts=[];
  if(state.pois.nodes) parts.push(`node["rcn_ref"](${bbox});`);
  if(state.pois.parking) parts.push(`node["amenity"="bicycle_parking"](${bbox});`);
  if(state.pois.ferry){ parts.push(`node["amenity"="ferry_terminal"](${bbox});`); parts.push(`way["route"="ferry"](${bbox});`); }
  if(state.pois.station) parts.push(`node["railway"="station"]["station"!="subway"](${bbox});`);
  const q=`[out:json][timeout:20];(${parts.join('')});out center 250;`;
  try{
    const r=await fetch(OVERPASS, {method:'POST', body:'data='+encodeURIComponent(q)});
    const j=await r.json();
    (j.elements||[]).forEach(el=>{
      const lat=el.lat||(el.center&&el.center.lat), lon=el.lon||(el.center&&el.center.lon);
      if(lat==null) return;
      let emoji='📍', name='';
      const tg=el.tags||{};
      if(tg.rcn_ref){
        L.marker([lat,lon], {icon:L.divIcon({className:'', html:`<div class="nodemk">${esc(tg.rcn_ref)}</div>`, iconSize:[28,28], iconAnchor:[14,14]})})
          .bindPopup(`<b>🔵 Knooppunt ${esc(tg.rcn_ref)}</b>`).addTo(poiLayer); return;
      }
      if(tg.amenity==='bicycle_parking'){ emoji='🅿️'; name=tg.capacity?`Bike parking (${tg.capacity})`:'Bike parking'; }
      else if(tg.amenity==='ferry_terminal'||tg.route==='ferry'){ emoji='⛴️'; name=tg.name||'Ferry'; }
      else if(tg.railway==='station'){ emoji='🚉'; name=tg.name||'Station'; }
      L.marker([lat,lon], {icon:L.divIcon({className:'', html:`<div class="poi-emoji">${emoji}</div>`, iconSize:[28,28], iconAnchor:[14,14]})})
        .bindPopup(`<b>${emoji} ${esc(name)}</b>`).addTo(poiLayer);
    });
  }catch(e){ toast('Could not load points right now'); }
}
const loadPOIsDebounced = debounce(loadPOIs, 500);
map.on('moveend', ()=>{
  if(state.programmaticMove){ state.programmaticMove=false; return; }
  if(Object.values(state.pois).some(Boolean)) loadPOIsDebounced();
});

/* =========================================================
   SAVED PLACES & ROUTES
   ========================================================= */
function saveCurrentRoute(){
  if(!state.from||!state.to) return;
  const name = `${shortLabel(state.from.label)} → ${shortLabel(state.to.label)}`;
  store.routes.unshift({ id:Date.now(), name, from:state.from, to:state.to, vias:state.vias.slice(), profile:state.profile });
  store.routes = store.routes.slice(0,20);
  saveStore(); toast('Route saved ★'); haptic(20); renderDrawer();
}
function shortLabel(s){ return (s||'').split(',')[0].slice(0,22); }

function renderDrawer(){
  // quick places: home + work
  const qp = $('#quickPlaces');
  const slot = (kind, emoji, label) => {
    const pl = store.places[kind];
    if(pl){
      return `<div class="saveitem" data-go="${kind}"><span class="em">${emoji}</span>
        <div class="info"><div class="t">${label}</div><div class="s">${esc(pl.label)}</div></div>
        <button class="del" data-del-place="${kind}" title="Remove" aria-label="Remove">🗑</button></div>`;
    }
    return `<div class="saveitem" data-set="${kind}"><span class="em">${emoji}</span>
      <div class="info"><div class="t">Set ${label}</div><div class="s">Use current destination or your location</div></div></div>`;
  };
  qp.innerHTML = slot('home','🏠','Home') + slot('work','💼','Work');

  // favorite routes
  const fr=$('#favRoutes');
  if(!store.routes.length){ fr.innerHTML = `<div class="draw-empty">No saved routes yet. Plan a route, then tap ★.</div>`; }
  else fr.innerHTML = store.routes.map(rt=>`
    <div class="saveitem" data-route="${rt.id}"><span class="em">🚲</span>
      <div class="info"><div class="t">${esc(rt.name)}</div><div class="s">${profileName(rt.profile)}</div></div>
      <button class="del" data-del-route="${rt.id}" title="Remove" aria-label="Remove">🗑</button></div>`).join('');

  // recent searches
  const rl=$('#recentList');
  if(rl){
    if(!(store.recents||[]).length){ rl.innerHTML = `<div class="draw-empty">Places you search will appear here.</div>`; }
    else rl.innerHTML = store.recents.map((rc,i)=>`
      <div class="saveitem" data-recent="${i}"><span class="em">🕘</span>
        <div class="info"><div class="t">${esc(rc.label)}</div><div class="s">${esc(rc.sub||'')}</div></div>
        <button class="del" data-del-recent="${i}" title="Remove" aria-label="Remove">🗑</button></div>`).join('');
  }

  // wire
  $$('[data-go]', qp).forEach(el=>el.addEventListener('click', e=>{ if(e.target.closest('[data-del-place]')) return; goToPlace(el.dataset.go); }));
  $$('[data-set]', qp).forEach(el=>el.addEventListener('click', ()=>setPlace(el.dataset.set)));
  $$('[data-del-place]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); delete store.places[b.dataset.delPlace]; saveStore(); renderDrawer(); }));
  $$('[data-route]', fr).forEach(el=>el.addEventListener('click', e=>{ if(e.target.closest('[data-del-route]')) return; loadRoute(el.dataset.route); }));
  $$('[data-del-route]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); store.routes=store.routes.filter(r=>r.id!=b.dataset.delRoute); saveStore(); renderDrawer(); }));
  if(rl){
    $$('[data-recent]', rl).forEach(el=>el.addEventListener('click', e=>{ if(e.target.closest('[data-del-recent]')) return; useRecent(parseInt(el.dataset.recent)); }));
    $$('[data-del-recent]').forEach(b=>b.addEventListener('click', e=>{ e.stopPropagation(); store.recents.splice(parseInt(b.dataset.delRecent),1); saveStore(); renderDrawer(); }));
  }
}
function profileName(p){ return {trekking:'Recommended', hybrid:'Smart', scenic:'Scenic', fastbike:'Fast', safety:'Quiet', shortest:'Shortest'}[p]||p; }

function useRecent(i){
  const rc = store.recents[i]; if(!rc) return;
  setPoint('to', {lat:rc.lat, lon:rc.lon, label:rc.label}); $('#inTo').value=rc.label;
  closeDrawer();
  if(!state.from){ useMyLocationFor('from'); } else maybeRoute();
}
function setPlace(kind){
  // prefer current destination, else current location
  if(state.to){ store.places[kind]={...state.to}; saveStore(); renderDrawer(); toast(`${kind==='home'?'Home':'Work'} saved`); }
  else { navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=pos.coords.latitude, lon=pos.coords.longitude;
      store.places[kind]={lat, lon, label:await reverseGeocode(lat,lon)}; saveStore(); renderDrawer(); toast('Saved');
    }, ()=>toast('Set a destination first, then save it as Home/Work')); }
}
function goToPlace(kind){
  const pl=store.places[kind]; if(!pl) return;
  setPoint('to', {...pl}); $('#inTo').value=pl.label;
  closeDrawer();
  if(!state.from){ useMyLocationFor('from'); } else maybeRoute();
}
function loadRoute(id){
  const rt=store.routes.find(r=>r.id==id); if(!rt) return;
  state.from={...rt.from}; state.to={...rt.to}; state.vias=(rt.vias||[]).map(v=>({...v}));
  state.profile='scenic';               // scenic-only app
  $('#inFrom').value=rt.from.label; $('#inTo').value=rt.to.label;
  renderViaFields(); drawEndpoints(); syncChips(); closeDrawer(); computeRoute();
}

/* =========================================================
   THEME (light / dark / auto)
   ========================================================= */
function resolveTheme(){
  const pref = store.settings.theme || 'auto';
  if(pref==='light' || pref==='dark') return pref;
  try{ return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }
  catch(e){ return 'light'; }
}
function applyTheme(){
  const dark = resolveTheme()==='dark';
  try{ document.documentElement.dataset.theme = dark?'dark':'light'; }catch(e){}
  const icon=$('#themeIcon');
  if(icon){
    icon.innerHTML = dark
      ? '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }
  // pair the map style with the theme (but respect an explicit Dark/Light pick)
  if(dark && currentBase==='light') switchBase('dark');
  else if(!dark && currentBase==='dark') switchBase('light');
  // reflect in the settings segmented control
  $$('#themeSeg button').forEach(b=>b.dataset.on = b.dataset.themePref===(store.settings.theme||'auto')?'1':'0');
}
function switchBase(b){
  if(b===currentBase) return;          // no-op: don't reload the identical layer
  if(!(b in baseLayers)) return;
  try{ map.removeLayer(baseLayers[currentBase]); }catch(e){}
  currentBase=b; baseLayers[currentBase].addTo(map);
  Object.entries(state.overlays).forEach(([k,v])=>{ if(v){ try{map.removeLayer(overlayLayers[k]);}catch(e){} overlayLayers[k].addTo(map); } });
  store.settings.base=currentBase; saveStore();
  $$('.baseb', $('#pop')).forEach(x=>x.dataset.on = x.dataset.base===currentBase?'1':'0');
}
try{
  if(window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onCh = ()=>{ if((store.settings.theme||'auto')==='auto') applyTheme(); };
    if(mq.addEventListener) mq.addEventListener('change', onCh); else if(mq.addListener) mq.addListener(onCh);
  }
}catch(e){}

/* =========================================================
   BOTTOM SHEET (mobile) — peek / full with drag
   ========================================================= */
let sheetMode='peek', sheetY=0, drag=null;
function applySheetY(y){ sheetY=y; const s=$('#sheet'); if(s) s.style.transform='translateY('+y+'px)'; positionFabs(); }
/* keep the floating controls just above whichever bottom panel (sheet / nav bar) is showing.
   Uses stable layout height + the target translateY (not the animating rect) so it lands right. */
function positionFabs(){
  const fabs=$('#fabs'); if(!fabs || !fabs.style) return;
  if(!isMobile()){ fabs.style.bottom=''; return; }
  let visible=null;
  if(state.nav){ const nb=$('#navbar'); if(nb && nb.classList.contains('on')){ const h=nb.offsetHeight; if(typeof h==='number' && h>0) visible=h; } }
  else { const s=$('#sheet'); if(s && s.classList.contains('show')){ const H=s.offsetHeight; if(typeof H==='number' && isFinite(H)) visible=H-sheetY; } }
  if(typeof visible==='number' && isFinite(visible) && visible>0){
    const cap=(typeof innerHeight==='number'?innerHeight:800)*0.6;   // never crowd the top
    fabs.style.bottom = (Math.min(visible, cap) + 12) + 'px';
  } else { fabs.style.bottom=''; }
}
function peekTarget(){
  const s=$('#sheet'); if(!s) return 0;
  const total=s.offsetHeight||0;
  const sum=$('.summary'), grab=$('#grab');
  let show=(sum?sum.offsetHeight:240)+(grab?grab.offsetHeight:26)+10;
  // cap the peek so the map stays visible and the FAB stack has room above the sheet
  const cap=(typeof innerHeight==='number'?innerHeight:800)*0.48;
  if(show>cap) show=cap;
  return Math.max(0, total-show);
}
/* minimized ("completely down"): slide the sheet off-screen except its grab handle,
   so the map is fully visible but you can still pull the route back up. */
function minTarget(){
  const s=$('#sheet'); if(!s) return 0;
  const total=s.offsetHeight||0;
  const grab=$('#grab');
  const h=(grab && typeof grab.offsetHeight==='number') ? grab.offsetHeight : 32;
  return Math.max(0, total-h);
}
/* Tallest the sheet may be on mobile: it must stop just below the search card so that, when
   expanded to "full", its grab handle + top content never hide behind the from/to inputs
   (which sit above it at a higher z-index). Without this the handle is unreachable → the
   sheet can't be tapped/dragged back down. */
function sheetCap(){
  const vh = (typeof innerHeight==='number' && isFinite(innerHeight)) ? innerHeight : 800;
  let top = 8;
  const sc=$('#search');
  if(sc && sc.getBoundingClientRect){ const r=sc.getBoundingClientRect(); if(r && typeof r.bottom==='number' && r.bottom>0) top=r.bottom; }
  return Math.max(180, Math.round(vh - top - 12));
}
function setSheetMode(mode){
  const s=$('#sheet'); if(!s) return;
  if(!isMobile()){ s.style.transform=''; s.style.maxHeight=''; positionFabs(); return; }
  sheetMode=mode;
  s.style.maxHeight = sheetCap()+'px';          // keep "full" below the search card
  if(mode==='full') applySheetY(0);
  else if(mode==='min') applySheetY(minTarget());
  else applySheetY(peekTarget());
  s.classList.toggle('full', mode==='full');    // flips the handle chevron (▲ expand, ▼ collapse)
  s.classList.toggle('min', mode==='min');
  const g=$('#grab'); if(g && g.setAttribute) g.setAttribute('aria-expanded', mode==='full'?'true':'false');
}
function showSheet(on, mode){
  const s=$('#sheet'); if(!s) return;
  if(isMobile()){
    if(on){ s.classList.add('show'); setSheetMode(mode||sheetMode||'peek'); }
    else { s.classList.remove('show'); s.style.transform=''; positionFabs(); }
  } else {
    s.classList.toggle('show', !!on); s.style.transform=''; s.style.maxHeight=''; positionFabs();
  }
}
function wireSheetDrag(){
  const grab=$('#grab'); if(!grab || !grab.addEventListener) return;
  const down = e=>{
    if(!isMobile()) return;
    const y = (e.touches?e.touches[0].clientY:e.clientY);
    drag={startY:y, base:sheetY, moved:false, maxY:minTarget()}; const s=$('#sheet'); if(s) s.classList.add('dragging');
    if(grab.setPointerCapture && e.pointerId!=null){ try{grab.setPointerCapture(e.pointerId);}catch(_){} }
  };
  const move = e=>{
    if(!drag) return;
    const y=(e.touches?e.touches[0].clientY:e.clientY);
    if(Math.abs(y-drag.startY)>6) drag.moved=true;
    // clamp between full (0) and minimized so the handle always stays on screen
    let ny=Math.max(0, Math.min(drag.maxY, drag.base+(y-drag.startY)));
    applySheetY(ny);
    if(e.cancelable) e.preventDefault();
  };
  const up = ()=>{
    if(!drag) return;
    const s=$('#sheet'); if(s) s.classList.remove('dragging');
    if(!drag.moved){
      // tap the handle: the chevron always points where this goes — min↑peek, peek↑full, full↓peek
      setSheetMode(sheetMode==='min' ? 'peek' : (sheetMode==='full' ? 'peek' : 'full'));
    } else {
      // released a drag: snap to whichever detent (full / peek / minimized) is nearest
      const detents=[['full',0],['peek',peekTarget()],['min',minTarget()]];
      let best='peek', bd=Infinity;
      for(const [m,ty] of detents){ const d=Math.abs(sheetY-ty); if(d<bd){ bd=d; best=m; } }
      setSheetMode(best);
    }
    drag=null;
  };
  grab.addEventListener('pointerdown', down);
  grab.addEventListener('pointermove', move, {passive:false});
  grab.addEventListener('pointerup', up);
  grab.addEventListener('pointercancel', up);
  // touch fallback
  grab.addEventListener('touchstart', down, {passive:true});
  grab.addEventListener('touchmove', move, {passive:false});
  grab.addEventListener('touchend', up);
  // keyboard: Enter/Space on the focused handle toggles up/down (no click handler, so no tap double-fire)
  grab.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' ' || e.key==='Spacebar'){ e.preventDefault(); e.stopPropagation(); setSheetMode(sheetMode==='full' ? 'peek' : 'full'); }
  });
}

/* =========================================================
   UI WIRING
   ========================================================= */
$('#swapBtn').addEventListener('click', ()=>{
  [state.from, state.to] = [state.to, state.from];
  $('#inFrom').value = state.from ? state.from.label : '';
  $('#inTo').value   = state.to   ? state.to.label   : '';
  drawEndpoints(); syncChips(); maybeRoute();
});
$('#addViaBtn').addEventListener('click', ()=>{ state.vias.push(null); renderViaFields(); $(`#via-${state.vias.length-1}`)?.focus(); });

/* explicit "Find route" — routing runs only on this press, never automatically */
$('#findBtn').addEventListener('click', ()=>{
  if(state.routing || !state.from || !state.to) return;
  haptic(10); computeRoute();
});

/* one-tap: set the start to my current location */
$('#useMineBtn').addEventListener('click', ()=>{ haptic(10); useMyLocationFor('from'); });

/* locate */
$('#locBtn').addEventListener('click', ()=>{
  toast('Locating…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    ensureUserMarker(lat,lon); map.setView([lat,lon], 16);
  }, ()=>toast('Location unavailable — allow access & use HTTPS'), {enableHighAccuracy:true, timeout:10000});
});
$('#recenterBtn').addEventListener('click', ()=>{
  state.follow=true; showRecenter(false); haptic(10);
  if(state.userPos){ state.programmaticMove=true; map.setView(state.userPos, state.navZoom||Math.max(map.getZoom(),16), {animate:true}); }
  if(state.nav && state.courseUp) applyMapRotation();
});
$('#compassBtn').addEventListener('click', ()=>{ haptic(10); setCourseUp(!state.courseUp);
  toast(state.courseUp ? 'Course-up' : 'North-up'); });

/* theme toggle (brand) */
$('#themeBtn').addEventListener('click', ()=>{
  const cur = resolveTheme();
  store.settings.theme = cur==='dark' ? 'light' : 'dark';
  saveStore(); applyTheme(); haptic(10);
});

/* layers popover */
const pop=$('#pop'), layersBtn=$('#layersBtn');
function positionPop(){
  if(isMobile()){ pop.style.right=''; pop.style.bottom=''; return; }   // mobile: CSS positions it as a bottom sheet
  const rect=layersBtn.getBoundingClientRect();
  pop.style.right=(innerWidth-rect.right)+'px'; pop.style.bottom=(innerHeight-rect.top+10)+'px';
}
layersBtn.addEventListener('click', e=>{ e.stopPropagation(); positionPop(); pop.classList.toggle('open'); layersBtn.setAttribute('aria-expanded', pop.classList.contains('open')?'true':'false'); });
document.addEventListener('click', e=>{ if(!pop.contains(e.target) && e.target!==layersBtn && !layersBtn.contains(e.target)){ pop.classList.remove('open'); layersBtn.setAttribute('aria-expanded','false'); } });
$$('.baseb', pop).forEach(b=>b.addEventListener('click', ()=>{ switchBase(b.dataset.base); }));
$$('.opt[data-layer]', pop).forEach(o=>o.addEventListener('click', ()=>{
  const k=o.dataset.layer; const on=!state.overlays[k]; state.overlays[k]=on; o.dataset.on=on?'1':'0'; o.setAttribute('aria-checked', on?'true':'false');
  if(on) overlayLayers[k].addTo(map); else map.removeLayer(overlayLayers[k]);
}));
$$('.opt[data-poi]', pop).forEach(o=>o.addEventListener('click', ()=>{
  const k=o.dataset.poi; const on=!state.pois[k]; state.pois[k]=on; o.dataset.on=on?'1':'0'; o.setAttribute('aria-checked', on?'true':'false'); loadPOIs();
}));
$$('.opt[data-cmp]', pop).forEach(o=>o.addEventListener('click', ()=>setRoadCompare(!state.showRoadRoute)));

/* nav controls */
$('#stopBtn').addEventListener('click', stopNav);
$('#muteBtn').addEventListener('click', ()=>{ store.settings.voice=!store.settings.voice; saveStore(); updateMuteBtn();
  if(store.settings.voice) speak('Voice on'); else { try{speechSynthesis.cancel();}catch(e){} } });

/* drawer */
const drawer=$('#drawer');
function openDrawer(){ renderDrawer(); syncDrawerSettings(); drawer.classList.add('on'); }
function closeDrawer(){ drawer.classList.remove('on'); }
$('#menuBtn').addEventListener('click', openDrawer);
$('#drawClose').addEventListener('click', closeDrawer);
drawer.addEventListener('click', e=>{ if(e.target===drawer) closeDrawer(); });

function syncDrawerSettings(){
  $$('#themeSeg button').forEach(b=>b.dataset.on = b.dataset.themePref===(store.settings.theme||'auto')?'1':'0');
  $('#voiceToggle').dataset.on = store.settings.voice?'1':'0';
  $('#awakeToggle').dataset.on = store.settings.keepAwake?'1':'0';
}
$$('#themeSeg button').forEach(b=>b.addEventListener('click', ()=>{ store.settings.theme=b.dataset.themePref; saveStore(); applyTheme(); syncDrawerSettings(); }));
$('#voiceToggle').addEventListener('click', ()=>{ store.settings.voice=!store.settings.voice; saveStore(); updateMuteBtn(); syncDrawerSettings(); });
$('#awakeToggle').addEventListener('click', ()=>{ store.settings.keepAwake=!store.settings.keepAwake; saveStore(); syncDrawerSettings(); if(state.nav){ store.settings.keepAwake?requestWakeLock():releaseWakeLock(); } });

/* keyboard: let role=button / role=switch divs/spans activate with Enter or Space */
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter' && e.key!==' ' && e.key!=='Spacebar') return;
  const t=e.target;
  if(t && t.getAttribute && (t.getAttribute('role')==='button' || t.getAttribute('role')==='switch') && t.tabIndex>=0){
    e.preventDefault(); t.click();
  }
});

/* toast */
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'), 2600); }

/* re-evaluate layout on breakpoint change */
if(typeof window!=='undefined' && window.addEventListener){
  window.addEventListener('resize', debounce(()=>{
    const s=$('#sheet');
    if(!state.nav){
      if(!isMobile()){ if(s){ s.style.transform=''; s.classList.toggle('show', !!state.route || !isMobile()); } }
      else { if(state.route) showSheet(true, sheetMode); else showSheet(false); }
    }
    positionFabs();
  }, 200));
}

/* =========================================================
   INIT
   ========================================================= */
wireField($('#inFrom'), 'from');
wireField($('#inTo'), 'to');
wireSheetDrag();
$$('.baseb', pop).forEach(b=>b.dataset.on = b.dataset.base===currentBase?'1':'0');
// expose toggle/switch semantics to assistive tech + keyboard
$$('.opt', pop).forEach(o=>{ o.setAttribute('role','switch'); o.setAttribute('tabindex','0'); o.setAttribute('aria-checked', o.dataset.on==='1'?'true':'false'); });
applyTheme();
renderEmpty();
renderViaFields();
syncFindBtn();
updateMuteBtn();

/* PWA deep links / home-screen shortcuts: ?go=home|work  (e.g. "Navigate home") */
try{
  const params = new URLSearchParams(location.search || '');
  const go = params.get('go');
  if(go==='home' || go==='work'){ setTimeout(()=>{ if(store.places[go]) goToPlace(go); }, 500); }
}catch(e){}

/* try to show user location softly on load (no nagging) */
if('geolocation' in navigator && location.protocol==='https:'){
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    ensureUserMarker(lat,lon);
    if(!state.from && !state.to) map.setView([lat,lon], 13);
  }, ()=>{}, {timeout:8000, maximumAge:60000});
}

/* register service worker for installability/offline shell */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
