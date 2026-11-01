import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// VRQuests — static WebXR, Rec Room-style quests. No build step, no server.
// Solo: everything runs locally. Party: host is authoritative for enemies /
// quest progress, guests send player state + attacks. PeerJS is only for
// the initial introduction; game data is direct WebRTC between browsers.

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
const camera = new THREE.PerspectiveCamera(70, innerWidth / screen.height * 1, 0.1, 200);
const rig = new THREE.Group(); // player position + yaw
rig.add(camera); camera.position.set(0, 1.6, 0);
scene.add(rig);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(20, 30, 10); scene.add(sun);

const QUESTS = {
  goblin: { name: 'Goblin Grotto', emoji: '🌲', ground: 0x3a7d44, sky: 0x87ceeb, enemy: 'Goblin', enemyColor: 0x2fae4e, boss: 'Goblin King', bossColor: 0x1d7a33, bossHp: 260, diff: 'Easy' },
  skull: { name: 'Skull Isle', emoji: '🏝️', ground: 0xc2a878, sky: 0x9fd8e8, enemy: 'Skeleton', enemyColor: 0xe8e8e8, boss: 'Skeleton Captain', bossColor: 0xdddddd, bossHp: 380, diff: 'Medium' },
  ember: { name: 'Ember Keep', emoji: '🌋', ground: 0x3a2a2a, sky: 0x2a1212, enemy: 'Fire Imp', enemyColor: 0xff5a2a, boss: 'Ember Witch', bossColor: 0xaa2222, bossHp: 520, diff: 'Hard' },
};
const COLORS = [0xff3355, 0x2266ff, 0x22cc66, 0xffcc00, 0xaa33ff, 0xff8800];
let myColor = COLORS[0];

let world = new THREE.Group(); scene.add(world);
let player = { pos: new THREE.Vector3(0, 0, 18), yaw: Math.PI, hp: 100, coins: 0, alive: true, speed: 4.2 };
let questId = null, quest = null, stage = 0; // 0 crystals, 1 minions, 2 altar/gate, 3 boss, 4 won
let crystals = [], enemies = [], coins = [], hearts = [], bolts = [], enemyBolts = [], remotes = new Map();
let crystalsGot = 0, minionsDown = 0, gateOpen = false, boss = null, spawnTimer = 0;
let keys = {}, mouseYaw = 0, mousePitch = 0, pointerLocked = false, lastSwing = 0, lastBolt = 0, lastSnap = 0;
let peer = null, conns = [], isHost = false, myCode = '', hostConn = null, isParty = false;
let controllers = [], swordMesh = null, wandMesh = null;
let bannerTimer = null;

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); }
function banner(msg) { const b = $('banner'); b.textContent = msg; b.classList.add('show'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), 2800); }
function labelSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d'); g.font = 'bold 56px system-ui'; g.textAlign = 'center'; g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 10; g.strokeText(text, 256, 80); g.fillText(text, 256, 80);
  const tex = new THREE.CanvasTexture(c); const m = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const s = new THREE.Sprite(m); s.scale.set(6, 1.5, 1); return s;
}
function box(w, h, d, color, x, y, z, parent = world) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
  m.position.set(x, y, z); parent.add(m); return m;
}
function ball(r, color, x, y, z, parent = world) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), new THREE.MeshStandardMaterial({ color }));
  m.position.set(x, y, z); parent.add(m); return m;
}
function clearWorld() { scene.remove(world); world = new THREE.Group(); scene.add(world); crystals = []; enemies = []; coins = []; hearts = []; bolts = []; enemyBolts = []; boss = null; remotes.forEach(r => scene.remove(r.group)); remotes.clear(); }

function buildHub() {
  clearWorld(); questId = null; quest = null; stage = 0;
  scene.background = new THREE.Color(0x87ceeb); scene.fog = new THREE.Fog(0x87ceeb, 30, 90);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(26, 48), new THREE.MeshStandardMaterial({ color: 0x6aa84f }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  const hub = labelSprite('REC CENTER — walk into a portal!'); hub.position.set(0, 4, -6); world.add(hub);
  box(20, 0.2, 1, 0x8b5a2b, 0, 0.1, -12); box(1, 3, 1, 0x8b5a2b, -10, 1.5, -12); box(1, 3, 1, 0x8b5a2b, 10, 1.5, -12);
  const portals = [['goblin', -7, 0x2fae4e], ['skull', 0, 0xe8c878], ['ember', 7, 0xff5a2a]];
  for (const [id, x, col] of portals) {
    const arch = new THREE.Group();
    const a1 = box(0.6, 5, 0.6, col, -2, 2.5, 0, arch), a2 = box(0.6, 5, 0.6, col, 2, 2.5, 0, arch), top = box(4.6, 0.6, 0.6, col, 0, 5, 0, arch);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.4), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    glow.position.set(0, 2.4, 0); arch.add(glow);
    const lab = labelSprite(QUESTS[id].name, '#ffffff'); lab.position.set(0, 6, 0); arch.add(lab);
    arch.position.set(x, 0, -12); arch.userData.quest = id; world.add(arch);
    world.userData['portal_' + id] = arch;
  }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; box(0.5, 4 + (i % 3), 0.5, 0x2d5a2d, Math.cos(a) * 22, 2, Math.sin(a) * 22); ball(1.6, 0x2d7a2d, Math.cos(a) * 22, 4.5, Math.sin(a) * 22); }
  player.pos.set(0, 0, 18); player.yaw = Math.PI; player.hp = 100;
  $('quest-label').textContent = 'REC CENTER'; $('objective').textContent = 'Walk into a portal, or pick a quest below.';
  $('status').textContent = 'Welcome to the Rec Center.'; $('boss-text').textContent = 'No boss yet'; $('boss-bar').style.width = '0%';
}

function spawnPickup(kind, x, z) {
  const g = new THREE.Group();
  if (kind === 'crystal') { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00aaff, emissiveIntensity: 0.8 })); g.add(m); }
  if (kind === 'coin') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xaa7700, emissiveIntensity: 0.5 })); m.rotation.x = Math.PI / 2; g.add(m); }
  if (kind === 'heart') { const m = ball(0.4, 0xff3355, 0, 0, 0, g); }
  g.position.set(x, 1, z); world.add(g);
  const arr = kind === 'crystal' ? crystals : kind === 'coin' ? coins : hearts;
  arr.push({ mesh: g, x, z, taken: false, kind });
}
function makeEnemy(kind, x, z, isBoss = false) {
  const q = quest; const g = new THREE.Group();
  const col = isBoss ? q.bossColor : q.enemyColor; const s = isBoss ? 2.1 : 1;
  const body = box(0.9 * s, 1.1 * s, 0.5 * s, col, 0, 0.9 * s, 0, g);
  const head = ball(0.45 * s, col, 0, 1.75 * s, 0, g);
  const eye = ball(0.1 * s, 0xff0000, 0.18 * s, 1.8 * s, 0.42 * s, g);
  const barBg = box(1.2 * s, 0.12, 0.05, 0x222222, 0, 2.4 * s, 0, g);
  const bar = box(1.2 * s, 0.12, 0.06, 0xff3333, 0, 2.4 * s, 0.01, g);
  g.position.set(x, 0, z); world.add(g);
  const e = { id: Math.random().toString(36).slice(2, 8), mesh: g, bar, x, z, hp: isBoss ? q.bossHp : 70, max: isBoss ? q.bossHp : 70, isBoss, kind, atk: 0, speed: isBoss ? 2.6 : 1.9 + Math.random() * 0.6, dmg: isBoss ? 18 : 10 };
  enemies.push(e); return e;
}

function buildQuest(id) {
  clearWorld(); questId = id; quest = QUESTS[id]; stage = 0; crystalsGot = 0; minionsDown = 0; gateOpen = false;
  scene.background = new THREE.Color(quest.sky); scene.fog = new THREE.Fog(quest.sky, 30, 90);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: quest.ground }));
  ground.rotation.x = -Math.PI / 2; world.add(ground);
  // boundary + scenery
  for (let x = -30; x <= 30; x += 6) { box(6, 3, 0.6, 0x555555, x, 1.5, -38); box(6, 3, 0.6, 0x555555, x, 1.5, 24); }
  for (let z = -38; z <= 24; z += 6) { box(0.6, 3, 6, 0x555555, -30, 1.5, z); box(0.6, 3, 6, 0x555555, 30, 1.5, z); }
  for (let i = 0; i < 26; i++) {
    const x = -26 + Math.random() * 52, z = -34 + Math.random() * 54;
    if (Math.abs(x) < 4 && z > 12) continue;
    if (id === 'goblin') { box(0.6, 3.5, 0.6, 0x5a3d22, x, 1.7, z); ball(1.8, 0x2d7a2d, x, 4.2, z); }
    else if (id === 'skull') { box(1.2, 2 + Math.random() * 2, 1.2, 0x999988, x, 1, z); ball(0.5, 0xffffff, x, 2.6, z); }
    else { const c = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0xcc3300, emissive: 0xff4400, emissiveIntensity: 0.6 })); c.position.set(x, 1.2, z); world.add(c); }
  }
  const spots = [[-8, 6], [8, 4], [0, -2], [-12, -8], [12, -10]];
  spots.forEach(([x, z]) => spawnPickup('crystal', x, z));
  for (let i = 0; i < 14; i++) spawnPickup('coin', -24 + Math.random() * 48, -30 + Math.random() * 44);
  for (let i = 0; i < 5; i++) spawnPickup('heart', -20 + Math.random() * 40, -28 + Math.random() * 40);
  // gate + altar
  const gate = box(12, 4, 0.8, 0x774411, 0, 2, -20); gate.name = 'gate'; world.userData.gate = gate;
  const altar = box(2, 1, 2, 0x888888, 6, 0.5, -16); altar.name = 'altar'; world.userData.altar = altar;
  const al = labelSprite('ALTAR — touch when ready'); al.position.set(6, 2.5, -16); world.add(al);
  const bl = labelSprite(quest.boss + ' lies beyond the gate'); bl.position.set(0, 5.5, -20); world.add(bl);
  if (!isParty || isHost) spawnMinions(6); // guests get enemies from the host's broadcasts, not local spawns
  player.pos.set(0, 0, 18); player.yaw = Math.PI; player.hp = 100;
  $('quest-label').textContent = quest.emoji + ' ' + quest.name.toUpperCase() + ' · ' + quest.diff;
  updateObjective(); banner(quest.name + '!'); toast('Collect 5 crystals to begin.');
  broadcast({ type: 'quest', quest: id, stage });
  $('lobby').classList.add('hidden'); $('vr-bar').classList.remove('hidden');
}
function spawnMinions(n) {
  for (let i = 0; i < n; i++) makeEnemy(quest.enemy, -18 + Math.random() * 36, -14 + Math.random() * 22);
}
function updateObjective() {
  if (!quest) return;
  const o = $('objective');
  if (stage === 0) o.textContent = `Collect crystals: ${crystalsGot} / 5 — they glow cyan.`;
  else if (stage === 1) o.textContent = `Defeat minions: ${minionsDown} / 6 — sword (right trigger / click) or magic (left trigger / F).`;
  else if (stage === 2) o.textContent = 'Touch the grey altar near the gate to open it!';
  else if (stage === 3) o.textContent = `BOSS: ${quest.boss} — dodge, swing, and shoot!`;
  else o.textContent = 'Quest complete! Return to the Rec Center for your next quest.';
  $('status').textContent = stage === 4 ? '🏆 QUEST COMPLETE!' : `HP ${Math.max(0, Math.round(player.hp))} · Coins ${player.coins}`;
}
function updateHUD() {
  $('hp-you').style.width = Math.max(0, player.hp) + '%';
  $('hp-text').textContent = Math.max(0, Math.round(player.hp)) + ' HP';
  $('coins-text').textContent = '🪙 ' + player.coins;
  if (boss) { $('boss-bar').style.width = (boss.hp / boss.max * 100) + '%'; $('boss-text').textContent = quest.boss + ' ' + Math.max(0, Math.round(boss.hp)) + ' HP'; }
  updateObjective();
}
function damageEnemy(e, dmg, fromGuest = false) {
  if (!e || e.hp <= 0) return;
  e.hp -= dmg; e.bar.scale.x = Math.max(0.01, e.hp / e.max);
  e.mesh.position.x += (e.x - player.pos.x) * 0.02; // small knockback visual
  if (e.hp <= 0) {
    world.remove(e.mesh); enemies = enemies.filter(x => x !== e);
    if (e.isBoss) { stage = 4; boss = null; player.coins += 100; banner('🏆 QUEST COMPLETE! +100 coins'); toast('Boss defeated! Head back to the Rec Center.'); broadcast({ type: 'quest', quest: questId, stage }); }
    else { minionsDown++; player.coins += 5; toast(quest.enemy + ' down! +5 coins'); if (stage === 1 && minionsDown >= 6) { stage = 2; toast('All minions down! Touch the altar.'); broadcast({ type: 'quest', quest: questId, stage }); } }
  }
  if (isHost) broadcast({ type: 'enemy', id: e.id, hp: e.hp });
}
function swordSwing() {
  const now = performance.now(); if (now - lastSwing < 350) return; lastSwing = now;
  playTone(220, 0.08);
  let hit = false;
  for (const e of [...enemies]) {
    const dx = e.x - player.pos.x, dz = e.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < 2.6) { if (isParty && !isHost) sendHost({ type: 'hit', id: e.id, dmg: 34 }); else damageEnemy(e, 34); hit = true; }
  }
  if (hit) playTone(440, 0.1); else toast('Swing! Get closer to hit.');
}
function shootBolt() {
  const now = performance.now(); if (now - lastBolt < 450) return; lastBolt = now;
  const dir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const m = ball(0.18, myColor, player.pos.x, 1.4, player.pos.z); world.add(m);
  bolts.push({ mesh: m, x: player.pos.x, z: player.pos.z, dx: dir.x, dz: dir.z, life: 3 });
  playTone(660, 0.09);
}
function playTone(freq, dur) {
  try { const ctx = playTone.ctx || (playTone.ctx = new (window.AudioContext || window.webkitAudioContext)()); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur); } catch (e) {}
}
function returnToHub() { buildHub(); $('lobby').classList.remove('hidden'); $('vr-bar').classList.add('hidden'); broadcast({ type: 'hub' }); }
function checkPickups() {
  for (const c of crystals) if (!c.taken && Math.hypot(c.mesh.position.x - player.pos.x, c.mesh.position.z - player.pos.z) < 1.4) {
    c.taken = true; world.remove(c.mesh); crystalsGot++; player.coins += 10; playTone(880, 0.15); toast('Crystal! +10 coins');
    if (stage === 0 && crystalsGot >= 5) { stage = 1; banner('Minions incoming!'); toast('All crystals found — defeat 6 minions.'); broadcast({ type: 'quest', quest: questId, stage }); }
  }
  for (const c of coins) if (!c.taken && Math.hypot(c.mesh.position.x - player.pos.x, c.mesh.position.z - player.pos.z) < 1.3) { c.taken = true; world.remove(c.mesh); player.coins += 2; playTone(990, 0.08); }
  for (const h of hearts) if (!h.taken && Math.hypot(h.mesh.position.x - player.pos.x, h.mesh.position.z - player.pos.z) < 1.3) { h.taken = true; world.remove(h.mesh); player.hp = Math.min(100, player.hp + 25); toast('💚 +25 HP'); }
  // hub portals
  if (!quest) for (const id of Object.keys(QUESTS)) { const p = world.userData['portal_' + id]; if (p && Math.abs(player.pos.x - p.position.x) < 2.5 && Math.abs(player.pos.z - p.position.z) < 1) { buildQuest(id); return; } }
  // altar
  if (quest && stage === 2 && Math.hypot(player.pos.x - 6, player.pos.z + 16) < 2.2) {
    stage = 3; gateOpen = true; const gate = world.userData.gate; if (gate) world.remove(gate);
    boss = makeEnemy(quest.boss, 0, -30, true); banner('⚔️ ' + quest.boss + ' ⚔️'); toast('The gate is open — the boss awaits!');
    broadcast({ type: 'quest', quest: questId, stage }); broadcast({ type: 'boss', boss: quest.boss });
  }
}
function hurtPlayer(dmg) {
  if (stage === 4 || !player.alive) return;
  player.hp -= dmg; playTone(110, 0.15);
  if (player.hp <= 0) { player.hp = 100; player.pos.set(0, 0, 18); player.yaw = Math.PI; player.coins = Math.max(0, player.coins - 10); banner('You were knocked out — respawned!'); toast('Respawned at the start. -10 coins.'); }
}

// ---- VR controllers, weapons, movement ----
function setupXR() {
  const factory = new XRControllerModelFactory();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i); c.addEventListener('selectstart', () => { if (i === 1) swordSwing(); else shootBolt(); });
    const grip = renderer.xr.getControllerGrip(i); grip.add(factory.createControllerModel(grip)); rig.add(grip);
    rig.add(c); controllers.push(c);
    // simple hand + weapon visuals
    const hand = ball(0.09, myColor, 0, 0, 0, c);
    if (i === 1) { swordMesh = box(0.06, 0.7, 0.06, 0xdddddd, 0, -0.1, -0.35, c); box(0.16, 0.05, 0.05, 0xaa8800, 0, 0.18, -0.35, c); }
    else { wandMesh = box(0.05, 0.4, 0.05, 0x6a2fae, 0, -0.1, -0.3, c); ball(0.08, 0x00e5ff, 0, -0.3, -0.3, c); }
  }
}
setupXR();
async function enterVR() {
  const st = $('vr-status'); st.textContent = '';
  try {
    if (!navigator.xr) { st.textContent = 'VR not available here — use the Meta Quest Browser.'; return; }
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    if (!ok) { st.textContent = 'This browser/device does not support immersive VR.'; return; }
    const opts = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
    try { const s = await navigator.xr.requestSession('immersive-vr', { ...opts, optionalFeatures: [...opts.optionalFeatures, 'dom-overlay'], domOverlay: { root: $('hud') } }); await renderer.xr.setSession(s); }
    catch (e) { const s = await navigator.xr.requestSession('immersive-vr', opts); await renderer.xr.setSession(s); }
    $('btn-vr-float').classList.add('hidden'); $('btn-exit-vr').classList.remove('hidden');
    renderer.xr.addEventListener('sessionend', () => { $('btn-vr-float').classList.remove('hidden'); $('btn-exit-vr').classList.add('hidden'); }, { once: true });
  } catch (e) { st.textContent = 'Could not start VR: ' + (e.message || e); }
}
function exitVR() { const s = renderer.xr.getSession(); if (s) s.end(); }

// ---- Party / PeerJS ----
function broadcast(msg) { if (!isParty) return; for (const c of conns) try { if (c.open) c.send(msg); } catch (e) {} if (hostConn && hostConn.open) try { hostConn.send(msg); } catch (e) {} }
function sendHost(msg) { if (hostConn && hostConn.open) try { hostConn.send(msg); } catch (e) {} }
function makeRemote(color) {
  const g = new THREE.Group(); const head = ball(0.22, color, 0, 1.6, 0, g); const l = ball(0.09, color, -0.3, 1.2, -0.2, g); const r = ball(0.09, color, 0.3, 1.2, -0.2, g);
  scene.add(g); return { group: g, head, l, r };
}
function handleNet(msg, conn) {
  if (msg.type === 'player' && msg.id) {
    if (!remotes.has(msg.id)) remotes.set(msg.id, makeRemote(msg.color || 0xffffff));
    const r = remotes.get(msg.id); r.group.position.set(msg.x, 0, msg.z); r.group.rotation.y = msg.yaw;
  }
  if (msg.type === 'quest' && msg.quest && msg.quest !== questId) buildQuest(msg.quest);
  if (msg.type === 'quest' && msg.stage !== undefined) { stage = msg.stage; updateObjective(); }
  if (msg.type === 'hub') { if (quest) buildHub(); }
  if (msg.type === 'hit' && isHost) { const e = enemies.find(x => x.id === msg.id); if (e) damageEnemy(e, msg.dmg, true); }
  if (msg.type === 'enemy' && !isHost) { let e = enemies.find(x => x.id === msg.id); if (!e && msg.isBoss && boss) { e = boss; e.id = msg.id; } if (!e && msg.x !== undefined && quest) { e = makeEnemy(quest.enemy, msg.x, msg.z, !!msg.isBoss); e.id = msg.id; if (msg.isBoss) boss = e; } if (e) { e.hp = msg.hp; e.bar.scale.x = Math.max(0.01, e.hp / e.max); if (msg.x !== undefined) { e.x = msg.x; e.z = msg.z; e.mesh.position.set(e.x, 0, e.z); } if (e.hp <= 0) { world.remove(e.mesh); enemies = enemies.filter(x => x !== e); if (e.isBoss) boss = null; } } }
  if (msg.type === 'boss' && !boss && quest) boss = makeEnemy(quest.boss, 0, -30, true);
  if (msg.type === 'join' && isHost && conn) { try { conn.send({ type: 'quest', quest: questId, stage }); } catch (e) {} }
}
function setupPeer(asHost, code) {
  return new Promise((resolve, reject) => {
    try {
      peer = new Peer(asHost ? 'vrquests-' + code : undefined);
      peer.on('open', (id) => resolve(id));
      peer.on('error', (e) => reject(e));
      peer.on('connection', (conn) => {
        conns.push(conn); conn.on('data', (m) => handleNet(m, conn)); conn.on('open', () => { $('host-status').textContent = `Connected players: ${conns.length + 1}`; $('players-text').textContent = `${conns.length + 1} players`; });
      });
    } catch (e) { reject(e); }
  });
}

// ---- Lobby wiring ----
document.querySelectorAll('.start-quest').forEach(b => b.addEventListener('click', () => { $('lobby').classList.add('hidden'); buildQuest(b.dataset.quest); $('vr-bar').classList.remove('hidden'); }));
$('btn-solo').addEventListener('click', () => { isParty = false; $('lobby').classList.add('hidden'); if (!quest) buildHub(); $('vr-bar').classList.remove('hidden'); toast('Solo mode — pick a portal or a quest.'); });
$('btn-hub').addEventListener('click', returnToHub);
$('btn-heal').addEventListener('click', () => { if (player.coins >= 20) { player.coins -= 20; player.hp = Math.min(100, player.hp + 40); toast('💚 Healed +40 HP'); } else toast('Need 20 coins to heal.'); });
$('btn-host').addEventListener('click', async () => {
  myCode = 'quest-' + Math.floor(1000 + Math.random() * 9000); isParty = true; isHost = true;
  $('host-box').classList.remove('hidden'); $('host-code').value = myCode;
  try { await setupPeer(true, myCode); $('host-status').textContent = 'Hosting! Share the code above.'; toast('Hosting party ' + myCode); }
  catch (e) { $('lobby-error').textContent = 'Could not host: ' + e; }
});
$('btn-join').addEventListener('click', () => $('join-box').classList.remove('hidden'));
$('btn-connect').addEventListener('click', async () => {
  const code = $('join-code').value.trim(); if (!code) return;
  isParty = true; isHost = false;
  try {
    await setupPeer(false); const conn = peer.connect('vrquests-' + code); hostConn = conn;
    conn.on('open', () => { conn.send({ type: 'join' }); $('lobby').classList.add('hidden'); buildHub(); $('vr-bar').classList.remove('hidden'); $('players-text').textContent = 'Party joined'; toast('Joined party ' + code); });
    conn.on('data', (m) => handleNet(m, conn));
  } catch (e) { $('lobby-error').textContent = 'Could not join: ' + e; }
});
$('btn-copy').addEventListener('click', () => { $('host-code').select(); document.execCommand('copy'); toast('Code copied'); });
$('btn-vr').addEventListener('click', enterVR); $('btn-vr-float').addEventListener('click', enterVR);
$('btn-exit-vr').addEventListener('click', exitVR);
$('btn-desktop').addEventListener('click', () => { $('lobby').classList.add('hidden'); $('vr-bar').classList.remove('hidden'); if (!quest) buildHub(); });
const colorBox = $('colors');
COLORS.forEach((c) => { const b = document.createElement('button'); b.style.background = '#' + c.toString(16).padStart(6, '0'); if (c === myColor) b.classList.add('sel'); b.addEventListener('click', () => { myColor = c; colorBox.querySelectorAll('button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); }); colorBox.appendChild(b); });

// ---- Desktop input ----
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyF') shootBolt();
  if (e.code === 'KeyH') $('btn-heal').click();
  if (e.code === 'KeyE') checkPickups();
  if (e.code === 'KeyQ') player.yaw += 0.3;
  if (e.code === 'KeyR') player.yaw -= 0.3;
});
addEventListener('keyup', (e) => keys[e.code] = false);
canvas.addEventListener('click', () => { if (!$('lobby').classList.contains('hidden')) return; canvas.requestPointerLock?.(); swordSwing(); });
document.addEventListener('pointerlockchange', () => pointerLocked = document.pointerLockElement === canvas);
addEventListener('mousemove', (e) => { if (!pointerLocked) return; player.yaw -= e.movementX * 0.0025; mousePitch = Math.max(-1, Math.min(1, mousePitch - e.movementY * 0.0025)); });

// ---- Main loop ----
const clock = new THREE.Clock(); let netTimer = 0;
function animate() {
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const session = renderer.xr.getSession();
    // movement: fx = strafe right, fz = forward (W = -1 in local space, thumbstick up = -1)
    if (session) {
      for (const src of session.inputSources) {
        if (!src.gamepad || !src.gamepad.axes) continue;
        const [ax, ay] = src.gamepad.axes;
        if (src.handedness === 'right' && Math.abs(ax) > 0.6 && performance.now() - lastSnap > 350) { player.yaw -= Math.sign(ax) * Math.PI / 6; lastSnap = performance.now(); }
        if (src.gamepad.buttons[0]?.pressed && src.handedness === 'right') swordSwing();
        if (src.gamepad.buttons[0]?.pressed && src.handedness === 'left') shootBolt();
      }
    }
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1; if (keys.KeyS || keys.ArrowDown) fz += 1; if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1;
    if (session) for (const src of session.inputSources) if (src.handedness === 'left' && src.gamepad?.axes) { fx += src.gamepad.axes[0]; fz += src.gamepad.axes[1]; }
    // Local forward is (-sin yaw, -cos yaw), local right is (cos yaw, -sin yaw).
    // Moving forward (fz=-1) must give forward * 1, so: pos += forward * (-fz) + right * fx
    if (fx || fz) { const l = Math.hypot(fx, fz); fx /= l; fz /= l; const s = Math.sin(player.yaw), co = Math.cos(player.yaw); player.pos.x += (-s * -fz + co * fx) * player.speed * dt; player.pos.z += (-co * -fz - s * fx) * player.speed * dt; }
    player.pos.x = Math.max(-29, Math.min(29, player.pos.x)); player.pos.z = Math.max(-37, Math.min(23, player.pos.z));
    rig.position.copy(player.pos); rig.rotation.y = player.yaw;
    camera.rotation.x = mousePitch;
    // spin pickups
    for (const arr of [crystals, coins, hearts]) for (const p of arr) if (!p.taken) p.mesh.rotation.y += dt * 2;
    // bolts
    for (const b of [...bolts]) { b.x += b.dx * 14 * dt; b.z += b.dz * 14 * dt; b.mesh.position.set(b.x, 1.4, b.z); b.life -= dt; let dead = b.life <= 0; for (const e of [...enemies]) if (Math.hypot(e.x - b.x, e.z - b.z) < (e.isBoss ? 1.8 : 1.0)) { if (isParty && !isHost) sendHost({ type: 'hit', id: e.id, dmg: 25 }); else damageEnemy(e, 25); dead = true; } if (dead) { world.remove(b.mesh); bolts = bolts.filter(x => x !== b); } }
    for (const b of [...enemyBolts]) { b.x += b.dx * 8 * dt; b.z += b.dz * 8 * dt; b.mesh.position.set(b.x, 1.4, b.z); b.life -= dt; if (b.life <= 0 || Math.hypot(b.x - player.pos.x, b.z - player.pos.z) < 1) { if (Math.hypot(b.x - player.pos.x, b.z - player.pos.z) < 1) hurtPlayer(12); world.remove(b.mesh); enemyBolts = enemyBolts.filter(x => x !== b); } }
    // enemies (host / solo only move them; guests get positions via sync in a real party — host broadcasts below)
    if (!isParty || isHost) {
      for (const e of [...enemies]) {
        if (e.hp <= 0) continue;
        const dx = player.pos.x - e.x, dz = player.pos.z - e.z, d = Math.hypot(dx, dz);
        // also chase nearest remote player
        let tx = player.pos.x, tz = player.pos.z, td = d;
        remotes.forEach(r => { const dd = Math.hypot(r.group.position.x - e.x, r.group.position.z - e.z); if (dd < td) { td = dd; tx = r.group.position.x; tz = r.group.position.z; } });
        if (td < 14 && td > 1.4) { e.x += (tx - e.x) / td * e.speed * dt; e.z += (tz - e.z) / td * e.speed * dt; e.mesh.position.set(e.x, 0, e.z); e.mesh.lookAt(tx, 0, tz); }
        e.atk -= dt;
        if (td < 1.8 && e.atk <= 0) { e.atk = 1.1; if (td === d) hurtPlayer(e.dmg); }
        if (e.isBoss) { e.atk -= dt * 0.5; if (Math.random() < dt * 0.4) { const dir = Math.atan2(tx - e.x, tz - e.z); const m = ball(0.2, 0xff4400, e.x, 1.4, e.z); world.add(m); enemyBolts.push({ mesh: m, x: e.x, z: e.z, dx: Math.sin(dir), dz: Math.cos(dir), life: 4 }); } }
      }
      spawnTimer -= dt;
      if (quest && stage === 1 && enemies.length < 3 && minionsDown < 6) { spawnTimer = 0; spawnMinions(1); }
    }
    checkPickups(); updateHUD();
    netTimer -= dt;
    if (isParty && netTimer <= 0) { netTimer = 0.1; broadcast({ type: 'player', id: peer ? peer.id : 'solo', x: player.pos.x, z: player.pos.z, yaw: player.yaw, color: myColor }); if (isHost) for (const e of enemies) broadcast({ type: 'enemy', id: e.id, hp: e.hp, x: e.x, z: e.z, isBoss: e.isBoss }); }
    renderer.render(scene, camera);
  });
}
buildHub(); animate();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
