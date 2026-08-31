/* ---------- Astronomy core (Sun/Moon low-precision formulas) ---------- */
const DEG = Math.PI/180;
const sind=x=>Math.sin(x*DEG), cosd=x=>Math.cos(x*DEG);
const asind=x=>Math.asin(Math.max(-1,Math.min(1,x)))/DEG;
const acosd=x=>Math.acos(Math.max(-1,Math.min(1,x)))/DEG;
const atan2d=(y,x)=>Math.atan2(y,x)/DEG;
const norm360=x=>{x=x%360; return x<0?x+360:x;};
const norm24=x=>{x=x%24; return x<0?x+24:x;};

function toDaysSinceEpoch(y,m,d,h){
  if (m<=2){y-=1;m+=12;}
  const A=Math.floor(y/100), B=2-A+Math.floor(A/4);
  const JD=Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+h/24+B-1524.5;
  return JD-2451543.5;
}

function sunEqCoords(d){
  const w=norm360(282.9404+4.70935e-5*d), e=0.016709-1.151e-9*d;
  let M=norm360(356.0470+0.9856002585*d);
  const oblecl=23.4393-3.563e-7*d;
  let E=M+(180/Math.PI)*e*sind(M)*(1+e*cosd(M));
  for(let i=0;i<3;i++) E-= (E-(180/Math.PI)*e*sind(E)-M)/(1-e*cosd(E));
  const xv=cosd(E)-e, yv=Math.sqrt(1-e*e)*sind(E);
  const r=Math.sqrt(xv*xv+yv*yv), v=atan2d(yv,xv);
  const lonsun=norm360(v+w);
  const xs=r*cosd(lonsun), ys=r*sind(lonsun);
  const xe=xs, ye=ys*cosd(oblecl), ze=ys*sind(oblecl);
  return { ra: norm360(atan2d(ye,xe)), dec: asind(ze/r), lon: lonsun, r };
}

function moonEqCoords(d){
  const N=norm360(125.1228-0.0529538083*d), i=5.1454;
  const w=norm360(318.0634+0.1643573223*d), a=60.2666, e=0.054900;
  let M=norm360(115.3654+13.0649929509*d);
  let E=M+(180/Math.PI)*e*sind(M)*(1+e*cosd(M));
  for(let k=0;k<4;k++) E-= (E-(180/Math.PI)*e*sind(E)-M)/(1-e*cosd(E));
  const xv=a*(cosd(E)-e), yv=a*(Math.sqrt(1-e*e)*sind(E));
  const rGeom=Math.sqrt(xv*xv+yv*yv), v=atan2d(yv,xv);
  const xh=rGeom*(cosd(N)*cosd(v+w)-sind(N)*sind(v+w)*cosd(i));
  const yh=rGeom*(sind(N)*cosd(v+w)+cosd(N)*sind(v+w)*cosd(i));
  const zh=rGeom*(sind(v+w)*sind(i));
  let lonecl=atan2d(yh,xh), latecl=atan2d(zh,Math.sqrt(xh*xh+yh*yh));
  let r=Math.sqrt(xh*xh+yh*yh+zh*zh);

  const sun=sunEqCoords(d);
  const Ms=norm360(356.0470+0.9856002585*d);
  const Lm=norm360(N+w+M);
  const D=norm360(Lm-sun.lon), F=norm360(Lm-N), Mm=M;

  let dLon=0;
  dLon+=-1.274*sind(Mm-2*D); dLon+=0.658*sind(2*D); dLon+=-0.186*sind(Ms);
  dLon+=-0.059*sind(2*Mm-2*D); dLon+=-0.057*sind(Mm-2*D+Ms); dLon+=0.053*sind(Mm+2*D);
  dLon+=0.046*sind(2*D-Ms); dLon+=0.041*sind(Mm-Ms); dLon+=-0.035*sind(D);
  dLon+=-0.031*sind(Mm+Ms); dLon+=-0.015*sind(2*F-2*D); dLon+=0.011*sind(Mm-4*D);

  let dLat=0;
  dLat+=-0.173*sind(F-2*D); dLat+=-0.055*sind(Mm-F-2*D); dLat+=-0.046*sind(Mm+F-2*D);
  dLat+=0.033*sind(F+2*D); dLat+=0.017*sind(2*Mm+F);

  let dR=0; dR+=-0.58*cosd(Mm-2*D); dR+=-0.46*cosd(2*D);

  lonecl+=dLon; latecl+=dLat; r+=dR;

  const oblecl=23.4393-3.563e-7*d;
  const xh2=r*cosd(lonecl)*cosd(latecl), yh2=r*sind(lonecl)*cosd(latecl), zh2=r*sind(latecl);
  const xe=xh2, ye=yh2*cosd(oblecl)-zh2*sind(oblecl), ze=yh2*sind(oblecl)+zh2*cosd(oblecl);
  return { ra: norm360(atan2d(ye,xe)), dec: asind(ze/r), lon: norm360(lonecl), r };
}

function moonPhase(d){
  const moon=moonEqCoords(d), sun=sunEqCoords(d);
  const elong = Math.acos(sind(moon.dec)*sind(sun.dec)+cosd(moon.dec)*cosd(sun.dec)*cosd(moon.ra-sun.ra))/DEG;
  const illum = (1-Math.cos(elong*DEG))/2;
  const age = norm360(moon.lon-sun.lon)/360;
  let name;
  const a = age*8;
  if (a<0.5||a>=7.5) name="New Moon";
  else if (a<1.5) name="Waxing Crescent";
  else if (a<2.5) name="First Quarter";
  else if (a<3.5) name="Waxing Gibbous";
  else if (a<4.5) name="Full Moon";
  else if (a<5.5) name="Waning Gibbous";
  else if (a<6.5) name="Last Quarter";
  else name="Waning Crescent";
  return { illum, name };
}

/* ---------- Formatting helpers ---------- */
function fmtLocal(hoursFloat){
  if (hoursFloat===null||hoursFloat===undefined) return null;
  let h = Math.floor(hoursFloat), m = Math.round((hoursFloat-h)*60);
  if (m===60){ m=0; h+=1; }
  h = ((h%24)+24)%24;
  const ap = h<12 ? 'AM':'PM';
  let h12 = h%12; if (h12===0) h12=12;
  return `${h12}:${String(m).padStart(2,'0')} ${ap}`;
}
function addHours(t,h){ return t===null?null : norm24(t+h); }
function overlapsWithin(a,b,windowHrs){
  if (a===null||b===null||b===undefined) return false;
  let diff = Math.abs(a-b);
  diff = Math.min(diff, 24-diff);
  return diff <= windowHrs;
}
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

/* ---------- Per-day computation, now tide-aware ---------- */
function computeDay(date, lat, lon, tzOffsetHours, tideEventsForDay){
  const y0=date.getFullYear(), m0=date.getMonth()+1, d0=date.getDate();
  const off = tzOffsetHours/24;

  const solveLocal = (posFn, opts) => {
    const d0j = toDaysSinceEpoch(y0,m0,d0,0) + off;
    let ut = 12;
    for(let iter=0; iter<6; iter++){
      const d = d0j + ut/24;
      const sun = sunEqCoords(d);
      const GMST0 = norm360(sun.lon+180);
      const pos = posFn(d);
      let HA;
      if (opts.riseSetSign!==null && opts.riseSetSign!==undefined){
        const cosH0 = (sind(opts.h0Deg)-sind(lat)*sind(pos.dec))/(cosd(lat)*cosd(pos.dec));
        if (cosH0>1||cosH0<-1) return null;
        HA = opts.riseSetSign*acosd(cosH0);
      } else {
        HA = opts.haOffsetDeg;
      }
      ut = norm24((pos.ra+HA-GMST0-lon)/15);
    }
    return ut;
  };

  const sunrise = solveLocal(sunEqCoords, {riseSetSign:-1, h0Deg:-0.833});
  const sunset  = solveLocal(sunEqCoords, {riseSetSign:1,  h0Deg:-0.833});
  const moonrise= solveLocal(moonEqCoords,{riseSetSign:-1, h0Deg:0.125});
  const moonset = solveLocal(moonEqCoords,{riseSetSign:1,  h0Deg:0.125});
  const upperTransit = solveLocal(moonEqCoords, {haOffsetDeg:0});
  const lowerTransit = solveLocal(moonEqCoords, {haOffsetDeg:180});

  const phase = moonPhase(toDaysSinceEpoch(y0,m0,d0,12)+off);
  const extremeness = Math.abs(2*phase.illum-1);
  const phaseMult = 1 + 0.3*extremeness;

  const tides = tideEventsForDay || [];

  const windows = [];
  function addWindow(kind, center, halfSpan, baseScore){
    if (center===null) return;
    const start = addHours(center,-halfSpan), end = addHours(center,halfSpan);
    const sunOverlap = overlapsWithin(center, sunrise, 0.5) || overlapsWithin(center, sunset, 0.5);
    const nearTide = tides.find(t => overlapsWithin(center, t.hour, 0.75));
    const prime = sunOverlap || !!nearTide;
    let score = baseScore*phaseMult;
    if (sunOverlap) score += (kind==='Major'?2:1);
    if (nearTide) score += (kind==='Major'?1.5:1);
    windows.push({kind, start, end, center, prime, sunOverlap, tideEvent: nearTide||null, score});
  }
  addWindow('Major', upperTransit, 1, 3);
  addWindow('Major', lowerTransit, 1, 3);
  addWindow('Minor', moonrise, 0.5, 2);
  addWindow('Minor', moonset, 0.5, 2);

  const rawScore = windows.reduce((s,w)=>s+w.score,0);
  const MAX_PER_DAY = 2*(3*1.3+2+1.5) + 2*(2*1.3+1+1); // includes possible tide bonus headroom
  const rating = Math.max(0, Math.min(5, Math.round((rawScore/MAX_PER_DAY)*5)));

  windows.sort((a,b)=> (a.start??99)-(b.start??99));

  return { date, sunrise, sunset, moonrise, moonset, upperTransit, lowerTransit, phase, windows, rating, tides };
}

/* ---------- NOAA CO-OPS tide integration ---------- */
const tideCache = {}; // stationId -> { 'YYYY-MM-DD': [{hour, type, height}] }

function haversineMiles(lat1,lon1,lat2,lon2){
  const R=3958.8, dLat=(lat2-lat1)*DEG, dLon=(lon2-lon1)*DEG;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*DEG)*Math.cos(lat2*DEG)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

async function findNearestStation(lat, lon){
  const res = await fetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions');
  const data = await res.json();
  let best=null, bestDist=Infinity;
  for (const s of data.stations){
    const dist = haversineMiles(lat,lon,parseFloat(s.lat),parseFloat(s.lng));
    if (dist<bestDist){ bestDist=dist; best={ id:s.id, name:s.name, dist }; }
  }
  return best;
}

// Fetches hi/lo predictions for [startDate, endDate] inclusive, both Date objects (local calendar dates).
// Returns { 'YYYY-MM-DD': [{hour, type:'H'|'L', height}] } keyed in the station's own local time.
async function fetchTidePredictions(stationId, startDate, endDate){
  const fmt = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
    + `?product=predictions&application=tide-and-moon-app`
    + `&begin_date=${fmt(startDate)}&end_date=${fmt(endDate)}`
    + `&datum=MLLW&station=${encodeURIComponent(stationId)}`
    + `&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'NOAA station error');
  const byDate = {};
  for (const p of (data.predictions||[])){
    const [datePart, timePart] = p.t.split(' ');
    const [hh,mm] = timePart.split(':').map(Number);
    const hour = hh + mm/60;
    (byDate[datePart] ||= []).push({ hour, type: p.type, height: parseFloat(p.v) });
  }
  return byDate;
}

/* ---------- UI state ---------- */
let weekOffset = 0; // 0 = current 4-week window, +1 = next, -1 = previous (clamped to >=0)
let stationId = null;
let currentTideData = {}; // date-string -> events, for the currently displayed window
const tzOffsetHours = new Date().getTimezoneOffset()/60;

function windowBounds(){
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today); start.setDate(start.getDate() + weekOffset*28);
  const end = new Date(start); end.setDate(end.getDate()+27);
  return { today, start, end };
}

async function refreshTidesForWindow(lat, lon){
  const { start, end } = windowBounds();
  document.getElementById('tideStatus').textContent = stationId
    ? `Loading tide predictions for station ${stationId}…` : 'No tide station set — moon & sun windows only.';
  if (!stationId){ currentTideData = {}; return; }
  try{
    currentTideData = await fetchTidePredictions(stationId, start, end);
    document.getElementById('tideStatus').textContent = `Tide predictions loaded for station ${stationId}.`;
  }catch(err){
    currentTideData = {};
    document.getElementById('tideStatus').textContent = `Could not load tides for station ${stationId}: ${err.message}`;
  }
}

async function buildCalendar(lat, lon){
  await refreshTidesForWindow(lat, lon);

  const grid = document.getElementById('grid');
  grid.innerHTML='';
  const { today, start, end } = windowBounds();
  const gridStart = new Date(start); gridStart.setDate(gridStart.getDate()-gridStart.getDay());
  const gridEnd = new Date(end); gridEnd.setDate(gridEnd.getDate()+(6-gridEnd.getDay()));

  document.getElementById('rangeLabel').textContent =
    `${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;
  document.getElementById('prevPage').disabled = weekOffset<=0;

  let cursor = new Date(gridStart);
  while (cursor<=gridEnd){
    const d = new Date(cursor);
    const inRange = d>=start && d<=end;
    const cell = document.createElement('div');
    cell.className = 'cell' + (inRange? '' : ' out-of-range') + (sameDay(d,today)?' today':'');
    if (inRange){
      const info = computeDay(d, lat, lon, tzOffsetHours, currentTideData[ymd(d)]);
      const bestWin = info.windows.filter(w=>w.start!==null).sort((a,b)=>b.score-a.score)[0];
      cell.innerHTML = `
        <div class="num">${d.getDate()}</div>
        <div class="bestline">${bestWin? (bestWin.prime? '<b>Prime</b> · ':'')+fmtLocal(bestWin.start) : '—'}</div>
        <div class="gauge${bestWin&&bestWin.prime?' prime':''}"><i style="width:${info.rating/5*100}%"></i></div>
      `;
      cell.addEventListener('click', ()=> showDetail(info, cell));
    } else {
      cell.innerHTML = `<div class="num">${d.getDate()}</div>`;
    }
    grid.appendChild(cell);
    cursor.setDate(cursor.getDate()+1);
  }

  if (sameDay(start, today)){
    const firstInfo = computeDay(today, lat, lon, tzOffsetHours, currentTideData[ymd(today)]);
    document.getElementById('moonToday').innerHTML =
      `${firstInfo.phase.name}<span class="pct">${Math.round(firstInfo.phase.illum*100)}%</span>`;
  }
}

function showDetail(info, cellEl){
  document.querySelectorAll('.cell').forEach(c=>c.classList.remove('selected'));
  cellEl.classList.add('selected');
  const det = document.getElementById('detail');
  det.classList.add('show');
  const dateStr = info.date.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});

  const winRows = info.windows.filter(w=>w.start!==null).map(w=>{
    const notes = [];
    if (w.sunOverlap) notes.push('overlaps sunrise/sunset');
    if (w.tideEvent) notes.push(`near ${w.tideEvent.type==='H'?'high':'low'} tide (${w.tideEvent.height.toFixed(1)} ft)`);
    return `
    <div class="win-row${w.prime?' prime':''}">
      <span class="tag">${w.kind}</span>
      <span class="time">${fmtLocal(w.start)} – ${fmtLocal(w.end)}</span>
      <span class="note">${notes.join(' · ')}</span>
    </div>`;
  }).join('');

  const tideRows = (info.tides||[]).slice().sort((a,b)=>a.hour-b.hour).map(t=>`
    <div class="tide-row">
      <span class="${t.type==='H'?'h':'l'}">${t.type==='H'?'High':'Low'}</span>
      <span>${fmtLocal(t.hour)} · ${t.height.toFixed(1)} ft</span>
    </div>`).join('') || '<p style="color:var(--foam-dim);font-size:13px;">No tide station set.</p>';

  det.innerHTML = `
    <h2>${dateStr}</h2>
    <div class="sub">Rating ${info.rating} / 5 · ${info.phase.name} (${Math.round(info.phase.illum*100)}% illuminated)</div>
    <div class="cols3">
      <div>
        <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--foam-dim);font-weight:500;margin:0 0 10px;">Sun &amp; moon</h3>
        <div class="fact"><span>Sunrise</span><span>${fmtLocal(info.sunrise)||'—'}</span></div>
        <div class="fact"><span>Sunset</span><span>${fmtLocal(info.sunset)||'—'}</span></div>
        <div class="fact"><span>Moonrise</span><span>${fmtLocal(info.moonrise)||'—'}</span></div>
        <div class="fact"><span>Moonset</span><span>${fmtLocal(info.moonset)||'—'}</span></div>
        <div class="fact"><span>Moon overhead</span><span>${fmtLocal(info.upperTransit)||'—'}</span></div>
        <div class="fact"><span>Moon underfoot</span><span>${fmtLocal(info.lowerTransit)||'—'}</span></div>
      </div>
      <div class="windows">
        <h3>Best windows today</h3>
        ${winRows || '<p style="color:var(--foam-dim);font-size:13px;">No events computed for this location/date.</p>'}
      </div>
      <div class="tides">
        <h3>Tides</h3>
        ${tideRows}
      </div>
    </div>
  `;
}

function getLatLon(){
  return [parseFloat(document.getElementById('lat').value), parseFloat(document.getElementById('lon').value)];
}

document.getElementById('recalc').addEventListener('click', ()=>{
  const [lat, lon] = getLatLon();
  if (isNaN(lat)||isNaN(lon)) return;
  stationId = document.getElementById('station').value.trim() || null;
  document.getElementById('detail').classList.remove('show');
  buildCalendar(lat, lon);
});

document.getElementById('locate').addEventListener('click', ()=>{
  if (!navigator.geolocation){ alert('Geolocation not available in this browser.'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    document.getElementById('lat').value = pos.coords.latitude.toFixed(4);
    document.getElementById('lon').value = pos.coords.longitude.toFixed(4);
    document.getElementById('place').textContent = 'Your current location';
    document.getElementById('recalc').click();
  }, err=>{ alert('Could not get your location: '+err.message); });
});

document.getElementById('findStation').addEventListener('click', async ()=>{
  const [lat, lon] = getLatLon();
  if (isNaN(lat)||isNaN(lon)) return;
  document.getElementById('tideStatus').textContent = 'Looking up nearest NOAA station…';
  try{
    const s = await findNearestStation(lat, lon);
    document.getElementById('station').value = s.id;
    document.getElementById('tideStatus').textContent = `Nearest station: ${s.name} (#${s.id}, ${s.dist.toFixed(1)} mi away)`;
  }catch(err){
    document.getElementById('tideStatus').textContent = 'Could not reach NOAA station directory: '+err.message;
  }
});

document.getElementById('prevPage').addEventListener('click', ()=>{
  if (weekOffset<=0) return;
  weekOffset -= 1;
  document.getElementById('detail').classList.remove('show');
  const [lat, lon] = getLatLon();
  buildCalendar(lat, lon);
});
document.getElementById('nextPage').addEventListener('click', ()=>{
  weekOffset += 1;
  document.getElementById('detail').classList.remove('show');
  const [lat, lon] = getLatLon();
  buildCalendar(lat, lon);
});

buildCalendar(32.7157, -117.1611);
