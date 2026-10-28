const express = require('express'), http = require('http'), { Server } = require('socket.io');
const fs = require('fs'), path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/db.json')));
const TEAM = new Map(db.teams.map(t => [t.id, t.name]));
const ROUND_MS = 12000, WIN = 3;
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/ı/g, 'i').replace(/ø/g, 'o').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const pairs = new Map();
for (const p of db.players) {
  p.n = norm(p.name); p.url = p.id ? `https://www.transfermarkt.com.tr/-/profil/spieler/${p.id}` : 'https://www.transfermarkt.com.tr/schnellsuche/ergebnis/schnellsuche?query=' + encodeURIComponent(p.name);
  for (let i = 0; i < p.clubs.length; i++) for (let j = i + 1; j < p.clubs.length; j++) {
    const k = [p.clubs[i], p.clubs[j]].sort((a, b) => a - b).join('|');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(p);
  }
}
const pairList = [...pairs.entries()].map(([k, list]) => ({ a: +k.split('|')[0], b: +k.split('|')[1], list }));
console.log(`${db.players.length} oyuncu, ${pairList.length} takım çifti`);
function match(pair, guess) {
  const g = norm(guess); if (g.length < 3) return null;
  const exact = pair.list.find(p => p.n === g); if (exact) return exact;
  const t = g.split(' '), c = pair.list.filter(p => t.every(x => p.n.split(' ').includes(x)));
  return c.length === 1 ? c[0] : null;
}
const app = express(); app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app), io = new Server(server);
const rooms = new Map(); let waiting = null;
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const pub = r => r.players.map(p => ({ name: p.name, score: p.score }));
function startRound(r) {
  let pair; do pair = pairList[Math.floor(Math.random() * pairList.length)]; while (pairList.length > 1 && pair === r.pair);
  r.pair = pair; r.live = true; r.players.forEach(p => p.hit = null);
  io.to(r.id).emit('round', { a: TEAM.get(pair.a), b: TEAM.get(pair.b), ms: ROUND_MS, scores: pub(r) });
  clearTimeout(r.timer); r.timer = setTimeout(() => endRound(r), ROUND_MS);
}
function endRound(r) {
  if (!r.live) return; r.live = false; clearTimeout(r.timer);
  const ok = r.players.map(p => !!p.hit);
  if (ok[0] !== ok[1]) r.players[ok[0] ? 0 : 1].score++;
  const winner = r.players.findIndex(p => p.score >= WIN);
  io.to(r.id).emit('roundEnd', { ok, scores: pub(r), winner,
    answers: r.pair.list.slice(0, 12).map(p => ({ name: p.name, url: p.url })), total: r.pair.list.length });
  if (winner >= 0) rooms.delete(r.id); else r.timer = setTimeout(() => startRound(r), 6000);
}
function join(s, r, name) {
  s.join(r.id); s.data.room = r.id; r.players.push({ id: s.id, name, score: 0, hit: null });
  if (r.players.length === 2) { waiting === r && (waiting = null); io.to(r.id).emit('matched', pub(r)); setTimeout(() => startRound(r), 1500); }
}
function open(s, name, isPublic) {
  const r = { id: code(), players: [], pair: null, live: false, timer: null }; rooms.set(r.id, r);
  if (isPublic) waiting = r; join(s, r, name); s.emit('room', r.id);
}
io.on('connection', s => {
  const nm = n => String(n || 'Oyuncu').slice(0, 16);
  s.on('create', n => open(s, nm(n), false));
  s.on('quick', n => { waiting && waiting.players.length === 1 ? join(s, waiting, nm(n)) : open(s, nm(n), true); });
  s.on('join', (c, n) => {
    const r = rooms.get(String(c || '').toUpperCase());
    if (!r || r.players.length !== 1) return s.emit('err', 'Oda bulunamadı veya dolu.');
    join(s, r, nm(n));
  });
  s.on('guess', text => {
    const r = rooms.get(s.data.room); if (!r || !r.live) return;
    const me = r.players.find(p => p.id === s.id); if (!me || me.hit) return;
    const hit = match(r.pair, String(text).slice(0, 60));
    if (hit) { me.hit = hit; s.emit('guessResult', true); if (r.players.every(p => p.hit)) endRound(r); }
    else s.emit('guessResult', false);
  });
  s.on('disconnect', () => {
    const r = rooms.get(s.data.room); if (!r) return;
    clearTimeout(r.timer); rooms.delete(r.id); waiting === r && (waiting = null);
    io.to(r.id).emit('left');
  });
});
server.listen(process.env.PORT || 3000, () => console.log('Hazır'));
