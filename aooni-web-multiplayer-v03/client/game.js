const $=id=>document.getElementById(id);
let ws=null,myId=null,roomCode=null,cfg=null,state=null;
const keys={};
const canvas=$('canvas'),ctx=canvas.getContext('2d');
function wsUrl(){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}`}
function setConnection(ok){$('connection').textContent=ok?'● 온라인':'● 오프라인';$('connection').className=`status ${ok?'online':'offline'}`}
function connect(onopen){
  if(ws&&ws.readyState<=1)return;
  ws=new WebSocket(wsUrl());
  ws.onopen=()=>{setConnection(true);onopen&&onopen()};
  ws.onclose=()=>setConnection(false);
  ws.onerror=()=>setConnection(false);
  ws.onmessage=e=>handle(JSON.parse(e.data));
}
function send(m){if(ws?.readyState===1)ws.send(JSON.stringify(m))}
function nameVal(){return ($('name').value||'Player').trim().slice(0,16)||'Player'}
$('create').onclick=()=>connect(()=>send({type:'create',name:nameVal()}));
$('join').onclick=()=>{const code=$('room').value.trim().toUpperCase();if(code.length!==6)return alert('방 코드는 6자리입니다.');connect(()=>send({type:'join',room:code,name:nameVal()}))};
$('start').onclick=()=>send({type:'start'});
$('leave').onclick=()=>{if(ws){ws.close();} location.reload()};
$('refresh').onclick=loadRooms;
$('copy-room').onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);$('copy-room').textContent='복사됨'}catch{}};
function handle(m){
  if(m.type==='joined'){myId=m.id;roomCode=m.room;cfg=m.config;$('home').hidden=true;$('waiting').hidden=false;$('room-code').textContent=roomCode;$('room-title').textContent=`${roomCode} 대기실`;loadRooms()}
  if(m.type==='error')alert(m.message);
  if(m.type==='system')chat(m.message);
  if(m.type==='chat')chat(`${m.name}: ${m.message}`);
  if(m.type==='state'){state=m;renderLobby();if(m.running){$('waiting').hidden=true;$('game').hidden=false;render();}}
}
function renderLobby(){if(!state)return;$('players').innerHTML=state.players.map((p,i)=>`<div class="player"><span>${i+1}. ${escapeHtml(p.name)}</span><span>${p.role==='oni'?'🟣 아오오니':''}</span></div>`).join('')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function chat(t){const d=document.createElement('div');d.className='msg';d.textContent=t;$('chatbox').appendChild(d);setTimeout(()=>d.remove(),6000)}
async function loadRooms(){try{const r=await fetch('/api/rooms');const rooms=await r.json();$('room-list').innerHTML=rooms.length?rooms.map(room=>`<div class="room-item"><div><b>Room ${room.code}</b><div class="players">${room.players}/${room.maxPlayers}명 ${room.running?'· 게임중':'· 대기중'}</div></div><span class="room-code-chip">${room.code}</span><button ${room.running||room.players>=room.maxPlayers?'disabled':''} data-code="${room.code}" class="join-room">참가</button></div>`).join(''):'<div class="empty">아직 열린 방이 없습니다.</div>';$('room-list').querySelectorAll('.join-room').forEach(b=>b.onclick=()=>{ $('room').value=b.dataset.code;$('join').click() })}catch{}}
window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k))e.preventDefault()});window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);window.addEventListener('blur',()=>Object.keys(keys).forEach(k=>delete keys[k]));
setInterval(()=>{if(!state?.running)return;let dir={x:0,y:-1};if(keys.arrowdown)dir={x:0,y:1};else if(keys.arrowleft)dir={x:-1,y:0};else if(keys.arrowright)dir={x:1,y:0};else if(keys.arrowup)dir={x:0,y:-1};send({type:'input',keys:{w:!!keys.w,a:!!keys.a,s:!!keys.s,d:!!keys.d},shoot:!!(keys.arrowup||keys.arrowdown||keys.arrowleft||keys.arrowright),dir,reload:!!keys.r,skill:!!keys.k})},50);
function render(){if(!state)return;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#10161b';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#27333a';ctx.lineWidth=6;for(let x=100;x<1600;x+=250){ctx.beginPath();ctx.moveTo(x,80);ctx.lineTo(x,820);ctx.stroke()}for(let y=140;y<900;y+=220){ctx.beginPath();ctx.moveTo(80,y);ctx.lineTo(1520,y);ctx.stroke()}if(state.escapeOpen){ctx.strokeStyle='#b6df92';ctx.lineWidth=18;ctx.strokeRect(30,30,1540,840)}for(const i of state.items){ctx.beginPath();ctx.arc(i.x,i.y,12,0,Math.PI*2);ctx.fillStyle=i.type==='goldMarble'?'#e8c44e':'#5ba7ff';ctx.fill()}for(const b of state.bullets){ctx.beginPath();ctx.arc(b.x,b.y,4,0,Math.PI*2);ctx.fillStyle='#f4e6b0';ctx.fill()}for(const p of state.players){ctx.beginPath();ctx.arc(p.x,p.y,18,0,Math.PI*2);ctx.fillStyle=!p.alive?'#555':(p.role==='oni'?'#9c4cff':'#69c7d7');ctx.fill();if(p.id===myId){ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke()}ctx.fillStyle='#fff';ctx.font='14px sans-serif';ctx.fillText(p.name,p.x-24,p.y-26)}const me=state.players.find(p=>p.id===myId);$('role').textContent=(me?.role||'').toUpperCase();$('timer').textContent=format(state.roundTimer);$('escape').textContent=state.escapeOpen?'탈출구 OPEN':'탈출구 잠김';$('ammo').textContent=`탄약 ${me?.ammo??0}`;requestAnimationFrame(render)}
function format(s){const m=Math.floor(s/60),v=String(s%60).padStart(2,'0');return `${m}:${v}`}
loadRooms();setInterval(loadRooms,3000);
