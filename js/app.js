const LEVELS = {
  kolay: { rows: 9, cols: 9, mines: 10, hints: 2 },
  orta: { rows: 12, cols: 12, mines: 22, hints: 2 },
  zor: { rows: 16, cols: 16, mines: 40, hints: 3 },
};

const STORAGE_KEY = "gul-tarlasi-best";

const boardEl = document.getElementById("board");
const mineEl = document.getElementById("mine-count");
const timeEl = document.getElementById("time");
const shieldEl = document.getElementById("shield");
const shieldChip = document.getElementById("shield-chip");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");
const hintBtn = document.getElementById("hint");
const hintCountEl = document.getElementById("hint-count");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const fxEl = document.getElementById("fx");
const levelButtons = document.querySelectorAll(".level");

const state = {
  level: "kolay",
  mode: "dig",
  grid: [],
  cells: [],
  started: false,
  over: false,
  shield: true,
  hints: 2,
  startedAt: 0,
  timerId: null,
  seconds: 0,
};

let audioCtx = null;
let best = loadBest();

function loadBest() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveBest() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
}

function level() {
  return LEVELS[state.level];
}

function formatTime(total) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function inside(y, x) {
  const spec = level();
  return y >= 0 && x >= 0 && y < spec.rows && x < spec.cols;
}

function neighbors(y, x) {
  const list = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dy === 0 && dx === 0) continue;
      if (inside(y + dy, x + dx)) list.push([y + dy, x + dx]);
    }
  }
  return list;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function ensureAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(kind) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const notes = kind === "win" ? [523, 659, 784, 1046] : kind === "lose" ? [220, 174] : [494, 622];
  const now = ctx.currentTime;
  notes.forEach((frequency, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + index * 0.12;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  });
}

function burst(x, y, count) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ff4fa3", "#ff8ac4", "#f9a8d4", "#e9d5ff", "#c084fc", "#fff"];
  for (let i = 0; i < count; i += 1) {
    const spark = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 36 + Math.random() * 110;
    spark.className = "spark";
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.background = colors[i % colors.length];
    spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    fxEl.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove());
  }
}

function burstFromCell(y, x, count) {
  const rect = state.cells[y][x].getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, count);
}

function shake() {
  boardEl.classList.remove("is-shake");
  window.requestAnimationFrame(() => boardEl.classList.add("is-shake"));
}

function stopTimer() {
  if (state.timerId !== null) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function updateTime() {
  state.seconds = Math.floor((Date.now() - state.startedAt) / 1000);
  timeEl.textContent = formatTime(state.seconds);
}

function remainingMines() {
  let flags = 0;
  let defused = 0;
  state.grid.forEach((row) => {
    row.forEach((cell) => {
      if (cell.flagged) flags += 1;
      if (cell.defused) defused += 1;
    });
  });
  return level().mines - flags - defused;
}

function updateHud() {
  mineEl.textContent = String(remainingMines());
  shieldEl.textContent = state.shield ? "Açık" : "Kullanıldı";
  shieldChip.classList.toggle("is-spent", !state.shield);
  hintCountEl.textContent = String(state.hints);
  hintBtn.disabled = state.hints <= 0 || state.over;
  const record = best[state.level];
  bestEl.textContent = Number.isFinite(record) ? formatTime(record) : "—";
}

function paintCell(y, x, delay) {
  const cell = state.grid[y][x];
  const el = state.cells[y][x];
  el.className = "cell";
  el.style.animationDelay = delay ? `${delay}ms` : "";
  el.textContent = "";

  if (cell.defused) {
    el.classList.add("is-open", "is-bloom");
    el.textContent = "🌸";
  } else if (cell.revealed && cell.mine) {
    el.classList.add("is-open", "is-mine");
    if (cell.blast) el.classList.add("is-blast");
    el.textContent = "🌹";
  } else if (cell.revealed) {
    el.classList.add("is-open");
    if (cell.n > 0) {
      el.classList.add(`n${cell.n}`);
      el.textContent = String(cell.n);
    }
  } else if (cell.flagged) {
    el.classList.add("is-hidden", "is-flag");
    el.textContent = "🎀";
  } else if (cell.moon) {
    el.classList.add("is-hidden", "is-moon");
    el.textContent = "🌹";
  } else {
    el.classList.add("is-hidden");
  }

  if (delay) el.classList.add("is-pop");
  el.setAttribute("aria-label", cell.revealed ? "Açık kare" : "Kapalı kare");
}

function placeMines(sy, sx) {
  const forbidden = new Set();
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (inside(sy + dy, sx + dx)) forbidden.add(`${sy + dy},${sx + dx}`);
    }
  }

  const spec = level();
  const spots = [];
  for (let y = 0; y < spec.rows; y += 1) {
    for (let x = 0; x < spec.cols; x += 1) {
      if (!forbidden.has(`${y},${x}`)) spots.push([y, x]);
    }
  }
  shuffle(spots);
  spots.slice(0, spec.mines).forEach(([y, x]) => {
    state.grid[y][x].mine = true;
  });

  for (let y = 0; y < spec.rows; y += 1) {
    for (let x = 0; x < spec.cols; x += 1) {
      const cell = state.grid[y][x];
      if (cell.mine) continue;
      cell.n = neighbors(y, x).filter(([ny, nx]) => state.grid[ny][nx].mine).length;
    }
  }

  state.started = true;
  state.startedAt = Date.now();
  state.timerId = setInterval(updateTime, 200);
  ensureAudio();
}

function flood(sy, sx) {
  const queue = [[sy, sx, 0]];
  const seen = new Set();
  while (queue.length) {
    const [y, x, dist] = queue.shift();
    const key = `${y},${x}`;
    if (seen.has(key) || !inside(y, x)) continue;
    seen.add(key);
    const cell = state.grid[y][x];
    if (cell.revealed || cell.flagged || cell.mine || cell.defused) continue;
    cell.revealed = true;
    paintCell(y, x, Math.min(dist * 26, 280));
    if (cell.n === 0) {
      neighbors(y, x).forEach(([ny, nx]) => queue.push([ny, nx, dist + 1]));
    }
  }
}

function checkWin() {
  if (state.over) return;
  const won = state.grid.every((row) => row.every((cell) => cell.mine || cell.revealed));
  if (won) win();
}

function defuse(y, x) {
  const cell = state.grid[y][x];
  cell.defused = true;
  cell.revealed = true;
  state.shield = false;
  paintCell(y, x, 0);
  updateHud();
  shake();
  burstFromCell(y, x, 24);
  statusEl.textContent = "Kalkan açtı. Bu gül zararsız, devam et.";
  playTone("shield");
}

function lose(y, x) {
  state.over = true;
  stopTimer();
  state.grid[y][x].blast = true;
  state.grid.forEach((row) => {
    row.forEach((cell) => {
      if (cell.mine) cell.revealed = true;
    });
  });
  state.grid.forEach((row, rowIndex) => row.forEach((_, colIndex) => paintCell(rowIndex, colIndex, 0)));
  shake();
  burstFromCell(y, x, 36);
  playTone("lose");
  statusEl.textContent = "Gül battı.";
  showOverlay("Gül battı", `${formatTime(state.seconds)} dayandın. Bahçe yeniden açılabilir.`);
}

function win() {
  state.over = true;
  stopTimer();
  updateTime();
  const record = best[state.level];
  const fresh = !Number.isFinite(record) || state.seconds < record;
  if (fresh) {
    best[state.level] = state.seconds;
    saveBest();
  }
  updateHud();
  const rect = boardEl.getBoundingClientRect();
  burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 48);
  playTone("win");
  statusEl.textContent = "Bahçe açtı.";
  const note = fresh ? "Yeni en iyi süre." : "Bahçe temiz.";
  showOverlay("Bahçe açtı", `${formatTime(state.seconds)} · ${note}`);
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.add("is-open");
}

function toggleFlag(y, x) {
  if (state.over) return;
  const cell = state.grid[y][x];
  if (cell.revealed || cell.defused) return;
  cell.flagged = !cell.flagged;
  paintCell(y, x, 0);
  updateHud();
}

function chord(y, x) {
  const cell = state.grid[y][x];
  if (!cell.revealed || cell.n === 0 || state.over) return;
  const around = neighbors(y, x);
  const flags = around.filter(([ny, nx]) => state.grid[ny][nx].flagged).length;
  if (flags !== cell.n) return;
  for (const [ny, nx] of around) {
    const next = state.grid[ny][nx];
    if (next.flagged || next.revealed || next.defused) continue;
    if (next.mine) {
      if (state.shield) defuse(ny, nx);
      else {
        lose(ny, nx);
        return;
      }
    } else {
      flood(ny, nx);
    }
    if (state.over) return;
  }
  checkWin();
}

function handleClick(y, x) {
  if (state.over) return;
  const cell = state.grid[y][x];
  if (state.mode === "flag") {
    toggleFlag(y, x);
    return;
  }
  if (cell.flagged) return;
  if (cell.revealed) {
    chord(y, x);
    return;
  }
  if (!state.started) placeMines(y, x);
  if (cell.mine) {
    if (state.shield) defuse(y, x);
    else lose(y, x);
    return;
  }
  flood(y, x);
  statusEl.textContent = state.shield
    ? "Kalkanın duruyor. Açılmış sayıya basınca komşular açılır."
    : "Kalkan kullanıldı. Bayrakları dikkatli koy.";
  checkWin();
}

function moonlight() {
  if (state.over || state.hints <= 0) return;
  if (!state.started) {
    statusEl.textContent = "Ay ışığı, ilk kareden sonra bir gülü gösterir.";
    return;
  }
  const hidden = [];
  state.grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell.mine && !cell.revealed && !cell.flagged && !cell.defused && !cell.moon) hidden.push([y, x]);
    });
  });
  if (!hidden.length) {
    statusEl.textContent = "Gösterilecek gizli gül kalmadı.";
    return;
  }
  const [y, x] = hidden[Math.floor(Math.random() * hidden.length)];
  state.grid[y][x].moon = true;
  state.hints -= 1;
  paintCell(y, x, 0);
  updateHud();
  burstFromCell(y, x, 12);
  statusEl.textContent = "Ay ışığı bir gülü işaretledi. İstersen bayrak koy.";
  window.setTimeout(() => {
    if (!state.grid[y] || state.grid[y][x].revealed) return;
    state.grid[y][x].moon = false;
    paintCell(y, x, 0);
  }, 1600);
}

function newGarden() {
  stopTimer();
  const spec = level();
  state.grid = [];
  state.cells = [];
  state.started = false;
  state.over = false;
  state.shield = true;
  state.hints = spec.hints;
  state.seconds = 0;
  overlay.classList.remove("is-open");
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${spec.cols}, 1fr)`;
  timeEl.textContent = "0:00";
  statusEl.textContent = "İlk kare her zaman güvenli. Açılmış sayıya basınca komşular kontrol edilir.";

  for (let y = 0; y < spec.rows; y += 1) {
    const row = [];
    const elements = [];
    for (let x = 0; x < spec.cols; x += 1) {
      row.push({ mine: false, n: 0, revealed: false, flagged: false, defused: false, moon: false, blast: false });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell is-hidden";
      button.setAttribute("role", "gridcell");
      button.addEventListener("click", () => handleClick(y, x));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        toggleFlag(y, x);
      });
      boardEl.appendChild(button);
      elements.push(button);
    }
    state.grid.push(row);
    state.cells.push(elements);
  }
  updateHud();
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById("mode-dig").classList.toggle("is-active", mode === "dig");
  document.getElementById("mode-flag").classList.toggle("is-active", mode === "flag");
  document.getElementById("mode-dig").setAttribute("aria-pressed", mode === "dig" ? "true" : "false");
  document.getElementById("mode-flag").setAttribute("aria-pressed", mode === "flag" ? "true" : "false");
}

function setLevel(name) {
  if (!LEVELS[name]) return;
  state.level = name;
  levelButtons.forEach((button) => {
    const active = button.dataset.level === name;
    button.classList.toggle("is-active", active);
  });
  newGarden();
}

document.getElementById("mode-dig").addEventListener("click", () => setMode("dig"));
document.getElementById("mode-flag").addEventListener("click", () => setMode("flag"));
document.getElementById("hint").addEventListener("click", moonlight);
document.getElementById("restart").addEventListener("click", newGarden);
document.getElementById("overlay-again").addEventListener("click", newGarden);
levelButtons.forEach((button) => {
  button.addEventListener("click", () => setLevel(button.dataset.level));
});
boardEl.addEventListener("contextmenu", (event) => event.preventDefault());

newGarden();
