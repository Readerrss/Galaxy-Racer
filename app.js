const canvas=document.getElementById('gameCanvas');
const ctx=canvas.getContext('2d',{alpha:false});
const radarCanvas=document.getElementById('miniRadarCanvas');
const rCtx=radarCanvas.getContext('2d');
const LANES=[-2,-1,0,1,2];
const LANE_WIDTH_M=3.5;
let isMobileHardware=false,isHudHidden=false,recommendedPresetKey='high';

function detectDeviceHardware(){
    const uaMobile=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const coarsePointer=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;
    isMobileHardware=Boolean(uaMobile||coarsePointer);
    document.body.classList.toggle('is-mobile',isMobileHardware);
    document.body.classList.toggle('is-pc',!isMobileHardware);
    const cores=navigator.hardwareConcurrency||4,mem=navigator.deviceMemory||4;
    if(isMobileHardware){recommendedPresetKey=(cores>=8&&mem>=6)?'high':(cores>=6?'medium':'low');}
    else{recommendedPresetKey=(cores>=12||mem>=16)?'ultra':(cores>=6?'high':'medium');}
    const scanLbl=document.getElementById('gfxHardwareScanLabel');
    if(scanLbl)scanLbl.innerText=`🔍 Device Scan: ${cores} Cores • ${recommendedPresetKey.toUpperCase()} (Recommended)`;
    const ctrlHeader=document.getElementById('ctrlPlatformHeaderLabel');
    if(ctrlHeader)ctrlHeader.innerText=isMobileHardware?"📱 Mobile / Android Touch & Gyro Controls":"⌨️ PC Keyboard Controls & Keybinds";
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
let lastRawLandscapeTilt=0,smoothedGyroDelta=0,awaitingRebindAction=null,lastHudUpdateTime=0;
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

const ACCOUNTS_DB_KEY='roadSense_overdrive_accounts_db_v8';
const DELETED_ACCOUNTS_KEY='roadSense_overdrive_deleted_accs_v8';
const SETTINGS_PER_ACC_KEY='roadSense_overdrive_acc_settings_v9';

let currentPilot=PILOT_PROFILES["GUEST"];
let activeLiveryProfile=PILOT_PROFILES["GUEST"];
let customGuestId=localStorage.getItem('roadSense_overdrive_customGuestId')||"";
let customGuestName=localStorage.getItem('roadSense_overdrive_guestName')||"";
let isAccountSessionLocked=localStorage.getItem('roadSense_overdrive_accountLocked')==='true';
let devAllDimensionsUnlocked=true;
let isApplyingAccountSettings=false;

function getAccountsDatabase(){try{return JSON.parse(localStorage.getItem(ACCOUNTS_DB_KEY)||'{}');}catch(e){return {};}}
function saveAccountsDatabase(db){localStorage.setItem(ACCOUNTS_DB_KEY,JSON.stringify(db));}
function getDeletedAccountKeys(){try{return JSON.parse(localStorage.getItem(DELETED_ACCOUNTS_KEY)||'[]');}catch(e){return [];}}
function saveDeletedAccountKeys(arr){localStorage.setItem(DELETED_ACCOUNTS_KEY,JSON.stringify(arr));}

function getEffectiveGuestDisplayName(){
    const clean=(customGuestName||"").trim();
    if(clean)return clean;
    if(customGuestId)return `Pilot #${customGuestId}`;
    return "Guest Pilot";
}

function getActiveAccountStorageKey(){
    if(currentPilot.isCore)return currentPilot.id;
    if(customGuestId)return `GUEST_ID_${customGuestId}`;
    return `GUEST_${getEffectiveGuestDisplayName().replace(/\s+/g,'_').toUpperCase()}`;
}

function getActiveAccountStats(){
    const db=getAccountsDatabase();
    return db[getActiveAccountStorageKey()]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
}

function saveActiveAccountStats(scoreVal,epochVal,flashesVal){
    const db=getAccountsDatabase();
    const key=getActiveAccountStorageKey();
    const prev=db[key]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
    const dispName=currentPilot.isCore?currentPilot.name:getEffectiveGuestDisplayName();
    const maxEp=Math.max(prev.bestEpoch||1,epochVal);
    db[key]={
        id:currentPilot.isCore?currentPilot.id:key,
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
                updateGyroSpeedSetting(Math.round((saved.ctrl.gyroSensitivity||0.45)*100));
                if(saved.ctrl.binds)controlConfig.binds=saved.ctrl.binds;
                refreshKeybindLabels();
            }
            if(saved.gfx){
                applyGraphicsPreset(saved.gfx.preset||recommendedPresetKey,false);
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
    const raw=(input?input.value:'').trim();
    if(!/^\d{4}$/.test(raw)){
        showLoginBanner("✕ Enter a 4-digit numeric ID (e.g., XXXX) or play as Guest.",false);
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
        customGuestName=(existingAcc&&existingAcc.name&&!existingAcc.name.startsWith('Pilot #'))?existingAcc.name:"";
        localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
        applyPilotProfile("GUEST");
        if(input)input.value='';
        showLoginBanner(`✓ Account #${customGuestId} Logged In!`,true);
        playGameSfx('pickup');
    }
}

function confirmGuestAccountLogin(){
    const gInput=document.getElementById('guestCallsignInput');
    if(gInput)updateGuestCallsign(gInput.value);
    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    applyPilotProfile(currentPilot.id);
    showLoginBanner(`✓ Logged in as ${getEffectiveGuestDisplayName()}`,true);
    playGameSfx('pickup');
}

function openSwitchAccountRow(){
    isAccountSessionLocked=false;
    localStorage.setItem('roadSense_overdrive_accountLocked','false');
    customGuestId="";
    customGuestName="";
    localStorage.removeItem('roadSense_overdrive_customGuestId');
    localStorage.removeItem('roadSense_overdrive_guestName');
    const gInput=document.getElementById('guestCallsignInput');
    const idInput=document.getElementById('pilotIdInput');
    if(gInput)gInput.value="";
    if(idInput)idInput.value="";
    applyPilotProfile("GUEST");
    showLoginBanner("⇄ Switched to New Guest Session (Default Settings Loaded).",true);
}

function updateGuestCallsign(val){
    customGuestName=(val||"").trim();
    localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
    if(!currentPilot.isCore){
        const disp=getEffectiveGuestDisplayName();
        document.getElementById('activePilotLabel').innerText=customGuestId?`${disp} (#${customGuestId})`:disp;
        document.getElementById('hudPilotCallsign').innerText=disp.toUpperCase();
        if(customGuestId){
            const db=getAccountsDatabase();
            const key=getActiveAccountStorageKey();
            if(db[key]){db[key].name=disp;saveAccountsDatabase(db);}
        }
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
    }
    if(currentPilot.id==="1117")devAllDimensionsUnlocked=true;
    loadOrResetSettingsForActiveAccount();
    const dispName=currentPilot.isCore?currentPilot.name:getEffectiveGuestDisplayName();
    const dispLabel=(!currentPilot.isCore&&customGuestId)?`${dispName} (#${customGuestId})`:dispName;
    const displayCallsign=currentPilot.isCore?currentPilot.callsign:dispName.toUpperCase();
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
        if(gInput)gInput.value=customGuestName;
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

const audioSettings={master:0.90,music:0.85,menuMusic:0.80,engine:0.75,sfx:0.90,uiClick:0.85,ostMode:'synth'};
let audioCtx=null,masterGainNode=null,compressorNode=null,engineOsc1=null,engineOsc2=null,engineGain=null,synthLoopTimer=null,synthStep=0,menuStep=0;

function buildVolumeSlidersUI(){
    const sliders=[
        {k:'master',lbl:'🔊 Master Volume',col:'emerald',val:90},
        {k:'music',lbl:'🎵 Gameplay OST Volume',col:'sky',val:85},
        {k:'menuMusic',lbl:'🎹 Menu & Pause Music',col:'cyan',val:80},
        {k:'engine',lbl:'🏎️ Engine & Turbo',col:'amber',val:75},
        {k:'sfx',lbl:'⚡ Effects, EMP & Siren',col:'purple',val:90},
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
    if(mitadruIdx<mitadruCandidates.length){mitadruAudio.src=mitadruCandidates[mitadruIdx];mitadruAudio.play().catch(()=>{});}
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
        const pilotName=currentPilot.isCore?currentPilot.name:getEffectiveGuestDisplayName();
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

function ensureAudioEngine(){
    if(!audioCtx){
        audioCtx=new (window.AudioContext||window.webkitAudioContext)();
        compressorNode=audioCtx.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(-14,audioCtx.currentTime);
        compressorNode.ratio.setValueAtTime(6,audioCtx.currentTime);
        masterGainNode=audioCtx.createGain();
        masterGainNode.gain.setValueAtTime(audioSettings.master,audioCtx.currentTime);
        masterGainNode.connect(compressorNode);
        compressorNode.connect(audioCtx.destination);
        engineOsc1=audioCtx.createOscillator();
        engineOsc2=audioCtx.createOscillator();
        const engineFilter=audioCtx.createBiquadFilter();
        engineGain=audioCtx.createGain();
        engineOsc1.type='sawtooth';
        engineOsc2.type='triangle';
        engineOsc1.frequency.setValueAtTime(56,audioCtx.currentTime);
        engineOsc2.frequency.setValueAtTime(112,audioCtx.currentTime);
        engineFilter.type='lowpass';
        engineFilter.frequency.setValueAtTime(230,audioCtx.currentTime);
        engineGain.gain.setValueAtTime(0.0001,audioCtx.currentTime);
        engineOsc1.connect(engineFilter);
        engineOsc2.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(masterGainNode);
        engineOsc1.start();
        engineOsc2.start();
        startUnifiedMusicScheduler();
    }
    if(audioCtx.state==='suspended')audioCtx.resume();
    return audioCtx;
}

function updateEngineSoundPitch(){
    if(!audioCtx||!engineOsc1||!engineGain)return;
    const now=audioCtx.currentTime;
    if(!gameState.running||gameState.paused||document.hidden){
        engineGain.gain.setTargetAtTime(0.0001,now,0.08);
        return;
    }
    const speedRatio=Math.max(0.5,Math.min(2.3,gameState.speedMps/30));
    const baseFreq=50*speedRatio+(gameState.boosting?25:0);
    engineOsc1.frequency.setTargetAtTime(baseFreq,now,0.05);
    engineOsc2.frequency.setTargetAtTime(baseFreq*2.02,now,0.05);
    const targetVol=0.085*audioSettings.engine*(gameState.boosting?1.35:0.9);
    engineGain.gain.setTargetAtTime(Math.max(0.0001,targetVol),now,0.06);
}

function startUnifiedMusicScheduler(){
    if(synthLoopTimer)clearInterval(synthLoopTimer);
    const bassNotes=[73.42,73.42,146.83,73.42,87.31,87.31,98.00,110.00,73.42,73.42,146.83,73.42,116.54,116.54,110.00,98.00];
    const arpNotes=[293.66,349.23,440.00,587.33,523.25,440.00,349.23,440.00,293.66,349.23,466.16,587.33,659.25,587.33,440.00,349.23];
    const menuChords=[220.00,261.63,329.63,392.00,293.66,349.23,440.00,523.25];
    synthLoopTimer=setInterval(()=>{
        if(document.hidden||!audioCtx||audioCtx.state!=='running'||audioSettings.master<=0.01)return;
        const isMenuOrPaused=!gameState.running||gameState.paused;
        if(isMenuOrPaused){
            if(audioSettings.menuMusic<=0.01)return;
            if(menuStep%2===0){
                const now=audioCtx.currentTime;
                const mOsc=audioCtx.createOscillator(),mGain=audioCtx.createGain();
                mOsc.type='sine';
                mOsc.frequency.setValueAtTime(menuChords[(menuStep>>1)%menuChords.length],now);
                mGain.gain.setValueAtTime(0.07*audioSettings.menuMusic,now);
                mGain.gain.exponentialRampToValueAtTime(0.001,now+0.22);
                mOsc.connect(mGain);mGain.connect(masterGainNode);
                mOsc.start(now);mOsc.stop(now+0.22);
            }
            menuStep++;
            return;
        }
        if(audioSettings.ostMode!=='synth'||audioSettings.music<=0.01)return;
        try{
            const now=audioCtx.currentTime,mVol=audioSettings.music,s16=synthStep%16;
            if(s16%4===0){
                const kOsc=audioCtx.createOscillator(),kGain=audioCtx.createGain();
                kOsc.type='sine';
                kOsc.frequency.setValueAtTime(135,now);
                kOsc.frequency.exponentialRampToValueAtTime(34,now+0.13);
                kGain.gain.setValueAtTime(0.28*mVol,now);
                kGain.gain.exponentialRampToValueAtTime(0.001,now+0.14);
                kOsc.connect(kGain);kGain.connect(masterGainNode);
                kOsc.start(now);kOsc.stop(now+0.14);
            }
            const bOsc=audioCtx.createOscillator(),bFilter=audioCtx.createBiquadFilter(),bGain=audioCtx.createGain();
            bOsc.type='sawtooth';bOsc.frequency.setValueAtTime(bassNotes[s16],now);
            bFilter.type='lowpass';bFilter.frequency.setValueAtTime(520,now);
            bGain.gain.setValueAtTime(0.12*mVol,now);bGain.gain.exponentialRampToValueAtTime(0.001,now+0.11);
            bOsc.connect(bFilter);bFilter.connect(bGain);bGain.connect(masterGainNode);
            bOsc.start(now);bOsc.stop(now+0.11);
            const lOsc=audioCtx.createOscillator(),lGain=audioCtx.createGain();
            lOsc.type='triangle';lOsc.frequency.setValueAtTime(arpNotes[s16],now);
            lGain.gain.setValueAtTime(0.075*mVol,now);lGain.gain.exponentialRampToValueAtTime(0.001,now+0.14);
            lOsc.connect(lGain);lGain.connect(masterGainNode);
            lOsc.start(now);lOsc.stop(now+0.14);
            synthStep++;
        }catch(e){}
    },117);
}

function syncExternalTrackPlayback(){
    const shouldPlay=gameState.running&&!gameState.paused&&!document.hidden;
    mitadruAudio.volume=audioSettings.master*audioSettings.music;
    customAudio.volume=audioSettings.master*audioSettings.music;
    if(!shouldPlay){mitadruAudio.pause();customAudio.pause();return;}
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
    mitadruAudio.volume=audioSettings.master*audioSettings.music;
    customAudio.volume=audioSettings.master*audioSettings.music;
    updateEngineSoundPitch();
    saveSettingsForActiveAccount();
}

function playGameSfx(type){
    if(audioSettings.master<=0.01)return;
    try{
        const actx=ensureAudioEngine(),now=actx.currentTime,sVol=audioSettings.sfx,cVol=audioSettings.uiClick;
        if(type==='uiClick'){
            if(cVol<=0.01)return;
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(420,now);o.frequency.exponentialRampToValueAtTime(740,now+0.055);
            g.gain.setValueAtTime(0.15*cVol,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.06);
            o.connect(g);g.connect(masterGainNode);o.start(now);o.stop(now+0.06);
            return;
        }
        if(sVol<=0.01)return;
        if(type==='steer'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(360,now);o.frequency.exponentialRampToValueAtTime(620,now+0.06);
            g.gain.setValueAtTime(0.14*sVol,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.065);
            o.connect(g);g.connect(masterGainNode);o.start(now);o.stop(now+0.065);
        }else if(type==='siren250'){
            for(let c=0;c<6;c++){
                const st=now+c*0.5,o=actx.createOscillator(),g=actx.createGain();
                o.type='sawtooth';o.frequency.setValueAtTime(440,st);o.frequency.linearRampToValueAtTime(880,st+0.25);o.frequency.linearRampToValueAtTime(440,st+0.48);
                g.gain.setValueAtTime(0.24*sVol,st);g.gain.exponentialRampToValueAtTime(0.001,st+0.49);
                o.connect(g);g.connect(masterGainNode);o.start(st);o.stop(st+0.49);
            }
        }else if(type==='phantom'){
            [587.33,880.0,1174.66,1760.0].forEach((f,idx)=>{
                const o=actx.createOscillator(),g=actx.createGain(),st=now+idx*0.032;
                o.type='triangle';o.frequency.setValueAtTime(f,st);
                g.gain.setValueAtTime(0.22*sVol,st);g.gain.exponentialRampToValueAtTime(0.001,st+0.26);
                o.connect(g);g.connect(masterGainNode);o.start(st);o.stop(st+0.26);
            });
        }else if(type==='pickup'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(680,now);o.frequency.setValueAtTime(1020,now+0.045);
            g.gain.setValueAtTime(0.18*sVol,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.16);
            o.connect(g);g.connect(masterGainNode);o.start(now);o.stop(now+0.16);
        }else if(type==='emp'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sawtooth';o.frequency.setValueAtTime(920,now);o.frequency.exponentialRampToValueAtTime(36,now+0.65);
            g.gain.setValueAtTime(0.36*sVol,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.68);
            o.connect(g);g.connect(masterGainNode);o.start(now);o.stop(now+0.68);
        }else if(type==='hit'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sawtooth';o.frequency.setValueAtTime(145,now);o.frequency.exponentialRampToValueAtTime(28,now+0.32);
            g.gain.setValueAtTime(0.38*sVol,now);g.gain.exponentialRampToValueAtTime(0.001,now+0.34);
            o.connect(g);g.connect(masterGainNode);o.start(now);o.stop(now+0.34);
        }
    }catch(e){}
}

document.addEventListener('pointerdown',(e)=>{
    ensureAudioEngine();
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
let isPullingCloud=false;
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
            mapByKey.set(k,{id:rem.id||'GUEST',accountKey:k,name:rem.name||'Guest Pilot',score:Number(rem.score),epoch:Number(rem.epoch||1),ts:Number(rem.ts||Date.now())});
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

function recordScoreToLeaderboard(scoreVal,epochVal){
    if(!scoreVal||scoreVal<=0)return;
    const accountKey=getActiveAccountStorageKey();
    const pid=currentPilot.isCore?currentPilot.id:'GUEST';
    const pName=currentPilot.isCore?currentPilot.name:getEffectiveGuestDisplayName();
    saveDeletedAccountKeys(getDeletedAccountKeys().filter(k=>k!==accountKey));
    const list=getLocalLeaderboard();
    const idx=list.findIndex(e=>(e.accountKey||e.id)===accountKey);
    if(idx>=0){
        if(scoreVal>list[idx].score){
            list[idx].score=scoreVal;
            list[idx].epoch=Math.max(list[idx].epoch||1,epochVal);
            list[idx].name=pName;
            list[idx].ts=Date.now();
        }
    }else{
        list.push({id:pid,accountKey,name:pName,score:scoreVal,epoch:epochVal,ts:Date.now()});
    }
    saveLocalLeaderboard(list);
    pushCloudLeaderboardPacket();
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
        const delBtn=isAdmin?`<button type="button" onclick="adminDeleteIndividualScore('${escapeHtml(accKey)}')" class="ml-2 px-2 py-1 rounded bg-red-600/85 hover:bg-red-500 text-white text-[9px] mono-num font-bold cursor-pointer">🗑️ Delete</button>`:'';
        const badge=prof.isVoidChroma?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-extrabold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/50">👑 ARCHITECT VOID</span>`:(isCore?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-bold rounded bg-white/10 text-gray-200">⚡ CORE TEAM</span>`:`<span class="px-1.5 py-0.5 text-[9px] mono-num rounded bg-gray-800 text-gray-400">PILOT</span>`);
        return `<div class="p-3 rounded-xl flex items-center justify-between gap-2 transition ${prof.lbClass}"><div class="flex items-center gap-2.5 min-w-0"><span class="mono-num text-xs font-black text-white px-2 py-1 rounded bg-black/40 border border-white/10 shrink-0">${medals[idx]||`#${idx+1}`}</span><div class="min-w-0"><div class="flex items-center gap-1.5 flex-wrap"><span class="text-xs sm:text-sm truncate ${prof.nameClass}">${escapeHtml(entry.name)}</span>${badge}</div><div class="text-[10px] mono-num text-gray-400">Epoch ${entry.epoch||1} &bull; ${prof.liveryName}</div></div></div><div class="flex items-center shrink-0"><span class="mono-num text-sm sm:text-base font-black text-emerald-400">${entry.score.toLocaleString()}</span>${delBtn}</div></div>`;
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
    preset:'high',filter:'filter-standard',resScale:1.25,roadSlices:36,particles:1.0,
    bloom:true,shake:true,transitions:true,scanlines:false,
    pillars:true,reflections:true,speedLines:true,hudBoxes:true
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
            const isRec=(k===recommendedPresetKey);
            const active=(gfxSettings.preset===k);
            return `<button type="button" onclick="applyGraphicsPreset('${k}',true)" class="py-1.5 px-2 rounded-lg text-[10.5px] font-bold cursor-pointer border truncate ${active?'bg-sky-500 text-black border-sky-400':'bg-[#151a26] text-gray-300 border-[#262f45] hover:text-white'}">${p.title}${isRec?' (Rec)':''}</button>`;
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
    const p=GRAPHICS_PRESETS[presetKey]||GRAPHICS_PRESETS[recommendedPresetKey];
    gfxSettings.preset=presetKey;
    const pLbl=document.getElementById('gfxPresetActiveLabel');
    if(pLbl)pLbl.innerText=`${p.title.toUpperCase()}${presetKey===recommendedPresetKey?' (RECOMMENDED)':''}`;
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

const controlConfig={
    mobileMode:'buttons',doubleTapNitro:true,tiltCenterOffset:0,invertGyro:false,gyroSensitivity:0.45,lastTouchTime:0,
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
    const pct=Math.max(20,Math.min(100,parseInt(val,10)||45));
    controlConfig.gyroSensitivity=pct/100;
    const lbl=document.getElementById('gyroSpeedLabel');
    if(lbl)lbl.innerText=`${pct}% (${pct<=50?'Smooth':(pct<=75?'Balanced':'Fast')})`;
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
        else if(mode==='drag'){mapTitle.innerText="ACTIVE CONTROL MAP // FINGER DRAG";mapSteer.innerText="Slide Finger Left/Right on Road";}
        else{mapTitle.innerText="ACTIVE CONTROL MAP // PHONE TILT (GYRO)";mapSteer.innerText="Tilt Phone in Landscape (Wheel)";}
    }
    if(mode==='tilt'&&typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
        DeviceOrientationEvent.requestPermission().catch(()=>{});
    }
    saveSettingsForActiveAccount();
}

function toggleInvertGyro(){
    controlConfig.invertGyro=!controlConfig.invertGyro;
    const btn=document.getElementById('invertGyroBtn');
    if(btn){
        btn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;
        btn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";
    }
    saveSettingsForActiveAccount();
}

function calibrateTiltSensor(){
    if(controlConfig.mobileMode!=='tilt')return;
    controlConfig.tiltCenterOffset=lastRawLandscapeTilt;
    smoothedGyroDelta=0;
    const angleLbl=document.getElementById('gyroLiveAngleLabel');
    if(angleLbl)angleLbl.innerText="0.0° (CALIBRATED ✓)";
    playGameSfx('pickup');
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
    updateVolumeSetting('master',90);
    updateVolumeSetting('music',85);
    updateVolumeSetting('menuMusic',80);
    updateVolumeSetting('engine',75);
    updateVolumeSetting('sfx',90);
    updateVolumeSetting('uiClick',85);
    selectOstMode('synth');
    saveSettingsForActiveAccount();
}

function resetControlSettingsOnly(){
    setMobileControlMode('buttons');
    applyDoubleTapNitroState(true);
    updateGyroSpeedSetting(45);
    controlConfig.tiltCenterOffset=0;
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
    applyGraphicsPreset(recommendedPresetKey,true);
}

function setDiscreteTargetLane(newLaneInt){
    const clamped=Math.max(-2,Math.min(2,Math.round(newLaneInt)));
    const prevLane=Math.round(gameState.targetLane);
    if(clamped!==prevLane){
        const dir=clamped>prevLane?1:-1;
        gameState.targetLane=clamped;
        playGameSfx('steer');
        gameState.egoRoll=dir*0.14;
        checkPhantomFlashNearMiss(prevLane);
    }
}

function handleCanvasPointerDrag(e){
    const wrapper=document.getElementById('gameViewportWrapper');
    const isRot=isMobileHardware&&window.innerHeight>window.innerWidth;
    const normX=isRot?(e.clientY/Math.max(1,window.innerHeight)):(e.clientX/Math.max(1,wrapper.clientWidth));
    setDiscreteTargetLane(Math.round((normX-0.5)*4.8));
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
    const anyModal=document.getElementById('startModal').style.display!=='none'||document.getElementById('pauseSettingsModal').style.display!=='none'||document.getElementById('leaderboardModal').style.display!=='none'||document.getElementById('gameOverModal').style.display!=='none';
    document.body.classList.toggle('gameplay-active',gameState.running&&!gameState.paused&&!anyModal);
}

function openPauseSettingsModal(defaultTab='game'){
    if(gameState.running&&!gameState.paused){
        gameState.paused=true;
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
    document.getElementById('pauseSettingsModal').style.display='none';
    if(gameState.running){
        gameState.paused=false;
        syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(true);
    }
    syncCursorVisibility();
}

function returnToMainMenu(){
    gameState.running=false;gameState.paused=false;gameState.ep250WarnTimer=0;
    syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(false);
    ['epoch250RedAlertModal','singularityAlertBanner','pauseSettingsModal','gameOverModal','leaderboardModal'].forEach(id=>document.getElementById(id).style.display='none');
    document.getElementById('startModal').style.display='flex';
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
    {id:3,name:"two_wheeler",  wPx:30,hPx:26,w:1.18,speedMul:0.75,color:"#a855f7",roof:"#3b0764",points:160,weaves:true},
    {id:4,name:"pedestrian",   wPx:30,hPx:26,w:1.18,speedMul:0.12,color:"#fb7185",roof:"#881337",points:200},
    {id:5,name:"stray_animal", wPx:30,hPx:26,w:1.18,speedMul:0.08,color:"#fbbf24",roof:"#78350f",points:190},
    {id:6,name:"pothole",      wPx:30,hPx:26,w:1.18,speedMul:0.00,color:"#64748b",roof:"#0f172a",points:100,flat:true},
    {id:7,name:"speed_bump",   wPx:30,hPx:26,w:1.18,speedMul:0.00,color:"#eab308",roof:"#422006",points:90, flat:true}
];

const EGO_Z_REAR=1.24,EGO_Z_CENTER=1.45,EGO_Z_FRONT=1.70,EGO_HALF_LANE_W=0.35;

function resizeGameCanvas(){
    detectDeviceHardware();
    const wrapper=document.getElementById('gameViewportWrapper');
    const winW=window.innerWidth||document.documentElement.clientWidth||800;
    const winH=window.innerHeight||document.documentElement.clientHeight||450;
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
    if(!isMobileHardware)return;
    const docEl=document.documentElement;
    if(!document.fullscreenElement&&docEl.requestFullscreen){
        docEl.requestFullscreen({navigationUI:'hide'}).then(()=>{
            if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(()=>{});
            setTimeout(resizeGameCanvas,60);setTimeout(resizeGameCanvas,220);
        }).catch(()=>resizeGameCanvas());
    }else resizeGameCanvas();
}

document.addEventListener('fullscreenchange',()=>{resizeGameCanvas();setTimeout(resizeGameCanvas,100);});

function triggerEpoch250BigRedWarning(){
    gameState.ep250WarnTriggered=true;
    gameState.ep250WarnTimer=3.0;
    document.getElementById('epoch250RedAlertModal').style.display='flex';
    playGameSfx('siren250');
}

function startGameSession(startEpochOverride=1){
    ensureAudioEngine();
    requestMobileFullscreenSafe();
    resizeGameCanvas();
    isAccountSessionLocked=true;
    localStorage.setItem('roadSense_overdrive_accountLocked','true');
    ['startModal','pauseSettingsModal','leaderboardModal','gameOverModal','epoch250RedAlertModal'].forEach(id=>document.getElementById(id).style.display='none');
    const initEpoch=Math.max(1,Math.floor(startEpochOverride||1));
    Object.assign(gameState,{
        running:true,paused:false,score:0,epoch:initEpoch,combo:1.0,nearMisses:0,
        armor:100,nitroFuel:100,empCharge:100,distanceM:getDistanceForEpoch(initEpoch),
        speedMps:25,targetLane:0,egoLaneX:0,egoRoll:0,boosting:false,braking:false,
        slowMoTimer:0,empWaveRadius:0,screenShake:0,ep250WarnTriggered:(initEpoch>250),
        ep250WarnTimer:0,hazards:[],pickups:[],FloatingTexts:[]
    });
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
    gameState.running=false;
    syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(false);syncCursorVisibility();
    try{window.open('','_self','');window.close();}catch(e){}
    if(!window.closed){if(window.history.length>1)window.history.back();else window.location.href='index.html';}
}

function checkPhantomFlashNearMiss(prevLane){
    for(let i=0;i<gameState.hazards.length;i++){
        const h=gameState.hazards[i];
        if(!h.nearMissed&&Math.abs(h.lane-prevLane)<0.65&&h.z>EGO_Z_REAR&&h.z<9.5){
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
function setBoosting(active){gameState.boosting=(active&&gameState.nitroFuel>2);}
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

function projectX(laneOffset,zSafe,W,H,roadCurve){
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

    gameState.speedMps+=(targetSpeed-gameState.speedMps)*Math.min(1,dt*6);
    gameState.distanceM+=gameState.speedMps*effDt;
    gameState.score+=Math.round(gameState.speedMps*effDt*gameState.combo*diff.scoreMul*1.35);
    updateEngineSoundPitch();

    gameState.targetLane=Math.max(-2,Math.min(2,Math.round(gameState.targetLane)));
    const laneDiff=gameState.targetLane-gameState.egoLaneX;
    if(Math.abs(laneDiff)<0.006){gameState.egoLaneX=gameState.targetLane;gameState.egoRoll=0;}
    else{gameState.egoLaneX+=laneDiff*Math.min(1,dt*15);gameState.egoRoll+=(laneDiff*0.12-gameState.egoRoll)*Math.min(1,dt*12);}

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

    for(let i=gameState.hazards.length-1;i>=0;i--){
        const h=gameState.hazards[i];
        h.z-=Math.max(4,gameState.speedMps-h.speedMps)*effDt;
        if(h.cls.weaves)h.lane=Math.max(-2,Math.min(2,h.baseLane+Math.sin(now*0.0025+h.phase)*0.34));
        if(h.z<=EGO_Z_FRONT+0.35&&h.z>=EGO_Z_REAR-0.20){
            const latDist=Math.abs(h.lane-gameState.egoLaneX);
            const hitThresh=(EGO_HALF_LANE_W+(h.cls.w/LANE_WIDTH_M)*0.36)*diff.hitboxScale;
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
        if(p.z<=EGO_Z_FRONT+0.8&&p.z>=EGO_Z_REAR-0.35&&Math.abs(p.lane-gameState.egoLaneX)<0.65){
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

function triggerGameOver(){
    gameState.running=false;gameState.ep250WarnTimer=0;
    document.getElementById('epoch250RedAlertModal').style.display='none';
    syncExternalTrackPlayback();updateEngineSoundPitch();
    saveActiveAccountStats(gameState.score,gameState.epoch,gameState.nearMisses);
    recordScoreToLeaderboard(gameState.score,gameState.epoch);
    const st=getActiveAccountStats();
    document.getElementById('finalScoreVal').innerText=gameState.score.toLocaleString();
    document.getElementById('finalBestVal').innerText=(st.bestScore||gameState.score).toLocaleString();
    document.getElementById('finalEpochVal').innerText=`Epoch ${gameState.epoch} • ${BIOME_THEMES[biomeIdx].label}`;
    document.getElementById('finalNearMissVal').innerText=String(gameState.nearMisses);
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

    const nitroPct=Math.floor(gameState.nitroFuel),empPct=Math.floor(gameState.empCharge);
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
            wb.className=warnTier==='CRITICAL'?"px-1.5 py-0.5 rounded text-[8.5px] sm:text-[10px] font-bold bg-red-950 text-red-400 border border-red-500":(warnTier==='WARNING'?"px-1.5 py-0.5 rounded text-[8.5px] sm:text-[10px] font-bold bg-orange-950 text-orange-400 border border-orange-500":(warnTier==='CAUTION'?"px-1.5 py-0.5 rounded text-[8.5px] sm:text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500":"px-1.5 py-0.5 rounded text-[8.5px] sm:text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700"));
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
            const cableY= (horizonY-towerH) + (1-norm*norm)*(deckY-(horizonY-towerH)-6);
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
        peaks.forEach(([ox,oh],idx)=>{
            const px=cx+ox*W,pw=W*0.13,ph=H*oh;
            ctx.fillStyle="#041529";ctx.strokeStyle="#7dd3fc";ctx.lineWidth=1.4;
            ctx.beginPath();ctx.moveTo(px-pw,horizonY);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="rgba(224,242,254,0.25)";
            ctx.beginPath();ctx.moveTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.lineTo(px+pw*0.15,horizonY);ctx.closePath();ctx.fill();
        });
    }else if(hType==="bio"){
        const mr=u*0.095,mcy=horizonY-mr*1.35;
        ctx.fillStyle="#062e16";ctx.strokeStyle="#4ade80";ctx.lineWidth=2.2;
        ctx.beginPath();ctx.arc(cx,mcy,mr,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle="rgba(74,222,128,0.38)";ctx.lineWidth=1.2;
        ctx.beginPath();ctx.arc(cx-mr*0.25,mcy-mr*0.15,mr*0.35,0,Math.PI*2);ctx.arc(cx+mr*0.3,mcy+mr*0.2,mr*0.22,0,Math.PI*2);ctx.stroke();
        [-0.34,-0.19,0.19,0.34].forEach((ox,i)=>{
            const mx=cx+ox*W,stemH=H*(i%2===0?0.09:0.13),capR=u*(i%2===0?0.045:0.062);
            ctx.fillStyle="#041f11";ctx.strokeStyle="#22c55e";ctx.lineWidth=1.4;
            ctx.beginPath();ctx.moveTo(mx-5,horizonY);ctx.quadraticCurveTo(mx+(i%2?4:-4),horizonY-stemH*0.5,mx-3,horizonY-stemH);
            ctx.lineTo(mx+3,horizonY-stemH);ctx.quadraticCurveTo(mx+(i%2?4:-4),horizonY-stemH*0.5,mx+5,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
            ctx.fillStyle="#0b3b21";ctx.strokeStyle="#4ade80";ctx.lineWidth=1.8;
            ctx.beginPath();ctx.ellipse(mx,horizonY-stemH,capR,capR*0.42,0,Math.PI,0,false);ctx.closePath();ctx.fill();ctx.stroke();
        });
    }else if(hType==="eclipse"){
        const r=u*0.105,ecy=horizonY-r*1.12;
        ctx.strokeStyle="rgba(244,63,94,0.35)";ctx.lineWidth=8;
        ctx.beginPath();ctx.arc(cx,ecy,r*1.14,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle="#040002";ctx.strokeStyle="#fb7185";ctx.lineWidth=2.5;
        ctx.beginPath();ctx.arc(cx,ecy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(cx+r*0.72,ecy-r*0.68,5,0,Math.PI*2);ctx.fill();
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
        ctx.rotate(now*0.0006);
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
        ctx.save();ctx.translate(cx,cy);ctx.rotate(-0.18);
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

function renderHighTextureDistinctHazard(hz,zSafe,W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue){
    const bx=projectX(hz.lane,zSafe,W,H,roadCurve);
    const by=projectY(zSafe,0,H);
    const screenScale=Math.max(0.76,Math.min(1.08,Math.min(W,H)/450));
    const boxW=30*screenScale;
    const boxH=26*screenScale;
    const x1=bx-boxW*0.5,y2=by,y1=y2-boxH;
    const primaryCol=isCosmic250?`hsl(${(cosmicHue+hz.cls.id*45)%360},90%,58%)`:hz.cls.color;
    const tierColor=(hz.rFinal>=0.85)?"#ef4444":(hz.rFinal>=0.65?"#f97316":(hz.rFinal>=0.35?"#f59e0b":dynamicWorldColor));

    ctx.fillStyle="rgba(0,0,0,0.62)";
    ctx.beginPath();ctx.ellipse(bx,y2+2,boxW*0.54,4,0,0,Math.PI*2);ctx.fill();

    const cid=hz.cls.id;
    if(cid===0){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1+1,y2-6,4,6);ctx.fillRect(x1+boxW-5,y2-6,4,6);ctx.fillRect(bx-2,y2-5,4,5);
        ctx.fillStyle="#111827";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(x1+2,y2-3);ctx.lineTo(x1+3,y1+boxH*0.36);ctx.quadraticCurveTo(bx,y1-3,x1+boxW-3,y1+boxH*0.36);
        ctx.lineTo(x1+boxW-2,y2-3);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+3,y1+boxH*0.48,boxW-6,boxH*0.40);
        ctx.fillStyle="#060b14";ctx.strokeStyle="#38bdf888";ctx.lineWidth=1;
        ctx.fillRect(x1+5,y1+boxH*0.18,boxW-10,boxH*0.25);ctx.strokeRect(x1+5,y1+boxH*0.18,boxW-10,boxH*0.25);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+4,y2-7,5,3);ctx.fillRect(x1+boxW-9,y2-7,5,3);
        ctx.fillStyle="#fde047";ctx.fillRect(bx-3,y2-6,6,2);
    }else if(cid===1){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1,y2-7,5,7);ctx.fillRect(x1+boxW-5,y2-7,5,7);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.7;
        ctx.beginPath();
        ctx.moveTo(x1+1,y2-2);ctx.lineTo(x1+1,y1+3);ctx.lineTo(x1+4,y1);
        ctx.lineTo(x1+boxW-4,y1);ctx.lineTo(x1+boxW-1,y1+3);ctx.lineTo(x1+boxW-1,y2-2);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+3,y1+boxH*0.22,boxW-6,boxH*0.62);
        ctx.fillStyle="#09101d";
        ctx.fillRect(x1+4,y1+boxH*0.26,boxW-8,boxH*0.22);
        ctx.strokeStyle="rgba(255,255,255,0.35)";ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x1+4,y1+boxH*0.58);ctx.lineTo(x1+boxW-4,y1+boxH*0.58);
        ctx.moveTo(x1+4,y1+boxH*0.70);ctx.lineTo(x1+boxW-4,y1+boxH*0.70);ctx.stroke();
        ctx.fillStyle="#fbbf24";
        ctx.fillRect(x1+5,y1+1,3,2);ctx.fillRect(bx-1.5,y1+1,3,2);ctx.fillRect(x1+boxW-8,y1+1,3,2);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+3,y2-6,6,3);ctx.fillRect(x1+boxW-9,y2-6,6,3);
    }else if(cid===2){
        ctx.fillStyle="#05070b";
        ctx.fillRect(x1,y2-6,4.5,6);ctx.fillRect(x1+boxW-4.5,y2-6,4.5,6);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.7;
        ctx.beginPath();
        ctx.moveTo(x1,y2-2);ctx.lineTo(x1+2,y1+boxH*0.42);ctx.lineTo(x1+6,y1+2);
        ctx.lineTo(x1+boxW-6,y1+2);ctx.lineTo(x1+boxW-2,y1+boxH*0.42);ctx.lineTo(x1+boxW,y2-2);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle="#7dd3fc";
        ctx.beginPath();
        ctx.moveTo(x1+6.5,y1+4);ctx.lineTo(x1+boxW-6.5,y1+4);
        ctx.lineTo(x1+boxW-4,y1+boxH*0.40);ctx.lineTo(x1+4,y1+boxH*0.40);
        ctx.closePath();ctx.fill();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+2.5,y1+boxH*0.44,boxW-5,boxH*0.42);
        ctx.fillStyle="#06080f";
        ctx.fillRect(x1+3,y2-8,boxW-6,5);
        ctx.fillStyle="#ff1e42";
        ctx.fillRect(x1+3.5,y2-7.5,7,3.5);ctx.fillRect(x1+boxW-10.5,y2-7.5,7,3.5);
        ctx.fillStyle="#38bdf8";ctx.fillRect(bx-3,y2-7,6,2);
    }else if(cid===3){
        ctx.fillStyle="#05070b";
        ctx.fillRect(bx-3,y2-9,6,9);
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.8;
        ctx.beginPath();
        ctx.moveTo(bx-6,y2-3);ctx.lineTo(bx-7,y1+boxH*0.44);ctx.lineTo(bx,y1+2);
        ctx.lineTo(bx+7,y1+boxH*0.44);ctx.lineTo(bx+6,y2-3);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#e2e8f0";ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(bx-9,y1+boxH*0.38);ctx.lineTo(bx+9,y1+boxH*0.38);ctx.stroke();
        ctx.fillStyle="#f8fafc";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.2;
        ctx.beginPath();ctx.arc(bx,y1+6,4.2,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#00f5d4";ctx.fillRect(bx-2.5,y1+5,5,2);
        ctx.fillStyle="#ff1e42";ctx.fillRect(bx-3,y2-8,6,3);
    }else if(cid===4){
        ctx.strokeStyle="rgba(251,113,133,0.45)";ctx.lineWidth=1.2;
        ctx.beginPath();ctx.ellipse(bx,y2,boxW*0.38,3,0,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle="#0f172a";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();ctx.arc(bx,y1+4.5,4.2,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#00f5d4";ctx.fillRect(bx-2.5,y1+3.5,5,2);
        ctx.fillStyle=primaryCol;
        ctx.beginPath();
        ctx.moveTo(bx-6,y1+9.5);ctx.lineTo(bx+6,y1+9.5);ctx.lineTo(bx+4.5,y1+19);ctx.lineTo(bx-4.5,y1+19);
        ctx.closePath();ctx.fill();
        ctx.fillStyle="#1e293b";ctx.fillRect(bx-3,y1+11,6,5);
        ctx.strokeStyle="#e2e8f0";ctx.lineWidth=2;
        ctx.beginPath();
        ctx.moveTo(bx-5.5,y1+10.5);ctx.lineTo(bx-9,y1+17);
        ctx.moveTo(bx+5.5,y1+10.5);ctx.lineTo(bx+9,y1+17);
        ctx.moveTo(bx-2.5,y1+19);ctx.lineTo(bx-3.5,y2);
        ctx.moveTo(bx+2.5,y1+19);ctx.lineTo(bx+3.5,y2);
        ctx.stroke();
    }else if(cid===5){
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(x1+5,y1+9);ctx.lineTo(x1+boxW-6,y1+9);ctx.lineTo(x1+boxW-4,y1+18);ctx.lineTo(x1+4,y1+18);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1+2,y1+11);ctx.lineTo(x1+6,y1+3);ctx.lineTo(x1+11,y1+9);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#fde68a";ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(x1+4,y1+4);ctx.lineTo(x1+1,y1+1);ctx.moveTo(x1+7,y1+4);ctx.lineTo(x1+9,y1+1);ctx.stroke();
        ctx.fillStyle=primaryCol;
        ctx.fillRect(x1+5,y1+18,3,7);ctx.fillRect(x1+10,y1+18,2.5,6.5);
        ctx.fillRect(x1+boxW-12,y1+18,2.5,6.5);ctx.fillRect(x1+boxW-8,y1+18,3,7);
        ctx.fillStyle="#00f5d4";ctx.fillRect(x1+4,y1+6,2,2);
    }else if(cid===6){
        ctx.fillStyle="#05070c";ctx.strokeStyle=primaryCol;ctx.lineWidth=1.8;
        ctx.beginPath();
        ctx.moveTo(x1+1,y2-6);ctx.lineTo(x1+6,y2-12);ctx.lineTo(bx+2,y2-13);
        ctx.lineTo(x1+boxW-2,y2-9);ctx.lineTo(x1+boxW-1,y2-3);ctx.lineTo(bx-3,y2-1);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.strokeStyle="#38bdf8";ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(x1+6,y2-6);ctx.lineTo(bx,y2-8);ctx.lineTo(x1+boxW-6,y2-5);ctx.stroke();
        ctx.fillStyle="#f59e0b";
        ctx.fillRect(x1+3,y2-15,4,2);ctx.fillRect(x1+boxW-7,y2-15,4,2);
    }else{
        ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
        ctx.beginPath();
        ctx.moveTo(x1,y2-2);ctx.lineTo(x1+3,y2-11);ctx.lineTo(x1+boxW-3,y2-11);ctx.lineTo(x1+boxW,y2-2);
        ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=primaryCol;
        for(let c=0;c<4;c++){
            const sx=x1+4+c*(boxW-8)/4;
            ctx.beginPath();
            ctx.moveTo(sx,y2-3);ctx.lineTo(sx+2.5,y2-10);ctx.lineTo(sx+5,y2-10);ctx.lineTo(sx+2.5,y2-3);
            ctx.closePath();ctx.fill();
        }
        ctx.fillStyle="#ef4444";
        ctx.fillRect(x1+2,y2-5,3,2);ctx.fillRect(x1+boxW-5,y2-5,3,2);
    }

    if(gfxSettings.hudBoxes){
        ctx.strokeStyle=tierColor;
        ctx.lineWidth=hz.rFinal>=0.65?1.9:1.2;
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

function renderSceneFrame(now){
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
        const pk=gameState.pickups[i];
        const px=projectX(pk.lane,pk.z,W,H,roadCurve),py=projectY(pk.z,0.55,H),r=8.0;
        ctx.save();
        ctx.translate(px,py);ctx.rotate(pk.spin);
        ctx.fillStyle=pk.type==='nitro'?"#fbbf24":(pk.type==='emp'?"#38bdf8":"#10b981");
        ctx.strokeStyle="#ffffff";ctx.lineWidth=1.5;
        ctx.fillRect(-r,-r,r*2,r*2);ctx.strokeRect(-r,-r,r*2,r*2);
        ctx.fillStyle="#ffffff";ctx.fillRect(-r*0.35,-r*0.35,r*0.7,r*0.7);
        ctx.restore();
    }

    gameState.hazards.sort((a,b)=>b.z-a.z);
    ctx.font="bold 10px 'JetBrains Mono',monospace";
    for(let i=0;i<gameState.hazards.length;i++){
        const hz=gameState.hazards[i];
        renderHighTextureDistinctHazard(hz,Math.max(0.55,hz.z),W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue);
    }

    const rearLeftX=projectX(gameState.egoLaneX-EGO_HALF_LANE_W,EGO_Z_REAR,W,H,roadCurve);
    const rearRightX=projectX(gameState.egoLaneX+EGO_HALF_LANE_W,EGO_Z_REAR,W,H,roadCurve);
    const rearY=projectY(EGO_Z_REAR,0,H);
    const frontLeftX=projectX(gameState.egoLaneX-EGO_HALF_LANE_W*0.78,EGO_Z_FRONT,W,H,roadCurve);
    const frontRightX=projectX(gameState.egoLaneX+EGO_HALF_LANE_W*0.78,EGO_Z_FRONT,W,H,roadCurve);
    const frontY=projectY(EGO_Z_FRONT,0.30,H);
    const roofLeftX=projectX(gameState.egoLaneX-EGO_HALF_LANE_W*0.52,EGO_Z_CENTER,W,H,roadCurve);
    const roofRightX=projectX(gameState.egoLaneX+EGO_HALF_LANE_W*0.52,EGO_Z_CENTER,W,H,roadCurve);
    const roofY=projectY(EGO_Z_CENTER,0.64,H);

    const carCenterX=(rearLeftX+rearRightX)*0.5,carHalfW=(rearRightX-rearLeftX)*0.5;

    ctx.fillStyle="rgba(0,0,0,0.65)";
    ctx.beginPath();ctx.ellipse(carCenterX,rearY+4,carHalfW*1.06,6,0,0,Math.PI*2);ctx.fill();

    ctx.fillStyle="#05070b";
    ctx.fillRect(rearLeftX-3,rearY-12,6,11);
    ctx.fillRect(rearRightX-3,rearY-12,6,11);

    const bodyGrad=ctx.createLinearGradient(carCenterX,roofY,carCenterX,rearY);
    bodyGrad.addColorStop(0,activeLiveryProfile.chassisTop||"#1e293b");
    bodyGrad.addColorStop(0.55,"#151c2c");
    bodyGrad.addColorStop(1,activeLiveryProfile.chassisBot||"#0b0f19");

    const borderGlowCol=gameState.boosting?"#fbbf24":activeRailColor;
    if(gfxSettings.bloom){
        ctx.shadowBlur=isMobileHardware?12:16;
        ctx.shadowColor=borderGlowCol;
    }

    ctx.fillStyle=bodyGrad;
    ctx.strokeStyle=borderGlowCol;
    ctx.lineWidth=2.4;
    ctx.beginPath();
    ctx.moveTo(rearLeftX,rearY);ctx.lineTo(frontLeftX,frontY);ctx.lineTo(roofLeftX,roofY);
    ctx.lineTo(roofRightX,roofY);ctx.lineTo(frontRightX,frontY);ctx.lineTo(rearRightX,rearY);
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;

    ctx.strokeStyle=`${borderGlowCol}88`;
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.moveTo(rearLeftX+carHalfW*0.28,rearY-2);ctx.lineTo(roofLeftX+2,roofY+3);
    ctx.moveTo(rearRightX-carHalfW*0.28,rearY-2);ctx.lineTo(roofRightX-2,roofY+3);
    ctx.moveTo((roofLeftX+roofRightX)*0.5,roofY+12);ctx.lineTo(carCenterX,rearY-9);
    ctx.stroke();

    ctx.fillStyle=activeLiveryProfile.canopyColor;
    ctx.beginPath();
    ctx.moveTo(frontLeftX+(frontRightX-frontLeftX)*0.16,frontY+1);
    ctx.lineTo(roofLeftX+3,roofY+2);
    ctx.lineTo(roofRightX-3,roofY+2);
    ctx.lineTo(frontRightX-(frontRightX-frontLeftX)*0.16,frontY+1);
    ctx.closePath();ctx.fill();

    ctx.fillStyle="#06080f";
    ctx.fillRect(rearLeftX+3,rearY-10,(rearRightX-rearLeftX)-6,8);

    const thrusterCol=gameState.braking?"#ef4444":(gameState.boosting?"#fbbf24":(activeLiveryProfile.isVoidChroma?activeRailColor:activeLiveryProfile.thrusterColor));
    ctx.fillStyle=thrusterCol;
    const tWidth=Math.max(10,carHalfW*0.38);
    ctx.fillRect(rearLeftX+5,rearY-9,tWidth,6);
    ctx.fillRect(rearRightX-tWidth-5,rearY-9,tWidth,6);
    ctx.fillRect(carCenterX-6,rearY-8,12,4);

    if(gameState.boosting){
        ctx.fillStyle="#fde68a";
        ctx.fillRect(rearLeftX+8,rearY-3,tWidth*0.6,8+Math.random()*6);
        ctx.fillRect(rearRightX-tWidth*0.6-8,rearY-3,tWidth*0.6,8+Math.random()*6);
    }

    if(gameState.empWaveRadius>0){
        ctx.strokeStyle=activeRailColor;ctx.lineWidth=5;
        ctx.beginPath();ctx.arc(W*0.5,H*0.75,gameState.empWaveRadius,0,Math.PI*2);ctx.stroke();
    }

    if(theme.weather!=='none'&&gfxSettings.particles>0.05){
        const pCount=Math.floor((isMobileHardware?18:30)*gfxSettings.particles);
        for(let r=0;r<pCount;r++){
            const rx=((r*97+now*0.42)%W),ry=((r*61+now*1.05)%H);
            if(theme.weather==='rain'){
                ctx.strokeStyle="rgba(125,211,252,0.28)";
                ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-6,ry+14);ctx.stroke();
            }else{
                ctx.fillStyle=theme.weather==='snow'?"rgba(241,245,249,0.65)":(theme.weather==='embers'?"rgba(251,146,60,0.65)":(theme.weather==='petals'?"rgba(244,114,182,0.65)":dynamicWorldColor));
                ctx.fillRect(rx,theme.weather==='embers'?H-ry:ry,2.5,2.5);
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
window.addEventListener('orientationchange',()=>setTimeout(resizeGameCanvas,80));

document.addEventListener('visibilitychange',()=>{
    if(document.hidden){syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(false);}
    else if(gameState.running&&!gameState.paused){syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(true);}
});

window.addEventListener('deviceorientation',(e)=>{
    if(e.beta===null&&e.gamma===null)return;
    const angle=(screen.orientation&&typeof screen.orientation.angle==='number')?screen.orientation.angle:(typeof window.orientation==='number'?window.orientation:0);
    let raw=e.beta||0;
    if(angle===270||angle===-90)raw=-raw;
    if(controlConfig.invertGyro)raw=-raw;
    lastRawLandscapeTilt=raw;
    smoothedGyroDelta+=((raw-controlConfig.tiltCenterOffset)-smoothedGyroDelta)*0.22;
    if(controlConfig.mobileMode==='tilt'){
        const lbl=document.getElementById('gyroLiveAngleLabel');
        if(lbl)lbl.innerText=`${smoothedGyroDelta>0.2?'+':''}${smoothedGyroDelta.toFixed(1)}°`;
    }
    if(!gameState.running||gameState.paused||controlConfig.mobileMode!=='tilt')return;
    const degPerLane=17.0-(controlConfig.gyroSensitivity*11.5);
    setDiscreteTargetLane(Math.max(-2,Math.min(2,Math.round(smoothedGyroDelta/Math.max(5.0,degPerLane)))));
});

canvas.addEventListener('pointerdown',(e)=>{
    if(!gameState.running||gameState.paused)return;
    const now=performance.now();
    if(controlConfig.doubleTapNitro&&(now-controlConfig.lastTouchTime<280)){
        setBoosting(true);setTimeout(()=>setBoosting(false),1100);
    }
    controlConfig.lastTouchTime=now;
    if(controlConfig.mobileMode==='drag')handleCanvasPointerDrag(e);
});

canvas.addEventListener('pointermove',(e)=>{
    if(gameState.running&&!gameState.paused&&controlConfig.mobileMode==='drag'&&e.buttons>0)handleCanvasPointerDrag(e);
});

window.addEventListener('keydown',(e)=>{
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
    lbChannel.onmessage=(ev)=>{if(ev.data&&ev.data.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(ev.data);};
}

detectDeviceHardware();
buildVolumeSlidersUI();
buildKeybindGridUI();
buildGraphicsUI();
const savedPilotId=localStorage.getItem('roadSense_overdrive_pilotId')||"GUEST";
applyPilotProfile(savedPilotId);
resizeGameCanvas();
updateTopLeaderBanner();
renderMiniRadar();
pullGlobalCloudLeaderboard();

let lastFrameTime=performance.now();
function mainLoop(now){
    const dt=Math.min(0.05,Math.max(0.001,(now-lastFrameTime)/1000));
    lastFrameTime=now;
    updateGamePhysics(dt,now);
    renderSceneFrame(now);
    requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);