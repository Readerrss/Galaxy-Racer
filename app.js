const canvas=document.getElementById('gameCanvas'),ctx=canvas.getContext('2d',{alpha:false}),radarCanvas=document.getElementById('miniRadarCanvas'),rCtx=radarCanvas.getContext('2d');
const LANES=[-2,-1,0,1,2],LANE_WIDTH_M=3.5;
let isMobileHardware=false,isHudHidden=false,recommendedPresetKey='low',detectedGpuName='Standard GPU';

function scanWebGlGpuTier(){
    try{
        const gl=document.createElement('canvas').getContext('webgl');
        if(!gl)return{name:'Canvas2D',tier:1};
        const ext=gl.getExtension('WEBGL_debug_renderer_info');
        const raw=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||''):String(gl.getParameter(gl.RENDERER)||'');
        const r=raw.toLowerCase();
        detectedGpuName=raw.replace(/ANGLE \((.+?),?\)/i,'$1').split(',')[0].trim().slice(0,22)||'GPU';
        if(/rtx|radeon rx [6789]|apple m[1234]|gtx 16|gtx 10[678]/i.test(r))return{name:detectedGpuName,tier:4};
        if(/iris|uhd|vega|gtx|radeon|apple a1[678]|adreno \(tm\) 7[345]/i.test(r))return{name:detectedGpuName,tier:3};
        if(/adreno \(tm\) [67]|mali-g[789]|immortalis|apple gpu/i.test(r))return{name:detectedGpuName,tier:2};
        return{name:detectedGpuName,tier:1};
    }catch(e){return{name:'GPU',tier:1};}
}

function detectDeviceHardware(){
    const uaMobile=/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const coarse=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;
    isMobileHardware=Boolean(uaMobile||coarse);
    document.body.classList.toggle('is-mobile',isMobileHardware);
    document.body.classList.toggle('is-pc',!isMobileHardware);
    const cores=navigator.hardwareConcurrency||4,mem=navigator.deviceMemory||4,dpr=window.devicePixelRatio||1;
    const gpu=scanWebGlGpuTier();
    if(isMobileHardware){
        if(gpu.tier>=3&&mem>=8&&dpr<=2.5)recommendedPresetKey='high';
        else if(gpu.tier>=2&&mem>=6&&cores>=8)recommendedPresetKey='medium';
        else recommendedPresetKey='low';
    }else{
        if(gpu.tier>=4||(cores>=12&&mem>=8))recommendedPresetKey='ultra';
        else if(gpu.tier>=3||(cores>=8&&mem>=8))recommendedPresetKey='high';
        else if(cores>=4&&mem>=4)recommendedPresetKey='medium';
        else recommendedPresetKey='low';
    }
    const scanLbl=document.getElementById('gfxHardwareScanLabel');
    if(scanLbl)scanLbl.innerText=`🔍 Scan: ${gpu.name} (${cores}C/${mem}GB) • ${recommendedPresetKey.toUpperCase()} (Rec)`;
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
    running:false,paused:false,score:0,epoch:1,combo:1.0,nearMisses:0,armor:100,nitroFuel:100,empCharge:100,
    distanceM:0,speedMps:25,targetLane:0,egoLaneX:0,egoRoll:0,boosting:false,braking:false,slowMoTimer:0,
    empWaveRadius:0,screenShake:0,ep250WarnTriggered:false,ep250WarnTimer:0,
    viewW:window.innerWidth,viewH:window.innerHeight,hazards:[],pickups:[],FloatingTexts:[],stars:[]
};

const STAR_COLORS=["#ffffff","#7dd3fc","#f472b6","#c084fc","#fde68a","#00f5d4"];
for(let i=0;i<85;i++)gameState.stars.push({x:Math.random(),y:Math.random()*0.41,s:Math.random()*1.8+0.6,sp:Math.random()*0.25+0.06,col:STAR_COLORS[i%STAR_COLORS.length]});

let spawnAccumulator=0,pickupAccumulator=0,radarAngle=Math.PI,lastRawLandscapeTilt=0,smoothedGyroDelta=0,needsSilentGyroCalib=true,hasGyroReading=false;
let awaitingRebindAction=null,lastHudUpdateTime=0,lastLiveLbPushTime=0,fpsMonitorFrames=0,fpsMonitorSlow=0;
const domCache={};
let cachedGradients={key:'',sky:null,sun:null};

function setTextCached(id,val){if(domCache[id]===val)return;domCache[id]=val;const el=document.getElementById(id);if(el)el.innerText=val;}
function setStyleWidthCached(id,wStr){const k=id+'_w';if(domCache[k]===wStr)return;domCache[k]=wStr;const el=document.getElementById(id);if(el)el.style.width=wStr;}

const PILOT_PROFILES={
    "1117":{id:"1117",name:"Mitadru Karmakar (Void)",callsign:"VOID // ARCHITECT",liveryName:"Dark-Matter Prismatic Chroma",isVoidChroma:true,isCore:true,dotColor:"#00f5d4",chassisTop:"#1a2236",chassisBot:"#090d18",canopyColor:"#c77dff",thrusterColor:"#ff007f",railColor:"#00f5d4",lbClass:"void-leaderboard-card",nameClass:"void-name-glow"},
    "1183":{id:"1183",name:"Ritam Chatterjee",callsign:"RITAM // DATASET",liveryName:"Solar Gold Telemetry",isVoidChroma:false,isCore:true,dotColor:"#f59e0b",chassisTop:"#33220a",chassisBot:"#170f04",canopyColor:"#fde68a",thrusterColor:"#f97316",railColor:"#f59e0b",lbClass:"core-glow-ritam bg-[#16120a]",nameClass:"text-amber-300 font-extrabold"},
    "1134":{id:"1134",name:"Syed Meraj Ahmed",callsign:"MERAJ // FIELD QA",liveryName:"Crimson Phantom Carbon",isVoidChroma:false,isCore:true,dotColor:"#ef4444",chassisTop:"#360f18",chassisBot:"#17060a",canopyColor:"#fda4af",thrusterColor:"#ef4444",railColor:"#f43f5e",lbClass:"core-glow-meraj bg-[#180b0e]",nameClass:"text-red-400 font-extrabold"},
    "1075":{id:"1075",name:"Sourajita Choudhury",callsign:"SOURAJITA // IEEE",liveryName:"Emerald Matrix Jade",isVoidChroma:false,isCore:true,dotColor:"#10b981",chassisTop:"#0b3024",chassisBot:"#051711",canopyColor:"#a7f3d0",thrusterColor:"#10b981",railColor:"#10b981",lbClass:"core-glow-sourajita bg-[#091814]",nameClass:"text-emerald-300 font-extrabold"},
    "1174":{id:"1174",name:"Debankita Das",callsign:"DEBANKITA // RISK",liveryName:"Amethyst Pulsar",isVoidChroma:false,isCore:true,dotColor:"#a855f7",chassisTop:"#271242",chassisBot:"#11071f",canopyColor:"#e9d5ff",thrusterColor:"#a855f7",railColor:"#c084fc",lbClass:"core-glow-debankita bg-[#130b1c]",nameClass:"text-purple-300 font-extrabold"},
    "GUEST":{id:"GUEST",name:"Guest Pilot",callsign:"EGO-01 // GUEST",liveryName:"Tactical Steel",isVoidChroma:false,isCore:false,dotColor:"#38bdf8",chassisTop:"#1e293b",chassisBot:"#0f172a",canopyColor:"#7dd3fc",thrusterColor:"#38bdf8",railColor:"#38bdf8",lbClass:"bg-[#111520] border border-[#232938]",nameClass:"text-gray-200 font-semibold"}
};

const CORE_IDS=new Set(["1117","1183","1134","1075","1174"]);
const ACCOUNTS_DB_KEY='roadSense_overdrive_accounts_db_v8',DELETED_ACCOUNTS_KEY='roadSense_overdrive_deleted_accs_v8',SETTINGS_PER_ACC_KEY='roadSense_overdrive_acc_settings_v10';

let currentPilot=PILOT_PROFILES["GUEST"],activeLiveryProfile=PILOT_PROFILES["GUEST"];
let customGuestId=localStorage.getItem('roadSense_overdrive_customGuestId')||"",customGuestName=localStorage.getItem('roadSense_overdrive_guestName')||"";
let isAccountSessionLocked=localStorage.getItem('roadSense_overdrive_accountLocked')==='true',devAllDimensionsUnlocked=true,isApplyingAccountSettings=false;

function generateRandomGuest4DigitId(){
    let c="1000";
    for(let t=0;t<50;t++){c=String(Math.floor(1000+Math.random()*9000));if(!CORE_IDS.has(c))break;}
    return c;
}
function ensureGuestHas4DigitId(){
    if(currentPilot.isCore)return"";
    if(!/^\d{4}$/.test(customGuestId)||CORE_IDS.has(customGuestId)){customGuestId=generateRandomGuest4DigitId();localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);}
    return customGuestId;
}
function getAccountsDatabase(){try{return JSON.parse(localStorage.getItem(ACCOUNTS_DB_KEY)||'{}');}catch(e){return{};}}
function saveAccountsDatabase(db){localStorage.setItem(ACCOUNTS_DB_KEY,JSON.stringify(db));}
function getDeletedAccountKeys(){try{return JSON.parse(localStorage.getItem(DELETED_ACCOUNTS_KEY)||'[]');}catch(e){return[];}}
function saveDeletedAccountKeys(arr){localStorage.setItem(DELETED_ACCOUNTS_KEY,JSON.stringify(arr));}
function getEffectiveGuestFullLabel(){const gid=ensureGuestHas4DigitId(),clean=(customGuestName||"").trim();return clean?`${clean} (#${gid})`:`Pilot #${gid}`;}
function getActiveAccountStorageKey(){return currentPilot.isCore?currentPilot.id:`GUEST_ID_${ensureGuestHas4DigitId()}`;}
function getActiveAccountStats(){const db=getAccountsDatabase();return db[getActiveAccountStorageKey()]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};}

function saveActiveAccountStats(scoreVal,epochVal,flashesVal){
    const db=getAccountsDatabase(),key=getActiveAccountStorageKey(),prev=db[key]||{bestScore:0,bestEpoch:1,totalFlashes:0,completedEpoch250:false};
    const dispName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel(),maxEp=Math.max(prev.bestEpoch||1,epochVal);
    db[key]={id:currentPilot.isCore?currentPilot.id:key,guestId:currentPilot.isCore?"":ensureGuestHas4DigitId(),name:dispName,isCore:currentPilot.isCore,bestScore:Math.max(prev.bestScore||0,scoreVal),bestEpoch:maxEp,totalFlashes:(prev.totalFlashes||0)+flashesVal,completedEpoch250:Boolean(prev.completedEpoch250||maxEp>250),updatedAt:Date.now()};
    saveAccountsDatabase(db);refreshAccountStatsUI();
}

function syncAutoBiomeButtonUI(){
    const btn=document.getElementById('autoBiomeToggleBtn');
    if(!btn)return;
    btn.innerText=autoCycleBiomes?"🔄 Auto-Cycle: ON":"🔄 Auto-Cycle: OFF";
    btn.className=autoCycleBiomes?"px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] mono-num font-bold cursor-pointer shrink-0":"px-2.5 py-1 rounded bg-gray-800 text-gray-300 border border-gray-600 text-[10px] mono-num font-bold cursor-pointer shrink-0";
}

function saveSettingsForActiveAccount(){
    if(isApplyingAccountSettings)return;
    try{
        const allSet=JSON.parse(localStorage.getItem(SETTINGS_PER_ACC_KEY)||'{}');
        allSet[getActiveAccountStorageKey()]={diff:currentDiffKey,liveryId:activeLiveryProfile.id,biomeIdx,autoCycleBiomes,audio:{...audioSettings},gfx:{...gfxSettings},ctrl:{mobileMode:controlConfig.mobileMode,doubleTapNitro:controlConfig.doubleTapNitro,invertGyro:controlConfig.invertGyro,gyroSensitivity:controlConfig.gyroSensitivity,binds:JSON.parse(JSON.stringify(controlConfig.binds))}};
        localStorage.setItem(SETTINGS_PER_ACC_KEY,JSON.stringify(allSet));
    }catch(e){}
}

function loadOrResetSettingsForActiveAccount(){
    isApplyingAccountSettings=true;
    try{
        const allSet=JSON.parse(localStorage.getItem(SETTINGS_PER_ACC_KEY)||'{}'),saved=allSet[getActiveAccountStorageKey()];
        if(saved){
            setDifficulty(saved.diff||'easy');
            activeLiveryProfile=(saved.liveryId&&(currentPilot.id==='1117'||saved.liveryId===currentPilot.id))?(PILOT_PROFILES[saved.liveryId]||currentPilot):currentPilot;
            biomeIdx=isBiomeUnlockedForPilot(saved.biomeIdx||0)?(saved.biomeIdx||0):0;
            autoCycleBiomes=saved.autoCycleBiomes!==undefined?Boolean(saved.autoCycleBiomes):true;
            syncAutoBiomeButtonUI();setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
            if(saved.audio){
                ['master','music','menuMusic','engine','sfx','uiClick'].forEach(ch=>{if(saved.audio[ch]!==undefined)updateVolumeSetting(ch,Math.round(saved.audio[ch]*100));});
                selectOstMode(saved.audio.ostMode==='mitadru'&&currentPilot.id!=='1117'?'synth':(saved.audio.ostMode||'synth'));
            }
            if(saved.ctrl){
                setMobileControlMode(saved.ctrl.mobileMode||'buttons');
                applyDoubleTapNitroState(saved.ctrl.doubleTapNitro!==false);
                controlConfig.invertGyro=Boolean(saved.ctrl.invertGyro);
                const invBtn=document.getElementById('invertGyroBtn');
                if(invBtn){invBtn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;invBtn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";}
                updateGyroSpeedSetting(Math.round((saved.ctrl.gyroSensitivity||0.65)*100));
                if(saved.ctrl.binds)controlConfig.binds=saved.ctrl.binds;
                refreshKeybindLabels();
            }
            if(saved.gfx){
                applyGraphicsPreset(saved.gfx.preset||recommendedPresetKey,false);
                if(saved.gfx.resScale)updateGfxResolution(Math.round(saved.gfx.resScale*100),false);
                if(saved.gfx.roadSlices)updateGfxDrawSlices(saved.gfx.roadSlices,false);
                if(saved.gfx.particles!==undefined)updateGfxParticles(Math.round(saved.gfx.particles*100),false);
                ['bloom','shake','transitions','scanlines','pillars','reflections','speedLines','hudBoxes'].forEach(k=>{if(saved.gfx[k]!==undefined)applyGfxOptionState(k,saved.gfx[k],false);});
                setVisualFilter(saved.gfx.filter||'filter-standard',false);
            }
        }else{
            resetGameSettingsOnly();resetSoundSettingsOnly();resetControlSettingsOnly();resetGraphicsSettingsOnly();
        }
    }catch(e){}
    isApplyingAccountSettings=false;saveSettingsForActiveAccount();
}

function refreshAccountStatsUI(){
    const st=getActiveAccountStats();
    setTextCached('bootHighScore',(st.bestScore||0).toLocaleString());
    setTextCached('bootBestEpoch',`Epoch ${st.bestEpoch||1}`);
    setTextCached('bootTotalFlashes',(st.totalFlashes||0).toLocaleString());
}

function showLoginBanner(msg,ok=true){
    const b=document.getElementById('loginFeedbackBanner');if(!b)return;
    b.className=ok?"text-[10.5px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 block":"text-[10.5px] font-semibold px-2.5 py-1 rounded-lg bg-red-950/90 text-red-300 border border-red-500/40 block";
    b.innerText=msg;
}

function loginPilotById(){
    const input=document.getElementById('pilotIdInput'),gInput=document.getElementById('guestCallsignInput');
    let raw=(input?input.value:'').trim();const typedName=(gInput?gInput.value:'').trim();
    if(!raw)raw=generateRandomGuest4DigitId();
    else if(!/^\d{4}$/.test(raw)){showLoginBanner("✕ Enter a 4-digit numeric ID (or leave blank for Auto-ID).",false);playGameSfx('hit');return;}
    isAccountSessionLocked=true;localStorage.setItem('roadSense_overdrive_accountLocked','true');
    if(PILOT_PROFILES[raw]&&raw!=="GUEST"){
        customGuestId="";localStorage.removeItem('roadSense_overdrive_customGuestId');applyPilotProfile(raw);
        if(input)input.value='';showLoginBanner(`✓ Core Pilot Authenticated: ${currentPilot.name}`,true);playGameSfx('pickup');
    }else{
        customGuestId=raw;localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);
        const db=getAccountsDatabase(),existingAcc=db[`GUEST_ID_${customGuestId}`];
        customGuestName=typedName?typedName:((existingAcc&&existingAcc.name&&!existingAcc.name.startsWith('Pilot #'))?existingAcc.name.replace(/\s*\(#\d{4}\)$/,''):"");
        localStorage.setItem('roadSense_overdrive_guestName',customGuestName);applyPilotProfile("GUEST");
        if(input)input.value='';showLoginBanner(`✓ Guest Account Logged In: ${getEffectiveGuestFullLabel()}`,true);playGameSfx('pickup');
    }
}

function confirmGuestAccountLogin(){
    const idInput=document.getElementById('pilotIdInput'),gInput=document.getElementById('guestCallsignInput'),rawId=(idInput?idInput.value:'').trim();
    if(rawId&&/^\d{4}$/.test(rawId)){loginPilotById();return;}
    ensureGuestHas4DigitId();if(gInput)updateGuestCallsign(gInput.value);
    isAccountSessionLocked=true;localStorage.setItem('roadSense_overdrive_accountLocked','true');
    applyPilotProfile("GUEST");showLoginBanner(`✓ Guest Session Active: ${getEffectiveGuestFullLabel()}`,true);playGameSfx('pickup');
}

function openSwitchAccountRow(){
    isAccountSessionLocked=false;localStorage.setItem('roadSense_overdrive_accountLocked','false');
    customGuestId=generateRandomGuest4DigitId();customGuestName="";
    localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);localStorage.removeItem('roadSense_overdrive_guestName');
    const gInput=document.getElementById('guestCallsignInput'),idInput=document.getElementById('pilotIdInput');
    if(gInput)gInput.value="";if(idInput){idInput.value="";idInput.placeholder=customGuestId;}
    applyPilotProfile("GUEST");showLoginBanner(`⇄ New Guest ID Assigned: #${customGuestId} (Or enter custom 4-digit ID / Name).`,true);
}

function updateGuestCallsign(val){
    customGuestName=(val||"").trim();localStorage.setItem('roadSense_overdrive_guestName',customGuestName);
    if(!currentPilot.isCore){
        const fullLbl=getEffectiveGuestFullLabel();
        document.getElementById('activePilotLabel').innerText=fullLbl;document.getElementById('hudPilotCallsign').innerText=fullLbl.toUpperCase();
        const db=getAccountsDatabase(),key=getActiveAccountStorageKey();
        if(db[key]){db[key].name=fullLbl;saveAccountsDatabase(db);}
        refreshAccountStatsUI();
    }
}

function applyPilotProfile(idKey){
    currentPilot=PILOT_PROFILES[idKey]||PILOT_PROFILES["GUEST"];activeLiveryProfile=currentPilot;
    localStorage.setItem('roadSense_overdrive_pilotId',currentPilot.id);
    if(currentPilot.isCore){isAccountSessionLocked=true;localStorage.setItem('roadSense_overdrive_accountLocked','true');}else ensureGuestHas4DigitId();
    if(currentPilot.id==="1117")devAllDimensionsUnlocked=true;
    loadOrResetSettingsForActiveAccount();
    const dispLabel=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel(),displayCallsign=currentPilot.isCore?currentPilot.callsign:dispLabel.toUpperCase();
    document.getElementById('activePilotLabel').innerText=dispLabel;document.getElementById('activeLiveryBadge').innerText=activeLiveryProfile.liveryName;
    document.getElementById('activePilotColorDot').style.backgroundColor=activeLiveryProfile.dotColor;
    document.getElementById('hudPilotCallsign').innerText=displayCallsign;document.getElementById('hudPilotDot').style.backgroundColor=activeLiveryProfile.dotColor;
    const loginRow=document.getElementById('pilotLoginInputRow'),switchBtn=document.getElementById('switchAccountBtn');
    if(isAccountSessionLocked||currentPilot.isCore){if(loginRow)loginRow.classList.add('hidden');if(switchBtn)switchBtn.classList.remove('hidden');}
    else{if(loginRow)loginRow.classList.remove('hidden');if(switchBtn)switchBtn.classList.add('hidden');const gInput=document.getElementById('guestCallsignInput'),idInput=document.getElementById('pilotIdInput');if(gInput)gInput.value=customGuestName;if(idInput)idInput.placeholder=customGuestId||"Auto";}
    const devTabBtn=document.getElementById('setTabBtn_dev'),navGrid=document.getElementById('settingsTabNavGrid'),hudRefillBtn=document.getElementById('hudDevRefillBtn');
    if(currentPilot.id==="1117"){if(devTabBtn)devTabBtn.classList.remove('hidden');if(navGrid)navGrid.className="px-3 py-1.5 bg-[#090b10] border-b border-[#232836] grid grid-cols-5 gap-1.5 shrink-0";if(hudRefillBtn)hudRefillBtn.classList.remove('hidden');}
    else{if(devTabBtn)devTabBtn.classList.add('hidden');if(navGrid)navGrid.className="px-3 py-1.5 bg-[#090b10] border-b border-[#232836] grid grid-cols-4 gap-1.5 shrink-0";if(hudRefillBtn)hudRefillBtn.classList.add('hidden');}
    const ostBadge=document.getElementById('mitadruOstBadge');if(ostBadge)ostBadge.innerText=currentPilot.id==="1117"?"UNLOCKED":"ID 1117";
    refreshAccountStatsUI();buildVehicleLiverySelector();buildBiomeSelectorGrid();loadCustomSongForActivePilot();syncDevDimensionsButtonLabel();
}

function buildVehicleLiverySelector(){
    const container=document.getElementById('vehicleLiveryGrid'),hint=document.getElementById('liveryAccessHint');if(!container)return;
    const isArch=(currentPilot.id==="1117");if(hint)hint.innerText=isArch?"👑 ID 1117: All Liveries Unlocked":`Assigned: ${activeLiveryProfile.liveryName}`;
    container.innerHTML=["1117","1183","1134","1075","1174","GUEST"].map(k=>{
        const p=PILOT_PROFILES[k],unlocked=isArch||(currentPilot.id===k),sel=(activeLiveryProfile.id===k);
        if(!unlocked)return`<button type="button" disabled class="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate border bg-[#0b0d14] border-[#1b202e] text-gray-600 opacity-55 cursor-not-allowed">🔒 ${p.liveryName}</button>`;
        return`<button type="button" onclick="selectVehicleLivery('${k}')" class="px-2 py-1.5 rounded-lg text-[10px] font-bold text-left truncate cursor-pointer border flex items-center gap-1.5 ${sel?'bg-sky-500/25 border-sky-400 text-white':'bg-[#121621] border-[#22293a] text-gray-300 hover:text-white'}"><span class="w-2 h-2 rounded-full shrink-0" style="background:${p.dotColor}"></span><span class="truncate">${p.liveryName}</span></button>`;
    }).join('');
}

function selectVehicleLivery(k){
    if(currentPilot.id!=="1117"&&currentPilot.id!==k)return;
    activeLiveryProfile=PILOT_PROFILES[k]||currentPilot;
    document.getElementById('activeLiveryBadge').innerText=activeLiveryProfile.liveryName;
    document.getElementById('activePilotColorDot').style.backgroundColor=activeLiveryProfile.dotColor;
    document.getElementById('hudPilotDot').style.backgroundColor=activeLiveryProfile.dotColor;
    buildVehicleLiverySelector();saveSettingsForActiveAccount();
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

const EPOCH_250_INDEX=13,EPOCH_250_LENGTH_M=800;
let biomeIdx=0,autoCycleBiomes=true;

function isBiomeUnlockedForPilot(idx){
    if(currentPilot.id==="1117")return devAllDimensionsUnlocked?true:(idx===0);
    const b=BIOME_THEMES[idx];if(!b)return false;
    const st=getActiveAccountStats(),maxReached=Math.max(st.bestEpoch||1,gameState.epoch||1);
    return b.isEpoch250Special?Boolean(st.completedEpoch250||maxReached>=251):maxReached>=(b.unlockEpoch||1);
}

function buildBiomeSelectorGrid(){
    const container=document.getElementById('biomeGridSelector');if(!container)return;
    container.innerHTML=BIOME_THEMES.map((b,idx)=>{
        const unlocked=isBiomeUnlockedForPilot(idx),active=(idx===biomeIdx),lockText=b.isEpoch250Special?"🔒 Survive Ep 250":`🔒 Ep ${b.unlockEpoch}`;
        if(!unlocked)return`<button type="button" disabled class="px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate border bg-[#0b0d14] border-[#1b202e] text-gray-600 opacity-60 cursor-not-allowed">${lockText} • ${b.label}</button>`;
        return`<button type="button" onclick="selectManualBiome(${idx})" class="biome-btn px-2 py-1.5 rounded-lg text-[10px] font-semibold text-left truncate cursor-pointer border ${active?'bg-sky-500/25 border-sky-400 text-white':'bg-[#121621] border-[#22293a] text-gray-300 hover:text-white'}">${b.label}</button>`;
    }).join('');
}

function selectManualBiome(idx){
    if(!isBiomeUnlockedForPilot(idx))return;
    biomeIdx=idx%BIOME_THEMES.length;cachedGradients.key='';autoCycleBiomes=false;
    syncAutoBiomeButtonUI();setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
    buildBiomeSelectorGrid();saveSettingsForActiveAccount();
}
function toggleAutoBiomeCycle(){autoCycleBiomes=!autoCycleBiomes;syncAutoBiomeButtonUI();saveSettingsForActiveAccount();}

const audioSettings={master:0.95,music:0.90,menuMusic:0.85,engine:0.80,sfx:0.92,uiClick:0.85,ostMode:'synth'};
let audioCtx=null,sfxGainNode=null,engineOsc1=null,engineOsc2=null,engineGain=null;
const lastSfxTime={};

function createSynthesizedWavUrl(isGameplay){
    const sr=22050,stepSec=isGameplay?0.1171875:0.15,steps=16,stepSamples=Math.floor(sr*stepSec),totalSamples=stepSamples*steps;
    const buf=new ArrayBuffer(44+totalSamples*2),view=new DataView(buf);
    const writeStr=(off,s)=>{for(let i=0;i<s.length;i++)view.setUint8(off+i,s.charCodeAt(i));};
    writeStr(0,'RIFF');view.setUint32(4,36+totalSamples*2,true);writeStr(8,'WAVE');writeStr(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sr,true);view.setUint32(28,sr*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    writeStr(36,'data');view.setUint32(40,totalSamples*2,true);
    const bassNotes=isGameplay?[73.42,73.42,146.83,73.42,87.31,87.31,98.00,110.00,73.42,73.42,146.83,73.42,116.54,116.54,110.00,98.00]:[73.42,73.42,87.31,87.31,65.41,65.41,110.00,98.00];
    const arpNotes=isGameplay?[293.66,349.23,440.00,587.33,523.25,440.00,349.23,440.00,293.66,349.23,466.16,587.33,659.25,587.33,440.00,349.23]:[293.66,349.23,440.00,587.33,523.25,440.00,349.23,293.66,261.63,349.23,440.00,523.25,440.00,349.23,329.63,293.66];
    let offset=44;
    for(let s=0;s<steps;s++){
        const bf=bassNotes[isGameplay?s:((s>>1)%bassNotes.length)],af=arpNotes[s];
        for(let i=0;i<stepSamples;i++){
            const t=i/sr,env=Math.min(1,i/110);
            let sig=0;
            const bPhase=(t*bf)%1,bSaw=(bPhase*2-1)*0.5+Math.sin(t*bf*Math.PI*2)*0.5;
            sig+=bSaw*Math.exp(-t*(isGameplay?14:9))*0.42*env;
            const aSin=Math.sin(t*af*Math.PI*2)+0.5*Math.sin(t*af*2*Math.PI*2);
            sig+=aSin*Math.exp(-t*(isGameplay?16:10))*0.28*env;
            if(isGameplay){
                if(s%4===0){
                    const kFreq=36.71+110*Math.exp(-t*32);
                    sig+=Math.sin(t*kFreq*Math.PI*2)*Math.exp(-t*22)*0.62;
                }else if(s%4===2){
                    const sFreq=95+120*Math.exp(-t*35);
                    sig+=(Math.sin(t*sFreq*Math.PI*2)*0.6+((Math.sin(i*12.9898)*43758.5453)%1)*0.4)*Math.exp(-t*34)*0.26;
                }
            }else{
                sig+=Math.sin(t*af*0.5*Math.PI*2)*Math.exp(-t*8)*0.20*env;
            }
            const clamped=Math.max(-0.98,Math.min(0.98,Math.tanh(sig*1.25)));
            view.setInt16(offset,Math.floor(clamped*32767),true);
            offset+=2;
        }
    }
    return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
}

const synthGameAudio=new Audio(createSynthesizedWavUrl(true));
synthGameAudio.loop=true;
const synthMenuAudio=new Audio(createSynthesizedWavUrl(false));
synthMenuAudio.loop=true;

const mitadruAudio=new Audio();
mitadruAudio.preload='none';mitadruAudio.loop=true;
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

function isAppAudible(){return document.visibilityState!=='hidden'&&!document.hidden;}

function buildVolumeSlidersUI(){
    const sliders=[
        {k:'master',lbl:'🔊 Master Volume',col:'emerald',val:95},
        {k:'music',lbl:'🎵 Gameplay OST Volume',col:'sky',val:90},
        {k:'menuMusic',lbl:'🎹 Menu & Pause Music',col:'cyan',val:85},
        {k:'engine',lbl:'🏎️ Engine & Turbo',col:'amber',val:80},
        {k:'sfx',lbl:'⚡ Effects, EMP & Siren',col:'purple',val:92},
        {k:'uiClick',lbl:'🔘 UI Button Clicks',col:'pink',val:85}
    ];
    const grid=document.getElementById('volumeSlidersGrid');if(!grid)return;
    grid.innerHTML=sliders.map(s=>`<div><div class="flex justify-between text-[10.5px]"><span class="text-gray-300">${s.lbl}</span><span id="volLabel_${s.k}" class="text-${s.col}-400 font-bold">${s.val}%</span></div><input type="range" id="volSlider_${s.k}" min="0" max="100" value="${s.val}" oninput="updateVolumeSetting('${s.k}',this.value)" class="w-full accent-${s.col}-400 cursor-pointer"></div>`).join('');
}

function openCustomSongsIDB(){
    return new Promise((resolve,reject)=>{
        const req=indexedDB.open(CUSTOM_SONGS_DB_NAME,1);
        req.onupgradeneeded=(e)=>{const db=e.target.result;if(!db.objectStoreNames.contains('songs'))db.createObjectStore('songs',{keyPath:'accountKey'});};
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
}

async function handleCustomSongUpload(files){
    if(!files||!files[0])return;
    const file=files[0];
    if(file.size>20*1024*1024){document.getElementById('customSongStatusText').innerText="✕ File exceeds 20 MB limit!";playGameSfx('hit');return;}
    try{
        const db=await openCustomSongsIDB(),accountKey=getActiveAccountStorageKey(),pilotName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
        await new Promise((res,rej)=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').put({accountKey,pilotName,fileName:file.name,sizeBytes:file.size,blob:file,ts:Date.now()});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});
        await loadCustomSongForActivePilot();selectOstMode('custom');playGameSfx('pickup');renderDevCustomSongsList();
    }catch(e){document.getElementById('customSongStatusText').innerText="✕ Upload failed.";}
}

async function loadCustomSongForActivePilot(){
    try{
        const db=await openCustomSongsIDB(),accountKey=getActiveAccountStorageKey();
        const record=await new Promise((res)=>{const tx=db.transaction('songs','readonly'),req=tx.objectStore('songs').get(accountKey);req.onsuccess=()=>res(req.result||null);req.onerror=()=>res(null);});
        const statusText=document.getElementById('customSongStatusText'),subEl=document.getElementById('customOstBtnSub'),rmBtn=document.getElementById('removeMyCustomSongBtn');
        if(currentCustomObjectUrl){URL.revokeObjectURL(currentCustomObjectUrl);currentCustomObjectUrl=null;}
        if(record&&record.blob){
            currentCustomObjectUrl=URL.createObjectURL(record.blob);customAudio.src=currentCustomObjectUrl;customAudio.loop=true;
            const mb=(record.sizeBytes/(1024*1024)).toFixed(1);
            if(statusText)statusText.innerText=`✓ Loaded: ${record.fileName} (${mb} MB • Looping)`;
            if(subEl)subEl.innerText=record.fileName;if(rmBtn)rmBtn.classList.remove('hidden');
        }else{
            customAudio.pause();customAudio.removeAttribute('src');
            if(statusText)statusText.innerText="Upload Custom Song (≤ 20 MB, Auto-Loop)";
            if(subEl)subEl.innerText="No song uploaded";if(rmBtn)rmBtn.classList.add('hidden');
            if(audioSettings.ostMode==='custom')selectOstMode('synth');
        }
        renderDevCustomSongsList();
    }catch(e){}
}

async function removeCurrentPilotCustomSong(){await deleteCustomSongByKey(getActiveAccountStorageKey());await loadCustomSongForActivePilot();playGameSfx('uiClick');}
async function deleteCustomSongByKey(accKey){
    try{
        const db=await openCustomSongsIDB();
        await new Promise((res)=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').delete(accKey);tx.oncomplete=()=>res();tx.onerror=()=>res();});
        if(accKey===getActiveAccountStorageKey())await loadCustomSongForActivePilot();else renderDevCustomSongsList();
    }catch(e){}
}
async function devRemoveAllCustomSongs(){
    if(currentPilot.id!=='1117')return;
    try{
        const db=await openCustomSongsIDB();
        await new Promise((res)=>{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').clear();tx.oncomplete=()=>res();});
        await loadCustomSongForActivePilot();showDevConsoleFeedback("✓ All Custom Uploaded Songs Removed!");playGameSfx('pickup');
    }catch(e){}
}
async function renderDevCustomSongsList(){
    const container=document.getElementById('devCustomSongsList');if(!container||currentPilot.id!=='1117')return;
    try{
        const db=await openCustomSongsIDB();
        const allRecords=await new Promise((res)=>{const tx=db.transaction('songs','readonly'),req=tx.objectStore('songs').getAll();req.onsuccess=()=>res(req.result||[]);req.onerror=()=>res([]);});
        if(allRecords.length===0){container.innerHTML=`<div class="text-gray-500">No custom songs uploaded yet.</div>`;return;}
        container.innerHTML=allRecords.map(r=>{const mb=(r.sizeBytes/(1024*1024)).toFixed(1);return`<div class="flex items-center justify-between bg-[#121724] px-2 py-1 rounded border border-[#232c42]"><span class="truncate pr-2 text-gray-200">${escapeHtml(r.pilotName)}: <strong>${escapeHtml(r.fileName)}</strong> (${mb}MB)</span><button type="button" onclick="deleteCustomSongByKey('${escapeHtml(r.accountKey)}')" class="px-1.5 py-0.5 rounded bg-red-600/80 hover:bg-red-500 text-white text-[9px] font-bold shrink-0 cursor-pointer">🗑️ Remove</button></div>`;}).join('');
    }catch(e){}
}

function ensureAudioEngine(){
    if(!audioCtx){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(AC){
            audioCtx=new AC();
            sfxGainNode=audioCtx.createGain();
            sfxGainNode.gain.setValueAtTime(audioSettings.master*0.65,audioCtx.currentTime);
            sfxGainNode.connect(audioCtx.destination);
            engineOsc1=audioCtx.createOscillator();engineOsc2=audioCtx.createOscillator();
            const engineFilter=audioCtx.createBiquadFilter();engineGain=audioCtx.createGain();
            engineOsc1.type='sawtooth';engineOsc2.type='triangle';
            engineOsc1.frequency.setValueAtTime(73.42,audioCtx.currentTime);engineOsc2.frequency.setValueAtTime(146.83,audioCtx.currentTime);
            engineFilter.type='lowpass';engineFilter.frequency.setValueAtTime(220,audioCtx.currentTime);
            engineGain.gain.setValueAtTime(0.0001,audioCtx.currentTime);
            engineOsc1.connect(engineFilter);engineOsc2.connect(engineFilter);engineFilter.connect(engineGain);engineGain.connect(sfxGainNode);
            engineOsc1.start();engineOsc2.start();
        }
    }
    if(isAppAudible()&&audioCtx&&audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
    syncExternalTrackPlayback();
    return audioCtx;
}

function silenceAllAudioForBackground(){
    synthGameAudio.pause();synthMenuAudio.pause();mitadruAudio.pause();customAudio.pause();
    if(engineGain&&audioCtx){try{engineGain.gain.setTargetAtTime(0.0001,audioCtx.currentTime,0.02);}catch(e){}}
    if(audioCtx&&audioCtx.state==='running')audioCtx.suspend().catch(()=>{});
    updateEqVisuals(false);
}

function resumeAudioForForeground(){
    if(!isAppAudible())return;
    ensureAudioEngine();updateEngineSoundPitch();
    updateEqVisuals(gameState.running&&!gameState.paused);
}

function updateEngineSoundPitch(){
    if(!audioCtx||!engineOsc1||!engineGain)return;
    const now=audioCtx.currentTime;
    if(!gameState.running||gameState.paused||!isAppAudible()){engineGain.gain.setTargetAtTime(0.0001,now,0.05);return;}
    const speedRatio=Math.max(0.6,Math.min(2.2,gameState.speedMps/28)),baseFreq=36.71*speedRatio+(gameState.boosting?18.35:0);
    engineOsc1.frequency.setTargetAtTime(baseFreq,now,0.05);engineOsc2.frequency.setTargetAtTime(baseFreq*2.0,now,0.05);
    const targetVol=0.08*audioSettings.engine*(gameState.boosting?1.2:0.8);
    engineGain.gain.setTargetAtTime(Math.max(0.0001,targetVol),now,0.06);
}

function syncExternalTrackPlayback(){
    const mVol=Math.min(1,audioSettings.master*audioSettings.music),mmVol=Math.min(1,audioSettings.master*audioSettings.menuMusic);
    synthGameAudio.volume=mVol;mitadruAudio.volume=mVol;customAudio.volume=mVol;synthMenuAudio.volume=mmVol;
    if(!isAppAudible()||audioSettings.master<=0.01){
        synthGameAudio.pause();synthMenuAudio.pause();mitadruAudio.pause();customAudio.pause();return;
    }
    const isMenuOrPaused=!gameState.running||gameState.paused;
    if(isMenuOrPaused){
        synthGameAudio.pause();mitadruAudio.pause();customAudio.pause();
        if(mmVol>0.01){if(synthMenuAudio.paused)synthMenuAudio.play().catch(()=>{});}else synthMenuAudio.pause();
        return;
    }
    synthMenuAudio.pause();
    if(mVol<=0.01){synthGameAudio.pause();mitadruAudio.pause();customAudio.pause();return;}
    if(audioSettings.ostMode==='mitadru'){
        synthGameAudio.pause();customAudio.pause();
        if(!mitadruAudio.src||mitadruAudio.src===window.location.href){mitadruIdx=0;mitadruAudio.src=mitadruCandidates[0];}
        if(mitadruAudio.paused)mitadruAudio.play().catch(()=>{});
    }else if(audioSettings.ostMode==='custom'){
        synthGameAudio.pause();mitadruAudio.pause();
        if(customAudio.src&&customAudio.paused)customAudio.play().catch(()=>{});
    }else{
        mitadruAudio.pause();customAudio.pause();
        if(synthGameAudio.paused)synthGameAudio.play().catch(()=>{});
    }
}

function selectOstMode(mode){
    if(mode==='mitadru'&&currentPilot.id!=='1117'){spawnFloatingText("🔒 LOGIN AS ID 1117 (VOID) TO UNLOCK MITADRU.M4A","#f59e0b",0,-25);return;}
    if(mode==='custom'&&!currentCustomObjectUrl){document.getElementById('customSongStatusText').innerText="⚠️ Upload a song file (≤ 20 MB) first!";return;}
    audioSettings.ostMode=mode;
    ['synth','mitadru','custom'].forEach(m=>{
        const btn=document.getElementById(`ostBtn_${m}`);
        if(btn)btn.className=(m===mode)?"p-2 rounded-xl text-left border bg-sky-500/20 border-sky-400 text-white cursor-pointer":"p-2 rounded-xl text-left border bg-[#141824] border-[#262f45] text-gray-300 cursor-pointer";
    });
    const shortLabel=document.getElementById('hudOstShortLabel'),statusEl=document.getElementById('ostLockStatus');
    if(shortLabel)shortLabel.innerText=mode==='mitadru'?"MITADRU":(mode==='custom'?"CUSTOM":"SYNTH");
    if(statusEl)statusEl.innerText=mode==='mitadru'?"Mitadru.m4a Active":(mode==='custom'?"Custom Song Active":"Cyber-Synth Active");
    syncExternalTrackPlayback();saveSettingsForActiveAccount();
}

function updateVolumeSetting(ch,val){
    const num=Math.max(0,Math.min(100,parseInt(val,10)))/100;audioSettings[ch]=num;
    const lbl=document.getElementById(`volLabel_${ch}`);if(lbl)lbl.innerText=`${Math.round(num*100)}%`;
    const sld=document.getElementById(`volSlider_${ch}`);if(sld&&String(sld.value)!==String(Math.round(num*100)))sld.value=Math.round(num*100);
    if(sfxGainNode&&audioCtx)sfxGainNode.gain.setTargetAtTime(audioSettings.master*0.65,audioCtx.currentTime,0.03);
    syncExternalTrackPlayback();updateEngineSoundPitch();saveSettingsForActiveAccount();
}

function playGameSfx(type){
    if(audioSettings.master<=0.01||!isAppAudible())return;
    const nowPerf=performance.now();
    if(lastSfxTime[type]&&nowPerf-lastSfxTime[type]<55)return;
    lastSfxTime[type]=nowPerf;
    try{
        const actx=ensureAudioEngine();if(!actx||actx.state!=='running')return;
        const now=actx.currentTime,sVol=audioSettings.sfx,cVol=audioSettings.uiClick,out=sfxGainNode||actx.destination;
        if(type==='uiClick'){
            if(cVol<=0.01)return;
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(587.33,now);o.frequency.exponentialRampToValueAtTime(880.0,now+0.04);
            g.gain.setValueAtTime(0.001,now);g.gain.linearRampToValueAtTime(0.11*cVol,now+0.005);g.gain.exponentialRampToValueAtTime(0.001,now+0.045);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.05);return;
        }
        if(sVol<=0.01)return;
        if(type==='steer'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='sine';o.frequency.setValueAtTime(349.23,now);o.frequency.exponentialRampToValueAtTime(587.33,now+0.045);
            g.gain.setValueAtTime(0.001,now);g.gain.linearRampToValueAtTime(0.11*sVol,now+0.005);g.gain.exponentialRampToValueAtTime(0.001,now+0.05);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.055);
        }else if(type==='nitro'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='triangle';o.frequency.setValueAtTime(293.66,now);o.frequency.exponentialRampToValueAtTime(587.33,now+0.16);
            g.gain.setValueAtTime(0.001,now);g.gain.linearRampToValueAtTime(0.14*sVol,now+0.008);g.gain.exponentialRampToValueAtTime(0.001,now+0.18);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.185);
        }else if(type==='siren250'){
            for(let c=0;c<4;c++){
                const st=now+c*0.5,o=actx.createOscillator(),g=actx.createGain();
                o.type='triangle';o.frequency.setValueAtTime(440.0,st);o.frequency.linearRampToValueAtTime(880.0,st+0.25);o.frequency.linearRampToValueAtTime(440.0,st+0.48);
                g.gain.setValueAtTime(0.001,st);g.gain.linearRampToValueAtTime(0.18*sVol,st+0.01);g.gain.exponentialRampToValueAtTime(0.001,st+0.49);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.495);
            }
        }else if(type==='phantom'){
            [587.33,880.0,1174.66].forEach((f,idx)=>{
                const o=actx.createOscillator(),g=actx.createGain(),st=now+idx*0.03;
                o.type='sine';o.frequency.setValueAtTime(f,st);
                g.gain.setValueAtTime(0.001,st);g.gain.linearRampToValueAtTime(0.14*sVol,st+0.005);g.gain.exponentialRampToValueAtTime(0.001,st+0.18);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.185);
            });
        }else if(type==='pickup'){
            [587.33,880.0].forEach((f,idx)=>{
                const o=actx.createOscillator(),g=actx.createGain(),st=now+idx*0.035;
                o.type='sine';o.frequency.setValueAtTime(f,st);
                g.gain.setValueAtTime(0.001,st);g.gain.linearRampToValueAtTime(0.14*sVol,st+0.005);g.gain.exponentialRampToValueAtTime(0.001,st+0.13);
                o.connect(g);g.connect(out);o.start(st);o.stop(st+0.135);
            });
        }else if(type==='emp'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='triangle';o.frequency.setValueAtTime(880.0,now);o.frequency.exponentialRampToValueAtTime(73.42,now+0.45);
            g.gain.setValueAtTime(0.001,now);g.gain.linearRampToValueAtTime(0.20*sVol,now+0.008);g.gain.exponentialRampToValueAtTime(0.001,now+0.48);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.49);
        }else if(type==='hit'){
            const o=actx.createOscillator(),g=actx.createGain();
            o.type='triangle';o.frequency.setValueAtTime(146.83,now);o.frequency.exponentialRampToValueAtTime(36.71,now+0.22);
            g.gain.setValueAtTime(0.001,now);g.gain.linearRampToValueAtTime(0.24*sVol,now+0.005);g.gain.exponentialRampToValueAtTime(0.001,now+0.24);
            o.connect(g);g.connect(out);o.start(now);o.stop(now+0.25);
        }
    }catch(e){}
}

function triggerBlankSpaceAutoClick(){
    setTimeout(()=>{
        try{
            const target=document.getElementById('startModal')||document.body;
            target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:2,clientY:2}));
            target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:2,clientY:2}));
            ensureAudioEngine();
        }catch(e){ensureAudioEngine();}
    },1);
}

['touchstart','touchend','pointerdown','mousedown','keydown','click'].forEach(evt=>{
    window.addEventListener(evt,()=>{
        if(audioCtx&&audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
        if(!gameState.running||gameState.paused){if(synthMenuAudio.paused)syncExternalTrackPlayback();}
        else if(synthGameAudio.paused&&audioSettings.ostMode==='synth')syncExternalTrackPlayback();
    },{capture:true,passive:true});
});

document.addEventListener('pointerdown',(e)=>{
    const btn=e.target.closest('button');
    if(btn&&!btn.disabled&&!btn.classList.contains('touch-paddle'))playGameSfx('uiClick');
},{passive:true});

function updateEqVisuals(playing){
    document.querySelectorAll('.eq-bar').forEach(b=>b.classList.toggle('eq-paused',!(playing&&audioSettings.master>0.01&&audioSettings.music>0.01)));
}

const LB_STORAGE_KEY='roadSense_overdrive_leaderboard_v8',CLOUD_SYNC_TOPIC='roadsense_overdrive_global_lb_sync_v8',CLOUD_SYNC_URL=`https://ntfy.sh/${CLOUD_SYNC_TOPIC}`;
const lbChannel=('BroadcastChannel' in window)?new BroadcastChannel('roadsense_overdrive_lb_v8'):null;
let isPullingCloud=false,liveEventSource=null,lastCloudResetTs=Number(localStorage.getItem('roadSense_overdrive_resetTs_v8')||0);

function getLocalLeaderboard(){
    try{
        const parsed=JSON.parse(localStorage.getItem(LB_STORAGE_KEY)||'[]'),delSet=new Set(getDeletedAccountKeys());
        return(Array.isArray(parsed)?parsed:[]).filter(e=>e&&e.score>0&&!delSet.has(e.accountKey||e.id));
    }catch(e){return[];}
}
function saveLocalLeaderboard(list){
    const delSet=new Set(getDeletedAccountKeys());
    const valid=(Array.isArray(list)?list:[]).filter(e=>e&&e.score>0&&!delSet.has(e.accountKey||e.id)).sort((a,b)=>b.score-a.score).slice(0,100);
    localStorage.setItem(LB_STORAGE_KEY,JSON.stringify(valid));updateTopLeaderBanner(valid);return valid;
}
function mergeRemoteLeaderboardPacket(packet){
    if(!packet||typeof packet!=='object')return;
    if(packet.resetTs&&Number(packet.resetTs)>lastCloudResetTs){lastCloudResetTs=Number(packet.resetTs);localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));localStorage.setItem(LB_STORAGE_KEY,JSON.stringify([]));}
    if(Array.isArray(packet.deletedAccounts)&&packet.deletedAccounts.length>0)saveDeletedAccountKeys(Array.from(new Set([...getDeletedAccountKeys(),...packet.deletedAccounts])));
    const delSet=new Set(getDeletedAccountKeys()),mapByKey=new Map();
    getLocalLeaderboard().forEach(item=>{const k=item.accountKey||item.id;if(!delSet.has(k)&&item.score>0)mapByKey.set(k,item);});
    (Array.isArray(packet.entries)?packet.entries:[]).forEach(rem=>{
        if(!rem||!rem.score||rem.score<=0||(rem.ts&&lastCloudResetTs&&rem.ts<lastCloudResetTs))return;
        const k=rem.accountKey||rem.id;if(delSet.has(k))return;
        const ex=mapByKey.get(k);
        if(!ex||rem.score>ex.score)mapByKey.set(k,{id:rem.id||'GUEST',guestId:rem.guestId||'',accountKey:k,name:rem.name||'Guest Pilot',score:Number(rem.score),epoch:Number(rem.epoch||1),ts:Number(rem.ts||Date.now())});
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
        liveEventSource.onmessage=(ev)=>{try{const data=JSON.parse(ev.data);if(data&&data.message){const pkt=JSON.parse(data.message);if(pkt&&pkt.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(pkt);}}catch(e){}};
        liveEventSource.onerror=()=>{try{liveEventSource.close();}catch(e){}liveEventSource=null;setTimeout(startLiveLeaderboardStream,5000);};
    }catch(e){}
}
async function pullGlobalCloudLeaderboard(){
    if(isPullingCloud||document.hidden)return;
    isPullingCloud=true;const ctrl=new AbortController(),tid=setTimeout(()=>ctrl.abort(),2800);
    try{
        const res=await fetch(`${CLOUD_SYNC_URL}/json?poll=1&since=24h`,{signal:ctrl.signal});
        if(res.ok){
            const text=await res.text();
            for(const line of text.trim().split('\n')){if(!line)continue;try{const w=JSON.parse(line);if(w&&w.event==='message'&&w.message){const pkt=JSON.parse(w.message);if(pkt&&pkt.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(pkt);}}catch(e){}}
        }
    }catch(e){}finally{clearTimeout(tid);isPullingCloud=false;}
}
function recordScoreToLeaderboard(scoreVal,epochVal,pushRemote=true){
    if(!scoreVal||scoreVal<=0)return;
    const accountKey=getActiveAccountStorageKey(),pid=currentPilot.isCore?currentPilot.id:'GUEST',gid=currentPilot.isCore?'':ensureGuestHas4DigitId(),pName=currentPilot.isCore?currentPilot.name:getEffectiveGuestFullLabel();
    saveDeletedAccountKeys(getDeletedAccountKeys().filter(k=>k!==accountKey));
    const list=getLocalLeaderboard(),idx=list.findIndex(e=>(e.accountKey||e.id)===accountKey);
    let changed=false;
    if(idx>=0){if(scoreVal>list[idx].score){list[idx].score=scoreVal;list[idx].epoch=Math.max(list[idx].epoch||1,epochVal);list[idx].name=pName;list[idx].guestId=gid;list[idx].ts=Date.now();changed=true;}}
    else{list.push({id:pid,guestId:gid,accountKey,name:pName,score:scoreVal,epoch:epochVal,ts:Date.now()});changed=true;}
    if(changed){saveLocalLeaderboard(list);if(pushRemote)pushCloudLeaderboardPacket();}
}
function updateTopLeaderBanner(list=null){
    const arr=list||getLocalLeaderboard(),top=arr[0]||null;
    if(top&&top.score>0){setTextCached('bootTopLeaderName',top.name);setTextCached('bootTopLeaderScore',`(${top.score.toLocaleString()})`);setTextCached('hudLeaderMini',`${top.name.split(' ')[0]} (${top.score.toLocaleString()})`);}
    else{setTextCached('bootTopLeaderName',"Unclaimed");setTextCached('bootTopLeaderScore',"");setTextCached('hudLeaderMini',"Unclaimed");}
}
function extractGuestIdTag(entry){
    if(entry.guestId)return entry.guestId;
    const m1=String(entry.accountKey||'').match(/(\d{4})$/);if(m1)return m1[1];
    const m2=String(entry.name||'').match(/#(\d{4})/);if(m2)return m2[1];
    return"GUEST";
}
function renderLeaderboardList(){
    const container=document.getElementById('leaderboardListContainer');if(!container)return;
    const list=getLocalLeaderboard(),isAdmin=(currentPilot.id==='1117');
    if(list.length===0){container.innerHTML=`<div class="recessed-well p-6 rounded-xl text-center space-y-1"><div class="text-sm font-bold text-white">No Runs Recorded Yet</div><p class="text-xs text-gray-400">Complete a run to claim #1 on the Global Leaderboard!</p></div>`;return;}
    const medals=["🥇 #1","🥈 #2","🥉 #3"];
    container.innerHTML=list.map((entry,idx)=>{
        const prof=PILOT_PROFILES[entry.id]||PILOT_PROFILES["GUEST"],isCore=Boolean(PILOT_PROFILES[entry.id]&&entry.id!=='GUEST'),accKey=entry.accountKey||entry.id,gTag=isCore?'':extractGuestIdTag(entry);
        const dispName=(!isCore&&gTag!=='GUEST'&&!String(entry.name).includes(`#${gTag}`))?`${entry.name} (#${gTag})`:entry.name;
        const delBtn=isAdmin?`<button type="button" onclick="adminDeleteIndividualScore('${escapeHtml(accKey)}')" class="ml-2 px-2 py-1 rounded bg-red-600/85 hover:bg-red-500 text-white text-[9px] mono-num font-bold cursor-pointer">🗑️ Delete</button>`:'';
        const badge=prof.isVoidChroma?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-extrabold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/50">👑 ARCHITECT VOID</span>`:(isCore?`<span class="px-1.5 py-0.5 text-[9px] mono-num font-bold rounded bg-white/10 text-gray-200">⚡ CORE #${entry.id}</span>`:`<span class="px-1.5 py-0.5 text-[9px] mono-num rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">👤 GUEST #${escapeHtml(gTag)}</span>`);
        return`<div class="p-3 rounded-xl flex items-center justify-between gap-2 transition ${prof.lbClass}"><div class="flex items-center gap-2.5 min-w-0"><span class="mono-num text-xs font-black text-white px-2 py-1 rounded bg-black/40 border border-white/10 shrink-0">${medals[idx]||`#${idx+1}`}</span><div class="min-w-0"><div class="flex items-center gap-1.5 flex-wrap"><span class="text-xs sm:text-sm truncate ${prof.nameClass}">${escapeHtml(dispName)}</span>${badge}</div><div class="text-[10px] mono-num text-gray-400">Epoch ${entry.epoch||1} &bull; ${prof.liveryName}</div></div></div><div class="flex items-center shrink-0"><span class="mono-num text-sm sm:text-base font-black text-emerald-400">${entry.score.toLocaleString()}</span>${delBtn}</div></div>`;
    }).join('');
}
function adminDeleteIndividualScore(targetKey){
    if(currentPilot.id!=='1117')return;
    const delList=getDeletedAccountKeys();if(!delList.includes(targetKey)){delList.push(targetKey);saveDeletedAccountKeys(delList);}
    const db=getAccountsDatabase();
    if(db[targetKey]){if(PILOT_PROFILES[targetKey]&&PILOT_PROFILES[targetKey].isCore){db[targetKey].bestScore=0;db[targetKey].bestEpoch=1;}else delete db[targetKey];saveAccountsDatabase(db);}
    saveLocalLeaderboard(getLocalLeaderboard().filter(e=>(e.accountKey||e.id)!==targetKey));pushCloudLeaderboardPacket();renderLeaderboardList();refreshAccountStatsUI();
}
function adminDeleteAllGuestAccounts(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase(),delSet=new Set(getDeletedAccountKeys());
    Object.keys(db).forEach(k=>{if(!PILOT_PROFILES[k]||!PILOT_PROFILES[k].isCore){delSet.add(k);delete db[k];}});
    getLocalLeaderboard().forEach(e=>{const k=e.accountKey||e.id;if(!PILOT_PROFILES[e.id]||!PILOT_PROFILES[e.id].isCore)delSet.add(k);});
    saveDeletedAccountKeys(Array.from(delSet));saveAccountsDatabase(db);
    saveLocalLeaderboard(getLocalLeaderboard().filter(e=>PILOT_PROFILES[e.id]&&PILOT_PROFILES[e.id].isCore));
    pushCloudLeaderboardPacket();renderLeaderboardList();refreshAccountStatsUI();showDevConsoleFeedback("✓ All Guest Accounts & Guest Votes Deleted!");
}
function adminResetAllLeaderboardScores(){
    if(currentPilot.id!=='1117')return;
    const db=getAccountsDatabase();
    Object.keys(db).forEach(k=>{if(!PILOT_PROFILES[k]||!PILOT_PROFILES[k].isCore)delete db[k];else{db[k].bestScore=0;db[k].bestEpoch=1;}});
    saveAccountsDatabase(db);lastCloudResetTs=Date.now();localStorage.setItem('roadSense_overdrive_resetTs_v8',String(lastCloudResetTs));
    saveLocalLeaderboard([]);pushCloudLeaderboardPacket({resetTs:lastCloudResetTs,entries:[]});
    renderLeaderboardList();refreshAccountStatsUI();showDevConsoleFeedback("✓ All Leaderboard Scores (Including Core) Reset!");
}
function syncDevDimensionsButtonLabel(){
    const btn=document.getElementById('devToggleDimsBtn');if(!btn)return;
    btn.innerText=devAllDimensionsUnlocked?"🔒 Relock All Dimensions":"🔓 Unlock All Dimensions (Incl. Ep 250)";
    btn.className=devAllDimensionsUnlocked?"p-2 rounded-xl bg-amber-950/70 hover:bg-amber-800/80 text-amber-200 border border-amber-500/40 text-[10.5px] mono-num font-bold cursor-pointer text-center":"p-2 rounded-xl bg-purple-950/70 hover:bg-purple-800/80 text-purple-200 border border-purple-500/40 text-[10.5px] mono-num font-bold cursor-pointer text-center";
}
function devToggleAllDimensionsLock(){
    if(currentPilot.id!=='1117')return;
    devAllDimensionsUnlocked=!devAllDimensionsUnlocked;
    if(!devAllDimensionsUnlocked&&biomeIdx!==0){biomeIdx=0;cachedGradients.key='';setTextCached('hudBiomeName',BIOME_THEMES[0].label);}
    syncDevDimensionsButtonLabel();buildBiomeSelectorGrid();
    showDevConsoleFeedback(devAllDimensionsUnlocked?"✓ All 14 Dimensions Unlocked!":"🔒 Dimensions Relocked to 10-Epoch Progression!");playGameSfx('pickup');
}
function showDevConsoleFeedback(msg){const fb=document.getElementById('devConsoleFeedback');if(fb){fb.innerText=msg;fb.classList.remove('hidden');}}
function getDistanceForEpoch(ep){const e=Math.max(1,Math.floor(ep));return e<=250?(e-1)*70:249*70+EPOCH_250_LENGTH_M+(e-251)*70;}
function getEpochFromDistance(distM){const d250Start=249*70,d250End=d250Start+EPOCH_250_LENGTH_M;if(distM<d250Start)return 1+Math.floor(distM/70);if(distM<d250End)return 250;return 251+Math.floor((distM-d250End)/70);}
function devStartAtCustomEpoch(){if(currentPilot.id!=='1117')return;const inp=document.getElementById('devEpochInput');startGameSession(Math.max(1,Math.min(99999,parseInt(inp?inp.value:'250',10)||250)));}
function devRefillAllSystems(){if(currentPilot.id!=='1117')return;gameState.armor=100;gameState.nitroFuel=100;gameState.empCharge=100;updateHudDOM(true);spawnFloatingText("⚡ ARCHITECT OVERRIDE: 100% HULL + NITRO + EMP!","#00f5d4",0,-45);playGameSfx('pickup');}
function openLeaderboardModal(){renderLeaderboardList();pullGlobalCloudLeaderboard();document.getElementById('leaderboardModal').style.display='flex';syncCursorVisibility();}
function closeLeaderboardModal(){document.getElementById('leaderboardModal').style.display='none';syncCursorVisibility();}

const DIFFICULTY_PRESETS={
    easy:{label:"🟢 Assisted Easy",speedMul:0.72,spawnMeters:32.0,hitboxScale:0.78,scoreMul:1.0,nitroRegen:6.8,empRegen:4.8,pickupSpacing:21.0,pickupScale:1.00},
    normal:{label:"🔵 Telemetry Normal",speedMul:0.84,spawnMeters:26.5,hitboxScale:0.84,scoreMul:1.2,nitroRegen:4.2,empRegen:3.0,pickupSpacing:25.0,pickupScale:0.86},
    hard:{label:"🟠 Overdrive Hard",speedMul:0.95,spawnMeters:22.5,hitboxScale:0.89,scoreMul:1.5,nitroRegen:2.3,empRegen:1.6,pickupSpacing:29.0,pickupScale:0.74},
    void:{label:"🔮 Void Max",speedMul:1.06,spawnMeters:19.0,hitboxScale:0.93,scoreMul:2.0,nitroRegen:1.1,empRegen:0.7,pickupSpacing:34.0,pickupScale:0.62}
};
let currentDiffKey='easy';

const GRAPHICS_PRESETS={
    low:{title:"Low",resScale:0.70,roadSlices:18,particles:0.25,bloom:false,shake:false,transitions:true,scanlines:false,pillars:false,reflections:false,speedLines:false,hudBoxes:true},
    medium:{title:"Medium",resScale:0.95,roadSlices:26,particles:0.60,bloom:false,shake:true,transitions:true,scanlines:false,pillars:true,reflections:false,speedLines:false,hudBoxes:true},
    high:{title:"High",resScale:1.20,roadSlices:36,particles:1.00,bloom:true,shake:true,transitions:true,scanlines:false,pillars:true,reflections:true,speedLines:true,hudBoxes:true},
    ultra:{title:"Ultra",resScale:1.45,roadSlices:48,particles:1.50,bloom:true,shake:true,transitions:true,scanlines:false,pillars:true,reflections:true,speedLines:true,hudBoxes:true}
};

const gfxSettings={preset:'low',filter:'filter-standard',resScale:0.70,roadSlices:18,particles:0.25,bloom:false,shake:false,transitions:true,scanlines:false,pillars:false,reflections:false,speedLines:false,hudBoxes:true};
const GFX_TOGGLE_META=[
    {k:'bloom',lbl:'💡 Glow'},{k:'shake',lbl:'📳 Shake'},{k:'transitions',lbl:'🌀 FX Anim'},{k:'scanlines',lbl:'📺 Scanline'},
    {k:'pillars',lbl:'🏛️ Sky Art'},{k:'reflections',lbl:'✨ Road Sheen'},{k:'speedLines',lbl:'💨 Warp Lines'},{k:'hudBoxes',lbl:'📦 YOLO Boxes'}
];

function buildGraphicsUI(){
    const pGrid=document.getElementById('gfxPresetButtonsGrid');
    if(pGrid){
        pGrid.innerHTML=['low','medium','high','ultra'].map(k=>{
            const p=GRAPHICS_PRESETS[k],isRec=(k===recommendedPresetKey),active=(gfxSettings.preset===k);
            return`<button type="button" onclick="applyGraphicsPreset('${k}',true)" class="py-1.5 px-2 rounded-lg text-[10.5px] font-bold cursor-pointer border truncate ${active?'bg-sky-500 text-black border-sky-400':'bg-[#151a26] text-gray-300 border-[#262f45] hover:text-white'}">${p.title}${isRec?' (Rec)':''}</button>`;
        }).join('');
    }
    const tGrid=document.getElementById('gfxTogglesGrid');
    if(tGrid){
        tGrid.innerHTML=GFX_TOGGLE_META.map(t=>`<button type="button" id="gfxToggle_${t.k}" onclick="toggleGfxOption('${t.k}')" class="p-1.5 rounded-lg text-[10px] font-bold cursor-pointer truncate"></button>`).join('');
        GFX_TOGGLE_META.forEach(t=>applyGfxOptionState(t.k,gfxSettings[t.k],false));
    }
    const fGrid=document.getElementById('gfxFilterButtonsGrid');
    const filters=[{k:'filter-standard',lbl:'✨ Standard Optic'},{k:'filter-requiem-noir',lbl:'🖤 RE: Requiem Noir'},{k:'filter-requiem-ash',lbl:'🌫️ RE: Requiem Ash'},{k:'filter-dl2-grit',lbl:'🌇 DL2: Harran Grit'},{k:'filter-dl2-darkzone',lbl:'🌑 DL2: Darkzone'},{k:'filter-stark-mono',lbl:'⚡ High-Contrast B&W'}];
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
    buildGraphicsUI();resizeGameCanvas();
    if(shouldSave)saveSettingsForActiveAccount();
}
function updateGfxResolution(val,shouldSave=true){
    const num=Math.max(60,Math.min(150,parseInt(val,10)||100));gfxSettings.resScale=num/100;
    const lbl=document.getElementById('gfxResLabel');if(lbl)lbl.innerText=`${gfxSettings.resScale.toFixed(2)}x`;
    const sld=document.getElementById('gfxResSlider');if(sld&&String(sld.value)!==String(num))sld.value=num;
    resizeGameCanvas();if(shouldSave)saveSettingsForActiveAccount();
}
function updateGfxDrawSlices(val,shouldSave=true){
    const num=Math.max(16,Math.min(48,parseInt(val,10)||32));gfxSettings.roadSlices=num;
    const lbl=document.getElementById('gfxSlicesLabel');if(lbl)lbl.innerText=`${num} Seg`;
    const sld=document.getElementById('gfxSlicesSlider');if(sld&&String(sld.value)!==String(num))sld.value=num;
    if(shouldSave)saveSettingsForActiveAccount();
}
function updateGfxParticles(val,shouldSave=true){
    const num=Math.max(0,Math.min(150,parseInt(val,10)||100));gfxSettings.particles=num/100;
    const lbl=document.getElementById('gfxParticleLabel');if(lbl)lbl.innerText=`${num}%`;
    const sld=document.getElementById('gfxParticleSlider');if(sld&&String(sld.value)!==String(num))sld.value=num;
    if(shouldSave)saveSettingsForActiveAccount();
}
function applyGfxOptionState(opt,val,shouldSave=true){
    gfxSettings[opt]=Boolean(val);
    const btn=document.getElementById(`gfxToggle_${opt}`),meta=GFX_TOGGLE_META.find(m=>m.k===opt);
    if(btn&&meta){
        btn.innerText=`${meta.lbl}: ${gfxSettings[opt]?'ON':'OFF'}`;
        btn.className=gfxSettings[opt]?"p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold cursor-pointer truncate":"p-1.5 rounded-lg bg-[#151a26] text-gray-400 border border-[#262f45] text-[10px] font-bold cursor-pointer truncate";
    }
    if(opt==='scanlines'){const ov=document.getElementById('atmosphereOverlay');if(ov)ov.classList.toggle('scanlines-active',gfxSettings.scanlines);}
    if(shouldSave)saveSettingsForActiveAccount();
}
function toggleGfxOption(opt){applyGfxOptionState(opt,!gfxSettings[opt],true);}
function setVisualFilter(fc,shouldSave=true){
    gfxSettings.filter=fc;canvas.className=fc;
    const titles={'filter-standard':'✨ Standard Optic','filter-requiem-noir':'🖤 RE: Requiem Noir','filter-requiem-ash':'🌫️ RE: Requiem Ash','filter-dl2-grit':'🌇 DL2: Harran Grit','filter-dl2-darkzone':'🌑 DL2: Darkzone','filter-stark-mono':'⚡ High-Contrast B&W'};
    Object.keys(titles).forEach(k=>{const btn=document.getElementById(`flt_${k}`);if(btn){btn.innerText=titles[k];btn.className=(k===fc)?"p-2 rounded-lg text-[10.5px] font-bold bg-sky-500 text-black cursor-pointer truncate":"p-2 rounded-lg text-[10.5px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer truncate";}});
    if(shouldSave)saveSettingsForActiveAccount();
}

const controlConfig={mobileMode:'buttons',doubleTapNitro:true,tiltCenterOffset:0,invertGyro:false,gyroSensitivity:0.65,lastTouchTime:0,binds:{left:['a','arrowleft'],right:['d','arrowright'],nitro:['shift','w','arrowup'],brake:['s','arrowdown'],emp:[' ','e'],hideui:['h']}};

function buildKeybindGridUI(){
    const items=[{k:'left',lbl:'STEER LEFT',col:'sky'},{k:'right',lbl:'STEER RIGHT',col:'sky'},{k:'nitro',lbl:'NITRO ACCEL',col:'amber'},{k:'brake',lbl:'AEB BRAKE',col:'red'},{k:'emp',lbl:'NEURAL EMP PULSE',col:'emerald'},{k:'hideui',lbl:'HIDE / SHOW HUD',col:'purple'}];
    const grid=document.getElementById('pcKeybindGrid');if(!grid)return;
    grid.innerHTML=items.map(it=>`<button type="button" onclick="startKeyRebind('${it.k}')" class="p-2.5 rounded-lg bg-[#141824] border border-[#262f45] hover:border-${it.col}-400 text-left cursor-pointer"><div class="text-[9px] text-gray-400">${it.lbl}</div><div class="text-${it.col}-300 font-bold mt-0.5" id="bindVal_${it.k}"></div></button>`).join('');
    refreshKeybindLabels();
}
function updateGyroSpeedSetting(val){
    const pct=Math.max(20,Math.min(100,parseInt(val,10)||65));controlConfig.gyroSensitivity=pct/100;
    const lbl=document.getElementById('gyroSpeedLabel');if(lbl)lbl.innerText=`${pct}% (${pct<=45?'Gentle':(pct<=75?'Responsive':'Ultra-Fast')})`;
    const sld=document.getElementById('gyroSpeedSlider');if(sld&&String(sld.value)!==String(pct))sld.value=pct;
    saveSettingsForActiveAccount();
}
function setDifficulty(key){
    currentDiffKey=DIFFICULTY_PRESETS[key]?key:'easy';
    const lbl=document.getElementById('diffCurrentLabel');if(lbl)lbl.innerText=DIFFICULTY_PRESETS[currentDiffKey].label;
    ['easy','normal','hard','void'].forEach(k=>{const btn=document.getElementById(`diffBtn_${k}`);if(btn)btn.className=(k===currentDiffKey)?"py-1.5 px-2 rounded-lg text-[11px] font-bold bg-emerald-500 text-black cursor-pointer":"py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer";});
    saveSettingsForActiveAccount();
}
function setMobileControlMode(mode){
    controlConfig.mobileMode=mode;
    const tapLaneBtn=document.getElementById('mobCtrl_drag');if(tapLaneBtn)tapLaneBtn.innerText="👆 Tap Lane";
    ['buttons','drag','tilt'].forEach(m=>{const btn=document.getElementById(`mobCtrl_${m}`);if(btn)btn.className=(m===mode)?"p-2 rounded-lg text-[11px] font-bold bg-sky-500 text-black cursor-pointer text-center":"p-2 rounded-lg text-[11px] font-semibold bg-[#151a26] text-gray-300 border border-[#262f45] cursor-pointer text-center";});
    const leftGroup=document.getElementById('mobileLeftTouchGroup');if(leftGroup)leftGroup.style.display=(mode==='buttons')?'flex':'none';
    const gyroBox=document.getElementById('gyroCalibrationBox');if(gyroBox){gyroBox.classList.toggle('opacity-40',mode!=='tilt');gyroBox.classList.toggle('pointer-events-none',mode!=='tilt');}
    const mapTitle=document.getElementById('mobileModeMapTitle'),mapSteer=document.getElementById('mapSteerDesc');
    if(mapTitle&&mapSteer){
        if(mode==='buttons'){mapTitle.innerText="ACTIVE CONTROL MAP // ARROW PADDLES";mapSteer.innerText="Left ◀ / ▶ Right Dock";}
        else if(mode==='drag'){mapTitle.innerText="ACTIVE CONTROL MAP // TAP LANE";mapSteer.innerText="Tap Any Road Lane to Glide There";}
        else{mapTitle.innerText="ACTIVE CONTROL MAP // PHONE TILT (GYRO)";mapSteer.innerText="Auto-Zeroed Magnetic Lane-Lock Tilt";}
    }
    if(mode==='tilt'){calibrateTiltSensor(true);if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{});}
    saveSettingsForActiveAccount();
}
function toggleInvertGyro(){
    controlConfig.invertGyro=!controlConfig.invertGyro;needsSilentGyroCalib=true;
    const btn=document.getElementById('invertGyroBtn');
    if(btn){btn.innerText=`⇄ Flip Axis: ${controlConfig.invertGyro?'ON':'OFF'}`;btn.className=controlConfig.invertGyro?"px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";}
    saveSettingsForActiveAccount();
}
function calibrateTiltSensor(silent=true){
    if(hasGyroReading){controlConfig.tiltCenterOffset=lastRawLandscapeTilt;smoothedGyroDelta=0;needsSilentGyroCalib=false;}else needsSilentGyroCalib=true;
    const angleLbl=document.getElementById('gyroLiveAngleLabel');if(angleLbl)angleLbl.innerText="0.0°";
    if(!silent)playGameSfx('pickup');
}
function applyDoubleTapNitroState(enabled){
    controlConfig.doubleTapNitro=Boolean(enabled);
    const btn=document.getElementById('doubleTapNitroBtn');
    if(btn){btn.innerText=controlConfig.doubleTapNitro?'ENABLED':'DISABLED';btn.className=controlConfig.doubleTapNitro?"px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] mono-num font-bold cursor-pointer":"px-3 py-1 rounded bg-gray-800 text-gray-400 border border-gray-600 text-[10px] mono-num font-bold cursor-pointer";}
    saveSettingsForActiveAccount();
}
function toggleDoubleTapNitro(){applyDoubleTapNitroState(!controlConfig.doubleTapNitro);}
function resetGameSettingsOnly(){setDifficulty('easy');activeLiveryProfile=currentPilot;buildVehicleLiverySelector();biomeIdx=0;cachedGradients.key='';autoCycleBiomes=true;syncAutoBiomeButtonUI();setTextCached('hudBiomeName',BIOME_THEMES[0].label);buildBiomeSelectorGrid();saveSettingsForActiveAccount();}
function resetSoundSettingsOnly(){updateVolumeSetting('master',95);updateVolumeSetting('music',90);updateVolumeSetting('menuMusic',85);updateVolumeSetting('engine',80);updateVolumeSetting('sfx',92);updateVolumeSetting('uiClick',85);selectOstMode('synth');saveSettingsForActiveAccount();}
function resetControlSettingsOnly(){
    setMobileControlMode('buttons');applyDoubleTapNitroState(true);updateGyroSpeedSetting(65);controlConfig.tiltCenterOffset=lastRawLandscapeTilt;controlConfig.invertGyro=false;
    const invBtn=document.getElementById('invertGyroBtn');if(invBtn){invBtn.innerText="⇄ Flip Axis: OFF";invBtn.className="px-2 py-1 rounded bg-[#182032] hover:bg-[#232f47] text-gray-200 border border-gray-600/40 text-[10px] mono-num font-bold cursor-pointer";}
    resetDefaultKeybinds();saveSettingsForActiveAccount();
}
function resetGraphicsSettingsOnly(){setVisualFilter('filter-standard',false);applyGraphicsPreset(recommendedPresetKey,true);}

function setDiscreteTargetLane(newLaneInt){
    const clamped=Math.max(-2,Math.min(2,Math.round(newLaneInt))),prevLane=Math.round(gameState.targetLane);
    if(clamped!==prevLane){
        const dir=clamped>prevLane?1:-1;gameState.targetLane=clamped;
        playGameSfx('steer');gameState.egoRoll=dir*0.14;checkPhantomFlashNearMiss(prevLane);
    }
}
function setMagneticTargetLane(continuousFloat){
    const clamped=Math.max(-2,Math.min(2,continuousFloat)),curLane=Math.round(gameState.targetLane),diff=clamped-curLane;
    if(Math.abs(diff)>=0.42){
        const step=diff>0?Math.ceil(diff-0.42):Math.floor(diff+0.42);
        setDiscreteTargetLane(Math.max(-2,Math.min(2,curLane+(step!==0?step:(diff>0?1:-1)))));
        return true;
    }
    return false;
}
function getPointerGameCoords(e){
    const W=gameState.viewW||window.innerWidth||800,H=gameState.viewH||window.innerHeight||450;
    if(isMobileHardware&&(window.innerHeight>window.innerWidth))return{x:e.clientY,y:window.innerWidth-e.clientX,W,H};
    return{x:e.clientX,y:e.clientY,W,H};
}
function handleCanvasTapLane(e){
    const{x,y,W,H}=getPointerGameCoords(e),horizonY=H*0.42,roadCurve=Math.sin(gameState.distanceM*0.012)*0.65;
    let zTap=EGO_Z_CENTER;
    if(y>horizonY+12){const scale=(y-horizonY)/(1.72*0.36);zTap=Math.max(1.1,Math.min(18.0,(H*0.85)/Math.max(1,scale)));}
    let bestLane=Math.round(gameState.targetLane),minDist=Infinity;
    for(let i=0;i<LANES.length;i++){const l=LANES[i],lx=projectX(l,zTap,W,H,roadCurve),d=Math.abs(x-lx);if(d<minDist){minDist=d;bestLane=l;}}
    setDiscreteTargetLane(bestLane);
}

function startKeyRebind(actionKey){awaitingRebindAction=actionKey;const el=document.getElementById(`bindVal_${actionKey}`);if(el)el.innerText="PRESS KEY...";}
function resetDefaultKeybinds(){controlConfig.binds={left:['a','arrowleft'],right:['d','arrowright'],nitro:['shift','w','arrowup'],brake:['s','arrowdown'],emp:[' ','e'],hideui:['h']};refreshKeybindLabels();}
function refreshKeybindLabels(){
    Object.entries(controlConfig.binds).forEach(([act,keys])=>{const el=document.getElementById(`bindVal_${act}`);if(el)el.innerText=keys.map(k=>k===' '?'SPACE':k.toUpperCase()).join(' / ');});
    const hintBadge=document.getElementById('pcHideUiHintBadge');
    if(hintBadge&&controlConfig.binds.hideui&&controlConfig.binds.hideui[0]){const k=controlConfig.binds.hideui[0]===' '?'SPACE':controlConfig.binds.hideui[0].toUpperCase();hintBadge.innerText=`[${k}] UI • [ESC] Menu`;}
}

function syncCursorVisibility(){
    const anyModal=document.getElementById('startModal').style.display!=='none'||document.getElementById('pauseSettingsModal').style.display!=='none'||document.getElementById('leaderboardModal').style.display!=='none'||document.getElementById('gameOverModal').style.display!=='none';
    document.body.classList.toggle('gameplay-active',gameState.running&&!gameState.paused&&!anyModal);
}

function openPauseSettingsModal(defaultTab='game'){
    if(gameState.running&&!gameState.paused){gameState.paused=true;updateEngineSoundPitch();updateEqVisuals(false);}
    syncExternalTrackPlayback();
    const resumeBtn=document.getElementById('resumeOrCloseSettingsBtn'),restartBtn=document.getElementById('inGameRestartBtn'),menuBtn=document.getElementById('inGameMenuBtn');
    if(gameState.running){if(resumeBtn)resumeBtn.innerText="▶ Resume";if(restartBtn)restartBtn.classList.remove('hidden');if(menuBtn)menuBtn.classList.remove('hidden');}
    else{if(resumeBtn)resumeBtn.innerText="← Back";if(restartBtn)restartBtn.classList.add('hidden');if(menuBtn)menuBtn.classList.add('hidden');}
    switchSettingsTab(defaultTab);buildVehicleLiverySelector();buildBiomeSelectorGrid();buildGraphicsUI();renderDevCustomSongsList();
    document.getElementById('pauseSettingsModal').style.display='flex';syncCursorVisibility();
}

function resumeFromSettings(){
    document.getElementById('pauseSettingsModal').style.display='none';
    if(gameState.running){requestMobileFullscreenSafe();if(controlConfig.mobileMode==='tilt')calibrateTiltSensor(true);gameState.paused=false;updateEngineSoundPitch();updateEqVisuals(true);}
    syncExternalTrackPlayback();syncCursorVisibility();
}

function returnToMainMenu(){
    gameState.running=false;gameState.paused=false;gameState.ep250WarnTimer=0;
    updateEngineSoundPitch();updateEqVisuals(false);
    ['epoch250RedAlertModal','singularityAlertBanner','pauseSettingsModal','gameOverModal','leaderboardModal'].forEach(id=>document.getElementById(id).style.display='none');
    document.getElementById('startModal').style.display='flex';
    applyPilotProfile(currentPilot.id);refreshAccountStatsUI();updateTopLeaderBanner();syncExternalTrackPlayback();syncCursorVisibility();
}

function switchSettingsTab(tabName){
    ['game','sounds','controls','graphics','dev'].forEach(t=>{
        const p=document.getElementById(`setTab_${t}`),b=document.getElementById(`setTabBtn_${t}`);
        if(p)p.classList.toggle('hidden',t!==tabName);
        if(b){if(t==='dev'&&currentPilot.id!=='1117')b.classList.add('hidden');else b.className=(t===tabName)?"py-1.5 px-2 rounded-lg text-[10px] sm:text-[11px] font-bold bg-sky-500 text-black cursor-pointer text-center truncate":"py-1.5 px-2 rounded-lg text-[10px] sm:text-[11px] font-semibold bg-[#131722] text-gray-300 border border-[#232836] cursor-pointer text-center truncate";}
    });
}

const IDD_HAZARD_CLASSES=[
    {id:0,name:"auto_rickshaw",wPx:28,hPx:24,w:1.18,speedMul:0.55,color:"#f59e0b",roof:"#1e293b",points:120},
    {id:1,name:"bus_truck",    wPx:28,hPx:24,w:1.18,speedMul:0.45,color:"#ef4444",roof:"#450a0a",points:180},
    {id:2,name:"car",          wPx:28,hPx:24,w:1.18,speedMul:0.65,color:"#38bdf8",roof:"#0c4a6e",points:140},
    {id:3,name:"two_wheeler",  wPx:28,hPx:24,w:1.18,speedMul:0.75,color:"#a855f7",roof:"#3b0764",points:160,weaves:true},
    {id:4,name:"pedestrian",   wPx:28,hPx:24,w:1.18,speedMul:0.12,color:"#fb7185",roof:"#881337",points:200},
    {id:5,name:"stray_animal", wPx:28,hPx:24,w:1.18,speedMul:0.08,color:"#fbbf24",roof:"#78350f",points:190},
    {id:6,name:"pothole",      wPx:28,hPx:24,w:1.18,speedMul:0.00,color:"#64748b",roof:"#0f172a",points:100,flat:true},
    {id:7,name:"speed_bump",   wPx:28,hPx:24,w:1.18,speedMul:0.00,color:"#eab308",roof:"#422006",points:90, flat:true}
];

const EGO_Z_REAR=1.24,EGO_Z_CENTER=1.45,EGO_Z_FRONT=1.70,EGO_HALF_LANE_W=0.35;

function resizeGameCanvas(){
    detectDeviceHardware();
    const wrapper=document.getElementById('gameViewportWrapper'),vv=window.visualViewport;
    const winW=Math.round(vv?vv.width:(window.innerWidth||document.documentElement.clientWidth||800)),winH=Math.round(vv?vv.height:(window.innerHeight||document.documentElement.clientHeight||450));
    let w=winW,h=winH;
    if(isMobileHardware&&winH>winW){
        w=winH;h=winW;
        if(wrapper){wrapper.style.position='fixed';wrapper.style.top='0px';wrapper.style.left=`${winW}px`;wrapper.style.width=`${winH}px`;wrapper.style.height=`${winW}px`;wrapper.style.transformOrigin='top left';wrapper.style.transform='rotate(90deg)';}
    }else if(wrapper){
        wrapper.style.position='fixed';wrapper.style.top='0px';wrapper.style.left='0px';wrapper.style.width=`${winW}px`;wrapper.style.height=`${winH}px`;wrapper.style.transformOrigin='';wrapper.style.transform='none';
    }
    const baseDpr=Math.min(window.devicePixelRatio||1,isMobileHardware?1.05:1.40),effDpr=Math.max(0.6,Math.min(2.0,baseDpr*(gfxSettings.resScale||1.0)));
    canvas.width=Math.max(1,Math.floor(w*effDpr));canvas.height=Math.max(1,Math.floor(h*effDpr));
    ctx.setTransform(effDpr,0,0,effDpr,0,0);gameState.viewW=w;gameState.viewH=h;cachedGradients.key='';
}

function requestMobileFullscreenSafe(){
    if(!isMobileHardware)return;
    const docEl=document.documentElement;
    if(!document.fullscreenElement&&docEl.requestFullscreen){
        docEl.requestFullscreen({navigationUI:'hide'}).then(()=>{
            if(screen.orientation&&screen.orientation.lock)screen.orientation.lock('landscape').catch(()=>{});
            setTimeout(resizeGameCanvas,50);setTimeout(resizeGameCanvas,200);
        }).catch(()=>resizeGameCanvas());
    }else resizeGameCanvas();
}

document.addEventListener('fullscreenchange',()=>{resizeGameCanvas();setTimeout(resizeGameCanvas,120);setTimeout(resizeGameCanvas,300);});
if(window.visualViewport){window.visualViewport.addEventListener('resize',resizeGameCanvas);window.visualViewport.addEventListener('scroll',resizeGameCanvas);}

function triggerEpoch250BigRedWarning(){gameState.ep250WarnTriggered=true;gameState.ep250WarnTimer=3.0;document.getElementById('epoch250RedAlertModal').style.display='flex';playGameSfx('siren250');}

function startGameSession(startEpochOverride=1){
    ensureAudioEngine();
    if(!currentPilot.isCore){
        const idInp=document.getElementById('pilotIdInput'),gInp=document.getElementById('guestCallsignInput');
        if(idInp&&/^\d{4}$/.test(idInp.value.trim())){customGuestId=idInp.value.trim();localStorage.setItem('roadSense_overdrive_customGuestId',customGuestId);}else ensureGuestHas4DigitId();
        if(gInp&&gInp.value.trim())updateGuestCallsign(gInp.value.trim());
    }
    requestMobileFullscreenSafe();resizeGameCanvas();
    if(controlConfig.mobileMode==='tilt')calibrateTiltSensor(true);
    isAccountSessionLocked=true;localStorage.setItem('roadSense_overdrive_accountLocked','true');
    ['startModal','pauseSettingsModal','leaderboardModal','gameOverModal','epoch250RedAlertModal'].forEach(id=>document.getElementById(id).style.display='none');
    try{if(isMobileHardware)history.pushState({inGame:true},'');}catch(e){}
    const initEpoch=Math.max(1,Math.floor(startEpochOverride||1));
    Object.assign(gameState,{running:true,paused:false,score:0,epoch:initEpoch,combo:1.0,nearMisses:0,armor:100,nitroFuel:100,empCharge:100,distanceM:getDistanceForEpoch(initEpoch),speedMps:25,targetLane:0,egoLaneX:0,egoRoll:0,boosting:false,braking:false,slowMoTimer:0,empWaveRadius:0,screenShake:0,ep250WarnTriggered:(initEpoch>250),ep250WarnTimer:0,hazards:[],pickups:[],FloatingTexts:[]});
    fpsMonitorFrames=0;fpsMonitorSlow=0;
    syncBiomeForCurrentEpoch(true);
    if(initEpoch===249||initEpoch===250)triggerEpoch250BigRedWarning();
    syncExternalTrackPlayback();updateEngineSoundPitch();updateEqVisuals(true);updateHudDOM(true);renderMiniRadar();syncCursorVisibility();
}

function syncBiomeForCurrentEpoch(isInitial=false){
    const alertBanner=document.getElementById('singularityAlertBanner');
    if(gameState.epoch===250){
        biomeIdx=EPOCH_250_INDEX;cachedGradients.key='';
        if(alertBanner)alertBanner.style.display='flex';
        if(!gameState.ep250WarnTriggered)triggerEpoch250BigRedWarning();
    }else{
        if(alertBanner)alertBanner.style.display='none';
        if(gameState.epoch===251&&!isInitial){saveActiveAccountStats(gameState.score,251,0);spawnFloatingText("🏆 EPOCH 250 SURVIVED! COSMIC SINGULARITY UNLOCKED!","#fbbf24",0,-60);}
        if(autoCycleBiomes){
            const poolCount=isBiomeUnlockedForPilot(EPOCH_250_INDEX)?14:13,nextIdx=Math.floor((gameState.epoch-1)/10)%poolCount;
            if(nextIdx!==biomeIdx||isInitial){biomeIdx=nextIdx;cachedGradients.key='';if(!isInitial)spawnFloatingText(`🌍 DIMENSION SHIFT: ${BIOME_THEMES[biomeIdx].label.toUpperCase()}`,"#38bdf8",0,-50);}
        }
    }
    setTextCached('hudBiomeName',BIOME_THEMES[biomeIdx].label);
}

function exitGamePortal(){
    gameState.running=false;silenceAllAudioForBackground();syncCursorVisibility();
    try{window.open('','_self','');window.close();}catch(e){}
    if(!window.closed){if(window.history.length>1)window.history.back();else window.location.href='index.html';}
}

function checkPhantomFlashNearMiss(prevLane){
    for(let i=0;i<gameState.hazards.length;i++){
        const h=gameState.hazards[i];
        if(!h.nearMissed&&Math.abs(h.lane-prevLane)<0.72&&h.z>EGO_Z_REAR&&h.z<10.5){
            h.nearMissed=true;gameState.nearMisses++;gameState.combo=Math.min(8.0,+(gameState.combo+0.5).toFixed(1));
            const bonus=Math.round(250*gameState.combo);gameState.score+=bonus;
            gameState.nitroFuel=Math.min(100,gameState.nitroFuel+18);gameState.empCharge=Math.min(100,gameState.empCharge+14);
            if(gfxSettings.transitions)gameState.slowMoTimer=0.42;
            playGameSfx('phantom');spawnFloatingText(`⚡ PHANTOM FLASH +${bonus}`,"#00f5d4",0,-45);break;
        }
    }
}

function steerLane(dir){if(gameState.running&&!gameState.paused)setDiscreteTargetLane(Math.round(gameState.targetLane)+dir);}
function setBoosting(active){const nextBoost=(active&&gameState.nitroFuel>2);if(nextBoost&&!gameState.boosting&&gameState.running&&!gameState.paused)playGameSfx('nitro');gameState.boosting=nextBoost;}
function setBraking(active){gameState.braking=active;}

function triggerNeuralEmp(){
    if(!gameState.running||gameState.paused)return;
    if(gameState.empCharge<100){spawnFloatingText("⚡ EMP CHARGING...","#94a3b8",0,-20);return;}
    gameState.empCharge=0;gameState.empWaveRadius=1;if(gfxSettings.shake)gameState.screenShake=8;
    playGameSfx('emp');
    const cleared=gameState.hazards.length,bonus=cleared*Math.round(160*gameState.combo);
    gameState.score+=bonus;gameState.hazards=[];
    spawnFloatingText(`⚡ NEURAL EMP VAPORIZED ${cleared} HAZARDS! +${bonus}`,"#38bdf8",0,-60);updateHudDOM(true);
}

function spawnFloatingText(text,color,ox=0,oy=0){
    if(!gfxSettings.transitions)return;
    if(gameState.FloatingTexts.length>4)gameState.FloatingTexts.shift();
    gameState.FloatingTexts.push({text,color,x:(gameState.viewW||800)*0.5+ox,y:(gameState.viewH||450)*0.42+oy,life:1.0});
}

function projectX(laneOffset,zSafe,W,H,roadCurve){
    const scale=(H*0.85)/zSafe,zNorm=zSafe*0.0181818,curveShift=roadCurve*(zNorm*zNorm)*(W*0.22),worldX=(laneOffset-gameState.egoLaneX*0.32)*LANE_WIDTH_M;
    return W*0.5+worldX*scale*0.24+curveShift;
}
function projectY(zSafe,yMeters,H){const scale=(H*0.85)/zSafe;return(H*0.42)+(1.72-yMeters)*scale*0.36;}

function updateGamePhysics(dt,now){
    if(!gameState.running||gameState.paused)return;
    if(isMobileHardware&&fpsMonitorFrames<90){
        fpsMonitorFrames++;
        if(dt>0.024)fpsMonitorSlow++;
        if(fpsMonitorFrames===90&&fpsMonitorSlow>=18&&gfxSettings.preset!=='low'){
            recommendedPresetKey='low';applyGraphicsPreset('low',true);
        }
    }
    if(gameState.ep250WarnTimer>0){gameState.ep250WarnTimer=Math.max(0,gameState.ep250WarnTimer-dt);if(gameState.ep250WarnTimer<=0)document.getElementById('epoch250RedAlertModal').style.display='none';}
    const activeDiffKey=(gameState.epoch===250)?'void':currentDiffKey,diff=DIFFICULTY_PRESETS[activeDiffKey]||DIFFICULTY_PRESETS.easy;
    let timeScale=1.0;if(gameState.slowMoTimer>0){gameState.slowMoTimer=Math.max(0,gameState.slowMoTimer-dt);timeScale=0.50;}
    const effDt=dt*timeScale,distTo250=(249*70)-gameState.distanceM;
    if(!gameState.ep250WarnTriggered&&distTo250>0&&distTo250<=gameState.speedMps*3.1)triggerEpoch250BigRedWarning();
    const prevEpoch=gameState.epoch;gameState.epoch=getEpochFromDistance(gameState.distanceM);
    if(gameState.epoch!==prevEpoch)syncBiomeForCurrentEpoch(false);
    const levelScale=Math.max(0.55,1.0-Math.min(0.45,(gameState.epoch-1)*0.0025));
    if(gameState.boosting){gameState.nitroFuel=Math.max(0,gameState.nitroFuel-dt*24);if(gameState.nitroFuel<=0)gameState.boosting=false;}
    else gameState.nitroFuel=Math.min(100,gameState.nitroFuel+dt*diff.nitroRegen*levelScale);
    gameState.empCharge=Math.min(100,gameState.empCharge+dt*diff.empRegen*levelScale);

    const endlessSpeedBonus=Math.min(15,Math.log2(1+gameState.epoch)*2.1),baseCruise=(24+endlessSpeedBonus)*diff.speedMul;
    const targetSpeed=gameState.boosting?baseCruise*1.44:(gameState.braking?baseCruise*0.52:baseCruise);
    gameState.speedMps+=(targetSpeed-gameState.speedMps)*(1-Math.exp(-8*dt));
    gameState.distanceM+=gameState.speedMps*effDt;
    gameState.score+=Math.round(gameState.speedMps*effDt*gameState.combo*diff.scoreMul*1.35);
    updateEngineSoundPitch();

    gameState.targetLane=Math.max(-2,Math.min(2,Math.round(gameState.targetLane)));
    const laneDiff=gameState.targetLane-gameState.egoLaneX,smoothAlpha=1-Math.exp(-18*dt);
    if(Math.abs(laneDiff)<0.003){gameState.egoLaneX=gameState.targetLane;gameState.egoRoll=0;}
    else{gameState.egoLaneX+=laneDiff*smoothAlpha;gameState.egoRoll=Math.max(-0.15,Math.min(0.15,laneDiff*0.14));}

    if(gameState.screenShake>0)gameState.screenShake=Math.max(0,gameState.screenShake-dt*28);
    if(gameState.empWaveRadius>0){gameState.empWaveRadius+=dt*1400;if(gameState.empWaveRadius>1500)gameState.empWaveRadius=0;}

    spawnAccumulator+=gameState.speedMps*effDt;
    const spawnInterval=Math.max(17.0,diff.spawnMeters-Math.min(8.5,Math.log2(1+gameState.epoch)*1.25));
    if(spawnAccumulator>=spawnInterval){
        spawnAccumulator=0;const occupied=new Set();
        for(let i=0;i<gameState.hazards.length;i++)if(gameState.hazards[i].z>46)occupied.add(Math.round(gameState.hazards[i].lane));
        const free=LANES.filter(l=>!occupied.has(l));
        if(free.length>=2){
            const cls=IDD_HAZARD_CLASSES[Math.floor(Math.random()*IDD_HAZARD_CLASSES.length)],lane=free[Math.floor(Math.random()*free.length)];
            gameState.hazards.push({cls,lane,baseLane:lane,z:60.0,speedMps:cls.speedMul*baseCruise*0.52,dgi:+(Math.random()*0.18+0.02).toFixed(2),phase:Math.random()*Math.PI*2,nearMissed:false});
        }
    }

    pickupAccumulator+=gameState.speedMps*effDt;
    if(pickupAccumulator>=(diff.pickupSpacing/levelScale)&&gameState.pickups.length<2){
        pickupAccumulator=0;const rng=Math.random();
        gameState.pickups.push({lane:LANES[Math.floor(Math.random()*LANES.length)],z:58.0,type:rng<0.3333?'nitro':(rng<0.6667?'emp':'hull'),spin:0});
    }

    const hitThresh=0.56+(diff.hitboxScale-0.75)*0.50;
    for(let i=gameState.hazards.length-1;i>=0;i--){
        const h=gameState.hazards[i];
        h.z-=Math.max(4,gameState.speedMps-h.speedMps)*effDt;
        if(h.cls.weaves)h.lane=Math.max(-2,Math.min(2,h.baseLane+Math.sin(now*0.0025+h.phase)*0.32));
        if(h.z<=EGO_Z_FRONT+0.35&&h.z>=EGO_Z_REAR-0.22){
            const latDist=Math.min(Math.abs(h.lane-gameState.egoLaneX),Math.abs(h.lane-gameState.targetLane));
            if(latDist<hitThresh){
                playGameSfx('hit');if(gfxSettings.shake)gameState.screenShake=9;gameState.combo=1.0;
                const dmg=Math.round((h.cls.flat?12:19)*diff.hitboxScale);gameState.armor=Math.max(0,gameState.armor-dmg);
                spawnFloatingText(`💥 IMPACT: ${h.cls.name.toUpperCase()} (-${dmg}% HULL)`,"#ef4444",0,-30);
                gameState.hazards.splice(i,1);updateHudDOM(true);
                if(gameState.armor<=0){triggerGameOver();return;}
                continue;
            }
        }
        if(h.z<0.70){gameState.score+=Math.round(h.cls.points*gameState.combo*diff.scoreMul);gameState.hazards.splice(i,1);}
    }

    const fillMul=diff.pickupScale*levelScale;
    for(let i=gameState.pickups.length-1;i>=0;i--){
        const p=gameState.pickups[i];p.z-=gameState.speedMps*effDt;p.spin+=dt*4.5;
        if(p.z<=EGO_Z_FRONT+0.8&&p.z>=EGO_Z_REAR-0.35&&Math.abs(p.lane-gameState.egoLaneX)<0.68){
            playGameSfx('pickup');
            if(p.type==='nitro'){const g=Math.max(15,Math.round(42*fillMul));gameState.nitroFuel=Math.min(100,gameState.nitroFuel+g);gameState.score+=Math.round(280*gameState.combo);spawnFloatingText(`🟨 NITRO CORE +${g}% NITRO`,"#fbbf24",0,-38);}
            else if(p.type==='emp'){const g=Math.max(14,Math.round(38*fillMul));gameState.empCharge=Math.min(100,gameState.empCharge+g);gameState.score+=Math.round(280*gameState.combo);spawnFloatingText(`🟦 EMP CORE +${g}% EMP`,"#38bdf8",0,-38);}
            else{const g=Math.max(10,Math.round(26*fillMul));gameState.armor=Math.min(100,gameState.armor+g);gameState.score+=Math.round(280*gameState.combo);spawnFloatingText(`🟩 HULL NANITES +${g}% HULL`,"#10b981",0,-38);}
            gameState.pickups.splice(i,1);updateHudDOM(true);continue;
        }
        if(p.z<0.70)gameState.pickups.splice(i,1);
    }

    for(let i=gameState.FloatingTexts.length-1;i>=0;i--){const ft=gameState.FloatingTexts[i];ft.y-=dt*42;ft.life-=dt*1.15;if(ft.life<=0)gameState.FloatingTexts.splice(i,1);}

    if(now-lastHudUpdateTime>=100){
        lastHudUpdateTime=now;updateHudDOM(false);if(!isHudHidden)renderMiniRadar();
        const curBest=getActiveAccountStats().bestScore||0;
        if(gameState.score>curBest&&now-lastLiveLbPushTime>4500){lastLiveLbPushTime=now;recordScoreToLeaderboard(gameState.score,gameState.epoch,true);}
    }
}

function triggerGameOver(){
    gameState.running=false;gameState.ep250WarnTimer=0;
    document.getElementById('epoch250RedAlertModal').style.display='none';
    syncExternalTrackPlayback();updateEngineSoundPitch();
    saveActiveAccountStats(gameState.score,gameState.epoch,gameState.nearMisses);
    recordScoreToLeaderboard(gameState.score,gameState.epoch,true);
    const st=getActiveAccountStats();
    document.getElementById('finalScoreVal').innerText=gameState.score.toLocaleString();
    document.getElementById('finalBestVal').innerText=(st.bestScore||gameState.score).toLocaleString();
    document.getElementById('finalEpochVal').innerText=`Epoch ${gameState.epoch} • ${BIOME_THEMES[biomeIdx].label}`;
    document.getElementById('finalNearMissVal').innerText=String(gameState.nearMisses);
    document.getElementById('gameOverModal').style.display='flex';syncCursorVisibility();
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
        const h=gameState.hazards[i],latDiff=Math.abs(h.lane-gameState.egoLaneX),distRisk=Math.max(0,Math.min(1,1-(h.z-2)/50)),overlap=Math.max(0,1-latDiff/1.2),ttc=h.z/Math.max(1,gameState.speedMps-h.speedMps),ttcRisk=ttc<=1.8?1.0:Math.max(0,(6.0-ttc)/4.2),rFinal=Math.min(1,0.35*distRisk+0.35*ttcRisk+0.30*overlap);
        h.rFinal=rFinal;h.ttc=ttc;if(rFinal>maxRisk){maxRisk=rFinal;lead=h;}
    }
    const riskPct=Math.round(maxRisk*100),warnTier=riskPct>=85?'CRITICAL':(riskPct>=65?'WARNING':(riskPct>=35?'CAUTION':'CLEAR'));
    if(domCache.warnTier!==warnTier){
        domCache.warnTier=warnTier;const wb=document.getElementById('hudWarningBadge');
        if(wb){wb.innerText=warnTier;wb.className=warnTier==='CRITICAL'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-red-950 text-red-400 border border-red-500 whitespace-nowrap shrink-0":(warnTier==='WARNING'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-orange-950 text-orange-400 border border-orange-500 whitespace-nowrap shrink-0":(warnTier==='CAUTION'?"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-500 whitespace-nowrap shrink-0":"px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 whitespace-nowrap shrink-0"));}
    }
    if(lead){setTextCached('hudLeadName',`${lead.cls.name.toUpperCase()} (${lead.z.toFixed(1)}m)`);setTextCached('hudLeadTtc',`${lead.ttc.toFixed(1)}s`);setTextCached('hudLeadDgi',String(lead.dgi));}
    else{setTextCached('hudLeadName',"CLEAR");setTextCached('hudLeadTtc',"STABLE");setTextCached('hudLeadDgi',"0.00");}
}

function renderMiniRadar(){
    const w=radarCanvas.width,h=radarCanvas.height,cx=w*0.5,cy=h-7;
    rCtx.clearRect(0,0,w,h);rCtx.strokeStyle='#1e2638';rCtx.lineWidth=1;
    rCtx.beginPath();rCtx.arc(cx,cy,20,Math.PI,0,false);rCtx.arc(cx,cy,40,Math.PI,0,false);rCtx.arc(cx,cy,60,Math.PI,0,false);rCtx.stroke();
    rCtx.fillStyle=activeLiveryProfile.dotColor;rCtx.fillRect(cx-3,cy-5,6,5);
    radarAngle+=0.25;if(radarAngle>Math.PI*2)radarAngle=Math.PI;
    rCtx.beginPath();rCtx.moveTo(cx,cy);rCtx.lineTo(cx+Math.cos(radarAngle)*65,cy+Math.sin(radarAngle)*65);rCtx.strokeStyle='rgba(56,189,248,0.35)';rCtx.stroke();
    for(let i=0;i<gameState.hazards.length;i++){
        const hz=gameState.hazards[i];if(hz.z>55)continue;
        const bx=cx+(hz.lane-gameState.egoLaneX)*9,by=cy-hz.z*1.18;
        if(by>2&&by<h){rCtx.fillStyle=(hz.rFinal>=0.85)?'#ef4444':(hz.rFinal>=0.65?'#f97316':(hz.rFinal>=0.35?'#f59e0b':'#38bdf8'));rCtx.fillRect(bx-2,by-2,4,4);}
    }
}

function ensureCachedBiomeGradients(W,H,horizonY,theme){
    const key=`${W}_${H}_${biomeIdx}`;if(cachedGradients.key===key)return;cachedGradients.key=key;
    const skyGrad=ctx.createLinearGradient(0,0,0,H);
    skyGrad.addColorStop(0,theme.skyTop);skyGrad.addColorStop(0.42,theme.skyBot);skyGrad.addColorStop(0.43,theme.roadDark);skyGrad.addColorStop(1,theme.roadDark);
    cachedGradients.sky=skyGrad;
    const sunGrad=ctx.createRadialGradient(W*0.5,horizonY-16,6,W*0.5,horizonY-16,H*0.34);
    sunGrad.addColorStop(0,"#ffffff");sunGrad.addColorStop(0.26,theme.sun);sunGrad.addColorStop(1,"transparent");
    cachedGradients.sun=sunGrad;
}

function renderUniqueDimensionHorizon(W,H,horizonY,theme,now,dynamicWorldColor,cosmicHue){
    const cx=W*0.5,hType=theme.horizonType||"cyber",u=Math.min(W,H);
    if(hType==="cosmic250"||gameState.epoch===250){
        const cy=horizonY-22,bhR=u*0.115;
        if(gfxSettings.pillars){
            const jetW=bhR*0.44;ctx.fillStyle=`hsla(${cosmicHue},95%,65%,0.22)`;
            ctx.beginPath();ctx.moveTo(cx-jetW*0.2,cy);ctx.lineTo(cx-jetW*1.45,0);ctx.lineTo(cx+jetW*1.45,0);ctx.lineTo(cx+jetW*0.2,cy);ctx.fill();
            for(let p=-2;p<=2;p++){if(p===0)continue;const px=cx+p*(W*0.185);ctx.fillStyle=`hsla(${(cosmicHue+p*55+360)%360},95%,62%,0.15)`;ctx.fillRect(px-8,0,16,horizonY);}
        }
        ctx.fillStyle=cachedGradients.sun;ctx.beginPath();ctx.arc(cx,cy,bhR*2.75,0,Math.PI*2);ctx.fill();
        if(gfxSettings.pillars){
            ctx.save();ctx.translate(cx,cy);ctx.rotate(-0.14+Math.sin(now*0.0008)*0.04);
            for(let r=0;r<3;r++){ctx.strokeStyle=`hsla(${(cosmicHue+r*65)%360},95%,65%,${0.78-r*0.18})`;ctx.lineWidth=3-r*0.65;ctx.beginPath();ctx.ellipse(0,0,bhR*(1.55+r*0.38),bhR*(0.32+r*0.08),0,0,Math.PI*2);ctx.stroke();}
            ctx.restore();
        }
        ctx.fillStyle="#010006";ctx.beginPath();ctx.arc(cx,cy,bhR*0.88,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=dynamicWorldColor;ctx.lineWidth=2.8;ctx.beginPath();ctx.arc(cx,cy,bhR*0.90,0,Math.PI*2);ctx.stroke();return;
    }
    ctx.fillStyle=cachedGradients.sun;ctx.beginPath();ctx.arc(cx,horizonY-10,H*0.28,Math.PI,0,false);ctx.fill();
    if(hType==="cyber"){
        const sunR=u*0.135;
        ctx.save();ctx.beginPath();ctx.arc(cx,horizonY-2,sunR,Math.PI,0,false);ctx.clip();
        const sg=ctx.createLinearGradient(cx,horizonY-sunR,cx,horizonY);sg.addColorStop(0,"#00f5d4");sg.addColorStop(0.55,"#38bdf8");sg.addColorStop(1,"#ec4899");
        ctx.fillStyle=sg;ctx.fillRect(cx-sunR,horizonY-sunR-2,sunR*2,sunR+2);ctx.fillStyle=theme.skyBot;
        for(let s=0;s<7;s++)ctx.fillRect(cx-sunR,horizonY-s*(sunR*0.13)-3,sunR*2,1.8+s*0.65);
        ctx.restore();
        const bCount=22,bw=W/bCount;
        for(let b=0;b<bCount;b++){
            const bx=b*bw,distC=Math.abs((bx+bw*0.5)-cx)/(W*0.5),bh=(18+((b*41)%44))*(0.45+distC*0.75);
            ctx.fillStyle="#040710";ctx.fillRect(bx,horizonY-bh,bw+1,bh);ctx.strokeStyle="rgba(56,189,248,0.45)";ctx.lineWidth=1;ctx.strokeRect(bx,horizonY-bh,bw,bh);
        }
    }else if(hType==="monsoon"){
        if((Math.floor(now*0.009)%11)===0){ctx.strokeStyle="#a7f3d0";ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(cx+W*0.12,0);ctx.lineTo(cx+W*0.09,horizonY*0.38);ctx.lineTo(cx+W*0.13,horizonY*0.52);ctx.lineTo(cx+W*0.07,horizonY);ctx.stroke();}
        const spanW=W*0.26,towerH=H*0.19,deckY=horizonY-H*0.045;
        ctx.strokeStyle="rgba(16,185,129,0.42)";ctx.lineWidth=1.2;
        for(let x=cx-spanW;x<=cx+spanW;x+=20){const norm=(x-cx)/spanW,cableY=(horizonY-towerH)+(1-norm*norm)*(deckY-(horizonY-towerH)-6);ctx.beginPath();ctx.moveTo(x,cableY);ctx.lineTo(x,deckY);ctx.stroke();}
        ctx.strokeStyle="#10b981";ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(cx-spanW,horizonY-towerH);ctx.quadraticCurveTo(cx,deckY-6,cx+spanW,horizonY-towerH);ctx.stroke();
        [-1,1].forEach(s=>{const tx=cx+s*spanW;ctx.fillStyle="#061a1e";ctx.strokeStyle="#10b981";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(tx-12,horizonY);ctx.lineTo(tx-6,horizonY-towerH);ctx.lineTo(tx+6,horizonY-towerH);ctx.lineTo(tx+12,horizonY);ctx.closePath();ctx.fill();ctx.stroke();});
    }else if(hType==="solar"){
        const r=u*0.125,cy=horizonY-r*0.55;
        ctx.fillStyle="#fff7ed";ctx.strokeStyle="#f97316";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,r,Math.PI*0.92,Math.PI*0.08,false);ctx.fill();ctx.stroke();
        ctx.strokeStyle="rgba(251,146,60,0.65)";ctx.lineWidth=2;
        for(let i=0;i<5;i++){const a=Math.PI+(i/4)*Math.PI+Math.sin(now*0.002+i)*0.08;ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,r*0.24,0,Math.PI*2);ctx.stroke();}
        [-1,1].forEach(s=>{const px=cx+s*(W*0.27),py=horizonY-H*0.11;ctx.fillStyle="#1c080d";ctx.strokeStyle="#f59e0b";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(px,py-26);ctx.lineTo(px+22,py);ctx.lineTo(px,py+26);ctx.lineTo(px-22,py);ctx.closePath();ctx.fill();ctx.stroke();});
    }else if(hType==="cryo"){
        if(gfxSettings.pillars){for(let band=0;band<2;band++){ctx.strokeStyle=band===0?"rgba(56,189,248,0.34)":"rgba(52,211,153,0.28)";ctx.lineWidth=10-band*3;ctx.beginPath();for(let x=0;x<=W;x+=36){const y=horizonY*(0.24+band*0.12)+Math.sin(x*0.011+now*0.0016+band)*14;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}}
        [[-0.36,0.11],[-0.20,0.18],[0.0,0.22],[0.20,0.18],[0.36,0.11]].forEach(([ox,oh])=>{const px=cx+ox*W,pw=W*0.13,ph=H*oh;ctx.fillStyle="#041529";ctx.strokeStyle="#7dd3fc";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(px-pw,horizonY);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();});
    }else if(hType==="bio"){
        const mr=u*0.095,mcy=horizonY-mr*1.25,pulse=1+Math.sin(now*0.0035)*0.08;
        ctx.save();ctx.translate(cx,mcy);ctx.fillStyle="#032211";ctx.strokeStyle="#4ade80";ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(0,0,mr*pulse,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#bbf7d0";ctx.beginPath();ctx.arc(0,0,mr*0.28*pulse,0,Math.PI*2);ctx.fill();
        for(let r=0;r<2;r++){ctx.save();ctx.rotate(now*(r===0?0.0012:-0.0015)+r*1.1);ctx.strokeStyle=r===0?"#4ade80":"#00f5d4";ctx.lineWidth=1.8;ctx.beginPath();ctx.ellipse(0,0,mr*1.48,mr*0.38,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
        ctx.restore();
        [-0.34,-0.19,0.19,0.34].forEach((ox,i)=>{const sway=Math.sin(now*0.0022+i)*5,mx=cx+ox*W+sway,stemH=H*(i%2===0?0.10:0.14),capR=u*(i%2===0?0.05:0.068),topY=horizonY-stemH;ctx.fillStyle="#041f11";ctx.strokeStyle="#22c55e";ctx.lineWidth=1.5;ctx.fillRect(mx-3,topY,6,stemH);ctx.fillStyle="#06371c";ctx.strokeStyle="#4ade80";ctx.beginPath();ctx.ellipse(mx,topY,capR,capR*0.44,0,Math.PI,0,false);ctx.closePath();ctx.fill();ctx.stroke();});
    }else if(hType==="eclipse"){
        const r=u*0.105,ecy=horizonY-r*1.12;
        ctx.fillStyle="#040002";ctx.strokeStyle="#fb7185";ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,ecy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(cx+r*0.72,ecy-r*0.68,5,0,Math.PI*2);ctx.fill();
        for(let s=-4;s<=4;s++){if(s===0)continue;const sx=cx+s*(W*0.085),sh=H*(Math.abs(s)%2===1?0.15:0.10);ctx.fillStyle="#120307";ctx.strokeStyle="#f43f5e88";ctx.beginPath();ctx.moveTo(sx-9,horizonY);ctx.lineTo(sx,horizonY-sh);ctx.lineTo(sx+9,horizonY);ctx.closePath();ctx.fill();ctx.stroke();}
    }else if(hType==="tachyon"){
        const coreY=horizonY-H*0.13,coreR=u*0.055;
        ctx.fillStyle="#1e0b3b";ctx.strokeStyle="#eab308";ctx.lineWidth=2.2;ctx.beginPath();ctx.arc(cx,coreY,coreR,0,Math.PI*2);ctx.fill();ctx.stroke();
        [-1,1].forEach(s=>{const tx=cx+s*(W*0.24),th=H*0.17;ctx.fillStyle="#120726";ctx.strokeStyle="#c084fc";ctx.lineWidth=1.6;ctx.fillRect(tx-8,horizonY-th,16,th);ctx.strokeRect(tx-8,horizonY-th,16,th);ctx.strokeStyle="#fde047";ctx.beginPath();ctx.moveTo(tx,horizonY-th);ctx.quadraticCurveTo((tx+cx)*0.5,coreY-16+Math.sin(now*0.018+s)*10,cx+s*coreR,coreY);ctx.stroke();});
    }else if(hType==="dune"){
        ctx.fillStyle="#fef08a";ctx.beginPath();ctx.arc(cx-W*0.09,horizonY-H*0.15,u*0.038,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#f97316";ctx.beginPath();ctx.arc(cx+W*0.10,horizonY-H*0.10,u*0.068,0,Math.PI*2);ctx.fill();
        [[-0.23,0.11,0.10],[0,0.16,0.15],[0.23,0.11,0.10]].forEach(([ox,pwR,phR])=>{const px=cx+ox*W,pw=W*pwR,ph=H*phR;ctx.fillStyle="#120902";ctx.strokeStyle="#fbbf24";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(px-pw,horizonY);ctx.lineTo(px,horizonY-ph);ctx.lineTo(px+pw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();});
    }else if(hType==="sakura"){
        const mr=u*0.125,fw=W*0.25,fh=H*0.16;
        ctx.fillStyle="rgba(251,207,232,0.88)";ctx.beginPath();ctx.arc(cx,horizonY-mr*0.55,mr,Math.PI,0,false);ctx.fill();
        ctx.fillStyle="#12061c";ctx.strokeStyle="#f472b6";ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(cx-fw,horizonY);ctx.lineTo(cx-fw*0.14,horizonY-fh);ctx.lineTo(cx+fw*0.14,horizonY-fh);ctx.lineTo(cx+fw,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
    }else if(hType==="matrix"){
        const mr=u*0.105,cy=horizonY-mr*1.08;
        ctx.save();ctx.translate(cx,cy);ctx.strokeStyle="#22c55e";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,mr*1.18,0,Math.PI*2);ctx.stroke();
        ctx.rotate(now*0.0008);ctx.fillStyle="#021407";ctx.beginPath();ctx.moveTo(0,-mr);ctx.lineTo(mr,0);ctx.lineTo(0,mr);ctx.lineTo(-mr,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    }else if(hType==="saturn"){
        const r=u*0.105,cy=horizonY-r*1.02;
        ctx.fillStyle="#1e1b4b";ctx.strokeStyle="#818cf8";ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.save();ctx.translate(cx,cy);ctx.rotate(-0.18);
        for(let ring=0;ring<3;ring++){ctx.strokeStyle=ring===1?"rgba(199,210,254,0.85)":"rgba(129,140,248,0.55)";ctx.lineWidth=ring===1?3.2:1.6;ctx.beginPath();ctx.ellipse(0,0,r*(1.65+ring*0.35),r*(0.28+ring*0.07),0,0,Math.PI*2);ctx.stroke();}
        ctx.restore();
    }else if(hType==="magma"){
        const vh=H*0.17,vw=W*0.24;
        ctx.fillStyle="#170401";ctx.strokeStyle="#fb923c";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(0,horizonY);ctx.lineTo(cx-vw,horizonY-vh*0.42);ctx.lineTo(cx-vw*0.22,horizonY-vh);ctx.lineTo(cx+vw*0.22,horizonY-vh);ctx.lineTo(cx+vw,horizonY-vh*0.42);ctx.lineTo(W,horizonY);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle="#ef4444";ctx.beginPath();ctx.arc(cx,horizonY-vh,13,Math.PI,0,false);ctx.fill();
    }else if(hType==="astral"){
        const cy=horizonY-H*0.12,r=u*0.075;
        ctx.save();ctx.translate(cx,cy);ctx.rotate(now*0.0008);ctx.strokeStyle="#f8fafc";ctx.lineWidth=1.8;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.strokeRect(-r*0.7,-r*0.7,r*1.4,r*1.4);ctx.restore();
        for(let m=-3;m<=3;m++){if(m===0)continue;const mx=cx+m*(W*0.105),mh=32,fy=horizonY-18-Math.sin(now*0.002+m)*5;ctx.fillStyle="#0b0f19";ctx.strokeStyle="#e2e8f0";ctx.fillRect(mx-8,fy-mh,16,mh);ctx.strokeRect(mx-8,fy-mh,16,mh);}
    }
}

function renderHighTextureDistinctHazard(hz,zSafe,W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue){
    const bx=Math.round(projectX(hz.lane,zSafe,W,H,roadCurve)),by=Math.round(projectY(zSafe,0,H));
    const screenScale=Math.max(0.78,Math.min(1.05,Math.min(W,H)/450));
    const boxW=Math.round(28*screenScale),boxH=Math.round(24*screenScale);
    const x1=Math.round(bx-boxW*0.5),y2=by,y1=y2-boxH;
    const primaryCol=isCosmic250?`hsl(${(cosmicHue+hz.cls.id*45)%360},90%,58%)`:hz.cls.color;
    const tierColor=(hz.rFinal>=0.85)?"#ef4444":(hz.rFinal>=0.65?"#f97316":(hz.rFinal>=0.35?"#f59e0b":dynamicWorldColor));

    ctx.fillStyle="rgba(0,0,0,0.62)";ctx.fillRect(x1-1,y2-1,boxW+2,3);
    ctx.fillStyle=hz.cls.roof;ctx.strokeStyle=primaryCol;ctx.lineWidth=1.6;
    ctx.fillRect(x1,y1,boxW,boxH);ctx.strokeRect(x1,y1,boxW,boxH);

    const cid=hz.cls.id;
    if(cid<=3){
        ctx.fillStyle="#05070b";ctx.fillRect(x1,y2-5,4,5);ctx.fillRect(x1+boxW-4,y2-5,4,5);
        ctx.fillStyle="#7dd3fc";ctx.fillRect(x1+4,y1+3,boxW-8,Math.round(boxH*0.32));
        ctx.fillStyle=primaryCol;ctx.fillRect(x1+2,y1+Math.round(boxH*0.42),boxW-4,Math.round(boxH*0.42));
        ctx.fillStyle="#ff1e42";ctx.fillRect(x1+3,y2-6,6,3);ctx.fillRect(x1+boxW-9,y2-6,6,3);
        if(cid===1){ctx.fillStyle="#fbbf24";ctx.fillRect(x1+4,y1+1,4,2);ctx.fillRect(x1+boxW-8,y1+1,4,2);}
        else if(cid===0){ctx.fillStyle="#fde047";ctx.fillRect(bx-3,y2-5,6,2);}
        else if(cid===3){ctx.fillStyle="#00f5d4";ctx.fillRect(bx-3,y1+4,6,3);}
    }else if(cid===4){
        ctx.fillStyle=primaryCol;ctx.fillRect(x1+3,y1+3,boxW-6,boxH-6);
        ctx.fillStyle="#00f5d4";ctx.fillRect(x1+6,y1+5,boxW-12,4);
        ctx.fillStyle="#0f172a";ctx.fillRect(x1+5,y1+11,boxW-10,boxH-14);
    }else if(cid===5){
        ctx.fillStyle=primaryCol;ctx.fillRect(x1+2,y1+4,boxW-4,boxH-6);
        ctx.fillStyle="#fde68a";ctx.fillRect(x1+4,y1+2,5,4);ctx.fillRect(x1+boxW-9,y1+2,5,4);
        ctx.fillStyle="#00f5d4";ctx.fillRect(x1+5,y1+7,4,3);ctx.fillRect(x1+boxW-9,y1+7,4,3);
    }else if(cid===6){
        ctx.fillStyle="#05070c";ctx.fillRect(x1+2,y1+2,boxW-4,boxH-4);
        ctx.strokeStyle="#38bdf8";ctx.lineWidth=1.4;ctx.strokeRect(x1+4,y1+4,boxW-8,boxH-8);
        ctx.fillStyle="#f59e0b";ctx.fillRect(x1+3,y1+2,5,3);ctx.fillRect(x1+boxW-8,y1+2,5,3);
    }else{
        ctx.fillStyle=primaryCol;
        for(let c=0;c<4;c++)ctx.fillRect(x1+3+c*Math.floor((boxW-6)/4),y1+3,3,boxH-6);
        ctx.fillStyle="#ef4444";ctx.fillRect(x1+2,y2-5,4,3);ctx.fillRect(x1+boxW-6,y2-5,4,3);
    }

    if(gfxSettings.hudBoxes){
        ctx.strokeStyle=tierColor;ctx.lineWidth=hz.rFinal>=0.65?1.8:1.2;
        ctx.strokeRect(x1-2,y1-2,boxW+4,boxH+4);
        if(hz.z<34){
            const label=`${hz.cls.name} ${hz.z.toFixed(1)}m`,estW=label.length*5.8+8;
            ctx.fillStyle="rgba(9,11,16,0.88)";ctx.fillRect(bx-estW*0.5,y1-16,estW,12);
            ctx.fillStyle=tierColor;ctx.fillText(label,bx-estW*0.5+4,y1-6);
        }
    }
}

function renderSceneFrame(now){
    const W=gameState.viewW||window.innerWidth,H=gameState.viewH||window.innerHeight,theme=BIOME_THEMES[biomeIdx]||BIOME_THEMES[0];
    const isCosmic250=Boolean(theme.isEpoch250Special||gameState.epoch===250),horizonY=H*0.42;
    ensureCachedBiomeGradients(W,H,horizonY,theme);
    ctx.save();
    if(gameState.screenShake>0&&gfxSettings.shake)ctx.translate((Math.random()-0.5)*gameState.screenShake,(Math.random()-0.5)*gameState.screenShake);
    ctx.fillStyle=cachedGradients.sky;ctx.fillRect(0,0,W,H);
    const cosmicHue=(now*0.08)%360,dynamicWorldColor=isCosmic250?`hsl(${cosmicHue},95%,62%)`:theme.curb;
    const starBase=isMobileHardware?36:60,starCount=Math.min(gameState.stars.length,Math.floor(starBase*gfxSettings.particles));
    const streakLen=(gfxSettings.speedLines||isCosmic250||gameState.boosting)?5.5:1.5;
    for(let i=0;i<starCount;i++){
        const st=gameState.stars[i],sx=((st.x*W-gameState.distanceM*st.sp)%W+W)%W,sy=st.y*H;
        ctx.fillStyle=isCosmic250?st.col:(i%3===0?theme.curb:"#e2e8f0");
        ctx.fillRect(sx,sy,st.s*streakLen,st.s*0.95);
    }
    renderUniqueDimensionHorizon(W,H,horizonY,theme,now,dynamicWorldColor,cosmicHue);
    ctx.fillStyle=theme.roadDark;ctx.fillRect(0,horizonY,W,H-horizonY);
    const roadCurve=Math.sin(gameState.distanceM*0.012)*0.65,totalSlices=gfxSettings.roadSlices||(isMobileHardware?20:34),sliceStep=55.0/totalSlices;
    const voidHue=(now*0.14)%360,activeRailColor=activeLiveryProfile.isVoidChroma?`hsl(${voidHue},95%,60%)`:activeLiveryProfile.railColor;

    for(let i=totalSlices;i>=1;i--){
        const zNear=0.55+(i-1)*sliceStep,zFar=0.55+i*sliceStep;
        const yNear=projectY(zNear,0,H),yFar=i===totalSlices?horizonY:projectY(zFar,0,H);
        const xNearLeft=projectX(-2.6,zNear,W,H,roadCurve),xNearRight=projectX(2.6,zNear,W,H,roadCurve);
        const xFarLeft=projectX(-2.6,zFar,W,H,roadCurve),xFarRight=projectX(2.6,zFar,W,H,roadCurve);
        const isAlt=(Math.floor((gameState.distanceM+zNear)/3.2)&1)===0;
        ctx.fillStyle=isAlt?theme.roadLight:theme.roadDark;
        ctx.beginPath();ctx.moveTo(xFarLeft,yFar);ctx.lineTo(xFarRight,yFar);ctx.lineTo(xNearRight,yNear);ctx.lineTo(xNearLeft,yNear);ctx.closePath();ctx.fill();
        if(isAlt){ctx.strokeStyle=dynamicWorldColor;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xFarLeft,yFar);ctx.lineTo(xNearLeft,yNear);ctx.moveTo(xFarRight,yFar);ctx.lineTo(xNearRight,yNear);ctx.stroke();}
    }

    ctx.strokeStyle=`${dynamicWorldColor}88`;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,horizonY);ctx.lineTo(W,horizonY);ctx.stroke();
    ctx.strokeStyle=`${dynamicWorldColor}55`;ctx.lineWidth=1.2;ctx.beginPath();
    const divSteps=isMobileHardware?12:18,divStepM=48.0/divSteps;
    for(let l=0;l<4;l++){
        const divLane=-1.5+l;
        for(let s=0;s<divSteps;s+=2){
            const z1=0.65+s*divStepM,z2=z1+divStepM*0.75;
            ctx.moveTo(projectX(divLane,z1,W,H,roadCurve),projectY(z1,0,H));
            ctx.lineTo(projectX(divLane,z2,W,H,roadCurve),projectY(z2,0,H));
        }
    }
    ctx.stroke();

    const corridorSteps=isMobileHardware?12:18,corridorStepM=42.0/corridorSteps;
    ctx.fillStyle=`${activeRailColor}1f`;ctx.beginPath();
    for(let s=0;s<=corridorSteps;s++){const z=0.58+s*corridorStepM,xL=projectX(gameState.egoLaneX-0.46,z,W,H,roadCurve),y=projectY(z,0,H);if(s===0)ctx.moveTo(xL,y);else ctx.lineTo(xL,y);}
    for(let s=corridorSteps;s>=0;s--){const z=0.58+s*corridorStepM;ctx.lineTo(projectX(gameState.egoLaneX+0.46,z,W,H,roadCurve),projectY(z,0,H));}
    ctx.closePath();ctx.fill();

    for(let i=gameState.pickups.length-1;i>=0;i--){
        const pk=gameState.pickups[i],px=projectX(pk.lane,pk.z,W,H,roadCurve),py=projectY(pk.z,0.55,H),r=8.0;
        ctx.save();ctx.translate(px,py);ctx.rotate(pk.spin);
        ctx.fillStyle=pk.type==='nitro'?"#fbbf24":(pk.type==='emp'?"#38bdf8":"#10b981");
        ctx.strokeStyle="#ffffff";ctx.lineWidth=1.5;ctx.fillRect(-r,-r,r*2,r*2);ctx.strokeRect(-r,-r,r*2,r*2);
        ctx.restore();
    }

    gameState.hazards.sort((a,b)=>b.z-a.z);
    ctx.font="bold 10px 'JetBrains Mono',monospace";
    for(let i=0;i<gameState.hazards.length;i++)renderHighTextureDistinctHazard(gameState.hazards[i],Math.max(0.55,gameState.hazards[i].z),W,H,roadCurve,dynamicWorldColor,isCosmic250,cosmicHue);

    // Locked-Size Player Interceptor (Never Skews or Changes Breadth/Length Across Lanes!)
    const carCenterX=Math.round(projectX(gameState.egoLaneX,EGO_Z_CENTER,W,H,roadCurve));
    const rearY=Math.round(projectY(EGO_Z_REAR,0,H));
    const egoScale=Math.max(0.82,Math.min(1.15,Math.min(W,H)/450));
    const carHalfW=Math.round(36*egoScale),carH=Math.round(38*egoScale);
    const roofY=rearY-carH,frontY=rearY-Math.round(carH*0.72);
    const rearLeftX=carCenterX-carHalfW,rearRightX=carCenterX+carHalfW;
    const frontLeftX=carCenterX-Math.round(carHalfW*0.80),frontRightX=carCenterX+Math.round(carHalfW*0.80);
    const roofLeftX=carCenterX-Math.round(carHalfW*0.54),roofRightX=carCenterX+Math.round(carHalfW*0.54);

    ctx.fillStyle="rgba(0,0,0,0.65)";ctx.beginPath();ctx.ellipse(carCenterX,rearY+4,carHalfW*1.05,6,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#05070b";ctx.fillRect(rearLeftX-3,rearY-12,6,11);ctx.fillRect(rearRightX-3,rearY-12,6,11);

    const bodyGrad=ctx.createLinearGradient(carCenterX,roofY,carCenterX,rearY);
    bodyGrad.addColorStop(0,activeLiveryProfile.chassisTop||"#1e293b");bodyGrad.addColorStop(0.55,"#151c2c");bodyGrad.addColorStop(1,activeLiveryProfile.chassisBot||"#0b0f19");
    const borderGlowCol=gameState.boosting?"#fbbf24":activeRailColor;
    if(gfxSettings.bloom){ctx.shadowBlur=isMobileHardware?10:15;ctx.shadowColor=borderGlowCol;}
    ctx.fillStyle=bodyGrad;ctx.strokeStyle=borderGlowCol;ctx.lineWidth=2.4;
    ctx.beginPath();ctx.moveTo(rearLeftX,rearY);ctx.lineTo(frontLeftX,frontY);ctx.lineTo(roofLeftX,roofY);ctx.lineTo(roofRightX,roofY);ctx.lineTo(frontRightX,frontY);ctx.lineTo(rearRightX,rearY);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.shadowBlur=0;

    ctx.fillStyle=activeLiveryProfile.canopyColor;
    ctx.beginPath();ctx.moveTo(frontLeftX+6,frontY+1);ctx.lineTo(roofLeftX+3,roofY+2);ctx.lineTo(roofRightX-3,roofY+2);ctx.lineTo(frontRightX-6,frontY+1);ctx.closePath();ctx.fill();
    ctx.fillStyle="#06080f";ctx.fillRect(rearLeftX+3,rearY-10,(rearRightX-rearLeftX)-6,8);

    const thrusterCol=gameState.braking?"#ef4444":(gameState.boosting?"#fbbf24":(activeLiveryProfile.isVoidChroma?activeRailColor:activeLiveryProfile.thrusterColor));
    ctx.fillStyle=thrusterCol;
    const tWidth=Math.max(10,Math.round(carHalfW*0.38));
    ctx.fillRect(rearLeftX+5,rearY-9,tWidth,6);ctx.fillRect(rearRightX-tWidth-5,rearY-9,tWidth,6);ctx.fillRect(carCenterX-6,rearY-8,12,4);

    if(gameState.empWaveRadius>0){ctx.strokeStyle=activeRailColor;ctx.lineWidth=5;ctx.beginPath();ctx.arc(W*0.5,H*0.75,gameState.empWaveRadius,0,Math.PI*2);ctx.stroke();}

    if(theme.weather!=='none'&&gfxSettings.particles>0.05){
        const pCount=Math.floor((isMobileHardware?16:28)*gfxSettings.particles);
        for(let r=0;r<pCount;r++){
            const rx=((r*97+now*0.42)%W),ry=((r*61+now*1.05)%H);
            if(theme.weather==='rain'){ctx.strokeStyle="rgba(125,211,252,0.28)";ctx.beginPath();ctx.moveTo(rx,ry);ctx.lineTo(rx-6,ry+14);ctx.stroke();}
            else{ctx.fillStyle=theme.weather==='snow'?"rgba(241,245,249,0.65)":(theme.weather==='embers'?"rgba(251,146,60,0.65)":(theme.weather==='petals'?"rgba(244,114,182,0.65)":dynamicWorldColor));ctx.fillRect(rx,theme.weather==='embers'?H-ry:ry,2.5,2.5);}
        }
    }

    for(let i=0;i<gameState.FloatingTexts.length;i++){
        const ft=gameState.FloatingTexts[i];
        ctx.save();ctx.globalAlpha=Math.max(0,ft.life);ctx.font="800 13px 'JetBrains Mono',monospace";ctx.textAlign="center";ctx.fillStyle=ft.color;ctx.fillText(ft.text,ft.x,ft.y);ctx.restore();
    }
    ctx.restore();
}

function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

window.addEventListener('resize',resizeGameCanvas);
window.addEventListener('orientationchange',()=>{setTimeout(resizeGameCanvas,60);setTimeout(resizeGameCanvas,220);});
window.addEventListener('pageshow',()=>{resizeGameCanvas();setTimeout(resizeGameCanvas,120);resumeAudioForForeground();});
window.addEventListener('pagehide',()=>silenceAllAudioForBackground());
window.addEventListener('freeze',()=>silenceAllAudioForBackground());
window.addEventListener('blur',()=>{if(gameState.running&&!gameState.paused)openPauseSettingsModal('game');});
window.addEventListener('focus',()=>{resizeGameCanvas();setTimeout(resizeGameCanvas,120);resumeAudioForForeground();});
window.addEventListener('popstate',()=>{if(gameState.running&&!gameState.paused){openPauseSettingsModal('game');resizeGameCanvas();}});
document.addEventListener('visibilitychange',()=>{
    if(document.hidden){if(gameState.running&&!gameState.paused)openPauseSettingsModal('game');silenceAllAudioForBackground();}
    else{resizeGameCanvas();setTimeout(resizeGameCanvas,120);if(controlConfig.mobileMode==='tilt')needsSilentGyroCalib=true;resumeAudioForForeground();}
});

window.addEventListener('deviceorientation',(e)=>{
    if(e.beta===null&&e.gamma===null)return;
    const angle=(screen.orientation&&typeof screen.orientation.angle==='number')?screen.orientation.angle:(typeof window.orientation==='number'?window.orientation:0);
    let raw=(angle===90)?(e.beta||0):((angle===270||angle===-90)?-(e.beta||0):((window.innerHeight>window.innerWidth)?(e.beta||0):(e.gamma||0)));
    if(controlConfig.invertGyro)raw=-raw;
    lastRawLandscapeTilt=raw;hasGyroReading=true;
    if(needsSilentGyroCalib){controlConfig.tiltCenterOffset=raw;smoothedGyroDelta=0;needsSilentGyroCalib=false;}
    const rawDelta=raw-controlConfig.tiltCenterOffset,deadzoneDelta=Math.abs(rawDelta)<1.1?0:(rawDelta>0?rawDelta-1.1:rawDelta+1.1);
    smoothedGyroDelta+=(deadzoneDelta-smoothedGyroDelta)*0.42;
    if(controlConfig.mobileMode==='tilt'){const lbl=document.getElementById('gyroLiveAngleLabel');if(lbl)lbl.innerText=`${smoothedGyroDelta>0.2?'+':''}${smoothedGyroDelta.toFixed(1)}°`;}
    if(!gameState.running||gameState.paused||controlConfig.mobileMode!=='tilt')return;
    const maxTiltDeg=18.0-(controlConfig.gyroSensitivity*11.0);
    setMagneticTargetLane(Math.max(-2,Math.min(2,(smoothedGyroDelta/Math.max(4.5,maxTiltDeg))*2.25)));
});

canvas.addEventListener('pointerdown',(e)=>{
    if(isMobileHardware&&gameState.running&&!document.fullscreenElement)requestMobileFullscreenSafe();
    if(!gameState.running||gameState.paused)return;
    const now=performance.now();
    if(controlConfig.doubleTapNitro&&(now-controlConfig.lastTouchTime<260)){setBoosting(true);setTimeout(()=>setBoosting(false),1100);}
    controlConfig.lastTouchTime=now;
    if(controlConfig.mobileMode==='drag')handleCanvasTapLane(e);
});

window.addEventListener('keydown',(e)=>{
    ensureAudioEngine();const k=e.key.toLowerCase();
    if(awaitingRebindAction){e.preventDefault();if(k!=='escape')controlConfig.binds[awaitingRebindAction]=[k];awaitingRebindAction=null;refreshKeybindLabels();saveSettingsForActiveAccount();return;}
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
window.addEventListener('keyup',(e)=>{const k=e.key.toLowerCase();if(controlConfig.binds.nitro.includes(k))setBoosting(false);else if(controlConfig.binds.brake.includes(k))setBraking(false);});
if(lbChannel)lbChannel.onmessage=(ev)=>{if(ev.data&&ev.data.type==='lb_sync_v8')mergeRemoteLeaderboardPacket(ev.data);};

detectDeviceHardware();
buildVolumeSlidersUI();
buildKeybindGridUI();
buildGraphicsUI();
applyPilotProfile(localStorage.getItem('roadSense_overdrive_pilotId')||"GUEST");
resizeGameCanvas();
updateTopLeaderBanner();
renderMiniRadar();
pullGlobalCloudLeaderboard();
startLiveLeaderboardStream();
triggerBlankSpaceAutoClick();
window.addEventListener('DOMContentLoaded',triggerBlankSpaceAutoClick);
window.addEventListener('load',triggerBlankSpaceAutoClick);

let lastFrameTime=performance.now();
function mainLoop(now){
    const dt=Math.min(0.05,Math.max(0.001,(now-lastFrameTime)/1000));
    lastFrameTime=now;
    updateGamePhysics(dt,now);
    renderSceneFrame(now);
    requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);
