/* =============================================
   EPI DETECTIVE — GAME ENGINE
   ============================================= */

// ── STATE ──────────────────────────────────────
const STATE = {
  screen: 'title',   // 'title' | 'select' | 'game' | 'rankup' | 'victory'
  currentCase: null,
  nodeIndex: 0,
  score: 0,
  xp: 0,
  xpToRank: 150,
  casesCompleted: [],
  rank: 0,
  muted: false,
  typing: false,
  typewriterTimer: null,
  fullText: '',
  casefileEntries: [],
  audioCtx: null,
  // Track user-toggled panel visibility so advancing nodes doesn't override their choice
  casefileUserVisible: false,   // only show when user pressed N, or a new entry arrives
  toolsUserHidden: false,       // true when user pressed D to hide; cleared when a new tool set loads
  pendingFeedbackNext: null,    // set when waiting for player to dismiss feedback
};

const RANKS = [
  { name: 'ROOKIE INVESTIGATOR',    color: '#aaaaaa', xpNeeded: 0   },
  { name: 'FIELD EPIDEMIOLOGIST',   color: '#39ff14', xpNeeded: 150 },
  { name: 'SENIOR EPI DETECTIVE',   color: '#00e5ff', xpNeeded: 400 },
  { name: 'OUTBREAK SPECIALIST',    color: '#ffe600', xpNeeded: 700 },
  { name: 'WORLD-CLASS DETECTIVE',  color: '#ff00ff', xpNeeded: 1100},
];

// ── AUDIO ENGINE ───────────────────────────────
function getAudioCtx() {
  if (!STATE.audioCtx) {
    STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return STATE.audioCtx;
}

function playSFX(type) {
  if (STATE.muted) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const patterns = {
      click:   { freq: 440, type: 'square',   dur: 0.05, vol: 0.15 },
      correct: { freq: 660, type: 'square',   dur: 0.3,  vol: 0.2,  sweep: 880 },
      wrong:   { freq: 200, type: 'sawtooth', dur: 0.4,  vol: 0.2,  sweep: 100 },
      rankup:  { freq: 523, type: 'square',   dur: 0.8,  vol: 0.25, sweep: 1047 },
      blip:    { freq: 330, type: 'square',   dur: 0.04, vol: 0.1 },
      fanfare: { freq: 784, type: 'square',   dur: 1.2,  vol: 0.2,  sweep: 1568 },
      xp:      { freq: 550, type: 'square',   dur: 0.15, vol: 0.12, sweep: 700 },
    };

    const p = patterns[type] || patterns.blip;
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.freq, ctx.currentTime);
    if (p.sweep) osc.frequency.exponentialRampToValueAtTime(p.sweep, ctx.currentTime + p.dur);
    gain.gain.setValueAtTime(p.vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + p.dur);
    osc.start();
    osc.stop(ctx.currentTime + p.dur);
  } catch(e) {}
}

// BG music: simple procedural chiptune
let bgMusicInterval = null;
const BG_NOTES = [261, 329, 392, 523, 392, 329, 261, 220, 261, 330, 392, 440];
let bgNoteIdx = 0;

function startBGMusic() {
  if (STATE.muted || bgMusicInterval) return;
  bgMusicInterval = setInterval(() => {
    if (STATE.muted) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = BG_NOTES[bgNoteIdx % BG_NOTES.length];
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
      bgNoteIdx++;
    } catch(e) {}
  }, 220);
}

function toggleMute() {
  STATE.muted = !STATE.muted;
  document.getElementById('mute-btn').textContent = STATE.muted ? '✕ SOUND OFF' : '♪ SOUND ON';
  if (STATE.muted && bgMusicInterval) {
    clearInterval(bgMusicInterval);
    bgMusicInterval = null;
  } else if (!STATE.muted) {
    startBGMusic();
  }
}

// ── HUD UPDATE ─────────────────────────────────
function updateHUD() {
  const rank = RANKS[STATE.rank];
  const el = document.getElementById('hud-rank');
  el.textContent = rank.name.split(' ')[0];
  el.style.color = rank.color;
  el.style.textShadow = `0 0 8px ${rank.color}`;

  document.getElementById('hud-cases').textContent = `${STATE.casesCompleted.length}/3`;
  document.getElementById('hud-score').textContent = STATE.score;

  // XP bar
  const nextRank = RANKS[STATE.rank + 1];
  if (nextRank) {
    const pct = Math.min(100, ((STATE.xp - rank.xpNeeded) / (nextRank.xpNeeded - rank.xpNeeded)) * 100);
    document.getElementById('xp-fill').style.width = pct + '%';
  } else {
    document.getElementById('xp-fill').style.width = '100%';
    document.getElementById('xp-fill').style.background = '#ff00ff';
  }
}

// ── SCREEN MANAGEMENT ──────────────────────────
function showScreen(id) {
  ['title-screen','outbreak-select','game-scene','rankup-screen','victory-screen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) {
    target.style.display = 'flex';
    // All screens are column-direction flex containers
    target.style.flexDirection = 'column';
  }
}

function showOutbreakSelect() {
  showScreen('outbreak-select');
  STATE.screen = 'select';
  // Unlock logic
  if (STATE.casesCompleted.includes('buffet')) {
    document.getElementById('case-legionnaires').classList.remove('locked');
    document.getElementById('case-legionnaires').classList.add('unlocked');
    document.getElementById('case-legionnaires-status').textContent = 'OPEN';
    document.getElementById('case-legionnaires-status').style.color = 'var(--green)';
  }
  if (STATE.casesCompleted.includes('legionnaires')) {
    document.getElementById('case-measles').classList.remove('locked');
    document.getElementById('case-measles').classList.add('unlocked');
    document.getElementById('case-measles-status').textContent = 'OPEN';
    document.getElementById('case-measles-status').style.color = 'var(--green)';
  }
  STATE.casesCompleted.forEach(c => {
    const el = document.getElementById(`case-${c}`);
    if (el) {
      el.classList.add('completed');
      el.querySelector('[id$="-status"]') && (el.querySelector('[id$="-status"]').textContent = '✓ SOLVED');
    }
  });
}

// ── TYPEWRITER ─────────────────────────────────
function typeText(text, speed = 28, callback) {
  clearTimeout(STATE.typewriterTimer);
  const el = document.getElementById('dialog-text');
  el.classList.add('typing');
  el.textContent = '';
  STATE.typing = true;
  STATE.fullText = text;
  let i = 0;

  function tick() {
    if (i < text.length) {
      el.textContent = text.slice(0, ++i);
      if (text[i-1] !== ' ') playSFX('blip');
      STATE.typewriterTimer = setTimeout(tick, speed);
    } else {
      el.classList.remove('typing');
      STATE.typing = false;
      document.getElementById('continue-prompt').style.display = 'block';
      if (callback) callback();
    }
  }
  document.getElementById('continue-prompt').style.display = 'none';
  tick();
}

function skipTyping() {
  if (STATE.typing) {
    clearTimeout(STATE.typewriterTimer);
    document.getElementById('dialog-text').classList.remove('typing');
    document.getElementById('dialog-text').textContent = STATE.fullText;
    STATE.typing = false;
    document.getElementById('continue-prompt').style.display = 'block';
  }
}

// ── CASEFILE ───────────────────────────────────
function addCasefile(entry, isNew = true) {
  STATE.casefileEntries.push({ text: entry, isNew });
  renderCasefile();
}

function renderCasefile() {
  const container = document.getElementById('casefile-entries');
  container.innerHTML = '';
  STATE.casefileEntries.forEach(e => {
    const div = document.createElement('div');
    div.className = 'casefile-entry' + (e.isNew ? ' new' : '');
    div.textContent = '▸ ' + e.text;
    container.appendChild(div);
  });
}

// ── XP & RANK ──────────────────────────────────
function awardXP(amount) {
  STATE.xp += amount;
  STATE.score += amount;
  updateHUD();
  // Check rank up
  let newRank = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (STATE.xp >= RANKS[i].xpNeeded) { newRank = i; break; }
  }
  if (newRank > STATE.rank) {
    STATE.rank = newRank;
    updateHUD();
    return true; // ranked up
  }
  return false;
}

// ── SCENE PAINTER ──────────────────────────────
const SCENE_PAINTERS = {
  title: paintSceneTitle,
  buffet: paintSceneBuffet,
  legionnaires: paintSceneLegionnaires,
  measles: paintSceneMeasles,
  lab: paintSceneLab,
  press: paintScenePress,
};

function paintScene(name) {
  const canvas = document.getElementById('scene-canvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 860;
  const fn = SCENE_PAINTERS[name] || SCENE_PAINTERS.lab;
  fn(canvas);
}

function pixelRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

function paintSceneTitle(canvas) { /* handled by star canvas */ }

function paintSceneBuffet(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // Background gradient (restaurant)
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#1a0800'); grad.addColorStop(1,'#3d1500');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);
  // Floor tiles
  for (let x = 0; x < W; x += 32) {
    pixelRect(ctx, x, H-32, 32, 32, x%64===0 ? '#2a1000' : '#1a0a00');
    pixelRect(ctx, x, H-64, 32, 32, '#3d1800');
  }
  // Table
  pixelRect(ctx, W/2-80, H-80, 160, 16, '#5c3000');
  pixelRect(ctx, W/2-72, H-96, 144, 16, '#7a4000');
  // Food items on table (pixel art)
  const foods = [
    {x:W/2-60, color:'#cc2200', label:'Chicken'}, // red = suspect
    {x:W/2-20, color:'#88aa00', label:'Salad'},
    {x:W/2+20, color:'#ddaa00', label:'Rice'},
    {x:W/2+50, color:'#ff6600', label:'Shrimp'},
  ];
  foods.forEach(f => {
    pixelRect(ctx, f.x-12, H-112, 24, 16, f.color);
    // plate
    pixelRect(ctx, f.x-14, H-97, 28, 4, '#aaaaaa');
  });
  // Stick figure attendees (pixel art)
  for (let i = 0; i < 5; i++) {
    const fx = 40 + i * 150;
    const colors = ['#4444ff','#ff4444','#44ff44','#ffff44','#ff44ff'];
    drawPixelPerson(ctx, fx, H-40, colors[i]);
  }
  // Warning sign
  pixelRect(ctx, W-60, 20, 48, 36, '#ff2200');
  ctx.fillStyle = '#ffff00';
  ctx.font = '18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('!', W-36, 44);
  ctx.font = '7px monospace';
  ctx.fillText('OUTBREAK', W-36, 54);
}

function drawPixelPerson(ctx, x, y, color) {
  // Head
  pixelRect(ctx, x-4, y-24, 8, 8, color);
  // Body
  pixelRect(ctx, x-4, y-16, 8, 12, color);
  // Arms
  pixelRect(ctx, x-8, y-14, 4, 6, color);
  pixelRect(ctx, x+4, y-14, 4, 6, color);
  // Legs
  pixelRect(ctx, x-4, y-4, 3, 8, color);
  pixelRect(ctx, x+1, y-4, 3, 8, color);
}

function paintSceneLegionnaires(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // Night sky
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#000814'); grad.addColorStop(1,'#001428');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);
  // Stars
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 127 + 13) % W;
    const sy = (i * 83 + 7) % (H * 0.6);
    ctx.fillRect(sx, sy, (i%3===0)?2:1, (i%3===0)?2:1);
  }
  // Hotel building
  const bx = W/2-80;
  pixelRect(ctx, bx, 20, 160, H-40, '#1a2a3a');
  // Windows (some lit = sick people)
  const winColors = ['#001428','#ffe066','#ffe066','#001428','#ffe066','#001428','#001428','#ffe066'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const wx = bx + 16 + col * 36;
      const wy = 30 + row * 28;
      const isLit = winColors[(row*4+col)%8] !== '#001428';
      pixelRect(ctx, wx, wy, 20, 16, isLit ? '#ffe066' : '#001428');
      if (isLit) {
        pixelRect(ctx, wx+6, wy+4, 8, 6, '#ff6600'); // sick glow
      }
    }
  }
  // Cooling tower on roof
  pixelRect(ctx, bx+40, 10, 30, 20, '#2a3a4a');
  // Steam droplets
  ctx.fillStyle = '#88ccff';
  ctx.fillRect(bx+50, 2, 4, 4);
  ctx.fillRect(bx+58, 0, 3, 3);
  ctx.fillRect(bx+46, 5, 3, 3);
  // Red cross / health marker
  pixelRect(ctx, W-48, H-60, 36, 36, '#220000');
  ctx.fillStyle = '#ff2200';
  ctx.fillRect(W-40, H-56, 20, 6);
  ctx.fillRect(W-34, H-62, 8, 18);
  // Ground
  pixelRect(ctx, 0, H-28, W, 28, '#0a1a0a');
  pixelRect(ctx, 0, H-32, W, 4, '#0d2000');
}

function paintSceneMeasles(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  // School exterior
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#87ceeb'); grad.addColorStop(1,'#4682b4');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H/2);
  pixelRect(ctx, 0, H/2, W, H/2, '#1a1a1a');
  // School building
  pixelRect(ctx, W/2-120, H*0.2, 240, H*0.65, '#cc8833');
  pixelRect(ctx, W/2-40, H*0.2-20, 80, 24, '#aa6622');  // gable
  // Door
  pixelRect(ctx, W/2-12, H*0.6, 24, 32, '#663300');
  // School windows
  for (let i = 0; i < 4; i++) {
    const wx = W/2 - 100 + i*60;
    pixelRect(ctx, wx, H*0.3, 28, 24, '#cceeff');
    // Some windows have red spots (sick kids)
    if (i===1 || i===3) {
      ctx.fillStyle = '#ff2222';
      ctx.fillRect(wx+4, H*0.3+4, 6, 6);
      ctx.fillRect(wx+14, H*0.3+8, 4, 4);
    }
  }
  // Children outside - some healthy, some sick
  const childColors = ['#4444ff','#ff4444','#44ff44','#ff4444','#4444ff','#ff4444'];
  childColors.forEach((c, i) => {
    drawPixelPerson(ctx, 60 + i * 130, H-36, c);
    if (c === '#ff4444') {
      // Rash dots
      ctx.fillStyle = '#ffaa00';
      ctx.fillRect(60+i*130-6, H-50, 3, 3);
      ctx.fillRect(60+i*130+2, H-48, 3, 3);
    }
  });
  // Anti-vax protest sign (pixel art)
  pixelRect(ctx, W-100, H/2-30, 4, 60, '#885522');  // stick
  pixelRect(ctx, W-116, H/2-40, 40, 24, '#ffffff');
  ctx.fillStyle = '#ff0000';
  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('NO VAX', W-96, H/2-26);
  ctx.fillText('!!!!', W-96, H/2-16);
}

function paintSceneLab(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#0a0a1a'); grad.addColorStop(1,'#0d0d2a');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);
  // Lab bench
  pixelRect(ctx, 40, H-60, W-80, 20, '#2a2a3a');
  // Microscope pixel art
  pixelRect(ctx, 80, H-100, 12, 40, '#666688');
  pixelRect(ctx, 76, H-64, 20, 8, '#666688');
  pixelRect(ctx, 84, H-104, 8, 8, '#aaaacc');
  // Lab samples
  for (let i = 0; i < 6; i++) {
    const colors = ['#ff2244','#22ff44','#2244ff','#ffff00','#ff44ff','#44ffff'];
    pixelRect(ctx, 130 + i*60, H-80, 10, 24, colors[i]);
    pixelRect(ctx, 128 + i*60, H-57, 14, 4, '#aaaaaa');
  }
  // Computer screen
  pixelRect(ctx, W-160, H-110, 100, 72, '#222244');
  pixelRect(ctx, W-156, H-106, 92, 60, '#001144');
  // Epi curve on screen
  const barH = [15,28,42,38,25,14,8];
  barH.forEach((bh, i) => {
    ctx.fillStyle = i < 3 ? '#ff4444' : '#4488ff';
    ctx.fillRect(W-152 + i*12, H-106+60-bh, 9, bh);
  });
  // CDC logo placeholder
  pixelRect(ctx, W-60, 20, 44, 20, '#003366');
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CDC', W-38, 34);
}

function paintScenePress(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#1a0000'); grad.addColorStop(1,'#2a0808');
  ctx.fillStyle = grad; ctx.fillRect(0,0,W,H);
  // Podium
  pixelRect(ctx, W/2-40, H-80, 80, 60, '#3a2a00');
  pixelRect(ctx, W/2-50, H-88, 100, 8, '#5c4200');
  // Microphone
  pixelRect(ctx, W/2-3, H-100, 6, 12, '#888888');
  pixelRect(ctx, W/2-6, H-110, 12, 10, '#444444');
  // Camera flashes (pixel dots)
  const flashPositions = [[60,30],[200,50],[400,25],[600,40],[780,30]];
  flashPositions.forEach(([fx,fy]) => {
    ctx.fillStyle = 'rgba(255,255,200,0.7)';
    ctx.fillRect(fx, fy, 6, 6);
    ctx.fillStyle = 'rgba(255,255,200,0.2)';
    ctx.fillRect(fx-4, fy-4, 14, 14);
  });
  // Audience (pixel people)
  for (let i = 0; i < 8; i++) {
    drawPixelPerson(ctx, 50 + i * 110, H-40, '#336633');
  }
}

// Star canvas for title
function drawStars() {
  const canvas = document.getElementById('star-canvas');
  if (!canvas) return;
  canvas.width = canvas.parentElement.offsetWidth || 860;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width, canvas.height);
  for (let i = 0; i < 80; i++) {
    const x = (i * 127 + 31) % canvas.width;
    const y = (i * 83 + 17) % canvas.height;
    const bright = i % 4 === 0;
    ctx.fillStyle = bright ? '#ffffff' : '#aaaacc';
    ctx.fillRect(x, y, bright ? 2 : 1, bright ? 2 : 1);
  }
}

// ── GAME NODE SYSTEM ───────────────────────────
let currentNodes = [];

function loadCase(caseId) {
  STATE.currentCase = caseId;
  STATE.nodeIndex = 0;
  STATE.casefileEntries = [];
  STATE.toolsUserHidden = false;
  STATE.casefileUserVisible = false;
  STATE.pendingFeedbackNext = null;
  document.getElementById('casefile-entries').innerHTML = '';
  document.getElementById('feedback-panel').style.display = 'none';
  document.getElementById('tools-panel').style.display = 'none';
  document.getElementById('casefile-panel').style.display = 'none';

  const cases = { buffet: CASE_BUFFET, legionnaires: CASE_LEGIONNAIRES, measles: CASE_MEASLES };
  currentNodes = cases[caseId] || [];
  showScreen('game-scene');
  STATE.screen = 'game';
  paintScene(caseId === 'legionnaires' ? 'legionnaires' : caseId === 'measles' ? 'measles' : 'buffet');
  advanceNode();
}

function advanceNode(choiceResult) {
  document.getElementById('choices-panel').style.display = 'none';
  document.getElementById('choices-panel').innerHTML = '';
  document.getElementById('continue-prompt').style.display = 'none';
  document.getElementById('feedback-panel').style.display = 'none';

  if (STATE.nodeIndex >= currentNodes.length) {
    completeCase();
    return;
  }

  const node = currentNodes[STATE.nodeIndex];
  STATE.nodeIndex++;

  // Scene change?
  if (node.scene) paintScene(node.scene);

  // Tools panel?
  if (node.tools) {
    renderTools(node.tools);
    // New data loaded — reset the user-hidden flag and show the panel
    STATE.toolsUserHidden = false;
    document.getElementById('tools-panel').style.display = 'flex';
  } else if (!node.keepTools) {
    // No tools for this node and not keeping old ones — hide the panel
    STATE.toolsUserHidden = false;
    document.getElementById('tools-panel').style.display = 'none';
  } else {
    // keepTools: respect whatever the user last toggled
    document.getElementById('tools-panel').style.display =
      STATE.toolsUserHidden ? 'none' : 'flex';
  }

  // Casefile update?
  if (node.casefile) {
    addCasefile(node.casefile);
    // Only reveal the panel for new entries; don't override user-hidden state
    // (but always show when fresh content arrives)
    STATE.casefileUserVisible = true;
    document.getElementById('casefile-panel').style.display = 'block';
  } else {
    // No new entry — restore whatever the user last set
    document.getElementById('casefile-panel').style.display =
      STATE.casefileUserVisible ? 'block' : 'none';
  }

  // Speaker
  const speakerEl = document.getElementById('speaker-name');
  speakerEl.textContent = node.speaker || '';
  speakerEl.style.color = getSpeakerColor(node.speaker);
  speakerEl.style.textShadow = `0 0 6px ${getSpeakerColor(node.speaker)}`;

  // Text box color
  const tb = document.getElementById('text-box');
  tb.className = 'pixel-box ' + (node.boxStyle || 'pixel-box-green');

  // Dialog text
  if (node.text) {
    typeText(node.text, node.speed || 28, () => {
      if (node.choices) renderChoices(node.choices);
      else if (node.autoAdvance) setTimeout(advanceNode, node.autoAdvance);
    });
  }

  // XP award — award immediately for HUD feedback, but NEVER redirect
  // to rankup screen here. completeCase() owns that decision after all
  // nodes (including the final closing node) have been advanced past.
  if (node.xp) {
    awardXP(node.xp);
    playSFX('xp');
  }
}

function getSpeakerColor(speaker) {
  if (!speaker) return 'var(--text-dim)';
  const s = speaker.toUpperCase();
  if (s.includes('YOU') || s.includes('DETECTIVE') || s.includes('INVESTIGATOR')) return '#39ff14';
  if (s.includes('HEALTH') || s.includes('DIRECTOR') || s.includes('OFFICER')) return '#00e5ff';
  if (s.includes('LAB') || s.includes('SCIENTIST')) return '#ffe600';
  if (s.includes('PARENT') || s.includes('CITIZEN') || s.includes('PATIENT')) return '#ff8c00';
  if (s.includes('MEDIA') || s.includes('REPORTER')) return '#ff44ff';
  if (s.includes('MENTOR') || s.includes('SUPERVISOR')) return '#aaaaff';
  return '#cccccc';
}

function renderChoices(choices) {
  const panel = document.getElementById('choices-panel');
  panel.innerHTML = '';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  document.getElementById('continue-prompt').style.display = 'none';

  choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn pixel-box';
    btn.innerHTML = `<span class="choice-key">[${i+1}]</span> ${c.text}`;
    btn.addEventListener('click', () => selectChoice(choices, i));
    btn.setAttribute('data-idx', i);
    panel.appendChild(btn);
  });
}

function selectChoice(choices, idx) {
  const choice = choices[idx];
  // Only target buttons INSIDE the choices panel, never global .choice-btn elements
  const panel = document.getElementById('choices-panel');
  const buttons = panel.querySelectorAll('.choice-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === idx) {
      b.classList.add(choice.correct ? 'correct' : 'wrong');
    } else if (choice.correct === false && choices[i] && choices[i].correct) {
      b.classList.add('correct');
    }
  });

  const fb = document.getElementById('feedback-panel');
  const fbText = document.getElementById('feedback-text');

  if (choice.correct) {
    playSFX('correct');
    fb.className = 'pixel-box pixel-box-green';
    fbText.innerHTML = `<span style="color:var(--green)">✓ CORRECT!</span><br>${choice.feedback || ''}`;
    if (choice.xp) awardXP(choice.xp);
  } else {
    playSFX('wrong');
    fb.className = 'pixel-box pixel-box-red';
    fbText.innerHTML = `<span style="color:var(--red)">✗ INCORRECT</span><br>${choice.feedback || ''}`;
  }

  fb.style.display = 'block';

  // Casefile
  if (choice.casefile) addCasefile(choice.casefile);

  // Store the continuation so ENTER/SPACE/button can trigger it
  STATE.pendingFeedbackNext = () => {
    STATE.pendingFeedbackNext = null;
    document.getElementById('feedback-panel').style.display = 'none';
    document.getElementById('choices-panel').style.display = 'none';
    if (choice.next) {
      const labelIdx = currentNodes.findIndex(n => n.label === choice.next);
      if (labelIdx !== -1) STATE.nodeIndex = labelIdx;
    }
    advanceNode(choice.correct);
  };

  // Show a "press ENTER to continue" prompt inside the feedback panel
  const old = fb.querySelector('.feedback-continue-prompt');
  if (old) old.remove();
  const cont = document.createElement('div');
  cont.className = 'feedback-continue-prompt';
  cont.style.cssText = 'margin-top:14px; display:flex; align-items:center; gap:12px;';
  cont.innerHTML = `
    <span style="font-family:var(--font-pixel);font-size:7px;color:var(--text-faint);flex:1;">Read the explanation above, then continue when ready.</span>
    <button class="choice-btn" id="feedback-next-btn" style="padding:5px 14px;font-size:7px;border-color:var(--cyan);color:var(--cyan);pointer-events:auto;flex-shrink:0;">
      <span class="choice-key">↩</span> CONTINUE
    </button>
  `;
  fb.appendChild(cont);
  fb.querySelector('#feedback-next-btn').addEventListener('click', () => {
    if (STATE.pendingFeedbackNext) STATE.pendingFeedbackNext();
  });
}

// No auto-countdown — feedback stays visible until player presses ENTER/SPACE or clicks CONTINUE

// ── FIELD REFERENCE DATA ───────────────────────
// 10 agents per outbreak scenario, keyed by caseId
const FIELD_REFERENCE = {
  buffet: {
    title: 'FOODBORNE ILLNESS — QUICK REFERENCE',
    subtitle: 'Common agents in food/waterborne outbreaks',
    agents: [
      {
        name: 'Staphylococcus aureus',
        incubation: '1–6 hrs (usually 2–4)',
        route: 'Ingestion of pre-formed toxin in food (ham, salads, dairy)',
        symptoms: 'Abrupt nausea, vomiting, cramps; fever rare',
        control: 'Temperature control; handwashing; exclude ill food handlers',
        key: 'Heat-stable toxin survives cooking; toxin already present at ingestion'
      },
      {
        name: 'Bacillus cereus (emetic)',
        incubation: '0.5–6 hrs',
        route: 'Ingestion of pre-formed toxin (rice, starchy foods)',
        symptoms: 'Vomiting predominant; short duration',
        control: 'Rapid cooling; do not hold cooked rice at room temp',
        key: 'Emetic toxin heat-stable; diarrheal toxin heat-labile (8–16 hr incubation)'
      },
      {
        name: 'Clostridium perfringens',
        incubation: '6–24 hrs (usually 8–12)',
        route: 'Ingestion; large-batch cooked meats held warm',
        symptoms: 'Diarrhea and cramps; vomiting uncommon; self-limited',
        control: 'Rapid cooling of large meat batches; reheat thoroughly',
        key: 'Spores survive cooking; germinate during slow cooling'
      },
      {
        name: 'Salmonella (non-typhoidal)',
        incubation: '6–72 hrs (usually 12–36)',
        route: 'Undercooked poultry, eggs, dairy; reptile contact',
        symptoms: 'Diarrhea, fever, abdominal cramps; bacteremia in immunocompromised',
        control: 'Cook poultry to 165°F; pasteurize eggs; handwashing',
        key: 'Most common bacterial cause of foodborne illness in the US'
      },
      {
        name: 'Campylobacter jejuni',
        incubation: '2–5 days',
        route: 'Raw/undercooked poultry, raw milk, untreated water',
        symptoms: 'Diarrhea (often bloody), fever, cramps; Guillain-Barré risk',
        control: 'Cook poultry thoroughly; pasteurize milk; chlorinate water',
        key: 'Leading cause of bacterial diarrhea in US; very low infectious dose'
      },
      {
        name: 'Norovirus',
        incubation: '12–48 hrs',
        route: 'Fecal-oral; contaminated food/water; person-to-person',
        symptoms: 'Sudden vomiting, watery diarrhea, nausea, cramps',
        control: 'Exclude ill workers; bleach disinfection; strict handwashing',
        key: 'Most common cause of foodborne illness overall; extremely contagious'
      },
      {
        name: 'E. coli O157:H7 (STEC)',
        incubation: '2–8 days (usually 3–4)',
        route: 'Undercooked ground beef, raw produce, raw milk, person-to-person',
        symptoms: 'Bloody diarrhea; HUS in children (life-threatening)',
        control: 'Cook beef to 160°F; avoid raw milk; notify health dept immediately',
        key: 'Very low infectious dose; antibiotics may worsen HUS risk'
      },
      {
        name: 'Listeria monocytogenes',
        incubation: '3–70 days (median 21 days)',
        route: 'Ready-to-eat deli meats, soft cheeses, smoked fish, raw sprouts',
        symptoms: 'Fever, myalgias; meningitis/sepsis; miscarriage in pregnancy',
        control: 'Refrigerate properly; avoid high-risk foods in pregnancy',
        key: 'Grows at refrigerator temperatures; high case-fatality rate (~20%)'
      },
      {
        name: 'Clostridium botulinum',
        incubation: '12–36 hrs (range 2 hrs–8 days)',
        route: 'Home-canned foods, honey (infants), wound infection',
        symptoms: 'Descending paralysis, double vision, dysphagia; no fever',
        control: 'Proper canning; do not give honey to infants <1 yr; antitoxin',
        key: 'Toxin blocks acetylcholine; pre-formed (food) or produced in vivo'
      },
      {
        name: 'Hepatitis A virus',
        incubation: '15–50 days (mean 28)',
        route: 'Fecal-oral; raw shellfish, produce; food handler transmission',
        symptoms: 'Jaundice, fever, dark urine, anorexia; self-limited',
        control: 'Vaccination; exclude ill food handlers; IG post-exposure',
        key: 'Long incubation; food handler cases can expose hundreds'
      }
    ]
  },
  legionnaires: {
    title: 'RESPIRATORY / ENVIRONMENTAL — QUICK REFERENCE',
    subtitle: 'Agents causing atypical pneumonia or respiratory clusters',
    agents: [
      {
        name: 'Legionella pneumophila',
        incubation: '2–10 days (median 5–6)',
        route: 'Inhalation of contaminated aerosols (cooling towers, hot tubs, showers)',
        symptoms: 'Pneumonia, high fever, confusion, diarrhea; Pontiac fever = milder form',
        control: 'Water system maintenance; hyperchlorination; ASHRAE 188 water management plans',
        key: 'Does NOT spread person-to-person; urine antigen test for rapid Dx'
      },
      {
        name: 'Mycoplasma pneumoniae',
        incubation: '1–4 weeks (mean 2–3)',
        route: 'Respiratory droplets; person-to-person',
        symptoms: 'Gradual onset, dry cough, low fever; "walking pneumonia"',
        control: 'Macrolide or tetracycline treatment; no vaccine available',
        key: 'Community clusters common; serology or PCR for Dx'
      },
      {
        name: 'Influenza A/B',
        incubation: '1–4 days',
        route: 'Respiratory droplets and aerosols; fomites',
        symptoms: 'Abrupt fever, myalgia, headache, cough; complications in elderly/immunocomp',
        control: 'Annual vaccination; antivirals (oseltamivir); droplet precautions',
        key: 'R0 ≈ 2–3; antigenic drift/shift drives annual epidemics and pandemics'
      },
      {
        name: 'SARS-CoV-2',
        incubation: '2–14 days (median 5)',
        route: 'Airborne and respiratory droplets; fomites (less common)',
        symptoms: 'Fever, cough, dyspnea, anosmia; wide severity spectrum; Long COVID',
        control: 'Vaccination; masking; ventilation; antiviral treatment (Paxlovid)',
        key: 'R0 original ≈ 2.5; Omicron ≈ 8–15; airborne transmission key driver'
      },
      {
        name: 'Coxiella burnetii (Q Fever)',
        incubation: '2–3 weeks (range 9–40 days)',
        route: 'Inhalation of aerosols from infected animals (cattle, sheep, goats)',
        symptoms: 'High fever, severe headache, pneumonia, hepatitis; chronic endocarditis',
        control: 'Avoid birthing fluids of infected animals; doxycycline treatment',
        key: 'One of most infectious agents known; single organism can cause disease'
      },
      {
        name: 'Histoplasma capsulatum',
        incubation: '3–17 days',
        route: 'Inhalation of spores from bird/bat droppings; soil disturbance',
        symptoms: 'Pulmonary illness; progressive disseminated disease in immunocomp',
        control: 'Mask/respiratory protection during demolition; antifungal treatment',
        key: 'Construction or demolition outbreaks; endemic in Ohio/Mississippi River valleys'
      },
      {
        name: 'Aspergillus fumigatus',
        incubation: 'Days to weeks',
        route: 'Inhalation of airborne spores from construction, soil, plants',
        symptoms: 'Invasive aspergillosis in immunocomp; pulmonary nodules, hemoptysis',
        control: 'HEPA filtration during construction; antifungal prophylaxis in high-risk',
        key: 'Major opportunistic pathogen; hospital construction outbreaks documented'
      },
      {
        name: 'Pontiac Fever (Legionella)',
        incubation: '5–66 hrs (very short)',
        route: 'Same aerosol sources as Legionnaires but higher attack rate',
        symptoms: 'Influenza-like illness; NO pneumonia; self-resolves in 2–5 days',
        control: 'Same environmental controls as Legionnaires disease',
        key: 'Distinguish from Legionnaires by short incubation and lack of pneumonia'
      },
      {
        name: 'Psittacosis (Chlamydia psittaci)',
        incubation: '5–14 days',
        route: 'Inhalation of dried secretions from infected birds (parrots, pigeons)',
        symptoms: 'Atypical pneumonia, fever, headache; may be severe',
        control: 'Restrict importation of exotic birds; doxycycline treatment',
        key: 'Occupational risk for pet store workers, vets, bird handlers'
      },
      {
        name: 'Hantavirus (Pulmonary Syndrome)',
        incubation: '1–5 weeks',
        route: 'Inhalation of rodent excreta aerosols (Sin Nombre virus in US Southwest)',
        symptoms: 'Prodrome then rapid respiratory failure; high CFR (30–40%)',
        control: 'Rodent control; seal structures; wet-mop rather than sweep rodent areas',
        key: 'No person-to-person spread (US strains); New World Hantavirus'
      }
    ]
  },
  measles: {
    title: 'VACCINE-PREVENTABLE DISEASES — QUICK REFERENCE',
    subtitle: 'VPDs with outbreak potential; key for immunization programs',
    agents: [
      {
        name: 'Measles virus (Rubeola)',
        incubation: '7–18 days (mean 10–12 to rash)',
        route: 'Airborne and respiratory droplets; extremely contagious (R0 12–18)',
        symptoms: 'Prodrome: 3 Cs (cough, coryza, conjunctivitis) + Koplik spots; then rash',
        control: '2-dose MMR (VE ~97%); isolation ×4 days after rash onset; ring vaccination',
        key: 'Immune amnesia: measles destroys 20–70% of B-cell memory for 2–3 years'
      },
      {
        name: 'Pertussis (Bordetella pertussis)',
        incubation: '6–20 days (mean 7–10)',
        route: 'Respiratory droplets; highly contagious (R0 12–17)',
        symptoms: '3 stages: catarrhal → paroxysmal cough + whoop → convalescent',
        control: 'DTaP (children), Tdap (adults/pregnancy); droplet precautions; azithromycin',
        key: 'Vaccine immunity wanes; adults are reservoir for infant disease'
      },
      {
        name: 'Mumps virus',
        incubation: '12–25 days (mean 16–18)',
        route: 'Respiratory droplets and saliva',
        symptoms: 'Parotitis, fever; orchitis in post-pubertal males; aseptic meningitis',
        control: '2-dose MMR (VE ~88%); isolate ×5 days after parotitis onset',
        key: 'Clusters in vaccinated college students due to waning immunity'
      },
      {
        name: 'Rubella virus',
        incubation: '14–21 days',
        route: 'Respiratory droplets',
        symptoms: 'Mild rash illness in children; congenital rubella syndrome (CRS) is severe',
        control: '1-dose MMR ≥97% VE; screen pregnant women; vaccinate postpartum',
        key: 'CRS risk highest in 1st trimester: deafness, cataracts, heart defects'
      },
      {
        name: 'Varicella-Zoster virus',
        incubation: '10–21 days (mean 14–16)',
        route: 'Airborne, respiratory droplets, direct contact with vesicles',
        symptoms: 'Pruritic vesicular rash; fever; complications: bacterial superinfection, pneumonia',
        control: '2-dose varicella vaccine (VE ~98% severe disease); isolate until lesions crust',
        key: 'Reactivates as Herpes Zoster; vaccine prevents both primary and reactivation'
      },
      {
        name: 'Hepatitis B virus',
        incubation: '60–150 days (mean 90)',
        route: 'Blood, sexual contact, perinatal; not casual contact',
        symptoms: 'Jaundice, anorexia, nausea; chronic infection → cirrhosis/HCC',
        control: '3-dose HepB vaccine (VE >90%); universal infant vaccination; HBIG PEP',
        key: '~2 billion infected globally; 257 million with chronic HBV'
      },
      {
        name: 'Haemophilus influenzae type b (Hib)',
        incubation: 'Days to weeks',
        route: 'Respiratory droplets; nasopharyngeal carriage',
        symptoms: 'Meningitis, epiglottitis, pneumonia, septic arthritis in children <5',
        control: 'Hib conjugate vaccine (VE >95%); rifampin prophylaxis for contacts',
        key: 'Near-eliminated in vaccinated populations; resurgences signal coverage gaps'
      },
      {
        name: 'Neisseria meningitidis',
        incubation: '2–10 days (usually 3–4)',
        route: 'Respiratory droplets; close prolonged contact',
        symptoms: 'Sudden fever, stiff neck, petechial/purpuric rash; CFR 10–15% even treated',
        control: 'MenACWY vaccine; ciprofloxacin/rifampin prophylaxis for close contacts',
        key: 'Purpuric rash = medical emergency; prophylax household and intimate contacts'
      },
      {
        name: 'Poliovirus',
        incubation: '3–35 days (paralytic: 7–21)',
        route: 'Fecal-oral; respiratory (minor)',
        symptoms: '>95% asymptomatic; <1% paralytic; post-polio syndrome decades later',
        control: 'IPV (inactivated) or OPV; 4-dose series; surveillance for acute flaccid paralysis',
        key: 'Near-eradicated globally; vaccine-derived poliovirus (VDPV) a concern with OPV'
      },
      {
        name: 'SARS-CoV-2 (COVID-19)',
        incubation: '2–14 days (median 5)',
        route: 'Airborne; respiratory droplets; fomites (less common)',
        symptoms: 'Fever, cough, dyspnea, anosmia; severe: ARDS; Long COVID',
        control: 'mRNA vaccines (VE varies by variant); antivirals; masking; ventilation',
        key: 'Demonstrates how vaccine hesitancy drives variant emergence and excess deaths'
      }
    ]
  }
};

function renderFieldReference(caseId) {
  const ref = FIELD_REFERENCE[caseId];
  const container = document.getElementById('fieldref-content');
  if (!ref) {
    container.innerHTML = '<div style="font-family:var(--font-mono);font-size:12px;color:var(--text-faint);padding:8px;">No field reference available for this case.</div>';
    return;
  }

  container.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-family:var(--font-pixel);font-size:7px;color:#bb99ff;margin-bottom:4px;';
  hdr.textContent = ref.title;
  container.appendChild(hdr);

  const sub = document.createElement('div');
  sub.style.cssText = 'font-family:var(--font-mono);font-size:11px;color:var(--text-faint);margin-bottom:10px;';
  sub.textContent = ref.subtitle;
  container.appendChild(sub);

  // Agent table
  ref.agents.forEach((agent, idx) => {
    const card = document.createElement('div');
    card.style.cssText = `
      background:${idx%2===0 ? 'var(--surface)' : 'var(--surface2)'};
      border:1px solid #443366;
      margin-bottom:4px;
      cursor:pointer;
      overflow:hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;';
    header.innerHTML = `
      <span style="font-family:var(--font-pixel);font-size:7px;color:#ffcc44;min-width:16px;">${idx+1}.</span>
      <span style="font-family:var(--font-pixel);font-size:7px;color:#bb99ff;flex:1;">${agent.name}</span>
      <span style="font-family:var(--font-pixel);font-size:6px;color:var(--text-faint);">▼ expand</span>
    `;

    const body = document.createElement('div');
    body.style.cssText = 'display:none;padding:6px 10px 10px;border-top:1px solid #332255;';
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:100px 1fr;gap:4px 10px;font-family:var(--font-mono);font-size:11px;line-height:1.5;">
        <span style="color:var(--text-faint);">Incubation</span><span style="color:var(--text);">${agent.incubation}</span>
        <span style="color:var(--text-faint);">Route</span><span style="color:var(--text);">${agent.route}</span>
        <span style="color:var(--text-faint);">Symptoms</span><span style="color:var(--text);">${agent.symptoms}</span>
        <span style="color:var(--text-faint);">Control</span><span style="color:var(--green);">${agent.control}</span>
        <span style="color:var(--text-faint);">Key fact</span><span style="color:var(--yellow);">${agent.key}</span>
      </div>
    `;

    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      header.querySelector('span:last-child').textContent = isOpen ? '▼ expand' : '▲ collapse';
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  });
}

// Continue on ENTER/SPACE
function handleContinue() {
  if (STATE.typing) { skipTyping(); return; }
  // If feedback is showing and we're waiting for player to continue
  if (STATE.pendingFeedbackNext) {
    STATE.pendingFeedbackNext();
    return;
  }
  const choicesVisible = document.getElementById('choices-panel').style.display !== 'none';
  if (choicesVisible) return;
  const continueVisible = document.getElementById('continue-prompt').style.display !== 'none';
  if (continueVisible) advanceNode();
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const key = e.key;

  if (STATE.screen === 'title' && (key === 'Enter' || key === ' ')) {
    startGame();
    return;
  }

  if (STATE.screen === 'game') {
    if (key === 'Enter' || key === ' ') {
      handleContinue();
      return;
    }
    // Number keys for choices
    if (['1','2','3','4'].includes(key)) {
      const idx = parseInt(key) - 1;
      const btns = document.querySelectorAll('.choice-btn:not([disabled])');
      if (btns[idx]) btns[idx].click();
      return;
    }
    // Notebook toggle
    if (key === 'n' || key === 'N') {
      const cf = document.getElementById('casefile-panel');
      const nowHidden = cf.style.display !== 'none';
      STATE.casefileUserVisible = !nowHidden;
      cf.style.display = nowHidden ? 'none' : 'block';
      return;
    }
    // Field Reference toggle
    if (key === 'r' || key === 'R') {
      const fp = document.getElementById('fieldref-panel');
      const isHidden = fp.style.display === 'none';
      if (isHidden) {
        renderFieldReference(STATE.currentCase);
        fp.style.display = 'block';
      } else {
        fp.style.display = 'none';
      }
      return;
    }
    // Data panel toggle
    if (key === 'd' || key === 'D') {
      const tp = document.getElementById('tools-panel');
      const toolsContent = document.getElementById('tools-content');
      // Only toggle if there is data loaded
      if (toolsContent && toolsContent.children.length > 0) {
        const nowHidden = tp.style.display !== 'none';
        STATE.toolsUserHidden = nowHidden;
        tp.style.display = nowHidden ? 'none' : 'flex';
      }
      return;
    }
  }

  // Rankup screen: Enter advances to case select
  if (STATE.screen === 'rankup' && (key === 'Enter' || key === ' ')) {
    playSFX('click');
    showOutbreakSelect();
    return;
  }

  // Victory screen: Enter restarts
  if (STATE.screen === 'victory' && (key === 'Enter' || key === ' ')) {
    resetGame();
    return;
  }

  if (key === 'm' || key === 'M') toggleMute();
});

// Click title screen
document.getElementById('title-screen').addEventListener('click', () => {
  if (STATE.screen === 'title') startGame();
});

function startGame() {
  playSFX('click');
  startBGMusic();
  showOutbreakSelect();
}

function startCase(caseId) {
  playSFX('click');
  loadCase(caseId);
}

function completeCase() {
  if (!STATE.casesCompleted.includes(STATE.currentCase)) {
    STATE.casesCompleted.push(STATE.currentCase);
  }

  const xpMap = { buffet: 150, legionnaires: 250, measles: 400 };
  const bonus = xpMap[STATE.currentCase] || 100;
  const ranked = awardXP(bonus);

  playSFX('fanfare');

  if (STATE.casesCompleted.length >= 3) {
    showVictory();
  } else if (ranked) {
    showRankUp();
  } else {
    showOutbreakSelect();
  }
}

function showRankUp() {
  const rank = RANKS[STATE.rank];
  document.getElementById('rankup-title').textContent = rank.name;
  document.getElementById('rankup-title').style.color = rank.color;
  document.getElementById('rankup-title').style.textShadow = `0 0 16px ${rank.color}`;
  document.getElementById('rankup-rank').textContent = `You've been promoted to: ${rank.name}`;
  document.getElementById('rankup-rank').style.color = rank.color;

  const msgs = {
    1: 'You\'ve proven you can handle a foodborne outbreak. Your systematic approach and knowledge of attack rates impressed the team. Ready for more complex investigations.',
    2: 'Environmental epidemiology is no easy task. Your ability to identify Legionella in a complex urban setting shows real detective skill.',
    3: 'Navigating vaccine hesitancy while investigating a measles outbreak takes both scientific rigor and communication skills. You\'re on your way to the top.',
    4: 'All three cases solved. The Director herself has taken notice. Welcome to the elite tier of disease detectives.',
  };
  document.getElementById('rankup-msg').textContent = msgs[STATE.rank] || 'Outstanding work, Detective.';

  playSFX('rankup');
  showScreen('rankup-screen');
  STATE.screen = 'rankup';
}

function showVictory() {
  showScreen('victory-screen');
  STATE.screen = 'victory';
  document.getElementById('victory-text').innerHTML = `
You have successfully investigated all three outbreaks, mastering the core tools of field epidemiology:
<br><br>
🍽 Foodborne outbreak → Attack rates, 2×2 tables, food-specific relative risks<br>
🏨 Legionnaires' disease → Epi curves, incubation periods, environmental source tracing<br>
💉 Measles/vaccine hesitancy → R₀, herd immunity, risk communication, vaccine safety data
<br><br>
These are the tools real epidemiologists use every day to protect the public's health.
  `;
  document.getElementById('final-score').textContent = `FINAL SCORE: ${STATE.score} XP | RANK: ${RANKS[STATE.rank].name}`;
  playSFX('fanfare');
  STATE.screen = 'victory';
}

function resetGame() {
  STATE.screen = 'title';
  STATE.currentCase = null;
  STATE.nodeIndex = 0;
  STATE.score = 0;
  STATE.xp = 0;
  STATE.rank = 0;
  STATE.casesCompleted = [];
  STATE.casefileEntries = [];
  updateHUD();
  ['case-legionnaires','case-measles'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('locked');
      el.classList.remove('unlocked','completed');
    }
  });
  document.getElementById('case-legionnaires-status').textContent = '🔒 LOCKED';
  document.getElementById('case-legionnaires-status').style.color = 'var(--text-faint)';
  document.getElementById('case-measles-status').textContent = '🔒 LOCKED';
  document.getElementById('case-measles-status').style.color = 'var(--text-faint)';

  showScreen('title-screen');
  drawStars();
}

// ── TOOLS RENDERER ─────────────────────────────
function renderTools(toolsData) {
  const container = document.getElementById('tools-content');
  container.innerHTML = '';

  if (toolsData.type === 'epicurve') {
    renderEpiCurve(container, toolsData);
  } else if (toolsData.type === 'twobytwo') {
    renderTwoByTwo(container, toolsData);
  } else if (toolsData.type === 'table') {
    renderDataTable(container, toolsData);
  } else if (toolsData.type === 'text') {
    const div = document.createElement('div');
    div.style.fontFamily = 'var(--font-mono)';
    div.style.fontSize = '13px';
    div.style.lineHeight = '1.7';
    div.style.color = 'var(--text-dim)';
    div.innerHTML = toolsData.content;
    container.appendChild(div);
  }
}

function renderEpiCurve(container, data) {
  const title = document.createElement('div');
  title.style.fontFamily = 'var(--font-pixel)';
  title.style.fontSize = '7px';
  title.style.color = 'var(--yellow)';
  title.style.textAlign = 'center';
  title.style.marginBottom = '8px';
  title.textContent = data.title || 'EPIDEMIC CURVE';
  container.appendChild(title);

  const canvas = document.createElement('canvas');
  canvas.width = 680;
  canvas.height = 120;
  canvas.style.maxWidth = '100%';
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  canvas.style.imageRendering = 'pixelated';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const bars = data.bars;
  const maxVal = Math.max(...bars.map(b => b.count));
  const barW = Math.floor((canvas.width - 80) / bars.length) - 4;
  const chartH = 90;
  const offsetX = 50;
  const offsetY = 10;

  // Axes
  ctx.strokeStyle = '#4488ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(offsetX, offsetY);
  ctx.lineTo(offsetX, offsetY + chartH);
  ctx.lineTo(offsetX + (barW + 4) * bars.length + 20, offsetY + chartH);
  ctx.stroke();

  // Y labels
  ctx.fillStyle = '#8888cc';
  ctx.font = '10px Share Tech Mono, monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = Math.round((maxVal * i) / 4);
    const yPos = offsetY + chartH - (chartH * i) / 4;
    ctx.fillText(val, offsetX - 4, yPos + 4);
    ctx.strokeStyle = '#222244';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(offsetX, yPos);
    ctx.lineTo(offsetX + (barW + 4) * bars.length + 20, yPos);
    ctx.stroke();
  }

  // Bars
  bars.forEach((b, i) => {
    const bh = Math.round((b.count / maxVal) * chartH);
    const bx = offsetX + 4 + i * (barW + 4);
    const by = offsetY + chartH - bh;

    // Bar color: cases vs. normal
    const color = b.color || (b.type === 'peak' ? '#ff2244' : b.type === 'early' ? '#ff8800' : '#4488ff');
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, barW, bh);

    // Label
    ctx.fillStyle = '#8888cc';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(bx + barW/2, offsetY + chartH + 14);
    ctx.rotate(-0.6);
    ctx.fillText(b.label, 0, 0);
    ctx.restore();
  });

  // Legend
  if (data.legend) {
    const leg = document.createElement('div');
    leg.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:6px;font-family:Share Tech Mono,monospace;font-size:11px;';
    data.legend.forEach(l => {
      leg.innerHTML += `<span style="color:${l.color}">■ ${l.label}</span>`;
    });
    container.appendChild(leg);
  }

  // Analysis note
  if (data.note) {
    const note = document.createElement('div');
    note.style.cssText = 'font-family:Share Tech Mono,monospace;font-size:12px;color:var(--cyan);text-align:center;margin-top:8px;padding:6px;border:1px solid var(--cyan);background:rgba(0,229,255,0.05);';
    note.textContent = '▸ ' + data.note;
    container.appendChild(note);
  }
}

function renderTwoByTwo(container, data) {
  const title = document.createElement('div');
  title.style.cssText = 'font-family:var(--font-pixel);font-size:7px;color:var(--yellow);text-align:center;margin-bottom:8px;';
  title.textContent = data.title || '2×2 CONTINGENCY TABLE';
  container.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'two-by-two';
  grid.style.cssText = 'display:grid;grid-template-columns:130px 1fr 1fr 1fr;gap:2px;font-family:Share Tech Mono,monospace;font-size:12px;background:var(--bg);padding:2px;max-width:520px;margin:0 auto;';

  const headers = ['', data.exposed_label || 'EXPOSED', data.unexposed_label || 'UNEXPOSED', 'TOTAL'];
  const rows = [
    [data.case_label || 'CASES', data.a, data.b, data.a + data.b],
    [data.control_label || 'NON-CASES', data.c, data.d, data.c + data.d],
    ['TOTAL', data.a + data.c, data.b + data.d, data.a + data.b + data.c + data.d],
  ];

  const allCells = [headers, ...rows];
  allCells.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const div = document.createElement('div');
      div.style.cssText = `background:${ri===0||ci===0?'var(--surface)':'var(--surface2)'};padding:6px 8px;text-align:center;border:1px solid var(--border);color:${ri===0||ci===0?'var(--cyan)':'var(--text)'};font-family:${ri===0||ci===0?'var(--font-pixel)':'Share Tech Mono,monospace'};font-size:${ri===0||ci===0?'7px':'13px'};`;
      if (ri===1&&ci===1) div.style.background = 'rgba(57,255,20,0.1)';
      if (ri===1&&ci===2) div.style.background = 'rgba(255,34,68,0.1)';
      div.textContent = cell;
      grid.appendChild(div);
    });
  });
  container.appendChild(grid);

  // Calculated stats
  if (data.showStats) {
    const rr = ((data.a / (data.a + data.b)) / (data.c / (data.c + data.d))).toFixed(2);
    const or = ((data.a * data.d) / (data.b * data.c)).toFixed(2);
    const arE = ((data.a / (data.a + data.b)) * 100).toFixed(1);
    const arU = ((data.c / (data.c + data.d)) * 100).toFixed(1);

    const stats = document.createElement('div');
    stats.style.cssText = 'font-family:Share Tech Mono,monospace;font-size:12px;margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;max-width:520px;margin:10px auto 0;';
    stats.innerHTML = `
      <div style="padding:6px;background:var(--surface2);border:1px solid var(--border);">Attack Rate (Exposed): <span style="color:var(--yellow)">${arE}%</span></div>
      <div style="padding:6px;background:var(--surface2);border:1px solid var(--border);">Attack Rate (Unexposed): <span style="color:var(--yellow)">${arU}%</span></div>
      <div style="padding:6px;background:var(--surface2);border:1px solid var(--border);">Risk Ratio (RR): <span style="color:var(--cyan)">${rr}</span></div>
      <div style="padding:6px;background:var(--surface2);border:1px solid var(--border);">Odds Ratio (OR): <span style="color:var(--cyan)">${or}</span></div>
    `;
    container.appendChild(stats);
  }
}

function renderDataTable(container, data) {
  const title = document.createElement('div');
  title.style.cssText = 'font-family:var(--font-pixel);font-size:7px;color:var(--yellow);text-align:center;margin-bottom:8px;';
  title.textContent = data.title || 'DATA TABLE';
  container.appendChild(title);

  const table = document.createElement('table');
  table.style.cssText = 'border-collapse:collapse;width:100%;font-family:Share Tech Mono,monospace;font-size:12px;';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  data.headers.forEach(h => {
    const th = document.createElement('th');
    th.style.cssText = 'padding:6px 10px;border:1px solid var(--border);background:var(--surface);color:var(--cyan);font-family:var(--font-pixel);font-size:7px;text-align:left;';
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  data.rows.forEach((row, ri) => {
    const tr = document.createElement('tr');
    row.forEach((cell, ci) => {
      const td = document.createElement('td');
      td.style.cssText = `padding:5px 10px;border:1px solid var(--border);background:${ri%2===0?'var(--surface2)':'var(--surface)'};color:${cell.highlight?'var(--yellow)':'var(--text-dim)'};`;
      td.textContent = typeof cell === 'object' ? cell.value : cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

/* ============================================================
   ██████╗ █████╗ ███████╗███████╗    ██████╗
  ██╔════╝██╔══██╗██╔════╝██╔════╝   ██╔══██╗
  ██║     ███████║███████╗█████╗     ██████╔╝
  ██║     ██╔══██║╚════██║██╔══╝     ╚════██╗
  ╚██████╗██║  ██║███████║███████╗   ██████╔╝
   ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝  ╚═════╝
  CASE 1: THE BANQUET INCIDENT (Easy — Foodborne)
   ============================================================ */

const CASE_BUFFET = [
  {
    speaker: 'DISPATCH — PUBLIC HEALTH DEPT.',
    boxStyle: 'pixel-box-cyan',
    text: `ALERT: Multiple illness reports following the Riverside Corp buffet lunch (12:00 PM). 34 attendees. First cases reported at 6:00 PM. Symptoms: nausea, vomiting, diarrhea, abdominal cramps.\n\nYou are the on-call Disease Investigator. Respond immediately.`,
    scene: 'buffet',
    casefile: 'Received report: 34 attendees, onset 6 hrs post-meal, GI symptoms',
  },
  {
    speaker: 'YOU — ROOKIE INVESTIGATOR',
    text: `This looks like a foodborne outbreak. My first instinct is to define the case and collect data. I need to know: What did people eat? Who got sick? What's the timing?\n\nTime to set up an outbreak investigation.`,
    casefile: 'Investigation initiated. Analyzing exposure data.',
  },
  {
    speaker: 'HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    text: `Good. Before you head out, review your basic epidemiology. The investigation follows the standard steps:\n\n1. Verify the diagnosis\n2. Establish the existence of an outbreak\n3. Define and identify cases\n4. Describe data (person, place, time)\n5. Develop hypotheses\n6. Evaluate hypotheses\n7. Implement control measures`,
    casefile: '10-step outbreak investigation framework noted.',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Quick question before you go — what type of epidemic pattern are you likely dealing with here, given that 34 people ate the same lunch and all got sick around the same time?`,
    choices: [
      {
        text: 'Propagated (person-to-person) outbreak — cases spreading over time',
        correct: false,
        feedback: 'Not quite. A propagated outbreak shows a slow, sustained increase over multiple generations. This is different — all exposures happened at one event at one time.',
        casefile: 'Q1 INCORRECT: Not a propagated outbreak.',
      },
      {
        text: 'Point-source outbreak — single exposure event, cases cluster in time',
        correct: true,
        xp: 20,
        feedback: 'Exactly right! A point-source outbreak occurs when all cases are exposed to the same source at approximately the same time. The epidemic curve will show a sharp peak followed by rapid decline. Classic foodborne pattern.',
        casefile: 'Q1 ✓ Point-source outbreak confirmed. Single shared meal = single exposure event.',
      },
      {
        text: 'Endemic — the disease is always present in this population',
        correct: false,
        feedback: 'Endemic refers to a baseline level of disease in a population over time. This is an acute cluster, not endemic disease.',
      },
      {
        text: 'Pandemic — widespread global transmission',
        correct: false,
        feedback: 'A pandemic involves worldwide spread. This is a localized cluster at a single event.',
      },
    ],
  },
  {
    speaker: 'FIELD TEAM',
    text: `We've collected food history from all 34 attendees. Here's what people ate at the buffet. Look at the data carefully...`,
    tools: {
      type: 'table',
      title: 'FOOD-SPECIFIC ATTACK RATES',
      headers: ['Food Item', 'Ill / Ate', 'Attack Rate (Ate)', 'Ill / Didn\'t Eat', 'Attack Rate (Not)', 'Risk Ratio'],
      rows: [
        ['Chicken Salad', '22/24', {value:'91.7%', highlight:true}, '2/10', '20.0%', {value:'4.58', highlight:true}],
        ['Caesar Salad',  '14/18', '77.8%', '10/16', '62.5%', '1.24'],
        ['Dinner Roll',   '18/28', '64.3%', '6/6',   '100%',  '0.64'],
        ['Shrimp Cocktail','16/20','80.0%', '8/14',  '57.1%', '1.40'],
        ['Chocolate Cake', '12/18','66.7%', '12/16', '75.0%', '0.89'],
      ],
    },
    casefile: 'Food-specific attack rates calculated. Chicken salad: AR=91.7%, RR=4.58',
  },
  {
    speaker: 'YOU — ROOKIE INVESTIGATOR',
    text: `I need to identify the food vehicle. Looking at this data... one item stands out. Which food item is the most likely source of this outbreak?`,
    keepTools: true,
    choices: [
      {
        text: 'Caesar Salad — high attack rate of 77.8%',
        correct: false,
        feedback: 'The Caesar salad has a high absolute attack rate, but look at those who DIDN\'T eat it — 62.5% also got sick. The Risk Ratio is only 1.24, suggesting the salad is not the driver.',
      },
      {
        text: 'Chicken Salad — AR of 91.7%, Risk Ratio of 4.58, and only 20% of non-eaters got sick',
        correct: true,
        xp: 30,
        feedback: 'Perfect analysis! The chicken salad has: (1) the highest attack rate among eaters (91.7%), (2) the highest risk ratio (4.58), and critically (3) a very LOW attack rate among non-eaters (20%). Eating chicken salad makes you 4.6× more likely to get sick. This is our vehicle.',
        casefile: 'Q2 ✓ VEHICLE IDENTIFIED: Chicken salad (RR=4.58). Collecting samples for lab.',
      },
      {
        text: 'Shrimp Cocktail — 80% attack rate among eaters',
        correct: false,
        feedback: 'High absolute attack rate, but 57.1% of non-eaters also got sick. The RR is only 1.40. Compare this to the chicken salad where non-eaters had only 20% attack rate.',
      },
      {
        text: 'Dinner Roll — most people ate it',
        correct: false,
        feedback: 'The dinner roll actually has a protective-looking pattern — those who ate it had a LOWER attack rate than non-eaters. RR < 1. Not the culprit.',
      },
    ],
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    text: `Lab results in! We cultured the chicken salad sample. Positive for Staphylococcus aureus. Toxin-producing strain confirmed.\n\nS. aureus produces a heat-stable enterotoxin. Onset typically 1-6 hours after consumption. This fits perfectly.`,
    scene: 'lab',
    casefile: 'LAB: S. aureus toxin confirmed in chicken salad. Heat-stable enterotoxin.',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Good. Now, the kitchen manager says the chicken salad was made fresh that morning but sat at room temperature for 3 hours before service. This question will test your knowledge of the incubation period...`,
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `The lunch was served at 12:00 PM. The first cases called the health department at 6:00 PM. The median onset time is 5 hours after eating.\n\nFor Staphylococcal food poisoning, what is the typical incubation period?`,
    choices: [
      {
        text: '30 minutes to 8 hours (usually 2-4 hours)',
        correct: true,
        xp: 20,
        feedback: 'Correct! S. aureus enterotoxin causes rapid-onset illness, typically 1-6 hours (range 30 min to 8 hrs). The 5-hour onset here is consistent. This is a PRE-FORMED toxin illness — the bacteria already made the toxin in the food before it was eaten.',
        casefile: 'Q3 ✓ S. aureus incubation: 1-6 hrs confirmed. Pre-formed toxin mechanism.',
      },
      {
        text: '12 to 36 hours',
        correct: false,
        feedback: 'That\'s more typical of Salmonella or Norovirus. S. aureus toxin causes much faster onset because the toxin is ALREADY in the food when consumed — no need for the bacteria to colonize and grow.',
      },
      {
        text: '3 to 7 days',
        correct: false,
        feedback: 'That long an incubation would suggest an invasive pathogen like Listeria or Hepatitis A. S. aureus causes rapid illness within hours due to its pre-formed heat-stable toxin.',
      },
      {
        text: '2 to 3 weeks',
        correct: false,
        feedback: 'That incubation period suggests something like Hepatitis A, Typhoid, or Listeria. S. aureus is among the fastest-onset foodborne pathogens.',
      },
    ],
  },
  {
    speaker: 'HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    text: `Now construct the 2×2 table for the chicken salad exposure. This is the core analytic tool in cohort-style outbreak investigations.`,
    tools: {
      type: 'twobytwo',
      title: '2×2 TABLE — CHICKEN SALAD vs. ILLNESS',
      exposed_label: 'ATE CHICKEN SALAD',
      unexposed_label: 'DID NOT EAT',
      case_label: 'ILL',
      control_label: 'NOT ILL',
      a: 22, b: 2, c: 2, d: 8,
      showStats: true,
    },
    casefile: '2×2 table complete: RR=4.59, OR=44.0. Strong association confirmed.',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Look at that 2×2 table. The Odds Ratio is 44.0 and the Risk Ratio is 4.59. Since this is a cohort study design (you know the total population at risk), which measure is more appropriate to report?`,
    keepTools: true,
    choices: [
      {
        text: 'Odds Ratio (OR) — it\'s always the best measure in epidemiology',
        correct: false,
        feedback: 'The OR is excellent for case-control studies, but when you have a defined cohort where you can calculate true proportions of people who got sick, the Risk Ratio (or Attack Rate Ratio) is the preferred measure.',
      },
      {
        text: 'Risk Ratio (Relative Risk) — appropriate because we have a defined cohort with known denominators',
        correct: true,
        xp: 25,
        feedback: 'Excellent! In a cohort study (or outbreak investigation with a defined at-risk population), you can directly calculate incidence in exposed vs. unexposed. The RR is the direct measure of effect. The OR approximates RR when the outcome is rare, but here we can calculate it directly.',
        casefile: 'Q4 ✓ RR = preferred measure in cohort/outbreak design with known denominators.',
      },
      {
        text: 'Neither — we need a p-value to determine if this is significant',
        correct: false,
        feedback: 'P-values complement effect measures but don\'t replace them. With an RR of 4.59 and 34 subjects, this association is both statistically significant and epidemiologically meaningful. Always report both point estimates and p-values/confidence intervals.',
      },
      {
        text: 'Attributable Risk — the difference in attack rates between exposed and unexposed',
        correct: false,
        feedback: 'Attributable Risk (AR = 91.7% - 20.0% = 71.7%) is informative, but the question asks which relative measure is more appropriate given the study design. In cohort studies, Risk Ratio is the standard relative measure.',
      },
    ],
  },
  {
    speaker: 'HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    text: `Outstanding work, Detective. Here's the full epi curve of the outbreak timeline. Note the classic point-source pattern.`,
    tools: {
      type: 'epicurve',
      title: 'EPIDEMIC CURVE — BANQUET OUTBREAK',
      bars: [
        {label:'12-1pm', count:0, type:'early'},
        {label:'1-2pm',  count:0, type:'early'},
        {label:'2-3pm',  count:0, type:'early'},
        {label:'3-4pm',  count:1, type:'early', color:'#ff8800'},
        {label:'4-5pm',  count:3, type:'early', color:'#ff8800'},
        {label:'5-6pm',  count:8, type:'peak',  color:'#ff2244'},
        {label:'6-7pm',  count:12,type:'peak',  color:'#ff2244'},
        {label:'7-8pm',  count:7, type:'peak',  color:'#ff4466'},
        {label:'8-9pm',  count:3, type:'late',  color:'#ff6688'},
        {label:'9-10pm', count:0, type:'late'},
      ],
      legend: [{color:'#ff2244',label:'Peak cases'},{color:'#ff8800',label:'Early onset'},{color:'#4488ff',label:'No cases'}],
    },
    casefile: 'Epi curve received. Analyze the shape and peak timing.',
  },
  {
    speaker: 'YOU — ROOKIE INVESTIGATOR',
    text: `Study the epi curve carefully. All cases ate the same meal at noon.\n\nWhat's the mode and median incubation period based on this curve?`,
    keepTools: true,
    choices: [
      {
        text: 'Mode: 6-7 hours (peak bar) | Median: approximately 6 hours',
        correct: true,
        xp: 20,
        feedback: 'Correct! The mode is the most common value — the tallest bar in the epi curve, which is the 6-7 PM bar (12 cases), representing 6-7 hours post-exposure. The median can be estimated by finding the midpoint of all cases. This is how you read an epi curve to characterize the outbreak.',
        casefile: 'Q5 ✓ Mode incubation: 6-7 hrs. Median ~6 hrs. Consistent with S. aureus.',
      },
      {
        text: 'Mode: 5-6 hours | Median: approximately 4 hours',
        correct: false,
        feedback: 'Close, but the mode is the peak of the curve. Count the cases: 5-6pm has 8, 6-7pm has 12. The 6-7pm bar is the mode. The median requires finding the value that splits all cases 50/50, which falls around 6 hours.',
      },
      {
        text: 'We cannot determine this from an epi curve',
        correct: false,
        feedback: 'Actually, the epi curve is specifically designed for this purpose. The mode is the tallest bar. The median requires calculating cumulative cases. This is one of the primary uses of epidemic curves in outbreak investigation.',
      },
      {
        text: 'The epi curve shows cases by person, not time, so incubation cannot be determined',
        correct: false,
        feedback: 'An epidemic curve plots cases on the Y-axis against TIME on the X-axis. Time is what makes epi curves so powerful for determining incubation periods and outbreak type.',
      },
    ],
  },
  {
    speaker: 'HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    scene: 'press',
    text: `Case closed! Your findings:\n\n• VEHICLE: Chicken salad (S. aureus)\n• SOURCE: Improper temperature control (3 hrs at room temp)\n• ATTACK RATE: 70.6% overall (24/34 attendees)\n• CONTROL: Catering company notified, food handling retrained\n\nYou've solved your first outbreak. Well done, Detective!`,
    xp: 150,
    casefile: 'CASE CLOSED: Chicken salad (S. aureus). Attack rate 70.6%. Control measures implemented.',
  },
];

/* ============================================================
   CASE 2: CITY CENTER CLUSTER — LEGIONNAIRES' DISEASE
   ============================================================ */

const CASE_LEGIONNAIRES = [
  {
    speaker: 'DISPATCH — SURVEILLANCE UNIT',
    boxStyle: 'pixel-box-cyan',
    scene: 'legionnaires',
    text: `ALERT: Cluster of severe pneumonia cases identified in the downtown district. 7 cases in the past 3 weeks, all requiring hospitalization. Age range: 45-78. Legionella pneumophila suspected.\n\nThis is not your average food poisoning. Legionnaires' disease requires environmental investigation. You're up, Detective.`,
    casefile: 'CASE 2 OPEN: Legionnaires\' disease cluster, downtown district, 7 cases, 3 weeks.',
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    text: `Before we dive in — Legionnaires' disease has a long incubation period compared to foodborne illness. This changes how we construct the epidemic curve and trace the source.\n\nWhat is the incubation period for Legionella pneumophila?`,
    choices: [
      {
        text: '1-6 hours (like S. aureus toxin)',
        correct: false,
        feedback: 'That\'s the S. aureus toxin range. Legionella requires bacterial replication in the lung — it takes much longer to cause disease.',
      },
      {
        text: '2-10 days (usually 5-6 days)',
        correct: true,
        xp: 25,
        feedback: 'Correct! Legionella has an incubation period of 2-10 days, with a median of 5-6 days. This is critical for exposure tracing — when a patient presents with pneumonia, you need to look back up to 10 days to identify potential exposures.',
        casefile: 'Q1 ✓ Legionella incubation: 2-10 days (median 5-6). Must trace 10 days back.',
      },
      {
        text: '2-3 weeks',
        correct: false,
        feedback: 'Too long. A 2-3 week incubation would suggest something like Hepatitis A or measles. Legionella causes illness within 2-10 days of exposure.',
      },
      {
        text: '12-24 hours',
        correct: false,
        feedback: 'That\'s more in the range of Norovirus or some bacterial toxin-mediated illnesses. Legionella needs several days to cause pneumonia.',
      },
    ],
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'lab',
    text: `Urinary antigen tests — our rapid diagnostic — came back POSITIVE for Legionella pneumophila serogroup 1 in 6 of 7 cases. The 7th has sputum cultures pending.\n\nDiagnosis confirmed. Now we need to find the environmental source.`,
    casefile: 'LAB: 6/7 positive Legionella urinary antigen. Serogroup 1 confirmed.',
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    text: `Legionella lives and grows in warm, stagnant water. It becomes a hazard when aerosolized. Which environments are the most important to investigate?`,
    choices: [
      {
        text: 'Restaurant kitchens and food preparation surfaces',
        correct: false,
        feedback: 'While Legionella can theoretically be present in any water, kitchens aren\'t the primary concern. Think about large water systems that create fine aerosols breathed by many people.',
      },
      {
        text: 'Cooling towers, hot tubs, decorative fountains, and large building water systems',
        correct: true,
        xp: 25,
        feedback: 'Exactly right! Cooling towers (air conditioners), hot tubs, decorative fountains, and large potable water systems (hospitals, hotels) are the classic sources. Cooling towers in particular can spread Legionella over large geographic areas via aerosolized droplets.',
        casefile: 'Q2 ✓ Priority environments: cooling towers, hot tubs, large HVAC water systems.',
      },
      {
        text: 'Swimming pools — all 7 patients likely swam together',
        correct: false,
        feedback: 'Properly chlorinated swimming pools rarely cause Legionellosis. The chlorine kills Legionella. Hot tubs are higher risk because of warmer temperatures and jet aeration, but they also require proper disinfection.',
      },
      {
        text: 'Tap water only — all drinking water carries equal risk',
        correct: false,
        feedback: 'Tap water can harbor Legionella but isn\'t the usual driver of large outbreaks. The risk is highest in water that is warm, stagnant, and has complex piping — the conditions that allow the organism to amplify to dangerous levels.',
      },
    ],
  },
  {
    speaker: 'FIELD EPIDEMIOLOGIST',
    text: `We interviewed all 7 cases. We constructed an epidemic curve. Look at the onset dates and the building proximity data.`,
    scene: 'legionnaires',
    tools: {
      type: 'epicurve',
      title: 'EPIDEMIC CURVE — LEGIONNAIRES\' CLUSTER (onset dates)',
      bars: [
        {label:'Week 1\nDay 1', count:0},
        {label:'Day 2',  count:0},
        {label:'Day 3',  count:1, type:'early', color:'#ff8800'},
        {label:'Day 4',  count:0},
        {label:'Day 5',  count:2, type:'peak',  color:'#ff2244'},
        {label:'Day 6',  count:1, type:'peak',  color:'#ff4466'},
        {label:'Day 7',  count:0},
        {label:'Week 2\nDay 8', count:1, type:'early', color:'#ff8800'},
        {label:'Day 9',  count:0},
        {label:'Day 10', count:0},
        {label:'Day 11', count:1, type:'early', color:'#ff8800'},
        {label:'Day 12', count:0},
        {label:'Week 3\nDay 13',count:0},
        {label:'Day 14', count:1, type:'late',  color:'#ff6688'},
      ],
      legend: [{color:'#ff2244',label:'Peak cases'},{color:'#ff8800',label:'Secondary cases'},{color:'#4488ff',label:'No cases'}],
    },
    casefile: 'Epi curve received. Cases span 3 weeks — analyze the pattern.',
  },
  {
    speaker: 'YOU — FIELD EPIDEMIOLOGIST',
    text: `This epi curve looks very different from the banquet outbreak. Cases are spread over three weeks with no sharp single peak.\n\nWhat does this epidemic curve pattern suggest about the source?`,
    keepTools: true,
    choices: [
      {
        text: 'Propagated source — person-to-person spread (cases infecting each other)',
        correct: false,
        feedback: 'Legionella does NOT spread person-to-person. Every case got infected from an environmental source. But this pattern does suggest something about the source continuity...',
      },
      {
        text: 'Ongoing or intermittent environmental source — not a single point exposure',
        correct: true,
        xp: 30,
        feedback: 'Excellent reasoning! A point-source outbreak causes a single peak. A curve stretched over weeks, with cases appearing sporadically, suggests people continue to be exposed to the same environmental source intermittently — like a cooling tower running continuously and people walking through the aerosolized plume at different times.',
        casefile: 'Q3 ✓ Pattern = ongoing environmental source. Continuous exposure, not single point event.',
      },
      {
        text: 'Mixed outbreak — some cases are foodborne, others airborne',
        correct: false,
        feedback: 'Legionella is exclusively transmitted through inhalation of contaminated aerosols — not by food or person-to-person contact. All cases here share the same transmission pathway.',
      },
      {
        text: 'Too few cases to interpret the curve',
        correct: false,
        feedback: 'Even with small case counts, the temporal distribution of cases is informative. Epidemiologists regularly use epi curves with small clusters. The pattern here clearly differs from a point-source.',
      },
    ],
  },
  {
    speaker: 'ENVIRONMENTAL HEALTH SPECIALIST',
    text: `Spatial analysis complete. All 7 cases spent time within 400 meters of the Grand Central Hotel in the 2-10 days before symptom onset. The hotel has a rooftop cooling tower last serviced 6 months ago.`,
    casefile: 'Geographic cluster: All cases within 400m of Grand Central Hotel. Cooling tower not serviced in 6 months.',
    scene: 'legionnaires',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `We need to take environmental samples. When testing the cooling tower water for Legionella, what concentration level typically indicates a high-risk situation requiring immediate action?`,
    choices: [
      {
        text: 'Any detectable Legionella > 0 CFU/mL requires immediate shutdown',
        correct: false,
        feedback: 'Low levels of Legionella can be detected in many water systems. Most guidelines use a threshold approach, as very low concentrations may not pose significant risk. Immediate shutdown is triggered by higher concentrations or confirmed human illness.',
      },
      {
        text: 'Greater than 1,000 CFU/mL (or 10³ CFU/mL) or any level with associated cases',
        correct: true,
        xp: 25,
        feedback: 'Correct! Most guidelines (including ASHRAE 188 and CDC) consider >1,000 CFU/mL a high-risk threshold requiring remediation. However, when there ARE confirmed human cases, remediation should occur at any detectable level. The combination of lab confirmation + linked cases is the key indicator.',
        casefile: 'Q4 ✓ Action threshold: >1000 CFU/mL or any level + confirmed cases. Remediation required.',
      },
      {
        text: 'Greater than 1,000,000 CFU/mL — only extreme concentrations are dangerous',
        correct: false,
        feedback: 'Action thresholds are much lower. At 10⁶ CFU/mL, you would have a catastrophic contamination. Real-world outbreak-linked towers often test in the 10³-10⁵ range.',
      },
      {
        text: 'pH and temperature matter more than culture results',
        correct: false,
        feedback: 'pH and temperature are important preventive parameters (Legionella thrives at 25-45°C), but microbiological culture results are the definitive measurement for risk assessment during an active outbreak.',
      },
    ],
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'lab',
    text: `Cooling tower water sample results: POSITIVE for Legionella pneumophila, serogroup 1.\n\nConcentration: 48,000 CFU/mL\n\nMolecular typing (PFGE/WGS): Identical banding pattern to patient isolates. MATCH CONFIRMED.\n\nThis is your source.`,
    xp: 50,
    casefile: 'ENVIRONMENTAL MATCH: Cooling tower positive L. pneumophila sg1. 48,000 CFU/mL. WGS match to cases.',
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    text: `Brilliant work. Now an analytic question: What type of epidemiological study design is most appropriate for this cluster investigation, given that you don't know the full population at risk?`,
    choices: [
      {
        text: 'Prospective cohort study — follow everyone exposed going forward',
        correct: false,
        feedback: 'A prospective cohort study would take too long and isn\'t practical for an active outbreak with an environmental source. You need to identify the source now to stop ongoing exposure.',
      },
      {
        text: 'Case-control study — compare cases to controls for environmental exposures',
        correct: true,
        xp: 30,
        feedback: 'Correct! When you have identified cases but don\'t know the full population at risk (who was exposed to the cooling tower?), a case-control study is the right design. You compare the exposures of sick people (cases) to exposures of similar well people (controls) in the same area to identify risk factors.',
        casefile: 'Q5 ✓ Case-control design appropriate: unknown denominator, retrospective exposure assessment needed.',
      },
      {
        text: 'Cross-sectional study — one-time survey of prevalence',
        correct: false,
        feedback: 'Cross-sectional studies measure prevalence at a single point in time and can\'t establish temporal relationships well. They\'re good for chronic disease prevalence but not optimal for outbreak investigation with time-varying exposure.',
      },
      {
        text: 'Ecologic study — compare rates across geographic areas',
        correct: false,
        feedback: 'Ecologic studies compare aggregated data across populations or regions. They\'re useful for hypothesis generation but suffer from the ecologic fallacy. For outbreak investigation, individual-level data gives you much stronger evidence.',
      },
    ],
  },
  {
    speaker: 'ENVIRONMENTAL HEALTH SPECIALIST',
    text: `The cooling tower was hyperchlorinated and physically decontaminated. No new cases reported in 21 days. The outbreak is over.\n\nFinal case count: 7 cases, 1 death (14% case-fatality rate). Root cause: Inadequate cooling tower maintenance and water treatment.`,
    scene: 'legionnaires',
    casefile: 'OUTBREAK OVER: No new cases 21 days post-remediation. 7 cases, 1 death (CFR 14%).',
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    scene: 'press',
    text: `Excellent investigation, Detective. You correctly identified the source, guided the environmental sampling, understood the epidemiological study design, and helped implement control measures that stopped the outbreak.\n\nYour rank advancement is well-deserved. This is the work of a Senior Epi Detective.`,
    xp: 250,
    casefile: 'CASE 2 CLOSED: Cooling tower source confirmed via WGS. Remediation successful. 0 new cases.',
  },
];

/* ============================================================
   CASE 3: THE VACCINE HESITANCY CRISIS — MEASLES
   ============================================================ */

const CASE_MEASLES = [
  {
    speaker: 'STATE HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    scene: 'measles',
    text: `PRIORITY ALERT: Measles cluster identified at Westbrook Elementary School. 12 confirmed cases in the past 14 days. The school has a 72% vaccination rate — well below the herd immunity threshold.\n\nThis is your most complex case yet. You're not just fighting a virus. You'll battle misinformation, vaccine hesitancy, and community distrust.`,
    casefile: 'CASE 3: Measles cluster, Westbrook Elementary. 12 cases. Vaccination coverage: 72%.',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Measles is one of the most contagious infectious diseases known. Its basic reproduction number — R₀ — is famously high.\n\nWhat is the R₀ of measles, and what does it mean for herd immunity?`,
    choices: [
      {
        text: 'R₀ = 2-3 (like influenza); herd immunity requires ~60-70% vaccination',
        correct: false,
        feedback: 'That\'s influenza\'s R₀ range, not measles. Measles is far more contagious. The herd immunity threshold (HIT) is calculated as: 1 - 1/R₀. With R₀=2.5, HIT = 1 - 1/2.5 = 60%. Much lower than measles actually requires.',
      },
      {
        text: 'R₀ = 12-18; herd immunity requires 92-95% vaccination coverage',
        correct: true,
        xp: 35,
        feedback: 'Exactly right! Measles has one of the highest R₀ values of any infectious disease (12-18). Using the formula HIT = 1 - 1/R₀: with R₀=18, HIT = 1 - 1/18 = 94.4%. This is why 95%+ vaccination coverage is needed to maintain herd immunity. At 72%, this school is dangerously below threshold.',
        casefile: 'Q1 ✓ Measles R₀=12-18. HIT=92-95%. School at 72% = far below threshold. Outbreak expected.',
      },
      {
        text: 'R₀ = 5-7; herd immunity requires ~85% vaccination',
        correct: false,
        feedback: 'R₀ of 5-7 is closer to polio or smallpox. Measles is significantly more contagious, with R₀ of 12-18. This extraordinary transmissibility is why measles was such a devastating childhood disease before vaccination.',
      },
      {
        text: 'R₀ doesn\'t determine herd immunity — only antibody titers matter',
        correct: false,
        feedback: 'The herd immunity threshold IS mathematically derived from R₀: HIT = 1 - 1/R₀. Individual antibody titers determine PERSONAL protection, but population-level herd immunity is a function of how many people need to be immune to break transmission chains — which depends on R₀.',
      },
    ],
  },
  {
    speaker: 'SCHOOL NURSE',
    text: `We\'ve pulled the vaccination records. Of 340 students:\n• 245 fully vaccinated (2 doses MMR)\n• 48 unvaccinated (parental exemption)\n• 31 vaccinated with 1 dose\n• 16 unknown vaccination status\n\nThe 12 cases: 9 are unvaccinated, 2 are 1-dose recipients, 1 is unknown.`,
    scene: 'measles',
    casefile: 'Vaccination breakdown: 245 full (2-dose), 48 unvax, 31 single-dose, 16 unknown.',
    tools: {
      type: 'table',
      title: 'MEASLES ATTACK RATES BY VACCINATION STATUS',
      headers: ['Vaccination Status', 'Cases', 'Total', 'Attack Rate', 'Vaccine Efficacy'],
      rows: [
        ['Unvaccinated',  '9',  '48', {value:'18.8%', highlight:true}, 'N/A (reference)'],
        ['1 Dose MMR',    '2',  '31', '6.5%',  {value:'~65%', highlight:false}],
        ['2 Doses MMR',   '1',  '245','0.4%',  {value:'~98%', highlight:true}],
        ['Unknown',       '0',  '16', '0%',    '—'],
      ],
    },
    xp: 0,
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Look at the vaccine efficacy data. Calculate the vaccine efficacy (VE) for 2-dose MMR using the standard formula:\n\nVE = (ARu - ARv) / ARu × 100%\n\nWhere ARu = attack rate in unvaccinated, ARv = attack rate in vaccinated.`,
    keepTools: true,
    choices: [
      {
        text: 'VE ≈ 52% — the vaccine halves your risk',
        correct: false,
        feedback: 'Let\'s calculate: ARu = 18.8%, ARv = 0.4%. VE = (18.8 - 0.4) / 18.8 × 100 = 18.4/18.8 × 100 ≈ 97.9%. That\'s much higher than 52%.',
      },
      {
        text: 'VE ≈ 98% — 2-dose MMR is highly effective',
        correct: true,
        xp: 30,
        feedback: 'Correct! VE = (18.8% - 0.4%) / 18.8% × 100 = 97.9% ≈ 98%. This is consistent with published MMR efficacy data. The 1-dose has ~93-95% efficacy after one dose; 2 doses provide 97-99% protection. The one 2-dose case is likely a rare vaccine failure or could be a non-responder.',
        casefile: 'Q2 ✓ VE (2-dose MMR) = 97.9%. Highly effective. Cases concentrated in unvaccinated.',
      },
      {
        text: 'VE ≈ 75% — moderately effective',
        correct: false,
        feedback: 'Calculate using the formula: (ARu - ARv) / ARu = (18.8 - 0.4) / 18.8 = 0.978 = 97.8%. The MMR vaccine is among the most effective vaccines ever developed.',
      },
      {
        text: 'Cannot determine VE without a randomized controlled trial',
        correct: false,
        feedback: 'Vaccine efficacy can absolutely be estimated from outbreak data using the standard formula VE = (ARu - ARv)/ARu. This is a well-established epidemiological method called the "screening method" or cohort-based VE estimation.',
      },
    ],
  },
  {
    speaker: 'COMMUNITY HEALTH WORKER',
    boxStyle: 'pixel-box',
    text: `We\'ve identified a community Facebook group with over 2,000 members sharing anti-vaccine content. Common claims include:\n\n• "MMR causes autism"\n• "Measles is just a rash — not dangerous"\n• "Natural immunity is better than vaccine immunity"\n• "The MMR contains toxins"\n\nParents are keeping unvaccinated kids home but refusing vaccination.`,
    scene: 'measles',
    casefile: 'Community misinformation: Facebook group, 2000 members. Autism claims, natural immunity myths.',
  },
  {
    speaker: 'VACCINE-HESITANT PARENT',
    boxStyle: 'pixel-box-red',
    text: `"Look, I\'ve done my research. I read that the MMR causes autism. My child, my choice. I\'d rather my kid get natural immunity than be injected with chemicals. The health department just wants to sell vaccines anyway."`,
    scene: 'measles',
  },
  {
    speaker: 'YOU — OUTBREAK SPECIALIST',
    text: `This parent\'s concerns are based on misinformation, but coming in dismissive won\'t work. How do I respond effectively to the autism concern?`,
    choices: [
      {
        text: '"The autism study was fraudulent — Wakefield lost his medical license. Dozens of studies with millions of children find no link."',
        correct: true,
        xp: 25,
        feedback: 'This is the correct approach — acknowledge the source of the concern (the 1998 Wakefield paper), explain clearly that it was fraudulent and retracted, and cite the robust evidence base. Studies including >1.2 million children across multiple countries find absolutely no link between MMR and autism. This is the strongest evidence-based counter.',
        casefile: 'Q3 ✓ Autism response: Wakefield fraud, retracted 1998 Lancet paper. >1.2M children studied, no link found.',
      },
      {
        text: '"Your concerns are completely baseless — stop spreading misinformation."',
        correct: false,
        feedback: 'Dismissing concerns outright often entrenches hesitancy rather than reducing it. Motivational interviewing and empathetic communication work better. Acknowledge the concern, then redirect to evidence.',
      },
      {
        text: 'Just say nothing — debunking makes the myth stronger',
        correct: false,
        feedback: 'The "backfire effect" — where corrections strengthen misconceptions — has actually been found NOT to be universal in recent research. Thoughtful, empathetic correction with strong evidence is more effective than silence, especially in an active outbreak.',
      },
      {
        text: '"Natural immunity IS better — we agree with you on that."',
        correct: false,
        feedback: 'This is factually incorrect and contradicts public health guidance. Natural measles infection carries serious risks: encephalitis (1 in 1,000), death (1-2 in 1,000 in developed countries, higher in developing settings), and paradoxically, measles causes immune amnesia — wiping out previously acquired immunity to other diseases.',
      },
    ],
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `The parent raised "natural immunity." Let\'s address this accurately. How does natural measles immunity compare to vaccine-induced immunity?`,
    choices: [
      {
        text: 'Natural immunity is lifelong and stronger; vaccine immunity wanes and requires boosters',
        correct: false,
        feedback: 'This overstates the difference and misstates the risk. While natural immunity IS lifelong, so is the immunity from 2 doses of MMR for most people. The critical issue: to GET natural measles immunity, you must SURVIVE measles — and measles carries serious risks of complications and the devastating "immune amnesia" effect.',
      },
      {
        text: 'Vaccine immunity is superior because it provides protection WITHOUT the risks of measles disease, including immune amnesia, encephalitis, and death',
        correct: true,
        xp: 30,
        feedback: 'Exactly right! Both natural and vaccine immunity are durable. But natural infection risks: encephalitis (1/1,000), SSPE (subacute sclerosing panencephalitis — always fatal), immune amnesia lasting 2-3 years (measles destroys 20-70% of B cell memory), and death. Vaccine provides equivalent immunity without these risks. There is no reason to prefer the disease.',
        casefile: 'Q4 ✓ Natural vs vaccine immunity: both durable. Vaccine avoids measles encephalitis, immune amnesia, SSPE, death.',
      },
      {
        text: 'There is no difference — natural and vaccine immunity are identical in duration and strength',
        correct: false,
        feedback: 'There are real differences. Natural infection tends to produce somewhat higher antibody titers after acute infection, but this comes at the cost of serious disease risk. The 2-dose MMR schedule provides durable protection that for most people is lifelong.',
      },
      {
        text: '"Natural immunity" from community exposure (without disease) provides protection',
        correct: false,
        feedback: 'This describes an incorrect concept. "Natural immunity" only comes from surviving the actual infection. Sub-clinical exposure to measles does not reliably produce protective immunity without the full inflammatory response of disease.',
      },
    ],
  },
  {
    speaker: 'STATE HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    text: `Good. Now for the outbreak response. We need to calculate the expected additional cases if we don\'t vaccinate, versus with an emergency vaccination campaign.\n\nWith the current 72% coverage and measles R₀ = 15, what is the effective reproduction number (Rₑ)?`,
    tools: {
      type: 'text',
      content: `<strong style="color:var(--yellow)">Key Formulas:</strong><br><br>
Rₑ = R₀ × (1 - vaccination coverage × vaccine efficacy)<br><br>
Herd Immunity Threshold (HIT) = 1 - 1/R₀<br><br>
<strong>Current situation:</strong><br>
• R₀ = 15 (measles)<br>
• Vaccination coverage = 72% (0.72)<br>
• Vaccine efficacy = 98% (0.98)<br>
• Effectively immune = 72% × 98% = 70.6%<br>
• Susceptible fraction = 1 - 0.706 = 0.294<br><br>
<strong>HIT for measles (R₀=15):</strong><br>
HIT = 1 - 1/15 = 93.3%`,
    },
    casefile: 'Calculating Rₑ. Current coverage 72%, efficacy 98%, effective immunity 70.6%.',
  },
  {
    speaker: 'MENTOR',
    boxStyle: 'pixel-box',
    text: `Using the formula Rₑ = R₀ × susceptible fraction:\n\nRₑ = 15 × (1 - 0.706) = 15 × 0.294 = ?`,
    keepTools: true,
    choices: [
      {
        text: 'Rₑ ≈ 4.4 — outbreak will grow; each case infects ~4 more people on average',
        correct: true,
        xp: 35,
        feedback: 'Correct! Rₑ = 15 × 0.294 = 4.41. Since Rₑ > 1, the outbreak WILL grow exponentially without intervention. You would need to reduce the susceptible fraction below 6.7% (i.e., achieve >93.3% immunity) to bring Rₑ below 1 and stop transmission.',
        casefile: 'Q5 ✓ Rₑ = 4.41 with current coverage. Outbreak will grow. Need >93% immunity to stop it.',
      },
      {
        text: 'Rₑ ≈ 1.0 — outbreak is at the tipping point but not growing',
        correct: false,
        feedback: 'Calculate: Rₑ = R₀ × susceptible fraction. The susceptible fraction = 1 - (0.72 × 0.98) = 1 - 0.706 = 0.294. So Rₑ = 15 × 0.294 = 4.41. This is well above 1 — the outbreak will grow substantially.',
      },
      {
        text: 'Rₑ < 1 — the outbreak will fizzle out on its own',
        correct: false,
        feedback: 'If Rₑ < 1, yes, the outbreak would naturally die out. But at 72% coverage with 98% efficacy, effective immunity is 70.6%, leaving 29.4% susceptible. With R₀=15, Rₑ = 15 × 0.294 = 4.41 — far above 1.',
      },
      {
        text: 'Rₑ = 15 — vaccination has no effect on transmission',
        correct: false,
        feedback: 'The whole point of vaccination in communities is to reduce the susceptible fraction, thereby reducing Rₑ below R₀. Rₑ = R₀ × susceptible fraction. At 70.6% immunity, Rₑ = 15 × 0.294 = 4.41, substantially below R₀=15 but still far above 1.',
      },
    ],
  },
  {
    speaker: 'EPIDEMIOLOGIST — MODELING TEAM',
    text: `Based on the Rₑ of 4.4, without intervention, our model projects 80-120 additional cases before the outbreak burns through the susceptible population.\n\nWith an emergency vaccination campaign targeting unvaccinated children and bringing coverage to 95%, Rₑ drops to 0.7 — below 1. The outbreak stops within 2 incubation periods.`,
    casefile: 'Projection without intervention: 80-120 more cases. With campaign to 95%: Rₑ=0.7, outbreak stops.',
    scene: 'measles',
  },
  {
    speaker: 'COMMUNITY LIAISON',
    text: `We\'ve set up a vaccine clinic at the school. 28 additional children vaccinated so far. But the Facebook group is actively discouraging parents from coming.\n\nCoverage has reached 89% — better, but still below the 93.3% threshold. What\'s our strategy?`,
    choices: [
      {
        text: 'Conduct a press conference to publicly shame vaccine-hesitant parents',
        correct: false,
        feedback: 'Public shaming reliably backfires. It entrenches hesitancy, destroys trust, and can create community division that makes future public health work harder. Empathy and trusted messengers are more effective.',
      },
      {
        text: 'Partner with pediatricians, school nurses, and trusted community leaders to do door-to-door outreach with evidence-based messaging',
        correct: true,
        xp: 30,
        feedback: 'This is the gold standard approach! Trusted messengers (the child\'s own doctor, community leaders) are far more persuasive than public health officials alone. Door-to-door outreach removes barriers. Evidence-based messaging that acknowledges concerns without dismissal builds trust. This approach, combined with removing non-medical exemptions, has been used successfully in multiple outbreak responses.',
        casefile: 'Q6 ✓ Best strategy: Trusted messengers, pediatricians, community leaders, door-to-door outreach.',
      },
      {
        text: 'Wait for natural infection to provide immunity — it\'s more cost-effective',
        correct: false,
        feedback: 'This is ethically and scientifically unacceptable. Measles causes encephalitis in 1/1,000 cases, SSPE (always fatal) in 1-2/100,000 cases, and measles-induced immune amnesia that increases susceptibility to other diseases for 2-3 years. Allowing preventable disease is not a legitimate public health strategy.',
      },
      {
        text: 'Contact Facebook and have the misinformation group removed immediately',
        correct: false,
        feedback: 'While platform-level action on misinformation has a role, it\'s slow, can\'t be done by local health departments unilaterally, and often drives groups underground (making them harder to counter). Active outreach and trusted messengers are more immediately effective during an outbreak.',
      },
    ],
  },
  {
    speaker: 'PEDIATRICIAN — DR. CHEN',
    boxStyle: 'pixel-box-yellow',
    text: `We worked through the community using trusted messenger outreach. Coverage has now reached 94.5% — above the 93.3% herd immunity threshold for measles.\n\nLast confirmed case: 18 days ago. No new cases in the past 2 incubation periods. The outbreak is over.`,
    casefile: 'Vaccination coverage reached 94.5%. Last case 18 days ago. OUTBREAK TERMINATED.',
    scene: 'measles',
  },
  {
    speaker: 'STATE HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    text: `Remarkable work, Detective. You successfully:\n\n• Calculated R₀, Rₑ, and herd immunity thresholds\n• Measured vaccine efficacy from outbreak data\n• Navigated vaccine hesitancy with evidence-based communication\n• Applied outbreak modeling to guide the vaccination campaign\n\nThis is the work of an Outbreak Specialist on their way to becoming a World-Class Disease Detective.`,
    scene: 'press',
    xp: 400,
    casefile: 'CASE 3 CLOSED. Measles outbreak terminated. Community coverage 94.5%. All core competencies demonstrated.',
  },
];

// ── INIT ───────────────────────────────────────
window.addEventListener('load', () => {
  drawStars();
  updateHUD();
  showScreen('title-screen');
  STATE.screen = 'title';

  // Wire up rankup + victory buttons via addEventListener (belt-and-suspenders)
  document.getElementById('rankup-continue-btn').addEventListener('click', () => {
    playSFX('click');
    showOutbreakSelect();
  });
  document.getElementById('victory-restart-btn').addEventListener('click', () => {
    resetGame();
  });

  // Animate title stars
  setInterval(() => {
    if (STATE.screen === 'title') drawStars();
  }, 2000);

  // Resize handler for scene canvas
  window.addEventListener('resize', () => {
    if (STATE.screen === 'game' && STATE.currentCase) {
      const sceneMap = { buffet: 'buffet', legionnaires: 'legionnaires', measles: 'measles' };
      paintScene(sceneMap[STATE.currentCase] || 'lab');
    }
  });
});
