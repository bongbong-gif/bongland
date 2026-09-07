const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'game-config.json'), 'utf8'));
const CLIENT = path.join(ROOT, 'client');
const PORT = Number(process.env.PORT || 8080);

const rooms = new Map();

function uid() { return crypto.randomBytes(4).toString('hex'); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function send(ws, msg){ if(ws.readyState===1) ws.send(JSON.stringify(msg)); }
function broadcast(room,msg){ room.players.forEach(p=>send(p.ws,msg)); }

function createRoom() {
  const code = uid().toUpperCase().slice(0, 6);
  const room = { code, players: [], running:false, startedAt:0, escapeOpen:false, roundTimer:CONFIG.game.roundSeconds, rolePickTimer:CONFIG.game.rolePickSeconds, bullets:[], items:[], lastItemSpawn:0 };
  rooms.set(code, room);
  return room;
}
function stateFor(room, viewer) {
  return {
    type:'state', room: room.code, running:room.running, escapeOpen:room.escapeOpen,
    roundTimer:room.roundTimer, rolePickTimer:room.rolePickTimer,
    players:room.players.map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,role:p.role,character:p.character,ammo:p.ammo,reloading:p.reloading,alive:p.alive})),
    bullets:room.bullets.map(b=>({x:b.x,y:b.y,dx:b.dx,dy:b.dy,owner:b.owner})),
    items:room.items.map(i=>({id:i.id,type:i.type,x:i.x,y:i.y}))
  };
}
function startRoom(room) {
  if (room.running || room.players.length < 1) return;
  room.running=true; room.startedAt=Date.now(); room.roundTimer=CONFIG.game.roundSeconds; room.rolePickTimer=CONFIG.game.rolePickSeconds; room.escapeOpen=false;
  const oniIndex=Math.floor(Math.random()*room.players.length);
  room.players.forEach((p,i)=>{ p.role=i===oniIndex?'oni':'human'; p.character='char'+String((Math.floor(Math.random()*17)+1)).padStart(2,'0'); p.alive=true; p.ammo=CONFIG.game.magazineSize; p.reloading=false; p.x=200+(i*80)%900; p.y=200+Math.floor(i/5)*220; });
  broadcast(room,{type:'system',message:`Round started. ${room.players[oniIndex].name} is the Ao Oni.`});
}
function leave(ws) {
  for (const room of rooms.values()) {
    const idx=room.players.findIndex(p=>p.ws===ws);
    if(idx>=0){ room.players.splice(idx,1); if(room.players.length===0) rooms.delete(room.code); else broadcast(room,stateFor(room)); return; }
  }
}

const server=http.createServer((req,res)=>{
  let url=(req.url||'/').split('?')[0];
  if(url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  if(url==='/api/rooms'){
    const list=[...rooms.values()].map(r=>({code:r.code,players:r.players.length,maxPlayers:CONFIG.game.maxPlayers,running:r.running}));
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(list));
  }
  if(url==='/') url='/index.html';
  const safe=path.normalize(url).replace(/^([.][.][/\\])+/, '');
  const file=path.join(CLIENT,safe);
  if(!file.startsWith(CLIENT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if(err){ res.writeHead(404); return res.end('Not found'); }
    const ext=path.extname(file); const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'}[ext]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime}); res.end(data);
  });
});
const wss=new WebSocketServer({server});

wss.on('connection',(ws)=>{
  ws.on('message',(raw)=>{
    let m; try{m=JSON.parse(raw.toString())}catch{return}
    if(m.type==='create'){
      const room=createRoom(); const p=makePlayer(ws,m.name||'Player'); room.players.push(p); ws.room=room;
      send(ws,{type:'joined',room:room.code,id:p.id,config:CONFIG}); broadcast(room,stateFor(room)); return;
    }
    if(m.type==='join'){
      const room=rooms.get(String(m.room||'').toUpperCase()); if(!room) return send(ws,{type:'error',message:'Room not found'});
      if(room.running) return send(ws,{type:'error',message:'Game already started'});
      if(room.players.length>=CONFIG.game.maxPlayers) return send(ws,{type:'error',message:'Room is full'});
      const p=makePlayer(ws,m.name||`Player ${room.players.length+1}`); room.players.push(p); ws.room=room; send(ws,{type:'joined',room:room.code,id:p.id,config:CONFIG}); broadcast(room,stateFor(room)); return;
    }
    const room=ws.room; if(!room) return;
    const me=room.players.find(p=>p.ws===ws); if(!me) return;
    if(m.type==='start'){ startRoom(room); broadcast(room,stateFor(room)); }
    else if(m.type==='input' && room.running && me.alive){
      const dt=1/20; let sx=0,sy=0; const k=m.keys||{}; if(k.w)sy-=1; if(k.s)sy+=1; if(k.a)sx-=1; if(k.d)sx+=1;
      if(sx||sy){ const len=Math.hypot(sx,sy)||1; const speed=(me.role==='oni'?CONFIG.game.oniBaseSpeed:currentChar(me).speed)*60*dt; me.x=clamp(me.x+sx/len*speed,20,CONFIG.map.width-20); me.y=clamp(me.y+sy/len*speed,20,CONFIG.map.height-20); }
      if(m.shoot) shoot(room,me,m.dir);
      if(m.reload && !me.reloading) reload(me);
      if(m.skill) me.lastSkill=Date.now();
    }
    else if(m.type==='chat'){ broadcast(room,{type:'chat',name:me.name,message:String(m.message||'').slice(0,200)}); }
  });
  ws.on('close',()=>leave(ws));
});

function makePlayer(ws,name){ return {id:uid(),ws,name:String(name).slice(0,16),x:100,y:100,role:'unknown',character:'char01',ammo:CONFIG.game.magazineSize,reloading:false,alive:true,lastShot:0}; }
function currentChar(p){ return CONFIG.characters.find(c=>c.id===p.character)||CONFIG.characters[0]; }
function shoot(room,p,dir){
  const now=Date.now(); if(p.role==='oni'||p.reloading||p.ammo<=0||now-p.lastShot<220)return; p.lastShot=now;p.ammo--;
  const d=dir||{x:0,y:-1}; const l=Math.hypot(d.x,d.y)||1; room.bullets.push({owner:p.id,x:p.x,y:p.y,dx:d.x/l*CONFIG.game.bulletSpeed,dy:d.y/l*CONFIG.game.bulletSpeed,damage:CONFIG.game.bulletDamage});
}
function reload(p){ p.reloading=true; setTimeout(()=>{p.reloading=false;p.ammo=CONFIG.game.magazineSize},CONFIG.game.reloadSeconds*1000); }

setInterval(()=>{
  for(const room of rooms.values()){
    if(room.running){
      room.roundTimer=Math.max(0,CONFIG.game.roundSeconds-Math.floor((Date.now()-room.startedAt)/1000));
      room.escapeOpen=(CONFIG.game.roundSeconds-room.roundTimer)>=CONFIG.game.escapeOpensAtSeconds;
      room.bullets.forEach(b=>{
        b.x+=b.dx; b.y+=b.dy;
        for(const target of room.players){
          if(!target.alive || target.id===b.owner || target.role==='oni') continue;
          if(Math.hypot(target.x-b.x,target.y-b.y)<=20){
            target.alive=false; target.deathReason='shot'; break;
          }
        }
      });
      room.bullets=room.bullets.filter(b=>b.x>=0&&b.x<=CONFIG.map.width&&b.y>=0&&b.y<=CONFIG.map.height && !room.players.some(p=>p.deathReason==='shot' && false));
      // Simple infection contact rule: an oni touching a human infects them.
      const oni=room.players.find(p=>p.role==='oni'&&p.alive);
      if(oni){
        for(const target of room.players){
          if(target.alive&&target.role==='human'&&Math.hypot(target.x-oni.x,target.y-oni.y)<=34){
            target.role='oni';
            target.deathReason='infected';
            broadcast(room,{type:'system',message:`${target.name} became an Ao Oni.`});
          }
        }
      }
      room.players.forEach(p=>{if(p.deathReason){p.alive=false;}});
      if((Date.now()-room.lastItemSpawn)/1000>=CONFIG.game.itemSpawnEverySeconds){ room.lastItemSpawn=Date.now(); room.items.push({id:uid(),type:Math.random()<0.5?'goldMarble':'blueMarble',x:80+Math.random()*(CONFIG.map.width-160),y:80+Math.random()*(CONFIG.map.height-160)}); if(room.items.length>8)room.items.shift(); }
      if(room.roundTimer===0){ room.running=false; broadcast(room,{type:'system',message:'Time up. Round ended.'}); }
      if(room.escapeOpen){ /* escape/collision rules are intentionally simplified in prototype */ }
    }
    broadcast(room,stateFor(room));
  }
},50);

server.listen(PORT,()=>console.log(`Ao Oni web server: http://localhost:${PORT}`));
