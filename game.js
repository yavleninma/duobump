const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BASE_ARENA_RADIUS = 220;
const PLAYER_RADIUS = 28;
const PLAYER_ACCEL = 1320;
const PLAYER_MAX_SPEED = 470;
const PLAYER_DAMPING = 0.9;
const COLLISION_RESTITUTION = 1.12;
const ROUND_START_DELAY = 1.1;
const ROUND_END_DELAY = 1.85;
const WINS_TO_MATCH = 5;
const ROUND_DURATION = 24;
const SPAWN_DISTANCE = 118;
const STICK_RADIUS = 38;
const DASH_BOOST = 420;
const DASH_COOLDOWN = 2.8;
const DASH_IMPACT_TIME = 0.28;
const DASH_SPEED_BONUS = 300;
const HIT_STUN = 0.16;
const POWERUP_RADIUS = 18;
const POWERUP_RESPAWN = 7.4;
const POWERUP_DURATION = 5.2;
const MIN_RING_RADIUS = 138;
const SHRINK_RATE = 14;

const ROUND_MODES = [
  { key:"classic", title:"Classic Clash", hint:"Straight-up brawl with a center core.", speed:1, knock:1, dash:1, arena:1, orb:1, sudden:11 },
  { key:"turbo", title:"Turbo Jam", hint:"More speed and faster Burst recovery.", speed:1.16, knock:1.04, dash:0.78, arena:1, orb:1.16, sudden:10.4 },
  { key:"heavy", title:"Heavy Hands", hint:"Slower feet, nastier knockback.", speed:0.97, knock:1.24, dash:1.04, arena:0.98, orb:1, sudden:11.6 },
  { key:"hot", title:"Hot Ring", hint:"Smaller arena and earlier collapse.", speed:1.05, knock:1.08, dash:0.9, arena:0.92, orb:1.22, sudden:13.2 }
];

const MODE_MAP = Object.fromEntries(ROUND_MODES.map((mode) => [mode.key, mode]));
const POWERUP_POINTS = [{ x:0, y:0 }, { x:78, y:0 }, { x:-78, y:0 }, { x:0, y:78 }, { x:0, y:-78 }];
const $ = (id) => document.getElementById(id);
const ui = {
  home:$("homePanel"),
  room:$("roomPanel"),
  arena:$("arenaPanel"),
  create:$("createRoomButton"),
  join:$("joinRoomButton"),
  code:$("roomCodeInput"),
  codeLabel:$("roomCodeLabel"),
  copy:$("copyCodeButton"),
  leave:$("leaveRoomButton"),
  status:$("roomStatus"),
  score:$("scoreboard"),
  start:$("startMatchButton"),
  pill:$("connectionPill"),
  canvas:$("gameCanvas"),
  overlay:$("overlayCard"),
  kicker:$("overlayKicker"),
  title:$("overlayTitle"),
  body:$("overlayBody"),
  rematch:$("rematchButton"),
  pad:$("stickPad"),
  knob:$("stickKnob"),
  burst:$("burstButton"),
  burstStatus:$("burstStatus")
};
const ctx = ui.canvas.getContext("2d");
const peerOptions = { debug:1, config:{ iceServers:[{ urls:"stun:stun.l.google.com:19302" }, { urls:"stun:stun1.l.google.com:19302" }] } };
const state = {
  role:null,
  peer:null,
  conn:null,
  roomCode:"",
  hostGame:null,
  room:null,
  remoteInput:{ x:0, y:0 },
  localInput:{ x:0, y:0 },
  localDash:null,
  remoteDash:null,
  prevInput:"",
  visuals:new Map(),
  keyboard:{ up:false, down:false, left:false, right:false },
  joy:{ active:false, pointerId:null, x:0, y:0 },
  lastInputAt:0,
  broadcast:0,
  effectSeen:new Set(),
  shake:0,
  flash:0
};

ui.create.onclick = createRoom;
ui.join.onclick = joinRoom;
ui.start.onclick = () => {
  if (state.role === "host" && state.hostGame && state.hostGame.players.length === 2) {
    startMatch();
    syncHost();
  }
};
ui.rematch.onclick = () => {
  if (!state.room) return;
  state.role === "host" ? registerRematch("host") : send({ type:"rematch" });
};
ui.leave.onclick = resetSession;
ui.burst.onpointerdown = (e) => { e.preventDefault(); requestDash(); };
ui.burst.onclick = (e) => e.preventDefault();
ui.copy.onclick = async () => {
  if (!state.roomCode) return;
  try {
    await navigator.clipboard.writeText(state.roomCode);
    setStatus("Room code copied.");
  } catch {
    setStatus("Copy failed.");
  }
};
ui.code.oninput = () => { ui.code.value = sanitizeCode(ui.code.value); };
ui.code.onkeydown = (e) => { if (e.key === "Enter") joinRoom(); };
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
window.addEventListener("keydown", (e) => { if (e.repeat) return; toggleKey(e, true); });
window.addEventListener("keyup", (e) => toggleKey(e, false));
ui.pad.addEventListener("pointerdown", onPadDown);
ui.pad.addEventListener("pointermove", onPadMove);
ui.pad.addEventListener("pointerup", onPadUp);
ui.pad.addEventListener("pointercancel", onPadUp);
setInterval(hostTick, 1000 / 60);
setInterval(() => syncInput(true), 50);
requestAnimationFrame(loop);

function toggleKey(e, down) {
  const key = String(e.key || "");
  const isBurst = key === " " || key === "Spacebar" || key === "Shift";
  if (isBurst && down) {
    e.preventDefault();
    requestDash();
    return;
  }
  if (key === "ArrowUp" || key === "w" || key === "W") { state.keyboard.up = down; e.preventDefault(); }
  if (key === "ArrowDown" || key === "s" || key === "S") { state.keyboard.down = down; e.preventDefault(); }
  if (key === "ArrowLeft" || key === "a" || key === "A") { state.keyboard.left = down; e.preventDefault(); }
  if (key === "ArrowRight" || key === "d" || key === "D") { state.keyboard.right = down; e.preventDefault(); }
  syncInput();
}

function onPadDown(e) {
  ui.pad.setPointerCapture(e.pointerId);
  state.joy.active = true;
  state.joy.pointerId = e.pointerId;
  updateJoy(e);
}
function onPadMove(e) { if (state.joy.active && state.joy.pointerId === e.pointerId) updateJoy(e); }
function onPadUp(e) {
  if (e.type !== "pointercancel" && state.joy.pointerId !== e.pointerId) return;
  state.joy = { active:false, pointerId:null, x:0, y:0 };
  ui.knob.style.transform = "translate(0px, 0px)";
  syncInput();
}
function updateJoy(e) {
  const rect = ui.pad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rx = e.clientX - cx;
  const ry = e.clientY - cy;
  const dist = Math.hypot(rx, ry);
  const len = Math.min(dist, STICK_RADIUS);
  const ang = Math.atan2(ry, rx);
  state.joy.x = dist ? Math.cos(ang) * (len / STICK_RADIUS) : 0;
  state.joy.y = dist ? Math.sin(ang) * (len / STICK_RADIUS) : 0;
  ui.knob.style.transform = "translate(" + (state.joy.x * STICK_RADIUS) + "px, " + (state.joy.y * STICK_RADIUS) + "px)";
  syncInput();
}

function requestDash() {
  const dir = desiredDashDirection();
  if (!dir.x && !dir.y) return;
  if (state.role === "guest") send({ type:"dash", x:dir.x, y:dir.y });
  if (state.role === "host") state.localDash = { x:dir.x, y:dir.y };
}

function desiredDashDirection() {
  const input = desiredInput();
  if (input.x || input.y) return input;
  const me = currentLocalPlayer();
  if (me && (me.facingX || me.facingY)) return normalize(me.facingX, me.facingY);
  return { x:1, y:0 };
}

function createRoom() {
  resetSession();
  setPill("Creating", false);
  tryCreateHost(0);
}
function tryCreateHost(attempt) {
  if (attempt > 6) return fail("Could not create a room.");
  const code = generateCode();
  const peer = new Peer("duobump-" + code, peerOptions);
  peer.on("open", () => {
    state.peer = peer;
    state.role = "host";
    state.roomCode = code;
    state.hostGame = makeGame(code);
    attachHostPeer(peer);
    setPill("Ready", true);
    syncHost();
  });
  peer.on("error", (error) => {
    peer.destroy();
    String(error.type || "").includes("unavailable") ? tryCreateHost(attempt + 1) : fail("Room creation failed.");
  });
}
function joinRoom() {
  const code = sanitizeCode(ui.code.value);
  if (code.length !== 4) return setStatus("Enter a 4-character room code.");
  resetSession();
  setPill("Joining", false);
  state.role = "guest";
  state.roomCode = code;
  state.peer = new Peer(undefined, peerOptions);
  state.peer.on("open", () => attachGuestConn(state.peer.connect("duobump-" + code, { reliable:true, serialization:"json" })));
  state.peer.on("error", () => fail("Room not found or connection failed."));
}
function attachHostPeer(peer) {
  peer.on("connection", (conn) => {
    if (state.conn && state.conn.open) {
      conn.on("open", () => {
        conn.send({ type:"error", message:"Room is full." });
        conn.close();
      });
      return;
    }
    state.conn = conn;
    state.remoteInput = { x:0, y:0 };
    state.remoteDash = null;
    conn.on("open", () => {
      addGuest();
      state.hostGame.message = "Duel locked. Host can start the match.";
      syncHost();
    });
    conn.on("data", hostData);
    conn.on("close", () => {
      state.conn = null;
      state.remoteInput = { x:0, y:0 };
      state.remoteDash = null;
      removeGuest();
      lobbyReset("Opponent left. Waiting for a new challenger.");
      syncHost();
    });
    conn.on("error", () => setStatus("Peer connection hiccup."));
  });
}
function attachGuestConn(conn) {
  state.conn = conn;
  conn.on("open", () => {
    setPill("Ready", true);
    setStatus("Connected. Waiting for host.");
  });
  conn.on("data", (msg) => {
    if (msg.type === "error") return fail(msg.message || "Join failed.");
    if (msg.type === "state") commitRoom(msg.room);
  });
  conn.on("close", () => fail("Connection closed. Host probably left."));
  conn.on("error", () => fail("Could not connect to that room."));
}
function hostData(msg) {
  if (!msg || !state.hostGame) return;
  if (msg.type === "input") state.remoteInput = { x:clamp(msg.x, -1, 1), y:clamp(msg.y, -1, 1) };
  if (msg.type === "dash") state.remoteDash = { x:clamp(msg.x, -1, 1), y:clamp(msg.y, -1, 1) };
  if (msg.type === "rematch") registerRematch("guest");
}

function modeByKey(key) { return MODE_MAP[key] || ROUND_MODES[0]; }
function makeGame(code) {
  const opener = ROUND_MODES[Math.floor(Math.random() * ROUND_MODES.length)];
  return {
    code,
    status:"lobby",
    round:0,
    timer:0,
    roundClock:ROUND_DURATION,
    message:"Share the room code with a second phone.",
    winnerId:null,
    roundWinnerId:null,
    rematchVotes:[],
    modeCursor:ROUND_MODES.findIndex((mode) => mode.key === opener.key),
    modeKey:opener.key,
    modeTitle:opener.title,
    modeHint:opener.hint,
    suddenDeath:false,
    baseRingRadius:BASE_ARENA_RADIUS,
    ringRadius:BASE_ARENA_RADIUS,
    nextPowerIn:5,
    powerup:null,
    effects:[],
    effectId:1,
    players:[makePlayer("host", "P1", getVar("--red"), -SPAWN_DISTANCE)]
  };
}
function makePlayer(id, label, color, x) {
  return { id, label, color, score:0, x, y:0, vx:0, vy:0, facingX:id === "host" ? 1 : -1, facingY:0, dashCd:0, impactTimer:0, powerTimer:0, stunTimer:0, hitFlash:0 };
}
function addGuest() {
  if (!state.hostGame.players.find((player) => player.id === "guest")) state.hostGame.players.push(makePlayer("guest", "P2", getVar("--blue"), SPAWN_DISTANCE));
}
function removeGuest() { state.hostGame.players = state.hostGame.players.filter((player) => player.id !== "guest"); }
function lobbyReset(message) {
  const game = state.hostGame;
  game.status = "lobby";
  game.round = 0;
  game.timer = 0;
  game.roundClock = ROUND_DURATION;
  game.message = message;
  game.winnerId = null;
  game.roundWinnerId = null;
  game.rematchVotes = [];
  game.suddenDeath = false;
  game.powerup = null;
  game.effects = [];
  game.ringRadius = BASE_ARENA_RADIUS;
  game.baseRingRadius = BASE_ARENA_RADIUS;
  game.players.forEach((player) => {
    player.score = 0;
    resetPlayer(player);
  });
}
function startMatch() {
  const game = state.hostGame;
  game.round = 0;
  game.winnerId = null;
  game.roundWinnerId = null;
  game.rematchVotes = [];
  game.players.forEach((player) => {
    player.score = 0;
    resetPlayer(player);
  });
  nextRound();
}
function nextRound() {
  const game = state.hostGame;
  const mode = ROUND_MODES[game.modeCursor % ROUND_MODES.length];
  game.modeCursor += 1;
  game.round += 1;
  game.status = "countdown";
  game.timer = ROUND_START_DELAY;
  game.roundClock = ROUND_DURATION;
  game.roundWinnerId = null;
  game.winnerId = null;
  game.modeKey = mode.key;
  game.modeTitle = mode.title;
  game.modeHint = mode.hint;
  game.suddenDeath = false;
  game.baseRingRadius = BASE_ARENA_RADIUS * mode.arena;
  game.ringRadius = game.baseRingRadius;
  game.nextPowerIn = 4.8 / mode.orb;
  game.powerup = null;
  game.effects = [];
  game.message = mode.title + ". " + mode.hint;
  game.players.forEach(resetPlayer);
  emitEffect(game, "round", 0, 0, "#ffffff", 0.36);
}
function resetPlayer(player) {
  player.x = player.id === "host" ? -SPAWN_DISTANCE : SPAWN_DISTANCE;
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.facingX = player.id === "host" ? 1 : -1;
  player.facingY = 0;
  player.dashCd = 0;
  player.impactTimer = 0;
  player.powerTimer = 0;
  player.stunTimer = 0;
  player.hitFlash = 0;
}

function hostTick() {
  if (state.role !== "host" || !state.hostGame) return;
  const game = state.hostGame;
  const dt = 1 / 60;
  stepEffects(game, dt);
  if (game.players.length === 2) {
    if (game.status === "countdown") {
      game.timer = Math.max(0, game.timer - dt);
      if (game.timer === 0) {
        game.status = "playing";
        game.message = "Burst on impact. Core online soon.";
      }
    } else if (game.status === "playing") {
      playTick(game, dt);
    } else if (game.status === "round-end") {
      game.timer = Math.max(0, game.timer - dt);
      if (game.timer === 0) nextRound();
    }
  }
  state.broadcast += dt;
  const room = serialize(game);
  if (state.broadcast >= 1 / 20) {
    state.broadcast = 0;
    commitRoom(room);
    send({ type:"state", room });
  } else {
    commitRoom(room);
  }
}
function playTick(game, dt) {
  const host = game.players.find((player) => player.id === "host");
  const guest = game.players.find((player) => player.id === "guest");
  [host, guest].forEach((player) => tickPlayerState(player, dt));
  tryDash(game, host, takeDashRequest("host"));
  tryDash(game, guest, takeDashRequest("guest"));
  movePlayer(game, host, state.localInput, dt);
  movePlayer(game, guest, state.remoteInput, dt);
  collide(game, host, guest);
  updatePowerup(game, dt);
  updateRoundFlow(game, dt);
  const outside = game.players.filter((player) => Math.hypot(player.x, player.y) > game.ringRadius + PLAYER_RADIUS);
  if (outside.length === 1) endRound(outside[0].id === "host" ? "guest" : "host");
  if (outside.length > 1) endRound(null);
}
function tickPlayerState(player, dt) {
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.impactTimer = Math.max(0, player.impactTimer - dt);
  player.powerTimer = Math.max(0, player.powerTimer - dt);
  player.stunTimer = Math.max(0, player.stunTimer - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt * 2.1);
}
function takeDashRequest(playerId) {
  if (playerId === "host") {
    const request = state.localDash;
    state.localDash = null;
    return request;
  }
  const request = state.remoteDash;
  state.remoteDash = null;
  return request;
}
function tryDash(game, player, request) {
  if (!request || game.status !== "playing" || player.dashCd > 0) return;
  const mode = modeByKey(game.modeKey);
  const dir = normalize(request.x || player.facingX, request.y || player.facingY);
  if (!dir.x && !dir.y) return;
  const boost = DASH_BOOST * mode.speed * (player.powerTimer > 0 ? 1.15 : 1);
  player.vx += dir.x * boost;
  player.vy += dir.y * boost;
  player.facingX = dir.x;
  player.facingY = dir.y;
  player.dashCd = DASH_COOLDOWN * mode.dash * (player.powerTimer > 0 ? 0.72 : 1);
  player.impactTimer = DASH_IMPACT_TIME + (player.powerTimer > 0 ? 0.08 : 0);
  player.hitFlash = 0.35;
  emitEffect(game, "dash", player.x + dir.x * 22, player.y + dir.y * 22, player.color, 0.28);
}
function movePlayer(game, player, input, dt) {
  const mode = modeByKey(game.modeKey);
  const dir = normalize(input.x, input.y);
  if (dir.x || dir.y) {
    player.facingX = dir.x;
    player.facingY = dir.y;
  }
  const controlScale = player.stunTimer > 0 ? 0.28 : 1;
  const accel = PLAYER_ACCEL * mode.speed * (player.powerTimer > 0 ? 1.22 : 1) * controlScale;
  player.vx += dir.x * accel * dt;
  player.vy += dir.y * accel * dt;
  const damping = Math.pow(Math.min(0.97, PLAYER_DAMPING + (game.suddenDeath ? 0.01 : 0)), dt * 60);
  player.vx *= damping;
  player.vy *= damping;
  const baseSpeed = PLAYER_MAX_SPEED * mode.speed * (player.powerTimer > 0 ? 1.18 : 1);
  const speedCap = baseSpeed + (player.impactTimer > 0 ? DASH_SPEED_BONUS : 0);
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > speedCap) {
    const scale = speedCap / speed;
    player.vx *= scale;
    player.vy *= scale;
  }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
}
function collide(game, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const minDist = PLAYER_RADIUS * 2;
  if (dist >= minDist) return;
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const nv = rvx * nx + rvy * ny;
  if (nv > 0) return;
  const mode = modeByKey(game.modeKey);
  const aMass = 1 + (a.powerTimer > 0 ? 0.16 : 0) + (a.impactTimer > 0 ? 0.28 : 0);
  const bMass = 1 + (b.powerTimer > 0 ? 0.16 : 0) + (b.impactTimer > 0 ? 0.28 : 0);
  const restitution = COLLISION_RESTITUTION * mode.knock * (game.suddenDeath ? 1.06 : 1);
  const impulse = (-(1 + restitution) * nv) / (1 / aMass + 1 / bMass);
  a.vx -= (impulse / aMass) * nx;
  a.vy -= (impulse / aMass) * ny;
  b.vx += (impulse / bMass) * nx;
  b.vy += (impulse / bMass) * ny;
  const closingSpeed = -nv;
  if (closingSpeed > 135) {
    let aggressor = null;
    const aEdge = a.impactTimer + a.powerTimer * 0.15;
    const bEdge = b.impactTimer + b.powerTimer * 0.15;
    if (aEdge > bEdge + 0.04) aggressor = a;
    if (bEdge > aEdge + 0.04) aggressor = b;
    if (aggressor) {
      const victim = aggressor === a ? b : a;
      victim.stunTimer = Math.max(victim.stunTimer, HIT_STUN + Math.min(0.12, closingSpeed / 1800));
      victim.hitFlash = 0.32;
    }
    a.hitFlash = Math.max(a.hitFlash, 0.18);
    b.hitFlash = Math.max(b.hitFlash, 0.18);
    emitEffect(game, "impact", a.x + dx * 0.5, a.y + dy * 0.5, aggressor ? aggressor.color : "#ffffff", Math.min(0.48, 0.22 + closingSpeed / 700));
    if (aggressor && closingSpeed > 250) game.message = aggressor.label + " slams through.";
  }
}
function updateRoundFlow(game, dt) {
  const mode = modeByKey(game.modeKey);
  game.roundClock = Math.max(0, game.roundClock - dt);
  if (!game.suddenDeath && game.roundClock <= mode.sudden) {
    game.suddenDeath = true;
    game.message = "Sudden death. The ring is collapsing.";
    emitEffect(game, "warning", 0, 0, "#ff8b52", 0.55);
  }
  if (game.suddenDeath) {
    const minRadius = Math.max(MIN_RING_RADIUS, game.baseRingRadius - 76);
    game.ringRadius = Math.max(minRadius, game.ringRadius - SHRINK_RATE * mode.speed * dt * (game.roundClock > 0 ? 1 : 1.35));
  }
}
function updatePowerup(game, dt) {
  if (game.powerup) {
    game.powerup.spin += dt * 4.8;
    const picker = game.players.find((player) => Math.hypot(player.x - game.powerup.x, player.y - game.powerup.y) <= PLAYER_RADIUS + game.powerup.radius + 4);
    if (picker) collectPowerup(game, picker);
    return;
  }
  game.nextPowerIn -= dt;
  if (game.nextPowerIn <= 0) spawnPowerup(game);
}
function spawnPowerup(game) {
  const point = POWERUP_POINTS[(game.round + game.effects.length) % POWERUP_POINTS.length];
  game.powerup = { x:point.x, y:point.y, radius:POWERUP_RADIUS, spin:0 };
  game.nextPowerIn = POWERUP_RESPAWN / modeByKey(game.modeKey).orb;
  game.message = "Core online. Control the middle.";
  emitEffect(game, "spawn", point.x, point.y, getVar("--gold"), 0.42);
}
function collectPowerup(game, player) {
  player.powerTimer = POWERUP_DURATION;
  player.dashCd = Math.max(0, player.dashCd - 0.9);
  player.hitFlash = 0.45;
  game.powerup = null;
  game.nextPowerIn = POWERUP_RESPAWN / modeByKey(game.modeKey).orb;
  game.message = player.label + " secures Overdrive.";
  emitEffect(game, "pickup", player.x, player.y, player.color, 0.6);
}
function emitEffect(game, type, x, y, color, life) {
  game.effects.push({ id:game.effectId++, type, x:round2(x), y:round2(y), color, life, maxLife:life });
  if (game.effects.length > 24) game.effects.shift();
}
function stepEffects(game, dt) {
  game.effects = game.effects.filter((effect) => {
    effect.life = Math.max(0, effect.life - dt);
    return effect.life > 0;
  });
}
function endRound(winnerId) {
  const game = state.hostGame;
  game.roundWinnerId = winnerId;
  game.players.forEach((player) => {
    player.vx = 0;
    player.vy = 0;
    player.impactTimer = 0;
  });
  game.powerup = null;
  if (!winnerId) {
    game.status = "round-end";
    game.timer = ROUND_END_DELAY;
    game.message = "Double fall. Resetting the round.";
    emitEffect(game, "warning", 0, 0, "#ffffff", 0.4);
    return syncHost();
  }
  const winner = game.players.find((player) => player.id === winnerId);
  winner.score += 1;
  emitEffect(game, "pickup", winner.x, winner.y, winner.color, 0.64);
  if (winner.score >= WINS_TO_MATCH) {
    game.status = "finished";
    game.winnerId = winnerId;
    game.message = winner.label + " wins the match.";
  } else {
    game.status = "round-end";
    game.timer = ROUND_END_DELAY;
    game.message = winner.label + " takes the round.";
  }
  syncHost();
}
function registerRematch(side) {
  const game = state.hostGame;
  if (!game || game.status !== "finished") return;
  if (!game.rematchVotes.includes(side)) game.rematchVotes.push(side);
  if (game.rematchVotes.length === 2) startMatch();
  else game.message = "Rematch armed. Waiting for the other player.";
  syncHost();
}
function serialize(game) {
  return {
    code:game.code,
    status:game.status,
    round:game.round,
    message:game.message,
    winsToMatch:WINS_TO_MATCH,
    countdown:game.status === "countdown" ? Math.max(0, Math.ceil(game.timer)) : 0,
    timeLeft:round2(game.roundClock),
    winnerId:game.winnerId,
    roundWinnerId:game.roundWinnerId,
    rematchVotes:game.rematchVotes.slice(),
    mode:{ key:game.modeKey, title:game.modeTitle, hint:game.modeHint },
    players:game.players.map((player) => ({
      id:player.id,
      label:player.label,
      color:player.color,
      score:player.score,
      x:round2(player.x),
      y:round2(player.y),
      vx:round2(player.vx),
      vy:round2(player.vy),
      facingX:round2(player.facingX),
      facingY:round2(player.facingY),
      dashCd:round2(player.dashCd),
      powerTimer:round2(player.powerTimer),
      stunTimer:round2(player.stunTimer),
      impactTimer:round2(player.impactTimer),
      hitFlash:round2(player.hitFlash)
    })),
    arena:{ radius:round2(game.ringRadius), baseRadius:round2(game.baseRingRadius), playerRadius:PLAYER_RADIUS, sudden:game.suddenDeath },
    powerup:game.powerup ? { x:round2(game.powerup.x), y:round2(game.powerup.y), radius:game.powerup.radius, spin:round2(game.powerup.spin) } : null,
    effects:game.effects.map((effect) => ({ id:effect.id, type:effect.type, x:effect.x, y:effect.y, color:effect.color, life:round2(effect.life), maxLife:round2(effect.maxLife) }))
  };
}
function syncHost() {
  const room = serialize(state.hostGame);
  commitRoom(room);
  send({ type:"state", room });
}
function send(msg) { if (state.conn && state.conn.open) state.conn.send(msg); }

function syncInput(force = false) {
  state.localInput = desiredInput();
  const key = state.localInput.x.toFixed(2) + ":" + state.localInput.y.toFixed(2);
  const now = Date.now();
  if (!force && key === state.prevInput) return;
  if (force && key === state.prevInput && now - state.lastInputAt < 250) return;
  state.prevInput = key;
  state.lastInputAt = now;
  if (state.role === "guest") send({ type:"input", x:state.localInput.x, y:state.localInput.y });
}
function desiredInput() {
  let x = 0;
  let y = 0;
  if (state.joy.active) {
    x = state.joy.x;
    y = state.joy.y;
  } else {
    x = Number(state.keyboard.right) - Number(state.keyboard.left);
    y = Number(state.keyboard.down) - Number(state.keyboard.up);
  }
  return normalize(x, y);
}
function commitRoom(room) {
  state.room = room;
  absorbEffects(room ? room.effects : []);
  renderUi();
}
function absorbEffects(effects) {
  const active = new Set();
  effects.forEach((effect) => {
    active.add(effect.id);
    if (!state.effectSeen.has(effect.id)) {
      state.effectSeen.add(effect.id);
      if (effect.type === "impact") {
        state.shake = Math.max(state.shake, 8);
        softBuzz(12);
      }
      if (effect.type === "pickup") {
        state.shake = Math.max(state.shake, 10);
        state.flash = Math.max(state.flash, 0.2);
        softBuzz(20);
      }
      if (effect.type === "warning") {
        state.shake = Math.max(state.shake, 6);
        softBuzz(24);
      }
    }
  });
  [...state.effectSeen].forEach((id) => { if (!active.has(id)) state.effectSeen.delete(id); });
}
function renderUi() {
  const inRoom = Boolean(state.room || state.roomCode);
  ui.home.hidden = inRoom;
  ui.room.hidden = !inRoom;
  ui.arena.hidden = !inRoom;
  ui.codeLabel.textContent = state.roomCode || "----";
  renderBurstButton();
  if (!state.room) return;
  ui.status.textContent = state.room.message;
  ui.start.hidden = !(state.role === "host" && state.room.status === "lobby" && state.room.players.length === 2);
  ui.score.innerHTML = state.room.players.map((player) => {
    const label = player.id === state.role ? "You" : "Rival";
    return '<div class="' + (player.id === state.role ? "score-row you" : "score-row") + '"><div class="score-player"><span class="score-dot" style="background:' + player.color + '"></span><div><div class="score-name">' + label + '</div><div class="score-role">' + player.label + " · " + playerStatusText(player) + '</div></div></div><div class="score-points">' + player.score + '</div><div class="score-target">/ ' + state.room.winsToMatch + "</div></div>";
  }).join("");
  renderOverlay();
}
function renderBurstButton() {
  const me = currentLocalPlayer();
  let text = "Ready";
  let ready = true;
  if (!state.room || state.room.status === "lobby") text = "Lobby";
  else if (state.room.status === "countdown") text = "Soon";
  else if (!me) text = "Link";
  else if (me.dashCd > 0) {
    text = me.dashCd.toFixed(1) + "s";
    ready = false;
  }
  ui.burstStatus.textContent = text;
  ui.burst.classList.toggle("ready", ready);
  ui.burst.classList.toggle("cooldown", !ready);
}
function renderOverlay() {
  const room = state.room;
  let kicker = "Lobby";
  let title = "Waiting for another player";
  let body = "Open the same URL on the second phone and join this room.";
  let show = true;
  let rematch = false;
  const winner = room.players.find((player) => player.id === room.winnerId);
  const roundWinner = room.players.find((player) => player.id === room.roundWinnerId);
  if (room.players.length < 2) {
    body = "Share the room code with a second phone.";
  } else if (room.status === "lobby") {
    kicker = room.mode.title;
    title = state.role === "host" ? "Start when ready" : "Host is about to start";
    body = state.role === "host" ? "Burst, steal the center core, and survive sudden death." : "The next fight opens with Burst and a center core.";
  } else if (room.status === "countdown") {
    kicker = room.mode.title;
    title = String(room.countdown || 1);
    body = room.mode.hint;
  } else if (room.status === "playing") {
    show = false;
  } else if (room.status === "round-end") {
    kicker = room.mode.title;
    title = roundWinner ? (roundWinner.id === state.role ? "You scored" : "Rival scored") : "Draw";
    body = roundWinner ? "Next round launches automatically." : "Nobody got the edge. Resetting.";
  } else if (room.status === "finished") {
    kicker = "Match point";
    title = winner && winner.id === state.role ? "You win" : "You got bumped";
    body = winner ? (winner.id === state.role ? "First to " + room.winsToMatch + " secured the set." : "Rival hit " + room.winsToMatch + " points first.") : "Match finished.";
    rematch = true;
    if (room.rematchVotes.includes(state.role) && room.rematchVotes.length < 2) body = "Rematch requested. Waiting for the other player.";
  }
  ui.kicker.textContent = kicker;
  ui.title.textContent = title;
  ui.body.textContent = body;
  ui.rematch.hidden = !rematch;
  ui.overlay.classList.toggle("hidden", !show);
}

function loop() {
  draw();
  requestAnimationFrame(loop);
}
function draw() {
  const w = ui.canvas.width;
  const h = ui.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#fffaf2");
  grad.addColorStop(1, "#eee6da");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  if (!state.room) {
    ctx.fillStyle = "rgba(31,29,26,.8)";
    ctx.font = "700 42px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText("DuoBump", w / 2, h * 0.4);
    ctx.fillStyle = "rgba(31,29,26,.46)";
    ctx.font = "600 20px Trebuchet MS";
    ctx.fillText("Create a room on one phone and join on the other.", w / 2, h * 0.47);
    return;
  }
  const room = state.room;
  state.shake = Math.max(0, state.shake - 0.45);
  state.flash = Math.max(0, state.flash - 0.014);
  const shakeX = state.shake ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake ? (Math.random() - 0.5) * state.shake : 0;
  const world = room.arena.baseRadius * 2 + 180;
  const scale = Math.min(w / world, h / (world + 180));
  const cx = w / 2;
  const cy = h * 0.44;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  drawArena(room);
  ctx.restore();
  drawHud(room, w, h);
  if (state.flash > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (state.flash * 0.4) + ")";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
function drawArena(room) {
  const ringRadius = room.arena.radius;
  const baseRadius = room.arena.baseRadius;
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath();
  ctx.arc(0, 0, baseRadius + 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = room.arena.sudden ? "rgba(255,139,82,.08)" : "rgba(255,255,255,.45)";
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = room.arena.sudden ? "rgba(255,139,82,.7)" : "rgba(31,29,26,.14)";
  ctx.lineWidth = room.arena.sudden ? 10 : 8;
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(31,29,26,.08)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawEffects(room.effects, "under");
  if (room.powerup) drawPowerup(room.powerup);
  room.players.forEach((player) => drawPlayer(player, room.arena.playerRadius));
  drawEffects(room.effects, "over");
}
function drawPowerup(powerup) {
  const pulse = 1 + Math.sin(powerup.spin * 1.8) * 0.08;
  ctx.save();
  ctx.translate(powerup.x, powerup.y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = "rgba(255,190,85,.18)";
  ctx.beginPath();
  ctx.arc(0, 0, powerup.radius + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,190,85,.65)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, powerup.radius + 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(powerup.spin);
  ctx.fillStyle = getVar("--gold");
  ctx.beginPath();
  ctx.moveTo(0, -powerup.radius);
  ctx.lineTo(7, -4);
  ctx.lineTo(powerup.radius, 0);
  ctx.lineTo(7, 4);
  ctx.lineTo(0, powerup.radius);
  ctx.lineTo(-7, 4);
  ctx.lineTo(-powerup.radius, 0);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawPlayer(player, radius) {
  const v = visual(player);
  const speed = Math.hypot(player.vx, player.vy);
  const squash = Math.min(speed / 420, 0.16);
  ctx.save();
  ctx.translate(v.x, v.y);
  if (player.powerTimer > 0) {
    ctx.fillStyle = "rgba(255,190,85,.16)";
    ctx.beginPath();
    ctx.arc(0, 0, radius + 12 + Math.sin(Date.now() / 120) * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (player.impactTimer > 0) {
    ctx.save();
    ctx.rotate(Math.atan2(player.facingY, player.facingX));
    ctx.fillStyle = "rgba(255,139,82,.24)";
    ctx.beginPath();
    ctx.ellipse(-18, 0, radius + 10, radius * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.scale(1 + squash, 1 - squash * 0.68);
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  if (player.hitFlash > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (0.18 + player.hitFlash * 0.42) + ")";
    ctx.beginPath();
    ctx.arc(-6, -8, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.beginPath();
  ctx.arc(-8, -6, 7, 0, Math.PI * 2);
  ctx.arc(8, -6, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f1d1a";
  ctx.beginPath();
  ctx.arc(-8 + player.facingX * 1.2, -6 + player.facingY * 1.2, 2.2, 0, Math.PI * 2);
  ctx.arc(8 + player.facingX * 1.2, -6 + player.facingY * 1.2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = player.stunTimer > 0 ? "rgba(31,29,26,.32)" : "rgba(31,29,26,.54)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 7, 8, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();
  ctx.restore();
}
function drawEffects(effects, layer) { effects.forEach((effect) => drawEffect(effect, layer)); }
function drawEffect(effect, layer) {
  const progress = 1 - effect.life / effect.maxLife;
  if ((effect.type === "dash" || effect.type === "round") && layer !== "under") return;
  if ((effect.type === "impact" || effect.type === "pickup" || effect.type === "spawn" || effect.type === "warning") && layer !== "over") return;
  ctx.save();
  ctx.translate(effect.x, effect.y);
  if (effect.type === "dash") {
    ctx.strokeStyle = alphaColor(effect.color, 0.38 * (1 - progress));
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 18 + progress * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (effect.type === "round") {
    ctx.strokeStyle = alphaColor("#ffffff", 0.25 * (1 - progress));
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 36 + progress * 140, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (effect.type === "impact") {
    ctx.strokeStyle = alphaColor(effect.color, 0.55 * (1 - progress));
    ctx.lineWidth = 4;
    for (let i = 0; i < 8; i += 1) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(10 + progress * 10, 0);
      ctx.lineTo(24 + progress * 18, 0);
      ctx.stroke();
    }
    ctx.fillStyle = alphaColor("#ffffff", 0.26 * (1 - progress));
    ctx.beginPath();
    ctx.arc(0, 0, 10 + progress * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  if (effect.type === "pickup" || effect.type === "spawn") {
    ctx.strokeStyle = alphaColor(effect.color, 0.6 * (1 - progress));
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 12 + progress * 28, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (effect.type === "warning") {
    ctx.strokeStyle = alphaColor(effect.color, 0.42 * (1 - progress));
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 60 + progress * 180, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
function drawHud(room, w, h) {
  pill(20, 18, 128, 34, "ROOM " + room.code, room.players[0].color, "left");
  const centerLabel = room.arena.sudden ? "SUDDEN DEATH" : "ROUND " + room.round + " · " + room.mode.title;
  pill(w / 2 - 118, 18, 236, 34, centerLabel, room.arena.sudden ? getVar("--ember") : getVar("--gold"), "center");
  const timerLabel = room.status === "playing" ? formatTime(room.timeLeft) : "FT " + room.winsToMatch;
  pill(w - 126, 18, 106, 34, timerLabel, room.arena.sudden ? getVar("--ember") : getVar("--blue"), "right");
  const me = room.players.find((player) => player.id === state.role);
  const rival = room.players.find((player) => player.id !== state.role);
  if (me && rival) {
    badge(20, h - 70, me.color, "YOU " + me.score, playerStatusText(me), 170);
    badge(w - 190, h - 70, rival.color, "RIVAL " + rival.score, playerStatusText(rival), 170);
  }
  if (room.powerup) {
    ctx.fillStyle = "rgba(31,29,26,.7)";
    ctx.font = "700 16px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText("CORE LIVE", w / 2, h - 26);
  }
}
function pill(x, y, width, height, label, dotColor, align) {
  ctx.fillStyle = "rgba(255,255,255,.88)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 17);
  ctx.fill();
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + 16, y + height / 2, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(31,29,26,.8)";
  ctx.font = "700 15px Trebuchet MS";
  ctx.textAlign = align;
  const textX = align === "left" ? x + 30 : align === "right" ? x + width - 12 : x + width / 2 + 8;
  ctx.fillText(label, textX, y + 22);
}
function badge(x, y, color, label, status, width) {
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.beginPath();
  ctx.roundRect(x, y, width, 48, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 16, y + 17, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(31,29,26,.82)";
  ctx.textAlign = "left";
  ctx.font = "700 14px Trebuchet MS";
  ctx.fillText(label, x + 30, y + 20);
  ctx.fillStyle = "rgba(31,29,26,.5)";
  ctx.font = "600 11px Trebuchet MS";
  ctx.fillText(status, x + 14, y + 38);
}
function visual(player) {
  const existing = state.visuals.get(player.id);
  if (!existing) {
    const start = { x:player.x, y:player.y };
    state.visuals.set(player.id, start);
    return start;
  }
  existing.x += (player.x - existing.x) * 0.35;
  existing.y += (player.y - existing.y) * 0.35;
  return existing;
}
function resizeCanvas() {
  const rect = ui.canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  ui.canvas.width = Math.round(rect.width * ratio);
  ui.canvas.height = Math.round(rect.height * ratio);
}

function currentLocalPlayer() { return state.room ? state.room.players.find((player) => player.id === state.role) : null; }
function playerStatusText(player) {
  const parts = [];
  if (player.powerTimer > 0) parts.push("Overdrive " + player.powerTimer.toFixed(1) + "s");
  if (player.stunTimer > 0.04) parts.push("Staggered");
  parts.push(player.dashCd > 0 ? "Burst " + player.dashCd.toFixed(1) + "s" : "Burst ready");
  return parts.join(" · ");
}
function alphaColor(hex, alpha) {
  const color = hex.replace("#", "");
  if (color.length !== 6) return hex;
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}
function formatTime(seconds) { return Math.max(0, seconds).toFixed(seconds > 9 ? 0 : 1) + "s"; }
function softBuzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); }
function generateCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  return code;
}
function normalize(x, y) {
  const len = Math.hypot(x, y);
  return len ? { x:x / len, y:y / len } : { x:0, y:0 };
}
function sanitizeCode(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }
function clamp(value, min, max) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : 0;
}
function round2(value) { return Math.round(value * 100) / 100; }
function getVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function setStatus(text) { ui.status.textContent = text; }
function setPill(text, ok) {
  ui.pill.textContent = text;
  ui.pill.classList.toggle("connected", !!ok);
}
function fail(message) {
  setStatus(message);
  setPill("Offline", false);
}
function resetSession() {
  if (state.conn && state.conn.open) state.conn.close();
  if (state.peer && !state.peer.destroyed) state.peer.destroy();
  state.role = null;
  state.peer = null;
  state.conn = null;
  state.roomCode = "";
  state.hostGame = null;
  state.room = null;
  state.remoteInput = { x:0, y:0 };
  state.localInput = { x:0, y:0 };
  state.localDash = null;
  state.remoteDash = null;
  state.prevInput = "";
  state.visuals.clear();
  state.effectSeen.clear();
  state.shake = 0;
  state.flash = 0;
  setPill("Offline", false);
  ui.home.hidden = false;
  ui.room.hidden = true;
  ui.arena.hidden = true;
  renderBurstButton();
}
