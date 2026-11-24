const socket = io();
const $ = id => document.getElementById(id);

let state = {
  name: "", code: "", hostId: null, playerId: null,
  role: null, topic: null, players: [], round: 0, totalRounds: 5,
  answerOrder: [], baseScores: {}, discussionTimer: null
};

const AVATAR_COLORS = ["#FFC94A","#FF8A5B","#7BE0B5","#7FA8FF","#C9A2FF","#FF8FBA","#5ED3E8","#D5E36B"];

/* ---------- helpers ---------- */
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function colorFor(name){
  const idx = state.players.findIndex(p => p.name === name);
  if (idx >= 0) return AVATAR_COLORS[idx % AVATAR_COLORS.length];
  let h = 0; for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatar(name, size=""){
  const initial = escapeHtml((String(name).trim()[0] || "?").toUpperCase());
  return `<span class="avatar ${size}" style="--c:${colorFor(name)}">${initial}</span>`;
}
function isHost(){ return socket.id === state.hostId; }
function hostName(){ return state.players.find(p => p.id === state.hostId)?.name || "the host"; }
function buzz(ms=15){ try { navigator.vibrate?.(ms); } catch {} }

function show(id){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0 });
}
let toastTimer;
function toast(msg){
  $("toast").textContent = msg; $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400);
}
function setError(msg){
  if ($("home").classList.contains("active")) $("homeError").textContent = msg;
  else toast(msg);
}
function hostOnly(btnId, hintId, waitingText){
  const host = isHost();
  $(btnId).classList.toggle("hidden", !host);
  $(hintId).textContent = host ? "" : waitingText;
}

/* ---------- home ---------- */
const params = new URLSearchParams(location.search);
if (params.get("room")) $("codeInput").value = params.get("room").toUpperCase().slice(0, 6);
try { const saved = localStorage.getItem("ooul:name"); if (saved) $("nameInput").value = saved; } catch {}

function readName(){
  const name = $("nameInput").value.trim();
  if (!name) { setError("Enter your name first."); $("nameInput").focus(); return null; }
  try { localStorage.setItem("ooul:name", name); } catch {}
  return name;
}
$("createBtn").onclick = () => {
  const name = readName(); if (!name) return;
  state.name = name; setError("");
  socket.emit("room:create", { name });
};
$("joinBtn").onclick = () => {
  const name = readName(); if (!name) return;
  const code = $("codeInput").value.trim().toUpperCase();
  if (!code) { setError("Enter the room code from the host's screen."); $("codeInput").focus(); return; }
  state.name = name; setError("");
  socket.emit("room:join", { name, code });
};
$("codeInput").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ""); });
$("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") $("joinBtn").click(); });
$("nameInput").addEventListener("keydown", e => {
  if (e.key === "Enter") ($("codeInput").value.trim() ? $("joinBtn") : $("createBtn")).click();
});

/* ---------- lobby ---------- */
function renderCode(code){
  $("bigCode").innerHTML = String(code).split("").map(c => `<span>${escapeHtml(c)}</span>`).join("");
  $("bigCode").setAttribute("aria-label", `Room code ${code.split("").join(" ")}`);
  $("roomBadge").textContent = code;
}
function renderPlayers(){
  const max = 8;
  $("playerCount").textContent = `${state.players.length} of ${max} seats`;
  const seats = state.players.map(p => {
    const tags = [p.id === state.hostId ? "Host" : "", p.id === socket.id ? "You" : ""].filter(Boolean).join(", ");
    return `<div class="seat ${p.connected ? "" : "off"}">${avatar(p.name)}<span class="who"><span class="nm">${escapeHtml(p.name)}</span>${tags ? `<span class="tag">${tags}</span>` : ""}</span></div>`;
  });
  for (let i = state.players.length; i < max; i++) seats.push(`<div class="seat empty">Open seat</div>`);
  $("playerList").innerHTML = seats.join("");
}
$("startBtn").onclick = () => socket.emit("game:start");
$("shareBtn").onclick = async () => {
  const url = `${location.origin}/?room=${state.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "One of Us Is Lying", text: `Join my room: ${state.code}`, url });
    else { await navigator.clipboard.writeText(url); toast("Invite link copied."); }
  } catch {}
};

/* ---------- secret card: press and hold ---------- */
function holdToReveal(el, onOpen, onClose){
  const open = e => { e?.preventDefault?.(); onOpen(); };
  const close = () => onClose();
  el.addEventListener("pointerdown", open);
  ["pointerup","pointerleave","pointercancel"].forEach(ev => el.addEventListener(ev, close));
  el.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) open(e); });
  el.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") close(); });
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("blur", close);
}
holdToReveal($("secretCard"),
  () => {
    const c = $("secretCard");
    if (!c.classList.contains("open")) buzz();
    c.classList.add("open", "seen");
    if (!$("readyBtn").dataset.done) { $("readyBtn").disabled = false; $("readyBtn").textContent = "I've answered"; }
    $("peekNote").textContent = "Let go to hide it again.";
  },
  () => {
    $("secretCard").classList.remove("open");
    if ($("secretCard").classList.contains("seen")) $("peekNote").textContent = "Hold again any time to check.";
  }
);
holdToReveal($("peekBtn"),
  () => {
    const out = $("peekOut");
    out.textContent = state.role === "impostor" ? "You're the impostor" : state.topic;
    out.classList.toggle("liar", state.role === "impostor");
  },
  () => { $("peekOut").textContent = ""; }
);

/* ---------- round ---------- */
$("readyBtn").onclick = () => {
  $("readyBtn").disabled = true;
  $("readyBtn").dataset.done = "1";
  $("readyBtn").classList.add("waiting");
  $("readyBtn").textContent = "Waiting for the others";
  socket.emit("answer:ready", { playerId: socket.id });
};
function renderDots(ready, total){
  $("readyDots").innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < ready ? "on" : ""}"></i>`).join("");
  $("answerProgress").textContent = `${ready} of ${total} have answered`;
}

/* ---------- discussion ---------- */
$("discussionDoneBtn").onclick = () => socket.emit("phase:advance");

/* ---------- voting ---------- */
let pendingVote = null;
$("lockVoteBtn").onclick = () => {
  if (!pendingVote) return;
  socket.emit("vote:submit", { targetId: pendingVote });
  $("voteList").classList.add("locked");
  document.querySelectorAll("#voteList .vote").forEach(b => b.disabled = true);
  $("lockVoteBtn").disabled = true;
  $("lockVoteBtn").classList.add("waiting");
  $("lockVoteBtn").textContent = "Vote locked in";
  $("voteStatus").textContent = "Waiting for everyone else to vote.";
};

/* ---------- reveal & scores ---------- */
$("nextBtn").onclick = () => socket.emit("phase:advance");
$("guessBtn").onclick = () => {
  const guess = $("guessInput").value.trim();
  if (!guess) { $("guessInput").focus(); return; }
  $("guessBtn").disabled = true;
  socket.emit("impostor:guess", { guess });
};
$("guessInput").addEventListener("keydown", e => { if (e.key === "Enter") $("guessBtn").click(); });
$("againBtn").onclick = () => location.href = `${location.origin}/`;

function renderScores(players, target, { deltas = true } = {}){
  const sorted = [...players].sort((a, b) => b.score - a.score);
  $(target).innerHTML = sorted.map((p, i) => {
    const d = p.score - (state.baseScores[p.id] ?? 0);
    const liar = p.id === state.lastImpostorId;
    const chip = deltas && d > 0 ? `<span class="delta ${liar ? "liar" : ""}">+${d}</span>` : "";
    return `<div class="score-row ${p.id === socket.id ? "me" : ""}">
      <span class="rk">${i + 1}</span>${avatar(p.name)}
      <span class="nm">${escapeHtml(p.name)}${p.id === socket.id ? "<small>you</small>" : ""}</span>
      ${chip}<span class="pts">${p.score}</span></div>`;
  }).join("");
}

/* ---------- socket events (unchanged protocol) ---------- */
socket.on("connect", () => state.playerId = socket.id);
socket.on("error:message", setError);

socket.on("room:created", ({ code }) => {
  state.code = code; renderCode(code); show("lobby");
});
socket.on("lobby:update", data => {
  Object.assign(state, data);
  renderCode(data.code);
  renderPlayers();
  const host = isHost();
  const need = Math.max(0, (data.minPlayers || 3) - data.players.length);
  $("startBtn").classList.toggle("hidden", !host);
  $("startBtn").disabled = need > 0;
  $("lobbyHint").textContent = host
    ? (need > 0 ? `Waiting for ${need} more ${need === 1 ? "player" : "players"} to join.` : "Everyone in? Deal when you're ready.")
    : `Waiting for ${hostName()} to deal the first round.`;
  show("lobby");
});

socket.on("round:start", data => {
  Object.assign(state, data);
  state.baseScores = Object.fromEntries(state.players.map(p => [p.id, p.score]));
  clearInterval(state.discussionTimer);

  $("roundNo").textContent = data.round; $("roundTotal").textContent = data.totalRounds;
  ["discRound","voteRound","revealRound"].forEach(id => $(id).textContent = `${data.round} of ${data.totalRounds}`);
  $("question").textContent = data.question;

  const card = $("secretCard"); card.classList.remove("open", "seen");
  const front = $("cardFront");
  const ready = $("readyBtn");
  delete ready.dataset.done; ready.classList.remove("waiting");
  ready.disabled = true; ready.textContent = "Look at your card first";
  $("peekNote").textContent = "Cover your screen. Only you should see this.";

  if (data.role === "impostor") {
    front.className = "pcard face-front is-liar";
    $("cornerTL").textContent = "?"; $("cornerBR").textContent = "?";
    $("roleTitle").textContent = "You're the impostor";
    $("topicBox").textContent = "No topic. Blend in.";
    $("roleBadge").textContent = "Impostor"; $("roleBadge").className = "pill liar";
    $("answerInstruction").textContent = "Everyone else knows the secret. Listen to the players before you and give an answer that fits.";
  } else {
    front.className = "pcard face-front is-truth";
    const initial = (data.topic || "?")[0].toUpperCase();
    $("cornerTL").textContent = initial; $("cornerBR").textContent = initial;
    $("roleTitle").textContent = "The secret is";
    $("topicBox").textContent = data.topic;
    $("roleBadge").textContent = "In on it"; $("roleBadge").className = "pill truth";
    $("answerInstruction").textContent = "Answer out loud without saying the topic. Too obvious and the impostor catches on.";
  }

  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  $("answerOrder").innerHTML = (data.answerOrder || []).map(id => {
    const p = byId[id]; if (!p) return "";
    return `<li class="${id === socket.id ? "me" : ""}">${escapeHtml(p.name)}${id === socket.id ? " (you)" : ""}</li>`;
  }).join("");
  renderDots(0, state.players.length || (data.answerOrder || []).length);
  show("round");
});
socket.on("answer:progress", d => renderDots(d.ready, d.total));

socket.on("phase:discussion", ({ seconds }) => {
  show("discussion");
  hostOnly("discussionDoneBtn", "discHint", `${hostName()} will open voting when time's up.`);
  const ring = $("timerRing"), wrap = $("timerWrap"), C = 552.92;
  let n = seconds;
  const paint = () => {
    $("discussionTimer").textContent = n;
    ring.style.strokeDashoffset = String(C * (1 - n / seconds));
    wrap.classList.toggle("low", n <= 10);
  };
  ring.style.transition = "none"; paint(); ring.getBoundingClientRect(); ring.style.transition = "";
  clearInterval(state.discussionTimer);
  state.discussionTimer = setInterval(() => {
    n--; paint();
    if (n === 10) buzz(30);
    if (n <= 0) {
      clearInterval(state.discussionTimer);
      if (isHost()) socket.emit("phase:advance");
    }
  }, 1000);
});

socket.on("phase:voting", ({ players }) => {
  clearInterval(state.discussionTimer);
  state.players = players; pendingVote = null;
  $("voteStatus").textContent = "";
  $("voteList").classList.remove("locked");
  const lock = $("lockVoteBtn");
  lock.disabled = true; lock.classList.remove("waiting"); lock.textContent = "Pick a player";
  $("voteList").innerHTML = players.filter(p => p.id !== socket.id).map(p =>
    `<button class="vote" data-id="${p.id}" aria-pressed="false">${avatar(p.name, "lg")}<span class="nm">${escapeHtml(p.name)}</span></button>`
  ).join("");
  document.querySelectorAll("#voteList .vote").forEach(btn => {
    btn.onclick = () => {
      if ($("voteList").classList.contains("locked")) return;
      document.querySelectorAll("#voteList .vote").forEach(b => { b.classList.remove("selected"); b.setAttribute("aria-pressed", "false"); });
      btn.classList.add("selected"); btn.setAttribute("aria-pressed", "true");
      pendingVote = btn.dataset.id;
      const name = players.find(p => p.id === pendingVote)?.name || "";
      lock.disabled = false; lock.textContent = `Lock in vote for ${name}`;
    };
  });
  show("voting");
});
socket.on("vote:accepted", () => { buzz(); toast("Vote locked in."); });

socket.on("vote:result", d => {
  state.players = d.players;
  state.lastImpostorId = d.impostorId;
  const accused = state.players.find(p => p.id === d.accusedId);
  const imp = state.players.find(p => p.id === d.impostorId);
  const youAreImp = imp?.id === socket.id;
  const cardPerson = d.tie ? imp : accused;

  $("revealAvatar").outerHTML = `<span id="revealAvatar" class="avatar xl" style="--c:${colorFor(cardPerson?.name || "?")}">${escapeHtml((cardPerson?.name || "?")[0].toUpperCase())}</span>`;
  $("revealName").textContent = cardPerson?.name || "";
  const stamp = $("revealStamp");
  if (d.tie) { stamp.textContent = "GOT AWAY"; stamp.className = "stamp liar"; }
  else if (d.impostorCaught) { stamp.textContent = "IMPOSTOR"; stamp.className = "stamp liar"; }
  else { stamp.textContent = "INNOCENT"; stamp.className = "stamp truth"; }

  if (d.tie) {
    $("revealTitle").textContent = "The vote was a tie";
    $("revealText").textContent = `Nobody was voted out, so ${youAreImp ? "you get" : `${imp?.name} gets`} away with it. +3 for the impostor.`;
  } else if (d.impostorCaught) {
    $("revealTitle").textContent = youAreImp ? "You got caught" : `You caught ${imp?.name}`;
    $("revealText").textContent = youAreImp ? "Guess the topic to win back 2 points." : "Everyone who knew the secret gets +2.";
  } else {
    $("revealTitle").textContent = `${accused?.name} was telling the truth`;
    $("revealText").textContent = `The impostor was ${youAreImp ? "you" : imp?.name} all along. +3 for the impostor.`;
  }
  $("revealTopic").innerHTML = (!d.impostorCaught && state.topic) ? `The secret was <b>${escapeHtml(state.topic)}</b>.` : "";
  if (youAreImp && !d.impostorCaught) $("revealTopic").innerHTML = "";

  const canGuess = d.impostorCaught && youAreImp;
  $("guessBox").classList.toggle("hidden", !canGuess);
  $("guessInput").value = ""; $("guessBtn").disabled = false;

  $("nextBtn").textContent = state.round >= state.totalRounds ? "See final scores" : "Next round";
  if (canGuess) { $("nextBtn").classList.add("hidden"); $("nextHint").textContent = ""; }
  else if (d.impostorCaught && isHost()) { $("nextBtn").classList.remove("hidden"); $("nextHint").textContent = `${imp?.name} is guessing the topic. Give them a moment before you continue.`; }
  else hostOnly("nextBtn", "nextHint", d.impostorCaught ? `${imp?.name} is guessing the topic.` : `Waiting for ${hostName()} to continue.`);

  $("scoresRound").textContent = `After round ${state.round}`;
  renderScores(d.players, "scores");

  const flip = $("revealCard"); flip.classList.remove("open");
  show("reveal");
  setTimeout(() => { flip.classList.add("open"); buzz(25); }, 450);
});

socket.on("impostor:guessResult", d => {
  state.players = d.players;
  $("guessBox").classList.add("hidden");
  const imp = state.players.find(p => p.id === state.lastImpostorId);
  const who = imp?.id === socket.id ? "You" : imp?.name;
  $("revealTopic").innerHTML = d.correct
    ? `${escapeHtml(who)} guessed <b>${escapeHtml(d.guess)}</b>. Correct, +2.`
    : `${escapeHtml(who)} guessed "${escapeHtml(d.guess)}". Wrong. The secret was <b>${escapeHtml(state.topic || "")}</b>.`;
  if (imp?.id === socket.id && !d.correct) $("revealTopic").innerHTML = `You guessed "${escapeHtml(d.guess)}". Not quite.`;
  hostOnly("nextBtn", "nextHint", `Waiting for ${hostName()} to continue.`);
  renderScores(d.players, "scores");
});

socket.on("game:over", d => {
  const ps = d.players;
  const top = ps[0]?.score ?? 0;
  const winners = ps.filter(p => p.score === top);
  $("winnerTitle").textContent = winners.length > 1
    ? `${winners.map(w => w.name).join(" & ")} tie for the win`
    : `${winners[0]?.name} wins`;
  $("roundsPlayed").textContent = `${state.totalRounds} rounds`;
  const slot = (p, cls, rank) => p ? `<div class="step ${cls}">${avatar(p.name, "lg")}<span class="nm">${escapeHtml(p.name)}</span><div class="block"><span class="p">${p.score}</span><small>${rank}</small></div></div>` : `<div></div>`;
  $("podium").innerHTML = slot(ps[1], "second", "2nd") + slot(ps[0], "first", "1st") + slot(ps[2], "third", "3rd");
  renderScores(ps, "finalScores", { deltas: false });
  show("gameover");
});

socket.on("player:disconnected", ({ playerId }) => {
  const p = state.players.find(x => x.id === playerId);
  toast(`${p ? p.name : "A player"} lost connection.`);
});
