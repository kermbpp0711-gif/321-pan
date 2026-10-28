// Kullanım: data/raw/transfers.csv koy -> npm run build:db
const fs = require('fs'), { parse } = require('csv-parse/sync');
const teams = JSON.parse(fs.readFileSync('data/teams.json'));
const ids = new Set(teams.map(t => String(t.id)));
const rows = parse(fs.readFileSync('data/raw/transfers.csv'), { columns: true, skip_empty_lines: true });
const seen = new Map(), players = new Map();
for (const r of rows) {
  for (const [cid, cname] of [[r.from_club_id, r.from_club_name], [r.to_club_id, r.to_club_name]]) {
    if (!ids.has(cid)) continue;
    seen.set(cid, cname);
    if (!players.has(r.player_id)) players.set(r.player_id, { id: +r.player_id, name: r.player_name, clubs: new Set() });
    players.get(r.player_id).clubs.add(+cid);
  }
}
console.log('Takım ID kontrolü (bizim ad -> veri setindeki ad):');
for (const t of teams) console.log(' ', t.id, t.name, '->', seen.get(String(t.id)) || '!!! BULUNAMADI');
const out = [...players.values()].filter(p => p.clubs.size >= 2).map(p => ({ ...p, clubs: [...p.clubs] }));
fs.writeFileSync('data/db.json', JSON.stringify({ teams, players: out }));
console.log(out.length, 'ortak oyuncu yazıldı -> data/db.json');
