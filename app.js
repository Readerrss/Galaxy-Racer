// ==================== START OF CHUNK 1 OF 6 ====================
const canvas=document.getElementById('gameCanvas');
const ctx=canvas.getContext('2d',{alpha:false});
const radarCanvas=document.getElementById('miniRadarCanvas');
const rCtx=radarCanvas.getContext('2d');
const LANES=[-2,-1,0,1,2];
const LANE_WIDTH_M=3.5;
let isMobileHardware=false,isHudHidden=false;

function detectDeviceHardware(){
    const uaMobile=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const coarsePointer=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;
    isMobileHardware=Boolean(uaMobile||coarsePointer);
    document.body.classList.toggle('is-mobile',isMobileHardware);
    document.body.classList.toggle('is-pc',!isMobileHardware);
    const scanLbl=document.getElementById('gfxHardwareScanLabel');
    if(scanLbl)scanLbl.innerText="🖥️ Quality Presets & Render Options";
    const ctrlHeader=document.getElementById('ctrlPlatformHeaderLabel');
    if(ctrlHeader)ctrlHeader.innerText=isMobileHardware?"📱 Mobile / Android Touch & Gyro Controls":"⌨️ PC Keyboard Controls & Keybinds";
    const tapLaneBtn=document.getElementById('mobCtrl_drag');
    if(tapLaneBtn)tapLaneBtn.innerText="👆 Tap Lane";
}

function toggleGameHudVisibility(){
    isHudHidden=!isHudHidden;
    document.getElementById('gameViewportWrapper').classList.toggle('hud-hidden',isHudHidden);
    const mobBtn=document.getElementById('mobileHideUiBtn');
    if(mobBtn)mobBtn.innerText=isHudHidden?"👁️ Show UI":"👁️ UI";
}

const gameState={
    running:false,paused:false,score:0,epoch:1,combo:1.0,
    nearMisses:0,armor:100,nitroFuel:100,empCharge:100,
    distanceM:0,speedMps:25,targetLane:0,egoLaneX:0,egoRoll:0,
    boosting:false,braking:false,slowMoTimer:0,empWaveRadius:0,screenShake:0,
    ep250WarnTriggered:false,ep250WarnTimer:0,
    viewW:window.innerWidth,viewH:window.innerHeight,
    hazards:[],pickups:[],FloatingTexts:[],stars:[]
};

const STAR_COLORS=["#ffffff","#7dd3fc","#f472b6","#c084fc","#fde68a","#00f5d4"];
for(let i=0;i<85;i++){
    gameState.stars.push({x:Math.random(),y:Math.random()*0.41,s:Math.random()*1.8+0.6,sp:Math.random()*0.25+0.06,col:STAR_COLORS[i%STAR_COLORS.length]});
}

let spawnAccumulator=0,pickupAccumulator=0,radarAngle=Math.PI;
let lastRawLandscapeTilt=0,smoothedGyroDelta=0,needsSilentGyroCalib=true,hasGyroReading=false;
let awaitingRebindAction=null,lastHudUpdateTime=0,lastLiveLbPushTime=0,doubleTapBoostTimer=null;
const domCache={};
let cachedGradients={key:'',sky:null,sun:null};

function setTextCached(id,val){
    if(domCache[id]===val)return;
    domCache[id]=val;
    const el=document.getElementById(id);
    if(el)el.innerText=val;
}
function setStyleWidthCached(id,wStr){
    const k=id+'_w';
    if(domCache[k]===wStr)return;
    domCache[k]=wStr;
    const el=document.getElementById(id);
    if(el)el.style.width=wStr;
}

const PILOT_PROFILES={
    "1117":{id:"1117",name:"Mitadru Karmakar (Void)",callsign:"VOID // ARCHITECT",liveryName:"Dark-Matter Prismatic Chroma",isVoidChroma:true,isCore:true,dotColor:"#00f5d4",chassisTop:"#1a2236",chassisBot:"#090d18",canopyColor:"#c77dff",thrusterColor:"#ff007f",railColor:"#00f5d4",lbClass:"void-leaderboard-card",nameClass:"void-name-glow"},
    "1183":{id:"1183",name:"Ritam Chatterjee",callsign:"RITAM // DATASET",liveryName:"Solar Gold Telemetry",isVoidChroma:false,isCore:true,dotColor:"#f59e0b",chassisTop:"#33220a",chassisBot:"#170f04",canopyColor:"#fde68a",thrusterColor:"#f97316",railColor:"#f59e0b",lbClass:"core-glow-ritam bg-[#16120a]",nameClass:"text-amber-300 font-extrabold"},
    "1134":{id:"1134",name:"Syed Meraj Ahmed",callsign:"MERAJ // FIELD QA",liveryName:"Crimson Phantom Carbon",isVoidChroma:false,isCore:true,dotColor:"#ef4444",chassisTop:"#360f18",chassisBot:"#17060a",canopyColor:"#fda4af",thrusterColor:"#ef4444",railColor:"#f43f5e",lbClass:"core-glow-meraj bg-[#180b0e]",nameClass:"text-red-400 font-extrabold"},
    "1075":{id:"1075",name:"Sourajita Choudhury",callsign:"SOURAJITA // IEEE",liveryName:"Emerald Matrix Jade",isVoidChroma:false,isCore:true,dotColor:"#10b981",chassisTop:"#0b3024",chassisBot:"#051711",canopyColor:"#a7f3d0",thrusterColor:"#10b981",railColor:"#10b981",lbClass:"core-glow-sourajita bg-[#091814]",nameClass:"text-emerald-300 font-extrabold"},
    "1174":{id:"1174",name:"Debankita Das",callsign:"DEBANKITA // RISK",liveryName:"Amethyst Pulsar",isVoidChroma:false,isCore:true,dotColor:"#a855f7",chassisTop:"#271242",chassisBot:"#11071f",canopyColor:"#e9d5ff",thrusterColor:"#a855f7",railColor:"#c084fc",lbClass:"core-glow-debankita bg-[#130b1c]",nameClass:"text-purple-300 font-extrabold"},
    "GUEST":{id:"GUEST",name:"Guest Pilot",callsign:"EGO-01 // GUEST",liveryName:"Tactical Steel",isVoidChroma:false,isCore:false,dotColor:"#38bdf8",chassisTop:"#1e293b",chassisBot:"#0f172a",canopyColor:"#7dd3fc",thrusterColor:"#38bdf8",railColor:"#38bdf8",lbClass:"bg-[#111520] border border-[#232938]",nameClass:"text-gray-200 font-semibold"}
};

const CORE_IDS=new Set(["1117","1183","1134","1075","1174"]);
const ACCOUNTS_DB_KEY='roadSense_overdrive_accounts_db_v8';
const DELETED_ACCOUNTS_KEY='roadSense_overdrive_deleted_accs_v8';
const SETTINGS_PER_ACC_KEY='roadSense_overdrive_acc_settings_v12';

let currentPilot=PILOT_PROFILES["GUEST"];
let activeLiveryProfile=PILOT_PROFILES["GUEST"];
let customGuestId=localStorage.getItem('roadSense_overdrive_customGuestId')||"";
let customGuestName=localStorage.getItem('roadSense_overdrive_guestName')||"";
let isAccountSessionLocked=localStorage.getItem('roadSense_overdrive_accountLocked')==='true';
let devAllDimensionsUnlocked=true;
let isApplyingAccountSettings=false;

function generateRandomGuest4DigitId(){
    let candidate="1000";
    for(let tries=0;tries<50;tries++){
        candidate=String(Math.floor(1000+Math.random()*9000));
        if(!CORE_IDS.has(candidate))break;
    }
    return candidate;
}

function ensureGuestHas4DigitId(){
    if(currentPilot.isCore)return "";
    if(!/^\d{4}$/.test(customGuestId)||CORE_IDS.has(customGuestId)){
        customGuestId=generateRandomGuest4DigitId();
        localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
    }
    return customGuestId;
}

function getAccountsDatabase(){try{return JSON.parse(localStorage.getItem(ACCOUNTS_DB_KEY)||'{}');}catch(e){return {};}}
function saveAccountsDatabase(db){localStorage.setItem(ACCOUNTS_DB_KEY,JSON.stringify(db));}
function getDeletedAccountKeys(){try{return JSON.parse(localStorage.getItem(DELETED_ACCOUNTS_KEY)||'[]');}catch(e){return [];}}
function saveDeletedAccountKeys(arr){localStorage.setItem(DELETED_ACCOUNTS_KEY,JSON.stringify(arr));}

function getEffectiveGuestDisplayName(){
    const gid=ensureGuestHas4DigitId();
    const clean=(customGuestName||"").trim();
    if(clean)return clean;
    return `Pilot #${gid}`;
}

function getEffectiveGuestFullLabel(){
    const gid=ensureGuestHas4DigitId();
    const clean=(customGuestName||"").trim();
    return clean?`${clean} (#${gid})`:`Pilot #${gid}`;
}

function getActiveAccountStorageKey(){
    if(currentPilot.isCore)return currentPilot.id;
    return `GUEST_ID_${ensureGuestHas4DigitId()}`;
}

function getActiveAccountStats(){
    const db=getAccountsDatabase();
    return db[getActiveAccountStorageKey()]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
}

function saveActiveAccountStats(scoreVal,epochVal,flashesVal){
    const db=getAccountsDatabase();
    const key=getActiveAccountStorageKey();
    const prev=db[key]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
    const dispName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
    const maxEp=Math.max(prev.bestEpoch||1,epochVal);
    db[key]={
        id:currentPilot.isCore?currentPilot.id:key,
        guestId:currentPilot.isCore?"":ensureGuestHas4DigitId(),
        name:dispName,isCore:currentPilot.isCore,
        bestScore:Math.max(prev.bestScore||0,scoreVal),
        bestEpoch:maxEp,
        totalFlashes:(prev.totalFlashes||0)+flashesVal,
        completedEpoch250:Boolean(prev.completedEpoch250||maxEp>250),
        updatedAt:Date.now()
    };
    saveAccountsDatabase(db);
    refreshAccountStatsUI();
}

function syncAutoBiomeButtonUI(){
    const btn=document.getElementById('autoBiomeToggleBtn');
    if(!btn)return;
    btn.innerText=autoCycleBiomes?"🔄 Auto-Cycle: ON":"🔄 Auto-Cycle: OFF";
    btn.className=autoCycleBiomes
        ?"px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] mono-num font-bold cursor-pointer shrink-0"
        :"px-2.5 py-1 rounded bg-gray-800 text-gray-300 border border-gray-600 text-[10px] mono-num font-bold cursor-pointer shrink-0";
}

function saveSettingsForActiveAccount(){
    if(isApplyingAccountSettings)return;
    try{
        const allSet=JSON.parse(localStorage.getItem(SETTINGS_PER_ACC_KEY)||'{}');
        allSet[getActiveAccountStorageKey()]={
            diff:currentDiffKey,
            liveryId:activeLiveryProfile.id,
            biomeIdx,autoCycleBiomes,
            audio:{...audioSettings},
            gfx:{...gfxSettings},
            ctrl:{
                mobileMode:controlConfig.mobileMode,
                doubleTapNitro:controlConfig.doubleTapNitro,
                invertGyro:controlConfig.invertGyro,
                gyroSensitivity:controlConfig.gyroSensitivity,
                binds:JSON.parse(JSON.stringify(controlConfig.binds))
            }
        };
        localStorage.setItem(SETTINGS_PER_ACC_KEY,JSON.stringify(allSet));
    }catch(e){}
}
// ==================== END OF CHUNK 1 OF 6 ====================
// ==================== START OF CHUNK 2 OF 6 ====================
function loadOrResetSettingsForActiveAccount(){
    isApplyingAccountSettings=true;
    try{
        const allSet=JSON.parse(localStorage.getItem(SETTINGS_PER_ACC_KEY)||'{}');
        const saved=allSet[getActiveAccountStorageKey()];
        if(saved){
            setDifficulty(saved.diff||'easy');
            if(saved.liveryId&&(currentPilot.id==='1117'||saved.liveryId===currentPilot.id)){
                activeLiveryProfile=PILOT_PROFILES[saved.liveryId]||currentPilot;
            }else{
                activeLiveryProfile=currentPilot;
            }
            biomeIdx=isBiomeUnlockedForPilot(saved.biomeIdx||0)?(saved.biomeIdx||0):0;
            autoCycleBiomes=saved.autoCycleBiomes!==undefined?Boolean(saved.autoCycleBiomes):true;
            syncAutoBiomeButtonUI();
            setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
            if(saved.audio){
                ['master','music','menuMusic','engine','sfx','uiClick'].forEach(ch=>{
                    if(saved.audio[ch]!==undefined)updateVolumeSetting(ch,Math.round(saved.audio[ch]*100));
                });
                selectOstMode(saved.audio.ostMode==='mitadru'&&currentPilot.id!=='1117'?'synth':(saved.audio.ostMode||'synth'));
            }
            if(saved.ctrl){
                setMobileControlMode(saved.ctrl.mobileMode||'buttons');
                applyDoubleTapNitroState(saved.ctrl.doubleTapNitro!==false);
                controlConfig.invertGyro=Boolean(saved.ctrl.invertGyro);
                const invBtn=document.getElementById('invertGyroBtn');
                if(invBtn){
                    invBtn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;
                    invBtn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";
                }
                updateGyroSpeedSetting(Math.round((saved.ctrl.gyroSensitivity||0.65)*100));
                if(saved.ctrl.binds)controlConfig.binds=saved.ctrl.binds;
                refreshKeybindLabels();
            }
            if(saved.gfx){
                applyGraphicsPreset(saved.gfx.preset||'medium',false);
                if(saved.gfx.resScale)updateGfxResolution(Math.round(saved.gfx.resScale*100),false);
                if(saved.gfx.roadSlices)updateGfxDrawSlices(saved.gfx.roadSlices,false);
                if(saved.gfx.particles!==undefined)updateGfxParticles(Math.round(saved.gfx.particles*100),false);
                ['bloom','shake','transitions','scanlines','pillars','reflections','speedLines','hudBoxes'].forEach(k=>{
                    if(saved.gfx[k]!==undefined)applyGfxOptionState(k,saved.gfx[k],false);
                });
                setVisualFilter(saved.gfx.filter||'filter-standard',false);
            }
        }else{
            resetGameSettingsOnly();
            resetSoundSettingsOnly();
            resetControlSettingsOnly();
            resetGraphicsSettingsOnly();
        }
    }catch(e){}
    isApplyingAccountSettings=false;
    saveSettingsForActiveAccount();
}

function refreshAccountStatsUI(){
    const st=getActiveAccountStats();
    setTextCached('bootHighScore',(st.bestScore||0).toLocaleString());
    setTextCached('bootBestEpoch',`Epoch ${st.bestEpoch||1}`);
    setTextCached('bootTotalFlashes',(st.totalFlashes||0).toLocaleString());
}

function showLoginBanner(msg,ok=true){
    const b=document.getElementById('loginFeedbackBanner');
    if(!b)return;
    b.className=ok
        ?"text-[10.5px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 block"
        :"text-[10.5px] font-semibold px-2.5 py-1 rounded-lg bg-red-950/90 text-red-300 border border-red-500/40 block";
    b.innerText=msg;
}

function loginPilotById(){
    const input=document.getElementById('pilotIdInput');
    const gInput=document.getElementById('guestCallsignInput');
    let raw=(input?input.value:'').trim();
    const typedName=(gInput?gInput.value:'').trim();
    if(!raw){
        raw=generateRandomGuest4DigitId();
    }else if(!/^\d{4}$/.test(raw)){
        showLoginBanner("✕ Enter a 4-digit numeric ID (or leave blank for Auto-ID).",false);
        playGameSfx('hit');
        return;
    }
    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    if(PILOT_PROFILES[raw]&&raw!=="GUEST"){
        customGuestId="";
        localStorage.removeItem('roadSense_overdrive_customGuestId');
        applyPilotProfile(raw);
        if(input)input.value='';
        showLoginBanner(`✓ Core Pilot Authenticated: ${currentPilot.name}`,true);
        playGameSfx('pickup');
    }else{
        customGuestId=raw;
        localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
        const db=getAccountsDatabase();
        const existingAcc=db[`GUEST_ID_${customGuestId}`];
        if(typedName){
            customGuestName=typedName;
        }else if(existingAcc&&existingAcc.name&&!existingAcc.name.startsWith('Pilot #')){
            customGuestName=existingAcc.name.replace(/\s*\(#\d{4}\)$/,'');
        }else{
            customGuestName="";
        }
        localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
        applyPilotProfile("GUEST");
        if(input)input.value='';
        showLoginBanner(`✓ Guest Account Logged In: ${getEffectiveGuestFullLabel()}`,true);
        playGameSfx('pickup');
    }
}

function confirmGuestAccountLogin(){
    const idInput=document.getElementById('pilotIdInput');
    const gInput=document.getElementById('guestCallsignInput');
    const rawId=(idInput?idInput.value:'').trim();
    if(rawId&&/^\d{4}$/.test(rawId)){
        loginPilotById();
        return;
    }
    ensureGuestHas4DigitId();
    if(gInput)updateGuestCallsign(gInput.value);
    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    applyPilotProfile("GUEST");
    showLoginBanner(`✓ Guest Session Active: ${getEffectiveGuestFullLabel()}`,true);
    playGameSfx('pickup');
}

function openSwitchAccountRow(){
    isAccountSessionLocked=false;
    localStorage.setItem('roadSense_overdrive_accountLocked','false');
    customGuestId=generateRandomGuest4DigitId();
    customGuestName="";
    localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
    localStorage.removeItem('roadSense_overdrive_guestName');
    const gInput=document.getElementById('guestCallsignInput');
    const idInput=document.getElementById('pilotIdInput');
    if(gInput)gInput.value="";
    if(idInput){idInput.value="";idInput.placeholder=customGuestId;}
    applyPilotProfile("GUEST");
    showLoginBanner(`⇄ New Guest ID Assigned: #${customGuestId} (Or enter custom 4-digit ID / Name).`,true);
}

function updateGuestCallsign(val){
    customGuestName=(val||"").trim();
    localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
    if(!currentPilot.isCore){
        const fullLbl=getEffectiveGuestFullLabel();
        document.getElementById('activePilotLabel').innerText=fullLbl;
        document.getElementById('hudPilotCallsign').innerText=fullLbl.toUpperCase();
        const db=getAccountsDatabase();
        const key=getActiveAccountStorageKey();
        if(db[key]){db[key].name=fullLbl;saveAccountsDatabase(db);}
        refreshAccountStatsUI();
    }
}

function applyPilotProfile(idKey){
    currentPilot=PILOT_PROFILES[idKey]||PILOT_PROFILES["GUEST"];
    activeLiveryProfile=currentPilot;
    localStorage.setItem('roadSense_overdrive_pilotId',currentPilot.id);
    if(currentPilot.isCore){
        isAccountSessionLocked=true;
        localStorage.setItem('roadSense_overdrive_accountLocked','true');
    }else{
        ensureGuestHas4DigitId();
    }
    if(currentPilot.id==="1117")devAllDimensionsUnlocked=true;
    loadOrResetSettingsForActiveAccount();
    const dispLabel=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
    const displayCallsign=currentPilot.isCore?currentPilot.callsign:dispLabel.toUpperCase();
    document.getElementById('activePilotLabel').innerText=dispLabel;
    document.getElementById('activeLiveryBadge').innerText=activeLiveryProfile.liveryName;
    document.getElementById('activePilotColorDot').style.backgroundColor=activeLiveryProfile.dotColor;
    document.getElementById('hudPilotCallsign').innerText=displayCallsign;
    document.getElementById('hudPilotDot').style.backgroundColor=activeLiveryProfile.dotColor;

    const loginRow=document.getElementById('pilotLoginInputRow');
    const switchBtn=document.getElementById('switchAccountBtn');
    if(isAccountSessionLocked||currentPilot.isCore){
        if(loginRow)loginRow.classList.add('hidden');
        if(switchBtn)switchBtn.classList.remove('hidden');
    }else{
        if(loginRow)loginRow.classList.remove('hidden');
        if(switchBtn)switchBtn.classList.add('hidden');
        const gInput=document.getElementById('guestCallsignInput');
        const idInput=document.getElementById('pilotIdInput');
        if(gInput)gInput.value=customGuestName;
        if(idInput)idInput.placeholder=customGuestId||"Auto";
    }

    const devTabBtn=document.getElementById('setTabBtn_dev');
    const navGrid=document.getElementById('settingsTabNavGrid');
    const hudRefillBtn=document.getElementById('hudDevRefillBtn');
    if(currentPilot.id==="1117"){
        if(devTabBtn)devTabBtn.classList.remove('hidden');
        if(navGrid)navGrid.className="px-3 py-1.5 bg-[#090b10] border-b border-[#232836] grid grid-cols-5 gap-1.5 shrink-0";
        if(hudRefillBtn)hudRefillBtn.classList.remove('hidden');
    }else{
        if(devTabBtn)devTabBtn.classList.add('hidden');
        if(navGrid)navGrid.className="px-3 py-1.5 bg-[#090b10] border-b border-[#232836] grid grid-cols-4 gap-1.5 shrink-0";
        if(hudRefillBtn)hudRefillBtn.classList.add('hidden');
    }

    const ostBadge=document.getElementById('mitadruOstBadge');
    if(ostBadge)ostBadge.innerText=currentPilot.id==="1117"?"UNLOCKED":"ID 1117";

    refreshAccountStatsUI();
    buildVehicleLiverySelector();
    buildBiomeSelectorGrid();
    loadCustomSongForActivePilot();
    syncDevDimensionsButtonLabel();
}

function buildVehicleLiverySelector(){
    const container=document.getElementById('vehicleLiveryGrid');
    const hint=document.getElementById('liveryAccessHint');
    if(!container)return;
    const isArch=(currentPilot.id==="1117");
    if(hint)hint.innerText=isArch?"👑 ID 1117: All Liveries Unlocked":`Assigned: ${activeLiveryProfile.liveryName}`;
    container.innerHTML=["1117","1183","1134","1075","1174","GUEST"].map(k=>{
        const p=PILOT_PROFILES[k];
        const unlocked=isArch||(currentPilot.id===k);
        const sel=(activeLiveryProfile.id===k);
        if(!unlocked)return `<button type="button" disabled class="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate border bg-[#0b0d14] border-[#1b202e] text-gray-600 opacity-55 cursor-not-allowed">🔒 ${p.liveryName}</button>`;
        return `<button type="button" onclick="selectVehicleLivery('${k}')" class="px-2 py-1.5 rounded-lg text-[10px] font-bold text-left truncate cursor-pointer border flex items-center gap-1.5 ${sel?'bg-sky-500/25 border-sky-400 text-white':'bg-[#121621] border-[#22293a] text-gray-300 hover:text-white'}"><span class="w-2 h-2 rounded-full shrink-0" style="background:${p.dotColor}"></span><span class="truncate">${p.liveryName}</span></button>`;
    }).join('');
}

function selectVehicleLivery(k){
    if(currentPilot.id!=="1117"&&currentPilot.id!==k)return;
    activeLiveryProfile=PILOT_PROFILES[k]||currentPilot;
    document.getElementById('activeLiveryBadge').innerText=activeLiveryProfile.liveryName;
    document.getElementById('activePilotColorDot').style.backgroundColor=activeLiveryProfile.dotColor;
    document.getElementById('hudPilotDot').style.backgroundColor=activeLiveryProfile.dotColor;
    buildVehicleLiverySelector();
    saveSettingsForActiveAccount();
}

const BIOME_THEMES=[
    {label:"🌌 Cyber Void",unlockEpoch:1,horizonType:"cyber",skyTop:"#03050a",skyBot:"#0d1b38",roadDark:"#0b0e17",roadLight:"#111624",curb:"#38bdf8",sun:"#38bdf8",weather:"none"},
    {label:"🌧️ Monsoon Glare",unlockEpoch:10,horizonType:"monsoon",skyTop:"#04080e",skyBot:"#132a2e",roadDark:"#080d12",roadLight:"#0e161f",curb:"#10b981",sun:"#10b981",weather:"rain"},
    {label:"🔥 Solar Overdrive",unlockEpoch:20,horizonType:"solar",skyTop:"#14040d",skyBot:"#3b0d24",roadDark:"#140914",roadLight:"#1d0e1e",curb:"#f59e0b",sun:"#f97316",weather:"embers"},
    {label:"❄️ Cryo-Singularity",unlockEpoch:30,horizonType:"cryo",skyTop:"#020b18",skyBot:"#0c3559",roadDark:"#0a1626",roadLight:"#102138",curb:"#7dd3fc",sun:"#e0f2fe",weather:"snow"},
    {label:"☣️ Bio-Luminescent",unlockEpoch:40,horizonType:"bio",skyTop:"#021008",skyBot:"#0a2e1c",roadDark:"#07140e",roadLight:"#0c2117",curb:"#4ade80",sun:"#22c55e",weather:"spores"},
    {label:"🩸 Crimson Eclipse",unlockEpoch:50,horizonType:"eclipse",skyTop:"#090204",skyBot:"#2d0610",roadDark:"#120508",roadLight:"#1c090e",curb:"#f43f5e",sun:"#e11d48",weather:"embers"},
    {label:"⚡ Tachyon Storm",unlockEpoch:60,horizonType:"tachyon",skyTop:"#090418",skyBot:"#261054",roadDark:"#0e081c",roadLight:"#160d2b",curb:"#c084fc",sun:"#eab308",weather:"rain"},
    {label:"🏜️ Dune Mirage 2077",unlockEpoch:70,horizonType:"dune",skyTop:"#1c0d02",skyBot:"#452108",roadDark:"#1a1109",roadLight:"#26190d",curb:"#fbbf24",sun:"#f59e0b",weather:"spores"},
    {label:"🌸 Neo-Tokyo Sakura",unlockEpoch:80,horizonType:"sakura",skyTop:"#0d0417",skyBot:"#2e0c38",roadDark:"#12091c",roadLight:"#1b0e29",curb:"#f472b6",sun:"#ec4899",weather:"petals"},
    {label:"🟢 Matrix Kernel",unlockEpoch:90,horizonType:"matrix",skyTop:"#000802",skyBot:"#03220a",roadDark:"#020d05",roadLight:"#05180a",curb:"#22c55e",sun:"#4ade80",weather:"matrix"},
    {label:"🪐 Saturn Rings Orbit",unlockEpoch:100,horizonType:"saturn",skyTop:"#020308",skyBot:"#111833",roadDark:"#080b14",roadLight:"#101526",curb:"#818cf8",sun:"#6366f1",weather:"none"},
    {label:"🌋 Magma Caldera",unlockEpoch:110,horizonType:"magma",skyTop:"#140300",skyBot:"#3d0e02",roadDark:"#170704",roadLight:"#240c06",curb:"#fb923c",sun:"#ef4444",weather:"embers"},
    {label:"⚪ Astral Monolith",unlockEpoch:120,horizonType:"astral",skyTop:"#090b10",skyBot:"#1e2433",roadDark:"#0e1117",roadLight:"#171b24",curb:"#e2e8f0",sun:"#f8fafc",weather:"snow"},
    {label:"✨ Cosmic Singularity (Ep 250)",unlockEpoch:251,horizonType:"cosmic250",isEpoch250Special:true,skyTop:"#02000a",skyBot:"#14042d",roadDark:"#070214",roadLight:"#12052c",curb:"#00f5d4",sun:"#ff007f",weather:"cosmic"}
];

const EPOCH_250_INDEX=13;
const EPOCH_250_LENGTH_M=800;
let biomeIdx=0,autoCycleBiomes=true;

function isBiomeUnlockedForPilot(idx){
    if(currentPilot.id==="1117")return devAllDimensionsUnlocked?true:(idx===0);
    const b=BIOME_THEMES[idx];
    if(!b)return false;
    const st=getActiveAccountStats();
    const maxReached=Math.max(st.bestEpoch||1,gameState.epoch||1);
    if(b.isEpoch250Special)return Boolean(st.completedEpoch250||maxReached>=251);
    return maxReached>=(b.unlockEpoch||1);
}

function buildBiomeSelectorGrid(){
    const container=document.getElementById('biomeGridSelector');
    if(!container)return;
    container.innerHTML=BIOME_THEMES.map((b,idx)=>{
        const unlocked=isBiomeUnlockedForPilot(idx);
        const active=(idx===biomeIdx);
        const lockText=b.isEpoch250Special?"🔒 Survive Ep 250":`🔒 Ep ${b.unlockEpoch}`;
        if(!unlocked)return `<button type="button" disabled class="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate border bg-[#0b0d14] border-[#1b202e] text-gray-600 opacity-60 cursor-not-allowed">${lockText} • ${b.label}</button>`;
        return `<button type="button" onclick="selectManualBiome(${idx})" class="biome-btn px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate cursor-pointer border ${active?'bg-sky-500/25 border-sky-400 text-white':'bg-[#121621] border-[#22293a] text-gray-300 hover:text-white'}">${b.label}</button>`;
    }).join('');
}

function selectManualBiome(idx){
    if(!isBiomeUnlockedForPilot(idx))return;
    biomeIdx=idx%BIOME_THEMES.length;
    cachedGradients.key='';
    autoCycleBiomes=false;
    syncAutoBiomeButtonUI();
    setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
    buildBiomeSelectorGrid();
    saveSettingsForActiveAccount();
}

function toggleAutoBiomeCycle(){
    autoCycleBiomes=!autoCycleBiomes;
    syncAutoBiomeButtonUI();
    saveSettingsForActiveAccount();
}

const audioSettings={master:0.95,music:0.90,menuMusic:0.85,engine:0.80,sfx:0.92,uiClick:0.85,ostMode:'synth'};
let audioCtx=null,masterGainNode=null,musicBusNode=null,sfxBusNode=null,engineOsc1=null,engineOsc2=null,engineGain=null,synthLoopTimer=null,synthStep=0,menuStep=0;
let nextSynthNoteTime=0,nextMenuNoteTime=0,hasTrustedGesture=false,isBootSplashDismissed=false;
const lastSfxTime={};

const MENU_ARP_NOTES=[293.66,349.23,440.00,587.33,523.25,440.00,349.23,293.66,261.63,349.23,440.00,523.25,440.00,349.23,329.63,293.66];
const MENU_BASS_NOTES=[73.42,73.42,87.31,87.31,65.41,65.41,110.00,98.00];
const GAME_BASS_NOTES=[73.42,73.42,146.83,73.42,87.31,87.31,98.00,110.00,73.42,73.42,146.83,73.42,116.54,116.54,110.00,98.00];
const GAME_ARP_NOTES=[293.66,349.23,440.00,587.33,523.25,440.00,349.23,440.00,293.66,349.23,466.16,587.33,659.25,587.33,440.00,349.23];

function buildMenuAutoplayWavUrl(){
    const sr=22050,stepSec=0.135,steps=16,stepSamples=Math.floor(sr*stepSec),totalSamples=stepSamples*steps;
    const buf=new ArrayBuffer(44+totalSamples*2),view=new DataView(buf);
    const writeStr=(off,s)=>{for(let i=0;i<s.length;i++)view.setUint8(off+i,s.charCodeAt(i));};
    writeStr(0,'RIFF');view.setUint32(4,36+totalSamples*2,true);writeStr(8,'WAVE');writeStr(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sr,true);view.setUint32(28,sr*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    writeStr(36,'data');view.setUint32(40,totalSamples*2,true);
    let offset=44;
    for(let s=0;s<steps;s++){
        const note=MENU_ARP_NOTES[s],bNote=MENU_BASS_NOTES[(s>>1)%MENU_BASS_NOTES.length];
        for(let i=0;i<stepSamples;i++){
            const t=i/sr,att=Math.min(1,t/0.008),dec=Math.exp(-t*13);
            const tri=(2/Math.PI)*Math.asin(Math.sin(t*note*Math.PI*2));
            let sample=(tri*0.60+Math.sin(t*note*0.5*Math.PI*2)*0.40)*0.24*att*dec;
            if(s%2===0){
                const bFund=Math.sin(t*bNote*Math.PI*2);
                const bHarm=Math.sin(t*bNote*2*Math.PI*2)*0.45+Math.sin(t*bNote*3*Math.PI*2)*0.20;
                sample+=(bFund*0.65+bHarm*0.35)*0.20*att*Math.exp(-t*11);
            }
            const clamped=Math.max(-0.95,Math.min(0.95,sample));
            view.setInt16(offset,Math.floor(clamped*32767),true);
            offset+=2;
        }
    }
    return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
}

const menuUnlockAudio=document.createElement('audio');
menuUnlockAudio.id='mainMenuLoopAudio';
menuUnlockAudio.src=buildMenuAutoplayWavUrl();
menuUnlockAudio.loop=true;
menuUnlockAudio.preload='auto';
menuUnlockAudio.playsInline=true;
menuUnlockAudio.setAttribute('playsinline','');
menuUnlockAudio.setAttribute('webkit-playsinline','');
menuUnlockAudio.style.display='none';

function mountMenuAudioToMainPage(){
    const host=document.getElementById('startModal')||document.body;
    if(host&&!document.getElementById('mainMenuLoopAudio')){
        host.appendChild(menuUnlockAudio);
    }
}
mountMenuAudioToMainPage();

function createAndMountBootSplashGate(){
    if(document.getElementById('bootSplashGateModal'))return;
    const wrapper=document.getElementById('gameViewportWrapper')||document.body;
    const gate=document.createElement('div');
    gate.id='bootSplashGateModal';
    gate.className='absolute inset-0 bg-[#03050a]/95 z-[95] flex items-center justify-center p-4 select-none';
    gate.innerHTML=`
        <div class="hardware-panel modal-anim p-6 sm:p-8 rounded-2xl max-w-md w-full text-center space-y-4 border border-sky-500/40 shadow-[0_0_50px_rgba(14,165,233,0.25)]">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] mono-num font-extrabold uppercase tracking-widest">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> SYSTEM ONLINE // AUDIO READY
            </div>
            <h1 class="title-cinzel text-xl sm:text-2xl font-black text-white tracking-wider">ROADSENSE: OVERDRIVE</h1>
            <p class="text-xs text-gray-300 mono-num leading-relaxed">Neural Interceptor Telemetry &amp; Synth Audio Engine Ready.</p>
            <button type="button" id="enterMainMenuGateBtn" class="btn-launch w-full py-3.5 px-6 rounded-xl text-sm sm:text-base font-extrabold uppercase tracking-wider cursor-pointer shadow-lg">
                ▶ START / ENTER MAIN MENU
            </button>
            <div class="text-[10px] mono-num text-sky-300/80 uppercase tracking-wider">Tap button or press [ENTER] / [SPACE]</div>
        </div>
    `;
    wrapper.appendChild(gate);
    const startModalEl=document.getElementById('startModal');
    if(startModalEl)startModalEl.style.display='none';

    const triggerEnter=(ev)=>{
        if(ev){
            ev.stopPropagation();
            if(ev.type==='keydown'&&ev.key!=='Enter'&&ev.key!==' ')return;
        }
        enterMainMenuFromSplash();
    };
    gate.addEventListener('pointerdown',triggerEnter);
    gate.addEventListener('click',triggerEnter);
    const btn=gate.querySelector('#enterMainMenuGateBtn');
    if(btn){
        btn.addEventListener('pointerdown',triggerEnter);
        btn.addEventListener('click',triggerEnter);
    }
}

function enterMainMenuFromSplash(){
    if(isBootSplashDismissed)return;
    isBootSplashDismissed=true;
    hasTrustedGesture=true;
    const gate=document.getElementById('bootSplashGateModal');
    if(gate)gate.style.display='none';
    const startModalEl=document.getElementById('startModal');
    if(startModalEl)startModalEl.style.display='flex';
    ensureAudioEngine();
    tryStartMenuUnlockAudio();
    playGameSfx('pickup');
    syncCursorVisibility();
}
// ==================== END OF CHUNK 2 OF 6 ====================
// ==================== START OF CHUNK 3 OF 6 ====================
let engineSubOsc=null,engineTurboOsc=null,engineTurboGain=null,engineFilterNode=null,engineRumbleLfo=null,engineRumbleGain=null;

function tryStartMenuUnlockAudio(){
    if(!hasTrustedGesture)return;
    mountMenuAudioToMainPage();
    const isMenuOrPaused=!gameState.running||gameState.paused;
    if(!isAppAudible()||!isMenuOrPaused||audioSettings.master<=0.01||audioSettings.menuMusic<=0.01){
        menuUnlockAudio.pause();
        return;
    }
    if(audioCtx&&audioCtx.state==='running'){
        menuUnlockAudio.pause();
        return;
    }
    menuUnlockAudio.volume=Math.min(1,audioSettings.master*audioSettings.menuMusic*0.85);
    if(menuUnlockAudio.paused){
        menuUnlockAudio.muted=false;
        const p=menuUnlockAudio.play();
        if(p&&typeof p.catch==='function'){
            p.catch(()=>{});
        }
    }
}

function isAppAudible(){
    return document.visibilityState!=='hidden'&&!document.hidden;
}

function buildVolumeSlidersUI(){
    const sliders=[
        {k:'master',lbl:'🔊 Master Volume',col:'emerald',val:95},
        {k:'music',lbl:'🎵 Gameplay OST Volume',col:'sky',val:90},
        {k:'menuMusic',lbl:'🎹 Menu & Pause Music',col:'cyan',val:85},
        {k:'engine',lbl:'🏎️ Engine & Turbo',col:'amber',val:80},
        {k:'sfx',lbl:'⚡ Effects, EMP & Siren',col:'purple',val:92},
        {k:'uiClick',lbl:'🔘 UI Button Clicks',col:'pink',val:85}
    ];
    const grid=document.getElementById('volumeSlidersGrid');
    if(!grid)return;
    grid.innerHTML=sliders.map(s=>`<div><div class="flex justify-between text-[10.5px]"><span class="text-gray-300">${s.lbl}</span><span id="volLabel_${s.k}" class="text-${s.col}-400 font-bold">${s.val}%</span></div><input type="range" id="volSlider_${s.k}" min="0" max="100" value="${s.val}" oninput="updateVolumeSetting('${s.k}',this.value)" class="w-full accent-${s.col}-400 cursor-pointer"></div>`).join('');
}

const mitadruAudio=new Audio();
mitadruAudio.preload='none';
mitadruAudio.loop=true;
const mitadruCandidates=["Mitadru.m4a","./Mitadru.m4a","/media/Mitadru.m4a","mitadru.m4a","Mitadru.mp3"];
let mitadruIdx=0;
mitadruAudio.addEventListener('error',()=>{
    if(audioSettings.ostMode!=='mitadru')return;
    mitadruIdx++;
    if(mitadruIdx<mitadruCandidates.length){mitadruAudio.src=mitadruCandidates[mitadruIdx];if(isAppAudible()&&gameState.running&&!gameState.paused)mitadruAudio.play().catch(()=>{});}
});

const customAudio=new Audio();
customAudio.loop=true;
let currentCustomObjectUrl=null;
const CUSTOM_SONGS_DB_NAME='RoadSenseCustomSongsDB_v1';

function openCustomSongsIDB(){
    return new Promise((resolve,reject)=>{
        const req=indexedDB.open(CUSTOM_SONGS_DB_NAME,1);
        req.onupgradeneeded=(e)=>{
            const db=e.target.result;
            if(!db.objectStoreNames.contains('songs'))db.createObjectStore('songs',{keyPath:'accountKey'});
        };
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
    });
}

async function handleCustomSongUpload(files){
    if(!files||!files[0])return;
    const file=files[0];
    if(file.size>20*1024*1024){
        document.getElementById('customSongStatusText').innerText="✕ File exceeds 20 MB limit!";
        playGameSfx('hit');
        return;
    }
    try{
        const db=await openCustomSongsIDB();
        const accountKey=getActiveAccountStorageKey();
        const pilotName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
        await new Promise((res,rej)=>{
            const tx=db.transaction('songs','readwrite');
            tx.objectStore('songs').put({accountKey,pilotName,fileName:file.name,sizeBytes:file.size,blob:file,ts:Date.now()});
            tx.oncomplete=()=>res();
            tx.onerror=()=>rej(tx.error);
        });
        await loadCustomSongForActivePilot();
        selectOstMode('custom');
        playGameSfx('pickup');
        renderDevCustomSongsList();
    }catch(e){
        document.getElementById('customSongStatusText').innerText="✕ Upload failed.";
    }
}

async function loadCustomSongForActivePilot(){
    try{
        const db=await openCustomSongsIDB();
        const accountKey=getActiveAccountStorageKey();
        const record=await new Promise((res)=>{
            const tx=db.transaction('songs','readonly');
            const req=tx.objectStore('songs').get(accountKey);
            req.onsuccess=()=>res(req.result||null);
            req.onerror=()=>res(null);
        });
        const statusText=document.getElementById('customSongStatusText');
        const subEl=document.getElementById('customOstBtnSub');
        const rmBtn=document.getElementById('removeMyCustomSongBtn');
        if(currentCustomObjectUrl){URL.revokeObjectURL(currentCustomObjectUrl);currentCustomObjectUrl=null;}
        if(record&&record.blob){
            currentCustomObjectUrl=URL.createObjectURL(record.blob);
            customAudio.src=currentCustomObjectUrl;
            customAudio.loop=true;
            const mb=(record.sizeBytes/(1024*1024)).toFixed(1);
            if(statusText)statusText.innerText=`✓ Loaded: ${record.fileName} (${mb} MB • Looping)`;
            if(subEl)subEl.innerText=record.fileName;
            if(rmBtn)rmBtn.classList.remove('hidden');
        }else{
            customAudio.pause();
            customAudio.removeAttribute('src');
            if(statusText)statusText.innerText="Upload Custom Song (≤ 20 MB, Auto-Loop)";
            if(subEl)subEl.innerText="No song uploaded";
            if(rmBtn)rmBtn.classList.add('hidden');
            if(audioSettings.ostMode==='custom')selectOstMode('synth');
        }
        renderDevCustomSongsList();
    }catch(e){}
}

async function removeCurrentPilotCustomSong(){
    await deleteCustomSongByKey(getActiveAccountStorageKey());
    await loadCustomSongForActivePilot();
    playGameSfx('uiClick');
}

async function deleteCustomSongByKey(accKey){
    try{
        const db=await openCustomSongsIDB();
        await new Promise((res)=>{
            const tx=db.transaction('songs','readwrite');
            tx.objectStore('songs').delete(accKey);
            tx.oncomplete=()=>res();
            tx.onerror=()=>res();
        });
        if(accKey===getActiveAccountStorageKey())await loadCustomSongForActivePilot();
        else renderDevCustomSongsList();
    }catch(e){}
}

async function devRemoveAllCustomSongs(){
    if(currentPilot.id!=='1117')return;
    try{
        const db=await openCustomSongsIDB();
        await new Promise((res)=>{
            const tx=db.transaction('songs','readwrite');
            tx.objectStore('songs').clear();
            tx.oncomplete=()=>res();
        });
        await loadCustomSongForActivePilot();
        showDevConsoleFeedback("✓ All Custom Uploaded Songs Removed!");
        playGameSfx('pickup');
    }catch(e){}
}

async function renderDevCustomSongsList(){
    const container=document.getElementById('devCustomSongsList');
    if(!container||currentPilot.id!=='1117')return;
    try{
        const db=await openCustomSongsIDB();
        const allRecords=await new Promise((res)=>{
            const tx=db.transaction('songs','readonly');
            const req=tx.objectStore('songs').getAll();
            req.onsuccess=()=>res(req.result||[]);
            req.onerror=()=>res([]);
        });
        if(allRecords.length===0){
            container.innerHTML=`<div class="text-gray-500">No custom songs uploaded yet.</div>`;
            return;
        }
        container.innerHTML=allRecords.map(r=>{
            const mb=(r.sizeBytes/(1024*1024)).toFixed(1);
            return `<div class="flex items-center justify-between bg-[#121724] px-2 py-1 rounded border border-[#232c42]"><span class="truncate pr-2 text-gray-200">${escapeHtml(r.pilotName)}: <strong>${escapeHtml(r.fileName)}</strong> (${mb}MB)</span><button type="button" onclick="deleteCustomSongByKey('${escapeHtml(r.accountKey)}')" class="px-1.5 py-0.5 rounded bg-red-600/80 hover:bg-red-500 text-white text-[9px] font-bold shrink-0 cursor-pointer">🗑️ Remove</button></div>`;
        }).join('');
    }catch(e){}
}

function scheduleMenuStepAt(noteTime){
    if(!audioCtx||audioSettings.master<=0.01||audioSettings.menuMusic<=0.01)return;
    try{
        const outNode=musicBusNode||masterGainNode;
        const mmVol=audioSettings.menuMusic;
        const m16=menuStep%16;
        const note=MENU_ARP_NOTES[m16];
        const mOsc1=audioCtx.createOscillator(),mOsc2=audioCtx.createOscillator(),mGain=audioCtx.createGain();
        mOsc1.type='triangle';mOsc2.type='sine';
        mOsc1.frequency.setValueAtTime(note,noteTime);
        mOsc2.frequency.setValueAtTime(note*0.5,noteTime);
        mGain.gain.setValueAtTime(0.001,noteTime);
        mGain.gain.linearRampToValueAtTime(0.24*mmVol,noteTime+0.008);
        mGain.gain.exponentialRampToValueAtTime(0.001,noteTime+0.20);
        mOsc1.connect(mGain);mOsc2.connect(mGain);mGain.connect(outNode);
        mOsc1.start(noteTime);mOsc2.start(noteTime);mOsc1.stop(noteTime+0.205);mOsc2.stop(noteTime+0.205);
        if(m16%2===0){
            const bNote=MENU_BASS_NOTES[(m16>>1)%MENU_BASS_NOTES.length];
            const mbOsc=audioCtx.createOscillator(),mbFilter=audioCtx.createBiquadFilter(),mbGain=audioCtx.createGain();
            mbOsc.type='sawtooth';mbOsc.frequency.setValueAtTime(bNote,noteTime);
            mbFilter.type='lowpass';mbFilter.frequency.setValueAtTime(380,noteTime);
            mbGain.gain.setValueAtTime(0.001,noteTime);
            mbGain.gain.linearRampToValueAtTime(0.20*mmVol,noteTime+0.008);
            mbGain.gain.exponentialRampToValueAtTime(0.001,noteTime+0.21);
            mbOsc.connect(mbFilter);mbFilter.connect(mbGain);mbGain.connect(outNode);
            mbOsc.start(noteTime);mbOsc.stop(noteTime+0.215);
        }
        menuStep++;
    }catch(e){}
}

function scheduleGameplaySynthStepAt(noteTime){
    if(!audioCtx||audioSettings.ostMode!=='synth'||audioSettings.master<=0.01||audioSettings.music<=0.01)return;
    try{
        const outNode=musicBusNode||masterGainNode;
        const mVol=audioSettings.music,s16=synthStep%16;
        if(s16%4===0){
            const kOsc=audioCtx.createOscillator(),kGain=audioCtx.createGain();
            kOsc.type='sine';
            kOsc.frequency.setValueAtTime(146.83,noteTime);
            kOsc.frequency.exponentialRampToValueAtTime(36.71,noteTime+0.13);
            kGain.gain.setValueAtTime(0.001,noteTime);
            kGain.gain.linearRampToValueAtTime(0.46*mVol,noteTime+0.005);
            kGain.gain.exponentialRampToValueAtTime(0.001,noteTime+0.14);
            kOsc.connect(kGain);kGain.connect(outNode);
            kOsc.start(noteTime);kOsc.stop(noteTime+0.145);
        }else if(s16%4===2){
            const sOsc=audioCtx.createOscillator(),sGain=audioCtx.createGain();
            sOsc.type='triangle';
            sOsc.frequency.setValueAtTime(220.0,noteTime);
            sOsc.frequency.exponentialRampToValueAtTime(73.42,noteTime+0.085);
            sGain.gain.setValueAtTime(0.001,noteTime);
            sGain.gain.linearRampToValueAtTime(0.22*mVol,noteTime+0.005);
            sGain.gain.exponentialRampToValueAtTime(0.001,noteTime+0.09);
            sOsc.connect(sGain);sGain.connect(outNode);
            sOsc.start(noteTime);sOsc.stop(noteTime+0.095);
        }
        const bOsc=audioCtx.createOscillator(),bFilter=audioCtx.createBiquadFilter(),bGain=audioCtx.createGain();
        bOsc.type='sawtooth';bOsc.frequency.setValueAtTime(GAME_BASS_NOTES[s16],noteTime);
        bFilter.type='lowpass';bFilter.frequency.setValueAtTime(680,noteTime);
        bGain.gain.setValueAtTime(0.001,noteTime);
        bGain.gain.linearRampToValueAtTime(0.30*mVol,noteTime+0.006);
        bGain.gain.exponentialRampToValueAtTime(0.002,noteTime+0.11);
        bOsc.connect(bFilter);bFilter.connect(bGain);bGain.connect(outNode);
        bOsc.start(noteTime);bOsc.stop(noteTime+0.115);

        const lOsc=audioCtx.createOscillator(),lOsc2=audioCtx.createOscillator(),lGain=audioCtx.createGain();
        lOsc.type='sawtooth';lOsc2.type='triangle';
        lOsc.frequency.setValueAtTime(GAME_ARP_NOTES[s16],noteTime);
        lOsc2.frequency.setValueAtTime(GAME_ARP_NOTES[s16]*1.004,noteTime);
        lGain.gain.setValueAtTime(0.001,noteTime);
        lGain.gain.linearRampToValueAtTime(0.22*mVol,noteTime+0.006);
        lGain.gain.exponentialRampToValueAtTime(0.002,noteTime+0.13);
        lOsc.connect(lGain);lOsc2.connect(lGain);lGain.connect(outNode);
        lOsc.start(noteTime);lOsc2.start(noteTime);lOsc.stop(noteTime+0.135);lOsc2.stop(noteTime+0.135);
        synthStep++;
    }catch(e){}
}

function ensureAudioEngine(){
    if(audioCtx&&audioCtx.state==='running'){
        menuUnlockAudio.pause();
        return audioCtx;
    }
    if(!hasTrustedGesture){
        return null;
    }
    if(!audioCtx){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC)return null;
        audioCtx=new AC();

        masterGainNode=audioCtx.createGain();
        masterGainNode.gain.setValueAtTime(audioSettings.master,audioCtx.currentTime);

        musicBusNode=audioCtx.createGain();
        musicBusNode.gain.setValueAtTime(0.76,audioCtx.currentTime);
        sfxBusNode=audioCtx.createGain();
        sfxBusNode.gain.setValueAtTime(0.82,audioCtx.currentTime);

        musicBusNode.connect(masterGainNode);
        sfxBusNode.connect(masterGainNode);
        masterGainNode.connect(audioCtx.destination);

        // Throaty Roadster / V8 "BRUMMMMM" Engine + Twin-Turbo Nitro Whine
        engineOsc1=audioCtx.createOscillator();
        engineOsc2=audioCtx.createOscillator();
        engineSubOsc=audioCtx.createOscillator();
        engineTurboOsc=audioCtx.createOscillator();
        engineRumbleLfo=audioCtx.createOscillator();

        engineFilterNode=audioCtx.createBiquadFilter();
        engineGain=audioCtx.createGain();
        engineTurboGain=audioCtx.createGain();
        engineRumbleGain=audioCtx.createGain();

        engineOsc1.type='sawtooth';
        engineOsc2.type='sawtooth';
        engineSubOsc.type='square';
        engineTurboOsc.type='triangle';
        engineRumbleLfo.type='sine';

        engineOsc1.frequency.setValueAtTime(85,audioCtx.currentTime);
        engineOsc2.frequency.setValueAtTime(127.5,audioCtx.currentTime);
        engineSubOsc.frequency.setValueAtTime(42.5,audioCtx.currentTime);
        engineTurboOsc.frequency.setValueAtTime(420,audioCtx.currentTime);
        engineRumbleLfo.frequency.setValueAtTime(28,audioCtx.currentTime);

        engineRumbleGain.gain.setValueAtTime(14,audioCtx.currentTime);
        engineRumbleLfo.connect(engineRumbleGain);
        engineRumbleGain.connect(engineOsc1.frequency);
        engineRumbleGain.connect(engineOsc2.frequency);

        engineFilterNode.type='lowpass';
        engineFilterNode.frequency.setValueAtTime(720,audioCtx.currentTime);
        engineFilterNode.Q.setValueAtTime(2.8,audioCtx.currentTime);

        engineGain.gain.setValueAtTime(0.0001,audioCtx.currentTime);
        engineTurboGain.gain.setValueAtTime(0.0001,audioCtx.currentTime);

        engineOsc1.connect(engineFilterNode);
        engineOsc2.connect(engineFilterNode);
        engineSubOsc.connect(engineFilterNode);
        engineFilterNode.connect(engineGain);

        engineTurboOsc.connect(engineTurboGain);
        engineTurboGain.connect(sfxBusNode);
        engineGain.connect(sfxBusNode);

        engineOsc1.start();
        engineOsc2.start();
        engineSubOsc.start();
        engineTurboOsc.start();
        engineRumbleLfo.start();
    }
    if(isAppAudible()&&audioCtx.state!=='running'){
        audioCtx.resume().then(()=>{
            menuUnlockAudio.pause();
            nextSynthNoteTime=audioCtx.currentTime+0.015;
            nextMenuNoteTime=audioCtx.currentTime+0.015;
        }).catch(()=>{
            tryStartMenuUnlockAudio();
        });
    }
    return audioCtx;
}

function silenceAllAudioForBackground(){
    menuUnlockAudio.pause();
    mitadruAudio.pause();
    customAudio.pause();
    if(engineGain&&audioCtx){
        try{
            engineGain.gain.setTargetAtTime(0.0001,audioCtx.currentTime,0.02);
            if(engineTurboGain)engineTurboGain.gain.setTargetAtTime(0.0001,audioCtx.currentTime,0.02);
        }catch(e){}
    }
    if(audioCtx&&audioCtx.state==='running'){
        audioCtx.suspend().catch(()=>{});
    }
    updateEqVisuals(false);
}

function resumeAudioForForeground(){
    if(!isAppAudible())return;
    if(hasTrustedGesture)ensureAudioEngine();
    syncExternalTrackPlayback();
    updateEngineSoundPitch();
    updateEqVisuals(gameState.running&&!gameState.paused);
}

function updateEngineSoundPitch(){
    if(!audioCtx||!engineOsc1||!engineGain)return;
    if(audioCtx.state==='suspended'&&hasTrustedGesture&&isAppAudible()){
        audioCtx.resume().catch(()=>{});
    }
    const now=audioCtx.currentTime;
    if(!gameState.running||gameState.paused||!isAppAudible()||audioSettings.master<=0.01||audioSettings.engine<=0.01){
        engineGain.gain.setTargetAtTime(0.0001,now,0.04);
        if(engineTurboGain)engineTurboGain.gain.setTargetAtTime(0.0001,now,0.04);
        return;
    }

    const speedRatio=Math.max(0.75,Math.min(2.4,gameState.speedMps/24));
    const nitroBoostHz=gameState.boosting?46:(gameState.braking?-18:0);
    const baseFreq=78*speedRatio+nitroBoostHz;

    // Continuous throaty "BRUMMMMM" frequencies
    engineOsc1.frequency.setTargetAtTime(baseFreq,now,0.04);
    engineOsc2.frequency.setTargetAtTime(baseFreq*1.498,now,0.04);
    if(engineSubOsc)engineSubOsc.frequency.setTargetAtTime(baseFreq*0.5,now,0.04);
    if(engineRumbleLfo)engineRumbleLfo.frequency.setTargetAtTime(gameState.boosting?44:26*speedRatio,now,0.05);

    // Open filter wide on NITRO so the engine roars & intensifies
    if(engineFilterNode){
        const targetCutoff=gameState.boosting?2400:(gameState.braking?480:780*speedRatio);
        engineFilterNode.frequency.setTargetAtTime(targetCutoff,now,0.05);
        engineFilterNode.Q.setTargetAtTime(gameState.boosting?4.2:2.6,now,0.05);
    }

    // Main engine rumble volume (intensifies in NITRO)
    const targetVol=audioSettings.engine*(gameState.boosting?0.42:(gameState.braking?0.20:0.28));
    engineGain.gain.setTargetAtTime(Math.max(0.0001,targetVol),now,0.05);

    // Secondary Twin-Turbo / Roadster Afterburner Whine during NITRO
    if(engineTurboOsc&&engineTurboGain){
        const turboFreq=gameState.boosting?(560+speedRatio*220):(280+speedRatio*90);
        const turboVol=gameState.boosting?(0.22*audioSettings.engine):(0.025*audioSettings.engine);
        engineTurboOsc.frequency.setTargetAtTime(turboFreq,now,0.06);
        engineTurboGain.gain.setTargetAtTime(Math.max(0.0001,turboVol),now,0.06);
    }
}

function startUnifiedMusicScheduler(){
    if(synthLoopTimer)clearInterval(synthLoopTimer);
    const STEP_GAME_SEC=0.1171875;
    const STEP_MENU_SEC=0.135;
    const LOOKAHEAD_SEC=0.24;
    synthLoopTimer=setInterval(()=>{
        if(!isAppAudible()||audioSettings.master<=0.01||!hasTrustedGesture){
            menuUnlockAudio.pause();
            return;
        }
        const isMenuOrPaused=!gameState.running||gameState.paused;
        if(!audioCtx||audioCtx.state!=='running'){
            if(!audioCtx)ensureAudioEngine();
            if(isMenuOrPaused)tryStartMenuUnlockAudio();
            else menuUnlockAudio.pause();
            return;
        }
        menuUnlockAudio.pause();
        const now=audioCtx.currentTime;
        if(isMenuOrPaused){
            if(nextMenuNoteTime<now||nextMenuNoteTime>now+1.0)nextMenuNoteTime=now+0.015;
            while(nextMenuNoteTime<now+LOOKAHEAD_SEC){
                scheduleMenuStepAt(nextMenuNoteTime);
                nextMenuNoteTime+=STEP_MENU_SEC;
            }
            nextSynthNoteTime=0;
            return;
        }
        if(audioSettings.ostMode!=='synth'||audioSettings.music<=0.01)return;
        if(nextSynthNoteTime<now||nextSynthNoteTime>now+1.0)nextSynthNoteTime=now+0.015;
        while(nextSynthNoteTime<now+LOOKAHEAD_SEC){
            scheduleGameplaySynthStepAt(nextSynthNoteTime);
            nextSynthNoteTime+=STEP_GAME_SEC;
        }
        nextMenuNoteTime=0;
    },25);
}

function syncExternalTrackPlayback(){
    const shouldPlay=gameState.running&&!gameState.paused&&isAppAudible();
    mitadruAudio.volume=Math.min(1,audioSettings.master*audioSettings.music);
    customAudio.volume=Math.min(1,audioSettings.master*audioSettings.music);
    menuUnlockAudio.volume=Math.min(1,audioSettings.master*audioSettings.menuMusic*0.85);
    if(!shouldPlay){
        mitadruAudio.pause();
        customAudio.pause();
        tryStartMenuUnlockAudio();
        return;
    }
    menuUnlockAudio.pause();
    if(audioSettings.ostMode==='mitadru'){
        customAudio.pause();
        if(!mitadruAudio.src||mitadruAudio.src===window.location.href){mitadruIdx=0;mitadruAudio.src=mitadruCandidates[0];}
        mitadruAudio.play().catch(()=>{});
    }else if(audioSettings.ostMode==='custom'){
        mitadruAudio.pause();
        if(customAudio.src)customAudio.play().catch(()=>{});
    }else{
        mitadruAudio.pause();customAudio.pause();
    }
}

function selectOstMode(mode){
    if(mode==='mitadru'&&currentPilot.id!=='1117'){
        spawnFloatingText("🔒 LOGIN AS ID 1117 (VOID) TO UNLOCK MITADRU.M4A","#f59e0b",0,-25);
        return;
    }
    if(mode==='custom'&&!currentCustomObjectUrl){
        document.getElementById('customSongStatusText').innerText="⚠️ Upload a song file (≤ 20 MB) first!";
        return;
    }
    audioSettings.ostMode=mode;
    ['synth','mitadru','custom'].forEach(m=>{
        const btn=document.getElementById(`ostBtn_${m}`);
        if(btn)btn.className=(m===mode)?"p-2 rounded-xl text-left border bg-sky-500/20 border-sky-400 text-white cursor-pointer":"p-2 rounded-xl text-left border bg-[#141824] border-[#262f45] text-gray-300 cursor-pointer";
    });
    const shortLabel=document.getElementById('hudOstShortLabel');
    const statusEl=document.getElementById('ostLockStatus');
    if(shortLabel)shortLabel.innerText=mode==='mitadru'?"MITADRU":(mode==='custom'?"CUSTOM":"SYNTH");
    if(statusEl)statusEl.innerText=mode==='mitadru'?"Mitadru.m4a Active":(mode==='custom'?"Custom Song Active":"Cyber-Synth Active");
    syncExternalTrackPlayback();
    saveSettingsForActiveAccount();
}

function updateVolumeSetting(ch,val){
    const num=Math.max(0,Math.min(100,parseInt(val,10)))/100;
    audioSettings[ch]=num;
    const lbl=document.getElementById(`volLabel_${ch}`);
    if(lbl)lbl.innerText=`${Math.round(num*100)}%`;
    const sld=document.getElementById(`volSlider_${ch}`);
    if(sld&&String(sld.value)!==String(Math.round(num*100)))sld.value=Math.round(num*100);
    if(masterGainNode&&audioCtx)masterGainNode.gain.setTargetAtTime(audioSettings.master,audioCtx.currentTime,0.03);
    mitadruAudio.volume=Math.min(1,audioSettings.master*audioSettings.music);
    customAudio.volume=Math.min(1,audioSettings.master*audioSettings.music);
    menuUnlockAudio.volume=Math.min(1,audioSettings.master*audioSettings.menuMusic*0.85);
    updateEngineSoundPitch();
    saveSettingsForActiveAccount();
}
// ==================== END OF CHUNK 3 OF 6 ====================
// ==================== START OF CHUNK 4 OF 6 ====================
function playGameSfx(type){
    if(audioSettings.master<=0.01||!isAppAudible()||!hasTrustedGesture)return;
    const nowPerf=performance.now();
    if(lastSfxTime[type]&&nowPerf-lastSfxTime[type]<55)return;
    lastSfxTime[type]=nowPerf;
    try{
        const actx=ensureAudioEngine();
        if(!actx||actx.state!=='running')return;
        const now=actx.currentTime,sVol=audioSettings.sfx,cVol=audioSettings.uiClick;
        const out=sfxBusNode||masterGainNode;
        if(type==='uiClick'){
            if(cVol<=0.01)return;
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(587.33,now);o.frequency.exponentialRampToValueAtTime(880.0,now+0.045);
            g.gain.setValueAtTime(0.001,now);
            g.gain.linearRampToValueAtTime(0.11*cVol,now+0.005);
            g.gain.exponentialRampToValueAtTime(0.001,now+0.05);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.055);
            return;
        }
        if(sVol<=0.01)return;
        if(type==='steer'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(349.23,now);o.frequency.exponentialRampToValueAtTime(587.33,now+0.05);
            g.gain.setValueAtTime(0.001,now);
            g.gain.linearRampToValueAtTime(0.11*sVol,now+0.005);
            g.gain.exponentialRampToValueAtTime(0.001,now+0.055);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.06);
        }else if(type==='nitro'){
            // Stage 1: Deep V8 Afterburner Ignition Roar
            const roarOsc=actx.createOscillator(),roarSub=actx.createOscillator(),roarFilter=actx.createBiquadFilter(),roarGain=actx.createGain();
            roarOsc.type='sawtooth';roarSub.type='square';
            roarOsc.frequency.setValueAtTime(95,now);
            roarOsc.frequency.exponentialRampToValueAtTime(240,now+0.34);
            roarSub.frequency.setValueAtTime(48,now);
            roarSub.frequency.exponentialRampToValueAtTime(120,now+0.34);
            roarFilter.type='lowpass';
            roarFilter.frequency.setValueAtTime(450,now);
            roarFilter.frequency.exponentialRampToValueAtTime(2600,now+0.28);
            roarFilter.Q.setValueAtTime(3.5,now);
            roarGain.gain.setValueAtTime(0.001,now);
            roarGain.gain.linearRampToValueAtTime(0.28*sVol,now+0.015);
            roarGain.gain.exponentialRampToValueAtTime(0.001,now+0.38);
            roarOsc.connect(roarFilter);roarSub.connect(roarFilter);roarFilter.connect(roarGain);roarGain.connect(out);
            roarOsc.start(now);roarSub.start(now);roarOsc.stop(now+0.39);roarSub.stop(now+0.39);

            // Stage 2: Twin-Turbo Spool Whine
            const spoolOsc=actx.createOscillator(),spoolGain=actx.createGain();
            spoolOsc.type='triangle';
            spoolOsc.frequency.setValueAtTime(320,now);
            spoolOsc.frequency.exponentialRampToValueAtTime(980,now+0.32);
            spoolGain.gain.setValueAtTime(0.001,now);
            spoolGain.gain.linearRampToValueAtTime(0.16*sVol,now+0.02);
            spoolGain.gain.exponentialRampToValueAtTime(0.001,now+0.35);
            spoolOsc.connect(spoolGain);spoolGain.connect(out);
            spoolOsc.start(now);spoolOsc.stop(now+0.36);
        }else if(type==='siren250'){
            for(let c=0;c<6;c++){
                const st=now+c*0.5,o=actx.createOscillator(),g=actx.createGain();
                o.type='triangle';o.frequency.setValueAtTime(440.0,st);o.frequency.linearRampToValueAtTime(880.0,st+0.25);o.frequency.linearRampToValueAtTime(440.0,st+0.48);
                g.gain.setValueAtTime(0.001,st);
                g.gain.linearRampToValueAtTime(0.20*sVol,st+0.01);
                g.gain.exponentialRampToValueAtTime(0.001,st+0.49);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.495);
            }
        }else if(type==='phantom'){
            [587.33,698.46,880.0,1174.66].forEach((f,idx)=>{
                const o=actx.createOscillator(),g=actx.createGain(),st=now+idx*0.03;
                o.type='triangle';o.frequency.setValueAtTime(f,st);
                g.gain.setValueAtTime(0.001,st);
                g.gain.linearRampToValueAtTime(0.15*sVol,st+0.005);
                g.gain.exponentialRampToValueAtTime(0.001,st+0.22);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.225);
            });
        }else if(type==='pickup'){
            [587.33,880.0,1174.66].forEach((f,idx)=>{
                const o=actx.createOscillator(),g=actx.createGain(),st=now+idx*0.035;
                o.type='sine';o.frequency.setValueAtTime(f,st);
                g.gain.setValueAtTime(0.001,st);
                g.gain.linearRampToValueAtTime(0.15*sVol,st+0.005);
                g.gain.exponentialRampToValueAtTime(0.001,st+0.14);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.145);
            });
        }else if(type==='emp'){
            const o1=actx.createOscillator(),o2=actx.createOscillator(),g=actx.createGain();
            o1.type='sawtooth';o2.type='triangle';
            o1.frequency.setValueAtTime(880.0,now);o1.frequency.exponentialRampToValueAtTime(73.42,now+0.52);
            o2.frequency.setValueAtTime(1174.66,now);o2.frequency.exponentialRampToValueAtTime(146.83,now+0.52);
            g.gain.setValueAtTime(0.001,now);
            g.gain.linearRampToValueAtTime(0.20*sVol,now+0.008);
            g.gain.exponentialRampToValueAtTime(0.001,now+0.55);
            o1.connect(g);o2.connect(g);g.connect(out);
            o1.start(now);o2.start(now);o1.stop(now+0.56);o2.stop(now+0.56);
        }else if(type==='hit'){
            const o1=actx.createOscillator(),o2=actx.createOscillator(),flt=actx.createBiquadFilter(),g=actx.createGain();
            o1.type='sawtooth';o2.type='triangle';
            o1.frequency.setValueAtTime(146.83,now);o1.frequency.exponentialRampToValueAtTime(36.71,now+0.24);
            o2.frequency.setValueAtTime(220.0,now);o2.frequency.exponentialRampToValueAtTime(55.0,now+0.24);
            flt.type='lowpass';flt.frequency.setValueAtTime(460,now);
            g.gain.setValueAtTime(0.001,now);
            g.gain.linearRampToValueAtTime(0.24*sVol,now+0.006);
            g.gain.exponentialRampToValueAtTime(0.001,now+0.26);
            o1.connect(flt);o2.connect(flt);flt.connect(g);g.connect(out);
            o1.start(now);o2.start(now);o1.stop(now+0.27);o2.stop(now+0.27);
        }
    }catch(e){}
}

function handleFirstGestureAudioUnlock(e){
    if(e&&e.isTrusted){
        hasTrustedGesture=true;
        if(!isBootSplashDismissed){
            enterMainMenuFromSplash();
            return;
        }
        if(!audioCtx||audioCtx.state!=='running'){
            ensureAudioEngine();
        }else{
            menuUnlockAudio.pause();
        }
    }
}
['touchstart','touchend','pointerdown','mousedown','keydown','click'].forEach(evt=>{
    window.addEventListener(evt,handleFirstGestureAudioUnlock,{capture:true,passive:true});
});

document.addEventListener('pointerdown',(e)=>{
    if(e.isTrusted)hasTrustedGesture=true;
    const btn=e.target.closest('button');
    if(btn&&!btn.disabled&&!btn.classList.contains('touch-paddle'))playGameSfx('uiClick');
},{passive:true});

function updateEqVisuals(playing){
    document.querySelectorAll('.eq-bar').forEach(b=>b.classList.toggle('eq-paused',!(playing&&audioSettings.master>0.01&&audioSettings.music>0.01)));
}

const LB_STORAGE_KEY='roadSense_overdrive_leaderboard_v8';
const CLOUD_SYNC_TOPIC='roadsense_overdrive_global_lb_sync_v8';
const CLOUD_SYNC_URL=`https://ntfy.sh/${CLOUD_SYNC_TOPIC}`;
const lbChannel=('BroadcastChannel' in window)?new BroadcastChannel('roadsense_overdrive_lb_v8'):null;
let isPullingCloud=false,liveEventSource=null;
let lastCloudResetTs=Number(localStorage.getItem('roadSense_overdrive_resetTs_v8')||0);

function getLocalLeaderboard(){
    try{
        const parsed=JSON.parse(localStorage.getItem(LB_STORAGE_KEY)||'[]');
        const delSet=new Set(getDeletedAccountKeys());
        return(Array.isArray(parsed)?parsed:[]).filter(e=>e&&e.score>0&&!delSet.has(e.accountKey||e.id));
    }catch(e){return [];}
}

function saveLocalLeaderboard(list){
    const delSet=new Set(getDeletedAccountKeys());
    const valid=(Array.isArray(list)?list:[])
        .filter(e=>e&&e.score>0&&!delSet.has(e.accountKey||e.id))
        .sort((a,b)=>b.score-a.score)
        .slice(0,100);
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(valid));
    updateTopLeaderBanner(valid);
    return valid;
}

function mergeRemoteLeaderboardPacket(packet){
    if(!packet||typeof packet!=='object')return;
    if(packet.resetTs&&Number(packet.resetTs)>lastCloudResetTs){
        lastCloudResetTs=Number(packet.resetTs);
        localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
        localStorage.setItem(LB_STORAGE_KEY,JSON.stringify([]));
    }
    if(Array.isArray(packet.deletedAccounts)&&packet.deletedAccounts.length>0){
        saveDeletedAccountKeys(Array.from(new Set([...getDeletedAccountKeys(),...packet.deletedAccounts])));
    }
    const delSet=new Set(getDeletedAccountKeys());
    const mapByKey=new Map();
    getLocalLeaderboard().forEach(item=>{
        const k=item.accountKey||item.id;
        if(!delSet.has(k)&&item.score>0)mapByKey.set(k,item);
    });
    (Array.isArray(packet.entries)?packet.entries:[]).forEach(rem=>{
        if(!rem||!rem.score||rem.score<=0)return;
        if(rem.ts&&lastCloudResetTs&&rem.ts<lastCloudResetTs)return;
        const k=rem.accountKey||rem.id;
        if(delSet.has(k))return;
        const ex=mapByKey.get(k);
        if(!ex||rem.score>ex.score){
            mapByKey.set(k,{id:rem.id||'GUEST',guestId:rem.guestId||'',accountKey:k,name:rem.name||'Guest Pilot',score:Number(rem.score),epoch:Number(rem.epoch||1),ts:Number(rem.ts||Date.now())});
        }
    });
    saveLocalLeaderboard(Array.from(mapByKey.values()));
    if(document.getElementById('leaderboardModal').style.display!=='none')renderLeaderboardList();
}

function pushCloudLeaderboardPacket(extra={}){
    const payload={type:'lb_sync_v8',resetTs:lastCloudResetTs,entries:getLocalLeaderboard().slice(0,35),deletedAccounts:getDeletedAccountKeys(),...extra};
    if(lbChannel){try{lbChannel.postMessage(payload);}catch(e){}}
    fetch(CLOUD_SYNC_URL,{method:'POST',body:JSON.stringify(payload)}).catch(()=>{});
}

function startLiveLeaderboardStream(){
    if(liveEventSource||typeof EventSource==='undefined')return;
    try{
        liveEventSource=new EventSource(`${CLOUD_SYNC_URL}/sse`);
        liveEventSource.onmessage=(ev)=>{
            try{
                const data=JSON.parse(ev.data);
                if(data&&data.message){
                    const pkt=JSON.parse(data.message);
                    if(pkt&&pkt.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(pkt);
                }
            }catch(e){}
        };
        liveEventSource.onerror=()=>{
            try{liveEventSource.close();}catch(e){}
            liveEventSource=null;
            setTimeout(startLiveLeaderboardStream,5000);
        };
    }catch(e){}
}

async function pullGlobalCloudLeaderboard(){
    if(isPullingCloud||document.hidden)return;
    isPullingCloud=true;
    const ctrl=new AbortController();
    const tid=setTimeout(()=>ctrl.abort(),2800);
    try{
        const res=await fetch(`${CLOUD_SYNC_URL}/json?poll=1&since=24h`,{signal:ctrl.signal});
        if(res.ok){
            const text=await res.text();
            for(const line of text.trim().split('\n')){
                if(!line)continue;
                try{
                    const w=JSON.parse(line);
                    if(w&&w.event==='message'&&w.message){
                        const pkt=JSON.parse(w.message);
                        if(pkt&&pkt.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(pkt);
                    }
                }catch(e){}
            }
        }
    }catch(e){}finally{
        clearTimeout(tid);
        isPullingCloud=false;
    }
}

function recordScoreToLeaderboard(scoreVal,epochVal,pushRemote=true){
    if(!scoreVal||scoreVal<=0)return;
    const accountKey=getActiveAccountStorageKey();
    const pid=currentPilot.isCore?currentPilot.id:'GUEST';
    const gid=currentPilot.isCore?'':ensureGuestHas4DigitId();
    const pName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
    saveDeletedAccountKeys(getDeletedAccountKeys().filter(k=>k!==accountKey));
    const list=getLocalLeaderboard();
    const idx=list.findIndex(e=>(e.accountKey||e.id)===accountKey);
    let changed=false;
    if(idx>=0){
        if(scoreVal>list[idx].score){
            list[idx].score=scoreVal;
            list[idx].epoch=Math.max(list[idx].epoch||1,epochVal);
            list[idx].name=pName;
            list[idx].guestId=gid;
            list[idx].ts=Date.now();
            changed=true;
        }
    }else{
        list.push({id:pid,guestId:gid,accountKey,name:pName,score:scoreVal,epoch:epochVal,ts:Date.now()});
        changed=true;
    }
    if(changed){
        saveLocalLeaderboard(list);
        if(pushRemote)pushCloudLeaderboardPacket();
    }
}

function updateTopLeaderBanner(list=null){
    const arr=list||getLocalLeaderboard();
    const top=arr[0]||null;
    if(top&&top.score>0){
        setTextCached('bootTopLeaderName',top.name);
        setTextCached('bootTopLeaderScore',`(${top.score.toLocaleString()})`);
        setTextCached('hudLeaderMini',`${top.name.split(' ')[0]} (${top.score.toLocaleString()})`);
    }else{
        setTextCached('bootTopLeaderName',"Unclaimed");
        setTextCached('bootTopLeaderScore',"");
        setTextCached('hudLeaderMini',"Unclaimed");
    }
}

function extractGuestIdTag(entry){
    if(entry.guestId)return entry.guestId;
    const m1=String(entry.accountKey||'').match(/(\d{4})$/);
    if(m1)return m1[1];
    const m2=String(entry.name||'').match(/#(\d{4})/);
    if(m2)return m2[1];
    return "GUEST";
}

function renderLeaderboardList(){
    const container=document.getElementById('leaderboardListContainer');
    if(!container)return;
    const list=getLocalLeaderboard();
    const isAdmin=(currentPilot.id==='1117');
    if(list.length===0){
        container.innerHTML=`<div class="recessed-well p-6 rounded-xl text-center space-y-1"><div class="text-sm font-bold text-white">No Runs Recorded Yet</div><p class="text-xs text-gray-400">Complete a run to claim #1 on the Global Leaderboard!</p></div>`;
        return;
    }
    const medals=["🥇 #1","🥈 #2","🥉 #3"];
    container.innerHTML=list.map((entry,idx)=>{
        const prof=PILOT_PROFILES[entry.id]||PILOT_PROFILES["GUEST"];
        const isCore=Boolean(PILOT_PROFILES[entry.id]&&entry.id!=='GUEST');
        const accKey=entry.accountKey||entry.id;
        const gTag=isCore?'':extractGuestIdTag(entry);
        const dispName=(!isCore&&gTag!=='GUEST'&&!String(entry.name).includes(`#${gTag}`))?`${entry.name} (#${gTag})`:entry.name;
        const delBtn=isAdmin?`<button type="button" onclick="adminDeleteIndividualScore('${escapeHtml(accKey)}')" class="ml-2 px-2 py-1 rounded bg-red-600/85 hover:bg-red-500 text-white text-[9px] mono-num font-bold cursor-pointer">🗑️ Delete</button>`:'';
        const badge=prof.isVoidChroma
            ?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-extrabold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/50">👑 ARCHITECT VOID</span>`
            :(isCore
                ?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-bold rounded bg-white/10 text-gray-200">⚡ CORE #${entry.id}</span>`
                :`<span class="px-1.5 py-0.5 text-[9px] mono-num rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">👤 GUEST #${escapeHtml(gTag)}</span>`);
        return `<div class="p-3 rounded-xl flex items-center justify-between gap-2 transition ${prof.lbClass}"><div class="flex items-center gap-2.5 min-w-0"><span class="mono-num text-xs font-black text-white px-2 py-1 rounded bg-black/40 border border-white/10 shrink-0">${medals[idx]||`#${idx+1}`}</span><div class="min-w-0"><div class="flex items-center gap-1.5 flex-wrap"><span class="text-xs sm:text-sm truncate ${prof.nameClass}">${escapeHtml(dispName)}</span>${badge}</div><div class="text-[10px] mono-num text-gray-400">Epoch ${entry.epoch||1} &bull; ${prof.liveryName}</div></div></div><div class="flex items-center shrink-0"><span class="mono-num text-sm sm:text-base font-black text-emerald-400">${entry.score.toLocaleString()}</span>${delBtn}</div></div>`;
    }).join('');
}

function adminDeleteIndividualScore(targetKey){
    if(currentPilot.id!=='1117')return;
    const delList=getDeletedAccountKeys();
    if(!delList.includes(targetKey)){delList.push(targetKey);saveDeletedAccountKeys(delList);}
    const db=getAccountsDatabase();
    if(db[targetKey]){
        if(PILOT_PROFILES[targetKey]&&PILOT_PROFILES[targetKey].isCore){db[targetKey].bestScore=0;db[targetKey].bestEpoch=1;}
        else delete db[targetKey];
        saveAccountsDatabase(db);
    }
    saveLocalLeaderboard(getLocalLeaderboard().filter(e=>(e.accountKey||e.id)!==targetKey));
    pushCloudLeaderboardPacket();
    renderLeaderboardList();
    refreshAccountStatsUI();
}

function adminDeleteAllGuestAccounts(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase();
    const delSet=new Set(getDeletedAccountKeys());
    Object.keys(db).forEach(k=>{if(!PILOT_PROFILES[k]||!PILOT_PROFILES[k].isCore){delSet.add(k);delete db[k];}});
    getLocalLeaderboard().forEach(e=>{const k=e.accountKey||e.id;if(!PILOT_PROFILES[e.id]||!PILOT_PROFILES[e.id].isCore)delSet.add(k);});
    saveDeletedAccountKeys(Array.from(delSet));
    saveAccountsDatabase(db);
    saveLocalLeaderboard(getLocalLeaderboard().filter(e=>PILOT_PROFILES[e.id]&&PILOT_PROFILES[e.id].isCore));
    pushCloudLeaderboardPacket();
    renderLeaderboardList();
    refreshAccountStatsUI();
    showDevConsoleFeedback("✓ All Guest Accounts & Guest Votes Deleted!");
}

function adminResetAllLeaderboardScores(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase();
    Object.keys(db).forEach(k=>{
        if(!PILOT_PROFILES[k]||!PILOT_PROFILES[k].isCore)delete db[k];
        else{db[k].bestScore=0;db[k].bestEpoch=1;}
    });
    saveAccountsDatabase(db);
    lastCloudResetTs=Date.now();
    localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
    saveLocalLeaderboard([]);
    pushCloudLeaderboardPacket({resetTs:lastCloudResetTs,entries:[]});
    renderLeaderboardList();
    refreshAccountStatsUI();
    showDevConsoleFeedback("✓ All Leaderboard Scores (Including Core) Reset!");
}

function syncDevDimensionsButtonLabel(){
    const btn=document.getElementById('devToggleDimsBtn');
    if(!btn)return;
    btn.innerText=devAllDimensionsUnlocked?"🔒 Relock All Dimensions":"🔓 Unlock All Dimensions (Incl. Ep 250)";
    btn.className=devAllDimensionsUnlocked
        ?"p-2 rounded-xl bg-amber-950/70 hover:bg-amber-800/80 text-amber-200 border border-amber-500/40 text-[10.5px] mono-num font-bold cursor-pointer text-center"
        :"p-2 rounded-xl bg-purple-950/70 hover:bg-purple-800/80 text-purple-200 border border-purple-500/40 text-[10.5px] mono-num font-bold cursor-pointer text-center";
}

function devToggleAllDimensionsLock(){
    if(currentPilot.id!=='1117')return;
    devAllDimensionsUnlocked=!devAllDimensionsUnlocked;
    if(!devAllDimensionsUnlocked&&biomeIdx!==0){
        biomeIdx=0;cachedGradients.key='';
        setTextCached('hudBiomeName',BIOME_THEMES[0].label);
    }
    syncDevDimensionsButtonLabel();
    buildBiomeSelectorGrid();
    showDevConsoleFeedback(devAllDimensionsUnlocked?"✓ All 14 Dimensions Unlocked!":"🔒 Dimensions Relocked to 10-Epoch Progression!");
    playGameSfx('pickup');
}

function showDevConsoleFeedback(msg){
    const fb=document.getElementById('devConsoleFeedback');
    if(fb){fb.innerText=msg;fb.classList.remove('hidden');}
}

function getDistanceForEpoch(ep){
    const e=Math.max(1,Math.floor(ep));
    return e<=250?(e-1)*70:249*70+EPOCH_250_LENGTH_M+(e-251)*70;
}

function getEpochFromDistance(distM){
    const d250Start=249*70,d250End=d250Start+EPOCH_250_LENGTH_M;
    if(distM<d250Start)return 1+Math.floor(distM/70);
    if(distM<d250End)return 250;
    return 251+Math.floor((distM-d250End)/70);
}

function devStartAtCustomEpoch(){
    if(currentPilot.id!=='1117')return;
    const inp=document.getElementById('devEpochInput');
    startGameSession(Math.max(1,Math.min(99999,parseInt(inp?inp.value:'250',10)||250)));
}

function devRefillAllSystems(){
    if(currentPilot.id!=='1117')return;
    gameState.armor=100;gameState.nitroFuel=100;gameState.empCharge=100;
    updateHudDOM(true);
    spawnFloatingText("⚡ ARCHITECT OVERRIDE: 100% HULL + NITRO + EMP!","#00f5d4",0,-45);
    playGameSfx('pickup');
}

function openLeaderboardModal(){
    renderLeaderboardList();
    pullGlobalCloudLeaderboard();
    document.getElementById('leaderboardModal').style.display='flex';
    syncCursorVisibility();
}

function closeLeaderboardModal(){
    document.getElementById('leaderboardModal').style.display='none';
    syncCursorVisibility();
}

const DIFFICULTY_PRESETS={
    easy:{label:"🟢 Assisted Easy",speedMul:0.72,spawnMeters:32.0,hitboxScale:0.78,scoreMul:1.0,nitroRegen:6.8,empRegen:4.8,pickupSpacing:21.0,pickupScale:1.00},
    normal:{label:"🔵 Telemetry Normal",speedMul:0.84,spawnMeters:26.5,hitboxScale:0.84,scoreMul:1.2,nitroRegen:4.2,empRegen:3.0,pickupSpacing:25.0,pickupScale:0.86},
    hard:{label:"🟠 Overdrive Hard",speedMul:0.95,spawnMeters:22.5,hitboxScale:0.89,scoreMul:1.5,nitroRegen:2.3,empRegen:1.6,pickupSpacing:29.0,pickupScale:0.74},
    void:{label:"🔮 Void Max",speedMul:1.06,spawnMeters:19.0,hitboxScale:0.93,scoreMul:2.0,nitroRegen:1.1,empRegen:0.7,pickupSpacing:34.0,pickupScale:0.62}
};
let currentDiffKey='easy';

const GRAPHICS_PRESETS={
    low:{title:"Low",resScale:0.75,roadSlices:18,particles:0.25,bloom:false,shake:false,transitions:true,scanlines:false,pillars:false,reflections:false,speedLines:false,hudBoxes:true},
    medium:{title:"Medium",resScale:1.00,roadSlices:26,particles:0.65,bloom:true,shake:true,transitions:true,scanlines:false,pillars:true,reflections:false,speedLines:false,hudBoxes:true},
    high:{title:"High",resScale:1.25,roadSlices:36,particles:1.00,bloom:true,shake:true,transitions:true,scanlines:false,pillars:true,reflections:true,speedLines:true,hudBoxes:true},
    ultra:{title:"Ultra",resScale:1.50,roadSlices:48,particles:1.50,bloom:true,shake:true,transitions:true,scanlines:false,pillars:true,reflections:true,speedLines:true,hudBoxes:true}
};

const gfxSettings={
    preset:'medium',filter:'filter-standard',resScale:1.00,roadSlices:26,particles:0.65,
    bloom:true,shake:true,transitions:true,scanlines:false,
    pillars:true,reflections:false,speedLines:false,hudBoxes:true
};

const GFX_TOGGLE_META=[
    {k:'bloom',lbl:'💡 Glow'},
    {k:'shake',lbl:'📳 Shake'},
    {k:'transitions',lbl:'🌀 FX Anim'},
    {k:'scanlines',lbl:'📺 Scanline'},
    {k:'pillars',lbl:'🏛️ Sky Art'},
    {k:'reflections',lbl:'✨ Road Sheen'},
    {k:'speedLines',lbl:'💨 Warp Lines'},
    {k:'hudBoxes',lbl:'📦 YOLO Boxes'}
];

function buildGraphicsUI(){
    const pGrid=document.getElementById('gfxPresetButtonsGrid');
    if(pGrid){
        pGrid.innerHTML=['low','medium','high','ultra'].map(k=>{
            const p=GRAPHICS_PRESETS[k];
            const active=(gfxSettings.preset===k);
            return `<button type="button" onclick="applyGraphicsPreset('${k}',true)" class="py-1.5 px-2 rounded-lg text-[10.5px] font-bold cursor-pointer border truncate ${active?'bg-sky-500 text-black border-sky-400':'bg-[#151a26] text-gray-300 border-[#262f45] hover:text-white'}">${p.title}</button>`;
        }).join('');
    }
    const tGrid=document.getElementById('gfxTogglesGrid');
    if(tGrid){
        tGrid.innerHTML=GFX_TOGGLE_META.map(t=>`<button type="button" id="gfxToggle_${t.k}" onclick="toggleGfxOption('${t.k}')" class="p-1.5 rounded-lg text-[10px] font-bold cursor-pointer truncate"></button>`).join('');
        GFX_TOGGLE_META.forEach(t=>applyGfxOptionState(t.k,gfxSettings[t.k],false));
    }
    const fGrid=document.getElementById('gfxFilterButtonsGrid');
    const filters=[
        {k:'filter-standard',lbl:'✨ Standard Optic'},
        {k:'filter-requiem-noir',lbl:'🖤 RE: Requiem Noir'},
        {k:'filter-requiem-ash',lbl:'🌫️ RE: Requiem Ash'},
        {k:'filter-dl2-grit',lbl:'🌇 DL2: Harran Grit'},
        {k:'filter-dl2-darkzone',lbl:'🌑 DL2: Darkzone'},
        {k:'filter-stark-mono',lbl:'⚡ High-Contrast B&W'}
    ];
    if(fGrid){
        fGrid.innerHTML=filters.map(f=>`<button type="button" onclick="setVisualFilter('${f.k}')" id="flt_${f.k}" class="p-2 rounded-lg text-[10.5px] font-semibold cursor-pointer truncate"></button>`).join('');
        setVisualFilter(gfxSettings.filter,false);
    }
}

function applyGraphicsPreset(presetKey,shouldSave=true){
    const p=GRAPHICS_PRESETS[presetKey]||GRAPHICS_PRESETS.medium;
    gfxSettings.preset=GRAPHICS_PRESETS[presetKey]?presetKey:'medium';
    const pLbl=document.getElementById('gfxPresetActiveLabel');
    if(pLbl)pLbl.innerText=p.title.toUpperCase();
    updateGfxResolution(Math.round(p.resScale*100),false);
    updateGfxDrawSlices(p.roadSlices,false);
    updateGfxParticles(Math.round(p.particles*100),false);
    GFX_TOGGLE_META.forEach(t=>applyGfxOptionState(t.k,p[t.k],false));
    buildGraphicsUI();
    resizeGameCanvas();
    if(shouldSave)saveSettingsForActiveAccount();
}

function updateGfxResolution(val,shouldSave=true){
    const num=Math.max(60,Math.min(150,parseInt(val,10)||100));
    gfxSettings.resScale=num/100;
    const lbl=document.getElementById('gfxResLabel');
    if(lbl)lbl.innerText=`${gfxSettings.resScale.toFixed(2)}x`;
    const sld=document.getElementById('gfxResSlider');
    if(sld&&String(sld.value)!==String(num))sld.value=num;
    resizeGameCanvas();
    if(shouldSave)saveSettingsForActiveAccount();
}

function updateGfxDrawSlices(val,shouldSave=true){
    const num=Math.max(16,Math.min(48,parseInt(val,10)||32));
    gfxSettings.roadSlices=num;
    const lbl=document.getElementById('gfxSlicesLabel');
    if(lbl)lbl.innerText=`${num} Seg`;
    const sld=document.getElementById('gfxSlicesSlider');
    if(sld&&String(sld.value)!==String(num))sld.value=num;
    if(shouldSave)saveSettingsForActiveAccount();
}

function updateGfxParticles(val,shouldSave=true){
    const num=Math.max(0,Math.min(150,parseInt(val,10)||100));
    gfxSettings.particles=num/100;
    const lbl=document.getElementById('gfxParticleLabel');
    if(lbl)lbl.innerText=`${num}%`;
    const sld=document.getElementById('gfxParticleSlider');
    if(sld&&String(sld.value)!==String(num))sld.value=num;
    if(shouldSave)saveSettingsForActiveAccount();
}

function applyGfxOptionState(opt,val,shouldSave=true){
    gfxSettings[opt]=Boolean(val);
    const btn=document.getElementById(`gfxToggle_${opt}`);
    const meta=GFX_TOGGLE_META.find(m=>m.k===opt);
    if(btn&&meta){
        btn.innerText=`${meta.lbl}: ${gfxSettings[opt]?'ON':'OFF'}`;
        btn.className=gfxSettings[opt]
            ?"p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold cursor-pointer truncate"
            :"p-1.5 rounded-lg bg-[#151a26] text-gray-400 border border-[#262f45] text-[10px] font-bold cursor-pointer truncate";
    }
    if(opt==='scanlines'){
        const ov=document.getElementById('atmosphereOverlay');
        if(ov)ov.classList.toggle('scanlines-active',gfxSettings.scanlines);
    }
    if(shouldSave)saveSettingsForActiveAccount();
}

function toggleGfxOption(opt){applyGfxOptionState(opt,!gfxSettings[opt],true);}

function setVisualFilter(fc,shouldSave=true){
    gfxSettings.filter=fc;
    canvas.className=fc;
    ['filter-standard','filter-requiem-noir','filter-requiem-ash','filter-dl2-grit','filter-dl2-darkzone','filter-stark-mono'].forEach(k=>{
        const btn=document.getElementById(`flt_${k}`);
        if(!btn)return;
        const titles={'filter-standard':'✨ Standard Optic','filter-requiem-noir':'🖤 RE: Requiem Noir','filter-requiem-ash':'🌫️ RE: Requiem Ash','filter-dl2-grit':'🌇 DL2: Harran Grit','filter-dl2-darkzone':'🌑 DL2: Darkzone','filter-stark-mono':'⚡ High-Contrast B&W'};
        btn.innerText=titles[k];
        btn.className=(k===fc)?"p-2 rounded-lg text-[10.5px] font-bold bg-sky-500 text-black cursor-pointer truncate":"p-2 rounded-lg text-[10.5px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer truncate";
    });
    if(shouldSave)saveSettingsForActiveAccount();
}
// ==================== END OF CHUNK 4 OF 6 ====================
// ==================== START OF CHUNK 5 OF 6 ====================
let isPortalExiting=false;
const CLOUD_SYNC_URL_V10='https://ntfy.sh/roadsense_overdrive_global_lb_sync_v10';
const CLEAN_SLATE_KEY_V10='roadSense_overdrive_clean_slate_v10';

// One-time cleanup to wipe out the old false/cached scores & phantom flashes from v8
(function enforceCleanSlateV10(){
    if(localStorage.getItem(CLEAN_SLATE_KEY_V10)!=='true'){
        localStorage.removeItem(ACCOUNTS_DB_KEY);
        localStorage.removeItem(LB_STORAGE_KEY);
        localStorage.removeItem(DELETED_ACCOUNTS_KEY);
        lastCloudResetTs=Date.now();
        localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
        localStorage.setItem(CLEAN_SLATE_KEY_V10,'true');
    }
})();

// Glitch-proof DOM text & bar updater
function setTextCached(id,val){
    const strVal=String(val);
    domCache[id]=strVal;
    const el=document.getElementById(id);
    if(el&&el.innerText!==strVal)el.innerText=strVal;
}
function setStyleWidthCached(id,wStr){
    const k=id+'_w';
    domCache[k]=wStr;
    const el=document.getElementById(id);
    if(el&&el.style.width!==wStr)el.style.width=wStr;
}

// Match Core Pilot by 4-digit ID or typed name (Mitadru/Void, Ritam, Meraj, Sourajita, Debankita)
function resolveCorePilotFromInputs(rawIdStr,rawNameStr){
    const cleanId=(rawIdStr||"").trim();
    if(PILOT_PROFILES[cleanId]&&cleanId!=="GUEST")return cleanId;
    const cleanName=(rawNameStr||"").trim().toLowerCase();
    if(!cleanName)return null;
    if(cleanName==="1117"||cleanName.includes("mitadru")||cleanName==="void")return "1117";
    if(cleanName==="1183"||cleanName.includes("ritam"))return "1183";
    if(cleanName==="1134"||cleanName.includes("meraj"))return "1134";
    if(cleanName==="1075"||cleanName.includes("sourajita"))return "1075";
    if(cleanName==="1174"||cleanName.includes("debankita"))return "1174";
    return null;
}

// Never allow Core Pilot IDs to be added to deleted accounts
function sanitizeDeletedAccountKeys(){
    const raw=getDeletedAccountKeys();
    const cleaned=(Array.isArray(raw)?raw:[]).filter(k=>k&&!CORE_IDS.has(String(k)));
    if(cleaned.length!==raw.length)saveDeletedAccountKeys(cleaned);
    return cleaned;
}

function getActiveAccountStorageKey(){
    if(currentPilot&&currentPilot.isCore)return currentPilot.id;
    return `GUEST_ID_${ensureGuestHas4DigitId()}`;
}

function normalizeEntryAccountKey(entry){
    if(!entry)return "";
    const idStr=String(entry.id||"");
    const accStr=String(entry.accountKey||"");
    if(CORE_IDS.has(idStr))return idStr;
    if(CORE_IDS.has(accStr))return accStr;
    const matchedCore=resolveCorePilotFromInputs(idStr,entry.name);
    if(matchedCore)return matchedCore;
    if(accStr.startsWith("GUEST_ID_"))return accStr;
    if(entry.guestId&&/^\d{4}$/.test(String(entry.guestId)))return `GUEST_ID_${entry.guestId}`;
    const m=String(entry.name||"").match(/#(\d{4})/);
    if(m)return `GUEST_ID_${m[1]}`;
    return accStr||`GUEST_ID_${ensureGuestHas4DigitId()}`;
}

// Syncs Personal Best DB and Leaderboard DB while respecting resets (never invents false scores)
function reconcileAllPilotScores(){
    const delSet=new Set(sanitizeDeletedAccountKeys());
    const db=getAccountsDatabase();
    let rawLb=[];
    try{rawLb=JSON.parse(localStorage.getItem(LB_STORAGE_KEY)||'[]');}catch(e){rawLb=[];}
    if(!Array.isArray(rawLb))rawLb=[];

    const lbMap=new Map();

    // 1. Fold valid leaderboard entries (ignoring any entry older than lastCloudResetTs)
    rawLb.forEach(item=>{
        if(!item)return;
        const sc=Number(item.score)||0;
        const itemTs=Number(item.ts)||0;
        if(sc<=0)return;
        if(lastCloudResetTs&&itemTs>0&&itemTs<lastCloudResetTs)return;
        const k=normalizeEntryAccountKey(item);
        if(!k||delSet.has(k))return;
        const isCore=CORE_IDS.has(k);
        const prof=isCore?PILOT_PROFILES[k]:PILOT_PROFILES["GUEST"];
        const gid=isCore?"":(item.guestId||extractGuestIdTag(item));
        const canonicalName=isCore?prof.name:(item.name||'Guest Pilot');
        const ep=Math.max(1,Number(item.epoch)||1);
        const prev=lbMap.get(k);
        if(!prev||sc>prev.score||(sc===prev.score&&ep>prev.epoch)){
            lbMap.set(k,{
                id:isCore?k:'GUEST',
                guestId:isCore?'':(gid==='GUEST'?'':gid),
                accountKey:k,
                name:canonicalName,
                score:Math.max(sc,prev?prev.score:0),
                epoch:Math.max(ep,prev?prev.epoch:1),
                ts:Math.max(itemTs,prev?prev.ts:0)||Date.now()
            });
        }
    });

    // 2. Sync Account DB <-> Leaderboard (always keeping the true highest score after reset)
    let dbChanged=false;
    Object.keys(db).forEach(rawKey=>{
        const rec=db[rawKey];
        if(!rec)return;
        if(lastCloudResetTs&&rec.updatedAt&&Number(rec.updatedAt)<lastCloudResetTs){
            delete db[rawKey];
            dbChanged=true;
            return;
        }
        const k=CORE_IDS.has(rawKey)?rawKey:(resolveCorePilotFromInputs(rawKey,rec.name)||rawKey);
        if(delSet.has(k))return;
        const isCore=CORE_IDS.has(k);
        const prof=isCore?PILOT_PROFILES[k]:PILOT_PROFILES["GUEST"];
        const dbScore=Math.max(0,Number(rec.bestScore)||0);
        const dbEpoch=Math.max(1,Number(rec.bestEpoch)||1);
        const lbEntry=lbMap.get(k);
        const maxScore=Math.max(dbScore,lbEntry?lbEntry.score:0);
        const maxEpoch=maxScore>0?Math.max(dbEpoch,lbEntry?lbEntry.epoch:1):1;

        if(maxScore!==dbScore||maxEpoch!==dbEpoch||k!==rawKey){
            db[k]={
                ...rec,
                id:isCore?k:k,
                guestId:isCore?"":(rec.guestId||k.replace('GUEST_ID_','')),
                name:isCore?prof.name:(rec.name||`Pilot #${k.replace('GUEST_ID_','')}`),
                isCore,
                bestScore:maxScore,
                bestEpoch:maxEpoch,
                totalFlashes:Math.max(0,Number(rec.totalFlashes)||0),
                completedEpoch250:Boolean(rec.completedEpoch250||maxEpoch>250),
                updatedAt:rec.updatedAt||Date.now()
            };
            if(k!==rawKey)delete db[rawKey];
            dbChanged=true;
        }
        if(maxScore>0){
            lbMap.set(k,{
                id:isCore?k:'GUEST',
                guestId:isCore?'':(db[k].guestId||k.replace('GUEST_ID_','')),
                accountKey:k,
                name:isCore?prof.name:(db[k].name||'Guest Pilot'),
                score:maxScore,
                epoch:maxEpoch,
                ts:lbEntry?lbEntry.ts:(db[k].updatedAt||Date.now())
            });
        }
    });

    // 3. Ensure every valid leaderboard entry is reflected in Account DB
    lbMap.forEach((entry,k)=>{
        const isCore=CORE_IDS.has(k);
        const prof=isCore?PILOT_PROFILES[k]:PILOT_PROFILES["GUEST"];
        const prev=db[k]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
        if((Number(prev.bestScore)||0)<entry.score||(Number(prev.bestEpoch)||1)<entry.epoch){
            db[k]={
                id:isCore?k:k,
                guestId:isCore?"":(entry.guestId||k.replace('GUEST_ID_','')),
                name:isCore?prof.name:(entry.name||prev.name||'Guest Pilot'),
                isCore,
                bestScore:Math.max(Number(prev.bestScore)||0,entry.score),
                bestEpoch:Math.max(Number(prev.bestEpoch)||1,entry.epoch),
                totalFlashes:Math.max(0,Number(prev.totalFlashes)||0),
                completedEpoch250:Boolean(prev.completedEpoch250||entry.epoch>250),
                updatedAt:entry.ts||Date.now()
            };
            dbChanged=true;
        }
    });

    if(dbChanged)saveAccountsDatabase(db);
    const sorted=Array.from(lbMap.values()).sort((a,b)=>b.score-a.score).slice(0,100);
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(sorted));
    updateTopLeaderBanner(sorted);
    return sorted;
}

function getLocalLeaderboard(){
    return reconcileAllPilotScores();
}

function saveLocalLeaderboard(list){
    const delSet=new Set(sanitizeDeletedAccountKeys());
    const valid=(Array.isArray(list)?list:[])
        .filter(e=>e&&(Number(e.score)||0)>0&&!delSet.has(normalizeEntryAccountKey(e)))
        .sort((a,b)=>b.score-a.score)
        .slice(0,100);
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(valid));
    return reconcileAllPilotScores();
}

function getActiveAccountStats(){
    reconcileAllPilotScores();
    const db=getAccountsDatabase();
    const key=getActiveAccountStorageKey();
    const rec=db[key];
    if(!rec){
        return {bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
    }
    const bs=Math.max(0,Number(rec.bestScore)||0);
    const be=bs>0?Math.max(1,Number(rec.bestEpoch)||1):Math.max(1,Number(rec.bestEpoch)||1);
    const tf=Math.max(0,Number(rec.totalFlashes)||0);
    return {
        bestScore:bs,
        bestEpoch:be,
        totalFlashes:tf,
        completedEpoch250:Boolean(rec.completedEpoch250||be>250)
    };
}

function saveActiveAccountStats(scoreVal,epochVal,flashesVal){
    const key=getActiveAccountStorageKey();
    if(!CORE_IDS.has(key)){
        saveDeletedAccountKeys(sanitizeDeletedAccountKeys().filter(k=>k!==key));
    }
    const db=getAccountsDatabase();
    const prev=db[key]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
    const dispName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
    const cleanScore=Math.max(0,Math.round(Number(scoreVal)||0));
    const cleanEpoch=Math.max(1,Math.round(Number(epochVal)||1));
    const cleanFlashes=Math.max(0,Math.round(Number(flashesVal)||0));
    const newBestScore=Math.max(Number(prev.bestScore)||0,cleanScore);
    const newBestEpoch=Math.max(Number(prev.bestEpoch)||1,cleanEpoch);

    db[key]={
        id:currentPilot.isCore?currentPilot.id:key,
        guestId:currentPilot.isCore?"":ensureGuestHas4DigitId(),
        name:dispName,
        isCore:Boolean(currentPilot.isCore),
        bestScore:newBestScore,
        bestEpoch:newBestEpoch,
        totalFlashes:(Number(prev.totalFlashes)||0)+cleanFlashes,
        completedEpoch250:Boolean(prev.completedEpoch250||newBestEpoch>250),
        updatedAt:Date.now()
    };
    saveAccountsDatabase(db);
    reconcileAllPilotScores();
    refreshAccountStatsUI();
}

function recordScoreToLeaderboard(scoreVal,epochVal,pushRemote=true){
    const accountKey=getActiveAccountStorageKey();
    const pid=currentPilot.isCore?currentPilot.id:'GUEST';
    const gid=currentPilot.isCore?'':ensureGuestHas4DigitId();
    const pName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();

    if(!CORE_IDS.has(accountKey)){
        saveDeletedAccountKeys(sanitizeDeletedAccountKeys().filter(k=>k!==accountKey));
    }

    const st=getActiveAccountStats();
    const effectiveScore=Math.max(Math.round(Number(scoreVal)||0),st.bestScore||0);
    const effectiveEpoch=Math.max(Math.round(Number(epochVal)||1),st.bestEpoch||1);
    if(effectiveScore<=0)return;

    const nowTs=Date.now();
    const list=getLocalLeaderboard();
    const idx=list.findIndex(e=>normalizeEntryAccountKey(e)===accountKey);
    if(idx>=0){
        list[idx].score=Math.max(Number(list[idx].score)||0,effectiveScore);
        list[idx].epoch=Math.max(Number(list[idx].epoch)||1,effectiveEpoch);
        list[idx].name=pName;
        list[idx].id=pid;
        list[idx].guestId=gid;
        list[idx].accountKey=accountKey;
        list[idx].ts=nowTs;
    }else{
        list.push({id:pid,guestId:gid,accountKey,name:pName,score:effectiveScore,epoch:effectiveEpoch,ts:nowTs});
    }
    saveLocalLeaderboard(list);
    refreshAccountStatsUI();
    if(pushRemote)pushCloudLeaderboardPacket();
}

// Strict reset-aware cloud packet merger (blocks old pre-reset scores from ever returning)
function mergeRemoteLeaderboardPacket(packet){
    if(!packet||typeof packet!=='object')return;

    if(packet.resetTs&&Number(packet.resetTs)>lastCloudResetTs){
        lastCloudResetTs=Number(packet.resetTs);
        localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
        localStorage.setItem(ACCOUNTS_DB_KEY,JSON.stringify({}));
        localStorage.setItem(LB_STORAGE_KEY,JSON.stringify([]));
        refreshAccountStatsUI();
        updateTopLeaderBanner([]);
        if(document.getElementById('leaderboardModal').style.display!=='none')renderLeaderboardList();
    }

    if(Array.isArray(packet.deletedAccounts)&&packet.deletedAccounts.length>0){
        const safeIncoming=packet.deletedAccounts.filter(k=>k&&!CORE_IDS.has(String(k)));
        saveDeletedAccountKeys(Array.from(new Set([...sanitizeDeletedAccountKeys(),...safeIncoming])));
    }

    const delSet=new Set(sanitizeDeletedAccountKeys());
    const mapByKey=new Map();
    getLocalLeaderboard().forEach(item=>{
        const k=normalizeEntryAccountKey(item);
        if(k&&!delSet.has(k)&&item.score>0)mapByKey.set(k,item);
    });

    (Array.isArray(packet.entries)?packet.entries:[]).forEach(rem=>{
        const remScore=Number(rem&&rem.score)||0;
        const remTs=Number(rem&&rem.ts)||0;
        if(remScore<=0)return;
        // Reject any cloud score older than or missing timestamp after a reset
        if(lastCloudResetTs&&(!remTs||remTs<=lastCloudResetTs))return;
        const k=normalizeEntryAccountKey(rem);
        if(!k||delSet.has(k))return;
        const isCore=CORE_IDS.has(k);
        const prof=isCore?PILOT_PROFILES[k]:PILOT_PROFILES["GUEST"];
        const ex=mapByKey.get(k);
        const remEpoch=Math.max(1,Number(rem.epoch)||1);
        if(!ex||remScore>ex.score){
            mapByKey.set(k,{
                id:isCore?k:'GUEST',
                guestId:isCore?'':(rem.guestId||extractGuestIdTag(rem)),
                accountKey:k,
                name:isCore?prof.name:(rem.name||'Guest Pilot'),
                score:Math.max(remScore,ex?ex.score:0),
                epoch:Math.max(remEpoch,ex?ex.epoch:1),
                ts:remTs||Date.now()
            });
        }
    });

    saveLocalLeaderboard(Array.from(mapByKey.values()));
    refreshAccountStatsUI();
    if(document.getElementById('leaderboardModal').style.display!=='none')renderLeaderboardList();
}

function pushCloudLeaderboardPacket(extra={}){
    const payload={
        type:'lb_sync_v10',
        resetTs:lastCloudResetTs,
        entries:getLocalLeaderboard().slice(0,35),
        deletedAccounts:sanitizeDeletedAccountKeys(),
        ...extra
    };
    if(lbChannel){try{lbChannel.postMessage(payload);}catch(e){}}
    fetch(CLOUD_SYNC_URL_V10,{method:'POST',body:JSON.stringify(payload)}).catch(()=>{});
}

function startLiveLeaderboardStream(){
    if(liveEventSource){
        try{liveEventSource.close();}catch(e){}
        liveEventSource=null;
    }
    if(typeof EventSource==='undefined')return;
    try{
        liveEventSource=new EventSource(`${CLOUD_SYNC_URL_V10}/sse`);
        liveEventSource.onmessage=(ev)=>{
            try{
                const data=JSON.parse(ev.data);
                if(data&&data.message){
                    const pkt=JSON.parse(data.message);
                    if(pkt&&pkt.type==='lb_sync_v10')mergeRemoteLeaderboardPacket(pkt);
                }
            }catch(e){}
        };
        liveEventSource.onerror=()=>{
            try{liveEventSource.close();}catch(e){}
            liveEventSource=null;
            setTimeout(startLiveLeaderboardStream,5000);
        };
    }catch(e){}
}

async function pullGlobalCloudLeaderboard(){
    if(isPullingCloud||document.hidden)return;
    isPullingCloud=true;
    const ctrl=new AbortController();
    const tid=setTimeout(()=>ctrl.abort(),2800);
    try{
        const res=await fetch(`${CLOUD_SYNC_URL_V10}/json?poll=1&since=24h`,{signal:ctrl.signal});
        if(res.ok){
            const text=await res.text();
            for(const line of text.trim().split('\n')){
                if(!line)continue;
                try{
                    const w=JSON.parse(line);
                    if(w&&w.event==='message'&&w.message){
                        const pkt=JSON.parse(w.message);
                        if(pkt&&pkt.type==='lb_sync_v10')mergeRemoteLeaderboardPacket(pkt);
                    }
                }catch(e){}
            }
        }
    }catch(e){}finally{
        clearTimeout(tid);
        isPullingCloud=false;
    }
}

// Leaderboard Renderer: Core Pilots NEVER show a Delete button; only Guest accounts can be individually deleted
function renderLeaderboardList(){
    const container=document.getElementById('leaderboardListContainer');
    if(!container)return;
    const list=getLocalLeaderboard();
    const isAdmin=(currentPilot.id==='1117');
    if(list.length===0){
        container.innerHTML=`<div class="recessed-well p-6 rounded-xl text-center space-y-1"><div class="text-sm font-bold text-white">No Runs Recorded Yet</div><p class="text-xs text-gray-400">Complete a run to claim #1 on the Global Leaderboard!</p></div>`;
        return;
    }
    const medals=["🥇 #1","🥈 #2","🥉 #3"];
    container.innerHTML=list.map((entry,idx)=>{
        const k=normalizeEntryAccountKey(entry);
        const isCore=CORE_IDS.has(k);
        const prof=isCore?PILOT_PROFILES[k]:PILOT_PROFILES["GUEST"];
        const accKey=k||entry.accountKey||entry.id;
        const gTag=isCore?'':extractGuestIdTag(entry);
        const dispName=isCore?prof.name:((gTag!=='GUEST'&&!String(entry.name).includes(`#${gTag}`))?`${entry.name} (#${gTag})`:entry.name);
        // Remove Delete button from Core members (only show on Guest rows for Admin 1117)
        const delBtn=(isAdmin&&!isCore)?`<button type="button" onclick="adminDeleteIndividualScore('${escapeHtml(accKey)}')" class="ml-2 px-2 py-1 rounded bg-red-600/85 hover:bg-red-500 text-white text-[9px] mono-num font-bold cursor-pointer">🗑️ Delete</button>`:'';
        const badge=prof.isVoidChroma
            ?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-extrabold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/50">👑 ARCHITECT VOID</span>`
            :(isCore
                ?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-bold rounded bg-white/10 text-gray-200">⚡ CORE #${k}</span>`
                :`<span class="px-1.5 py-0.5 text-[9px] mono-num rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">👤 GUEST #${escapeHtml(gTag)}</span>`);
        return `<div class="p-3 rounded-xl flex items-center justify-between gap-2 transition ${prof.lbClass}"><div class="flex items-center gap-2.5 min-w-0"><span class="mono-num text-xs font-black text-white px-2 py-1 rounded bg-black/40 border border-white/10 shrink-0">${medals[idx]||`#${idx+1}`}</span><div class="min-w-0"><div class="flex items-center gap-1.5 flex-wrap"><span class="text-xs sm:text-sm truncate ${prof.nameClass}">${escapeHtml(dispName)}</span>${badge}</div><div class="text-[10px] mono-num text-gray-400">Epoch ${entry.epoch||1} &bull; ${prof.liveryName}</div></div></div><div class="flex items-center shrink-0"><span class="mono-num text-sm sm:text-base font-black text-emerald-400">${entry.score.toLocaleString()}</span>${delBtn}</div></div>`;
    }).join('');
}

function adminDeleteIndividualScore(targetKey){
    if(currentPilot.id!=='1117')return;
    // Protect Core accounts from individual deletion
    if(CORE_IDS.has(String(targetKey)))return;
    const delList=sanitizeDeletedAccountKeys();
    if(!delList.includes(targetKey)){delList.push(targetKey);saveDeletedAccountKeys(delList);}
    const db=getAccountsDatabase();
    if(db[targetKey]){
        delete db[targetKey];
        saveAccountsDatabase(db);
    }
    const rawLb=getLocalLeaderboard().filter(e=>normalizeEntryAccountKey(e)!==targetKey);
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(rawLb));
    reconcileAllPilotScores();
    pushCloudLeaderboardPacket();
    renderLeaderboardList();
    refreshAccountStatsUI();
}

function adminDeleteAllGuestAccounts(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase();
    const delSet=new Set(sanitizeDeletedAccountKeys());
    Object.keys(db).forEach(k=>{
        if(!CORE_IDS.has(k)){
            delSet.add(k);
            delete db[k];
        }
    });
    getLocalLeaderboard().forEach(e=>{
        const k=normalizeEntryAccountKey(e);
        if(!CORE_IDS.has(k))delSet.add(k);
    });
    saveDeletedAccountKeys(Array.from(delSet));
    saveAccountsDatabase(db);
    const coreOnly=getLocalLeaderboard().filter(e=>CORE_IDS.has(normalizeEntryAccountKey(e)));
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(coreOnly));
    reconcileAllPilotScores();
    pushCloudLeaderboardPacket();
    renderLeaderboardList();
    refreshAccountStatsUI();
    showDevConsoleFeedback("✓ All Guest Accounts & Guest Scores Deleted!");
}

// Completely resets Best Score (0), Max Epoch (Epoch 1), AND Phantom Flashes (0) for all Core & Guest accounts
function adminResetAllLeaderboardScores(){
    if(currentPilot.id!=='1117')return;
    lastCloudResetTs=Date.now();
    localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
    localStorage.setItem(ACCOUNTS_DB_KEY,JSON.stringify({}));
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify([]));
    saveDeletedAccountKeys([]);

    updateTopLeaderBanner([]);
    refreshAccountStatsUI();
    renderLeaderboardList();
    pushCloudLeaderboardPacket({resetTs:lastCloudResetTs,entries:[],deletedAccounts:[]});
    showDevConsoleFeedback("✓ All Scores, Epochs & Phantom Flashes Reset to 0!");
    playGameSfx('pickup');
}

function loginPilotById(){
    const input=document.getElementById('pilotIdInput');
    const gInput=document.getElementById('guestCallsignInput');
    let raw=(input?input.value:'').trim();
    const typedName=(gInput?gInput.value:'').trim();

    const matchedCoreId=resolveCorePilotFromInputs(raw,typedName);
    if(matchedCoreId){
        isAccountSessionLocked=true;
        localStorage.setItem('roadSense_overdrive_accountLocked','true');
        customGuestId="";
        localStorage.removeItem('roadSense_overdrive_customGuestId');
        applyPilotProfile(matchedCoreId);
        if(input)input.value='';
        showLoginBanner(`✓ Core Pilot Authenticated: ${currentPilot.name}`,true);
        playGameSfx('pickup');
        return;
    }

    if(!raw){
        raw=customGuestId&&/^\d{4}$/.test(customGuestId)&&!CORE_IDS.has(customGuestId)?customGuestId:generateRandomGuest4DigitId();
    }else if(!/^\d{4}$/.test(raw)){
        showLoginBanner("✕ Enter a 4-digit numeric ID (or leave blank for Auto-ID).",false);
        playGameSfx('hit');
        return;
    }

    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    customGuestId=raw;
    localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
    const db=getAccountsDatabase();
    const existingAcc=db[`GUEST_ID_${customGuestId}`];
    if(typedName){
        customGuestName=typedName;
    }else if(existingAcc&&existingAcc.name&&!existingAcc.name.startsWith('Pilot #')){
        customGuestName=existingAcc.name.replace(/\s*\(#\d{4}\)$/,'');
    }else{
        customGuestName="";
    }
    localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
    applyPilotProfile("GUEST");
    if(input)input.value='';
    showLoginBanner(`✓ Guest Account Logged In: ${getEffectiveGuestFullLabel()}`,true);
    playGameSfx('pickup');
}

function confirmGuestAccountLogin(){
    const idInput=document.getElementById('pilotIdInput');
    const gInput=document.getElementById('guestCallsignInput');
    const rawId=(idInput?idInput.value:'').trim();
    const rawName=(gInput?gInput.value:'').trim();
    const matchedCore=resolveCorePilotFromInputs(rawId,rawName);
    if(matchedCore||(rawId&&/^\d{4}$/.test(rawId))){
        loginPilotById();
        return;
    }
    ensureGuestHas4DigitId();
    if(gInput)updateGuestCallsign(rawName);
    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    applyPilotProfile("GUEST");
    showLoginBanner(`✓ Guest Session Active: ${getEffectiveGuestFullLabel()}`,true);
    playGameSfx('pickup');
}

const controlConfig={
    mobileMode:'buttons',doubleTapNitro:true,tiltCenterOffset:0,invertGyro:false,gyroSensitivity:0.65,lastTouchTime:0,
    binds:{left:['a','arrowleft'],right:['d','arrowright'],nitro:['shift','w','arrowup'],brake:['s','arrowdown'],emp:[' ','e'],hideui:['h']}
};

function buildKeybindGridUI(){
    const items=[
        {k:'left',lbl:'STEER LEFT',col:'sky'},
        {k:'right',lbl:'STEER RIGHT',col:'sky'},
        {k:'nitro',lbl:'NITRO ACCEL',col:'amber'},
        {k:'brake',lbl:'AEB BRAKE',col:'red'},
        {k:'emp',lbl:'NEURAL EMP PULSE',col:'emerald'},
        {k:'hideui',lbl:'HIDE / SHOW HUD',col:'purple'}
    ];
    const grid=document.getElementById('pcKeybindGrid');
    if(!grid)return;
    grid.innerHTML=items.map(it=>`<button type="button" onclick="startKeyRebind('${it.k}')" class="p-2.5 rounded-lg bg-[#141824] border border-[#262f45] hover:border-${it.col}-400 text-left cursor-pointer"><div class="text-[9px] text-gray-400">${it.lbl}</div><div class="text-${it.col}-300 font-bold mt-0.5" id="bindVal_${it.k}"></div></button>`).join('');
    refreshKeybindLabels();
}

function updateGyroSpeedSetting(val){
    const pct=Math.max(20,Math.min(100,parseInt(val,10)||65));
    controlConfig.gyroSensitivity=pct/100;
    const lbl=document.getElementById('gyroSpeedLabel');
    if(lbl)lbl.innerText=`${pct}% (${pct<=45?'Gentle':(pct<=75?'Responsive':'Ultra-Fast')})`;
    const sld=document.getElementById('gyroSpeedSlider');
    if(sld&&String(sld.value)!==String(pct))sld.value=pct;
    saveSettingsForActiveAccount();
}

function setDifficulty(key){
    currentDiffKey=DIFFICULTY_PRESETS[key]?key:'easy';
    const lbl=document.getElementById('diffCurrentLabel');
    if(lbl)lbl.innerText=DIFFICULTY_PRESETS[currentDiffKey].label;
    ['easy','normal','hard','void'].forEach(k=>{
        const btn=document.getElementById(`diffBtn_${k}`);
        if(btn)btn.className=(k===currentDiffKey)?"py-1.5 px-2 rounded-lg text-[11px] font-bold bg-emerald-500 text-black cursor-pointer":"py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer";
    });
    saveSettingsForActiveAccount();
}

function setMobileControlMode(mode){
    controlConfig.mobileMode=mode;
    const tapLaneBtn=document.getElementById('mobCtrl_drag');
    if(tapLaneBtn)tapLaneBtn.innerText="👆 Tap Lane";
    ['buttons','drag','tilt'].forEach(m=>{
        const btn=document.getElementById(`mobCtrl_${m}`);
        if(btn)btn.className=(m===mode)?"p-2 rounded-lg text-[11px] font-bold bg-sky-500 text-black cursor-pointer text-center":"p-2 rounded-lg text-[11px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer text-center";
    });
    const leftGroup=document.getElementById('mobileLeftTouchGroup');
    if(leftGroup)leftGroup.style.display=(mode==='buttons')?'flex':'none';
    const gyroBox=document.getElementById('gyroCalibrationBox');
    if(gyroBox){
        gyroBox.classList.toggle('opacity-40',mode!=='tilt');
        gyroBox.classList.toggle('pointer-events-none',mode!=='tilt');
    }
    const mapTitle=document.getElementById('mobileModeMapTitle');
    const mapSteer=document.getElementById('mapSteerDesc');
    if(mapTitle&&mapSteer){
        if(mode==='buttons'){mapTitle.innerText="ACTIVE CONTROL MAP // ARROW PADDLES";mapSteer.innerText="Left ◀ / ▶ Right Dock";}
        else if(mode==='drag'){mapTitle.innerText="ACTIVE CONTROL MAP // TAP LANE";mapSteer.innerText="Tap Any Road Lane to Glide There";}
        else{mapTitle.innerText="ACTIVE CONTROL MAP // PHONE TILT (GYRO)";mapSteer.innerText="Auto-Zeroed Magnetic Lane-Lock Tilt";}
    }
    if(mode==='tilt'){
        calibrateTiltSensor(true);
        if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
            DeviceOrientationEvent.requestPermission().catch(()=>{});
        }
    }
    saveSettingsForActiveAccount();
}

function toggleInvertGyro(){
    controlConfig.invertGyro=!controlConfig.invertGyro;
    needsSilentGyroCalib=true;
    const btn=document.getElementById('invertGyroBtn');
    if(btn){
        btn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;
        btn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";
    }
    saveSettingsForActiveAccount();
}

function calibrateTiltSensor(silent=true){
    if(hasGyroReading){
        controlConfig.tiltCenterOffset=lastRawLandscapeTilt;
        smoothedGyroDelta=0;
        needsSilentGyroCalib=false;
    }else{
        needsSilentGyroCalib=true;
    }
    const angleLbl=document.getElementById('gyroLiveAngleLabel');
    if(angleLbl)angleLbl.innerText="0.0°";
    if(!silent)playGameSfx('pickup');
}

function applyDoubleTapNitroState(enabled){
    controlConfig.doubleTapNitro=Boolean(enabled);
    const btn=document.getElementById('doubleTapNitroBtn');
    if(btn){
        btn.innerText=controlConfig.doubleTapNitro?'ENABLED':'DISABLED';
        btn.className=controlConfig.doubleTapNitro?"px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-3 py-1 rounded bg-gray-800 text-gray-400 border border-gray-600 text-[10px] mono-num font-bold cursor-pointer";
    }
    saveSettingsForActiveAccount();
}
function toggleDoubleTapNitro(){applyDoubleTapNitroState(!controlConfig.doubleTapNitro);}

function resetGameSettingsOnly(){
    setDifficulty('easy');
    activeLiveryProfile=currentPilot;
    buildVehicleLiverySelector();
    biomeIdx=0;cachedGradients.key='';autoCycleBiomes=true;
    syncAutoBiomeButtonUI();
    setTextCached('hudBiomeName',BIOME_THEMES[0].label);
    buildBiomeSelectorGrid();
    saveSettingsForActiveAccount();
}

function resetSoundSettingsOnly(){
    updateVolumeSetting('master',95);
    updateVolumeSetting('music',90);
    updateVolumeSetting('menuMusic',85);
    updateVolumeSetting('engine',80);
    updateVolumeSetting('sfx',92);
    updateVolumeSetting('uiClick',85);
    selectOstMode('synth');
    saveSettingsForActiveAccount();
}

function resetControlSettingsOnly(){
    setMobileControlMode('buttons');
    applyDoubleTapNitroState(true);
    updateGyroSpeedSetting(65);
    controlConfig.tiltCenterOffset=lastRawLandscapeTilt;
    controlConfig.invertGyro=false;
    const invBtn=document.getElementById('invertGyroBtn');
    if(invBtn){
        invBtn.innerText="⇄ Flip Axis: OFF";
        invBtn.className="px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";
    }
    resetDefaultKeybinds();
    saveSettingsForActiveAccount();
}

function resetGraphicsSettingsOnly(){
    setVisualFilter('filter-standard',false);
    applyGraphicsPreset('medium',true);
}

function setDiscreteTargetLane(newLaneInt){
    const clamped=Math.max(-2,Math.min(2,Math.round(newLaneInt)));
    const prevLane=Math.round(gameState.targetLane);
    if(clamped!==prevLane){
        const dir=clamped>prevLane?1:-1;
        gameState.targetLane=clamped;
        playGameSfx('steer');
        gameState.egoRoll=dir*0.12;
        checkPhantomFlashNearMiss(prevLane);
    }
}

function setMagneticTargetLane(continuousFloat){
    const clamped=Math.max(-2,Math.min(2,continuousFloat));
    const curLane=Math.round(gameState.targetLane);
    const diff=clamped-curLane;
    if(Math.abs(diff)>=0.42){
        const step=diff>0?Math.ceil(diff-0.42):Math.floor(diff+0.42);
        const nextLane=Math.max(-2,Math.min(2,curLane+(step!==0?step:(diff>0?1:-1))));
        setDiscreteTargetLane(nextLane);
        return true;
    }
    return false;
}

function getPointerGameCoords(e){
    const W=gameState.viewW||window.innerWidth||800;
    const H=gameState.viewH||window.innerHeight||450;
    const isRot=isMobileHardware&&(window.innerHeight>window.innerWidth);
    if(isRot){
        return {x:e.clientY,y:window.innerWidth-e.clientX,W,H};
    }
    return {x:e.clientX,y:e.clientY,W,H};
}

function handleCanvasTapLane(e){
    const {x,y,W,H}=getPointerGameCoords(e);
    const horizonY=H*0.42;
    const roadCurve=Math.sin(gameState.distanceM*0.012)*0.65;
    let zTap=EGO_Z_CENTER;
    if(y>horizonY+12){
        const scale=(y-horizonY)/(1.72*0.36);
        zTap=Math.max(1.1,Math.min(18.0,(H*0.85)/Math.max(1,scale)));
    }
    let bestLane=Math.round(gameState.targetLane);
    let minDist=Infinity;
    for(let i=0;i<LANES.length;i++){
        const l=LANES[i];
        const lx=projectX(l,zTap,W,H,roadCurve);
        const d=Math.abs(x-lx);
        if(d<minDist){
            minDist=d;
            bestLane=l;
        }
    }
    setDiscreteTargetLane(bestLane);
}

function startKeyRebind(actionKey){
    awaitingRebindAction=actionKey;
    const el=document.getElementById(`bindVal_${actionKey}`);
    if(el)el.innerText="PRESS KEY...";
}

function resetDefaultKeybinds(){
    controlConfig.binds={left:['a','arrowleft'],right:['d','arrowright'],nitro:['shift','w','arrowup'],brake:['s','arrowdown'],emp:[' ','e'],hideui:['h']};
    refreshKeybindLabels();
}

function refreshKeybindLabels(){
    Object.entries(controlConfig.binds).forEach(([act,keys])=>{
        const el=document.getElementById(`bindVal_${act}`);
        if(el)el.innerText=keys.map(k=>k===' '?'SPACE':k.toUpperCase()).join(' / ');
    });
    const hintBadge=document.getElementById('pcHideUiHintBadge');
    if(hintBadge&&controlConfig.binds.hideui&&controlConfig.binds.hideui[0]){
        const k=controlConfig.binds.hideui[0]===' '?'SPACE':controlConfig.binds.hideui[0].toUpperCase();
        hintBadge.innerText=`[${k}] UI • [ESC] Menu`;
    }
}

function syncCursorVisibility(){
    const bootSplash=document.getElementById('bootSplashGateModal');
    const splashOpen=bootSplash&&bootSplash.style.display!=='none';
    const anyModal=splashOpen||document.getElementById('startModal').style.display!=='none'||document.getElementById('pauseSettingsModal').style.display!=='none'||document.getElementById('leaderboardModal').style.display!=='none'||document.getElementById('gameOverModal').style.display!=='none';
    document.body.classList.toggle('gameplay-active',gameState.running&&!gameState.paused&&!anyModal);
}

function openPauseSettingsModal(defaultTab='game'){
    ensureAudioEngine();
    if(gameState.running&&!gameState.paused){
        gameState.paused=true;
        nextSynthNoteTime=0;
        nextMenuNoteTime=0;
        syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(false);
    }
    const resumeBtn=document.getElementById('resumeOrCloseSettingsBtn');
    const restartBtn=document.getElementById('inGameRestartBtn');
    const menuBtn=document.getElementById('inGameMenuBtn');
    if(gameState.running){
        if(resumeBtn)resumeBtn.innerText="▶ Resume";
        if(restartBtn)restartBtn.classList.remove('hidden');
        if(menuBtn)menuBtn.classList.remove('hidden');
    }else{
        if(resumeBtn)resumeBtn.innerText="← Back";
        if(restartBtn)restartBtn.classList.add('hidden');
        if(menuBtn)menuBtn.classList.add('hidden');
    }
    switchSettingsTab(defaultTab);
    buildVehicleLiverySelector();
    buildBiomeSelectorGrid();
    buildGraphicsUI();
    renderDevCustomSongsList();
    document.getElementById('pauseSettingsModal').style.display='flex';
    syncCursorVisibility();
}

function resumeFromSettings(){
    ensureAudioEngine();
    document.getElementById('pauseSettingsModal').style.display='none';
    if(gameState.running){
        requestMobileFullscreenSafe();
        if(controlConfig.mobileMode==='tilt')calibrateTiltSensor(true);
        gameState.paused=false;
        nextMenuNoteTime=0;
        nextSynthNoteTime=0;
        syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(true);
    }
    syncCursorVisibility();
}

function returnToMainMenu(){
    hasTrustedGesture=true;
    isBootSplashDismissed=true;
    const gate=document.getElementById('bootSplashGateModal');
    if(gate)gate.style.display='none';
    ensureAudioEngine();
    gameState.running=false;gameState.paused=false;gameState.ep250WarnTimer=0;
    nextSynthNoteTime=0;nextMenuNoteTime=0;
    syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(false);
    ['epoch250RedAlertModal','singularityAlertBanner','pauseSettingsModal','gameOverModal','leaderboardModal'].forEach(id=>document.getElementById(id).style.display='none');
    document.getElementById('startModal').style.display='flex';
    reconcileAllPilotScores();
    applyPilotProfile(currentPilot.id);
    refreshAccountStatsUI();
    updateTopLeaderBanner();
    syncCursorVisibility();
}

function switchSettingsTab(tabName){
    ['game','sounds','controls','graphics','dev'].forEach(t=>{
        const p=document.getElementById(`setTab_${t}`),b=document.getElementById(`setTabBtn_${t}`);
        if(p)p.classList.toggle('hidden',t!==tabName);
        if(b){
            if(t==='dev'&&currentPilot.id!=='1117')b.classList.add('hidden');
            else b.className=(t===tabName)?"py-1.5 px-2 rounded-lg text-[10px] sm:text-[11px] font-bold bg-sky-500 text-black cursor-pointer text-center truncate":"py-1.5 px-2 rounded-lg text-[10px] sm:text-[11px] font-semibold bg-[#131722] text-gray-300 border border-[#232836] cursor-pointer text-center truncate";
        }
    });
}

const IDD_HAZARD_CLASSES=[
    {id:0,name:"auto_rickshaw",wPx:30,hPx:26,w:1.18,speedMul:0.55,color:"#f59e0b",roof:"#1e293b",points:120},
    {id:1,name:"bus_truck",    wPx:30,hPx:26,w:1.18,speedMul:0.45,color:"#ef4444",roof:"#450a0a",points:180},
    {id:2,name:"car",          wPx:30,hPx:26,w:1.18,speedMul:0.65,color:"#38bdf8",roof:"#0c4a6e",points:140},
    {id:3,name:"two_wheeler",  wPx:30,hPx:26,w:1.18,speedMul:0.75,color:"#a855f7",roof:"#3b0764",points:160,weaves:false},
    {id:4,name:"pedestrian",   wPx:30,hPx:26,w:1.18,speedMul:0.12,color:"#fb7185",roof:"#881337",points:200},
    {id:5,name:"stray_animal", wPx:30,hPx:26,w:1.18,speedMul:0.08,color:"#fbbf24",roof:"#78350f",points:190},
    {id:6,name:"pothole",      wPx:30,hPx:26,w:1.18,speedMul:0.00,color:"#64748b",roof:"#0f172a",points:100,flat:true},
    {id:7,name:"speed_bump",   wPx:30,hPx:26,w:1.18,speedMul:0.00,color:"#eab308",roof:"#422006",points:90, flat:true}
];

const EGO_Z_REAR=1.24,EGO_Z_CENTER=1.48,EGO_Z_FRONT=1.78,EGO_HALF_LANE_W=0.33;

function resizeGameCanvas(){
    detectDeviceHardware();
    const wrapper=document.getElementById('gameViewportWrapper');
    const vv=window.visualViewport;
    const winW=Math.round(vv?vv.width:(window.innerWidth||document.documentElement.clientWidth||800));
    const winH=Math.round(vv?vv.height:(window.innerHeight||document.documentElement.clientHeight||450));
    let w=winW,h=winH;
    if(isMobileHardware&&winH>winW){
        w=winH;h=winW;
        if(wrapper){
            wrapper.style.position='fixed';wrapper.style.top='0px';wrapper.style.left=`${winW}px`;
            wrapper.style.width=`${winH}px`;wrapper.style.height=`${winW}px`;
            wrapper.style.transformOrigin='top left';wrapper.style.transform='rotate(90deg)';
        }
    }else if(wrapper){
        wrapper.style.position='fixed';wrapper.style.top='0px';wrapper.style.left='0px';
        wrapper.style.width=`${winW}px`;wrapper.style.height=`${winH}px`;
        wrapper.style.transformOrigin='';wrapper.style.transform='none';
    }
    const baseDpr=Math.min(window.devicePixelRatio||1,isMobileHardware?1.15:1.45);
    const effDpr=Math.max(0.6,Math.min(2.0,baseDpr*(gfxSettings.resScale||1.0)));
    canvas.width=Math.max(1,Math.floor(w*effDpr));
    canvas.height=Math.max(1,Math.floor(h*effDpr));
    ctx.setTransform(effDpr,0,0,effDpr,0,0);
    gameState.viewW=w;gameState.viewH=h;
    cachedGradients.key='';
}

function requestMobileFullscreenSafe(){
    if(!isMobileHardware||isPortalExiting)return;
    const docEl=document.documentElement;
    if(!document.fullscreenElement&&docEl.requestFullscreen){
        docEl.requestFullscreen({navigationUI:'hide'}).then(()=>{
            if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(()=>{});
            setTimeout(resizeGameCanvas,50);setTimeout(resizeGameCanvas,200);
        }).catch(()=>resizeGameCanvas());
    }else resizeGameCanvas();
}

document.addEventListener('fullscreenchange',()=>{
    resizeGameCanvas();
    setTimeout(resizeGameCanvas,120);
    setTimeout(resizeGameCanvas,300);
});

if(window.visualViewport){
    window.visualViewport.addEventListener('resize',resizeGameCanvas);
    window.visualViewport.addEventListener('scroll',resizeGameCanvas);
}

function triggerEpoch250BigRedWarning(){
    gameState.ep250WarnTriggered=true;
    gameState.ep250WarnTimer=3.0;
    document.getElementById('epoch250RedAlertModal').style.display='flex';
    playGameSfx('siren250');
}

function startGameSession(startEpochOverride=1){
    if(isPortalExiting)return;
    hasTrustedGesture=true;
    isBootSplashDismissed=true;
    const gate=document.getElementById('bootSplashGateModal');
    if(gate)gate.style.display='none';
    ensureAudioEngine();
    menuUnlockAudio.pause();

    const loginRow=document.getElementById('pilotLoginInputRow');
    const idInp=document.getElementById('pilotIdInput');
    const gInp=document.getElementById('guestCallsignInput');
    const rawId=(idInp?idInp.value:'').trim();
    const rawName=(gInp?gInp.value:'').trim();

    if(loginRow&&!loginRow.classList.contains('hidden')&&(rawId||rawName)){
        const matchedCore=resolveCorePilotFromInputs(rawId,rawName);
        if(matchedCore){
            customGuestId="";
            localStorage.removeItem('roadSense_overdrive_customGuestId');
            applyPilotProfile(matchedCore);
            if(idInp)idInp.value='';
        }else if(!currentPilot.isCore){
            if(/^\d{4}$/.test(rawId)&&!CORE_IDS.has(rawId)){
                customGuestId=rawId;
                localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
            }else{
                ensureGuestHas4DigitId();
            }
            if(rawName)updateGuestCallsign(rawName);
            applyPilotProfile("GUEST");
        }
    }else if(!currentPilot.isCore){
        ensureGuestHas4DigitId();
    }

    requestMobileFullscreenSafe();
    resizeGameCanvas();
    if(controlConfig.mobileMode==='tilt')calibrateTiltSensor(true);

    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    ['startModal','pauseSettingsModal','leaderboardModal','gameOverModal','epoch250RedAlertModal'].forEach(id=>document.getElementById(id).style.display='none');
    try{if(isMobileHardware)history.pushState({inGame:true},'');}catch(e){}

    const initEpoch=Math.max(1,Math.floor(startEpochOverride||1));
    Object.assign(gameState,{
        running:true,paused:false,score:0,epoch:initEpoch,combo:1.0,nearMisses:0,
        armor:100,nitroFuel:100,empCharge:100,distanceM:getDistanceForEpoch(initEpoch),
        speedMps:25,targetLane:0,egoLaneX:0,egoRoll:0,boosting:false,braking:false,
        slowMoTimer:0,empWaveRadius:0,screenShake:0,ep250WarnTriggered:(initEpoch>250),
        ep250WarnTimer:0,hazards:[],pickups:[],FloatingTexts:[]
    });
    nextMenuNoteTime=0;
    nextSynthNoteTime=0;
    syncBiomeForCurrentEpoch(true);
    if(initEpoch===249||initEpoch===250)triggerEpoch250BigRedWarning();
    syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(true);
    updateHudDOM(true);renderMiniRadar();syncCursorVisibility();
}

function syncBiomeForCurrentEpoch(isInitial=false){
    const alertBanner=document.getElementById('singularityAlertBanner');
    if(gameState.epoch===250){
        biomeIdx=EPOCH_250_INDEX;cachedGradients.key='';
        if(alertBanner)alertBanner.style.display='flex';
        if(!gameState.ep250WarnTriggered)triggerEpoch250BigRedWarning();
    }else{
        if(alertBanner)alertBanner.style.display='none';
        if(gameState.epoch===251&&!isInitial){
            saveActiveAccountStats(gameState.score,251,0);
            spawnFloatingText("🏆 EPOCH 250 SURVIVED! COSMIC SINGULARITY UNLOCKED!","#fbbf24",0,-60);
        }
        if(autoCycleBiomes){
            const poolCount=isBiomeUnlockedForPilot(EPOCH_250_INDEX)?14:13;
            const nextIdx=Math.floor((gameState.epoch-1)/10)%poolCount;
            if(nextIdx!==biomeIdx||isInitial){
                biomeIdx=nextIdx;
                cachedGradients.key='';
                if(!isInitial)spawnFloatingText(`🌍 DIMENSION SHIFT: ${BIOME_THEMES[biomeIdx].label.toUpperCase()}`,"#38bdf8",0,-50);
            }
        }
    }
    setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
}

function exitGamePortal(){
    isPortalExiting=true;
    hasTrustedGesture=false;
    gameState.running=false;
    gameState.paused=true;
    if(synthLoopTimer){clearInterval(synthLoopTimer);synthLoopTimer=null;}
    try{menuUnlockAudio.pause();menuUnlockAudio.src='';}catch(e){}
    try{mitadruAudio.pause();customAudio.pause();}catch(e){}
    if(audioCtx){
        try{audioCtx.suspend();audioCtx.close();}catch(e){}
        audioCtx=null;
    }
    if(document.fullscreenElement&&document.exitFullscreen){
        try{document.exitFullscreen().catch(()=>{});}catch(e){}
    }
    syncCursorVisibility();
    try{window.open('','_self','');window.close();}catch(e){}
    setTimeout(()=>{
        try{window.location.replace('about:blank');}catch(e){}
        document.body.innerHTML=`<div style="position:fixed;inset:0;background:#03050a;color:#94a3b8;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;text-align:center;padding:24px;"><div style="color:#38bdf8;font-weight:800;font-size:16px;margin-bottom:8px;">ROADSENSE INTERCEPTOR OFFLINE</div><div style="font-size:12px;">Telemetry &amp; Audio Powered Down. You may now close this tab.</div></div>`;
    },80);
}

function checkPhantomFlashNearMiss(prevLane){
    for(let i=0;i<gameState.hazards.length;i++){
        const h=gameState.hazards[i];
        if(!h.nearMissed&&Math.abs(h.lane-prevLane)<0.72&&h.z>EGO_Z_REAR&&h.z<10.5){
            h.nearMissed=true;gameState.nearMisses++;
            gameState.combo=Math.min(8.0,+(gameState.combo+0.5).toFixed(1));
            const bonus=Math.round(250*gameState.combo);
            gameState.score+=bonus;
            gameState.nitroFuel=Math.min(100,gameState.nitroFuel+18);
            gameState.empCharge=Math.min(100,gameState.empCharge+14);
            if(gfxSettings.transitions)gameState.slowMoTimer=0.42;
            playGameSfx('phantom');
            spawnFloatingText(`⚡ PHANTOM FLASH +${bonus}`,"#00f5d4",0,-45);
            break;
        }
    }
}

function steerLane(dir){if(gameState.running&&!gameState.paused)setDiscreteTargetLane(Math.round(gameState.targetLane)+dir);}
function setBoosting(active){
    const nextBoost=(active&&gameState.nitroFuel>2);
    if(nextBoost&&!gameState.boosting&&gameState.running&&!gameState.paused){
        playGameSfx('nitro');
    }
    gameState.boosting=nextBoost;
}
function setBraking(active){gameState.braking=active;}

function triggerNeuralEmp(){
    if(!gameState.running||gameState.paused)return;
    if(gameState.empCharge<100){spawnFloatingText("⚡ EMP CHARGING...","#94a3b8",0,-20);return;}
    gameState.empCharge=0;gameState.empWaveRadius=1;
    if(gfxSettings.shake)gameState.screenShake=8;
    playGameSfx('emp');
    const cleared=gameState.hazards.length,bonus=cleared*Math.round(160*gameState.combo);
    gameState.score+=bonus;gameState.hazards=[];
    spawnFloatingText(`⚡ NEURAL EMP VAPORIZED ${cleared} HAZARDS! +${bonus}`,"#38bdf8",0,-60);
    updateHudDOM(true);
}

function spawnFloatingText(text,color,ox=0,oy=0){
    if(!gfxSettings.transitions)return;
    if(gameState.FloatingTexts.length>4)gameState.FloatingTexts.shift();
    gameState.FloatingTexts.push({text,color,x:(gameState.viewW||800)*0.5+ox,y:(gameState.viewH||450)*0.42+oy,life:1.0});
}

function projectX(laneOffset,zSafe,W,H,roadCurve=0){
    const scale=(H*0.85)/zSafe;
    const zNorm=zSafe*0.0181818;
    const curveShift=roadCurve*(zNorm*zNorm)*(W*0.22);
    const worldX=(laneOffset-gameState.egoLaneX*0.32)*LANE_WIDTH_M;
    return W*0.5+worldX*scale*0.24+curveShift;
}

function projectY(zSafe,yMeters,H){
    const scale=(H*0.85)/zSafe;
    return(H*0.42)+(1.72-yMeters)*scale*0.36;
}

function updateGamePhysics(dt,now){
    if(!gameState.running||gameState.paused)return;
    if(gameState.ep250WarnTimer>0){
        gameState.ep250WarnTimer=Math.max(0,gameState.ep250WarnTimer-dt);
        if(gameState.ep250WarnTimer<=0)document.getElementById('epoch250RedAlertModal').style.display='none';
    }
    const activeDiffKey=(gameState.epoch===250)?'void':currentDiffKey;
    const diff=DIFFICULTY_PRESETS[activeDiffKey]||DIFFICULTY_PRESETS.easy;
    let timeScale=1.0;
    if(gameState.slowMoTimer>0){gameState.slowMoTimer=Math.max(0,gameState.slowMoTimer-dt);timeScale=0.50;}
    const effDt=dt*timeScale;

    const distTo250=(249*70)-gameState.distanceM;
    if(!gameState.ep250WarnTriggered&&distTo250>0&&distTo250<=gameState.speedMps*3.1)triggerEpoch250BigRedWarning();

    const prevEpoch=gameState.epoch;
    gameState.epoch=getEpochFromDistance(gameState.distanceM);
    if(gameState.epoch!==prevEpoch)syncBiomeForCurrentEpoch(false);

    const levelScale=Math.max(0.55,1.0-Math.min(0.45,(gameState.epoch-1)*0.0025));
    if(gameState.boosting){
        gameState.nitroFuel=Math.max(0,gameState.nitroFuel-dt*24);
        if(gameState.nitroFuel<=0)gameState.boosting=false;
    }else{
        gameState.nitroFuel=Math.min(100,gameState.nitroFuel+dt*diff.nitroRegen*levelScale);
    }
    gameState.empCharge=Math.min(100,gameState.empCharge+dt*diff.empRegen*levelScale);

    const endlessSpeedBonus=Math.min(15,Math.log2(1+gameState.epoch)*2.1);
    const baseCruise=(24+endlessSpeedBonus)*diff.speedMul;
    const targetSpeed=gameState.boosting?baseCruise*1.44:(gameState.braking?baseCruise*0.52:baseCruise);

    gameState.speedMps+=(targetSpeed-gameState.speedMps)*(1-Math.exp(-8*dt));
    gameState.distanceM+=gameState.speedMps*effDt;
    gameState.score+=Math.round(gameState.speedMps*effDt*gameState.combo*diff.scoreMul*1.35);
    updateEngineSoundPitch();

    gameState.targetLane=Math.max(-2,Math.min(2,Math.round(gameState.targetLane)));
    const laneDiff=gameState.targetLane-gameState.egoLaneX;
    const smoothAlpha=1-Math.exp(-18*dt);
    if(Math.abs(laneDiff)<0.003){
        gameState.egoLaneX=gameState.targetLane;
        gameState.egoRoll*=Math.exp(-16*dt);
    }else{
        gameState.egoLaneX+=laneDiff*smoothAlpha;
        const targetRoll=Math.max(-0.14,Math.min(0.14,laneDiff*0.12));
        gameState.egoRoll+=(targetRoll-gameState.egoRoll)*(1-Math.exp(-16*dt));
    }

    if(gameState.screenShake>0)gameState.screenShake=Math.max(0,gameState.screenShake-dt*28);
    if(gameState.empWaveRadius>0){gameState.empWaveRadius+=dt*1400;if(gameState.empWaveRadius>1500)gameState.empWaveRadius=0;}

    spawnAccumulator+=gameState.speedMps*effDt;
    const spawnInterval=Math.max(17.0,diff.spawnMeters-Math.min(8.5,Math.log2(1+gameState.epoch)*1.25));
    if(spawnAccumulator>=spawnInterval){
        spawnAccumulator=0;
        const occupied=new Set();
        for(let i=0;i<gameState.hazards.length;i++)if(gameState.hazards[i].z>46)occupied.add(Math.round(gameState.hazards[i].lane));
        const free=LANES.filter(l=>!occupied.has(l));
        if(free.length>=2){
            const cls=IDD_HAZARD_CLASSES[Math.floor(Math.random()*IDD_HAZARD_CLASSES.length)];
            const lane=free[Math.floor(Math.random()*free.length)];
            gameState.hazards.push({cls,lane,baseLane:lane,z:60.0,speedMps:cls.speedMul*baseCruise*0.52,dgi:+(Math.random()*0.18+0.02).toFixed(2),phase:Math.random()*Math.PI*2,nearMissed:false});
        }
    }

    pickupAccumulator+=gameState.speedMps*effDt;
    if(pickupAccumulator>=(diff.pickupSpacing/levelScale)&&gameState.pickups.length<2){
        pickupAccumulator=0;
        const rng=Math.random();
        gameState.pickups.push({lane:LANES[Math.floor(Math.random()*LANES.length)],z:58.0,type:rng<0.3333?'nitro':(rng<0.6667?'emp':'hull'),spin:0});
    }

    const hitThresh=0.56+(diff.hitboxScale-0.75)*0.50;
    for(let i=gameState.hazards.length-1;i>=0;i--){
        const h=gameState.hazards[i];
        h.z-=Math.max(4,gameState.speedMps-h.speedMps)*effDt;
        h.lane=h.baseLane;
        if(h.z<=EGO_Z_FRONT+0.35&&h.z>=EGO_Z_REAR-0.22){
            const latDist=Math.min(Math.abs(h.lane-gameState.egoLaneX),Math.abs(h.lane-gameState.targetLane));
            if(latDist<hitThresh){
                playGameSfx('hit');
                if(gfxSettings.shake)gameState.screenShake=9;
                gameState.combo=1.0;
                const dmg=Math.round((h.cls.flat?12:19)*diff.hitboxScale);
                gameState.armor=Math.max(0,gameState.armor-dmg);
                spawnFloatingText(`💥 IMPACT: ${h.cls.name.toUpperCase()} (-${dmg}% HULL)`,"#ef4444",0,-30);
                gameState.hazards.splice(i,1);
                updateHudDOM(true);
                if(gameState.armor<=0){triggerGameOver();return;}
                continue;
            }
        }
        if(h.z<0.70){gameState.score+=Math.round(h.cls.points*gameState.combo*diff.scoreMul);gameState.hazards.splice(i,1);}
    }

    const fillMul=diff.pickupScale*levelScale;
    for(let i=gameState.pickups.length-1;i>=0;i--){
        const p=gameState.pickups[i];
        p.z-=gameState.speedMps*effDt;p.spin+=dt*4.5;
        if(p.z<=EGO_Z_FRONT+0.8&&p.z>=EGO_Z_REAR-0.35&&Math.abs(p.lane-gameState.egoLaneX)<0.68){
            playGameSfx('pickup');
            if(p.type==='nitro'){
                const g=Math.max(15,Math.round(42*fillMul));
                gameState.nitroFuel=Math.min(100,gameState.nitroFuel+g);gameState.score+=Math.round(280*gameState.combo);
                spawnFloatingText(`🟨 NITRO CORE +${g}% NITRO`,"#fbbf24",0,-38);
            }else if(p.type==='emp'){
                const g=Math.max(14,Math.round(38*fillMul));
                gameState.empCharge=Math.min(100,gameState.empCharge+g);gameState.score+=Math.round(280*gameState.combo);
                spawnFloatingText(`🟦 EMP CORE +${g}% EMP`,"#38bdf8",0,-38);
            }else{
                const g=Math.max(10,Math.round(26*fillMul));
                gameState.armor=Math.min(100,gameState.armor+g);gameState.score+=Math.round(280*gameState.combo);
                spawnFloatingText(`🟩 HULL NANITES +${g}% HULL`,"#10b981",0,-38);
            }
            gameState.pickups.splice(i,1);updateHudDOM(true);continue;
        }
        if(p.z<0.70)gameState.pickups.splice(i,1);
    }

    for(let i=gameState.FloatingTexts.length-1;i>=0;i--){
        const ft=gameState.FloatingTexts[i];
        ft.y-=dt*42;ft.life-=dt*1.15;
        if(ft.life<=0)gameState.FloatingTexts.splice(i,1);
    }

    if(now-lastHudUpdateTime>=100){
        lastHudUpdateTime=now;
        updateHudDOM(false);
        if(!isHudHidden)renderMiniRadar();
    }
}

// High score & leaderboard are updated ONLY when the endless run ends (when you die)
function triggerGameOver(){
    gameState.running=false;gameState.ep250WarnTimer=0;
    nextSynthNoteTime=0;nextMenuNoteTime=0;
    document.getElementById('epoch250RedAlertModal').style.display='none';
    syncExternalTrackPlayback();updateEngineSoundPitch();

    const finalRunScore=Math.max(0,Math.round(gameState.score||0));
    const finalRunEpoch=Math.max(1,Math.round(gameState.epoch||1));
    saveActiveAccountStats(finalRunScore,finalRunEpoch,gameState.nearMisses);
    recordScoreToLeaderboard(finalRunScore,finalRunEpoch,true);

    const st=getActiveAccountStats();
    const overallBest=Math.max(st.bestScore||0,finalRunScore);
    document.getElementById('finalScoreVal').innerText=finalRunScore.toLocaleString();
    document.getElementById('finalBestVal').innerText=overallBest.toLocaleString();
    document.getElementById('finalEpochVal').innerText=`Epoch ${finalRunEpoch} • ${BIOME_THEMES[biomeIdx].label}`;
    document.getElementById('finalNearMissVal').innerText=String(gameState.nearMisses);
    refreshAccountStatsUI();
    document.getElementById('gameOverModal').style.display='flex';
    syncCursorVisibility();
}

function updateHudDOM(force=false){
    if(isHudHidden&&!force)return;
    setTextCached('hudScore',String(gameState.score).padStart(6,'0'));
    setTextCached('hudEpoch',`EP ${gameState.epoch}`);
    setTextCached('hudCombo',`${gameState.combo.toFixed(1)}x`);
    setTextCached('hudSpeedKmh',`${Math.round(gameState.speedMps*3.6)} km/h`);
    setStyleWidthCached('hudArmorBar',`${gameState.armor}%`);
    setTextCached('hudArmorPct',`${gameState.armor}%`);

    const nitroPct=Math.max(0,Math.min(100,Math.floor(gameState.nitroFuel)));
    const empPct=Math.max(0,Math.min(100,Math.floor(gameState.empCharge)));
    setTextCached('hudNitroPct',`${nitroPct}%`);setStyleWidthCached('hudNitroBar',`${nitroPct}%`);
    setTextCached('hudEmpPct',empPct>=100?"READY!":`${empPct}%`);setStyleWidthCached('hudEmpBar',`${empPct}%`);

    let lead=null,maxRisk=0;
    for(let i=0;i<gameState.hazards.length;i++){
        const h=gameState.hazards[i];
        const latDiff=Math.abs(h.lane-gameState.egoLaneX);
        const distRisk=Math.max(0,Math.min(1,1-(h.z-2)/50));
        const overlap=Math.max(0,1-latDiff/1.2);
        const ttc=h.z/Math.max(1,gameState.speedMps-h.speedMps);
        const ttcRisk=ttc<=1.8?1.0:Math.max(0,(6.0-ttc)/4.2);
        const rFinal=Math.min(1,0.35*distRisk+0.35*ttcRisk+0.30*overlap);
        h.rFinal=rFinal;h.ttc=ttc;
        if(rFinal>maxRisk){maxRisk=rFinal;lead=h;}
    }
    const riskPct=Math.round(maxRisk*100);
    const warnTier=riskPct>=85?'CRITICAL':(riskPct>=65?'WARNING':(riskPct>=35?'CAUTION':'CLEAR'));
    if(domCache.warnTier!==warnTier){
        domCache.warnTier=warnTier;
        const wb=document.getElementById('hudWarningBadge');
        if(wb){
            wb.innerText=warnTier;
            wb.className=warnTier==='CRITICAL'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-red-950 text-red-400 border border-red-500 whitespace-nowrap shrink-0":(warnTier==='WARNING'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-orange-950 text-orange-400 border border-orange-500 whitespace-nowrap shrink-0":(warnTier==='CAUTION'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500 whitespace-nowrap shrink-0":"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 whitespace-nowrap shrink-0"));
        }
    }
    if(lead){
        setTextCached('hudLeadName',`${lead.cls.name.toUpperCase()} (${lead.z.toFixed(1)}m)`);
        setTextCached('hudLeadTtc',`${lead.ttc.toFixed(1)}s`);
        setTextCached('hudLeadDgi',String(lead.dgi));
    }else{
        setTextCached('hudLeadName',"CLEAR");setTextCached('hudLeadTtc',"STABLE");setTextCached('hudLeadDgi',"0.00");
    }
}

function renderMiniRadar(){
    const w=radarCanvas.width,h=radarCanvas.height,cx=w*0.5,cy=h-7;
    rCtx.clearRect(0,0,w,h);
    rCtx.strokeStyle='#1e2638';rCtx.lineWidth=1;
    rCtx.beginPath();
    rCtx.arc(cx,cy,20,Math.PI,0,false);rCtx.arc(cx,cy,40,Math.PI,0,false);rCtx.arc(cx,cy,60,Math.PI,0,false);
    rCtx.stroke();
    rCtx.fillStyle=activeLiveryProfile.dotColor;rCtx.fillRect(cx-3,cy-5,6,5);
    radarAngle+=0.25;if(radarAngle>Math.PI*2)radarAngle=Math.PI;
    rCtx.beginPath();rCtx.moveTo(cx,cy);rCtx.lineTo(cx+Math.cos(radarAngle)*65,cy+Math.sin(radarAngle)*65);
    rCtx.strokeStyle='rgba(56,189,248,0.35)';rCtx.stroke();
    for(let i=0;i<gameState.hazards.length;i++){
        const hz=gameState.hazards[i];
        if(hz.z>55)continue;
        const bx=cx+(hz.lane-gameState.egoLaneX)*9,by=cy-hz.z*1.18;
        if(by>2&&by<h){
            rCtx.fillStyle=(hz.rFinal>=0.85)?'#ef4444':(hz.rFinal>=0.65?'#f97316':(hz.rFinal>=0.35?'#f59e0b':'#38bdf8'));
            rCtx.fillRect(bx-2,by-2,4,4);
        }
    }
}
// ==================== END OF CHUNK 5 OF 6 ====================
// ==================== START OF CHUNK 6 OF 6 ====================
// --- START OF MINI-CHUNK 6.1 OF 4 ---
['low','medium','high','ultra'].forEach(k=>{
    if(GRAPHICS_PRESETS[k])GRAPHICS_PRESETS[k].legacyModels=false;
});
if(typeof gfxSettings==='object'&&gfxSettings.legacyModels===undefined){
    gfxSettings.legacyModels=false;
}
if(Array.isArray(GFX_TOGGLE_META)&&!GFX_TOGGLE_META.some(m=>m.k==='legacyModels')){
    GFX_TOGGLE_META.push({k:'legacyModels',lbl:'👾 Legacy Models'});
}

function buildGraphicsUI(){
    const pGrid=document.getElementById('gfxPresetButtonsGrid');
    if(pGrid){
        pGrid.innerHTML=['low','medium','high','ultra'].map(k=>{
            const p=GRAPHICS_PRESETS[k];
            const active=(gfxSettings.preset===k);
            return `<button type="button" onclick="applyGraphicsPreset('${k}',true)" class="py-1.5 px-2 rounded-lg text-[10.5px] font-bold cursor-pointer border truncate ${active?'bg-sky-500 text-black border-sky-400':'bg-[#151a26] text-gray-300 border-[#262f45] hover:text-white'}">${p.title}</button>`;
        }).join('');
    }
    const tGrid=document.getElementById('gfxTogglesGrid');
    if(tGrid){
        tGrid.className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1";
        tGrid.innerHTML=GFX_TOGGLE_META.map(t=>`<button type="button" id="gfxToggle_${t.k}" onclick="toggleGfxOption('${t.k}')" class="p-1.5 rounded-lg text-[10px] font-bold cursor-pointer truncate"></button>`).join('');
        GFX_TOGGLE_META.forEach(t=>applyGfxOptionState(t.k,gfxSettings[t.k],false));
    }
    const fGrid=document.getElementById('gfxFilterButtonsGrid');
    const filters=[
        {k:'filter-standard',lbl:'✨ Standard Optic'},
        {k:'filter-requiem-noir',lbl:'🖤 RE: Requiem Noir'},
        {k:'filter-requiem-ash',lbl:'🌫️ RE: Requiem Ash'},
        {k:'filter-dl2-grit',lbl:'🌇 DL2: Harran Grit'},
        {k:'filter-dl2-darkzone',lbl:'🌑 DL2: Darkzone'},
        {k:'filter-stark-mono',lbl:'⚡ High-Contrast B&W'}
    ];
    if(fGrid){
        fGrid.innerHTML=filters.map(f=>`<button type="button" onclick="setVisualFilter('${f.k}')" id="flt_${f.k}" class="p-2 rounded-lg text-[10.5px] font-semibold cursor-pointer truncate"></button>`).join('');
        setVisualFilter(gfxSettings.filter,false);
    }
}

function loadOrResetSettingsForActiveAccount(){
    isApplyingAccountSettings=true;
    try{
        const allSet=JSON.parse(localStorage.getItem(SETTINGS_PER_ACC_KEY)||'{}');
        const saved=allSet[getActiveAccountStorageKey()];
        if(saved){
            setDifficulty(saved.diff||'easy');
            if(saved.liveryId&&(currentPilot.id==='1117'||saved.liveryId===currentPilot.id)){
                activeLiveryProfile=PILOT_PROFILES[saved.liveryId]||currentPilot;
            }else{
                activeLiveryProfile=currentPilot;
            }
            biomeIdx=isBiomeUnlockedForPilot(saved.biomeIdx||0)?(saved.biomeIdx||0):0;
            autoCycleBiomes=saved.autoCycleBiomes!==undefined?Boolean(saved.autoCycleBiomes):true;
            syncAutoBiomeButtonUI();
            setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
            if(saved.audio){
                ['master','music','menuMusic','engine','sfx','uiClick'].forEach(ch=>{
                    if(saved.audio[ch]!==undefined)updateVolumeSetting(ch,Math.round(saved.audio[ch]*100));
                });
                selectOstMode(saved.audio.ostMode==='mitadru'&&currentPilot.id!=='1117'?'synth':(saved.audio.ostMode||'synth'));
            }
            if(saved.ctrl){
                setMobileControlMode(saved.ctrl.mobileMode||'buttons');
                applyDoubleTapNitroState(saved.ctrl.doubleTapNitro!==false);
                controlConfig.invertGyro=Boolean(saved.ctrl.invertGyro);
                const invBtn=document.getElementById('invertGyroBtn');
                if(invBtn){
                    invBtn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;
                    invBtn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";
                }
                updateGyroSpeedSetting(Math.round((saved.ctrl.gyroSensitivity||0.65)*100));
                if(saved.ctrl.binds)controlConfig.binds=saved.ctrl.binds;
                refreshKeybindLabels();
            }
            if(saved.gfx){
                applyGraphicsPreset(saved.gfx.preset||'medium',false);
                if(saved.gfx.resScale)updateGfxResolution(Math.round(saved.gfx.resScale*100),false);
                if(saved.gfx.roadSlices)updateGfxDrawSlices(saved.gfx.roadSlices,false);
                if(saved.gfx.particles!==undefined)updateGfxParticles(Math.round(saved.gfx.particles*100),false);
                ['bloom','shake','transitions','scanlines','pillars','reflections','speedLines','hudBoxes','legacyModels'].forEach(k=>{
                    if(saved.gfx[k]!==undefined)applyGfxOptionState(k,saved.gfx[k],false);
                });
                setVisualFilter(saved.gfx.filter||'filter-standard',false);
            }
        }else{
            resetGameSettingsOnly();
            resetSoundSettingsOnly();
            resetControlSettingsOnly();
            resetGraphicsSettingsOnly();
        }
    }catch(e){}
    isApplyingAccountSettings=false;
    saveSettingsForActiveAccount();
}

function resetGraphicsSettingsOnly(){
    gfxSettings.legacyModels=false;
    setVisualFilter('filter-standard',false);
    applyGraphicsPreset('medium',true);
}

function adminDeleteAllGuestAccounts(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase();
    const delSet=new Set(sanitizeDeletedAccountKeys());
    Object.keys(db).forEach(k=>{
        if(!CORE_IDS.has(k)){
            delSet.add(k);
            delete db[k];
        }
    });
    getLocalLeaderboard().forEach(e=>{
        const k=normalizeEntryAccountKey(e);
        if(!CORE_IDS.has(k))delSet.add(k);
    });
    saveDeletedAccountKeys(Array.from(delSet));
    saveAccountsDatabase(db);
    const coreOnly=getLocalLeaderboard().filter(e=>CORE_IDS.has(normalizeEntryAccountKey(e)));
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(coreOnly));
    reconcileAllPilotScores();
    pushCloudLeaderboardPacket();
    renderLeaderboardList();
    refreshAccountStatsUI();
    showDevConsoleFeedback("✓ All Guest Accounts & Guest Scores Deleted!");
    playGameSfx('pickup');
}

function upgradeEpoch250HologramWarningUI(){
    if(!document.getElementById('holoKlaxonStyleTag')){
        const st=document.createElement('style');
        st.id='holoKlaxonStyleTag';
        st.textContent=`
            @keyframes holoHudPulse {
                0%, 100% {
                    border-color: rgba(244, 63, 94, 0.72);
                    box-shadow: 0 0 18px rgba(244, 63, 94, 0.25), inset 0 0 14px rgba(0, 245, 212, 0.14);
                    transform: translateY(0px) scale(1);
                }
                50% {
                    border-color: rgba(0, 245, 212, 0.85);
                    box-shadow: 0 0 26px rgba(0, 245, 212, 0.35), inset 0 0 18px rgba(244, 63, 94, 0.22);
                    transform: translateY(1px) scale(1.015);
                }
            }
            .holo-top-klaxon {
                background: linear-gradient(180deg, rgba(24, 6, 14, 0.24) 0%, rgba(8, 20, 34, 0.16) 100%) !important;
                backdrop-filter: blur(2px);
                -webkit-backdrop-filter: blur(2px);
                border: 1px solid rgba(244, 63, 94, 0.7);
                animation: holoHudPulse 0.55s ease-in-out infinite !important;
                text-shadow: 0 0 8px rgba(0, 0, 0, 0.95), 0 0 12px rgba(244, 63, 94, 0.75);
            }
        `;
        document.head.appendChild(st);
    }

    const modal=document.getElementById('epoch250RedAlertModal');
    if(modal){
        modal.className='absolute inset-x-0 top-10 sm:top-13 z-[45] flex items-start justify-center pointer-events-none px-3';
        modal.innerHTML=`
            <div class="holo-top-klaxon rounded-xl px-3.5 py-1.5 sm:px-5 sm:py-2 max-w-xs sm:max-w-md w-full text-center space-y-0.5 relative overflow-hidden">
                <div class="text-[8.5px] sm:text-[10px] mono-num font-extrabold text-cyan-300 tracking-widest uppercase flex items-center justify-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping"></span>
                    <span>HOLO-ALERT // SINGULARITY BREACH</span>
                    <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                </div>
                <div class="title-cinzel text-xs sm:text-base font-black text-white tracking-wider leading-tight">WARNING: EPOCH 250 INBOUND</div>
                <div class="text-[8px] sm:text-[9.5px] mono-num font-bold text-amber-300/95 uppercase tracking-wider">VOID MAX OVERDRIVE &bull; 800M HORIZON</div>
            </div>
        `;
    }

    const banner=document.getElementById('singularityAlertBanner');
    if(banner){
        banner.className='hud-collapsible absolute top-10 sm:top-13 inset-x-0 z-25 flex justify-center pointer-events-none px-3';
        banner.innerHTML=`
            <div class="px-3 py-0.5 sm:px-4 sm:py-1 rounded-lg bg-purple-950/25 border border-cyan-400/65 text-cyan-200 mono-num text-[8.5px] sm:text-[10.5px] font-extrabold tracking-wider uppercase shadow-[0_0_14px_rgba(0,245,212,0.25)] backdrop-blur-[1.5px] text-center">
                🌌 EPOCH 250 SINGULARITY ACTIVE — VOID MAX (800M) 🌌
            </div>
        `;
    }
}

function triggerEpoch250BigRedWarning(){
    upgradeEpoch250HologramWarningUI();
    gameState.ep250WarnTriggered=true;
    gameState.ep250WarnTimer=2.6;
    const modal=document.getElementById('epoch250RedAlertModal');
    if(modal)modal.style.display='flex';
    playGameSfx('siren250');
}

// Exact road projection from 1.html / 1.js (narrow at horizon -> slanting out left/right to wide at bottom on PC & Mobile)
function projectX(laneOffset,zSafe,W,H,roadCurve=0){
    const scale=(H*0.85)/zSafe;
    const zNorm=zSafe*0.0181818;
    const curveShift=roadCurve*(zNorm*zNorm)*(W*0.22);
    const worldX=(laneOffset-gameState.egoLaneX*0.82)*LANE_WIDTH_M;
    return W*0.5+worldX*scale*0.24+curveShift;
}

const REAL_LIFE_HAZARD_DIMS={
    0:{w:20,h:22}, // auto_rickshaw
    1:{w:28,h:29}, // bus_truck
    2:{w:24,h:21}, // car
    3:{w:13,h:21}, // two_wheeler
    4:{w:13,h:22}, // pedestrian
    5:{w:18,h:17}, // stray_animal
    6:{w:22,h:10}, // pothole
    7:{w:26,h:9}   // speed_bump
};

// 🔧 PER-CLASS LANE PROPORTIONS & STOPPERS:
// laneFrac = fraction of 1 lane width occupied by this class (grows with the lane from z=60m so it NEVER shrinks)
// zStop    = depth where full growth stops so no class ever balloons larger than your Roadster
const CLASS_SCALE_STOPPERS={
    0:{laneFrac:0.38,zStop:2.25,unitW:20}, // auto_rickshaw
    1:{laneFrac:0.48,zStop:2.35,unitW:28}, // bus_truck
    2:{laneFrac:0.44,zStop:2.20,unitW:24}, // car
    3:{laneFrac:0.26,zStop:2.30,unitW:13}, // two_wheeler
    4:{laneFrac:0.24,zStop:2.35,unitW:13}, // pedestrian
    5:{laneFrac:0.27,zStop:2.40,unitW:18}, // stray_animal
    6:{laneFrac:0.46,zStop:2.20,unitW:22}, // pothole
    7:{laneFrac:0.56,zStop:2.15,unitW:26}, // speed_bump
    pickup:{laneFrac:0.22,zStop:2.30,unitW:12} // Nitro, EMP & Hull particles (2 * r = 12 * s)
};

let activeRenderClassKey='pickup';

function getRigidPerspectiveScale(zSafe,W,H,classKeyOverride){
    const key=(classKeyOverride!==undefined)?classKeyOverride:activeRenderClassKey;
    activeRenderClassKey='pickup';
    const stopper=CLASS_SCALE_STOPPERS[key]||CLASS_SCALE_STOPPERS.pickup;

    const zClamped=Math.max(1.25,Math.min(60.0,zSafe));
    // Exact pixel width of 1 lane at this class's stopper depth (automatically scales on PC & Mobile)
    const laneWidthAtStopper=LANE_WIDTH_M*((H*0.85)/stopper.zStop)*0.24;
    const sAtStopper=(laneWidthAtStopper*stopper.laneFrac)/stopper.unitW;

    if(zClamped>=stopper.zStop){
        // From horizon (z=60) down to zStop: grows continuously with the road perspective so it NEVER shrinks
        return sAtStopper*Math.pow(stopper.zStop/zClamped,0.85);
    }
    // From zStop past your Roadster (z=1.25): damped stopper so it holds visual size without growing larger than your car
    return sAtStopper*Math.pow(stopper.zStop/zClamped,0.22);
}

let fairHazardBag=[];
let variantCounters={0:0,1:0,2:0,3:0,4:0,5:0,6:0,7:0};

function getNextFairHazardClass(){
    if(fairHazardBag.length===0){
        fairHazardBag=[0,1,2,3,4,5,6,7];
        for(let i=fairHazardBag.length-1;i>0;i--){
            const j=Math.floor(Math.random()*(i+1));
            const tmp=fairHazardBag[i];
            fairHazardBag[i]=fairHazardBag[j];
            fairHazardBag[j]=tmp;
        }
    }
    const nextId=fairHazardBag.pop();
    return IDD_HAZARD_CLASSES[nextId]||IDD_HAZARD_CLASSES[0];
}

function ensureHazardVariant(hz){
    if(hz&&hz.variantInit&&hz.cls){
        activeRenderClassKey=hz.cls.id;
        return;
    }
    hz.variantInit=true;

    hz.cls=getNextFairHazardClass();
    activeRenderClassKey=hz.cls.id;

    const activeDiffKey=(gameState.epoch===250)?'void':currentDiffKey;
    const diff=DIFFICULTY_PRESETS[activeDiffKey]||DIFFICULTY_PRESETS.easy;
    const endlessSpeedBonus=Math.min(15,Math.log2(1+gameState.epoch)*2.1);
    const baseCruise=(24+endlessSpeedBonus)*diff.speedMul;
    hz.speedMps=hz.cls.speedMul*baseCruise*0.52;

    const cid=hz.cls.id;
    const vCount=(variantCounters[cid]=(variantCounters[cid]||0)+1);
    const rngBit=(vCount+(Math.random()<0.35?1:0));

    if(cid===0){
        hz.variantIdx=rngBit%2;
        hz.palette=hz.variantIdx===0
            ?{roof:"#fde047",bodyTop:"#facc15",bodyBot:"#111827",trim:"#f59e0b",glass:"#7dd3fc"}
            :{roof:"#fde047",bodyTop:"#0ea5e9",bodyBot:"#0c4a6e",trim:"#38bdf8",glass:"#e0f2fe"};
    }else if(cid===1){
        hz.subType=(rngBit%2===0)?'bus':'truck';
        if(hz.subType==='bus'){
            hz.variantIdx=(vCount>>1)%2;
            hz.palette=hz.variantIdx===0
                ?{top:"#3b82f6",body:"#1d4ed8",bot:"#0f172a",stripe:"#38bdf8",trim:"#93c5fd"}
                :{top:"#f43f5e",body:"#dc2626",bot:"#1f080c",stripe:"#facc15",trim:"#fda4af"};
        }else{
            hz.variantIdx=(vCount>>1)%3;
            const truckPals=[
                {cab:"#f97316",cargo:"#c2410c",bot:"#1c0a04",trim:"#facc15"},
                {cab:"#10b981",cargo:"#047857",bot:"#041a13",trim:"#6ee7b7"},
                {cab:"#38bdf8",cargo:"#1d4ed8",bot:"#091024",trim:"#bae6fd"}
            ];
            hz.palette=truckPals[hz.variantIdx];
        }
    }else if(cid===2){
        hz.variantIdx=vCount%5;
        const carPals=[
            {top:"#0ea5e9",bot:"#0c4a6e",trim:"#38bdf8",canopy:"#bae6fd"},
            {top:"#ef4444",bot:"#7f1d1d",trim:"#fda4af",canopy:"#fecdd3"},
            {top:"#f59e0b",bot:"#78350f",trim:"#fde047",canopy:"#fef08a"},
            {top:"#10b981",bot:"#064e3b",trim:"#6ee7b7",canopy:"#a7f3d0"},
            {top:"#a855f7",bot:"#4c1d95",trim:"#d8b4fe",canopy:"#f3e8ff"}
        ];
        hz.palette=carPals[hz.variantIdx];
    }else if(cid===3){
        hz.variantIdx=vCount%3;
        const bikePals=[
            {main:"#22c55e",dark:"#065f46",trim:"#86efac",visor:"#00f5d4"},
            {main:"#ef4444",dark:"#7f1d1d",trim:"#fca5a5",visor:"#fde047"},
            {main:"#3b82f6",dark:"#1e3a8a",trim:"#c084fc",visor:"#38bdf8"}
        ];
        hz.palette=bikePals[hz.variantIdx];
    }else if(cid===4){
        hz.subType=(rngBit%2===0)?'boy':'girl';
        if(hz.subType==='boy'){
            hz.palette=((vCount>>1)%2===0)
                ?{top:"#0ea5e9",trim:"#7dd3fc",bottom:"#1e293b",hair:"#0f172a",skin:"#fed7aa"}
                :{top:"#ef4444",trim:"#fca5a5",bottom:"#0f172a",hair:"#1c1917",skin:"#fdba74"};
        }else{
            hz.palette=((vCount>>1)%2===0)
                ?{top:"#ec4899",trim:"#f9a8d4",bottom:"#1e1b4b",hair:"#1c1917",skin:"#fed7aa"}
                :{top:"#a855f7",trim:"#d8b4fe",bottom:"#0f172a",hair:"#27170e",skin:"#fdba74"};
        }
    }else if(cid===5){
        hz.subType=(rngBit%2===0)?'dog':'cat';
        if(hz.subType==='dog'){
            hz.palette=((vCount>>1)%2===0)
                ?{coat:"#f59e0b",dark:"#b45309",belly:"#fef3c7",collar:"#ef4444",outline:"#fde68a"}
                :{coat:"#d97706",dark:"#78350f",belly:"#ffedd5",collar:"#00f5d4",outline:"#fed7aa"};
        }else{
            hz.palette=((vCount>>1)%2===0)
                ?{coat:"#fb923c",dark:"#c2410c",belly:"#ffedd5",eye:"#4ade80",outline:"#fed7aa"}
                :{coat:"#cbd5e1",dark:"#475569",belly:"#ffffff",eye:"#facc15",outline:"#f8fafc"};
        }
    }else if(cid===7){
        hz.variantIdx=rngBit%2;
    }
}
// --- END OF MINI-CHUNK 6.1 OF 4 ---
// --- START OF MINI-CHUNK 6.2 OF 4 ---
function ensureCachedBiomeGradients(W,H,horizonY,theme){
    const key=`${W}_${H}_${biomeIdx}`;
    if(cachedGradients.key===key)return;
    cachedGradients.key=key;
    const skyGrad=ctx.createLinearGradient(0,0,0,H);
    skyGrad.addColorStop(0,theme.skyTop);
    skyGrad.addColorStop(0.42,theme.skyBot);
    skyGrad.addColorStop(0.43,theme.roadDark);
    skyGrad.addColorStop(1,theme.roadDark);
    cachedGradients.sky=skyGrad;

    const sunGrad=ctx.createRadialGradient(W*0.5,horizonY-16,6,W*0.5,horizonY-16,H*0.34);
    sunGrad.addColorStop(0,"#ffffff");
    sunGrad.addColorStop(0.26,theme.sun);
    sunGrad.addColorStop(1,"transparent");
    cachedGradients.sun=sunGrad;
}

function renderUniqueDimensionHorizon(W,H,horizonY,theme,now,dynamicWorldColor,cosmicHue){
    const cx=W*0.5;
    const hType=theme.horizonType||"cyber";
    const u=Math.min(W,H);

    if(hType==="cosmic250"||gameState.epoch===250){
        const cy=horizonY-22,bhR=u*0.115;
        if(gfxSettings.pillars){
            const jetW=bhR*0.44;
            ctx.fillStyle=`hsla(${cosmicHue},95%,65%,0.22)`;
            ctx.beginPath();ctx.moveTo(cx-jetW*0.2,cy);ctx.lineTo(cx-jetW*1.45,0);ctx.lineTo(cx+jetW*1.45,0);ctx.lineTo(cx+jetW*0.2,cy);ctx.fill();
            for(let p=-2;p<=2;p++){
                if(p===0)continue;
                const px=cx+p*(W*0.185);
                ctx.fillStyle=`hsla(${(cosmicHue+p*55+360)%360},95%,62%,0.15)`;
                ctx.fillRect(px-8,0,16,horizonY);
            }
        }
        ctx.fillStyle=cachedGradients.sun;
        ctx.beginPath();ctx.arc(cx,cy,bhR*2.75,0,Math.PI*2);ctx.fill();
        if(gfxSettings.pillars){
            ctx.save();ctx.translate(cx,cy);ctx.rotate(-0.14+Math.sin(now*0.0008)*0.04);
            for(let r=0;r<3;r++){
                ctx.strokeStyle=`hsla(${(cosmicHue+r*65)%360},95%,65%,${0.78-r*0.18})`;
                ctx.lineWidth=3-r*0.65;
                ctx.beginPath();ctx.ellipse(0,0,bhR*(1.55+r*0.38),bhR*(0.32+r*0.08),0,0,Math.PI*2);ctx.stroke();
            }
            ctx.restore();
        }
        ctx.fillStyle="#010006";ctx.beginPath();ctx.arc(cx,cy,bhR*0.88,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=dynamicWorldColor;ctx.lineWidth=2.8;ctx.beginPath();ctx.arc(cx,cy,bhR*0.90,0,Math.PI*2);ctx.stroke();
        return;
    }

    ctx.fillStyle=cachedGradients.sun;
    ctx.beginPath();ctx.arc(cx,horizonY-10,H*0.28,Math.PI,0,false);ctx.fill();

    if(hType==="cyber"){
        const sunR=u*0.135;
        if(gfxSettings.pillars){
            [-1,1].forEach((s,i)=>{
                const ang=Math.sin(now*0.0012+i)*0.28;
                ctx.fillStyle="rgba(56,189,248,0.10)";
                ctx.beginPath();ctx.moveTo(cx+s*W*0.22,horizonY);
                ctx.lineTo(cx+s*W*0.22+Math.sin(ang)*140-28,0);
                ctx.lineTo(cx+s*W*0.22+Math.sin(ang)*140+28,0);
                ctx.closePath();ctx.fill();
            });
        }
        ctx.save();
        ctx.beginPath();ctx.arc(cx,horizonY-2,sunR,Math.PI,0,false);ctx.clip();
        const sg=ctx.createLinearGradient(cx,horizonY-sunR,cx,horizonY);
        sg.addColorStop(0,"#00f5d4");sg.addColorStop(0.55,"#38bdf8");sg.addColorStop(1,"#ec4899");
        ctx.fillStyle=sg;ctx.fillRect(cx-sunR,horizonY-sunR-2,sunR*2,sunR+2);
        ctx.fillStyle=theme.skyBot;
        for(let s=0;s<7;s++){ctx.fillRect(cx-sunR,horizonY-s*(sunR*0.13)-3,sunR*2,1.8+s*0.65);}
        ctx.restore();
        const bCount=24,bw=W/bCount;
        for(let b=0;b<bCount;b++){
            const bx=b*bw,distC=Math.abs((bx+bw*0.5)-cx)/(W*0.5);
            const bh=(18+((b*41)%46))*(0.45+distC*0.75);
            ctx.fillStyle="#040710";ctx.fillRect(bx,horizonY-bh,bw+1,bh);
            ctx.strokeStyle="rgba(56,189,248,0.45)";ctx.lineWidth=1;ctx.strokeRect(bx,horizonY-bh,bw,bh);
            ctx.fillStyle=(b&1)?"#38bdf888":"#f472b688";
            ctx.fillRect(bx+3,horizonY-bh+4,Math.max(2,bw-6),2);
            if(bh>34){ctx.beginPath();ctx.moveTo(bx+bw*0.5,horizonY-bh);ctx.lineTo(bx+bw*0.5,horizonY-bh-12);ctx.stroke();}
        }
    }else if(hType==="monsoon"){
        if((Math.floor(now*0.009)%11)===0){
            ctx.strokeStyle="#a7f3d0";ctx.lineWidth=2.2;
            ctx.beginPath();ctx.moveTo(cx+W*0.12,0);ctx.lineTo(cx+W*0.09,horizonY*0.38);ctx.lineTo(cx+W*0.13,horizonY*0.52);ctx.lineTo(cx+W*0.07,horizonY);ctx.stroke();
        }
        const spanW=W*0.26,towerH=H*0.19,deckY=horizonY-H*0.045;
        ctx.strokeStyle="rgba(16,185,129,0.42)";ctx.lineWidth=1.2;
        for(let x=cx-spanW;x<=cx+spanW;x+=18){
            const norm=(x-cx)/spanW;
            const cableY=(horizonY-towerH)+(1-norm*norm)*(deckY-(horizonY-towerH)-6);
            ctx.beginPath();ctx.moveTo(x,cableY);ctx.lineTo(x,deckY);ctx.stroke();
        }
        ctx.strokeStyle="#10b981";ctx.lineWidth=2.4;
        ctx.beginPath();ctx.moveTo(cx-spanW,horizonY-towerH);ctx.quadraticCurveTo(cx,deckY-6,cx+spanW,horizonY-towerH);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0,deckY);ctx.lineTo(cx-spanW,horizonY-towerH);ctx.moveTo(cx+spanW,horizonY-towerH);ctx.lineTo(W,deckY);ctx.stroke();
        ctx.fillStyle="#041214";ctx.fillRect(0,deckY,W,4);
        [-1,1].forEach(s=>{
            const tx=cx+s*spanW;
            ctx.fillStyle="#061a1e";ctx.strokeStyle="#10b981";ctx.lineWidth=1.8;
            ctx.beginPath();ctx.moveTo(tx-12,horizonY);ctx.lineTo(tx-6,horizonY-towerH);ctx.lineTo(tx+6,horizonY-towerH);ctx.lineTo(tx+12,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="#34d399";ctx.beginPath();ctx.arc(tx,horizonY-towerH-3,3,0,Math.PI*2);ctx.fill();
        });
    }else if(hType==="solar"){
        const r=u*0.125,cy=horizonY-r*0.55;
        ctx.fillStyle="#fff7ed";ctx.strokeStyle="#f97316";ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(cx,cy,r,Math.PI*0.92,Math.PI*0.08,false);ctx.fill();ctx.stroke();
        ctx.strokeStyle="rgba(251,146,60,0.65)";ctx.lineWidth=2;
        for(let i=0;i<6;i++){
            const a=Math.PI+(i/5)*Math.PI+Math.sin(now*0.002+i)*0.08;
            ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,r*0.24,0,Math.PI*2);ctx.stroke();
        }
        [-1,1].forEach(s=>{
            const px=cx+s*(W*0.27),py=horizonY-H*0.11;
            if(gfxSettings.pillars){
                ctx.fillStyle="rgba(245,158,11,0.16)";
                ctx.fillRect(px-5,0,10,horizonY);
            }
            ctx.fillStyle="#1c080d";ctx.strokeStyle="#f59e0b";ctx.lineWidth=1.8;
            ctx.beginPath();
            ctx.moveTo(px,py-26);ctx.lineTo(px+22,py);ctx.lineTo(px,py+26);ctx.lineTo(px-22,py);
            ctx.closePath();ctx.fill();ctx.stroke();
            ctx.beginPath();ctx.moveTo(px-18,horizonY);ctx.lineTo(px,py+26);ctx.lineTo(px+18,horizonY);ctx.stroke();
        });
    }else if(hType==="cryo"){
        if(gfxSettings.pillars){
            for(let band=0;band<3;band++){
                ctx.strokeStyle=band===0?"rgba(56,189,248,0.34)":(band===1?"rgba(52,211,153,0.28)":"rgba(192,132,252,0.22)");
                ctx.lineWidth=12-band*3;
                ctx.beginPath();
                for(let x=0;x<=W;x+=32){
                    const y=horizonY*(0.22+band*0.12)+Math.sin(x*0.011+now*0.0016+band)*14;
                    if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
                }
                ctx.stroke();
            }
        }
        const peaks=[[-0.38,0.11],[-0.22,0.18],[-0.08,0.13],[0.0,0.22],[0.11,0.14],[0.25,0.19],[0.39,0.12]];
        peaks.forEach(([ox,oh])=>{
            const px=cx+ox*W,pw=W*0.13,ph=H*oh;
            ctx.fillStyle="#041529";ctx.strokeStyle="#7dd3fc";ctx.lineWidth=1.4;
            ctx.beginPath();ctx.moveTo(px-pw,horizonY);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="rgba(224,242,254,0.25)";
            ctx.beginPath();ctx.moveTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.lineTo(px+pw*0.15,horizonY);ctx.closePath();ctx.fill();
        });
    }else if(hType==="bio"){
        const mr=u*0.095,mcy=horizonY-mr*1.25;
        const pulse=1+Math.sin(now*0.0035)*0.08;
        if(gfxSettings.pillars){
            for(let b=-2;b<=2;b++){
                if(b===0)continue;
                const bx=cx+b*(W*0.18)+Math.sin(now*0.0015+b)*10;
                ctx.fillStyle="rgba(74,222,128,0.11)";
                ctx.fillRect(bx-5,0,10,horizonY);
            }
        }
        ctx.save();
        ctx.translate(cx,mcy);
        ctx.fillStyle="#032211";ctx.strokeStyle="#4ade80";ctx.lineWidth=2.2;
        ctx.beginPath();ctx.arc(0,0,mr*pulse,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="rgba(34,197,94,0.38)";
        ctx.beginPath();ctx.arc(0,0,mr*0.58*pulse,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#bbf7d0";
        ctx.beginPath();ctx.arc(0,0,mr*0.24*pulse,0,Math.PI*2);ctx.fill();
        for(let r=0;r<2;r++){
            ctx.save();
            ctx.rotate(now*(r===0?0.0012:-0.0015)+r*1.1);
            ctx.strokeStyle=r===0?"#4ade80":"#00f5d4";
            ctx.lineWidth=1.8;
            ctx.beginPath();ctx.ellipse(0,0,mr*1.48,mr*0.38,0,0,Math.PI*2);ctx.stroke();
            for(let n=0;n<6;n++){
                const a=(n/6)*Math.PI*2;
                ctx.fillStyle="#fef08a";
                ctx.beginPath();ctx.arc(Math.cos(a)*mr*1.48,Math.sin(a)*mr*0.38,2.5,0,Math.PI*2);ctx.fill();
            }
            ctx.restore();
        }
        ctx.restore();
        [-0.35,-0.20,0.20,0.35].forEach((ox,i)=>{
            const sway=Math.sin(now*0.0022+i)*6;
            const mx=cx+ox*W+sway,stemH=H*(i%2===0?0.10:0.145),capR=u*(i%2===0?0.052:0.072);
            const topY=horizonY-stemH;
            ctx.fillStyle="#041f11";ctx.strokeStyle="#22c55e";ctx.lineWidth=1.6;
            ctx.beginPath();
            ctx.moveTo(cx+ox*W-6,horizonY);
            ctx.quadraticCurveTo(mx-2,horizonY-stemH*0.5,mx-4,topY);
            ctx.lineTo(mx+4,topY);
            ctx.quadraticCurveTo(mx+2,horizonY-stemH*0.5,cx+ox*W+6,horizonY);
            ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="#06371c";ctx.strokeStyle="#4ade80";ctx.lineWidth=2;
            ctx.beginPath();ctx.ellipse(mx,topY,capR,capR*0.44,0,Math.PI,0,false);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.strokeStyle="rgba(187,247,208,0.45)";ctx.lineWidth=1;
            for(let g=-2;g<=2;g++){
                ctx.beginPath();ctx.moveTo(mx,topY-capR*0.38);ctx.lineTo(mx+g*(capR*0.36),topY);ctx.stroke();
                const tendrilH=10+Math.sin(now*0.004+i+g)*5;
                ctx.strokeStyle="rgba(0,245,212,0.55)";
                ctx.beginPath();ctx.moveTo(mx+g*(capR*0.32),topY);ctx.lineTo(mx+g*(capR*0.32)+sway*0.4,topY+tendrilH);ctx.stroke();
                ctx.strokeStyle="rgba(187,247,208,0.45)";
            }
        });
    }else if(hType==="eclipse"){
        const r=u*0.105,ecy=horizonY-r*1.12;
        ctx.strokeStyle="rgba(244,63,94,0.35)";ctx.lineWidth=8;
        ctx.beginPath();ctx.arc(cx,ecy,r*1.14,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle="#040002";ctx.strokeStyle="#fb7185";ctx.lineWidth=2.5;
        ctx.beginPath();ctx.arc(cx,ecy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(cx+r*0.72,ecy-r*0.68,5+Math.sin(now*0.005)*1.5,0,Math.PI*2);ctx.fill();
        for(let s=-5;s<=5;s++){
            if(s===0)continue;
            const sx=cx+s*(W*0.075),sh=H*(Math.abs(s)%2===1?0.15:0.10);
            ctx.fillStyle="#120307";ctx.strokeStyle="#f43f5e88";ctx.lineWidth=1.2;
            ctx.beginPath();ctx.moveTo(sx-10,horizonY);ctx.lineTo(sx-6,horizonY-sh*0.55);ctx.lineTo(sx,horizonY-sh);ctx.lineTo(sx+6,horizonY-sh*0.55);ctx.lineTo(sx+10,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
        }
    }else if(hType==="tachyon"){
        const coreY=horizonY-H*0.13,coreR=u*0.055;
        ctx.fillStyle="#1e0b3b";ctx.strokeStyle="#eab308";ctx.lineWidth=2.2;
        ctx.beginPath();ctx.arc(cx,coreY,coreR,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle="#c084fc";ctx.lineWidth=1.8;
        ctx.beginPath();ctx.ellipse(cx,coreY,coreR*1.65,coreR*0.45,now*0.002,0,Math.PI*2);ctx.stroke();
        [-1,1].forEach(s=>{
            const tx=cx+s*(W*0.24),th=H*0.17;
            ctx.fillStyle="#120726";ctx.strokeStyle="#c084fc";ctx.lineWidth=1.6;
            ctx.beginPath();ctx.moveTo(tx-14,horizonY);ctx.lineTo(tx-6,horizonY-th);ctx.lineTo(tx+6,horizonY-th);ctx.lineTo(tx+14,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            for(let r=1;r<=3;r++){
                const ry=horizonY-th*(0.28*r);
                ctx.strokeRect(tx-11,ry,22,4);
            }
            ctx.strokeStyle="#fde047";ctx.lineWidth=2;
            ctx.beginPath();ctx.moveTo(tx,horizonY-th);
            ctx.quadraticCurveTo((tx+cx)*0.5,coreY-18+Math.sin(now*0.018+s)*12,cx+s*coreR,coreY);ctx.stroke();
        });
    }else if(hType==="dune"){
        ctx.fillStyle="#fef08a";ctx.beginPath();ctx.arc(cx-W*0.09,horizonY-H*0.15,u*0.038,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#f97316";ctx.beginPath();ctx.arc(cx+W*0.10,horizonY-H*0.10,u*0.068,0,Math.PI*2);ctx.fill();
        [[-0.23,0.11,0.10],[0,0.16,0.15],[0.23,0.11,0.10]].forEach(([ox,pwR,phR])=>{
            const px=cx+ox*W,pw=W*pwR,ph=H*phR;
            ctx.fillStyle="#120902";ctx.strokeStyle="#fbbf24";ctx.lineWidth=1.5;
            ctx.beginPath();ctx.moveTo(px-pw,horizonY);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw*0.85,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="#291505";
            ctx.beginPath();ctx.moveTo(px,horizonY-ph);ctx.lineTo(px+pw*0.85,horizonY);ctx.lineTo(px+pw*0.1,horizonY);ctx.closePath();ctx.fill();
            ctx.fillStyle="#fde68a";
            ctx.beginPath();ctx.moveTo(px-pw*0.18,horizonY-ph*0.82);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw*0.15,horizonY-ph*0.82);ctx.closePath();ctx.fill();
        });
    }else if(hType==="sakura"){
        const mr=u*0.125;
        ctx.fillStyle="rgba(251,207,232,0.88)";
        ctx.beginPath();ctx.arc(cx,horizonY-mr*0.55,mr,Math.PI,0,false);ctx.fill();
        const fw=W*0.26,fh=H*0.16;
        ctx.fillStyle="#12061c";ctx.strokeStyle="#f472b6";ctx.lineWidth=1.6;
        ctx.beginPath();ctx.moveTo(cx-fw,horizonY);ctx.quadraticCurveTo(cx-fw*0.35,horizonY-fh*0.35,cx-fw*0.14,horizonY-fh);
        ctx.lineTo(cx+fw*0.14,horizonY-fh);ctx.quadraticCurveTo(cx+fw*0.35,horizonY-fh*0.35,cx+fw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle="#fdf2f8";
        ctx.beginPath();ctx.moveTo(cx-fw*0.14,horizonY-fh);ctx.lineTo(cx+fw*0.14,horizonY-fh);
        ctx.lineTo(cx+fw*0.22,horizonY-fh*0.68);ctx.lineTo(cx,horizonY-fh*0.76);ctx.lineTo(cx-fw*0.22,horizonY-fh*0.68);ctx.closePath();ctx.fill();
        const px=cx-W*0.29;
        for(let t=0;t<4;t++){
            const tw=26-t*4,ty=horizonY-10-t*11;
            ctx.fillStyle="#1a0826";ctx.strokeStyle="#ec4899";ctx.lineWidth=1.2;
            ctx.fillRect(px-tw*0.5,ty,tw,8);
            ctx.beginPath();ctx.moveTo(px-tw*0.75,ty);ctx.lineTo(px+tw*0.75,ty);ctx.stroke();
        }
        const tx=cx+W*0.29;
        ctx.fillStyle="#ec4899";
        ctx.fillRect(tx-14,horizonY-32,4,32);ctx.fillRect(tx+10,horizonY-32,4,32);
        ctx.fillRect(tx-22,horizonY-34,44,4);ctx.fillRect(tx-17,horizonY-23,34,3);
    }else if(hType==="matrix"){
        if(gfxSettings.pillars){
            ctx.fillStyle="rgba(34,197,94,0.28)";
            for(let c=0;c<22;c++){
                const mx=(c/22)*W,my=((now*0.09+c*53)%(horizonY-14));
                ctx.fillRect(mx,my,2.5,14);
                ctx.fillStyle="#bbf7d0";ctx.fillRect(mx,my+12,2.5,3);
                ctx.fillStyle="rgba(34,197,94,0.28)";
            }
        }
        const mr=u*0.105,cy=horizonY-mr*1.08;
        ctx.save();ctx.translate(cx,cy);
        ctx.strokeStyle="#22c55e";ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(0,0,mr*1.18,0,Math.PI*2);ctx.stroke();
        ctx.rotate(now*0.0008);
        ctx.fillStyle="#021407";
        ctx.beginPath();ctx.moveTo(0,-mr);ctx.lineTo(mr,0);ctx.lineTo(0,mr);ctx.lineTo(-mr,0);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeRect(-mr*0.55,-mr*0.55,mr*1.1,mr*1.1);
        ctx.restore();
    }else if(hType==="saturn"){
        const r=u*0.105,cy=horizonY-r*1.02;
        ctx.save();
        ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
        ctx.fillStyle="#1e1b4b";ctx.fillRect(cx-r,cy-r,r*2,r*2);
        ctx.fillStyle="rgba(129,140,248,0.28)";
        for(let b=-3;b<=3;b++){ctx.fillRect(cx-r,cy+b*(r*0.24),r*2,r*0.11);}
        ctx.restore();
        ctx.strokeStyle="#818cf8";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
        ctx.save();ctx.translate(cx,cy);ctx.rotate(-0.18+Math.sin(now*0.0005)*0.03);
        for(let ring=0;ring<3;ring++){
            ctx.strokeStyle=ring===1?"rgba(199,210,254,0.85)":"rgba(129,140,248,0.55)";
            ctx.lineWidth=ring===1?3.5:1.8;
            ctx.beginPath();ctx.ellipse(0,0,r*(1.65+ring*0.35),r*(0.28+ring*0.07),0,0,Math.PI*2);ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle="#c7d2fe";
        ctx.beginPath();ctx.arc(cx-r*2.4,cy-r*0.5,5,0,Math.PI*2);ctx.arc(cx+r*2.3,cy+r*0.3,7,0,Math.PI*2);ctx.fill();
    }else if(hType==="magma"){
        const vh=H*0.17,vw=W*0.24;
        ctx.fillStyle="#170401";ctx.strokeStyle="#fb923c";ctx.lineWidth=1.8;
        ctx.beginPath();ctx.moveTo(0,horizonY);ctx.lineTo(cx-vw,horizonY-vh*0.42);
        ctx.lineTo(cx-vw*0.22,horizonY-vh);ctx.lineTo(cx,horizonY-vh*0.86);ctx.lineTo(cx+vw*0.22,horizonY-vh);
        ctx.lineTo(cx+vw,horizonY-vh*0.42);ctx.lineTo(W,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle="#ef4444";
        ctx.beginPath();ctx.arc(cx,horizonY-vh,14+Math.sin(now*0.012)*4,Math.PI,0,false);ctx.fill();
        ctx.strokeStyle="#facc15";ctx.lineWidth=2.4;
        ctx.beginPath();
        ctx.moveTo(cx-6,horizonY-vh*0.9);ctx.quadraticCurveTo(cx-24,horizonY-vh*0.4,cx-38,horizonY);
        ctx.moveTo(cx+6,horizonY-vh*0.9);ctx.quadraticCurveTo(cx+20,horizonY-vh*0.45,cx+32,horizonY);
        ctx.stroke();
    }else if(hType==="astral"){
        const cy=horizonY-H*0.12,r=u*0.075;
        ctx.save();ctx.translate(cx,cy);ctx.rotate(now*0.0008);
        ctx.strokeStyle="#f8fafc";ctx.lineWidth=1.8;
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
        ctx.strokeRect(-r*0.7,-r*0.7,r*1.4,r*1.4);
        ctx.restore();
        for(let m=-3;m<=3;m++){
            if(m===0)continue;
            const mx=cx+m*(W*0.105),mh=34-(Math.abs(m)*4);
            const fy=horizonY-18-Math.sin(now*0.0022+m)*6;
            ctx.fillStyle="#0b0f19";ctx.strokeStyle="#e2e8f0";ctx.lineWidth=1.5;
            ctx.beginPath();ctx.moveTo(mx-8,fy);ctx.lineTo(mx-8,fy-mh);ctx.lineTo(mx,fy-mh-8);ctx.lineTo(mx+8,fy-mh);ctx.lineTo(mx+8,fy);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="#38bdf8";ctx.fillRect(mx-1.5,fy-mh+4,3,mh-10);
        }
    }
}

const empDisintegrationFX=[];
let empFlashAlpha=0;

function triggerNeuralEmp(){
    if(!gameState.running||gameState.paused)return;
    if(gameState.empCharge<100){
        spawnFloatingText("⚡ EMP CHARGING...","#94a3b8",0,-20);
        return;
    }
    gameState.empCharge=0;
    gameState.empWaveRadius=1;
    empFlashAlpha=0.45;
    if(gfxSettings.shake)gameState.screenShake=10;
    playGameSfx('emp');

    for(let i=0;i<gameState.hazards.length;i++){
        const h=gameState.hazards[i];
        ensureHazardVariant(h);
        const shards=[];
        const shardCount=isMobileHardware?10:16;
        const mainCol=(h.palette&&(h.palette.top||h.palette.main||h.palette.coat||h.palette.bodyTop))||h.cls.color||"#38bdf8";
        for(let s=0;s<shardCount;s++){
            const ang=(s/shardCount)*Math.PI*2+(Math.random()*0.35);
            const spd=24+Math.random()*50;
            shards.push({
                vx:Math.cos(ang)*spd,
                vy:Math.sin(ang)*spd-22,
                sz:2.0+Math.random()*2.4,
                col:(s%3===0)?"#ffffff":((s%2===0)?"#00f5d4":mainCol)
            });
        }
        empDisintegrationFX.push({
            lane:h.lane,
            z:Math.max(0.9,h.z),
            cls:h.cls,
            mainCol,
            life:1.0,
            shards
        });
    }

    const cleared=gameState.hazards.length;
    const bonus=cleared*Math.round(160*gameState.combo);
    gameState.score+=bonus;
    gameState.hazards=[];
    spawnFloatingText(`⚡ NEURAL EMP VAPORIZED ${cleared} HAZARDS! +${bonus}`,"#38bdf8",0,-60);
    updateHudDOM(true);
}

function updateAndRenderEmpDisintegrations(dt,W,H,roadCurve,activeRailColor){
    if(empFlashAlpha>0){
        empFlashAlpha=Math.max(0,empFlashAlpha-dt*1.35);
    }
    if(empDisintegrationFX.length===0)return;

    for(let i=empDisintegrationFX.length-1;i>=0;i--){
        const fx=empDisintegrationFX[i];
        fx.life-=dt*1.65;
        if(fx.life<=0){
            empDisintegrationFX.splice(i,1);
            continue;
        }
        const prog=1-fx.life;
        const bx=projectX(fx.lane,fx.z,W,H,roadCurve);
        const by=projectY(fx.z,0,H)-prog*18;
        const s=getRigidPerspectiveScale(fx.z,W,H);
        const dims=gfxSettings.legacyModels?{w:25,h:23}:(REAL_LIFE_HAZARD_DIMS[fx.cls.id]||{w:24,h:21});
        const boxW=dims.w*s*(1+prog*0.35);
        const boxH=dims.h*s*(1-prog*0.25);

        ctx.save();
        ctx.globalAlpha=Math.max(0,fx.life);

        ctx.fillStyle="rgba(0,245,212,0.28)";
        const beamW=Math.max(2.5,boxW*0.32*fx.life);
        ctx.fillRect(bx-beamW*0.5,by-boxH*2.2,beamW,boxH*2.2);

        ctx.strokeStyle=prog<0.35?"#ffffff":"#00f5d4";
        ctx.lineWidth=1.8;
        ctx.beginPath();
        ctx.ellipse(bx,by-boxH*0.35,boxW*(0.55+prog*0.95),boxH*(0.32+prog*0.55),0,0,Math.PI*2);
        ctx.stroke();

        const sliceCount=isMobileHardware?4:6;
        const sliceH=boxH/sliceCount;
        for(let sl=0;sl<sliceCount;sl++){
            const jitter=(sl%2===0?1:-1)*prog*13*s;
            ctx.fillStyle=(sl%2===0)?"#00f5d4":(fx.mainCol||activeRailColor);
            ctx.fillRect(bx-boxW*0.46+jitter,by-boxH+sl*sliceH,boxW*0.92,sliceH*0.58);
        }

        for(let k=0;k<fx.shards.length;k++){
            const sh=fx.shards[k];
            const sx=bx+sh.vx*prog*s;
            const sy=(by-boxH*0.5)+sh.vy*prog*s;
            ctx.fillStyle=sh.col;
            const sz=sh.sz*s*fx.life;
            ctx.fillRect(sx-sz*0.5,sy-sz*0.5,sz,sz);
        }

        ctx.restore();
    }
}

// Compact Pickup Renderer (Reduced proportion r=6.0*s, scales with path from horizon to car)
function renderHighTexturePickup(pk,W,H,roadCurve,now){
    const zSafe=Math.max(0.55,pk.z);
    const px=projectX(pk.lane,zSafe,W,H,roadCurve);
    const roadY=projectY(zSafe,0,H);
    const s=getRigidPerspectiveScale(zSafe,W,H);
    const r=6.0*s;

    if(gfxSettings.legacyModels){
        const py=roadY-r*1.4;
        ctx.save();
        ctx.translate(px,py);
        ctx.rotate(pk.spin);
        ctx.fillStyle=pk.type==='nitro'?"#fbbf24":(pk.type==='emp'?"#38bdf8":"#10b981");
        ctx.strokeStyle="#ffffff";
        ctx.lineWidth=Math.max(1.1,1.4*s);
        ctx.fillRect(-r,-r,r*2,r*2);
        ctx.strokeRect(-r,-r,r*2,r*2);
        ctx.fillStyle="#ffffff";
        ctx.fillRect(-r*0.35,-r*0.35,r*0.7,r*0.7);
        ctx.restore();
        return;
    }

    const hoverBob=gfxSettings.transitions?Math.sin(now*0.0065+pk.spin)*1.6*s:0;
    const py=roadY-r*1.45+hoverBob;
    const mainCol=pk.type==='nitro'?"#fbbf24":(pk.type==='emp'?"#38bdf8":"#10b981");
    const coreCol=pk.type==='nitro'?"#fef08a":(pk.type==='emp'?"#e0f2fe":"#a7f3d0");
    const darkCol=pk.type==='nitro'?"#78350f":(pk.type==='emp'?"#0c4a6e":"#064e3b");
    const highDetail=(gfxSettings.preset==='high'||gfxSettings.preset==='ultra');

    ctx.fillStyle="rgba(0,0,0,0.52)";
    ctx.beginPath();
    ctx.ellipse(px,roadY+1.2*s,r*0.92,r*0.26,0,0,Math.PI*2);
    ctx.fill();

    ctx.save();
    ctx.translate(px,py);

    if(highDetail){
        ctx.save();
        ctx.rotate(-pk.spin*0.65);
        ctx.strokeStyle=`${mainCol}88`;
        ctx.lineWidth=Math.max(0.9,1.05*s);
        const rOuter=r*1.14;
        ctx.strokeRect(-rOuter,-rOuter,rOuter*2,rOuter*2);
        ctx.restore();
    }

    ctx.rotate(pk.spin);
    if(gfxSettings.bloom&&!isMobileHardware){
        ctx.shadowBlur=10;
        ctx.shadowColor=mainCol;
    }
    ctx.fillStyle=mainCol;
    ctx.strokeStyle="#ffffff";
    ctx.lineWidth=Math.max(1.1,1.4*s);
    ctx.fillRect(-r,-r,r*2,r*2);
    ctx.strokeRect(-r,-r,r*2,r*2);
    ctx.shadowBlur=0;

    ctx.fillStyle=darkCol;
    ctx.fillRect(-r*0.66,-r*0.66,r*1.32,r*1.32);
    ctx.strokeStyle=coreCol;
    ctx.lineWidth=Math.max(0.8,0.95*s);
    ctx.strokeRect(-r*0.66,-r*0.66,r*1.32,r*1.32);

    ctx.fillStyle="#ffffff";
    ctx.fillRect(-r*0.35,-r*0.35,r*0.70,r*0.70);

    ctx.restore();
}
// --- END OF MINI-CHUNK 6.2 OF 4 ---
// --- START OF MINI-CHUNK 6.3 OF 4 ---
function renderLegacyHazardModel(hz,bx,by,s,boxW,boxH,primaryCol){
    const x1=bx-boxW*0.5,y2=by,y1=y2-boxH;
    const cid=hz.cls.id;
    if(cid===0){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1+1*s,y2-6*s,4*s,6*s);ctx.fillRect(x1+boxW-5*s,y2-6*s,4*s,6*s);ctx.fillRect(bx-2*s,y2-5*s,4*s,5*s);
        ctx.fillStyle="#111827";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.moveTo(x1+2*s,y2-3*s);ctx.lineTo(x1+3*s,y1+boxH*0.36);ctx.quadraticCurveTo(bx,y1-3*s,x1+boxW-3*s,y1+boxH*0.36);
        ctx.lineTo(x1+boxW-2*s,y2-3*s);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+3*s,y1+boxH*0.48,boxW-6*s,boxH*0.40);
        ctx.fillStyle="#060b14";ctx.strokeStyle="#38bdf888";ctx.lineWidth=1;
        ctx.fillRect(x1+5*s,y1+boxH*0.18,boxW-10*s,boxH*0.25);ctx.strokeRect(x1+5*s,y1+boxH*0.18,boxW-10*s,boxH*0.25);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+4*s,y2-7*s,5*s,3*s);ctx.fillRect(x1+boxW-9*s,y2-7*s,5*s,3*s);
        ctx.fillStyle="#fde047";ctx.fillRect(bx-3*s,y2-6*s,6*s,2*s);
    }else if(cid===1){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1,y2-7*s,5*s,7*s);ctx.fillRect(x1+boxW-5*s,y2-7*s,5*s,7*s);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(x1+1*s,y2-2*s);ctx.lineTo(x1+1*s,y1+3*s);ctx.lineTo(x1+4*s,y1);
        ctx.lineTo(x1+boxW-4*s,y1);ctx.lineTo(x1+boxW-1*s,y1+3*s);ctx.lineTo(x1+boxW-1*s,y2-2*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+3*s,y1+boxH*0.22,boxW-6*s,boxH*0.62);
        ctx.fillStyle="#09101d";
        ctx.fillRect(x1+4*s,y1+boxH*0.26,boxW-8*s,boxH*0.22);
        ctx.strokeStyle="rgba(255,255,255,0.35)";ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x1+4*s,y1+boxH*0.58);ctx.lineTo(x1+boxW-4*s,y1+boxH*0.58);
        ctx.moveTo(x1+4*s,y1+boxH*0.70);ctx.lineTo(x1+boxW-4*s,y1+boxH*0.70);ctx.stroke();
        ctx.fillStyle="#fbbf24";
        ctx.fillRect(x1+5*s,y1+1*s,3*s,2*s);ctx.fillRect(bx-1.5*s,y1+1*s,3*s,2*s);ctx.fillRect(x1+boxW-8*s,y1+1*s,3*s,2*s);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+3*s,y2-6*s,6*s,3*s);ctx.fillRect(x1+boxW-9*s,y2-6*s,6*s,3*s);
    }else if(cid===2){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1,y2-6*s,4.5*s,6*s);ctx.fillRect(x1+boxW-4.5*s,y2-6*s,4.5*s,6*s);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(bx,y1);
        ctx.quadraticCurveTo(x1+4*s,y1+2*s,x1+2*s,y1+boxH*0.36);
        ctx.lineTo(x1,y2-2*s);
        ctx.lineTo(x1+boxW,y2-2*s);
        ctx.lineTo(x1+boxW-2*s,y1+boxH*0.36);
        ctx.quadraticCurveTo(x1+boxW-4*s,y1+2*s,bx,y1);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle="#7dd3fc";
        ctx.beginPath();
        ctx.moveTo(bx,y1+5*s);
        ctx.lineTo(x1+5*s,y1+boxH*0.44);
        ctx.lineTo(x1+boxW-5*s,y1+boxH*0.44);
        ctx.closePath();ctx.fill();
        ctx.fillStyle="#06080f";
        ctx.fillRect(x1+3*s,y2-8*s,boxW-6*s,5*s);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+3.5*s,y2-7.5*s,7*s,3*s);ctx.fillRect(x1+boxW-10.5*s,y2-7.5*s,7*s,3*s);
    }else if(cid===3){
        ctx.fillStyle="#05070b";
        ctx.fillRect(bx-3*s,y2-9*s,6*s,9*s);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(bx-6*s,y2-3*s);ctx.lineTo(bx-7*s,y1+boxH*0.44);ctx.lineTo(bx,y1+2*s);
        ctx.lineTo(bx+7*s,y1+boxH*0.44);ctx.lineTo(bx+6*s,y2-3*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#e2e8f0";ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(bx-9*s,y1+boxH*0.38);ctx.lineTo(bx+9*s,y1+boxH*0.38);ctx.stroke();
        ctx.fillStyle="#f8fafc";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.1;
        ctx.beginPath();ctx.arc(bx,y1+6*s,4.2*s,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#00f5d4";ctx.fillRect(bx-2.5*s,y1+5*s,5*s,2*s);
        ctx.fillStyle="#ff1e42";ctx.fillRect(bx-3*s,y2-8*s,6*s,3*s);
    }else if(cid===4){
        ctx.strokeStyle="rgba(251,113,133,0.45)";ctx.lineWidth=1.1;
        ctx.beginPath();ctx.ellipse(bx,y2,boxW*0.38,3*s,0,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle="#0f172a";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.arc(bx,y1+4.5*s,4.2*s,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#00f5d4";ctx.fillRect(bx-2.5*s,y1+3.5*s,5*s,2*s);
        ctx.fillStyle=primaryCol;
        ctx.beginPath();
        ctx.moveTo(bx-6*s,y1+9.5*s);ctx.lineTo(bx+6*s,y1+9.5*s);ctx.lineTo(bx+4.5*s,y1+19*s);ctx.lineTo(bx-4.5*s,y1+19*s);
        ctx.closePath();ctx.fill();
        ctx.fillStyle="#1e293b";ctx.fillRect(bx-3*s,y1+11*s,6*s,5*s);
        ctx.strokeStyle="#e2e8f0";ctx.lineWidth=1.8;
        ctx.beginPath();
        ctx.moveTo(bx-5.5*s,y1+10.5*s);ctx.lineTo(bx-9*s,y1+17*s);
        ctx.moveTo(bx+5.5*s,y1+10.5*s);ctx.lineTo(bx+9*s,y1+17*s);
        ctx.moveTo(bx-2.5*s,y1+19*s);ctx.lineTo(bx-3.5*s,y2);
        ctx.moveTo(bx+2.5*s,y1+19*s);ctx.lineTo(bx+3.5*s,y2);
        ctx.stroke();
    }else if(cid===5){
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.moveTo(x1+4*s,y1+9*s);ctx.lineTo(x1+boxW-4*s,y1+9*s);ctx.lineTo(x1+boxW-3*s,y1+18*s);ctx.lineTo(x1+3*s,y1+18*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx-5*s,y1+9*s);ctx.lineTo(bx,y1+3*s);ctx.lineTo(bx+5*s,y1+9*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#fde68a";ctx.lineWidth=1.3;
        ctx.beginPath();ctx.moveTo(bx-3*s,y1+4*s);ctx.lineTo(bx-5*s,y1+1*s);ctx.moveTo(bx+3*s,y1+4*s);ctx.lineTo(bx+5*s,y1+1*s);ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+4*s,y1+18*s,3*s,7*s);ctx.fillRect(x1+9*s,y1+18*s,2.5*s,6.5*s);
        ctx.fillRect(x1+boxW-11.5*s,y1+18*s,2.5*s,6.5*s);ctx.fillRect(x1+boxW-7*s,y1+18*s,3*s,7*s);
        ctx.fillStyle="#00f5d4";ctx.fillRect(bx-1.5*s,y1+6*s,3*s,2*s);
    }else if(cid===6){
        ctx.fillStyle="#05070c";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(x1+1*s,y2-6*s);ctx.lineTo(x1+6*s,y2-12*s);ctx.lineTo(bx+2*s,y2-13*s);
        ctx.lineTo(x1+boxW-2*s,y2-9*s);ctx.lineTo(x1+boxW-1*s,y2-3*s);ctx.lineTo(bx-3*s,y2-1*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#38bdf8";ctx.lineWidth=1.3;
        ctx.beginPath();ctx.moveTo(x1+6*s,y2-6*s);ctx.lineTo(bx,y2-8*s);ctx.lineTo(x1+boxW-6*s,y2-5*s);ctx.stroke();
        ctx.fillStyle="#f59e0b";
        ctx.fillRect(x1+3*s,y2-15*s,4*s,2*s);ctx.fillRect(x1+boxW-7*s,y2-15*s,4*s,2*s);
    }else{
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.moveTo(x1,y2-2*s);ctx.lineTo(x1+3*s,y2-11*s);ctx.lineTo(x1+boxW-3*s,y2-11*s);ctx.lineTo(x1+boxW,y2-2*s);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        for(let c=0;c<4;c++){
            const sx=x1+4*s+c*(boxW-8*s)/4;
            ctx.beginPath();
            ctx.moveTo(sx,y2-3*s);ctx.lineTo(sx+2.5*s,y2-10*s);ctx.lineTo(sx+5*s,y2-10*s);ctx.lineTo(sx+2.5*s,y2-3*s);
            ctx.closePath();
            ctx.fill();
        }
        ctx.fillStyle="#ef4444";
        ctx.fillRect(x1+2*s,y2-5*s,3*s,2*s);ctx.fillRect(x1+boxW-5*s,y2-5*s,3*s,2*s);
    }
}

function renderHighTextureDistinctHazard(hz,zSafe,W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue,now=0){
    ensureHazardVariant(hz);

    const bx=projectX(hz.lane,zSafe,W,H,roadCurve);
    const by=projectY(zSafe,0,H);
    const s=getRigidPerspectiveScale(zSafe,W,H);
    const cid=hz.cls.id;
    const dims=gfxSettings.legacyModels?{w:25,h:23}:(REAL_LIFE_HAZARD_DIMS[cid]||{w:24,h:21});
    const boxW=dims.w*s;
    const boxH=dims.h*s;
    const x1=bx-boxW*0.5,y2=by,y1=y2-boxH;
    const tierColor=(hz.rFinal>=0.85)?"#ef4444":(hz.rFinal>=0.65?"#f97316":(hz.rFinal>=0.35?"#f59e0b":dynamicWorldColor));

    ctx.fillStyle="rgba(0,0,0,0.62)";
    ctx.beginPath();
    ctx.ellipse(bx,y2+1.8*s,boxW*0.50,3.0*s,0,0,Math.PI*2);
    ctx.fill();

    if(gfxSettings.legacyModels){
        const primaryCol=isCosmic250?`hsl(${(cosmicHue+cid*45)%360},90%,58%)`:hz.cls.color;
        renderLegacyHazardModel(hz,bx,by,s*0.84,boxW,boxH,primaryCol);
    }else{
        const highDetail=(gfxSettings.preset==='high'||gfxSettings.preset==='ultra');
        const ms=s*0.84;
        ctx.save();
        ctx.translate(bx,y2);
        ctx.scale(ms,ms);

        if(cid===0){
            const pal=hz.palette;
            ctx.fillStyle="#05070b";
            ctx.fillRect(-10.5,-6,3.2,6);
            ctx.fillRect(7.3,-6,3.2,6);
            ctx.fillRect(-1.8,-5,3.6,5.5);

            ctx.fillStyle=pal.bodyBot;
            ctx.strokeStyle=pal.trim;
            ctx.lineWidth=1.5;
            ctx.beginPath();
            ctx.roundRect(-10,-14.5,20,12.5,2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle=pal.bodyTop;
            ctx.fillRect(-9.2,-14,18.4,5.5);

            ctx.fillStyle=pal.roof;
            ctx.strokeStyle="#fde047";
            ctx.lineWidth=1.4;
            ctx.beginPath();
            ctx.moveTo(-10,-14);
            ctx.lineTo(-8.8,-21.5);
            ctx.quadraticCurveTo(0,-26,8.8,-21.5);
            ctx.lineTo(10,-14);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle=pal.glass;
            ctx.strokeStyle="#0f172a";
            ctx.lineWidth=1;
            ctx.beginPath();
            ctx.roundRect(-7.6,-20.8,15.2,6.2,1.5);
            ctx.fill();
            ctx.stroke();
            ctx.beginPath();ctx.moveTo(0,-20.8);ctx.lineTo(0,-14.6);ctx.stroke();

            ctx.fillStyle="#ffffff";
            ctx.beginPath();ctx.arc(0,-8.5,2.2,0,Math.PI*2);ctx.fill();
            ctx.fillStyle="#ff1e42";
            ctx.fillRect(-8.5,-9,3,2.2);
            ctx.fillRect(5.5,-9,3,2.2);

        }else if(cid===1){
            const pal=hz.palette;
            if(hz.subType==='bus'){
                ctx.fillStyle="#05070b";
                ctx.fillRect(-15.5,-7,4.2,7);
                ctx.fillRect(11.3,-7,4.2,7);

                ctx.fillStyle=pal.body;
                ctx.strokeStyle=pal.trim;
                ctx.lineWidth=1.7;
                ctx.beginPath();
                ctx.roundRect(-15.5,-32.5,31,30.5,3.5);
                ctx.fill();
                ctx.stroke();

                if(highDetail){
                    ctx.fillStyle=pal.top;
                    ctx.fillRect(-14.5,-31.5,29,6);
                }

                ctx.fillStyle="#050811";
                ctx.fillRect(-11.5,-30.5,23,3.5);
                ctx.fillStyle="#fde047";
                ctx.fillRect(-8.5,-29.4,17,1.4);

                ctx.fillStyle="#38bdf8";
                ctx.beginPath();
                ctx.roundRect(-13.5,-26,27,10.5,2);
                ctx.fill();
                if(highDetail){
                    ctx.fillStyle="#e0f2fe";
                    ctx.fillRect(-12.5,-25.2,25,2.2);
                }

                ctx.fillStyle=pal.stripe;
                ctx.fillRect(-14.8,-14,29.6,2.5);
                ctx.fillStyle="#090d16";
                ctx.fillRect(-8.5,-10,17,5);

                ctx.fillStyle="#ffffff";
                ctx.fillRect(-13.8,-9,4,2.8);
                ctx.fillRect(9.8,-9,4,2.8);
                ctx.fillStyle="#fbbf24";
                ctx.fillRect(-13.8,-5.5,3,2);
                ctx.fillRect(10.8,-5.5,3,2);
            }else{
                ctx.fillStyle="#05070b";
                ctx.fillRect(-16,-7.5,4.5,7.5);
                ctx.fillRect(11.5,-7.5,4.5,7.5);

                ctx.fillStyle=pal.cargo;
                ctx.strokeStyle=pal.trim;
                ctx.lineWidth=1.5;
                ctx.beginPath();
                ctx.roundRect(-16.5,-34,33,19,2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle="#fde047";
                [-10,-5,0,5,10].forEach(lx=>ctx.fillRect(lx-1.1,-33,2.2,1.8));

                ctx.fillStyle=pal.cab;
                ctx.strokeStyle=pal.trim;
                ctx.lineWidth=1.6;
                ctx.beginPath();
                ctx.roundRect(-14,-26,28,24,3);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle="#7dd3fc";
                ctx.fillRect(-12,-23.5,11,7);
                ctx.fillRect(1,-23.5,11,7);

                ctx.fillStyle="#0f172a";
                ctx.strokeStyle="#f8fafc";
                ctx.lineWidth=1.3;
                ctx.beginPath();
                ctx.roundRect(-8,-14.5,16,9.5,1.5);
                ctx.fill();
                ctx.stroke();
                for(let g=-5;g<=5;g+=2.5){
                    ctx.beginPath();ctx.moveTo(g,-14);ctx.lineTo(g,-5.5);ctx.stroke();
                }

                ctx.fillStyle="#fef08a";
                ctx.fillRect(-13,-11.5,3.8,3.2);
                ctx.fillRect(9.2,-11.5,3.8,3.2);
            }

        }else if(cid===2){
            const pal=hz.palette;
            ctx.fillStyle="#05070b";
            ctx.beginPath();
            ctx.roundRect(-14,-6.5,4,6.5,1.5);
            ctx.roundRect(10,-6.5,4,6.5,1.5);
            ctx.fill();

            ctx.fillStyle=pal.top;
            ctx.strokeStyle=pal.trim;
            ctx.lineWidth=1.7;
            ctx.beginPath();
            ctx.moveTo(-13,-2);
            ctx.quadraticCurveTo(-14.5,-8.5,-12,-13.5);
            ctx.lineTo(-8,-21.5);
            ctx.quadraticCurveTo(0,-23.5,8,-21.5);
            ctx.lineTo(12,-13.5);
            ctx.quadraticCurveTo(14.5,-8.5,13,-2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle=pal.bot;
            ctx.fillRect(-12.2,-11,24.4,8);

            ctx.fillStyle=pal.canopy;
            ctx.beginPath();
            ctx.moveTo(-6.8,-20);
            ctx.quadraticCurveTo(0,-21.4,6.8,-20);
            ctx.lineTo(9.4,-13.2);
            ctx.quadraticCurveTo(0,-12,-9.4,-13.2);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle="#05070c";
            ctx.beginPath();
            ctx.roundRect(-11,-7.2,22,4.8,2);
            ctx.fill();
            ctx.fillStyle="#ff1e42";
            ctx.fillRect(-10.2,-6.5,6.2,2.5);
            ctx.fillRect(4,-6.5,6.2,2.5);
            ctx.fillStyle=pal.trim;
            ctx.fillRect(-2.4,-6,4.8,1.6);

        }else if(cid===3){
            const pal=hz.palette;
            ctx.fillStyle="#05070b";
            ctx.strokeStyle="#475569";
            ctx.lineWidth=1;
            ctx.beginPath();
            ctx.roundRect(-2.8,-10,5.6,10,2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle="#0f172a";
            ctx.fillRect(-6.8,-15,3,7);
            ctx.fillRect(3.8,-15,3,7);

            ctx.fillStyle=pal.main;
            ctx.strokeStyle=pal.trim;
            ctx.lineWidth=1.5;
            ctx.beginPath();
            ctx.moveTo(0,-4.5);
            ctx.lineTo(-6.2,-13.5);
            ctx.lineTo(-4.4,-20.5);
            ctx.lineTo(4.4,-20.5);
            ctx.lineTo(6.2,-13.5);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.strokeStyle="#e2e8f0";
            ctx.lineWidth=1.6;
            ctx.beginPath();
            ctx.moveTo(-8.5,-18.5);ctx.lineTo(8.5,-18.5);
            ctx.stroke();

            ctx.fillStyle="#0f172a";
            ctx.strokeStyle=pal.trim;
            ctx.lineWidth=1.3;
            ctx.beginPath();
            ctx.arc(0,-22.5,4.2,0,Math.PI*2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle=pal.visor;
            ctx.fillRect(-2.8,-23.4,5.6,2.2);

            ctx.fillStyle="#fef08a";
            ctx.fillRect(-4.2,-13.5,2.6,2.2);
            ctx.fillRect(1.6,-13.5,2.6,2.2);

        }else if(cid===4){
            const pal=hz.palette;
            const runCycle=now*0.015+(hz.phase||0);
            const swing=Math.sin(runCycle);
            const bob=Math.abs(Math.cos(runCycle))*1.6;

            ctx.translate(0,-bob);

            const leftLegLift=swing>0?swing*4.0:swing*1.2;
            const rightLegLift=swing<0?-swing*4.0:-swing*1.2;

            ctx.lineCap="round";
            ctx.lineWidth=2.8;
            ctx.strokeStyle="#e2e8f0";
            ctx.beginPath();
            ctx.moveTo(-2.5,-10);ctx.lineTo(-3.0,-2.2-leftLegLift);
            ctx.moveTo(2.5,-10);ctx.lineTo(3.0,-2.2-rightLegLift);
            ctx.stroke();

            ctx.fillStyle=pal.trim;
            ctx.beginPath();
            ctx.arc(-3.0,-1.6-leftLegLift,1.7,0,Math.PI*2);
            ctx.arc(3.0,-1.6-rightLegLift,1.7,0,Math.PI*2);
            ctx.fill();

            const leftArmY=-13+swing*3.0;
            const rightArmY=-13-swing*3.0;
            ctx.strokeStyle=pal.top;
            ctx.lineWidth=2.4;
            ctx.beginPath();
            ctx.moveTo(-4.4,-18.5);ctx.lineTo(-7.0,leftArmY);
            ctx.moveTo(4.4,-18.5);ctx.lineTo(7.0,rightArmY);
            ctx.stroke();

            ctx.fillStyle=pal.skin;
            ctx.beginPath();
            ctx.arc(-7.0,leftArmY,1.3,0,Math.PI*2);
            ctx.arc(7.0,rightArmY,1.3,0,Math.PI*2);
            ctx.fill();

            ctx.fillStyle=pal.top;
            ctx.strokeStyle=pal.trim;
            ctx.lineWidth=1.3;
            if(hz.subType==='girl'){
                ctx.beginPath();
                ctx.moveTo(-4.2,-19.5);ctx.lineTo(4.2,-19.5);
                ctx.lineTo(3.5,-13);ctx.lineTo(-3.5,-13);
                ctx.closePath();ctx.fill();ctx.stroke();
                ctx.fillStyle=pal.trim;
                ctx.beginPath();
                ctx.moveTo(-3.8,-13.2);ctx.lineTo(3.8,-13.2);
                ctx.lineTo(5.8,-8.8);ctx.lineTo(-5.8,-8.8);
                ctx.closePath();ctx.fill();
            }else{
                ctx.beginPath();
                ctx.roundRect(-4.8,-19.5,9.6,9.8,2);
                ctx.fill();ctx.stroke();
                ctx.fillStyle=pal.trim;
                ctx.fillRect(-4.2,-16.2,8.4,1.8);
            }

            ctx.fillStyle=pal.skin;
            ctx.beginPath();
            ctx.arc(0,-23.5,3.8,0,Math.PI*2);
            ctx.fill();

            ctx.fillStyle=pal.hair;
            if(hz.subType==='girl'){
                const tailSway=swing*2.5;
                ctx.beginPath();
                ctx.ellipse(3.5+tailSway*0.35,-23.8,3.0,1.6,0.35,0,Math.PI*2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(0,-24.6,3.9,Math.PI*0.95,Math.PI*0.05,false);
                ctx.fill();
            }else{
                ctx.beginPath();
                ctx.arc(0,-24.8,4.0,Math.PI,0,false);
                ctx.lineTo(3.2,-27.6);ctx.lineTo(0,-26.5);ctx.lineTo(-3.2,-27.6);
                ctx.closePath();
                ctx.fill();
            }

            ctx.fillStyle="#0f172a";
            ctx.fillRect(-1.8,-23.8,1.1,1.3);
            ctx.fillRect(0.7,-23.8,1.1,1.3);

        }else if(cid===5){
            const pal=hz.palette;
            const runCycle=now*0.020+(hz.phase||0);
            const stride=Math.sin(runCycle);
            const bounce=Math.abs(Math.cos(runCycle))*1.4;

            ctx.translate(0,-bounce);

            const tailSway=Math.sin(runCycle*1.6)*4.2;
            ctx.strokeStyle=pal.coat;
            ctx.lineCap="round";
            ctx.lineWidth=hz.subType==='cat'?2.2:2.8;
            ctx.beginPath();
            ctx.moveTo(0,-15.5);
            ctx.quadraticCurveTo(tailSway*0.6,-20,tailSway,-23.2);
            ctx.stroke();

            ctx.fillStyle=pal.dark;
            ctx.strokeStyle=pal.outline;
            ctx.lineWidth=1.0;
            ctx.beginPath();
            ctx.ellipse(0,-13.2,6.8,4.2,0,0,Math.PI*2);
            ctx.fill();
            ctx.stroke();

            const hindLeftLift=stride<0?-stride*3.6:0;
            const hindRightLift=stride>0?stride*3.6:0;
            ctx.strokeStyle=pal.dark;
            ctx.lineWidth=2.6;
            ctx.beginPath();
            ctx.moveTo(-6.2,-11.5);ctx.lineTo(-6.6,-3.2-hindLeftLift);
            ctx.moveTo(6.2,-11.5);ctx.lineTo(6.6,-3.2-hindRightLift);
            ctx.stroke();

            ctx.fillStyle=pal.belly;
            ctx.beginPath();
            ctx.arc(-6.6,-2.6-hindLeftLift,1.3,0,Math.PI*2);
            ctx.arc(6.6,-2.6-hindRightLift,1.3,0,Math.PI*2);
            ctx.fill();

            ctx.fillStyle=pal.coat;
            ctx.strokeStyle=pal.outline;
            ctx.lineWidth=1.2;
            ctx.beginPath();
            ctx.ellipse(0,-9.8,5.8,4.6,0,0,Math.PI*2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle=pal.belly;
            ctx.beginPath();
            ctx.ellipse(0,-9.2,3.4,3.0,0,0,Math.PI*2);
            ctx.fill();

            const frontLeftLift=stride>0?stride*3.8:0;
            const frontRightLift=stride<0?-stride*3.8:0;
            ctx.strokeStyle=pal.coat;
            ctx.lineWidth=2.7;
            ctx.beginPath();
            ctx.moveTo(-3.1,-8.0);ctx.lineTo(-3.2,-1.0-frontLeftLift);
            ctx.moveTo(3.1,-8.0);ctx.lineTo(3.2,-1.0-frontRightLift);
            ctx.stroke();

            ctx.fillStyle=pal.belly;
            ctx.beginPath();
            ctx.arc(-3.2,-0.6-frontLeftLift,1.4,0,Math.PI*2);
            ctx.arc(3.2,-0.6-frontRightLift,1.4,0,Math.PI*2);
            ctx.fill();

            if(hz.subType==='dog'){
                ctx.strokeStyle=pal.collar;
                ctx.lineWidth=2.1;
                ctx.beginPath();
                ctx.moveTo(-4.4,-12.6);ctx.quadraticCurveTo(0,-11.0,4.4,-12.6);
                ctx.stroke();

                ctx.fillStyle=pal.dark;
                ctx.beginPath();
                ctx.ellipse(-4.8,-16.8+stride*0.6,2.0,3.6,0.32,0,Math.PI*2);
                ctx.ellipse(4.8,-16.8-stride*0.6,2.0,3.6,-0.32,0,Math.PI*2);
                ctx.fill();

                ctx.fillStyle=pal.coat;
                ctx.strokeStyle=pal.outline;
                ctx.lineWidth=1.1;
                ctx.beginPath();
                ctx.arc(0,-16.5,4.6,0,Math.PI*2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle=pal.belly;
                ctx.beginPath();
                ctx.ellipse(0,-14.8,2.6,2.0,0,0,Math.PI*2);
                ctx.fill();
                ctx.fillStyle="#090d16";
                ctx.beginPath();
                ctx.arc(0,-15.4,1.2,0,Math.PI*2);
                ctx.fill();

                ctx.fillStyle="#ffffff";
                ctx.beginPath();
                ctx.arc(-1.8,-17.5,1.05,0,Math.PI*2);
                ctx.arc(1.8,-17.5,1.05,0,Math.PI*2);
                ctx.fill();
                ctx.fillStyle="#090d16";
                ctx.beginPath();
                ctx.arc(-1.8,-17.5,0.5,0,Math.PI*2);
                ctx.arc(1.8,-17.5,0.5,0,Math.PI*2);
                ctx.fill();
            }else{
                ctx.fillStyle=pal.coat;
                ctx.strokeStyle=pal.outline;
                ctx.lineWidth=1.1;
                ctx.beginPath();
                ctx.moveTo(-4.4,-17.8);ctx.lineTo(-5.4,-22.6);ctx.lineTo(-1.4,-19.8);
                ctx.moveTo(4.4,-17.8);ctx.lineTo(5.4,-22.6);ctx.lineTo(1.4,-19.8);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle="#f472b6";
                ctx.beginPath();
                ctx.moveTo(-3.9,-18.2);ctx.lineTo(-4.6,-21.4);ctx.lineTo(-2.0,-19.5);
                ctx.moveTo(3.9,-18.2);ctx.lineTo(4.6,-21.4);ctx.lineTo(2.0,-19.5);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle=pal.coat;
                ctx.strokeStyle=pal.outline;
                ctx.lineWidth=1.1;
                ctx.beginPath();
                ctx.arc(0,-16.4,4.3,0,Math.PI*2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle=pal.eye;
                ctx.beginPath();
                ctx.ellipse(-1.8,-17.0,1.15,0.85,-0.18,0,Math.PI*2);
                ctx.ellipse(1.8,-17.0,1.15,0.85,0.18,0,Math.PI*2);
                ctx.fill();

                ctx.fillStyle="#fb7185";
                ctx.beginPath();
                ctx.arc(0,-15.2,0.85,0,Math.PI*2);
                ctx.fill();
                ctx.strokeStyle="#ffffff";
                ctx.lineWidth=0.75;
                ctx.beginPath();
                ctx.moveTo(-1.8,-15.3);ctx.lineTo(-6.2,-15.9);
                ctx.moveTo(-1.8,-14.8);ctx.lineTo(-6.2,-14.5);
                ctx.moveTo(1.8,-15.3);ctx.lineTo(6.2,-15.9);
                ctx.moveTo(1.8,-14.8);ctx.lineTo(6.2,-14.5);
                ctx.stroke();
            }

        }else if(cid===6){
            ctx.fillStyle="#334155";
            ctx.strokeStyle="#cbd5e1";
            ctx.lineWidth=1.5;
            ctx.beginPath();
            ctx.moveTo(-12.5,-5);
            ctx.lineTo(-9,-9.8);
            ctx.lineTo(-2,-11);
            ctx.lineTo(6.5,-10.2);
            ctx.lineTo(12.5,-6);
            ctx.lineTo(10,-1.2);
            ctx.lineTo(1.5,-0.4);
            ctx.lineTo(-8.5,-1);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle="#020617";
            ctx.beginPath();
            ctx.ellipse(0,-5.2,9.2,3.4,0,0,Math.PI*2);
            ctx.fill();

            ctx.fillStyle="#38bdf8";
            ctx.beginPath();
            ctx.ellipse(-1,-4.8,5.5,1.5,0,0,Math.PI*2);
            ctx.fill();

            ctx.fillStyle="#f97316";
            ctx.fillRect(-11.5,-11.5,3.2,2.2);
            ctx.fillRect(8.3,-11.5,3.2,2.2);

        }else{
            const isYellow=(hz.variantIdx===0);
            const stripeLight=isYellow?"#facc15":"#ffffff";
            const stripeDark=isYellow?"#090d16":"#334155";

            ctx.fillStyle=stripeDark;
            ctx.strokeStyle=isYellow?"#fde047":"#cbd5e1";
            ctx.lineWidth=1.5;
            ctx.beginPath();
            ctx.moveTo(-15.5,-1.2);
            ctx.quadraticCurveTo(-14,-9.8,-11,-9.8);
            ctx.lineTo(11,-9.8);
            ctx.quadraticCurveTo(14,-9.8,15.5,-1.2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle=stripeLight;
            for(let c=-2;c<=2;c++){
                const sx=c*5.2;
                ctx.beginPath();
                ctx.moveTo(sx-1.8,-1.8);
                ctx.lineTo(sx-0.2,-9.0);
                ctx.lineTo(sx+2.2,-9.0);
                ctx.lineTo(sx+0.6,-1.8);
                ctx.closePath();
                ctx.fill();
            }

            ctx.fillStyle="#ef4444";
            ctx.fillRect(-13.5,-4.5,2.5,1.8);
            ctx.fillRect(11,-4.5,2.5,1.8);
        }

        ctx.restore();
    }

    if(gfxSettings.hudBoxes){
        ctx.strokeStyle=tierColor;
        ctx.lineWidth=hz.rFinal>=0.65?1.8:1.2;
        ctx.strokeRect(x1-2,y1-2,boxW+4,boxH+4);
        if(hz.z<34){
            const label=`${hz.cls.name} ${hz.z.toFixed(1)}m | DGI ${hz.dgi}`;
            const estW=label.length*6.0+8;
            ctx.fillStyle="rgba(9,11,16,0.88)";
            ctx.fillRect(bx-estW*0.5,y1-17,estW,13);
            ctx.fillStyle=tierColor;
            ctx.fillText(label,bx-estW*0.5+4,y1-7);
        }
    }
}
// --- END OF MINI-CHUNK 6.3 OF 4 ---
// --- START OF MINI-CHUNK 6.4 OF 4 ---
let lastRenderNow=performance.now();
function renderSceneFrame(now){
    const dtRender=Math.min(0.05,Math.max(0.001,(now-lastRenderNow)/1000));
    lastRenderNow=now;

    const W=gameState.viewW||window.innerWidth;
    const H=gameState.viewH||window.innerHeight;
    const theme=BIOME_THEMES[biomeIdx]||BIOME_THEMES[0];
    const isCosmic250=Boolean(theme.isEpoch250Special||gameState.epoch===250);
    const horizonY=H*0.42;

    ensureCachedBiomeGradients(W,H,horizonY,theme);

    ctx.save();
    if(gameState.screenShake>0&&gfxSettings.shake){
        ctx.translate((Math.random()-0.5)*gameState.screenShake,(Math.random()-0.5)*gameState.screenShake);
    }

    ctx.fillStyle=cachedGradients.sky;
    ctx.fillRect(0,0,W,H);

    const cosmicHue=(now*0.08)%360;
    const dynamicWorldColor=isCosmic250?`hsl(${cosmicHue},95%,62%)`:theme.curb;

    const starBase=isMobileHardware?42:65;
    const starCount=Math.min(gameState.stars.length,Math.floor(starBase*gfxSettings.particles));
    const streakLen=(gfxSettings.speedLines||isCosmic250||gameState.boosting)?5.8:1.5;
    for(let i=0;i<starCount;i++){
        const st=gameState.stars[i];
        const sx=((st.x*W-gameState.distanceM*st.sp)%W+W)%W;
        const sy=st.y*H;
        ctx.fillStyle=isCosmic250?st.col:(i%3===0?theme.curb:"#e2e8f0");
        ctx.fillRect(sx,sy,st.s*streakLen,st.s*0.95);
    }

    renderUniqueDimensionHorizon(W,H,horizonY,theme,now,dynamicWorldColor,cosmicHue);

    ctx.fillStyle=theme.roadDark;
    ctx.fillRect(0,horizonY,W,H-horizonY);

    const roadCurve=Math.sin(gameState.distanceM*0.012)*0.65;
    const totalSlices=gfxSettings.roadSlices||(isMobileHardware?26:36);
    const sliceStep=55.0/totalSlices;

    const voidHue=(now*0.14)%360;
    const activeRailColor=activeLiveryProfile.isVoidChroma?`hsl(${voidHue},95%,60%)`:activeLiveryProfile.railColor;

    for(let i=totalSlices;i>=1;i--){
        const zNear=0.55+(i-1)*sliceStep;
        const zFar=0.55+i*sliceStep;
        const yNear=projectY(zNear,0,H),yFar=i===totalSlices?horizonY:projectY(zFar,0,H);
        const xNearLeft=projectX(-2.6,zNear,W,H,roadCurve),xNearRight=projectX(2.6,zNear,W,H,roadCurve);
        const xFarLeft=projectX(-2.6,zFar,W,H,roadCurve),xFarRight=projectX(2.6,zFar,W,H,roadCurve);

        const isAlt=(Math.floor((gameState.distanceM+zNear)/3.2)&1)===0;
        ctx.fillStyle=isAlt?theme.roadLight:theme.roadDark;
        ctx.beginPath();
        ctx.moveTo(xFarLeft,yFar);ctx.lineTo(xFarRight,yFar);ctx.lineTo(xNearRight,yNear);ctx.lineTo(xNearLeft,yNear);
        ctx.closePath();ctx.fill();

        if(isAlt){
            ctx.strokeStyle=dynamicWorldColor;
            ctx.lineWidth=2;
            ctx.beginPath();
            ctx.moveTo(xFarLeft,yFar);ctx.lineTo(xNearLeft,yNear);
            ctx.moveTo(xFarRight,yFar);ctx.lineTo(xNearRight,yNear);
            ctx.stroke();
        }
    }

    ctx.strokeStyle=`${dynamicWorldColor}88`;
    ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(0,horizonY);ctx.lineTo(W,horizonY);ctx.stroke();

    if(gfxSettings.reflections){
        ctx.fillStyle=`${dynamicWorldColor}12`;
        ctx.beginPath();
        ctx.moveTo(W*0.46,horizonY);ctx.lineTo(W*0.54,horizonY);ctx.lineTo(W*0.64,H);ctx.lineTo(W*0.36,H);
        ctx.closePath();ctx.fill();
    }

    ctx.strokeStyle=`${dynamicWorldColor}55`;
    ctx.lineWidth=1.2;
    ctx.beginPath();
    const divSteps=isMobileHardware?14:18,divStepM=48.0/divSteps;
    for(let l=0;l<4;l++){
        const divLane=-1.5+l;
        for(let s=0;s<divSteps;s+=2){
            const z1=0.65+s*divStepM,z2=z1+divStepM*0.75;
            ctx.moveTo(projectX(divLane,z1,W,H,roadCurve),projectY(z1,0,H));
            ctx.lineTo(projectX(divLane,z2,W,H,roadCurve),projectY(z2,0,H));
        }
    }
    ctx.stroke();

    const corridorSteps=isMobileHardware?14:20,corridorStepM=42.0/corridorSteps;
    ctx.fillStyle=`${activeRailColor}1f`;
    ctx.beginPath();
    for(let s=0;s<=corridorSteps;s++){
        const z=0.58+s*corridorStepM;
        const xL=projectX(gameState.egoLaneX-0.46,z,W,H,roadCurve),y=projectY(z,0,H);
        if(s===0)ctx.moveTo(xL,y);else ctx.lineTo(xL,y);
    }
    for(let s=corridorSteps;s>=0;s--){
        const z=0.58+s*corridorStepM;
        ctx.lineTo(projectX(gameState.egoLaneX+0.46,z,W,H,roadCurve),projectY(z,0,H));
    }
    ctx.closePath();ctx.fill();

    ctx.strokeStyle=activeRailColor;
    ctx.lineWidth=2.0;
    ctx.beginPath();
    for(let s=0;s<=corridorSteps;s++){
        const z=0.58+s*corridorStepM;
        const xL=projectX(gameState.egoLaneX-0.46,z,W,H,roadCurve),y=projectY(z,0,H);
        if(s===0)ctx.moveTo(xL,y);else ctx.lineTo(xL,y);
    }
    for(let s=0;s<=corridorSteps;s++){
        const z=0.58+s*corridorStepM;
        const xR=projectX(gameState.egoLaneX+0.46,z,W,H,roadCurve),y=projectY(z,0,H);
        if(s===0)ctx.moveTo(xR,y);else ctx.lineTo(xR,y);
    }
    ctx.stroke();

    for(let i=gameState.pickups.length-1;i>=0;i--){
        renderHighTexturePickup(gameState.pickups[i],W,H,roadCurve,now);
    }

    gameState.hazards.sort((a,b)=>b.z-a.z);
    ctx.font="bold 10px 'JetBrains Mono',monospace";
    for(let i=0;i<gameState.hazards.length;i++){
        const hz=gameState.hazards[i];
        renderHighTextureDistinctHazard(hz,Math.max(0.55,hz.z),W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue,now);
    }

    updateAndRenderEmpDisintegrations(dtRender,W,H,roadCurve,activeRailColor);

    // ==================== 3D REAR-CHASE TESLA ROADSTER 2.0 ====================
    const CAR_LENGTH_SCALE=1.05;
    const CAR_WIDTH_SCALE=0.86;

    const zCarRear=1.34;
    const zCarFront=1.54;
    const rearX=projectX(gameState.egoLaneX,zCarRear,W,H,roadCurve);
    const frontX=projectX(gameState.egoLaneX,zCarFront,W,H,roadCurve);
    const carCenterX=Math.round(rearX);
    const hoodLeadX=Math.round((frontX-rearX)*0.65);

    const rearY=Math.round(projectY(zCarRear,0,H));
    const halfW=Math.round(((H*0.85)/zCarRear)*EGO_HALF_LANE_W*LANE_WIDTH_M*0.24*CAR_WIDTH_SCALE);
    const carH=Math.round(halfW*0.92*CAR_LENGTH_SCALE);

    const diffuserBotY=rearY;
    const fasciaTopY=rearY-Math.round(carH*0.34);
    const shoulderY=rearY-Math.round(carH*0.56);
    const roofTopY=rearY-carH;

    const shoulderHalfW=Math.round(halfW*0.96);
    const roofHalfW=Math.round(halfW*0.56);
    const hoodHalfW=Math.round(halfW*0.44);

    ctx.fillStyle="rgba(0,0,0,0.75)";
    ctx.beginPath();
    ctx.ellipse(carCenterX,diffuserBotY+3,halfW*0.98,6,0,0,Math.PI*2);
    ctx.fill();

    const tireW=Math.max(9,Math.round(halfW*0.26));
    const tireH=Math.max(13,Math.round(carH*0.36));
    ctx.fillStyle="#04060a";
    ctx.strokeStyle="#1e293b";
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.roundRect(carCenterX-halfW-2,diffuserBotY-tireH+3,tireW,tireH,3);
    ctx.roundRect(carCenterX+halfW-tireW+2,diffuserBotY-tireH+3,tireW,tireH,3);
    ctx.fill();
    ctx.stroke();

    const borderGlowCol=gameState.boosting?"#fbbf24":activeRailColor;
    if(gfxSettings.bloom){
        ctx.shadowBlur=isMobileHardware?12:18;
        ctx.shadowColor=borderGlowCol;
    }

    const bodyGrad=ctx.createLinearGradient(carCenterX,roofTopY,carCenterX,diffuserBotY);
    bodyGrad.addColorStop(0,activeLiveryProfile.chassisTop||"#1e293b");
    bodyGrad.addColorStop(0.48,activeLiveryProfile.dotColor+"44");
    bodyGrad.addColorStop(1,activeLiveryProfile.chassisBot||"#090d16");

    ctx.fillStyle=bodyGrad;
    ctx.strokeStyle=borderGlowCol;
    ctx.lineWidth=2.2;
    ctx.beginPath();
    ctx.moveTo(carCenterX-halfW+2,diffuserBotY-3);
    ctx.quadraticCurveTo(carCenterX-halfW-4,fasciaTopY+4,carCenterX-shoulderHalfW,shoulderY);
    ctx.quadraticCurveTo(carCenterX+hoodLeadX*0.5-roofHalfW*1.12,roofTopY+Math.round(carH*0.18),carCenterX+hoodLeadX-hoodHalfW,roofTopY+3);
    ctx.quadraticCurveTo(carCenterX+hoodLeadX,roofTopY-3,carCenterX+hoodLeadX+hoodHalfW,roofTopY+3);
    ctx.quadraticCurveTo(carCenterX+hoodLeadX*0.5+roofHalfW*1.12,roofTopY+Math.round(carH*0.18),carCenterX+shoulderHalfW,shoulderY);
    ctx.quadraticCurveTo(carCenterX+halfW+4,fasciaTopY+4,carCenterX+halfW-2,diffuserBotY-3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur=0;

    ctx.fillStyle=activeLiveryProfile.chassisTop||"#1e293b";
    ctx.strokeStyle=borderGlowCol;
    ctx.lineWidth=1.2;
    const mirrorY=shoulderY-Math.round(carH*0.16);
    const mirrorCenterX=carCenterX+Math.round(hoodLeadX*0.45);
    ctx.beginPath();
    ctx.moveTo(mirrorCenterX-roofHalfW*1.10,mirrorY);
    ctx.lineTo(mirrorCenterX-roofHalfW*1.28,mirrorY-2);
    ctx.lineTo(mirrorCenterX-roofHalfW*1.18,mirrorY+3);
    ctx.closePath();
    ctx.moveTo(mirrorCenterX+roofHalfW*1.10,mirrorY);
    ctx.lineTo(mirrorCenterX+roofHalfW*1.28,mirrorY-2);
    ctx.lineTo(mirrorCenterX+roofHalfW*1.18,mirrorY+3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const glassGrad=ctx.createLinearGradient(carCenterX,roofTopY+2,carCenterX,shoulderY+4);
    glassGrad.addColorStop(0,activeLiveryProfile.canopyColor||"#7dd3fc");
    glassGrad.addColorStop(0.55,"#0f172a");
    glassGrad.addColorStop(1,"#060911");

    ctx.fillStyle=glassGrad;
    ctx.strokeStyle=`${borderGlowCol}99`;
    ctx.lineWidth=1.3;
    ctx.beginPath();
    ctx.moveTo(carCenterX+hoodLeadX-hoodHalfW*0.82,roofTopY+4);
    ctx.quadraticCurveTo(carCenterX+hoodLeadX,roofTopY+1,carCenterX+hoodLeadX+hoodHalfW*0.82,roofTopY+4);
    ctx.lineTo(carCenterX+roofHalfW*0.76,shoulderY+2);
    ctx.quadraticCurveTo(carCenterX,shoulderY+5,carCenterX-roofHalfW*0.76,shoulderY+2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle="rgba(255,255,255,0.28)";
    ctx.lineWidth=1.1;
    ctx.beginPath();
    ctx.moveTo(carCenterX+hoodLeadX*0.55-roofHalfW*0.68,roofTopY+Math.round(carH*0.18));
    ctx.quadraticCurveTo(carCenterX+hoodLeadX*0.55,roofTopY+Math.round(carH*0.15),carCenterX+hoodLeadX*0.55+roofHalfW*0.68,roofTopY+Math.round(carH*0.18));
    ctx.stroke();

    ctx.strokeStyle=`${borderGlowCol}bb`;
    ctx.lineWidth=1.3;
    ctx.beginPath();
    ctx.moveTo(carCenterX-shoulderHalfW+2,shoulderY);
    ctx.quadraticCurveTo(carCenterX-halfW*0.68,fasciaTopY-4,carCenterX-halfW*0.42,fasciaTopY);
    ctx.moveTo(carCenterX+shoulderHalfW-2,shoulderY);
    ctx.quadraticCurveTo(carCenterX+halfW*0.68,fasciaTopY-4,carCenterX+halfW*0.42,fasciaTopY);
    ctx.stroke();

    const wingLift=(gameState.boosting||gameState.braking)?4:0;
    const wingY=fasciaTopY-2-wingLift;
    const wingW=Math.round(shoulderHalfW*0.92);
    ctx.fillStyle="#070b14";
    ctx.strokeStyle=borderGlowCol;
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(carCenterX-wingW,wingY+2);
    ctx.quadraticCurveTo(carCenterX,wingY-2,carCenterX+wingW,wingY+2);
    ctx.lineTo(carCenterX+wingW-3,wingY+5);
    ctx.quadraticCurveTo(carCenterX,wingY+2,carCenterX-wingW+3,wingY+5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const fasciaW=Math.round(halfW*0.90);
    const fasciaH=Math.max(10,diffuserBotY-fasciaTopY-3);
    ctx.fillStyle="#05070e";
    ctx.strokeStyle="#1e293b";
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.roundRect(carCenterX-fasciaW,fasciaTopY,fasciaW*2,fasciaH,4);
    ctx.fill();
    ctx.stroke();

    const tailCol=gameState.braking?"#ff1e42":(gameState.boosting?"#fbbf24":(activeLiveryProfile.isVoidChroma?activeRailColor:"#f43f5e"));
    if(gfxSettings.bloom){
        ctx.shadowBlur=gameState.braking?18:10;
        ctx.shadowColor=tailCol;
    }
    ctx.fillStyle=tailCol;
    const bladeW=Math.round(fasciaW*0.42);
    const bladeY=fasciaTopY+2;
    ctx.beginPath();
    ctx.roundRect(carCenterX-fasciaW+3,bladeY,bladeW,3.5,2);
    ctx.roundRect(carCenterX+fasciaW-bladeW-3,bladeY,bladeW,3.5,2);
    ctx.roundRect(carCenterX-4,bladeY+0.5,8,2.5,1);
    ctx.fill();
    ctx.shadowBlur=0;

    const diffY=diffuserBotY-8;
    ctx.strokeStyle=`${borderGlowCol}88`;
    ctx.lineWidth=1.2;
    ctx.beginPath();
    [-0.55,-0.25,0.25,0.55].forEach(r=>{
        const sx=carCenterX+Math.round(fasciaW*r);
        ctx.moveTo(sx,diffY);
        ctx.lineTo(sx,diffuserBotY-2);
    });
    ctx.stroke();

    const exhaustCol=gameState.boosting?"#38bdf8":activeLiveryProfile.thrusterColor;
    ctx.fillStyle="#090d16";
    ctx.strokeStyle=exhaustCol;
    ctx.lineWidth=1.4;
    ctx.beginPath();
    ctx.roundRect(carCenterX-8,diffY+1,16,5,2);
    ctx.fill();
    ctx.stroke();

    if(gameState.boosting){
        const flameLen=14+Math.random()*12;
        if(gfxSettings.bloom){
            ctx.shadowBlur=16;
            ctx.shadowColor="#fbbf24";
        }
        ctx.fillStyle="rgba(251,191,36,0.92)";
        ctx.beginPath();
        ctx.moveTo(carCenterX-fasciaW*0.52,diffuserBotY-2);
        ctx.lineTo(carCenterX-fasciaW*0.36,diffuserBotY+flameLen);
        ctx.lineTo(carCenterX-fasciaW*0.20,diffuserBotY-2);
        ctx.moveTo(carCenterX+fasciaW*0.20,diffuserBotY-2);
        ctx.lineTo(carCenterX+fasciaW*0.36,diffuserBotY+flameLen);
        ctx.lineTo(carCenterX+fasciaW*0.52,diffuserBotY-2);
        ctx.fill();

        ctx.fillStyle="#e0f2fe";
        ctx.beginPath();
        ctx.moveTo(carCenterX-6,diffuserBotY-2);
        ctx.lineTo(carCenterX,diffuserBotY+flameLen*1.25);
        ctx.lineTo(carCenterX+6,diffuserBotY-2);
        ctx.fill();
        ctx.shadowBlur=0;
    }

    // ==================== UPGRADED 3D NEURAL EMP SHOCKWAVE & LIGHTNING DOME ====================
    if(gameState.empWaveRadius>0){
        const empOriginX=carCenterX;
        const empOriginY=rearY-carH*0.45;
        const r1=gameState.empWaveRadius;
        const fade=Math.max(0.12,1-(r1/1500));

        ctx.save();
        ctx.globalAlpha=fade;

        if(empFlashAlpha>0){
            ctx.fillStyle=`rgba(56,189,248,${empFlashAlpha*0.32})`;
            ctx.fillRect(0,0,W,H);
        }

        ctx.strokeStyle="#00f5d4";
        ctx.lineWidth=6;
        ctx.beginPath();
        ctx.ellipse(empOriginX,empOriginY,r1,r1*0.52,0,0,Math.PI*2);
        ctx.stroke();

        ctx.strokeStyle="#ffffff";
        ctx.lineWidth=2.8;
        ctx.beginPath();
        ctx.ellipse(empOriginX,empOriginY,r1*0.76,r1*0.40,0,0,Math.PI*2);
        ctx.stroke();

        ctx.strokeStyle=activeRailColor;
        ctx.lineWidth=3.2;
        ctx.beginPath();
        ctx.arc(empOriginX,empOriginY,r1*0.88,0,Math.PI*2);
        ctx.stroke();

        const arcCount=isMobileHardware?6:10;
        ctx.strokeStyle="#e0f2fe";
        ctx.lineWidth=1.8;
        ctx.beginPath();
        for(let a=0;a<arcCount;a++){
            const baseAng=(a/arcCount)*Math.PI*2+now*0.008;
            const innerR=r1*0.25;
            const midR=r1*0.62;
            const outerR=r1*0.96;
            const j1=(Math.sin(now*0.03+a*4.1))*0.14;
            const j2=(Math.cos(now*0.04+a*2.7))*0.14;
            ctx.moveTo(empOriginX+Math.cos(baseAng)*innerR,empOriginY+Math.sin(baseAng)*innerR*0.55);
            ctx.lineTo(empOriginX+Math.cos(baseAng+j1)*midR,empOriginY+Math.sin(baseAng+j1)*midR*0.55);
            ctx.lineTo(empOriginX+Math.cos(baseAng+j2)*outerR,empOriginY+Math.sin(baseAng+j2)*outerR*0.55);
        }
        ctx.stroke();

        ctx.restore();
    }

    if(theme.weather!=='none'&&gfxSettings.particles>0.05){
        const pCount=Math.floor((isMobileHardware?18:30)*gfxSettings.particles);
        for(let r=0;r<pCount;r++){
            const rx=((r*97+now*0.42)%W),ry=((r*61+now*1.05)%H);
            if(theme.weather==='rain'){
                ctx.strokeStyle="rgba(125,211,252,0.34)";
                ctx.lineWidth=1.3;
                ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-6,ry+15);ctx.stroke();
            }else{
                ctx.fillStyle=theme.weather==='snow'?"rgba(241,245,249,0.75)":(theme.weather==='embers'?"rgba(251,146,60,0.75)":(theme.weather==='petals'?"rgba(244,114,182,0.75)":dynamicWorldColor));
                ctx.fillRect(rx,theme.weather==='embers'?H-ry:ry,2.8,2.8);
            }
        }
    }

    for(let i=0;i<gameState.FloatingTexts.length;i++){
        const ft=gameState.FloatingTexts[i];
        ctx.save();
        ctx.globalAlpha=Math.max(0,ft.life);
        ctx.font="800 13px 'JetBrains Mono',monospace";
        ctx.textAlign="center";
        ctx.fillStyle=ft.color;
        ctx.fillText(ft.text,ft.x,ft.y);
        ctx.restore();
    }

    ctx.restore();
}

function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

window.addEventListener('resize',resizeGameCanvas);
window.addEventListener('orientationchange',()=>{setTimeout(resizeGameCanvas,60);setTimeout(resizeGameCanvas,220);});
window.addEventListener('pageshow',()=>{resizeGameCanvas();setTimeout(resizeGameCanvas,120);resumeAudioForForeground();});
window.addEventListener('pagehide',()=>{silenceAllAudioForBackground();});
window.addEventListener('freeze',()=>{silenceAllAudioForBackground();});
window.addEventListener('blur',()=>{
    if(gameState.running&&!gameState.paused)openPauseSettingsModal('game');
});
window.addEventListener('focus',()=>{
    resizeGameCanvas();
    setTimeout(resizeGameCanvas,120);
    resumeAudioForForeground();
});
window.addEventListener('popstate',()=>{
    if(gameState.running&&!gameState.paused){
        openPauseSettingsModal('game');
        resizeGameCanvas();
    }
});

document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
        if(gameState.running&&!gameState.paused)openPauseSettingsModal('game');
        silenceAllAudioForBackground();
    }else{
        resizeGameCanvas();
        setTimeout(resizeGameCanvas,120);
        if(controlConfig.mobileMode==='tilt')needsSilentGyroCalib=true;
        resumeAudioForForeground();
    }
});

window.addEventListener('deviceorientation',(e)=>{
    if(e.beta===null&&e.gamma===null)return;
    const angle=(screen.orientation&&typeof screen.orientation.angle==='number')?screen.orientation.angle:(typeof window.orientation==='number'?window.orientation:0);
    let raw=0;
    if(angle===90)raw=e.beta||0;
    else if(angle===270||angle===-90)raw=-(e.beta||0);
    else raw=(window.innerHeight>window.innerWidth)?(e.beta||0):(e.gamma||0);
    if(controlConfig.invertGyro)raw=-raw;
    lastRawLandscapeTilt=raw;
    hasGyroReading=true;
    if(needsSilentGyroCalib){
        controlConfig.tiltCenterOffset=raw;
        smoothedGyroDelta=0;
        needsSilentGyroCalib=false;
    }
    const rawDelta=raw-controlConfig.tiltCenterOffset;
    const deadzoneDelta=Math.abs(rawDelta)<1.1?0:(rawDelta>0?rawDelta-1.1:rawDelta+1.1);
    smoothedGyroDelta+=(deadzoneDelta-smoothedGyroDelta)*0.42;
    if(controlConfig.mobileMode==='tilt'){
        const lbl=document.getElementById('gyroLiveAngleLabel');
        if(lbl)lbl.innerText=`${smoothedGyroDelta>0.2?'+':''}${smoothedGyroDelta.toFixed(1)}°`;
    }
    if(!gameState.running||gameState.paused||controlConfig.mobileMode!=='tilt')return;
    const maxTiltDeg=18.0-(controlConfig.gyroSensitivity*11.0);
    const continuousLane=Math.max(-2,Math.min(2,(smoothedGyroDelta/Math.max(4.5,maxTiltDeg))*2.25));
    setMagneticTargetLane(continuousLane);
});

window.addEventListener('pointercancel',()=>{
    setBoosting(false);
    setBraking(false);
    document.querySelectorAll('.touch-paddle.active-press').forEach(el=>el.classList.remove('active-press'));
});

canvas.addEventListener('pointerdown',(e)=>{
    if(e.isTrusted)hasTrustedGesture=true;
    if(isMobileHardware&&gameState.running&&!document.fullscreenElement){
        requestMobileFullscreenSafe();
    }
    if(!gameState.running||gameState.paused)return;
    const now=performance.now();
    const dtTap=now-controlConfig.lastTouchTime;
    if(controlConfig.doubleTapNitro&&dtTap>40&&dtTap<260){
        setBoosting(true);
        if(doubleTapBoostTimer)clearTimeout(doubleTapBoostTimer);
        doubleTapBoostTimer=setTimeout(()=>setBoosting(false),1100);
    }
    controlConfig.lastTouchTime=now;
    if(controlConfig.mobileMode==='drag')handleCanvasTapLane(e);
});

window.addEventListener('keydown',(e)=>{
    if(e.isTrusted)hasTrustedGesture=true;
    if(!isBootSplashDismissed&&(e.key==='Enter'||e.key===' ')){
        e.preventDefault();
        enterMainMenuFromSplash();
        return;
    }
    ensureAudioEngine();
    const k=e.key.toLowerCase();
    if(awaitingRebindAction){
        e.preventDefault();
        if(k!=='escape')controlConfig.binds[awaitingRebindAction]=[k];
        awaitingRebindAction=null;
        refreshKeybindLabels();
        saveSettingsForActiveAccount();
        return;
    }
    if(e.key==='Escape'){
        e.preventDefault();
        if(document.getElementById('leaderboardModal').style.display!=='none'){closeLeaderboardModal();return;}
        if(document.getElementById('pauseSettingsModal').style.display!=='none')resumeFromSettings();
        else if(gameState.running||document.getElementById('gameOverModal').style.display!=='none')openPauseSettingsModal('game');
        return;
    }
    if(!gameState.running||gameState.paused)return;
    if(k==='r'&&currentPilot.id==='1117'){e.preventDefault();devRefillAllSystems();return;}
    if(controlConfig.binds.hideui&&controlConfig.binds.hideui.includes(k)){e.preventDefault();toggleGameHudVisibility();return;}
    if(controlConfig.binds.left.includes(k))steerLane(-1);
    else if(controlConfig.binds.right.includes(k))steerLane(1);
    else if(controlConfig.binds.nitro.includes(k))setBoosting(true);
    else if(controlConfig.binds.brake.includes(k))setBraking(true);
    else if(controlConfig.binds.emp.includes(k)){e.preventDefault();triggerNeuralEmp();}
});

window.addEventListener('keyup',(e)=>{
    const k=e.key.toLowerCase();
    if(controlConfig.binds.nitro.includes(k))setBoosting(false);
    else if(controlConfig.binds.brake.includes(k))setBraking(false);
});

if(lbChannel){
    lbChannel.onmessage=(ev)=>{if(ev.data&&(ev.data.type==='lb_sync_v10'||ev.data.type==='lb_sync_v8'))mergeRemoteLeaderboardPacket(ev.data);};
}

detectDeviceHardware();
upgradeEpoch250HologramWarningUI();
buildVolumeSlidersUI();
buildKeybindGridUI();
buildGraphicsUI();
const savedPilotId=localStorage.getItem('roadSense_overdrive_pilotId')||"GUEST";
applyPilotProfile(savedPilotId);
createAndMountBootSplashGate();
resizeGameCanvas();
updateTopLeaderBanner();
renderMiniRadar();
pullGlobalCloudLeaderboard();
startLiveLeaderboardStream();
startUnifiedMusicScheduler();

let lastFrameTime=performance.now();
function mainLoop(now){
    const dt=Math.min(0.05,Math.max(0.001,(now-lastFrameTime)/1000));
    lastFrameTime=now;
    updateGamePhysics(dt,now);
    renderSceneFrame(now);
    requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);
// --- END OF MINI-CHUNK 6.4 OF 4 ---
// ==================== END OF CHUNK 6 OF 6 ====================
