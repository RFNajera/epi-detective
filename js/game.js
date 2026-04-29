/* ============================================================
   EPI DETECTIVE v1.5 — GAME ENGINE
   ============================================================ */

'use strict';

/* ── STATE ─────────────────────────────────────────────────── */
const STATE = {
  screen: 'select',          // skip title — go straight to select
  currentCase: null,
  nodeIndex: 0,
  score: 0, xp: 0, xpToRank: 150,
  casesCompleted: [],
  rank: 0,
  muted: false,
  casefileText: '',
  casefileUserVisible: false,
  toolsUserHidden: false,
  pendingFeedbackNext: null,
  audioCtx: null,
};

/* ── RANKS ─────────────────────────────────────────────────── */
const RANKS = [
  { name: 'ROOKIE',                        xp: 0,    msg: 'You\'ve taken your first steps into the field. Cases await.' },
  { name: 'FIELD EPIDEMIOLOGIST',          xp: 300,  msg: 'You can read an epi curve, calculate attack rates, and identify a point-source outbreak. Solid start.' },
  { name: 'SENIOR EPI DETECTIVE',          xp: 700,  msg: 'Toxicology, foodborne botulism, environmental sampling — you\'re handling complex cases with confidence.' },
  { name: 'OUTBREAK SPECIALIST',           xp: 1150, msg: 'Legionella, molecular typing, case-control design — you\'re thinking like a seasoned investigator.' },
  { name: 'WORLD-CLASS DISEASE DETECTIVE', xp: 1700, msg: 'Vaccine efficacy, R₀, herd immunity, risk communication — the complete package. The community is safer with you on the case.' },
];

/* ── AUDIO ─────────────────────────────────────────────────── */
function getAudioCtx() {
  if (!STATE.audioCtx) {
    STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (STATE.audioCtx.state === 'suspended') STATE.audioCtx.resume();
  return STATE.audioCtx;
}

function playSFX(type) {
  if (STATE.muted) return;
  try {
    const ctx = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const patterns = {
      click:   { freq: 440, type: 'square',   dur: 0.05, vol: 0.12 },
      correct: { freq: 660, type: 'square',   dur: 0.3,  vol: 0.18, sweep: 880 },
      wrong:   { freq: 200, type: 'sawtooth', dur: 0.4,  vol: 0.15, sweep: 100 },
      rankup:  { freq: 523, type: 'square',   dur: 0.8,  vol: 0.2,  sweep: 1047 },
      blip:    { freq: 330, type: 'square',   dur: 0.03, vol: 0.07 },
      xp:      { freq: 550, type: 'square',   dur: 0.15, vol: 0.1,  sweep: 700 },
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

function toggleMute() {
  STATE.muted = !STATE.muted;
  document.getElementById('mute-btn').textContent = STATE.muted ? '✕ SOUND OFF' : '♪ SOUND ON';
}

/* ── HUD ───────────────────────────────────────────────────── */
function updateHUD() {
  const rank = RANKS[STATE.rank];
  const nextRank = RANKS[STATE.rank + 1];
  document.getElementById('hud-rank').textContent  = rank.name;
  document.getElementById('hud-cases').textContent = STATE.casesCompleted.length + '/4';
  document.getElementById('hud-score').textContent = STATE.score;
  const pct = nextRank
    ? Math.min(100, ((STATE.xp - rank.xp) / (nextRank.xp - rank.xp)) * 100)
    : 100;
  document.getElementById('xp-fill').style.width = pct + '%';
}

function awardXP(amount) {
  STATE.score += amount;
  STATE.xp    += amount;
  let ranked = false;
  while (STATE.rank < RANKS.length - 1 && STATE.xp >= RANKS[STATE.rank + 1].xp) {
    STATE.rank++;
    ranked = true;
  }
  updateHUD();
  return ranked;
}

/* ── SCREEN SWITCHER ───────────────────────────────────────── */
function showScreen(id) {
  const screens = ['title-screen','outbreak-select','game-scene','rankup-screen','victory-screen'];
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? 'flex' : 'none';
  });
}

function showOutbreakSelect() {
  updateCaseCards();
  showScreen('outbreak-select');
  STATE.screen = 'select';
}

/* ── CASE CARD MANAGEMENT ──────────────────────────────────── */
const CASE_IDS = ['buffet','pruno','legionnaires','measles'];

function updateCaseCards() {
  CASE_IDS.forEach(id => {
    const card    = document.getElementById('case-' + id);
    const status  = document.getElementById('case-' + id + '-status');
    const keyBadge= document.getElementById('key-' + id);
    if (!card) return;

    const completed = STATE.casesCompleted.includes(id);
    const unlocked  = isCaseUnlocked(id);

    card.className = 'outbreak-card ' + (completed ? 'completed' : unlocked ? 'unlocked' : 'locked');
    if (keyBadge) keyBadge.className = 'outbreak-key-badge' + (unlocked ? '' : ' locked-key');
    if (status) status.textContent = completed ? '✓ SOLVED' : unlocked ? 'OPEN' : 'LOCKED';
  });
}

function isCaseUnlocked(id) {
  const UNLOCK = {
    buffet:       () => true,
    pruno:        () => true,
    legionnaires: () => STATE.casesCompleted.includes('buffet') && STATE.casesCompleted.includes('pruno'),
    measles:      () => STATE.casesCompleted.includes('legionnaires'),
  };
  return UNLOCK[id] ? UNLOCK[id]() : false;
}

function tryStartCase(id) {
  if (!isCaseUnlocked(id)) {
    flashLockMessage(id);
    return;
  }
  playSFX('click');
  loadCase(id);
}

function flashLockMessage(id) {
  const msgs = {
    legionnaires: 'Complete both easy cases (Cases 1 & 2) to unlock this investigation.',
    measles:      'Complete the Legionnaires\' case (Case 3) to unlock this investigation.',
  };
  const el = document.getElementById('lock-flash');
  if (!el) return;
  el.textContent = msgs[id] || 'Complete earlier cases to unlock this one.';
  el.classList.add('visible');
  clearTimeout(flashLockMessage._timer);
  flashLockMessage._timer = setTimeout(() => el.classList.remove('visible'), 3500);
}

/* ── NOTEBOOK / CASEFILE ───────────────────────────────────── */
const caseNames = { buffet:'Case 1 — The Banquet Incident', pruno:'Case 2 — The Pruno Incident', legionnaires:'Case 3 — City Center Cluster', measles:'Case 4 — The Vaccine Hesitancy Crisis' };

function initCasefile(caseId) {
  STATE.casefileText = `# ${caseNames[caseId] || 'Investigation Notes'}\n\n`;
  const editor = document.getElementById('casefile-editor');
  if (editor) editor.value = STATE.casefileText;
}

function appendCasefile(text) {
  const editor = document.getElementById('casefile-editor');
  /* Always read current editor content first so student-typed notes are preserved */
  if (editor) STATE.casefileText = editor.value;
  STATE.casefileText += '- ' + text + '\n';
  if (editor) editor.value = STATE.casefileText;
}

function downloadNotebook() {
  const editor = document.getElementById('casefile-editor');
  const content = editor ? editor.value : STATE.casefileText;
  const blob = new Blob([content], { type: 'text/markdown' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'investigation-notes.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

function toggleMdGuide() {
  const guide = document.getElementById('md-guide');
  if (!guide) return;
  const isOpen = guide.classList.contains('open');
  if (!isOpen) {
    guide.innerHTML = `
      <h4>WHAT IS MARKDOWN?</h4>
      <p>Markdown is a simple way to format plain text so it looks great when converted to a document. Your notes are saved as a <code>.md</code> file — any Markdown editor (Obsidian, Notion, VS Code, Typora) will render the formatting automatically.</p>
      <h4 style="margin-top:10px;">QUICK SYNTAX GUIDE</h4>
      <div class="md-row"><span class="md-syntax"><code># Heading 1</code></span><span>Large title heading</span></div>
      <div class="md-row"><span class="md-syntax"><code>## Heading 2</code></span><span>Section heading</span></div>
      <div class="md-row"><span class="md-syntax"><code>**bold text**</code></span><span><strong>Bold text</strong></span></div>
      <div class="md-row"><span class="md-syntax"><code>*italic text*</code></span><span><em>Italic text</em></span></div>
      <div class="md-row"><span class="md-syntax"><code>- item</code></span><span>Bullet list item</span></div>
      <div class="md-row"><span class="md-syntax"><code>1. item</code></span><span>Numbered list item</span></div>
      <div class="md-row"><span class="md-syntax"><code>> quote</code></span><span>Block quote / note</span></div>
      <div class="md-row"><span class="md-syntax"><code>\`code\`</code></span><span>Inline code / formula</span></div>
    `;
  }
  guide.classList.toggle('open', !isOpen);
}

/* ── SCENE PANELS ──────────────────────────────────────────── */
const SCENE_PANELS = {
  buffet:                     'media/panels/buffet_lunch.png',
  buffet_kitchen:             'media/panels/buffet_kitchen.png',
  lab:                        'media/panels/lab_report.png',
  press:                      'media/panels/press_conference.png',
  pruno_prison:               'media/panels/pruno_prison.jpg',
  pruno_inmates_sick:         'media/panels/pruno_inmates_sick.jpg',
  pruno_lab:                  'media/panels/pruno_lab.jpg',
  pruno_interviews:           'media/panels/pruno_interviews.jpg',
  pruno_antitoxin:            'media/panels/pruno_antitoxin.jpg',
  pruno_press:                'media/panels/pruno_press.jpg',
  legionnaires:               'media/panels/legionnaires_hotel.png',
  legionnaires_lab:           'media/panels/legionnaires_lab_results.png',
  legionnaires_interviews:    'media/panels/legionnaires_interviews.png',
  legionnaires_spatial:       'media/panels/legionnaires_spatial.png',
  legionnaires_cooling_tower: 'media/panels/legionnaires_cooling_tower.png',
  legionnaires_press:         'media/panels/legionnaires_press.png',
  measles:                    'media/panels/measles_school.png',
  measles_nurse_records:      'media/panels/measles_nurse_records.png',
  measles_vaccine_efficacy:   'media/panels/measles_vaccine_efficacy.png',
  measles_facebook:           'media/panels/measles_facebook.png',
  measles_natural_vs_vaccine: 'media/panels/measles_natural_vs_vaccine.png',
  measles_outbreak_projection:'media/panels/measles_outbreak_projection.png',
  measles_vaccine_clinic:     'media/panels/measles_vaccine_clinic.png',
  measles_pediatrician:       'media/panels/measles_pediatrician.png',
  measles_health_officer_close:'media/panels/measles_health_officer_close.png',
};

function paintScene(sceneKey) {
  const canvas  = document.getElementById('scene-canvas');
  const imgEl   = document.getElementById('scene-panel');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.offsetWidth || 860;
  canvas.height = 240;

  // Gradient background
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#0d1b2a');
  grad.addColorStop(1, '#1a3a5c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const panelSrc = SCENE_PANELS[sceneKey];
  if (panelSrc && imgEl) {
    imgEl.src = panelSrc;
    imgEl.style.display = 'block';
  } else if (imgEl) {
    imgEl.style.display = 'none';
  }
}

/* ── FIELD REFERENCE ───────────────────────────────────────── */
const FIELD_REFERENCE = {
  buffet: [
    { name:'Salmonella spp.',           incubation:'6–72 h',    route:'Eggs, poultry, unpasteurized dairy, produce', symptoms:'Diarrhea (sometimes bloody), fever, stomach cramps, vomiting', control:'Cook poultry and eggs thoroughly; refrigerate foods promptly; practice good hand washing', gram:'Gram-negative rod', media:'MacConkey agar (pink colonies, lactose-negative) and XLD agar', morphology:'Motile, facultatively anaerobic rod; produces H2S on XLD (black center)', key:'Common cause of egg-related outbreaks; Salmonella Enteritidis is the most frequent type linked to raw eggs' },
    { name:'Staphylococcus aureus',     incubation:'1–6 h',     route:'Foods held at room temperature; food handlers with skin infections', symptoms:'Sudden vomiting, nausea, stomach cramps; usually short duration (24–48 h)', control:'Keep hot foods above 140°F (60°C); refrigerate within 2 hours; exclude ill food workers', gram:'Gram-positive coccus', media:'Mannitol salt agar (yellow colonies from mannitol fermentation)', morphology:'Clusters of cocci ("grape-like"); coagulase-positive', key:'Heat-stable toxin: reheating food will NOT destroy the toxin even if bacteria are killed' },
    { name:'Clostridium perfringens',   incubation:'6–24 h',    route:'Large-batch foods (stews, gravies, meats) cooled slowly', symptoms:'Crampy diarrhea; vomiting is rare; generally mild and self-limited', control:'Rapid cooling of cooked foods; keep hot foods above 140°F; reheat to 165°F', gram:'Gram-positive rod', media:'Egg-yolk agar (lecithinase reaction)', morphology:'Box-car shaped rod; anaerobic spore-former; no motility', key:'Spores survive cooking and germinate during slow cooling; toxin is produced in the intestine during sporulation' },
    { name:'Bacillus cereus',           incubation:'1–6 h (emetic); 6–15 h (diarrheal)', route:'Fried rice, pasta, starchy foods left at room temperature', symptoms:'Emetic form: vomiting. Diarrheal form: cramps and diarrhea', control:'Refrigerate rice and starchy dishes within 2 hours; do not reheat multiple times', gram:'Gram-positive rod', media:'MYP agar (pink colonies with precipitate ring)', morphology:'Large rod; endospore-forming; motile', key:'Spores survive boiling; the emetic toxin (cereulide) is heat-stable and forms in food before it is eaten' },
    { name:'Norovirus',                 incubation:'12–48 h',   route:'Fecal-oral; contaminated food (especially shellfish, salads); infected food handlers', symptoms:'Sudden vomiting and diarrhea; low-grade fever; usually resolves in 1–3 days', control:'Exclude ill food handlers for 48 hours after symptoms clear; thorough cleaning with bleach solution', gram:'N/A — non-enveloped RNA virus (Caliciviridae family)', media:'RT-PCR from stool samples; not cultured in routine labs', morphology:'27–38 nm round-ish particle; very stable on surfaces', key:'Leading cause of foodborne illness outbreaks in the US; as few as 18 viral particles can cause infection' },
    { name:'Campylobacter jejuni',      incubation:'1–10 days', route:'Raw or undercooked poultry; unpasteurized milk; contaminated water', symptoms:'Diarrhea (often bloody), fever, stomach cramps; sometimes mimics appendicitis', control:'Cook poultry thoroughly; pasteurize milk; practice good hand washing after handling raw meat', gram:'Gram-negative curved rod (described as "gull-wing" shaped)', media:'Campy-BAP or Skirrow agar (42°C incubation, microaerophilic conditions)', morphology:'Spirally curved rod; single polar flagellum; rapid "corkscrew" motility', key:'One of the most common bacterial causes of diarrhea in the US; rare complication: Guillain-Barré syndrome' },
  ],
  pruno: [
    { name:'Clostridium botulinum',     incubation:'6 h – 10 days (typically 12–72 h)', route:'Eating food that already contains the preformed toxin (pruno, home-canned vegetables, honey in infants)', symptoms:'Descending (top-down) flaccid paralysis, double vision (diplopia), drooping eyelids (ptosis), slurred speech, difficulty swallowing; NO fever', control:'Heptavalent Botulinum Antitoxin (HBAT) from CDC; breathing support and mechanical ventilation if needed', gram:'Gram-positive rod', media:'Egg-yolk agar (lecithinase positive); must be grown under anaerobic (no oxygen) conditions', morphology:'Large rod; forms spores that look like a "tennis racket" (subterminal spores); strictly anaerobic', key:'There are 7 toxin types (A–G); Type A is most common in US food outbreaks. The toxin blocks the release of acetylcholine at nerve-muscle junctions.' },
    { name:'Clostridium perfringens',   incubation:'6–24 h',    route:'Large-batch foods cooled too slowly; institutional settings', symptoms:'Crampy diarrhea; vomiting is uncommon; generally not severe', control:'Rapid cooling; keep hot foods above 140°F', gram:'Gram-positive rod', media:'Egg-yolk agar', morphology:'Box-car shaped rod; anaerobic spore-former', key:'Spores survive cooking and make toxin in the gut during sporulation' },
    { name:'Clostridium difficile',     incubation:'Varies; often follows antibiotic use', route:'Fecal-oral route; healthcare and prison settings; spores persist on surfaces', symptoms:'Watery diarrhea, stomach cramping, fever; severe cases can develop colitis with pseudomembrane formation', control:'Contact precautions; bleach disinfection (alcohol hand gel does NOT kill the spores — soap and water required)', gram:'Gram-positive rod', media:'CCFA agar (yellow "ground glass" colonies); grown under anaerobic conditions', morphology:'Spore-forming rod; spores are extremely resistant and survive on surfaces for months', key:'Leading cause of healthcare-associated diarrhea; alcohol-based hand sanitizers do NOT kill C. diff spores' },
    { name:'E. coli O157:H7 (STEC)',    incubation:'2–8 days',  route:'Contaminated water or food; fecal-oral spread in crowded institutions', symptoms:'Bloody diarrhea; severe stomach cramps; can cause Hemolytic Uremic Syndrome (HUS) in some cases', control:'Cook ground beef to 160°F; safe water; thorough hand washing; especially important in institutional settings', gram:'Gram-negative rod', media:'SMAC agar (colorless colonies, does not ferment sorbitol); sorbitol-MacConkey', morphology:'Sorbitol-negative; MUG-negative; typical E. coli colony on standard media otherwise', key:'Low infectious dose; HUS (kidney failure) is a life-threatening complication; high risk in crowded settings like prisons' },
    { name:'Shigella spp.',             incubation:'12–96 h',   route:'Fecal-oral; extremely low infectious dose; crowded settings facilitate rapid spread', symptoms:'Bloody diarrhea, high fever, painful urge to defecate (tenesmus)', control:'Thorough hand washing with soap and water; safe water supply; exclude ill persons from food preparation', gram:'Gram-negative rod', media:'MacConkey agar (pale, lactose-negative colonies); HE and XLD agars', morphology:'Non-motile; does not produce H2S; non-spore-forming', key:'Fewer than 10 organisms can cause infection — this makes it extremely contagious in crowded settings like correctional facilities' },
    { name:'Norovirus',                 incubation:'12–48 h',   route:'Fecal-oral; highly contagious in institutional settings like prisons', symptoms:'Vomiting, diarrhea, nausea; spreads rapidly among people in close quarters', control:'Isolate ill individuals; clean surfaces with bleach; keep ill persons out of food service for 48 hours after recovery', gram:'N/A — RNA virus (Caliciviridae)', media:'RT-PCR from stool; cannot be cultured in standard labs', morphology:'27–38 nm icosahedral particle', key:'The single most common cause of institutional gastroenteritis outbreaks in the US, including correctional facilities' },
  ],
  legionnaires: [
    { name:'Legionella pneumophila',    incubation:'2–10 days', route:'Breathing in (inhaling) contaminated water droplets or aerosols from cooling towers, HVAC systems, showers, decorative fountains', symptoms:'Severe pneumonia, high fever, confusion, muscle aches, GI symptoms. A milder form (Pontiac fever) causes flu-like illness without pneumonia.', control:'Regular disinfection of cooling towers; building water management plans; chlorination', gram:'Gram-negative rod (stains poorly with standard Gram stain; use silver stain or DFA antibody stain)', media:'BCYE agar with L-cysteine (required for growth); bacteria will NOT grow on standard blood agar', morphology:'Slender rod; facultative intracellular pathogen (multiplies inside alveolar macrophages)', key:'The urinary antigen test (UAT) is the most common rapid test; BCYE agar requires L-cysteine — the bacteria cannot grow without it' },
    { name:'Mycoplasma pneumoniae',     incubation:'1–4 weeks', route:'Respiratory droplets from person to person; causes community-acquired pneumonia', symptoms:'"Walking pneumonia" — dry hacking cough, low-grade fever, fatigue; gradual onset over weeks', control:'Treat with azithromycin or doxycycline (NOT penicillin or amoxicillin — no effect because Mycoplasma has no cell wall!)', gram:'No cell wall; appears Gram-negative by default but does not Gram stain well', media:'PPLO agar or SP4 broth; very slow growing (takes 1–3 weeks)', morphology:'Pleomorphic (no fixed shape); smallest known self-replicating organism; "fried egg" colonies on agar', key:'No cell wall means beta-lactam antibiotics (penicillins, cephalosporins) are completely ineffective' },
    { name:'Streptococcus pneumoniae',  incubation:'1–3 days',  route:'Respiratory droplets; person-to-person transmission', symptoms:'Lobar pneumonia with sudden onset, high fever, productive cough with rust-colored sputum, chest pain', control:'Pneumococcal vaccines (PCV15, PCV20, PPSV23); antibiotics (penicillin or amoxicillin for susceptible strains)', gram:'Gram-positive coccus (diplococci — pairs)', media:'Blood agar (alpha-hemolysis, green zone around colonies)', morphology:'Lancet-shaped diplococci; encapsulated; bile-soluble; alpha-hemolytic on blood agar', key:'Most common cause of community-acquired pneumonia in adults; the capsule is the main virulence factor — targeted by vaccines' },
    { name:'Influenza A',               incubation:'1–4 days',  route:'Respiratory droplets and aerosols', symptoms:'Sudden-onset fever, severe body aches (myalgia), dry cough, headache; can rapidly worsen to pneumonia', control:'Annual flu vaccine; antiviral medications (oseltamivir/Tamiflu) within 48 hours of symptom onset', gram:'N/A — segmented negative-sense RNA virus (Orthomyxoviridae family)', media:'Cell culture; RT-PCR from nasopharyngeal swab is preferred rapid test', morphology:'Pleomorphic enveloped virus; hemagglutinin (HA) and neuraminidase (NA) surface proteins determine the strain (e.g., H1N1)', key:'Segmented genome allows for antigenic shift (mixing of different influenza strains), which is how pandemic strains emerge' },
    { name:'Aspergillus fumigatus',     incubation:'Days to weeks (especially in immunocompromised people)', route:'Breathing in fungal spores from the environment; construction sites and hospitals are high-risk', symptoms:'Invasive pulmonary aspergillosis in immunocompromised patients; chronic sinusitis in others', control:'HEPA air filtration during hospital construction; antifungal drugs (voriconazole) for high-risk patients', gram:'N/A — fungus (mold)', media:'Sabouraud dextrose agar; blue-green colonies', morphology:'Septate hyphae branching at 45-degree angles; columnar (column-like) conidial heads under the microscope', key:'Galactomannan antigen test (blood or BAL fluid) is used for early diagnosis in immunocompromised patients' },
    { name:'Coccidioides immitis',      incubation:'1–3 weeks', route:'Breathing in spores from disturbed desert soil; common in the southwestern US (San Joaquin Valley fever)', symptoms:'"Valley fever" — flu-like illness, chest pain, fatigue; serious disseminated disease in immunocompromised patients', control:'Avoid exposure to disturbed desert soil; antifungal treatment for disseminated disease', gram:'N/A — dimorphic fungus (looks different in the lab vs. in the body)', media:'Sabouraud agar (mold form in lab); BSL-3 precautions required — the spores are highly infectious in the lab!', morphology:'Spherules (round structures containing endospores) in infected tissue; barrel-shaped arthroconidia in soil', key:'Spherules in tissue are diagnostic; the arthroconidia (spores) in the lab are dangerously infectious — must be handled with extreme caution' },
  ],
  measles: [
    { name:'Measles virus (Rubeola)',   incubation:'7–21 days (average 14 days)', route:'Airborne transmission via droplet nuclei; extremely contagious (R₀ = 12–18)', symptoms:'Prodrome: fever, cough, runny nose (coryza), red watery eyes (conjunctivitis); Koplik spots on inner cheeks; then maculopapular rash spreading head-to-toe', control:'MMR vaccine (2 doses, about 97% effective); isolate cases for 4 days after rash onset; post-exposure vaccination within 72 hours can prevent disease', gram:'N/A — non-segmented negative-sense RNA virus (Paramyxoviridae family)', media:'Vero/hSLAM cell culture; RT-PCR from nasopharyngeal swab, urine, or throat swab', morphology:'Pleomorphic enveloped virus; fusion (F) and hemagglutinin (H) surface proteins; infected cells show nuclear and cytoplasmic inclusion bodies', key:'Koplik spots (tiny blue-white spots on the inner cheeks) are PATHOGNOMONIC (unique to measles); the virus can remain airborne for up to 2 hours after an infected person leaves a room' },
    { name:'Mumps virus',               incubation:'12–25 days', route:'Respiratory droplets and saliva contact', symptoms:'Swollen, painful salivary glands (parotitis — the classic "chipmunk cheeks" appearance), fever; can cause meningitis or orchitis', control:'MMR vaccine (2 doses, about 88% effective); isolate for 5 days after parotitis onset', gram:'N/A — paramyxovirus', media:'Cell culture; RT-PCR from buccal (cheek) swab', morphology:'Pleomorphic enveloped virus; hemagglutinin-neuraminidase (HN) surface protein', key:'Post-pubertal males who get mumps can develop orchitis (testicular inflammation); vaccine is about 88% effective with 2 doses' },
    { name:'Rubella virus',             incubation:'12–23 days', route:'Respiratory droplets from person to person', symptoms:'Mild rash, low fever, swollen lymph nodes (especially behind the ears); Congenital Rubella Syndrome (CRS) can occur if a pregnant woman is infected', control:'MMR vaccine; screen pregnant women for rubella immunity; vaccinate women of childbearing age before pregnancy', gram:'N/A — positive-sense RNA virus (Togaviridae family)', media:'Cell culture; serology (IgM antibody testing); RT-PCR', morphology:'Enveloped icosahedral capsid; E1 and E2 surface glycoproteins', key:'Congenital Rubella Syndrome (CRS) triad: heart defects, cataracts, and hearing loss in the newborn if mom is infected in the first trimester' },
    { name:'Bordetella pertussis',      incubation:'7–20 days',  route:'Respiratory droplets; highly contagious', symptoms:'Three stages: catarrhal (cold-like), paroxysmal (severe coughing fits with a "whooping" sound), convalescent (gradual recovery); infants may have apnea (pauses in breathing)', control:'DTaP vaccine (children) and Tdap booster (adolescents and adults); treat exposed contacts with azithromycin', gram:'Gram-negative coccobacillus (very small, almost round rod)', media:'Bordet-Gengou agar (classic) or Regan-Lowe medium; PCR is now the preferred diagnostic test', morphology:'Small, encapsulated coccobacillus; filamentous hemagglutinin helps it attach to respiratory cells', key:'Called "the 100-day cough"; adolescents and adults are often the source of infection for unvaccinated infants, who are at highest risk for serious disease' },
    { name:'Varicella-zoster virus (VZV)', incubation:'10–21 days', route:'Airborne transmission; direct contact with fluid from blisters', symptoms:'Itchy blister-like rash appearing in crops (different stages at the same time), fever, fatigue; reactivation later in life causes shingles (herpes zoster)', control:'Varicella vaccine (2 doses); antiviral treatment (acyclovir) for high-risk individuals; airborne precautions in healthcare settings', gram:'N/A — DNA virus (Herpesviridae family)', media:'Cell culture; PCR from lesion scraping is most accurate; DFA staining', morphology:'Enveloped icosahedral virus; stays latent (dormant) in dorsal root ganglia after initial infection', key:'Second household case has over 90% attack rate; dangerous for newborns when mother develops chickenpox just before delivery' },
    { name:'Hepatitis B virus (HBV)',   incubation:'45–180 days (average about 90 days)', route:'Bloodborne; sexual contact; perinatal (mother to newborn); needle sharing', symptoms:'Acute hepatitis (jaundice, fatigue, dark urine, nausea); chronic infection can progress to liver cirrhosis and liver cancer (HCC); flu-like prodrome', control:'3-dose or 2-dose HBV vaccine series; hepatitis B immune globulin (HBIG) for exposed newborns; universal infant vaccination in the US', gram:'N/A — partially double-stranded DNA virus (Hepadnaviridae family)', media:'Serology is the standard diagnostic (HBsAg, anti-HBc, anti-HBs); not cultured in routine labs', morphology:'Dane particle (42 nm, fully infectious); also produces non-infectious 22 nm surface antigen particles', key:'HBsAg = active infection; anti-HBs = immune (from vaccine or recovery); HBeAg = high viral replication and high infectivity' },
  ],
};

function renderFieldReference(caseId) {
  const content = document.getElementById('fieldref-content');
  if (!content || !caseId) return;
  const agents = FIELD_REFERENCE[caseId];
  if (!agents || !agents.length) {
    content.innerHTML = '<p style="font-family:var(--font-body);color:var(--text-faint);font-size:13px;">No field reference available for this case.</p>';
    return;
  }

  const agentsHtml = agents.map(a => `
    <div class="agent-card">
      <div class="agent-card-header" onclick="toggleAgentCard(this)">
        ${a.name} <span class="toggle">+</span>
      </div>
      <div class="agent-card-body">
        <span class="agent-label">Incubation</span><span class="agent-value">${a.incubation}</span>
        <span class="agent-label">Route of Spread</span><span class="agent-value">${a.route}</span>
        <span class="agent-label">Signs &amp; Symptoms</span><span class="agent-value">${a.symptoms}</span>
        <span class="agent-label">Gram Stain / Type</span><span class="agent-value">${a.gram}</span>
        <span class="agent-label">Lab Media</span><span class="agent-value">${a.media}</span>
        <span class="agent-label">Morphology</span><span class="agent-value">${a.morphology}</span>
        <span class="agent-label">Control Measures</span><span class="agent-value">${a.control}</span>
        <span class="agent-label">Key Fact</span><span class="agent-value">${a.key}</span>
      </div>
    </div>`).join('');

  content.innerHTML = `
    <div class="fieldref-tab-bar">
      <button class="fieldref-tab active" onclick="switchFieldTab(this,'tab-basics')">📋 Basics</button>
      <button class="fieldref-tab" onclick="switchFieldTab(this,'tab-epicurve')">📈 Epi Curve</button>
      <button class="fieldref-tab" onclick="switchFieldTab(this,'tab-agents')">🔬 Agents (${agents.length})</button>
      <button class="fieldref-tab fieldref-tab-dl" onclick="downloadFieldRef()">⬇ Save .txt</button>
    </div>

    <div id="tab-basics" class="fieldref-tab-panel active">
      <h5>Ten Steps of an Outbreak Investigation (CDC)</h5>
      <ol style="padding-left:18px;line-height:2">
        <li>Prepare for fieldwork</li>
        <li>Establish that an outbreak is occurring</li>
        <li>Verify the diagnosis</li>
        <li>Define a case and identify cases (case definition)</li>
        <li>Describe the data by person, place, and time</li>
        <li>Develop hypotheses about the source</li>
        <li>Test hypotheses (analytic epidemiology: cohort or case-control study)</li>
        <li>Refine hypotheses and carry out additional studies as needed</li>
        <li>Implement control and prevention measures</li>
        <li>Communicate findings (report, press release, MMWR)</li>
      </ol>
      <h5>Key Formulas</h5>
      <div class="epi-curve-example">Attack Rate (AR) = (Cases ÷ Population at Risk) × 100%

Risk Ratio (RR) = AR in exposed ÷ AR in unexposed
  (Used in cohort studies and outbreak investigations)

Odds Ratio (OR) = (a × d) ÷ (b × c)  [from a 2×2 table]
  (Used in case-control studies)

Vaccine Efficacy (VE) = (AR unvaccinated − AR vaccinated) ÷ AR unvaccinated × 100%</div>
      <h5>Case Definition Components</h5>
      <ul>
        <li><strong>Clinical criteria</strong> — signs and symptoms that must be present</li>
        <li><strong>Laboratory criteria</strong> — confirmed lab test results</li>
        <li><strong>Epidemiologic linkage</strong> — time, place, and person connections</li>
        <li><strong>Classification</strong> — Confirmed / Probable / Suspected</li>
      </ul>
    </div>

    <div id="tab-epicurve" class="fieldref-tab-panel">
      <h5>What is an Epidemic Curve?</h5>
      <p>An epidemic curve (epi curve) is a bar chart (histogram) that shows how many new cases occurred over time. Each bar represents the number of new cases in a set time interval. It tells you the pattern, size, and timing of an outbreak.</p>
      <h5>Pattern 1 — Point Source</h5>
      <div class="epi-curve-example"><strong>Shape:</strong> Single sharp peak; cases are all clustered within one incubation period of each other.
<strong>What it means:</strong> Everyone was exposed to the same source at one specific time and place (e.g., a buffet lunch, a single batch of contaminated pruno).
<strong>Real-world example:</strong> A foodborne illness outbreak at a catered event.</div>
      <h5>Pattern 2 — Propagated (Person-to-Person)</h5>
      <div class="epi-curve-example"><strong>Shape:</strong> Multiple waves of cases, each wave separated by approximately one incubation period.
<strong>What it means:</strong> Each case infects new people who then become new sources; the outbreak grows in "generations."
<strong>Real-world examples:</strong> Norovirus in a dormitory, measles in a school, COVID-19.</div>
      <h5>Pattern 3 — Continuous Common Source</h5>
      <div class="epi-curve-example"><strong>Shape:</strong> A prolonged plateau or gradual rise and fall over multiple incubation periods.
<strong>What it means:</strong> People are being exposed continuously or intermittently to the same contaminated source over time.
<strong>Real-world examples:</strong> A contaminated water supply or cooling tower.</div>
      <h5>Key Measurements from an Epi Curve</h5>
      <ul>
        <li><strong>Incubation period</strong> — time from exposure to symptoms; helps narrow the likely pathogen.</li>
        <li><strong>Period of exposure</strong> — count backward from the earliest cases by one incubation period.</li>
        <li><strong>Peak</strong> — the time interval with the highest number of new cases.</li>
        <li><strong>Tail</strong> — late cases may suggest secondary spread or an outlier exposure.</li>
      </ul>
      <h5>Incubation Period Quick Reference</h5>
      <div class="epi-curve-example">Staphylococcus aureus:    1–6 hours
Clostridium perfringens:  6–24 hours
Salmonella:               6–72 hours
Norovirus:                12–48 hours
Shigella:                 12–96 hours
E. coli O157:H7:          2–8 days
Botulism:                 6 hours–10 days
Campylobacter:            1–10 days
Legionella:               2–10 days
Hepatitis A:              15–50 days
Measles:                  7–21 days</div>
    </div>

    <div id="tab-agents" class="fieldref-tab-panel">
      ${agentsHtml}
    </div>
  `;
}

function switchFieldTab(btn, tabId) {
  const panel = document.getElementById('fieldref-content');
  if (!panel) return;
  panel.querySelectorAll('.fieldref-tab').forEach(t => t.classList.remove('active'));
  panel.querySelectorAll('.fieldref-tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
}

function downloadFieldRef() {
  const caseId = window.STATE && STATE.currentCase;
  const agents = caseId && FIELD_REFERENCE[caseId] ? FIELD_REFERENCE[caseId] : [];
  const agentsTxt = agents.map(a =>
    `--- ${a.name} ---\nIncubation: ${a.incubation}\nRoute: ${a.route}\nSymptoms: ${a.symptoms}\nGram Stain/Type: ${a.gram}\nLab Media: ${a.media}\nMorphology: ${a.morphology}\nControl: ${a.control}\nKey Fact: ${a.key}\n`
  ).join('\n');

  const txt = `EPI DETECTIVE — FIELD REFERENCE
================================

SECTION 1: OUTBREAK INVESTIGATION BASICS
-----------------------------------------
Ten Steps of an Outbreak Investigation (CDC):
 1. Prepare for fieldwork
 2. Establish that an outbreak is occurring
 3. Verify the diagnosis
 4. Define a case and identify cases
 5. Describe the data by person, place, and time
 6. Develop hypotheses about the source
 7. Test hypotheses (cohort or case-control study)
 8. Refine hypotheses and carry out additional studies
 9. Implement control and prevention measures
10. Communicate findings (report, press release, MMWR)

Key Formulas:
  Attack Rate (AR)     = (Cases / Population at Risk) x 100%
  Risk Ratio (RR)      = AR in exposed / AR in unexposed
  Odds Ratio (OR)      = (a x d) / (b x c)  [from a 2x2 table]
  Vaccine Efficacy (VE)= (AR unvaccinated - AR vaccinated) / AR unvaccinated x 100%

Case Definition Components:
  - Clinical criteria: signs and symptoms that must be present
  - Laboratory criteria: confirmed lab test results
  - Epidemiologic linkage: time, place, and person connections
  - Classification: Confirmed / Probable / Suspected


SECTION 2: HOW TO READ AN EPI CURVE
--------------------------------------
An epi curve is a bar chart (histogram) showing new cases over time.

Pattern 1 - Point Source:
  Shape: Single sharp peak within one incubation period.
  Meaning: Everyone exposed to the same source at one time/place.
  Example: Foodborne illness at a catered event.

Pattern 2 - Propagated (Person-to-Person):
  Shape: Multiple waves separated by ~one incubation period.
  Meaning: Each case infects new people; outbreak grows in generations.
  Examples: Norovirus, measles, COVID-19.

Pattern 3 - Continuous Common Source:
  Shape: Prolonged plateau over multiple incubation periods.
  Meaning: Ongoing exposure to the same contaminated source.
  Examples: Contaminated water supply, cooling tower.

Incubation Period Quick Reference:
  Staph aureus:         1-6 hours
  C. perfringens:       6-24 hours
  Salmonella:           6-72 hours
  Norovirus:            12-48 hours
  Shigella:             12-96 hours
  E. coli O157:H7:      2-8 days
  Botulism:             6 hours - 10 days
  Campylobacter:        1-10 days
  Legionella:           2-10 days
  Hepatitis A:          15-50 days
  Measles:              7-21 days


SECTION 3: AGENTS FOR THIS OUTBREAK
--------------------------------------
${agentsTxt}
`;

  const blob = new Blob([txt], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `epi-detective-field-reference-${caseId || 'general'}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function toggleAgentCard(header) {
  const body = header.nextElementSibling;
  const toggle = header.querySelector('.toggle');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (toggle) toggle.textContent = isOpen ? '+' : '−';
}

function toggleFieldSection(header) {
  const body = header.nextElementSibling;
  const toggle = header.querySelector('.toggle');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (toggle) toggle.textContent = isOpen ? '+' : '−';
}

/* ── CASE LOADING ──────────────────────────────────────────── */
let currentNodes = [];

function loadCase(caseId) {
  STATE.currentCase  = caseId;
  STATE.nodeIndex    = 0;
  STATE.casefileUserVisible = false;
  STATE.toolsUserHidden     = false;
  STATE.pendingFeedbackNext = null;

  initCasefile(caseId);
  renderFieldReference(caseId);

  const cases = { buffet: CASE_BUFFET, pruno: CASE_PRUNO, legionnaires: CASE_LEGIONNAIRES, measles: CASE_MEASLES };
  currentNodes = cases[caseId] || [];

  ['casefile-panel','tools-panel','feedback-panel','fieldref-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const cp = document.getElementById('choices-panel');
  if (cp) { cp.innerHTML = ''; cp.style.display = 'none'; }
  const editor = document.getElementById('casefile-editor');
  if (editor) editor.value = STATE.casefileText;

  showScreen('game-scene');
  STATE.screen = 'game';
  advanceNode();
}

/* ── ADVANCE NODE ──────────────────────────────────────────── */
function advanceNode() {
  if (STATE.nodeIndex >= currentNodes.length) {
    completeCase();
    return;
  }
  const node = currentNodes[STATE.nodeIndex];
  STATE.nodeIndex++;

  if (node.scene) paintScene(node.scene);
  if (node.casefile) appendCasefile(node.casefile);

  const toolsPanel = document.getElementById('tools-panel');
  if (node.tools) {
    renderTools(node.tools);
    STATE.toolsUserHidden = false;
    if (toolsPanel) toolsPanel.style.display = 'flex';
  } else if (!node.keepTools) {
    STATE.toolsUserHidden = false;
    if (toolsPanel) toolsPanel.style.display = 'none';
  } else {
    if (toolsPanel) toolsPanel.style.display = STATE.toolsUserHidden ? 'none' : 'flex';
  }

  if (node.xp) { awardXP(node.xp); playSFX('xp'); }

  const textBox    = document.getElementById('text-box');
  const speakerEl  = document.getElementById('speaker-name');
  const dialogEl   = document.getElementById('dialog-text');
  const promptEl   = document.getElementById('continue-prompt');
  const choicesPan = document.getElementById('choices-panel');
  const fbPanel    = document.getElementById('feedback-panel');

  if (fbPanel) fbPanel.style.display = 'none';
  if (choicesPan) { choicesPan.innerHTML = ''; choicesPan.style.display = 'none'; }

  textBox.className = 'pixel-box ' + (node.boxStyle || '');

  if (speakerEl) speakerEl.textContent = node.speaker || '';
  if (dialogEl)  dialogEl.textContent  = node.text    || '';

  if (node.choices && node.choices.length) {
    if (promptEl) promptEl.style.display = 'none';
    renderChoices(node.choices);
  } else {
    if (promptEl) promptEl.style.display = 'block';
  }
}

/* ── TOOLS RENDERER ────────────────────────────────────────── */
function renderTools(tools) {
  const titleEl   = document.getElementById('tools-panel-title');
  const contentEl = document.getElementById('tools-content');
  if (!contentEl) return;
  if (titleEl) titleEl.textContent = tools.title || 'EPIDEMIOLOGICAL DATA';
  contentEl.innerHTML = '';

  if (tools.type === 'epicurve') {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width:100%;overflow-x:auto;';
    const canvas = document.createElement('canvas');
    canvas.id = 'epi-curve-canvas';
    const maxBars = tools.bars.length;
    const bw = Math.max(40, Math.min(60, Math.floor((Math.min(window.innerWidth - 80, 860) - 80) / maxBars)));
    canvas.width  = bw * maxBars + 80;
    canvas.height = 200;
    wrapper.appendChild(canvas);
    contentEl.appendChild(wrapper);
    drawEpiCurve(canvas, tools);
  } else if (tools.type === 'twobytwo') {
    const d = tools.data;
    const el = document.createElement('div');
    el.className = 'two-by-two';
    el.innerHTML = `
      <div class="cell corner"></div>
      <div class="cell header">ILL (CASE)</div>
      <div class="cell header">NOT ILL</div>
      <div class="cell header">EXPOSED</div>
      <div class="cell highlight">${d.a}</div>
      <div class="cell">${d.b}</div>
      <div class="cell header">NOT EXPOSED</div>
      <div class="cell">${d.c}</div>
      <div class="cell highlight">${d.d}</div>`;
    contentEl.appendChild(el);
    if (tools.note) {
      const n = document.createElement('div');
      n.style.cssText = 'font-family:var(--font-body);font-size:12px;color:var(--text-dim);margin-top:8px;';
      n.textContent = tools.note;
      contentEl.appendChild(n);
    }
  } else if (tools.type === 'table') {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width:100%;overflow-x:auto;';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr>${tools.headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${tools.rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
    wrapper.appendChild(table);
    contentEl.appendChild(wrapper);
    if (tools.note) {
      const n = document.createElement('div');
      n.style.cssText = 'font-family:var(--font-body);font-size:12px;color:var(--text-dim);margin-top:8px;';
      n.textContent = tools.note;
      contentEl.appendChild(n);
    }
  } else if (tools.type === 'text') {
    const el = document.createElement('div');
    el.style.cssText = 'font-family:var(--font-body);font-size:13px;color:var(--text-dim);line-height:1.7;white-space:pre-wrap;';
    el.textContent = tools.content;
    contentEl.appendChild(el);
  }
}

function drawEpiCurve(canvas, tools) {
  const ctx   = canvas.getContext('2d');
  const bars  = tools.bars;
  const W     = canvas.width;
  const H     = canvas.height;
  const PAD   = { top:24, right:16, bottom:56, left:44 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(...bars.map(b=>b.count), 1);
  const bw = chartW / bars.length;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  const gridCount = Math.min(maxVal, 5);
  ctx.strokeStyle = '#ddeeff';
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridCount; i++) {
    const y = PAD.top + chartH * (1 - i / gridCount);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    const label = Math.round(maxVal * i / gridCount);
    ctx.fillStyle = '#5580a0';
    ctx.font = '11px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, PAD.left - 5, y + 4);
  }

  // Bars
  bars.forEach((bar, i) => {
    const x    = PAD.left + i * bw;
    const barH = bar.count > 0 ? ((bar.count / maxVal) * chartH) : 0;
    const y    = PAD.top + chartH - barH;

    if (bar.count > 0) {
      ctx.fillStyle = bar.highlight ? '#0055aa' : '#5599dd';
      ctx.fillRect(x + 2, y, bw - 4, barH);
      ctx.strokeStyle = '#003388';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 2, y, bw - 4, barH);

      // Count label above bar
      ctx.fillStyle = '#002244';
      ctx.font = 'bold 11px Share Tech Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(bar.count, x + bw / 2, y - 4);
    }

    // X-axis label — horizontal if bars are wide enough, rotated if not
    ctx.fillStyle = '#334466';
    ctx.font = '10px Share Tech Mono, monospace';
    if (bw >= 44) {
      ctx.save();
      ctx.translate(x + bw / 2, H - PAD.bottom + 12);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(bar.label, 0, 0);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(x + bw / 2, H - PAD.bottom + 8);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'right';
      ctx.fillText(bar.label, 0, 0);
      ctx.restore();
    }
  });

  // Axis lines
  ctx.strokeStyle = '#2255aa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, H - PAD.bottom);
  ctx.lineTo(W - PAD.right, H - PAD.bottom);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = '#1155aa';
  ctx.font = 'bold 11px Share Tech Mono, monospace';
  ctx.textAlign = 'center';
  if (tools.xlabel) ctx.fillText(tools.xlabel, W/2, H - 4);
  if (tools.ylabel) {
    ctx.save(); ctx.translate(13, H/2); ctx.rotate(-Math.PI/2);
    ctx.fillText(tools.ylabel, 0, 0); ctx.restore();
  }
}

/* ── CHOICES ───────────────────────────────────────────────── */

// Fisher-Yates shuffle — returns a new shuffled array, preserving originals
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Current question attempt counter (reset each time choices are rendered)
let _attemptCount = 0;
let _currentChoices = []; // shuffled choices for the current question

function renderChoices(choices) {
  const panel = document.getElementById('choices-panel');
  if (!panel) return;
  panel.innerHTML = '';
  panel.style.display = 'flex';

  _attemptCount = 0;
  _currentChoices = shuffleArray(choices); // shuffle once per question

  _currentChoices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-key">${i+1}</span> ${choice.text}`;
    btn.addEventListener('click', () => selectChoice(i));
    panel.appendChild(btn);
  });
}

function selectChoice(idx) {
  const choices = _currentChoices;
  const choice   = choices[idx];
  const isCorrect = choice.correct;

  _attemptCount++;

  const buttons = document.getElementById('choices-panel').querySelectorAll('.choice-btn');

  if (isCorrect) {
    // ── Correct answer ──────────────────────────────────────
    buttons.forEach(b => b.disabled = true);
    buttons[idx].classList.add('correct');
    playSFX('correct');

    // XP halves with each additional attempt: full → ½ → ¼ → …
    if (choice.xp) {
      const earned = Math.max(1, Math.round(choice.xp / Math.pow(2, _attemptCount - 1)));
      awardXP(earned);
      // Annotate feedback with reduced-XP notice when not first try
      choice._earnedXP = earned;
    }
    if (choice.casefile) appendCasefile(choice.casefile);

    const fb = document.getElementById('feedback-panel');
    if (fb) {
      fb.className = 'pixel-box';
      fb.style.display = 'block';
      let xpNote = '';
      if (choice.xp && _attemptCount > 1) {
        xpNote = ` <span style="font-size:11px;color:var(--yellow);">(+${choice._earnedXP} XP — reduced for ${_attemptCount > 2 ? 'multiple' : 'second'} try)</span>`;
      }
      fb.innerHTML = `<div id="feedback-text">${choice.feedback || '✓ Correct!'}${xpNote}</div>
        <button class="continue-btn" onclick="handleContinue()">CONTINUE</button>`;
    }

    if (choice.next) {
      const idx2 = currentNodes.findIndex(n => n.label === choice.next);
      if (idx2 !== -1) {
        STATE.pendingFeedbackNext = () => { STATE.nodeIndex = idx2; advanceNode(); };
        return;
      }
    }
    STATE.pendingFeedbackNext = () => advanceNode();

  } else {
    // ── Wrong answer — show feedback, then let them try again ─
    buttons[idx].classList.add('wrong');
    buttons[idx].disabled = true;  // disable only the wrong button
    playSFX('wrong');

    const remaining = Array.from(buttons).filter(b => !b.disabled).length;

    const fb = document.getElementById('feedback-panel');
    if (fb) {
      fb.className = 'pixel-box wrong';
      fb.style.display = 'block';
      const retryNote = remaining > 0
        ? `<div style="margin-top:8px;font-family:var(--font-pixel);font-size:7px;color:var(--yellow);">TRY AGAIN — correct answer earns ${Math.round(100 / Math.pow(2, _attemptCount))}% of full XP</div>`
        : '';
      fb.innerHTML = `<div id="feedback-text">${choice.feedback || '✗ Not quite — review the options and try again.'}</div>${retryNote}`;
      // No CONTINUE button on wrong — player clicks another answer or (if last wrong) we auto-advance
      if (remaining === 0) {
        // All wrong choices exhausted — reveal correct and move on
        buttons.forEach((b, bi) => {
          if (choices[bi] && choices[bi].correct) b.classList.add('correct');
        });
        fb.innerHTML += `<button class="continue-btn" onclick="handleContinue()">CONTINUE</button>`;
        STATE.pendingFeedbackNext = () => advanceNode();
      }
    }
  }
}

/* ── CONTINUE HANDLER ──────────────────────────────────────── */
function handleContinue() {
  const fb = document.getElementById('feedback-panel');
  if (fb) fb.style.display = 'none';

  if (STATE.pendingFeedbackNext) {
    const fn = STATE.pendingFeedbackNext;
    STATE.pendingFeedbackNext = null;
    fn();
    return;
  }
  advanceNode();
}

/* ── COMPLETE CASE ─────────────────────────────────────────── */
function completeCase() {
  if (!STATE.casesCompleted.includes(STATE.currentCase)) {
    STATE.casesCompleted.push(STATE.currentCase);
  }

  const xpMap = { buffet: 150, pruno: 150, legionnaires: 250, measles: 400 };
  const bonus = xpMap[STATE.currentCase] || 100;
  const ranked = awardXP(bonus);

  if (ranked) {
    showRankUp();
  } else {
    showOutbreakSelect();
  }
}

function showRankUp() {
  const rank = RANKS[STATE.rank];
  document.getElementById('rankup-title').textContent = 'RANK UP!';
  document.getElementById('rankup-rank').textContent  = rank.name;
  document.getElementById('rankup-msg').textContent   = rank.msg;
  showScreen('rankup-screen');
  STATE.screen = 'rankup';
  playSFX('rankup');
}

function resetGame() {
  STATE.screen = 'select';
  STATE.currentCase = null;
  STATE.nodeIndex = 0;
  STATE.score = 0; STATE.xp = 0;
  STATE.casesCompleted = [];
  STATE.rank = 0;
  STATE.casefileText = '';
  STATE.pendingFeedbackNext = null;
  updateHUD();
  showOutbreakSelect();
}

/* ── KEYBOARD HANDLER ──────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const key = e.key;

  if (STATE.screen === 'select') {
    const MAP = { '1':'buffet', '2':'pruno', '3':'legionnaires', '4':'measles' };
    if (MAP[key]) { e.preventDefault(); tryStartCase(MAP[key]); }
    return;
  }

  if (STATE.screen === 'rankup') {
    if (key === 'Enter' || key === ' ') { e.preventDefault(); showOutbreakSelect(); }
    return;
  }
  if (STATE.screen === 'victory') {
    if (key === 'Enter' || key === ' ') { e.preventDefault(); resetGame(); }
    return;
  }

  if (STATE.screen === 'game') {
    if (key === 'Enter' || key === ' ') {
      /* Only fire Enter/Space if the notes textarea is NOT focused */
      const active = document.activeElement;
      const inTextarea = active && active.tagName === 'TEXTAREA';
      if (!inTextarea) {
        e.preventDefault();
        const promptEl = document.getElementById('continue-prompt');
        if (promptEl && promptEl.style.display !== 'none') {
          handleContinue();
        }
      }
      return;
    }
    /* Number keys 1-4 and panel shortcuts (N/R/D) are intentionally removed.
       Panels are opened via the toolbar buttons only.
       Answer choices are selected by clicking/tapping buttons only.
       This prevents accidental answer submission or panel toggling while typing notes. */
  }
});

/* ── LEGACY COMPAT ──────────────────────────────────────────── */
function startCase(id) { tryStartCase(id); }

/* ── WINDOW LOAD ───────────────────────────────────────────── */
window.addEventListener('load', () => {
  updateHUD();
  showOutbreakSelect();   // skip title — go straight to case select

  document.getElementById('rankup-continue-btn').addEventListener('click', () => {
    playSFX('click');
    showOutbreakSelect();
  });
  document.getElementById('victory-restart-btn').addEventListener('click', () => {
    playSFX('click');
    resetGame();
  });
});

/* ============================================================
   CASE DATA
   ============================================================ */

/* ── CASE 1: THE BANQUET INCIDENT (Foodborne, Easy) ─────────── */
const CASE_BUFFET = [
  {
    speaker: 'DISPATCH',
    scene: 'buffet',
    text: `OUTBREAK ALERT — Tuesday, 11:43 AM\n\nThe Riverside Convention Center is reporting 22 ill attendees from a corporate luncheon held this morning. The reports describe sudden-onset nausea, vomiting, and diarrhea beginning 2–4 hours after the meal.\n\nYou have been assigned as lead investigator. Report to the scene.`,
    casefile: 'CASE OPENED: Mass illness event, Riverside Convention Center. 22 reports, 2–4 h onset.',
  },
  {
    speaker: 'EVENT COORDINATOR — MS. REYES',
    scene: 'buffet',
    text: `Thank goodness you're here. We had 34 attendees at the buffet luncheon. The menu included:\n\n• Chicken Caesar salad\n• Pasta salad with shrimp\n• Fruit platter\n• Bread rolls\n• Chicken marsala\n\nAll foods were prepared this morning and held in warming trays for about 2 hours before service.`,
    casefile: 'Menu: chicken Caesar salad, pasta/shrimp salad, fruit, rolls, chicken marsala. 34 total attendees.',
  },

  /* ── CHAPTER: CLINICAL PRESENTATION ── */
  {
    speaker: 'EMERGENCY DEPARTMENT — DR. PATEL',
    scene: 'buffet',
    boxStyle: 'pixel-box-yellow',
    text: `We've received 14 patients so far. Here's what we're seeing:\n\nSigns and symptoms (most to least common):\n• Diarrhea (watery, non-bloody) — 13/14 patients\n• Nausea — 12/14\n• Vomiting — 10/14\n• Stomach cramps — 9/14\n• Low-grade fever (< 38.5°C / 101.3°F) — 4/14\n\nOnset: 2–4 hours after the meal. Most patients are already improving. No one is critically ill.`,
    casefile: 'Clinical: diarrhea, nausea, vomiting, cramps. Short onset (2–4 h). Mild/self-limited.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Before running the lab work, use the clinical picture to narrow down the likely pathogen. Which of the following agents best matches this presentation: rapid onset (2–4 hours), vomiting and diarrhea, mild or no fever, and likely related to a catered meal?`,
    choices: [
      {
        text: 'Staphylococcus aureus or another toxin-producing organism — short incubation and prominent vomiting point to a preformed toxin',
        correct: true,
        xp: 40,
        feedback: '✓ Right! A 2–4 hour onset with vomiting as a key feature strongly suggests a preformed toxin — either Staph aureus (1–6 h) or Bacillus cereus emetic form (1–6 h). Toxin-mediated illness is fast because the toxin is already in the food; there\'s no waiting for bacteria to multiply in the gut. Lab confirmation will narrow it down further.',
        casefile: 'Clinical impression: preformed toxin etiology likely (short onset, vomiting-dominant, mild fever).',
      },
      {
        text: 'Clostridium botulinum — the neurological symptoms are a giveaway',
        correct: false,
        feedback: '✗ Botulism causes descending paralysis, double vision, and difficulty swallowing — not the vomiting and diarrhea described here. The incubation period also ranges from 12 hours to 10 days, not 2–4 hours. There are no neurological symptoms in this cluster.',
      },
      {
        text: 'Hepatitis A — this matches the jaundice and liver symptoms from shellfish exposure',
        correct: false,
        feedback: '✗ Hepatitis A has an incubation period of 15–50 days and causes jaundice, dark urine, and elevated liver enzymes — not acute vomiting and diarrhea within hours. Also, no jaundice was described here. The shrimp in the pasta salad could be a concern for Hepatitis A in a different scenario, but the clinical picture here doesn\'t fit.',
      },
      {
        text: 'Legionella pneumophila — the shared food exposure and respiratory symptoms suggest Legionnaires\' disease',
        correct: false,
        feedback: '✗ Legionella causes pneumonia (severe respiratory illness) with a 2–10 day incubation period — not vomiting and diarrhea within hours of a meal. Legionella is also not foodborne; it spreads through inhaling contaminated water aerosols (cooling towers, HVAC).',
      },
    ],
  },

  /* ── CHAPTER: EPI DATA & 2×2 ── */
  {
    speaker: 'FIELD EPIDEMIOLOGIST',
    scene: 'buffet',
    text: `We've completed interviews with 30 of the 34 attendees. I'm showing the 2×2 table for the chicken Caesar salad now.\n\nStudy the table carefully — it will help you figure out which food was most likely the source.`,
    tools: {
      type: 'twobytwo',
      title: 'CHICKEN CAESAR SALAD — 2×2 TABLE',
      data: { a: 16, b: 2, c: 5, d: 7 },
      note: 'Ate the salad: 18 people total. Did NOT eat the salad: 12 people total.',
    },
    casefile: 'Food-specific attack rates calculated. Chicken Caesar salad appears highest risk.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Let's make sure you can calculate the risk ratio (RR) from this 2×2 table. The RR tells us how many times more likely people who ate the food were to get sick compared to people who didn't eat it.\n\nAttack rate in exposed   = a ÷ (a + b)\nAttack rate in unexposed = c ÷ (c + d)\nRR = Attack rate (exposed) ÷ Attack rate (unexposed)`,
    keepTools: true,
    choices: [
      {
        text: 'RR = 16/18 ÷ 5/12 = 88.9% ÷ 41.7% ≈ 2.1',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! AR(exposed) = 16 ÷ 18 = 88.9%. AR(unexposed) = 5 ÷ 12 = 41.7%. RR = 88.9 ÷ 41.7 ≈ 2.1. People who ate the Caesar salad were about 2 times more likely to get sick. That\'s a meaningful association.',
        casefile: 'RR for Caesar salad = 2.1 (exposed AR 88.9% vs. unexposed AR 41.7%).',
      },
      {
        text: 'RR = 16 ÷ 5 = 3.2 — just divide the case counts',
        correct: false,
        feedback: '✗ The RR is calculated from attack rates (proportions), not from raw counts. You must divide the number of cases by the total number of people in each exposure group first: AR(exposed) = 16 ÷ 18; AR(unexposed) = 5 ÷ 12.',
      },
      {
        text: 'RR = (16 × 7) ÷ (2 × 5) = 11.2 — that\'s the cross-product formula',
        correct: false,
        feedback: '✗ The formula (a × d) ÷ (b × c) gives you the Odds Ratio (OR), not the Risk Ratio (RR). Both are useful, but RR is the standard measure in cohort-style outbreak investigations like this one. The OR is more commonly used in case-control studies.',
      },
      {
        text: 'RR = 5/12 ÷ 16/18 = 0.47 — unexposed divided by exposed',
        correct: false,
        feedback: '✗ You\'ve calculated the inverse — unexposed ÷ exposed. The RR should always be AR(exposed) ÷ AR(unexposed) so that an RR > 1 means exposure increases risk. Your answer (0.47) would mean the exposed group was actually protected, which is the opposite of what we observe.',
      },
    ],
  },
  {
    speaker: 'ENVIRONMENTAL HEALTH',
    scene: 'buffet_kitchen',
    text: `We inspected the kitchen. The Caesar salad dressing was made on-site using raw eggs. The temperature log shows the fully dressed salad sat at room temperature for nearly 3 hours before service — well above the safe 2-hour limit.\n\nStool samples from 3 ill attendees have been sent to the state lab.`,
    casefile: 'Kitchen inspection: raw-egg Caesar dressing. Salad held at room temp 3 h. Samples sent to state lab.',
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'lab',
    text: `Lab results are back.\n\nStool cultures: POSITIVE for Salmonella Enteritidis in 2 of 3 samples.\n\nSalmonella Enteritidis is commonly linked to raw eggs and poultry. Its incubation period is 6–72 hours — consistent with the 2–4 hour onset in this cluster.`,
    tools: {
      type: 'table',
      title: 'ATTACK RATES BY FOOD ITEM',
      headers: ['Food Item','Ate — Ill','Ate — Well','Did Not Eat — Ill','Did Not Eat — Well','AR (Exposed)','AR (Unexposed)','RR'],
      rows: [
        ['Caesar Salad','16','2','5','7','88.9%','41.7%','2.1'],
        ['Pasta/Shrimp','10','8','11','1','55.6%','91.7%','0.6'],
        ['Fruit Platter','8','9','13','0','47.1%','100%','0.5'],
        ['Chicken Marsala','9','8','12','1','52.9%','92.3%','0.6'],
        ['Bread Rolls','7','9','14','0','43.8%','100%','0.4'],
      ],
    },
    casefile: 'LAB CONFIRMED: Salmonella Enteritidis in 2/3 stool samples. Caesar salad highest RR = 2.1.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Now look at the epidemic curve — the timing of symptom onset for all 26 cases. What type of outbreak pattern does this represent?`,
    tools: {
      type: 'epicurve',
      title: 'EPI CURVE — RIVERSIDE LUNCHEON (hour of symptom onset)',
      bars: [
        {label:'10 AM',count:0},{label:'11 AM',count:0},{label:'12 PM',count:1},
        {label:'1 PM',count:3},{label:'2 PM',count:8,highlight:true},{label:'3 PM',count:7,highlight:true},
        {label:'4 PM',count:4},{label:'5 PM',count:2},{label:'6 PM',count:1},
        {label:'7 PM',count:0},
      ],
      xlabel: 'Hour of Symptom Onset',
      ylabel: 'Cases',
    },
    casefile: 'Epi curve: peak at 2–4 PM, 2–4 h after noon meal. Classic point-source shape.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    keepTools: true,
    text: `The epi curve shows cases tightly clustered 2–4 hours after the noon meal, with a single sharp peak. What does this pattern tell you about the outbreak?`,
    choices: [
      {
        text: 'Point-source outbreak — everyone was exposed to the same contaminated food at one time and place',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! The single sharp peak with all cases occurring within approximately one incubation period is the classic shape of a point-source outbreak. All cases shared a common exposure at one event (the buffet). There is no evidence of person-to-person spread.',
        casefile: 'Epi curve pattern: point-source. Consistent with a single buffet exposure event.',
      },
      {
        text: 'Propagated outbreak — the virus is spreading from person to person in multiple waves',
        correct: false,
        feedback: '✗ A propagated outbreak would show multiple waves of cases, each wave about one incubation period apart, as each case infects new people. This curve has only one peak — the classic sign of a point-source event where everyone was exposed at the same time.',
      },
      {
        text: 'Continuous common source — people are being exposed to the contaminated food over several days',
        correct: false,
        feedback: '✗ A continuous common source produces a prolonged plateau or gradual rise and fall over multiple incubation periods. This cluster peaked and resolved entirely within a few hours of a single meal.',
      },
      {
        text: 'Mixed outbreak — an initial point-source event followed by person-to-person spread',
        correct: false,
        feedback: '✗ A mixed pattern would show an initial peak followed by a secondary rise one incubation period later. There is no secondary wave here — just a single tight cluster from one shared meal.',
      },
    ],
  },

  /* ── CHAPTER: PUBLIC HEALTH RECOMMENDATIONS ── */
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'press',
    text: `Great investigative work. Before we close this case, there is one more step that separates a good epidemiologist from an outstanding one: issuing clear, actionable public health recommendations.\n\nEffective recommendations follow a simple principle from WHO communications guidance. Start with the most important message first — your Single Overarching Communications Outcome (SOCO). Who needs to change their behavior, and exactly what change do you want to see?\n\nYou will issue two sets of recommendations: one to the Convention Center management, and one to the public.`,
    casefile: 'Step: Issuing public health recommendations to facility and public.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Your SOCO for the Convention Center is: "Management immediately implements safe food-handling practices so that no future attendees become ill from a preventable foodborne illness."\n\nWhich recommendation to the Convention Center is MOST critical to prevent a repeat outbreak?`,
    choices: [
      {
        text: 'Eliminate the use of raw eggs in dressings served to large groups, and require all perishable foods to stay at safe temperatures (below 40°F / 4°C or above 140°F / 60°C) — never left in the temperature danger zone for more than 2 hours',
        correct: true,
        xp: 40,
        feedback: '✓ Right. This recommendation directly addresses the two contributing factors you identified: the raw-egg dressing (source of Salmonella) and improper temperature control (the environment that allowed bacteria to multiply). Good public health recommendations are specific, actionable, and linked directly to the evidence — consistent with the WHO principle of "Clarify the message" and "Call to action." A recommendation without a clear action step is just commentary.',
        casefile: 'Rec to facility: no raw eggs in large-group foods; maintain temperature control (below 40°F or above 140°F); max 2 hours in danger zone.',
      },
      {
        text: 'Hire a new catering company — the current caterers are clearly incompetent and should not be trusted with food safety',
        correct: false,
        feedback: '✗ Blaming individuals without addressing the system is neither evidence-based nor effective. Public health recommendations should target the conditions that allowed the outbreak — temperature control failure and use of raw eggs — not assign blame. A new catering company with the same practices would have the same outcome.',
      },
      {
        text: 'Post a notice saying "Eat at your own risk" at the buffet entrance so guests are warned',
        correct: false,
        feedback: '✗ This shifts the burden entirely onto guests and does nothing to reduce the hazard. Effective public health communication — per WHO guidance — must communicate a benefit and include a real call to action that prevents harm. A warning sign without a control measure fails both criteria.',
      },
      {
        text: 'Cancel all future buffet-style events indefinitely',
        correct: false,
        feedback: '✗ This is disproportionate. The outbreak was caused by specific, correctable food-handling failures — not by the concept of buffet service. Recommendations should be targeted and realistic. An overly broad recommendation will not be followed and damages trust with the facility.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Now for the public communication. Your SOCO for the public is: "Attendees who are still symptomatic seek appropriate care, and the broader community understands what safe food handling looks like so they can protect themselves at home and at events."\n\nWhich element is MOST important to include in a public statement about this outbreak?`,
    choices: [
      {
        text: 'A clear call to action: symptomatic attendees should seek care if symptoms persist beyond 72 hours, and everyone should know the temperature danger zone (40°F–140°F / 4°C–60°C) for home food safety',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. WHO\'s 7 Cs of public health communication require a "Call to action" — all public health communications MUST include a verb and a specific step the audience can take. Telling people exactly when to see a doctor AND giving them a practical takeaway for their own kitchens addresses both the immediate situation and the longer-term goal. It also "Communicates a benefit" (protecting yourself and your family) and "Caters to both HEART and HEAD" — acknowledging worry while providing factual guidance.',
        casefile: 'Public rec: seek care if symptoms persist >72h; temperature danger zone 40–140°F; avoid raw eggs in high-risk populations.',
      },
      {
        text: 'Name the Convention Center and caterer in a press release so the public can decide whether to patronize them in the future',
        correct: false,
        feedback: '✗ Publicly naming facilities before corrective action is taken can destroy a business without improving safety — and may expose the health department to legal liability. WHO guidance emphasizes "Creating trust" through transparent, evidence-based communication. Naming and shaming without actionable guidance is not the same as transparency.',
      },
      {
        text: 'Reassure the public that all salmonellosis cases resolve on their own and no medical attention is ever needed',
        correct: false,
        feedback: '✗ This is medically inaccurate and potentially dangerous. While most healthy adults recover without treatment, Salmonella can cause serious complications (bacteremia, sepsis) in infants, the elderly, and immunocompromised individuals. Effective public health communications must be accurate and acknowledge risk — especially for vulnerable populations.',
      },
      {
        text: 'Advise everyone to completely avoid eating out for the next 30 days',
        correct: false,
        feedback: '✗ This is disproportionate and inconsistent with the evidence. The outbreak was linked to a single event and a specific set of food-handling failures — not to eating out in general. WHO guidance stresses "Consistency counts": advice must be proportionate to the risk and supported by evidence. Disproportionate advice erodes public trust.',
      },
    ],
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    scene: 'press',
    text: `Outstanding work, Detective. You correctly identified:\n\n• The most likely vehicle (Caesar salad with raw-egg dressing)\n• The causative agent (Salmonella Enteritidis)\n• The contributing factor (improper temperature control)\n• The outbreak pattern (point-source)\n\nRecommendations have been issued to the Convention Center. Case closed.`,
    xp: 150,
    casefile: 'CASE 1 CLOSED. Vehicle: Caesar salad. Agent: Salmonella Enteritidis. Point-source. Recommendations issued.',
  },
];

/* ── CASE 2: THE PRUNO INCIDENT (Botulism, Easy) ─────────────
   Based on:
   • MMWR 2012;61:782–4 (Utah 2011)
   • MMWR 2017;65:1491–2 (Mississippi 2016)
   • Yasmin et al., J Correct Health Care 2015;21:327–334 (Arizona 2012)
   ─────────────────────────────────────────────────────────── */
const CASE_PRUNO = [
  {
    speaker: 'DISPATCH',
    scene: 'pruno_prison',
    text: `OUTBREAK ALERT — Thursday, 8:22 AM\n\nThe State Correctional Facility is reporting 5 inmates with a sudden, serious neurological illness — double vision, difficulty swallowing, progressive weakness, and trouble breathing. All five are in the same maximum-security housing unit (Pod B).\n\nYou have been dispatched. Activate the botulism protocol.`,
    casefile: 'CASE OPENED: Acute neurological illness, 5 inmates, state correctional facility, Pod B. Botulism protocol activated.',
  },

  /* ── CHAPTER: CLINICAL PRESENTATION ── */
  {
    speaker: 'PRISON MEDICAL OFFICER — DR. VASQUEZ',
    scene: 'pruno_inmates_sick',
    boxStyle: 'pixel-box-yellow',
    text: `We have 5 symptomatic inmates, all in Pod B. Here is what they're presenting with:\n\nSigns and symptoms (all 5 patients):\n• Double or blurred vision (diplopia) — 5/5\n• Drooping eyelids (ptosis) — 5/5\n• Slurred speech (dysarthria) — 4/5\n• Difficulty swallowing (dysphagia) — 4/5\n• Progressive weakness starting in the face/neck and moving downward — 5/5\n• NO fever in any patient\n\nThree are deteriorating rapidly. We suspect botulism.`,
    casefile: 'Symptoms: diplopia, ptosis, dysarthria, dysphagia, descending weakness, NO fever. Pod B. Onset 12–36 h.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `The clinical picture points strongly toward botulism. Which feature best distinguishes foodborne botulism from other neurological emergencies like meningitis or Guillain-Barré syndrome?`,
    choices: [
      {
        text: 'Descending (top-down) flaccid paralysis starting in cranial nerves, WITH NO FEVER — botulism characteristically starts at the head and moves downward',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! The classic triad of botulism is: (1) descending flaccid paralysis starting with cranial nerve palsies (diplopia, ptosis, dysphagia), (2) absence of fever (botulism is a toxin — not an active infection), and (3) an alert, oriented patient despite severe motor weakness. Meningitis causes fever and neck stiffness. Guillain-Barré usually ascends (starts in the legs) and follows a respiratory infection.',
        casefile: 'Clinical: descending flaccid paralysis + cranial nerve palsies + NO fever = classic foodborne botulism.',
      },
      {
        text: 'High fever (above 39°C) and neck stiffness — these are the hallmarks of botulism in adults',
        correct: false,
        feedback: '✗ High fever and neck stiffness are hallmarks of bacterial meningitis, not botulism. Botulism is caused by a toxin (not a live bacterial infection in the body), so there is characteristically NO fever. This is one of the key distinguishing features.',
      },
      {
        text: 'Ascending weakness starting in the legs — typical of botulism spreading upward',
        correct: false,
        feedback: '✗ Ascending weakness (starting in the legs and moving upward) is the hallmark of Guillain-Barré syndrome, not botulism. Botulism moves in the OPPOSITE direction — descending from the cranial nerves (affecting vision and swallowing first) down to the limbs and respiratory muscles.',
      },
      {
        text: 'Severe bloody diarrhea and abdominal pain — the gastrointestinal symptoms are what set botulism apart',
        correct: false,
        feedback: '✗ Bloody diarrhea and abdominal pain suggest an intestinal infection (like Shigella or E. coli O157:H7), not botulism. While some botulism patients have mild constipation or nausea early on, the defining feature is the neurological paralysis — not GI bleeding.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Three patients are showing signs of respiratory compromise. What is the most critical immediate action for a botulism patient who is having trouble breathing?`,
    choices: [
      {
        text: 'Secure the airway and prepare for mechanical ventilation — respiratory muscle paralysis is the primary cause of death in botulism',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! Respiratory failure from paralysis of the breathing muscles is the main cause of death in botulism. Securing the airway and supporting breathing (mechanical ventilation if needed) is the top priority. The specific treatment — Heptavalent Botulinum Antitoxin (HBAT) — must be requested from the CDC Strategic National Stockpile and given as soon as possible.',
        casefile: 'Priority: airway management and mechanical ventilation. HBAT requested from CDC Strategic National Stockpile.',
      },
      {
        text: 'Start broad-spectrum antibiotics right away to kill the bacteria',
        correct: false,
        feedback: '✗ Antibiotics are not the treatment for foodborne botulism because the illness is caused by a preformed toxin (not an active bacterial infection in the body). Antibiotics do not neutralize the toxin that is already blocking nerve signals. The correct treatment is HBAT (antitoxin) plus supportive care.',
      },
      {
        text: 'Isolate all patients immediately — botulism is extremely contagious between people',
        correct: false,
        feedback: '✗ Foodborne botulism is NOT contagious from person to person. Patients got sick from eating the same toxin-containing food, not from each other. Standard isolation is not needed. The priority is respiratory support.',
      },
      {
        text: 'Perform a lumbar puncture (spinal tap) to rule out bacterial meningitis first',
        correct: false,
        feedback: '✗ The clinical picture here — descending flaccid paralysis, cranial nerve palsies, and NO fever — is classic for botulism, not meningitis. Meningitis causes fever, neck stiffness (nuchal rigidity), and headache. In a patient with botulism who is losing the ability to breathe, securing the airway takes priority over diagnostic testing.',
      },
    ],
  },

  /* ── CHAPTER: EPIDEMIOLOGIC INVESTIGATION ── */
  {
    speaker: 'FIELD EPIDEMIOLOGIST',
    scene: 'pruno_interviews',
    text: `We interviewed all 5 ill inmates and 8 other inmates in Pod B who were not sick. All 5 ill inmates reported drinking "pruno" — a homemade alcoholic drink made in a plastic bag — on November 23. None of the 8 well inmates drank it.\n\nThe pruno was reportedly made with oranges, sugar, bread, water, and a baked potato that was saved from a meal tray about 3 weeks earlier.`,
    casefile: 'All 5 ill inmates drank pruno on Nov 23. 0 of 8 well inmates drank pruno. Potato is key suspect ingredient.',
    tools: {
      type: 'twobytwo',
      title: 'PRUNO CONSUMPTION — 2×2 TABLE (Pod B)',
      data: { a: 5, b: 0, c: 0, d: 8 },
      note: 'Drank pruno: 5 ill, 0 well. Did NOT drink pruno: 0 ill, 8 well. Attack rate among exposed = 100%.',
    },
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    keepTools: true,
    text: `The data show a 100% attack rate among those who drank pruno and 0% among those who didn't. What is the most accurate way to describe the strength of this epidemiologic finding, and what are its limits?`,
    choices: [
      {
        text: 'The risk ratio (RR) is mathematically undefined (because you can\'t divide by zero), but the perfect separation — 100% ill among exposed, 0% ill among unexposed — is the strongest possible epidemiologic signal linking pruno to the illness',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! When the attack rate in the unexposed group is 0%, the RR formula (AR exposed ÷ AR unexposed) requires dividing by zero, which is undefined. But perfect separation like this is actually very compelling — it is hard to imagine a more complete association. Combined with laboratory confirmation and biological plausibility, this is strong evidence.',
        casefile: 'RR undefined (0% in unexposed). Perfect exposure-illness separation. Pruno is the vehicle.',
      },
      {
        text: 'The odds ratio (OR) is infinite, which statistically proves that pruno caused the botulism',
        correct: false,
        feedback: '✗ You\'re on the right track about the OR being infinite (a×d ÷ b×c = 5×8 ÷ 0×0 = ∞). However, no single statistic "proves" causation in epidemiology. Epidemiologic evidence establishes association and supports causal inference — but cause is established by combining statistical findings, laboratory confirmation, biological plausibility, and other criteria (Bradford Hill criteria).',
      },
      {
        text: 'A p-value less than 0.05 proves the pruno caused the illness',
        correct: false,
        feedback: '✗ Statistical significance (a low p-value) tells you how likely the association is due to chance — it does NOT prove causation. A p-value says nothing about the direction of causation, confounding, or bias. Causal inference in epidemiology requires additional criteria (temporal relationship, biological plausibility, dose-response, etc.).',
      },
      {
        text: 'With only 13 people in the study, the sample size is too small to draw any conclusions',
        correct: false,
        feedback: '✗ Small sample sizes do reduce statistical precision, but perfect separation (5/5 vs 0/8) still provides meaningful evidence — especially when supported by laboratory confirmation and a consistent pattern across multiple independent outbreaks. All confirmed prison botulism outbreaks in the US have involved pruno.',
      },
    ],
  },

  /* ── CHAPTER: LAB RESULTS ── */
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'pruno_lab',
    text: `Results from the CDC Botulism Laboratory:\n\nPatient serum (collected before antitoxin was given): POSITIVE for botulinum toxin type A in 4 of 5 specimens.\n\nConfiscated pruno sample: C. botulinum DETECTED; botulinum toxin type A CONFIRMED by both mass spectrometry and mouse bioassay.\n\nFinal diagnosis: CONFIRMED FOODBORNE BOTULISM — Type A.`,
    casefile: 'LAB CONFIRMED: Botulinum toxin type A in 4/5 patient sera and in pruno. Mass spec + mouse bioassay positive.',
    tools: {
      type: 'epicurve',
      title: 'EPI CURVE — HOURS FROM PRUNO CONSUMPTION TO SYMPTOM ONSET',
      bars: [
        {label:'< 12h',count:1},{label:'12–24h',count:1,highlight:true},{label:'24–36h',count:2,highlight:true},
        {label:'36–48h',count:1},{label:'48–60h',count:0},{label:'60–72h',count:0},
        {label:'> 72h',count:0},
      ],
      xlabel: 'Hours from Exposure to Symptom Onset',
      ylabel: 'Cases',
    },
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    keepTools: true,
    text: `The median incubation period is about 29 hours (range: under 12 to 48 hours), which matches published botulism data.\n\nWhy is a baked potato in the pruno the most likely source of C. botulinum spores?`,
    choices: [
      {
        text: 'Root vegetables like potatoes carry C. botulinum spores from soil. Inside the sealed plastic bag — anaerobic (no oxygen), warm, and low-acid — those spores germinated and produced toxin.',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! C. botulinum is a soil organism, and root vegetables commonly carry its spores on their skin. The sealed pruno bag creates the perfect conditions for toxin production: (1) no oxygen (anaerobic), (2) warm temperature, (3) low acidity from the fruit and sugar mix. Every confirmed prison botulism outbreak in the US literature has involved potatoes in the pruno recipe.',
        casefile: 'Source: potato spores + anaerobic warm pruno bag. Classic conditions for C. botulinum toxin production confirmed.',
      },
      {
        text: 'Potatoes naturally contain a botulinum precursor compound that becomes active when fermented',
        correct: false,
        feedback: '✗ Potatoes do not contain any botulinum precursor. The risk from potatoes is that their skin carries C. botulinum SPORES from soil. When those spores are placed in an anaerobic, warm, low-acid environment (like a sealed pruno bag), they germinate and produce toxin.',
      },
      {
        text: 'The plastic commissary bags used for fermentation were contaminated with the toxin',
        correct: false,
        feedback: '✗ All evidence from prison botulism outbreak investigations consistently points to the potato as the source of spores — not the bags. C. botulinum spores are widespread in soil and on the surfaces of root vegetables, making the potato the critical ingredient.',
      },
      {
        text: 'Any fermentation in an airtight plastic bag always produces botulinum toxin',
        correct: false,
        feedback: '✗ Fermentation does not always produce botulinum toxin. The key requirements are: (1) C. botulinum spores must be present, (2) the environment must be anaerobic, (3) conditions must allow germination (low acid, low sugar at the right stage, warm temperature). Most pruno batches never cause botulism — only those that include a potato (which introduces spores) under permissive conditions.',
      },
    ],
  },
  {
    speaker: 'PRISON MEDICAL OFFICER — DR. VASQUEZ',
    scene: 'pruno_antitoxin',
    text: `CDC has released the Heptavalent Botulinum Antitoxin (HBAT) from the Strategic National Stockpile. All 5 patients received it within 24 hours of hospitalization.\n\nPatient outcomes:\n• 3 patients required mechanical ventilation\n• 2 patients did not need intubation\n• All 5 survived\n\nAverage ICU stay: 4 days. Several patients had lingering weakness at follow-up.`,
    casefile: 'Treatment: HBAT given to all 5. 3 mechanically ventilated. All survived. Residual weakness at follow-up.',
    tools: {
      type: 'table',
      title: 'PATIENT OUTCOMES',
      headers: ['Patient','Intubated?','ICU Days','HBAT Given?','Outcome'],
      rows: [
        ['#1 (Index)','Yes','8','Yes','Discharged — weakness at 1 month'],
        ['#2','Yes','12','Yes','Discharged — residual double vision'],
        ['#3','Yes','5','Yes','Discharged — resolved'],
        ['#4','No','3','Yes','Discharged — resolved'],
        ['#5','No','2','Yes','Discharged — resolved'],
      ],
    },
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Three patients had prolonged illness requiring weeks of recovery. What is the biological mechanism that explains why botulism paralysis takes so long to recover from?`,
    choices: [
      {
        text: 'Botulinum toxin cuts (cleaves) SNARE proteins at the neuromuscular junction, permanently blocking the release of acetylcholine (ACh). Recovery requires the nerve to grow new terminals — a process that takes weeks to months.',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! Botulinum toxin is a zinc metalloprotease (a protein-cutting enzyme) that cleaves SNARE proteins (like VAMP/synaptobrevin). SNARE proteins are essential for the nerve terminal to release acetylcholine (ACh) into the neuromuscular junction. Without ACh release, the muscle cannot receive the signal to contract — producing flaccid (floppy) paralysis. Recovery requires axonal sprouting: the nerve must grow new synaptic terminals to replace the damaged ones, which takes weeks to months.',
        casefile: 'Mechanism: SNARE protein cleavage → ACh blockade at NMJ → descending flaccid paralysis. Recovery via axonal sprouting.',
      },
      {
        text: 'Botulinum toxin blocks sodium channels in the nerve, so action potentials cannot travel down the nerve fiber',
        correct: false,
        feedback: '✗ Blocking sodium channels (as tetrodotoxin and saxitoxin do) would stop action potentials from traveling along the nerve. Botulinum toxin acts further downstream: the action potential arrives at the nerve terminal normally, but the SNARE proteins needed to release acetylcholine have been destroyed, so no neurotransmitter is released.',
      },
      {
        text: 'Botulinum toxin works like tetanus toxin — it blocks inhibitory neurons, causing the muscles to stay permanently contracted (spastic paralysis)',
        correct: false,
        feedback: '✗ Tetanus toxin (tetanospasmin) blocks inhibitory interneurons in the spinal cord, causing spastic (rigid) paralysis. Botulinum toxin does the OPPOSITE: it blocks the release of acetylcholine at the neuromuscular junction, causing flaccid (floppy) paralysis. An easy way to remember the difference: tetanus = stiff/contracted; botulism = floppy/paralyzed.',
      },
      {
        text: 'Botulinum toxin directly destroys muscle fibers, leaving permanent scar tissue',
        correct: false,
        feedback: '✗ Botulinum toxin does not directly damage muscle tissue. The muscles themselves are intact — they simply cannot receive the signal to contract because acetylcholine release from the nerve has been blocked. This is why recovery is possible once the nerve regenerates new terminals, though it is a slow process.',
      },
    ],
  },

  /* ── CHAPTER: PUBLIC HEALTH RECOMMENDATIONS ── */
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'pruno_press',
    text: `Excellent clinical and epidemiological work. Now comes a critical — and often overlooked — part of every outbreak investigation: formulating and communicating public health recommendations.\n\nFor a prison botulism outbreak, you have two distinct audiences with very different communication needs: correctional facility administrators and the broader public health and corrections community. Using the WHO framework, always start by defining your Single Overarching Communications Outcome (SOCO): who needs to change their behavior, and what change do you want to see?`,
    casefile: 'Step: Issuing recommendations to correctional facility and public.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Your SOCO for the correctional facility is: "Facility administrators immediately implement pruno prevention and food-safety protocols so that no future inmates are harmed by this entirely preventable illness."\n\nWhich facility-level recommendation is the MOST essential?`,
    choices: [
      {
        text: 'Implement a zero-tolerance pruno suppression program: confiscate ingredients (especially potatoes and other root vegetables from meal trays), train correctional officers to recognize signs of fermentation, and report any suspected pruno immediately to the medical unit',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. Every confirmed prison botulism outbreak in the U.S. has involved pruno containing a root vegetable (almost always potato) as the C. botulinum spore source. The only reliable prevention is stopping pruno production. WHO\'s 7 Cs require a clear "Call to action" — the verb here is "confiscate, train, and report." The recommendation is specific, actionable, and directly tied to the epidemiological evidence. It also addresses the root cause rather than just the symptoms.',
        casefile: 'Rec to facility: zero-tolerance pruno suppression; confiscate root vegetables from meal trays; train officers to recognize fermentation signs; immediate medical reporting.',
      },
      {
        text: 'Punish the inmates who made the pruno with extended solitary confinement — deterrence is the most effective prevention strategy',
        correct: false,
        feedback: '✗ Punitive approaches without addressing the underlying conditions (availability of fermenting ingredients, lack of other recreational substances, overcrowding) have not been shown to prevent prison brewing. Public health approaches focus on modifying the environment — removing the means — rather than simply punishing individuals. Punishment-only strategies also fail the WHO principle of "Communicating a benefit": there is no clear benefit to the overall facility health.',
      },
      {
        text: 'Issue a memo telling inmates that pruno is dangerous and they should stop making it',
        correct: false,
        feedback: '✗ A memo without environmental intervention (removing ingredients, training staff) is unlikely to be effective. Effective public health messaging must go beyond information alone — behavior change requires modifying the environment. WHO guidance on communicating risk emphasizes that knowledge alone rarely changes behavior; structural changes are needed.',
      },
      {
        text: 'Install video cameras in all cell blocks to monitor for pruno production',
        correct: false,
        feedback: '✗ Surveillance alone does not remove the hazard. Cameras may deter some production but do not address the availability of fermenting materials. The evidence-based recommendation is to eliminate the key ingredient (root vegetables left over from meal trays) — that is the structural intervention most directly supported by the outbreak literature.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Now for the broader public communication — your audience is correctional health professionals across the country. Your SOCO: "Corrections health professionals nationwide recognize botulism from pruno as a known, preventable risk and implement evidence-based prevention protocols."\n\nWhich statement BEST reflects effective public health communication for this event?`,
    choices: [
      {
        text: 'Issue a health advisory to correctional facilities nationally: describe the clinical presentation of botulism (descending paralysis, NO fever, cranial nerve signs), explain that pruno containing root vegetables is the vehicle, and include specific prevention steps — with a clear call to action for facilities to review their food-service and contraband policies',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. This recommendation demonstrates all 7 Cs of public health communication: it Commands attention (life-threatening illness), Clarifies the message (clinical signs and vehicle), Communicates a benefit (prevent future deaths), maintains Consistency with the evidence, Caters to both HEART (inmates\' lives at stake) and HEAD (clinical facts), Creates trust (evidence-based, transparent), and includes a clear Call to action (review policies). The POINT — botulism from pruno is preventable — is stated upfront. This approach is consistent with how the CDC and state health departments reported these outbreaks in the MMWR.',
        casefile: 'Public health advisory: botulism from pruno, clinical presentation, prevention steps, policy review call to action — issued to corrections facilities nationally.',
      },
      {
        text: 'Avoid publicizing the outbreak to prevent stigmatizing the prison population',
        correct: false,
        feedback: '✗ Suppressing outbreak information prevents other facilities from taking protective action — potentially allowing future preventable deaths. WHO emphasizes that announcing a situation early and being transparent helps "Create trust" and saves lives. Concerns about stigma are legitimate but should be addressed through careful framing, not silence.',
      },
      {
        text: 'Focus all communication on the inmates\' illegal behavior — making alcohol is against prison rules and they knew the risks',
        correct: false,
        feedback: '✗ This approach fails the WHO principle of "Cater to the HEART and HEAD": it ignores the legitimate public health finding that prison conditions contribute to pruno production, and it does not serve the SOCO (protecting health). Effective public health communication is not about assigning blame — it is about preventing future harm.',
      },
      {
        text: 'Issue a press release that names the specific prison and the names of affected inmates',
        correct: false,
        feedback: '✗ Publishing patient names violates medical privacy (HIPAA in the U.S.) and ethical standards for outbreak communications. Public health reports identify facilities by type and region when necessary for public protection, but do not disclose patient identities without consent. The MMWR reports on which this case is based used anonymized data for exactly this reason.',
      },
    ],
  },
  {
    speaker: 'STATE HEALTH OFFICER',
    scene: 'pruno_press',
    text: `Excellent work, Detective. You successfully:\n\n• Identified botulism from the clinical presentation\n• Established pruno as the vehicle through epidemiologic analysis\n• Confirmed the lab findings (toxin type A in patients and in the pruno)\n• Explained the microbiology and mechanism of illness\n• Coordinated timely HBAT administration — zero deaths\n\nRecommendations have been issued to the Bureau of Prisons. Case closed.`,
    xp: 150,
    casefile: 'CASE 2 CLOSED. Foodborne botulism from pruno with baked potato. Toxin type A. All 5 patients survived. Recommendations issued.',
  },
];

/* ── CASE 3: CITY CENTER CLUSTER (Legionnaires', Medium) ────── */
const CASE_LEGIONNAIRES = [
  {
    speaker: 'DISPATCH',
    scene: 'legionnaires',
    text: `OUTBREAK ALERT — Monday, 9:15 AM\n\nThe City Health Department is reporting 7 cases of severe pneumonia in adults, all with onset in the past 2 weeks. The cases are clustered in the downtown area, and several required intensive care.\n\nThis cluster is above the expected baseline for community-acquired pneumonia. You've been assigned as lead investigator.`,
    casefile: 'CASE OPENED: 7 severe pneumonia cases, downtown cluster, past 2 weeks. Above baseline — outbreak suspected.',
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'legionnaires_lab',
    text: `Urinary antigen tests — a rapid, commonly used diagnostic — came back POSITIVE for Legionella pneumophila serogroup 1 in 6 of 7 cases. The 7th has sputum cultures pending.\n\nDiagnosis confirmed. Now we need to find the environmental source.`,
    casefile: 'LAB: 6/7 positive Legionella urinary antigen test. Serogroup 1 confirmed.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Legionella pneumophila serogroup 1 is confirmed. This organism does NOT spread from person to person. What is the most common environmental source found in Legionnaires' disease outbreak investigations?`,
    choices: [
      {
        text: 'Cooling towers and large building water systems that produce a fine water mist (aerosol) — breathing in contaminated water droplets causes infection',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! Legionella thrives in warm water (25–45°C / 77–113°F) in large plumbing systems. The bacteria become dangerous when water is aerosolized (turned into a fine mist) — for example, by a cooling tower, shower, decorative fountain, or HVAC system. Inhaling those droplets is how people get infected. It is NOT spread person to person.',
        casefile: 'Transmission: inhaled aerosolized water from cooling towers or large water systems. NOT person-to-person.',
      },
      {
        text: 'Contaminated food served at a shared meal — Legionella is a common foodborne pathogen',
        correct: false,
        feedback: '✗ Legionella is not a foodborne pathogen. It does not infect people through food. It requires inhalation of aerosolized water droplets to cause pulmonary (lung) infection.',
      },
      {
        text: 'Coughing and sneezing from infected patients — respiratory droplets spread it like the flu',
        correct: false,
        feedback: '✗ Legionnaires\' disease is not transmitted person to person through coughing or sneezing. This is a critical infection control point — cases do not need to be isolated for respiratory precautions. The source is always environmental (a contaminated water system).',
      },
      {
        text: 'Digging or disturbing contaminated soil at construction sites',
        correct: false,
        feedback: '✗ Some environmental pathogens (like Histoplasma or Coccidioides) are linked to soil or dust. Legionella is specifically a waterborne pathogen — it lives in warm water systems and is transmitted via water aerosols, not soil.',
      },
    ],
  },
  {
    speaker: 'FIELD EPIDEMIOLOGIST',
    scene: 'legionnaires_interviews',
    text: `We interviewed all 7 cases and plotted the epidemic curve. Look at how cases are distributed over the 2-week investigation period — and notice the building exposure data from interviews.`,
    tools: {
      type: 'epicurve',
      title: "EPI CURVE — LEGIONNAIRES' CLUSTER (date of symptom onset)",
      bars: [
        {label:'Jun 1',count:0},{label:'Jun 3',count:1},{label:'Jun 5',count:0},
        {label:'Jun 7',count:2,highlight:true},{label:'Jun 9',count:2,highlight:true},
        {label:'Jun 11',count:1},{label:'Jun 13',count:1},{label:'Jun 15',count:0},
      ],
      xlabel: 'Date of Symptom Onset',
      ylabel: 'Cases',
    },
    casefile: 'Epi curve: cases spread over 2 weeks with no single sharp peak — pattern suggests continuous/intermittent source.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    keepTools: true,
    text: `The epi curve shows cases spread over about 2 weeks with no single sharp peak. Legionella has an incubation period of 2–10 days. What does this pattern suggest about the type of outbreak?`,
    choices: [
      {
        text: 'Continuous or intermittent common source — people are being repeatedly exposed to the same contaminated environmental source (like a cooling tower running over several weeks)',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! Cases spread across multiple incubation periods (2–10 days for Legionella) without a single sharp peak suggests ongoing exposure from a continuously operating source — consistent with a cooling tower or large water system releasing contaminated aerosols over weeks. Compare this to Case 1\'s sharp single-day peak (point-source).',
        casefile: 'Epi curve pattern: continuous/intermittent common source. Consistent with ongoing environmental aerosol exposure.',
      },
      {
        text: 'Point-source — all exposure happened at one specific time',
        correct: false,
        feedback: '✗ A point-source outbreak produces a single sharp peak with cases clustered within approximately one incubation period. Here, cases are spread across 2 weeks — much too long for a single exposure event, given that Legionella\'s incubation period is only 2–10 days.',
      },
      {
        text: 'Propagated outbreak — cases are spreading from person to person in new generations',
        correct: false,
        feedback: '✗ Legionella does NOT spread person to person, so a propagated pattern is biologically impossible for Legionnaires\' disease. The spread-out pattern here reflects ongoing exposure to a contaminated environmental source, not secondary transmission.',
      },
    ],
  },
  {
    speaker: 'ENVIRONMENTAL HEALTH SPECIALIST',
    scene: 'legionnaires_spatial',
    text: `Spatial analysis complete. All 7 cases spent time within 400 meters of the Grand Central Hotel in the 2–10 days before their symptoms started. The hotel has a rooftop cooling tower that has not been serviced in 6 months.`,
    casefile: 'Geographic cluster: all cases within 400m of Grand Central Hotel. Cooling tower not serviced in 6 months.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Given the geographic clustering and epi curve, what is the best way to confirm the cooling tower as the outbreak source?`,
    choices: [
      {
        text: 'Collect water samples from the cooling tower and run whole-genome sequencing (WGS) to see if the environmental Legionella strain matches the patient strain',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! Environmental sampling combined with molecular typing (WGS or PFGE) is the gold standard for confirming an environmental source. If the genetic fingerprint of the Legionella isolate from the cooling tower matches the isolates from patients, that is definitive evidence they share a common source.',
        casefile: 'Plan: environmental water sampling from cooling tower + WGS molecular typing to match patient strains.',
      },
      {
        text: 'Run a randomized controlled trial (RCT) comparing people who walked near the hotel to people who stayed home',
        correct: false,
        feedback: '✗ RCTs are not ethically feasible for outbreak investigation — you cannot randomly assign people to be exposed to a potentially contaminated cooling tower. The standard approach is either an observational analytic study (cohort or case-control) plus environmental sampling with molecular typing, which provides direct evidence of the source.',
      },
      {
        text: 'Survey all downtown restaurants for a common food source that might explain the cluster',
        correct: false,
        feedback: '✗ Legionella is not a foodborne pathogen. The environmental investigation should focus on water systems — especially cooling towers, large building water systems, and decorative fountains. Food is not a plausible vehicle.',
      },
    ],
  },
  {
    speaker: 'LAB SCIENTIST',
    boxStyle: 'pixel-box-yellow',
    scene: 'legionnaires_cooling_tower',
    text: `Cooling tower water sample results: POSITIVE for Legionella pneumophila, serogroup 1.\n\nConcentration: 48,000 CFU per milliliter (very high — well above safety thresholds)\n\nMolecular typing (WGS): Identical genetic fingerprint to the patient isolates.\n\nSOURCE CONFIRMED.`,
    xp: 50,
    casefile: 'ENVIRONMENTAL MATCH: Cooling tower L. pneumophila sg1 positive. 48,000 CFU/mL. WGS matches all patient isolates.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `The cooling tower is confirmed as the source. What is the most appropriate immediate control measure?`,
    choices: [
      {
        text: 'Shut down the cooling tower and perform hyperchlorination (shock disinfection), then put a Water Management Plan in place for long-term monitoring and control',
        correct: true,
        xp: 40,
        feedback: '✓ Correct! The cooling tower must be shut down immediately and hyperchlorinated (treated with high-dose chlorine) to eliminate the Legionella. Long-term control requires a formal Water Management Plan (WMP), consistent with ASHRAE Standard 188, which includes regular water testing, biocide treatment, and physical cleaning.',
        casefile: 'Control: cooling tower shut down; hyperchlorination started; Water Management Plan required.',
      },
      {
        text: 'Issue a "boil water advisory" to residents and businesses near the hotel',
        correct: false,
        feedback: '✗ Boil water advisories apply to drinking water contamination. Legionnaires\' disease is caused by inhaling aerosolized water droplets — not by drinking contaminated water. The cooling tower (the source of the aerosols) must be shut down and disinfected.',
      },
      {
        text: 'Permanently close the hotel and demolish the cooling tower',
        correct: false,
        feedback: '✗ Permanent closure is not necessary and not a proportionate response. Proper remediation — shutdown, hyperchlorination, and an ongoing Water Management Plan — is the appropriate evidence-based intervention that allows the facility to safely resume operations.',
      },
    ],
  },

  /* ── CHAPTER: PUBLIC HEALTH RECOMMENDATIONS ── */
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'legionnaires_press',
    text: `Before we close this case, you need to issue formal public health recommendations. Legionnaires' disease outbreaks are particularly challenging to communicate about because the source is environmental — not a visible behavior like unsafe food handling — and because the disease has a name that can cause confusion or alarm.\n\nUsing the WHO communications framework: start with your SOCO. You have two audiences with different needs — the hotel management and the general public near the affected area. Who needs to change what, and how quickly?`,
    casefile: 'Step: Issuing public health recommendations — hotel management and public communication.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Your SOCO for the hotel: "Management immediately remediates the contaminated cooling tower and establishes permanent water safety protocols so that no future guests, employees, or community members are exposed to Legionella."\n\nWhich recommendation to the Grand Central Hotel is the most important?`,
    choices: [
      {
        text: 'Shut down the cooling tower immediately, complete the hyperchlorination protocol, and implement a written Water Management Plan (WMP) that includes regular Legionella testing, biocide treatment schedules, and physical cleaning — consistent with ASHRAE Standard 188',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. A Water Management Plan (WMP) is not optional after a confirmed Legionella outbreak — it is the standard of care and is required under ASHRAE 188 and recommended by the CDC. The recommendation addresses all three components: immediate control (shut down and hyperchlorinate), confirmation (re-test before restart), and long-term prevention (WMP with scheduled monitoring). This is specific, actionable, evidence-based, and includes a clear call to action — the core of WHO\'s 7 Cs framework.',
        casefile: 'Rec to hotel: WMP required per ASHRAE 188; cooling tower shutdown; hyperchlorination; Legionella testing before restart; scheduled monitoring.',
      },
      {
        text: 'Replace all the water in the building\'s plumbing system with bottled water for the next 30 days',
        correct: false,
        feedback: '✗ This misunderstands the transmission route. Legionnaires\' disease is caused by inhaling aerosolized water droplets — not by drinking water. Replacing drinking water does nothing to address the cooling tower aerosol source. Recommendations must be directly linked to the confirmed transmission mechanism.',
      },
      {
        text: 'Permanently close the hotel — the liability risk is too high to reopen',
        correct: false,
        feedback: '✗ Permanent closure is disproportionate and not supported by evidence. With proper remediation — hyperchlorination, re-testing, and a Water Management Plan — the facility can safely resume operations. WHO guidance stresses that recommendations must be realistic and achievable to be followed. An overly punitive recommendation will not be implemented and damages the relationship needed to protect public health.',
      },
      {
        text: 'Notify hotel guests to take antibiotics prophylactically to prevent Legionnaires\' disease',
        correct: false,
        feedback: '✗ Antibiotic prophylaxis is not recommended for Legionnaires\' disease. People who were exposed but are not symptomatic do not need treatment — the incubation period is 2–10 days, and most exposed individuals will not develop illness. The correct guidance for potentially exposed persons is: watch for symptoms (fever, cough, shortness of breath) and seek care promptly if they develop.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Now for public communication. Your SOCO for the public: "Community members who may have been exposed understand what symptoms to watch for, when to seek care, and that the source has been controlled — so they can protect themselves without unnecessary panic."\n\nLegionella outbreaks are frequently misunderstood by the public. Which approach best reflects WHO principles of risk communication?`,
    choices: [
      {
        text: 'Be transparent and timely: announce early that an investigation is underway, confirm the source once identified, explain that the cooling tower has been shut down and treated, describe the symptoms to watch for, and advise exposed individuals when to seek medical care — all in plain, non-alarming language',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. WHO\'s risk communication principles emphasize announcing early, being transparent, and providing actionable guidance. This response addresses all 7 Cs: it Commands attention (confirmed Legionella cluster), Clarifies the message (symptoms, exposure, control measures), Communicates a benefit (know when to get care, source is now controlled), maintains Consistency with the evidence, Caters to both HEART (acknowledges community concern) and HEAD (factual, proportionate), Creates trust (transparent, early announcement), and includes a clear Call to action (watch for symptoms, seek care if feverish and short of breath). Announcing early and often — even before all facts are known — builds more trust than waiting for a complete picture.',
        casefile: 'Public communication: early announcement, source confirmed and controlled, symptom watch-and-report guidance, plain language.',
      },
      {
        text: 'Wait until the full investigation is complete before making any public statement — releasing incomplete information causes unnecessary panic',
        correct: false,
        feedback: '✗ Delaying communication is one of the most common — and damaging — public health communication mistakes. WHO guidance is explicit: announcing a situation early builds trust, while silence erodes it. Community members who find out through other channels (social media, news) before the health department speaks will distrust all subsequent official communications. "We are investigating and will update you" is always better than silence.',
      },
      {
        text: 'Avoid using the word "Legionella" in public communications — it sounds frightening and will cause a media firestorm',
        correct: false,
        feedback: '✗ Avoiding accurate terminology undermines credibility. If the media or community later learn that officials withheld the diagnosis, trust collapses entirely. WHO guidance emphasizes "Create trust" through transparency. Using correct terms — paired with clear, calm explanations of what they mean — is far more effective than euphemisms.',
      },
      {
        text: 'Advise all residents within one mile of the hotel to evacuate until the outbreak is declared over',
        correct: false,
        feedback: '✗ This is disproportionate to the actual risk. With the cooling tower shut down, the aerosol exposure route is eliminated. Mass evacuation would cause significant community disruption without any meaningful additional health benefit. Effective public health recommendations must be proportionate — calibrated to the actual risk — as well as specific and actionable.',
      },
    ],
  },
  {
    speaker: 'HEALTH DIRECTOR',
    boxStyle: 'pixel-box-cyan',
    scene: 'legionnaires_press',
    text: `Excellent investigation, Detective. You identified the source, guided the environmental sampling strategy, applied the correct epidemiologic study design thinking, and helped stop the outbreak.\n\nYour rank advancement reflects the growing depth of your skills.`,
    xp: 250,
    casefile: 'CASE 3 CLOSED: Cooling tower source confirmed via WGS. Hyperchlorination complete. 0 new cases after remediation.',
  },
];

/* ── CASE 4: THE VACCINE HESITANCY CRISIS (Measles, Hard) ───── */
const CASE_MEASLES = [
  {
    speaker: 'DISPATCH',
    scene: 'measles',
    text: `OUTBREAK ALERT — Friday, 2:00 PM\n\nRiverside Elementary School has reported 3 confirmed measles cases in a single classroom. All three developed a rash and fever in the same week.\n\nThis is a public health emergency. Measles is one of the most contagious diseases known. You have been dispatched.`,
    casefile: 'CASE OPENED: 3 confirmed measles cases, Riverside Elementary School, same classroom, same week.',
  },
  {
    speaker: 'SCHOOL NURSE',
    scene: 'measles_nurse_records',
    text: `We've pulled vaccination records for all 340 students:\n• 245 fully vaccinated (2 doses of MMR)\n• 48 unvaccinated (parental exemption)\n• 31 vaccinated with only 1 dose of MMR\n• 16 with unknown vaccination status\n\nAmong the 12 confirmed cases: 9 are unvaccinated, 2 received only 1 dose of MMR, and 1 has unknown status.`,
    casefile: 'Vaccination: 245 two-dose MMR, 48 unvax, 31 one-dose, 16 unknown. Cases: 9 unvax, 2 one-dose, 1 unknown.',
    tools: {
      type: 'table',
      title: 'MEASLES ATTACK RATES BY VACCINATION STATUS',
      headers: ['Vaccination Status','Students','Cases','Attack Rate'],
      rows: [
        ['Unvaccinated','48','9','18.75%'],
        ['1-dose MMR','31','2','6.45%'],
        ['2-dose MMR (fully vaccinated)','245','0','0.00%'],
        ['Unknown','16','1','6.25%'],
      ],
    },
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'measles_vaccine_efficacy',
    text: `Look at the vaccine efficacy data. Calculate the vaccine efficacy (VE) for 2-dose MMR using the standard formula:\n\nVE = (ARu − ARv) ÷ ARu × 100%\n\nWhere ARu = attack rate in unvaccinated students\n      ARv = attack rate in vaccinated students`,
    keepTools: true,
    choices: [
      {
        text: 'VE = (18.75% − 0%) ÷ 18.75% × 100% = 100%',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! VE = (18.75 − 0) ÷ 18.75 × 100% = 100%. This is consistent with published data showing 2-dose MMR has about 97% efficacy. Zero cases among 245 fully vaccinated students is exactly what we expect from a highly effective vaccine.',
        casefile: 'VE (2-dose MMR) = 100% in this outbreak. Consistent with published ~97% efficacy.',
      },
      {
        text: 'VE = 245 ÷ 340 × 100% = 72% — the proportion of students who are vaccinated',
        correct: false,
        feedback: '✗ 72% is the vaccination coverage rate — the proportion of the school population that is vaccinated. Vaccine efficacy (VE) is different: it measures how well the vaccine prevents disease by comparing attack rates in vaccinated vs. unvaccinated groups.',
      },
      {
        text: 'VE = 9 ÷ 48 = 18.75% — that\'s just the attack rate in unvaccinated students',
        correct: false,
        feedback: '✗ 18.75% is the attack rate in the unvaccinated group — one input in the VE formula — but it is not the vaccine efficacy itself. VE compares the attack rate in vaccinated students to the attack rate in unvaccinated students: VE = (ARu − ARv) ÷ ARu × 100%.',
      },
      {
        text: 'VE cannot be calculated when zero vaccinated students got sick',
        correct: false,
        feedback: '✗ Zero cases in the vaccinated group is actually a valid result and gives a VE of 100%. VE = (18.75% − 0%) ÷ 18.75% = 100%. Having zero cases in the vaccinated group is the ideal outcome — it means the vaccine prevented every single case in that group.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Measles has one of the highest basic reproduction numbers (R₀) of any known infectious disease. The R₀ is the average number of new cases a single case generates in a population with no immunity.\n\nIf measles R₀ = 15, what is the herd immunity threshold (HIT) — the minimum proportion of the population that must be immune to prevent sustained spread?`,
    choices: [
      {
        text: 'HIT = 1 − (1 ÷ R₀) = 1 − (1 ÷ 15) = 93.3%',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! HIT = 1 − (1/R₀) = 1 − (1/15) = 0.933 = 93.3%. At least 93.3% of the population needs to be immune to prevent measles from spreading. The school\'s current 72% coverage is far below this threshold — that\'s why the outbreak spread.',
        casefile: 'Measles R₀ = 15. Herd immunity threshold = 93.3%. Current school coverage is 72% — below threshold.',
      },
      {
        text: 'HIT = R₀ ÷ (R₀ + 1) = 15 ÷ 16 = 93.75%',
        correct: false,
        feedback: '✗ The correct formula is HIT = 1 − (1/R₀). With R₀ = 15: HIT = 1 − 1/15 = 14/15 ≈ 93.3%. The formula R₀/(R₀+1) gives a slightly different — and incorrect — answer.',
      },
      {
        text: 'HIT = 1 ÷ R₀ = 1 ÷ 15 = 6.7%',
        correct: false,
        feedback: '✗ 1/R₀ gives the proportion of susceptible people that can remain in a population while still controlling spread — not the HIT. The herd immunity threshold is 1 − (1/R₀) = 93.3% for measles.',
      },
      {
        text: 'HIT = 75% for all vaccine-preventable diseases',
        correct: false,
        feedback: '✗ The herd immunity threshold varies by disease depending on its R₀. Measles (R₀ = 12–18) requires about 93–95% immunity. Polio (R₀ = 5–7) requires about 80–85%. Seasonal influenza (R₀ = 2–3) requires about 50–67%. There is no universal threshold.',
      },
    ],
  },
  {
    speaker: 'COMMUNITY HEALTH WORKER',
    boxStyle: 'pixel-box',
    scene: 'measles_facebook',
    text: `We've identified a community Facebook group with over 2,000 members actively sharing anti-vaccine content. Common claims include:\n\n• "MMR causes autism"\n• "Measles is just a rash — not dangerous"\n• "Natural immunity is better and lasts longer than vaccine immunity"\n• "The MMR contains harmful toxins"\n\nParents are keeping unvaccinated children home, but many are refusing vaccination.`,
    casefile: 'Community misinformation: Facebook group, 2000 members. Autism claims, natural immunity myths circulating.',
  },
  {
    speaker: 'VACCINE-HESITANT PARENT',
    text: `I want to ask you directly, Doctor — is it true that natural immunity from getting measles is stronger and lasts longer than vaccine immunity? I've read that on several websites.`,
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'measles_natural_vs_vaccine',
    text: `A parent is asking about natural immunity vs. vaccine immunity. How should you accurately respond to this claim?`,
    choices: [
      {
        text: 'Both provide lifelong immunity of similar strength — but natural measles infection carries a real risk of death, brain damage (encephalitis), and a rare delayed fatal condition (SSPE) that the vaccine does not',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! Both natural infection and 2-dose MMR produce strong, long-lasting immunity. However, the risks of natural measles are serious and preventable: death in 1–2 per 1,000 cases in high-income countries (higher elsewhere), encephalitis in 1/1,000, and subacute sclerosing panencephalitis (SSPE) — a fatal brain disease that can appear years after infection. The "natural immunity is better" claim ignores these risks entirely.',
        casefile: 'Vaccine vs. natural: both lifelong; natural infection risks death (1–2/1,000), encephalitis, SSPE. Vaccine is safe.',
      },
      {
        text: 'Natural immunity is definitely superior and lasts much longer than vaccine immunity',
        correct: false,
        feedback: '✗ Both provide lifelong immunity of comparable duration and strength. The claim that natural immunity is "superior" is misleading when you consider the cost: measles kills 1–2/1,000 in high-income countries and can cause serious complications in many more. "Getting the disease for better immunity" is not a safe or ethical recommendation.',
      },
      {
        text: 'Vaccine immunity is stronger because it creates higher antibody levels',
        correct: false,
        feedback: '✗ Antibody titers from natural infection may actually be slightly higher, but this doesn\'t make natural infection preferable or safer. The correct public health message is: both provide equivalent long-term protection, but the vaccine achieves this safely without the life-threatening risks of the disease itself.',
      },
    ],
  },
  {
    speaker: 'EPIDEMIOLOGIST — MODELING TEAM',
    scene: 'measles_outbreak_projection',
    text: `Based on the effective reproduction number (Rₑ) of 4.4 in this partially immune school population, our model projects 80–120 additional cases without any intervention.\n\nIf we run an emergency vaccination campaign and bring coverage up to 95%, the Rₑ drops to 0.7 — below 1.0, which means the outbreak will stop spreading within 2 incubation periods.`,
    casefile: 'Projection: 80–120 more cases without action. Emergency campaign to 95% → Rₑ = 0.7 → outbreak stops.',
  },
  {
    speaker: 'COMMUNITY LIAISON',
    scene: 'measles_vaccine_clinic',
    text: `We've set up a vaccine clinic at the school. 28 more children have been vaccinated so far. But the Facebook group is actively posting against the clinic.\n\nCoverage has reached 89% — better, but still below the 93.3% herd immunity threshold. What is the most evidence-based strategy to reach the remaining hesitant families?`,
    choices: [
      {
        text: 'Work with trusted community voices — especially the children\'s pediatricians and local community leaders — and use motivational interviewing to meet parents where they are',
        correct: true,
        xp: 50,
        feedback: '✓ Correct! Research consistently shows that trusted community messengers — especially primary care physicians — are the most effective way to address vaccine hesitancy. Motivational interviewing techniques (listening without judgment, asking permission, exploring concerns, avoiding confrontation) are more effective than fact-bombardment or shaming. This approach is recommended by the CDC, AAP, and WHO.',
        casefile: 'Strategy: trusted messenger outreach (pediatricians, community leaders) + motivational interviewing.',
      },
      {
        text: 'Hold a press conference to publicly name vaccine-hesitant parents and shame them into compliance',
        correct: false,
        feedback: '✗ Publicly shaming hesitant parents tends to entrench their resistance (the "backfire effect") and damages trust in public health agencies. The evidence-based approach is empathetic, non-confrontational engagement through trusted community voices — not coercion or public humiliation.',
      },
      {
        text: 'Immediately issue fines and legal penalties to all unvaccinated families',
        correct: false,
        feedback: '✗ While mandates can raise vaccination coverage in some contexts, coercive measures used during an active outbreak response typically increase distrust and community resistance. The public health literature supports building trust, removing access barriers, and offering convenient vaccination — especially when hesitancy (not logistics) is the primary barrier.',
      },
    ],
  },
  {
    speaker: 'PEDIATRICIAN — DR. CHEN',
    boxStyle: 'pixel-box-yellow',
    scene: 'measles_pediatrician',
    text: `We worked through trusted community messengers and motivational outreach. Vaccination coverage is now at 94.5% — above the 93.3% herd immunity threshold for measles.\n\nLast confirmed case: 18 days ago. No new cases in the past 2 incubation periods. The outbreak is over.`,
    casefile: 'Coverage reached 94.5%. Last case 18 days ago. 2 full incubation periods with no new cases. OUTBREAK OVER.',
  },

  /* ── CHAPTER: PUBLIC HEALTH RECOMMENDATIONS ── */
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    scene: 'measles_health_officer_close',
    text: `This outbreak tested every communication skill in the public health toolkit. You faced active misinformation, a frightened community, and a vocal anti-vaccine network — and you still brought coverage above the herd immunity threshold.\n\nNow formalize your recommendations. This is the hardest communications challenge of the four cases: your audiences include the school administration, vaccine-hesitant families, and the general public — each requiring a different SOCO and a different message strategy.`,
    casefile: 'Step: Issuing public health recommendations — school, families, and public communication.',
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Your SOCO for the school administration: "The school establishes and enforces a vaccination verification policy so that future outbreaks are prevented and the school community remains safe."\n\nWhich recommendation to Riverside Elementary is the most important long-term measure?`,
    choices: [
      {
        text: 'Establish a clear vaccination verification policy with defined procedures for reviewing exemption requests, excluding unvaccinated students during future outbreaks, and reporting vaccination rates annually to the local health department',
        correct: true,
        xp: 40,
        feedback: '✓ Correct. A school vaccination policy with annual reporting and defined outbreak response procedures is the structural intervention most likely to prevent a recurrence. It addresses the root cause: vaccination coverage fell below the herd immunity threshold because there was no systematic mechanism to detect and respond to that gap. WHO\'s 7 Cs demand a specific Call to action — "establish a policy" is far more actionable than "encourage vaccination." Strong policies also support the principle of Consistency: the same standards apply to all students, which is both fair and effective.',
        casefile: 'Rec to school: vaccination verification policy, exemption review procedures, outbreak exclusion protocol, annual coverage reporting.',
      },
      {
        text: 'Ban all unvaccinated students from the school permanently',
        correct: false,
        feedback: '✗ Permanent exclusion is disproportionate and legally complex in most U.S. jurisdictions. The evidence-based approach is conditional exclusion during outbreaks combined with active efforts to reduce exemptions through education and access improvements. Permanent bans tend to generate legal challenges and community backlash without meaningful additional public health benefit over well-implemented conditional exclusion policies.',
      },
      {
        text: 'Encourage parents to look into vaccination — but leave the decision entirely to each family',
        correct: false,
        feedback: '✗ "Encouragement without accountability" has been shown repeatedly to be insufficient in communities with high philosophical exemption rates. When coverage falls below the herd immunity threshold, the community as a whole is at risk — including immunocompromised children who cannot be vaccinated. A structural policy is required, not just encouragement.',
      },
      {
        text: 'Require 100% vaccination with no exemptions allowed under any circumstances',
        correct: false,
        feedback: '✗ While well-intentioned, zero-exemption mandates are rarely achievable in practice and may face legal challenges. More importantly, they can generate backlash that actually reduces willingness to vaccinate. The evidence-based recommendation is a policy with a clear, narrow exemption process (medical exemptions reviewed by a physician; philosophical exemptions require documented counseling) that makes it harder — but not impossible — to opt out.',
      },
    ],
  },
  {
    speaker: 'MENTOR — DR. OKAFOR',
    boxStyle: 'pixel-box',
    text: `Your final and most challenging SOCO: "Vaccine-hesitant families in this community choose to vaccinate their children, based on accurate information and a trusting relationship with their healthcare providers."\n\nYou are drafting a public communication to the broader community — including families in the Facebook group. Which approach is most consistent with evidence-based health communication?`,
    choices: [
      {
        text: 'Issue a statement that: (1) acknowledges parents\' genuine concerns, (2) provides clear factual information about measles risks and MMR safety in plain language, (3) corrects specific misinformation (autism claim, natural immunity claim) with evidence, and (4) directs parents to their own pediatrician for a personalized conversation — with a specific call to action to schedule a vaccination appointment',
        correct: true,
        xp: 50,
        feedback: '✓ Correct. This response applies all 7 Cs and the SOCO framework. It Commands attention by addressing the real outbreak. It Clarifies the message (factual risks, corrected misinformation). It Communicates a benefit ("protect your child and others"). It maintains Consistency with CDC, AAP, and WHO guidance. It Caters to both HEART (acknowledges parental love and concern) and HEAD (evidence-based corrections). It Creates trust by using the pediatrician — the most trusted messenger — rather than relying solely on government authority. And it ends with a clear Call to action: schedule the appointment. The POINT is stated first: measles is dangerous and the MMR vaccine is safe and effective.',
        casefile: 'Public communication: acknowledge concerns, factual corrections, pediatrician-led outreach, clear vaccination call to action.',
      },
      {
        text: 'Publish a detailed scientific rebuttal of every anti-vaccine claim in the Facebook group, with citations from peer-reviewed journals',
        correct: false,
        feedback: '✗ Evidence alone rarely changes minds in vaccine-hesitant communities — and long, technical rebuttals can actually trigger the "backfire effect," causing people to dig deeper into their existing beliefs. WHO guidance emphasizes Catering to the HEART: people are motivated by emotion, values, and trust — not data dumps. The evidence must be presented in a way that connects emotionally with the audience\'s values, delivered by a trusted messenger.',
      },
      {
        text: 'Post a counter-narrative in the Facebook group under an anonymous account to avoid escalating the conflict',
        correct: false,
        feedback: '✗ Anonymous communications violate the "Create trust" principle — one of the 7 Cs. Public health authority depends on credibility and transparency. If the account is later identified as a health department employee or official, the resulting scandal would cause far more damage to public trust than any initial conflict. Effective public health communication is always transparent about its source.',
      },
      {
        text: 'Ignore the Facebook group entirely — engaging with misinformation only amplifies it',
        correct: false,
        feedback: '✗ The "don\'t feed the trolls" approach is not supported by public health communications research in outbreak settings. When misinformation is actively circulating, silence is interpreted as confirmation. WHO guidance is clear: correct misinformation promptly, using accurate information delivered through trusted channels. The goal is not to fight online but to reach hesitant parents through their pediatricians, schools, and community leaders.',
      },
    ],
  },
  {
    speaker: 'STATE HEALTH OFFICER',
    boxStyle: 'pixel-box-cyan',
    scene: 'measles_health_officer_close',
    text: `Remarkable work, Detective. You successfully:\n\n• Calculated R₀, Rₑ, and the herd immunity threshold\n• Measured vaccine efficacy from real outbreak data\n• Navigated vaccine hesitancy using evidence-based communication\n• Applied outbreak modeling to guide the vaccination campaign\n\nYou are on your way to becoming a World-Class Disease Detective.`,
    xp: 400,
    casefile: 'CASE 4 CLOSED. Measles outbreak over. Coverage 94.5%. All core competencies demonstrated.',
  },
];
