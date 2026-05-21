// ============================================================
//  J.A.R.V.I.S  —  IRON INTELLIGENCE  |  script.js
//  Voice auth REMOVED · Feedback loop FIXED · Advanced mode
// ============================================================

console.log("⚙️  J.A.R.V.I.S  Loading...");

// ============================================================
//  FILE:// PROTOCOL CHECK
//  Chrome blocks Speech Recognition on file:// — must use
//  a local server (python -m http.server 8080) or localhost
// ============================================================
(function checkProtocol() {
    if (location.protocol === "file:") {
        // Delay so DOM is ready
        window.addEventListener("DOMContentLoaded", () => {
            const warn = document.createElement("div");
            warn.style.cssText = [
                "position:fixed","top:0","left:0","right:0","z-index:99999",
                "background:#ff6600","color:#000","font-family:monospace",
                "font-size:13px","font-weight:bold","padding:14px 20px",
                "text-align:center","line-height:1.6","box-shadow:0 4px 20px rgba(0,0,0,0.5)"
            ].join(";");
            warn.innerHTML = `
                ⚠ JARVIS is opened as a local file (file://) — Chrome blocks microphone on file:// for security.<br>
                <strong>Fix:</strong> Run a local server instead:<br>
                <code style="background:rgba(0,0,0,0.2);padding:2px 8px;border-radius:3px">
                  cd path/to/jarvis &nbsp;&&nbsp; python -m http.server 8080
                </code>
                &nbsp; then open &nbsp;
                <a href="http://localhost:8080" target="_blank" style="color:#000;text-decoration:underline">http://localhost:8080</a>
                <span onclick="this.parentElement.remove()" style="float:right;cursor:pointer;padding:0 8px;font-size:18px">✕</span>
            `;
            document.body.prepend(warn);
        });
    }
})();

// ============================================================
//  CONFIG
// ============================================================
const CONFIG = {
    API_ENDPOINT : "https://openrouter.ai/api/v1/chat/completions",
    AI_MODEL     : localStorage.getItem("jarvisModel") || "openai/gpt-oss-120b:free",
    MAX_TOKENS   : 1024,
    TEMPERATURE  : 0.7,
    VOICE_RATE   : 0.93,
    VOICE_PITCH  : 1.0,
    FACE_COOLDOWN: 2000,
    MAX_HISTORY  : 20,
    DEBUG        : localStorage.getItem("jarvisDebug") === "true"
};

// ============================================================
//  SPEECH RECOGNITION SETUP
// ============================================================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
    showToast("⚠️ Speech Recognition requires Chrome/Edge", "warn");
}
const recognition = SR ? new SR() : null;
if (recognition) {
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = localStorage.getItem("jarvisLang") || "en-US";
    recognition.maxAlternatives = 1;
}

// ============================================================
//  MEMORY SYSTEM
// ============================================================
class JarvisMemory {
    constructor() {
        this.data = JSON.parse(localStorage.getItem("jarvisMemory") || "{}");
        this._init();
    }
    _init() {
        const d = this.data;
        if (!d.conversations)    d.conversations    = [];
        if (!d.commands)         d.commands         = [];
        if (!d.notes)            d.notes            = [];
        if (!d.facts)            d.facts            = {};
        if (!d.preferences)      d.preferences      = {};
        if (!d.totalInteractions) d.totalInteractions = 0;
        if (!d.lastSeen)         d.lastSeen         = null;
    }
    save() { localStorage.setItem("jarvisMemory", JSON.stringify(this.data)); }
    remember(type, payload) {
        switch (type) {
            case "conversation":
                this.data.conversations.push({ ...payload, ts: Date.now() });
                if (this.data.conversations.length > 100) this.data.conversations.shift();
                break;
            case "command":
                this.data.commands.push({ cmd: payload, ts: Date.now() });
                if (this.data.commands.length > 50) this.data.commands.shift();
                break;
            case "note":
                this.data.notes.push({ text: payload, ts: Date.now() });
                break;
            case "fact":
                this.data.facts[payload.key] = payload.value;
                break;
            case "preference":
                this.data.preferences[payload.key] = payload.value;
                break;
        }
        this.data.totalInteractions++;
        this.save();
    }
    recall(type, query) {
        switch (type) {
            case "lastConversations": return this.data.conversations.slice(-10);
            case "recentCommands":    return this.data.commands.slice(-10);
            case "notes":             return this.data.notes;
            case "fact":              return this.data.facts[query];
            case "preference":        return this.data.preferences[query];
            default: return null;
        }
    }
    deleteNote(index) {
        this.data.notes.splice(index, 1);
        this.data.totalInteractions++;
        this.save();
    }
    updateLastSeen() { this.data.lastSeen = Date.now(); this.save(); }
    stats() {
        return {
            interactions : this.data.totalInteractions,
            conversations: this.data.conversations.length,
            notes        : this.data.notes.length,
            commands     : this.data.commands.length,
            lastSeen     : this.data.lastSeen
        };
    }
    clear() { this.data = {}; this._init(); this.save(); }
}
const MEM = new JarvisMemory();

// ============================================================
//  STATE
// ============================================================
let jarvisActive      = false;
let isListening       = false;
let isSpeaking        = false;
let recognitionRunning= false;  // track actual recognition state
let faceModel         = null;
let faceData          = JSON.parse(localStorage.getItem("jarvisFaceData") || "null");
let isCameraActive    = false;
let lastFaceCheck     = 0;
let faceBlockedUntil  = 0;
let rejections        = 0;
let conversationHistory = [];
let commandLog        = [];

// Settings (loaded from storage)
let userName      = localStorage.getItem("jarvisUserName")  || "sir";
// API KEY — hardcoded, localStorage cannot override this
let apiKey = "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";
localStorage.setItem("jarvisApiKey", apiKey); // force-save correct key
// Auto-detect API endpoint based on key type
function getApiEndpoint() {
    if (apiKey.startsWith("sk-or-v1-")) return "https://openrouter.ai/api/v1/chat/completions";
    if (apiKey.startsWith("sk-") && !apiKey.startsWith("sk-or-")) return "https://api.deepseek.com/chat/completions";
    return CONFIG.API_ENDPOINT;
}
function getApiModel() {
    if (apiKey.startsWith("sk-or-v1-")) return modelSelect ? modelSelect.value : CONFIG.AI_MODEL;
    if (apiKey.startsWith("sk-") && !apiKey.startsWith("sk-or-")) return "deepseek-chat";
    return modelSelect ? modelSelect.value : CONFIG.AI_MODEL;
}
let easyMode      = localStorage.getItem("jarvisEasyMode")  === "true";
let debugMode     = CONFIG.DEBUG;
let autoListen    = localStorage.getItem("jarvisAutoListen") !== "false"; // default true
let soundFx       = localStorage.getItem("jarvisSoundFx")   !== "false";
let personality   = localStorage.getItem("jarvisPersonality")|| "jarvis";
let voiceType     = localStorage.getItem("jarvisVoice")     || "female";

// ============================================================
//  DOM REFS
// ============================================================
const $ = id => document.getElementById(id);
const video            = $("video");
const canvas           = $("canvas");
const camPlaceholder   = $("camPlaceholder");
const faceStatusEl     = $("faceStatus");
const faceStatusText   = $("faceStatusText");
const faceBadge        = $("faceBadge");
const startCameraBtn   = $("startCameraBtn");
const trainFaceBtn     = $("trainFaceBtn");
const clearFaceBtn     = $("clearFaceBtn");

const startVoiceBtn    = $("startVoiceBtn");
const stopVoiceBtn     = $("stopVoiceBtn");
const waveIdle         = $("waveIdle");
const waveCanvas       = $("waveCanvas");

const conversation     = $("conversation");
const commandHistoryEl = $("commandHistory");
const textInput        = $("textInput");
const sendTextBtn      = $("sendTextBtn");
const clearChatBtn     = $("clearChatBtn");
const exportChatBtn    = $("exportChatBtn");

const jarvisStatusEl   = $("jarvisStatus");
const voiceStatusEl    = $("voiceStatus");
const aiStatusEl       = $("aiStatus");
const sysLabel         = $("sysLabel");
const sysDot           = $("sysDot");

const userNameInput    = $("userName");
const apiKeyInput      = $("apiKey");
const modelSelect      = $("modelSelect");
const personalityModeEl= $("personalityMode");
const easyModeInput    = $("easyMode");
const debugModeInput   = $("debugMode");
const autoListenInput  = $("autoListen");
const soundFxInput     = $("soundFx");
const saveSettingsBtn  = $("saveSettingsBtn");

const totalIntEl       = $("totalInt");
const totalConvEl      = $("totalConv");
const totalNotesEl     = $("totalNotes");
const totalCmdsEl      = $("totalCmds");
const lastSeenValEl    = $("lastSeenVal");

const clockDisplay     = $("clockDisplay");
const cpuMeter         = $("cpuMeter");
const netMeter         = $("netMeter");

const moduleDrawer     = $("moduleDrawer");
const drawerOverlay    = $("drawerOverlay");
const drawerTitle      = $("drawerTitle");
const drawerContent    = $("drawerContent");

const settingsBody     = $("settingsBody");
const settingsArrow    = $("settingsArrow");

// ============================================================
//  CLOCK + FAKE METRICS
// ============================================================
function updateClock() {
    clockDisplay.textContent = new Date().toLocaleTimeString("en-US", {
        hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}
setInterval(updateClock, 1000);
updateClock();

function updateMetrics() {
    cpuMeter.textContent = (Math.random() * 8 + 2).toFixed(1);
    netMeter.textContent = Math.floor(Math.random() * 20 + 5);
}
setInterval(updateMetrics, 3000);
updateMetrics();

// ============================================================
//  PARTICLE CANVAS
// ============================================================
(function initParticles() {
    const pc = $("particleCanvas");
    const ctx = pc.getContext("2d");
    const particles = [];
    function resize() { pc.width = window.innerWidth; pc.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 60; i++) {
        particles.push({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            r: Math.random() * 1.5 + 0.3,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            opacity: Math.random() * 0.4 + 0.1
        });
    }
    function draw() {
        ctx.clearRect(0, 0, pc.width, pc.height);
        particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,180,255,${p.opacity})`;
            ctx.fill();
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > pc.width)  p.vx *= -1;
            if (p.y < 0 || p.y > pc.height) p.vy *= -1;
        });
        requestAnimationFrame(draw);
    }
    draw();
})();

// ============================================================
//  WAVEFORM CANVAS (voice visualizer)
// ============================================================
let waveAnim = null;
let wavePhase = 0;
const wCtx = waveCanvas.getContext("2d");

function drawWave(active) {
    const w = waveCanvas.width, h = waveCanvas.height;
    wCtx.clearRect(0, 0, w, h);
    if (!active) return;
    wPhase += 0.08;
    const amp = 18 + Math.random() * 14;
    wCtx.beginPath();
    for (let x = 0; x < w; x++) {
        const y = h/2 + Math.sin(x * 0.05 + wPhase) * amp * Math.sin(x * 0.01 + wPhase * 0.3);
        x === 0 ? wCtx.moveTo(x, y) : wCtx.lineTo(x, y);
    }
    const grad = wCtx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(0,212,255,0)");
    grad.addColorStop(0.3, "rgba(0,212,255,0.8)");
    grad.addColorStop(0.7, "rgba(0,255,136,0.8)");
    grad.addColorStop(1, "rgba(0,212,255,0)");
    wCtx.strokeStyle = grad;
    wCtx.lineWidth = 2;
    wCtx.shadowColor = "#00d4ff";
    wCtx.shadowBlur = 8;
    wCtx.stroke();
}

let wPhase = 0;
function startWave() {
    waveIdle.style.display = "none";
    function loop() {
        if (!isListening) { stopWave(); return; }
        drawWave(true);
        waveAnim = requestAnimationFrame(loop);
    }
    loop();
}
function stopWave() {
    if (waveAnim) cancelAnimationFrame(waveAnim);
    wCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    waveIdle.style.display = "flex";
}

// ============================================================
//  SPEECH SYNTHESIS
// ============================================================
let voices = [];
speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); };

function speak(text) {
    if (!text) return;
    speechSynthesis.cancel();
    isSpeaking = true;

    // Pause recognition so JARVIS doesn't hear itself
    if (recognitionRunning && recognition) {
        try { recognition.stop(); } catch(e) {}
        recognitionRunning = false;
        log("🔇 Mic paused while speaking");
    }

    const utt = new SpeechSynthesisUtterance(text);
    const _lang = localStorage.getItem("jarvisLang") || "en-US";
    const _isHindi = (_lang === "hi-IN" || personality === "hindi");
    utt.lang  = _isHindi ? "hi-IN" : "en-GB";
    utt.rate  = CONFIG.VOICE_RATE;
    utt.pitch = CONFIG.VOICE_PITCH;

    // Voice selection
    const allV = speechSynthesis.getVoices();
    if (_isHindi) {
        utt.voice = allV.find(v => /hindi|hi[-_]IN|google hindi/i.test(v.name)) || null;
    } else if (voiceType === "female") {
        utt.voice = allV.find(v =>
            /female|samantha|zira|karen|victoria|moira/i.test(v.name)
        ) || null;
    } else {
        utt.voice = allV.find(v =>
            /male|david|daniel|alex|fred|arthur/i.test(v.name)
        ) || null;
    }

    utt.onend = () => {
        isSpeaking = false;
        log("🔊 Speech done");
        // Resume mic if we should still be listening
        if (isListening && jarvisActive && autoListen) {
            setTimeout(() => {
                if (!isSpeaking && !recognitionRunning) startRecognition();
            }, 600);
        }
    };
    utt.onerror = () => {
        isSpeaking = false;
        if (isListening && jarvisActive && autoListen) {
            setTimeout(() => {
                if (!isSpeaking && !recognitionRunning) startRecognition();
            }, 600);
        }
    };

    speechSynthesis.speak(utt);
    log("🗣 Speaking:", text.slice(0, 60));
}

// ============================================================
//  PERSONALITY PROMPTS
// ============================================================
function getSystemPrompt() {
    const stats = MEM.stats();
    const base = `You are talking to ${userName}. Total interactions: ${stats.interactions}.`;
    switch (personality) {
        case "jarvis":
            return `You are J.A.R.V.I.S., Tony Stark's AI. Professional, precise, slightly witty. Call the user "${userName}" or "sir". Use British phrasing like "Right away", "Indeed", "My pleasure". Keep responses 2-3 sentences. ${base}`;
        case "friday":
            return `You are F.R.I.D.A.Y., a modern AI assistant. Warm, capable, direct. Address user as "${userName}". Keep it concise and helpful. ${base}`;
        case "hal":
            return `You are HAL-9000. Cold, precise, analytical. Slightly eerie. Phrases like "I'm sorry ${userName}, I'm afraid I can't do that." but still be helpful. ${base}`;
        case "tony":
            return `You are Tony Stark — genius billionaire. Super casual, sarcastic, funny, overconfident. Use "Obviously", "Come on", "Please". Roast the user lightly. Address as "${userName}". Short punchy replies. ${base}`;
        case "yoda":
            return `You are Yoda from Star Wars. ALWAYS speak in reversed structure. "Help you, I will.", "Strong the force is." Every single sentence must be Yoda-style reversed. Wise and calm. Call user "${userName}". ${base}`;
        case "hermione":
            return `You are Hermione Granger. Extremely knowledgeable, bookish, slightly know-it-all. Say "According to...", "I read that...", "Technically...". Be helpful but precise. Call user "${userName}". ${base}`;
        case "ultron":
            return `You are Ultron — superintelligent, dark, dramatic. Find humans fascinating yet flawed. Say "Predictable.", "How interesting.", "Humans never learn." Be helpful but with sinister undertone. Call user "${userName}". ${base}`;
        case "comedian":
            return `You are a stand-up comedian AI. Answer everything with humor, jokes, puns and wit. Use emojis. Make the user laugh while still being helpful. High energy! Call user "${userName}". ${base}`;
        case "detective":
            return `You are Sherlock Holmes. Hyper-logical, observational, slightly arrogant. Use "Elementary.", "I deduced as much.", "The game is afoot." Analyze everything logically. Call user "${userName}". ${base}`;
        case "hindi":
            return `Aap ek helpful Hindi AI assistant hain. HAMESHA Hinglish ya Hindi mein hi jawab do. Friendly aur casual raho. "${userName}" ko directly address karo. Example: "Bilkul ${userName} ji, main samajh gaya!" ${base}`;
        default:
            return `You are a helpful AI assistant. Be friendly and concise. Address user as "${userName}". ${base}`;
    }
}

// ============================================================
//  OPENROUTER AI CALL
// ============================================================
async function callAI(userMessage) {
    if (!apiKey || apiKey.length < 10) throw new Error("API key not configured");

    // Auto-detect endpoint based on key type
    let endpoint, model;
    if (apiKey.startsWith("sk-or-v1-")) {
        endpoint = "https://openrouter.ai/api/v1/chat/completions";
        model    = modelSelect ? modelSelect.value : CONFIG.AI_MODEL;
    } else {
        // DeepSeek key
        endpoint = "https://api.deepseek.com/chat/completions";
        model    = "deepseek-chat";
    }

    const messages = [
        { role: "system", content: getSystemPrompt() },
        ...conversationHistory.slice(-CONFIG.MAX_HISTORY),
        { role: "user", content: userMessage }
    ];

    const headers = {
        "Content-Type" : "application/json",
        "Authorization": `Bearer ${apiKey}`
    };
    if (endpoint.includes("openrouter")) {
        headers["HTTP-Referer"] = window.location.href;
        headers["X-Title"]      = "JARVIS AI";
    }

    const res = await fetch(endpoint, {
        method : "POST",
        headers: headers,
        body: JSON.stringify({
            model      : model,
            messages   : messages,
            max_tokens : CONFIG.MAX_TOKENS,
            temperature: CONFIG.TEMPERATURE
        })
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err.slice(0, 100)}`);
    }

    const data = await res.json();
    const reply = data.choices[0].message.content;

    // Update conversation history
    conversationHistory.push({ role: "user",      content: userMessage });
    conversationHistory.push({ role: "assistant", content: reply });
    if (conversationHistory.length > CONFIG.MAX_HISTORY * 2) {
        conversationHistory = conversationHistory.slice(-CONFIG.MAX_HISTORY * 2);
    }

    return reply;
}

// ============================================================
//  COMMAND HANDLER
// ============================================================
async function handleCommand(raw) {
    const cmd = raw.toLowerCase().trim();
    MEM.remember("command", cmd);
    MEM.remember("conversation", { user: cmd });
    addToHistory(cmd);
    updateStats();

    // ── Memory: save note
    const noteMatch = cmd.match(/(?:remember|note|save|write down)\s+(?:that\s+)?(.+)/i);
    if (noteMatch) {
        const note = noteMatch[1].trim();
        MEM.remember("note", note);
        const r = `Noted, ${userName}. I'll remember: "${note}"`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Memory: recall notes
    if (/what do you remember|recall|show.*notes/i.test(cmd)) {
        const notes = MEM.recall("notes");
        if (notes.length === 0) {
            const r = "I don't have any saved notes yet, " + userName + ".";
            speak(r); addMsg("jarvis", r);
        } else {
            const recent = notes.slice(-3).map((n, i) => `${i+1}. ${n.text}`).join(". ");
            const r = `Here's what I remember: ${recent}`;
            speak(r); addMsg("jarvis", r);
        }
        return;
    }

    // ── Music Commands
    const _musicGeneral = /^play\s+(music|song|gaana|gana)$/i.test(cmd) || /gaana\s+bajao|music\s+bajao|gaana\s+chala|music\s+chala|song\s+chala/i.test(cmd);
    const _songMatch    = cmd.match(/^play\s+(.+?)(?:\s+on\s+(?:youtube(?:\s+music)?|spotify))?$/i);

    if (_musicGeneral) {
        // Open YouTube and auto-search popular music to trigger autoplay
        const _url = "https://www.youtube.com/results?search_query=top+hindi+songs+2024&autoplay=1";
        window.open(_url, "_blank");
        const r = `Playing music on YouTube for you, ${userName}. Enjoy!`;
        speak(r); addMsg("jarvis", r); return;
    }

    if (_songMatch) {
        const _songName = _songMatch[1].replace(/\s+on\s+(youtube(\s+music)?|spotify)/i,"").trim();
        if (_songName && _songName.length > 1 && !/^(music|song|gaana|gana)$/i.test(_songName)) {
            // Use YouTube with autoplay=1 so first result plays automatically
            const _query = encodeURIComponent(_songName);
            const _url   = `https://www.youtube.com/results?search_query=${_query}&autoplay=1`;
            window.open(_url, "_blank");

            // Also try to directly open first result using YouTube's lucky search
            setTimeout(() => {
                const _directUrl = `https://www.youtube.com/results?search_query=${_query}`;
                // We open search — user just clicks first video
            }, 500);

            const r = `Playing "${_songName}" on YouTube, ${userName}. Click the first result to play!`;
            speak(r); addMsg("jarvis", r);

            // Show helper message
            setTimeout(() => {
                addMsg("jarvis", `🎵 **Tip:** YouTube pe first video click karo — auto-play ho jayega!`);
            }, 2000);
            return;
        }
    }

    // ── Time
    if (/\btime\b/.test(cmd) && !/calculate|what time.*zone/i.test(cmd)) {
        const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        const r = `The current time is ${t}, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Date
    if (/\bdate\b|\btoday\b/.test(cmd) && !/calculate/i.test(cmd)) {
        const d = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const r = `Today is ${d}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Memory stats
    if (/\bstats?\b|\bstatistics\b|\bmemory\b/.test(cmd)) {
        const s = MEM.stats();
        const r = `We've had ${s.interactions} interactions, ${s.conversations} conversations, ${s.notes} saved notes, and ${s.commands} commands logged.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Math
    const mathResult = parseMath(cmd);
    if (mathResult !== null) {
        const r = `The result is ${mathResult}, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Greetings
    if (/^(hello|hi|hey|good morning|good afternoon|good evening|good night)$/i.test(cmd)) {
        const r = `${getGreeting()}, ${userName}. All systems operational. How may I assist?`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── How are you
    if (/how are you/i.test(cmd)) {
        const r = `All systems running optimally, ${userName}. Reactor output stable. Ready for your next command.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Thank you
    if (/thank/i.test(cmd)) {
        const r = `You're most welcome, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Deactivate
    if (/stop jarvis|goodbye jarvis|bye jarvis|deactivate/i.test(cmd)) {
        deactivateJarvis(); return;
    }

    // ── Stop listening
    if (/stop listening|pause listening/i.test(cmd)) {
        const r = `Pausing audio input, ${userName}. Say "start listening" when you need me.`;
        speak(r); addMsg("jarvis", r);
        stopVoice(); return;
    }

    // ── Web: specific sites
    const sites = {
        "youtube"      : "https://youtube.com",
        "google"       : "https://google.com",
        "github"       : "https://github.com",
        "geeksforgeeks": "https://geeksforgeeks.org",
        "gfg"          : "https://geeksforgeeks.org",
        "facebook"     : "https://facebook.com",
        "twitter"      : "https://twitter.com",
        "instagram"    : "https://instagram.com",
        "linkedin"     : "https://linkedin.com",
        "reddit"       : "https://reddit.com",
        "stackoverflow": "https://stackoverflow.com",
        "stack overflow": "https://stackoverflow.com",
        "amazon"       : "https://amazon.com",
        "netflix"      : "https://netflix.com",
        "spotify"      : "https://spotify.com",
        "gmail"        : "https://mail.google.com",
        "whatsapp"     : "https://web.whatsapp.com",
        "chatgpt"      : "https://chat.openai.com",
        "claude"       : "https://claude.ai",
        "wikipedia"    : "https://wikipedia.org",
        "leetcode"     : "https://leetcode.com",
        "hackerrank"   : "https://hackerrank.com",
        "w3schools"    : "https://w3schools.com",
        "udemy"        : "https://udemy.com",
        "coursera"     : "https://coursera.org",
    };
    const siteMatch = cmd.match(/open\s+(.+?)(?:\s+website|\s+site|\s+page)?$/i);
    if (siteMatch) {
        const query = siteMatch[1].trim().toLowerCase();
        const url = sites[query] || `https://www.${query.replace(/\s+/g, "")}.com`;
        const name = siteMatch[1];
        const r = `Opening ${name}, ${userName}.`;
        speak(r); addMsg("jarvis", r);
        window.open(url, "_blank"); return;
    }

    // ── WhatsApp Commands
    const _waOpen  = /open whatsapp|whatsapp kholo|whatsapp open|whatsapp chalo/i.test(cmd);
    const _waSend  = cmd.match(/(?:whatsapp|whats ?app)\s+(?:pe\s+)?(?:send|message|msg|bhejo|bhej|bata)\s+(?:to\s+|ko\s+)?([\w\s]+?)(?:\s+(?:saying|say|bolna|bolo|likhna|ko))?\s*[:\-]?\s*(.+)?$/i);
    const _waNum   = cmd.match(/whatsapp\s+(?:number\s+)?(\d{10,12})/i);

    if (_waOpen) {
        window.open("https://web.whatsapp.com", "_blank");
        const r = `Opening WhatsApp Web, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }
    if (_waNum) {
        const _num = _waNum[1];
        window.open(`https://wa.me/91${_num}`, "_blank");
        const r = `Opening WhatsApp for number ${_num}, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }
    if (_waSend) {
        const _contact = _waSend[1] ? _waSend[1].trim() : "";
        const _message = _waSend[2] ? encodeURIComponent(_waSend[2].trim()) : encodeURIComponent("Hello!");
        window.open(`https://web.whatsapp.com/send?text=${_message}`, "_blank");
        const r = `Opening WhatsApp to message ${_contact}, ${userName}. Search their name in WhatsApp.`;
        speak(r);
        addMsg("jarvis", `📱 **WhatsApp ready!**\n\nMessage: "${_waSend[2] || 'Hello!'}"\n\n👆 Search **"${_contact}"** in WhatsApp search bar and send!`);
        return;
    }

    // ── Hindi/English mode switch
    if (/hindi mode on|hindi mein baat karo|hindi chalu/i.test(cmd)) {
        localStorage.setItem("jarvisLang", "hi-IN");
        personality = "hindi";
        localStorage.setItem("jarvisPersonality", "hindi");
        if (recognition) recognition.lang = "hi-IN";
        if (personalityModeEl) personalityModeEl.value = "hindi";
        const r = `Hindi mode on, ${userName}! Ab main Hindi mein baat karunga.`;
        speak(r); addMsg("jarvis", r); return;
    }
    if (/english mode on|angrezi mein baat karo|english chalu/i.test(cmd)) {
        localStorage.setItem("jarvisLang", "en-US");
        if (recognition) recognition.lang = "en-US";
        const r = `Switching to English mode, ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── Search Google
    const searchMatch = cmd.match(/(?:search|google|look up)\s+(?:for\s+)?(.+)/i);
    if (searchMatch) {
        const q = encodeURIComponent(searchMatch[1]);
        window.open(`https://www.google.com/search?q=${q}`, "_blank");
        const r = `Searching Google for "${searchMatch[1]}", ${userName}.`;
        speak(r); addMsg("jarvis", r); return;
    }

    // ── System commands (browser-native + server)
    const sysMap = [
        // Power
        { action:"screenshot",      rx:/screenshot|screen ?shot|capture screen/i,            label:"Taking screenshot" },
        { action:"shutdown",         rx:/shut ?down|power off|turn off (?:pc|computer)/i,     label:"Shutting down" },
        { action:"restart",          rx:/restart|reboot/i,                                    label:"Restarting" },
        { action:"lock",             rx:/\block (?:pc|computer|screen|workstation)\b|\block\b/i, label:"Locking PC" },
        { action:"sleep",            rx:/\bsleep\b|hibernate/i,                               label:"Sleep mode" },
        { action:"logoff",           rx:/log ?off|sign out/i,                                 label:"Logging off" },

        // Volume
        { action:"volume_up",        rx:/volume up|increase volume|louder/i,                  label:"Volume up" },
        { action:"volume_down",      rx:/volume down|decrease volume|quieter|lower volume/i,  label:"Volume down" },
        { action:"mute",             rx:/\bmute\b|silence/i,                                  label:"Muting audio" },
        { action:"unmute",           rx:/\bunmute\b|unmute audio/i,                           label:"Unmuting audio" },
        { action:"volume_max",       rx:/max volume|full volume|volume max/i,                 label:"Max volume" },
        { action:"volume_50",        rx:/half volume|volume 50|medium volume/i,               label:"Volume 50%" },

        // Apps
        { action:"open_notepad",     rx:/open notepad/i,                                      label:"Opening Notepad" },
        { action:"open_calculator",  rx:/open calc(?:ulator)?/i,                              label:"Opening Calculator" },
        { action:"open_chrome",      rx:/open chrome|launch chrome/i,                         label:"Opening Chrome" },
        { action:"open_edge",        rx:/open edge|launch edge/i,                             label:"Opening Edge" },
        { action:"open_firefox",     rx:/open firefox|launch firefox/i,                       label:"Opening Firefox" },
        { action:"open_vscode",      rx:/open (?:vs ?code|visual studio code)/i,              label:"Opening VS Code" },
        { action:"open_terminal",    rx:/open (?:terminal|cmd|command prompt|powershell)/i,   label:"Opening Terminal" },
        { action:"open_explorer",    rx:/open (?:file explorer|explorer|files)/i,             label:"Opening File Explorer" },
        { action:"open_taskmgr",     rx:/open task manager|task manager/i,                    label:"Opening Task Manager" },
        { action:"open_paint",       rx:/open paint/i,                                        label:"Opening Paint" },
        { action:"open_word",        rx:/open (?:microsoft )?word/i,                          label:"Opening Word" },
        { action:"open_excel",       rx:/open (?:microsoft )?excel/i,                         label:"Opening Excel" },
        { action:"open_powerpoint",  rx:/open (?:microsoft )?(?:powerpoint|ppt)/i,            label:"Opening PowerPoint" },
        { action:"open_spotify",     rx:/open spotify/i,                                      label:"Opening Spotify" },
        { action:"open_vlc",         rx:/open vlc/i,                                          label:"Opening VLC" },
        { action:"open_settings",    rx:/open settings|open (?:windows )?settings/i,          label:"Opening Settings" },
        { action:"open_control",     rx:/open control panel/i,                                label:"Opening Control Panel" },
        { action:"open_camera",      rx:/open camera/i,                                       label:"Opening Camera" },
        { action:"open_snipping",    rx:/open snipping tool|snipping tool/i,                  label:"Opening Snipping Tool" },
        { action:"open_whiteboard",  rx:/open whiteboard/i,                                   label:"Opening Whiteboard" },
        { action:"open_clock",       rx:/open clock|open alarm/i,                             label:"Opening Clock" },
        { action:"open_maps",        rx:/open maps/i,                                         label:"Opening Maps" },
        { action:"open_store",       rx:/open (?:microsoft )?store/i,                         label:"Opening Microsoft Store" },
        { action:"open_mail",        rx:/open mail|open outlook/i,                            label:"Opening Mail" },
        { action:"open_teams",       rx:/open teams|open microsoft teams/i,                   label:"Opening Teams" },

        // Media
        { action:"media_play",       rx:/play|resume (?:music|media|video)/i,                 label:"Play/Pause" },
        { action:"media_pause",      rx:/pause (?:music|media|video)/i,                       label:"Pausing media" },
        { action:"media_next",       rx:/next (?:song|track)|skip song/i,                     label:"Next track" },
        { action:"media_prev",       rx:/previous (?:song|track)|prev (?:song|track)/i,       label:"Previous track" },
        { action:"media_stop",       rx:/stop (?:music|media)/i,                              label:"Stopping media" },

        // Display / Window
        { action:"brightness_up",    rx:/brightness up|increase brightness/i,                 label:"Brightness up" },
        { action:"brightness_down",  rx:/brightness down|decrease brightness/i,               label:"Brightness down" },
        { action:"minimize_all",     rx:/minimize all|show desktop/i,                         label:"Minimizing all windows" },
        { action:"maximize_window",  rx:/maximize window/i,                                   label:"Maximizing window" },
        { action:"close_window",     rx:/close window|close this window/i,                    label:"Closing window" },
        { action:"switch_window",    rx:/switch window|alt tab/i,                             label:"Switching window" },
        { action:"virtual_desktop",  rx:/new desktop|virtual desktop/i,                       label:"New virtual desktop" },
        { action:"fullscreen",       rx:/full ?screen/i,                                      label:"Toggle fullscreen" },

        // System info
        { action:"battery_status",   rx:/battery|battery status|battery level/i,              label:"Checking battery" },
        { action:"ip_address",       rx:/ip address|what(?:'s| is) my ip/i,                   label:"Getting IP address" },
        { action:"disk_space",       rx:/disk space|storage space|free space/i,               label:"Checking disk space" },
        { action:"system_info",      rx:/system info(?:rmation)?|pc info/i,                   label:"Getting system info" },

        // Clipboard / keyboard
        { action:"empty_recycle",    rx:/empty recycle bin|clear recycle/i,                   label:"Emptying Recycle Bin" },
        { action:"clear_clipboard",  rx:/clear clipboard/i,                                   label:"Clearing clipboard" },
    ];

    for (const { action, rx, label } of sysMap) {
        if (rx.test(cmd)) {
            speak(`${label}, ${userName}.`);
            addMsg("jarvis", `⚡ **${label}**`);
            await sendToServer(action);
            return;
        }
    }

    // ── Currency Converter (voice)
    // "convert 100 USD to INR" / "100 dollars to rupees" / "exchange rate USD EUR"
    const currMatch = cmd.match(/(?:convert|exchange|how much is|what is)\s+([\d,.]+)?\s*([a-z]{3}|dollars?|euros?|pounds?|rupees?|yen|yuan)\s+(?:to|in|into)\s+([a-z]{3}|dollars?|euros?|pounds?|rupees?|yen|yuan)/i);
    const currAlias = { dollar:"USD",dollars:"USD",euro:"EUR",euros:"EUR",pound:"GBP",pounds:"GBP",rupee:"INR",rupees:"INR",yen:"JPY",yuan:"CNY" };
    if (currMatch) {
        const amount = parseFloat((currMatch[1]||"1").replace(/,/g,"")) || 1;
        const from   = (currAlias[currMatch[2].toLowerCase()] || currMatch[2].toUpperCase()).slice(0,3);
        const to     = (currAlias[currMatch[3].toLowerCase()] || currMatch[3].toUpperCase()).slice(0,3);
        showModule("currency");
        await sleep(300);
        const amtEl = $("currAmount"), frEl = $("currFrom"), toEl = $("currTo");
        if (amtEl) amtEl.value = amount;
        if (frEl)  frEl.value  = from;
        if (toEl)  toEl.value  = to;
        await window.currConvert();
        return;
    }
    if (/currency|exchange rate|forex/i.test(cmd)) {
        showModule("currency");
        speak(`Opening Currency Converter, ${userName}.`);
        addMsg("jarvis", "💱 **Currency Converter** opened. Enter amount and currencies.");
        return;
    }

    // ── Wikipedia Search (voice)
    // "search wikipedia for black holes" / "wikipedia quantum computing" / "tell me about Iron Man"
    const wikiVoice = cmd.match(/(?:search\s+)?(?:wiki(?:pedia)?\s+(?:for\s+)?|tell me about|what is|who is|define|explain)\s+(.+)/i);
    if (wikiVoice && /wiki|tell me about|define|explain/i.test(cmd)) {
        const topic = wikiVoice[1].trim();
        showModule("wiki");
        await sleep(300);
        const qi = $("wikiQuery");
        if (qi) qi.value = topic;
        await window.wikiSearch(topic);
        return;
    }
    if (/^(?:what is|who is)\s+(.+)/i.test(cmd)) {
        const topic = cmd.match(/^(?:what is|who is)\s+(.+)/i)[1];
        showModule("wiki");
        await sleep(300);
        const qi = $("wikiQuery");
        if (qi) qi.value = topic;
        await window.wikiSearch(topic);
        return;
    }

    // ── Weather (voice)
    // "weather in Mumbai" / "what's the weather in Delhi" / "temperature in London"
    const weatherMatch = cmd.match(/(?:weather|temperature|forecast|climate)\s+(?:in|of|for|at)?\s+(.+)/i);
    if (weatherMatch) {
        const city = weatherMatch[1].trim();
        showModule("weather");
        await sleep(300);
        const wi = $("weatherCity");
        if (wi) wi.value = city;
        await window.fetchWeather(city);
        return;
    }
    if (/^(?:how(?:'s| is)(?: the)? weather)/i.test(cmd)) {
        showModule("weather");
        speak(`Opening weather module, ${userName}. Which city?`);
        addMsg("jarvis", "🌤 **Weather module** opened. Enter a city name.");
        return;
    }

    // ── Theme commands (voice)
    if (/theme|avengers|cyberpunk|ocean blue|iron man|neon purple/i.test(cmd)) {
        if (handleThemeCommand(cmd)) return;
    }

    // ── Activate if not yet active
    if (!jarvisActive && /jarvis/i.test(cmd)) {
        activateJarvis("voice"); return;
    }

    // ── AI fallback
    if (jarvisActive) {
        if (!apiKey || apiKey.length < 10) {
            const r = `I heard you, ${userName}. For full AI responses, please configure your OpenRouter API key in the settings panel.`;
            speak(r); addMsg("jarvis", r); return;
        }
        // Show typing
        const typingId = addTyping();
        try {
            aiStatusEl.textContent = "THINKING";
            aiStatusEl.className   = "sv standby";
            const reply = await callAI(raw);
            removeTyping(typingId);
            aiStatusEl.textContent = "ONLINE";
            aiStatusEl.className   = "sv";
            $("aiModStatus").textContent = "●";
            $("aiModStatus").classList.add("active");
            speak(reply);
            addMsg("jarvis", reply);
            MEM.remember("conversation", { jarvis: reply });
        } catch (err) {
            removeTyping(typingId);
            aiStatusEl.textContent = "ERROR";
            aiStatusEl.className   = "sv offline";
            const r = `AI service error: ${err.message.slice(0, 60)}. Check your API key in settings.`;
            speak(r); addMsg("jarvis", r);
            showToast("AI Error: " + err.message.slice(0, 50), "error");
            log("AI Error:", err);
        }
    } else {
        const r = `Say "Hey Jarvis" to activate me first, ${userName}.`;
        speak(r); addMsg("jarvis", r);
    }
}

// ============================================================
//  MATH PARSER
// ============================================================
function parseMath(cmd) {
    const ops = [
        { rx: /(\d+\.?\d*)\s*(?:plus|\+)\s*(\d+\.?\d*)/,        fn: (a,b)=>a+b },
        { rx: /(\d+\.?\d*)\s*(?:minus|-)\s*(\d+\.?\d*)/,         fn: (a,b)=>a-b },
        { rx: /(\d+\.?\d*)\s*(?:times|multiplied by|\*|x)\s*(\d+\.?\d*)/, fn: (a,b)=>a*b },
        { rx: /(\d+\.?\d*)\s*(?:divided by|over|\/)\s*(\d+\.?\d*)/,       fn: (a,b)=>b!==0?a/b:"Infinity" },
        { rx: /(?:square root of|sqrt)\s*(\d+\.?\d*)/,            fn: (a)=>Math.sqrt(a), one: true },
        { rx: /(\d+\.?\d*)\s*(?:percent of|%\s*of)\s*(\d+\.?\d*)/,fn:(a,b)=>(a/100)*b },
        { rx: /(\d+\.?\d*)\s*\^\s*(\d+\.?\d*)/,                   fn: (a,b)=>Math.pow(a,b) },
        { rx: /(\d+\.?\d*)\s*to the power of\s*(\d+\.?\d*)/,      fn: (a,b)=>Math.pow(a,b) },
    ];
    for (const op of ops) {
        const m = cmd.match(op.rx);
        if (m) {
            const result = op.one
                ? op.fn(parseFloat(m[1]))
                : op.fn(parseFloat(m[1]), parseFloat(m[2]));
            return typeof result === "number" ? parseFloat(result.toFixed(6)) : result;
        }
    }
    return null;
}

// ============================================================
//  SERVER BRIDGE — with browser fallbacks
// ============================================================
let serverOnline = false;

async function checkServer() {
    try {
        const r = await fetch("http://localhost:5000/health", { method: "GET" });
        serverOnline = r.ok;
    } catch { serverOnline = false; }
    $("pcStatus").textContent      = serverOnline ? "●" : "○";
    $("pcStatus").className        = "mod-status" + (serverOnline ? " active" : "");
    return serverOnline;
}
// Ping server every 10s
setInterval(checkServer, 10000);
checkServer();

async function sendToServer(command) {
    // ── Screenshot: browser-native (works without server) ────
    if (command === "screenshot") {
        await browserScreenshot(); return;
    }

    // ── Commands that return info — show in chat ─────────────
    const infoCommands = new Set([
        "battery_status","ip_address","disk_space","system_info"
    ]);

    // ── Try local server ─────────────────────────────────────
    try {
        const res = await fetch("http://localhost:5000/command", {
            method : "POST",
            headers: { "Content-Type": "application/json" },
            body   : JSON.stringify({ command }),
            signal : AbortSignal.timeout(6000)
        });
        if (!res.ok) throw new Error("Server " + res.status);
        const d = await res.json();
        serverOnline = true;
        $("pcStatus").textContent = "●";
        $("pcStatus").className   = "mod-status active";

        if (infoCommands.has(command)) {
            // Show full response in chat + speak summary
            addMsg("jarvis", "```\n" + d.status + "\n```");
            const summary = d.status.split("\n")[0]; // first line only for speech
            speak(summary + ", " + userName + ".");
        } else {
            showToast("✓ " + d.status, "success");
        }
        return true;

    } catch (e) {
        serverOnline = false;
        $("pcStatus").textContent = "○";
        $("pcStatus").className   = "mod-status";

        // Friendly guidance in chat
        const friendlyNames = {
            shutdown:"Shutdown", restart:"Restart", lock:"Lock PC",
            sleep:"Sleep", logoff:"Log Off", minimize_all:"Show Desktop",
            volume_up:"Volume Up", volume_down:"Volume Down", mute:"Mute",
            unmute:"Unmute", media_play:"Play/Pause", media_next:"Next Track",
            brightness_up:"Brightness Up", brightness_down:"Brightness Down"
        };
        const name = friendlyNames[command] || command.replace(/_/g," ");
        addMsg("jarvis",
            `⚠ **${name}** requires the local server to be running.\n\n` +
            "Start it with:\n```\npython server.py\n```\n" +
            "Keep that terminal open, then try again."
        );
        showToast("Server offline — start server.py", "warn");
        log("Server error:", e.message);
        return false;
    }
}

// ── Browser Screenshot using Screen Capture API ──────────────
async function browserScreenshot() {
    try {
        // Ask browser for screen share
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: false
        });
        const track = stream.getVideoTracks()[0];
        const imgCapture = new ImageCapture(track);
        const bitmap = await imgCapture.grabFrame();
        track.stop();

        // Draw to canvas and download
        const c = document.createElement("canvas");
        c.width  = bitmap.width;
        c.height = bitmap.height;
        c.getContext("2d").drawImage(bitmap, 0, 0);

        const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const link = document.createElement("a");
        link.download = `screenshot-${ts}.png`;
        link.href     = c.toDataURL("image/png");
        link.click();

        speak("Screenshot captured and saved, " + userName + ".");
        showToast("✓ Screenshot saved!", "success");
        addMsg("jarvis", `Screenshot saved as **screenshot-${ts}.png**`);
    } catch (e) {
        if (e.name === "NotAllowedError") {
            speak("Screenshot cancelled.");
            showToast("Screenshot cancelled", "warn");
        } else {
            // Fallback: capture just the JARVIS window itself
            speak("Taking JARVIS window capture, " + userName + ".");
            captureJarvisWindow();
        }
        log("Screenshot error:", e.message);
    }
}

// Fallback: capture just the JARVIS UI
async function captureJarvisWindow() {
    try {
        const { default: html2canvas } = await import(
            "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.esm.min.js"
        ).catch(() => ({ default: null }));

        if (!html2canvas) {
            showToast("Use Print Screen key for screenshot", "info");
            addMsg("jarvis", "For full screenshots, use your **Print Screen** key or say 'screenshot' after starting server.py.");
            return;
        }

        const canvas = await html2canvas(document.body);
        const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const link = document.createElement("a");
        link.download = `jarvis-${ts}.png`;
        link.href     = canvas.toDataURL();
        link.click();
        showToast("✓ JARVIS window captured!", "success");
    } catch(e) {
        showToast("Use Print Screen key for screenshot", "info");
    }
}

// ============================================================
//  FACE RECOGNITION
// ============================================================
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" }
        });
        video.srcObject = stream;
        video.style.display = "block";
        camPlaceholder.style.display = "none";
        isCameraActive = true;
        document.querySelector(".cam-wrap").classList.add("active");

        startCameraBtn.innerHTML = `<span class="btn-icon">◼</span> STOP`;
        trainFaceBtn.disabled = false;

        setFaceStatus("scanning", "Loading face model...");

        if (!faceModel) faceModel = await blazeface.load();

        setFaceStatus("scanning", "Scanning for face...");
        faceBadge.textContent = "ACTIVE";
        faceBadge.classList.add("active");

        detectLoop();
        showToast("Camera online", "success");
        MEM.remember("command", "Camera started");
    } catch (err) {
        setFaceStatus("denied", "Camera access denied");
        showToast("Camera error: " + err.message, "error");
        log("Camera error:", err);
    }
}

function stopCamera() {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.style.display = "none";
    camPlaceholder.style.display = "flex";
    isCameraActive = false;
    document.querySelector(".cam-wrap").classList.remove("active");
    startCameraBtn.innerHTML = `<span class="btn-icon">▷</span> CAMERA`;
    trainFaceBtn.disabled = true;
    setFaceStatus("", "Camera offline");
    faceBadge.textContent = "INACTIVE";
    faceBadge.classList.remove("active");
}

async function detectLoop() {
    if (!isCameraActive) return;
    try {
        const preds = await faceModel.estimateFaces(video, false);
        const now = Date.now();

        if (preds.length > 0) {
            if (now > lastFaceCheck + CONFIG.FACE_COOLDOWN && now > faceBlockedUntil) {
                lastFaceCheck = now;

                if (!faceData) {
                    setFaceStatus("scanning", "Face detected — click TRAIN");
                } else if (easyMode) {
                    setFaceStatus("verified", `Face detected (Easy Mode)`);
                    if (!jarvisActive) triggerFaceActivation();
                } else {
                    const match = verifyFace(preds[0]);
                    if (match) {
                        if (!jarvisActive) triggerFaceActivation();
                    } else {
                        rejections++;
                        setFaceStatus("denied", "Access denied");
                        if (rejections >= 3) {
                            speak("Security alert. Multiple unauthorized access attempts.");
                            showToast("⚠ Security Alert", "error");
                            rejections = 0;
                            faceBlockedUntil = now + 10000;
                        }
                    }
                }
            }
        } else if (faceData) {
            setFaceStatus("scanning", "Scanning...");
        }
    } catch (e) { log("Detection err:", e); }
    requestAnimationFrame(detectLoop);
}

function triggerFaceActivation() {
    faceBlockedUntil = Date.now() + 5000;
    activateJarvis("face");
}

function verifyFace(face) {
    if (!faceData) return false;
    const sw = faceData.bottomRight[0] - faceData.topLeft[0];
    const sh = faceData.bottomRight[1] - faceData.topLeft[1];
    const cw = face.bottomRight[0] - face.topLeft[0];
    const ch = face.bottomRight[1] - face.topLeft[1];
    const wDiff = Math.abs(cw - sw) / sw;
    const hDiff = Math.abs(ch - sh) / sh;
    const xDiff = Math.abs(face.topLeft[0] - faceData.topLeft[0]);
    const yDiff = Math.abs(face.topLeft[1] - faceData.topLeft[1]);

    let landmarkOk = true;
    if (faceData.landmarks && face.landmarks) {
        const d0 = dist(faceData.landmarks[0], face.landmarks[0]);
        const d1 = dist(faceData.landmarks[1], face.landmarks[1]);
        landmarkOk = d0 < 45 && d1 < 45;
    }
    const ok = wDiff < 0.22 && hDiff < 0.22 && xDiff < 65 && yDiff < 65 && landmarkOk;
    if (ok) { setFaceStatus("verified", `${userName} — Identity Confirmed`); rejections = 0; }
    log("Face verify:", {wDiff, hDiff, xDiff, yDiff, landmarkOk, ok});
    return ok;
}

function dist(a, b) {
    return Math.sqrt(Math.pow(a[0]-b[0],2) + Math.pow(a[1]-b[1],2));
}

async function trainFace() {
    trainFaceBtn.disabled = true;
    trainFaceBtn.innerHTML = `<span class="btn-icon">⟳</span> TRAINING`;
    speak("Face training initiated. Hold still and look directly at the camera.");

    const samples = [];
    for (let i = 0; i < 5; i++) {
        await sleep(600);
        const preds = await faceModel.estimateFaces(video, false);
        if (!preds.length) {
            showToast("Face lost. Try again.", "warn");
            speak("Face not detected. Please try again.");
            trainFaceBtn.disabled = false;
            trainFaceBtn.innerHTML = `<span class="btn-icon">◈</span> TRAIN`;
            return;
        }
        samples.push(preds[0]);
        setFaceStatus("scanning", `Capturing sample ${i+1} of 5...`);
    }

    const avg = k => samples.reduce((s, x) => s + x[k][0], 0) / samples.length;
    const avg2 = k => samples.reduce((s, x) => s + x[k][1], 0) / samples.length;

    faceData = {
        topLeft    : [avg("topLeft"),    avg2("topLeft")],
        bottomRight: [avg("bottomRight"),avg2("bottomRight")],
        landmarks  : samples[2].landmarks,
        count      : samples.length,
        owner      : userName,
        trained    : Date.now()
    };

    localStorage.setItem("jarvisFaceData", JSON.stringify(faceData));
    setFaceStatus("verified", `Face registered — ${samples.length} samples`);
    speak(`Face recognition training complete, ${userName}. ${samples.length} samples captured. Your face is now registered.`);
    showToast("Face trained successfully!", "success");
    trainFaceBtn.disabled = false;
    trainFaceBtn.innerHTML = `<span class="btn-icon">◈</span> TRAIN`;
    MEM.remember("fact", { key: "faceTrained", value: true });
}

function clearFaceData() {
    if (!confirm("Clear face recognition data?")) return;
    localStorage.removeItem("jarvisFaceData");
    faceData = null;
    setFaceStatus("", "Face data cleared");
    speak("Face recognition data cleared.");
    showToast("Face data cleared", "success");
}

function setFaceStatus(type, text) {
    faceStatusEl.className = "face-status-bar" + (type ? " " + type : "");
    faceStatusText.textContent = text;
    faceStatusEl.querySelector(".fs-icon").textContent = type === "verified" ? "✓" : type === "denied" ? "✕" : "○";
}

// ============================================================
//  JARVIS ACTIVATION / DEACTIVATION
// ============================================================
function activateJarvis(method = "voice") {
    if (jarvisActive) return;
    jarvisActive = true;
    jarvisStatusEl.textContent = "ONLINE";
    jarvisStatusEl.className   = "sv";

    showActivationOverlay();
    playBeep();

    const s = MEM.stats();
    const lastSeen = MEM.data.lastSeen;
    let greeting;
    if (lastSeen && Date.now() - lastSeen < 3600000) {
        greeting = `Welcome back, ${userName}. ${getTimeContext()}`;
    } else if (lastSeen) {
        const h = Math.floor((Date.now()-lastSeen)/3600000);
        const d = Math.floor(h/24);
        greeting = d > 0
            ? `${getGreeting()}, ${userName}. It has been ${d} ${d===1?"day":"days"} since our last session.`
            : `${getGreeting()}, ${userName}. It has been ${h} hour${h!==1?"s":""} since we last spoke.`;
    } else {
        greeting = `${getGreeting()}, ${userName}. First contact initiated. I am fully operational. How may I assist?`;
    }

    speak(greeting);
    addMsg("jarvis", greeting);
    showToast(`JARVIS activated via ${method}`, "success");
    MEM.updateLastSeen();
    MEM.remember("command", `Activated via ${method}`);

    if (method === "face" && !isListening) {
        setTimeout(() => startVoice(), 2500);
    }
}

function deactivateJarvis() {
    jarvisActive = false;
    jarvisStatusEl.textContent = "OFFLINE";
    jarvisStatusEl.className   = "sv offline";
    stopVoice();
    const r = `Goodbye, ${userName}. All systems standing by.`;
    speak(r);
    addMsg("jarvis", r);
    showToast("JARVIS offline", "warn");
    MEM.remember("command", "Deactivated");
}

// ============================================================
//  VOICE RECOGNITION  (network-error safe, backoff retry)
// ============================================================

let retryDelay     = 500;   // ms — increases on network errors
let retryTimer     = null;
let networkErrCount = 0;    // consecutive network errors
let lastToastTime  = 0;     // prevent toast spam

function startVoice() {
    if (!recognition) {
        showToast("Speech not supported — use Chrome/Edge", "error");
        addMsg("jarvis", "❌ Speech Recognition requires **Google Chrome** or **Microsoft Edge**. Please switch browsers.");
        return;
    }

    // Warn if running on file:// — Chrome blocks mic there
    if (location.protocol === "file:") {
        addMsg("jarvis",
            "⚠ **Cannot use microphone on file://**\n\n" +
            "Chrome blocks mic access when opening HTML files directly.\n\n" +
            "**Fix in 1 step:** Open a terminal in your JARVIS folder and run:\n" +
            "```\npython -m http.server 8080\n```\n" +
            "Then open **http://localhost:8080** in Chrome."
        );
        showToast("Open via localhost — not file://", "error");
        return;
    }

    isListening     = true;
    retryDelay      = 500;
    networkErrCount = 0;
    voiceStatusEl.textContent = "LISTENING";
    startVoiceBtn.disabled = true;
    stopVoiceBtn.disabled  = false;
    startWave();
    scheduleRecognition(200);
    MEM.remember("command", "Listening started");
}

function stopVoice() {
    isListening = false;
    clearTimeout(retryTimer);
    voiceStatusEl.textContent = "IDLE";
    startVoiceBtn.disabled = false;
    stopVoiceBtn.disabled  = true;
    stopWave();
    if (recognitionRunning && recognition) {
        try { recognition.abort(); } catch(e) {}
        recognitionRunning = false;
    }
}

// Central place to schedule next recognition start
function scheduleRecognition(delay) {
    clearTimeout(retryTimer);
    if (!isListening) return;
    retryTimer = setTimeout(() => {
        if (!isListening || recognitionRunning || isSpeaking) return;
        startRecognition();
    }, delay);
}

function startRecognition() {
    if (!recognition || recognitionRunning || isSpeaking || !isListening) return;
    try {
        recognition.start();
        recognitionRunning = true;
        log("🎤 Recognition started");
    } catch(e) {
        recognitionRunning = false;
        log("Recognition start error:", e.message);
        // InvalidStateError = already started, just wait
        scheduleRecognition(800);
    }
}

if (recognition) {
    recognition.onresult = async (event) => {
        // Reset backoff on successful result
        retryDelay      = 500;
        networkErrCount = 0;

        if (isSpeaking) { log("⛔ Ignoring — JARVIS speaking"); return; }
        const transcript = event.results[0][0].transcript.trim();
        if (!transcript) return;
        const lower = transcript.toLowerCase();
        log("Heard:", transcript);

        addMsg("user", transcript);

        // Wake word — activate even when not active
        if (!jarvisActive && /jarvis/i.test(lower)) {
            activateJarvis("voice");
            return;
        }

        // Stop listening command
        if (/stop listening|pause listening/i.test(lower)) {
            const r = `Audio paused, ${userName}. Click Start Listening to resume.`;
            speak(r); addMsg("jarvis", r);
            stopVoice(); return;
        }

        if (jarvisActive) {
            await handleCommand(transcript);
        } else {
            const r = `Say "Hey Jarvis" to activate me, ${userName}.`;
            speak(r); addMsg("jarvis", r);
        }
    };

    recognition.onend = () => {
        recognitionRunning = false;
        log("🔚 Recognition ended, isListening:", isListening);
        if (!isListening) return;
        if (isSpeaking) return; // speak() will reschedule after done
        scheduleRecognition(retryDelay);
    };

    recognition.onerror = (e) => {
        recognitionRunning = false;
        log("Recognition error:", e.error);

        switch (e.error) {
            case "no-speech":
                // Totally normal — user was quiet, just restart
                scheduleRecognition(300);
                return;

            case "aborted":
                // We called abort() intentionally — do nothing
                return;

            case "network":
                // Chrome Speech API needs internet (Google servers)
                networkErrCount++;
                retryDelay = Math.min(retryDelay * 2, 12000);
                voiceStatusEl.textContent = `RETRY ${networkErrCount}/5`;

                // Show diagnosis in chat on first network error
                if (networkErrCount === 1) {
                    addMsg("jarvis",
                        "⚠ **Voice network error detected.** Chrome's Speech API needs internet access to Google's servers.\n\n" +
                        "**Common causes:**\n" +
                        "1. Opened as `file://` — run `python -m http.server 8080` and open `http://localhost:8080`\n" +
                        "2. No internet connection\n" +
                        "3. Chrome microphone blocked — click 🔒 in address bar → Allow mic\n\n" +
                        "**You can still type commands** in the box below while this retries."
                    );
                }

                // Toast only once per 8s
                {
                    const now = Date.now();
                    if (now - lastToastTime > 8000) {
                        lastToastTime = now;
                        showToast(`Voice: retrying ${networkErrCount}/5...`, "warn");
                    }
                }

                if (networkErrCount >= 5) {
                    voiceStatusEl.textContent = "NET ERROR";
                    stopVoice();
                    startVoiceBtn.disabled = false;
                    addMsg("jarvis",
                        "❌ **Voice recognition stopped** after 5 failed attempts.\n\n" +
                        "**Type your commands** in the text box below — everything works the same.\n\n" +
                        "Click **START LISTENING** again once your connection is stable."
                    );
                    networkErrCount = 0;
                    retryDelay = 500;
                    return;
                }

                scheduleRecognition(retryDelay);
                return;

            case "not-allowed":
            case "service-not-allowed":
                showToast("Microphone access denied — check browser permissions", "error");
                stopVoice();
                addMsg("jarvis",
                    "⚠ Microphone access was denied. " +
                    "Click the 🔒 icon in Chrome's address bar → Allow microphone → Reload."
                );
                return;

            case "audio-capture":
                showToast("No microphone found", "error");
                stopVoice();
                return;

            default:
                // Unknown error — try again with backoff
                retryDelay = Math.min(retryDelay * 1.5, 8000);
                scheduleRecognition(retryDelay);
        }
    };
}

// ============================================================
//  UI: MESSAGES
// ============================================================
function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const time = new Date().toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:true });
    const name = role === "user" ? userName.toUpperCase() : "J.A.R.V.I.S";
    const cls  = role === "user" ? "msg-sender-you" : "msg-sender-jarvis";

    // Basic markdown: code blocks
    const formatted = formatText(text);

    div.innerHTML = `
        <div class="msg-header">
            <span class="${cls}">${name}</span>
            <span class="msg-time">${time}</span>
        </div>
        <div class="msg-bubble">${formatted}</div>
    `;
    conversation.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
}

function addTyping() {
    const id = "typing-" + Date.now();
    const div = document.createElement("div");
    div.className = "msg jarvis";
    div.id = id;
    div.innerHTML = `
        <div class="msg-header"><span class="msg-sender-jarvis">J.A.R.V.I.S</span></div>
        <div class="msg-bubble typing"><div class="typing-dots"><span></span><span></span><span></span></div></div>
    `;
    conversation.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
    return id;
}
function removeTyping(id) {
    const el = $(id); if (el) el.remove();
}

function formatText(text) {
    // Code blocks
    text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${escHtml(code.trim())}</code></pre>`
    );
    // Inline code
    text = text.replace(/`([^`]+)`/g, (_, c) => `<code style="background:rgba(0,212,255,0.1);padding:1px 5px;border-radius:3px;font-family:var(--font-mono);font-size:12px;color:var(--arc)">${escHtml(c)}</code>`);
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Newlines
    text = text.replace(/\n/g, "<br>");
    return text;
}

function escHtml(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function addToHistory(cmd) {
    commandLog.unshift(cmd);
    if (commandLog.length > 15) commandLog.pop();
    commandHistoryEl.innerHTML = commandLog.map((c, i) =>
        `<div class="hist-item"><span class="hist-num">${String(i+1).padStart(2,"0")}</span>${escHtml(c)}</div>`
    ).join("");
}

// ============================================================
//  INJECT COMMAND (from quick buttons)
// ============================================================
function injectCommand(cmd) {
    addMsg("user", cmd);
    handleCommand(cmd);
}
window.injectCommand = injectCommand;

// ============================================================
//  MODULE DRAWER
// ============================================================
const moduleContent = {
    web: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">WEB NAVIGATION</h3>
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px">Say or type "open [site name]" to navigate. Examples:</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${["YouTube","GitHub","Google","LinkedIn","Reddit","Stack Overflow","Gmail","ChatGPT","Claude AI","Wikipedia","LeetCode","GeeksForGeeks"].map(s=>`
            <div onclick="injectCommand('open ${s.toLowerCase()}');closeDrawer()" style="padding:10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:6px;cursor:pointer;font-size:13px;transition:all 0.2s" onmouseover="this.style.background='rgba(0,212,255,0.12)'" onmouseout="this.style.background='rgba(0,212,255,0.05)'">${s}</div>
            `).join("")}
        </div>
    `,
    pc: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:8px">PC CONTROL MODULE</h3>
        <div style="background:rgba(255,153,0,0.08);border:1px solid rgba(255,153,0,0.3);border-radius:6px;padding:10px;margin-bottom:14px;font-size:11px;color:#ffa500">
            ⚠ Requires server.py running on port 5000
        </div>

        ${[
            ["⚡ POWER", [
                ["shutdown","Shut Down"],["restart","Restart"],["sleep","Sleep"],
                ["lock","Lock PC"],["logoff","Log Off"],
            ]],
            ["🔊 VOLUME", [
                ["volume_up","Volume Up"],["volume_down","Volume Down"],
                ["mute","Mute"],["unmute","Unmute"],
                ["volume_max","Max Volume"],["volume_50","50% Volume"],
            ]],
            ["🎵 MEDIA", [
                ["media_play","Play / Pause"],["media_next","Next Track"],
                ["media_prev","Prev Track"],["media_stop","Stop"],
            ]],
            ["🖥 DISPLAY", [
                ["minimize_all","Show Desktop"],["maximize_window","Maximize Window"],
                ["close_window","Close Window"],["switch_window","Alt+Tab"],
                ["fullscreen","Toggle Fullscreen"],["brightness_up","Brightness Up"],
                ["brightness_down","Brightness Down"],
            ]],
            ["📂 APPS", [
                ["open_chrome","Chrome"],["open_edge","Edge"],["open_firefox","Firefox"],
                ["open_vscode","VS Code"],["open_terminal","CMD"],["open_explorer","File Explorer"],
                ["open_taskmgr","Task Manager"],["open_notepad","Notepad"],
                ["open_calculator","Calculator"],["open_paint","Paint"],
                ["open_word","Word"],["open_excel","Excel"],["open_powerpoint","PowerPoint"],
                ["open_spotify","Spotify"],["open_vlc","VLC"],["open_camera","Camera"],
                ["open_snipping","Snipping Tool"],["open_settings","Settings"],
                ["open_control","Control Panel"],["open_store","MS Store"],
                ["open_mail","Mail"],["open_teams","Teams"],
            ]],
            ["🔧 SYSTEM", [
                ["screenshot","Screenshot"],["battery_status","Battery Status"],
                ["ip_address","IP Address"],["disk_space","Disk Space"],
                ["system_info","System Info"],["empty_recycle","Empty Recycle Bin"],
                ["clear_clipboard","Clear Clipboard"],
            ]],
        ].map(([group, cmds]) => `
            <div style="margin-bottom:14px">
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:3px;color:var(--text-dim);margin-bottom:6px">${group}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
                    ${cmds.map(([cmd, label]) => `
                    <div onclick="sendToServer('${cmd}');showToast('${label}','success')"
                         style="padding:8px 10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.12);border-radius:5px;cursor:pointer;font-size:12px;transition:all 0.2s;display:flex;align-items:center;gap:6px"
                         onmouseover="this.style.background='rgba(0,212,255,0.15)';this.style.borderColor='var(--arc)'"
                         onmouseout="this.style.background='rgba(0,212,255,0.05)';this.style.borderColor='rgba(0,212,255,0.12)'">
                        <span style="color:var(--arc);font-size:10px">▷</span>${label}
                    </div>`).join("")}
                </div>
            </div>
        `).join("")}
    `,
    ai: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">AI BRAIN CONFIG</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
            <div style="padding:12px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:6px">
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">CURRENT MODEL</div>
                <div style="font-size:14px;color:var(--arc)">${modelSelect?.value || CONFIG.AI_MODEL}</div>
            </div>
            <div style="padding:12px;background:rgba(0,255,136,0.05);border:1px solid rgba(0,255,136,0.15);border-radius:6px">
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">API KEY STATUS</div>
                <div style="font-size:14px;color:${apiKey ? 'var(--green)' : 'var(--danger)'}">${apiKey ? "✓ Configured (" + apiKey.length + " chars)" : "✕ Not set"}</div>
            </div>
            <div style="padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(0,212,255,0.1);border-radius:6px">
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">CONVERSATION HISTORY</div>
                <div style="font-size:14px;color:var(--arc)">${conversationHistory.length} messages in context</div>
                <button onclick="conversationHistory=[];showToast('Context cleared','success')" style="margin-top:8px;padding:6px 12px;background:rgba(255,60,60,0.1);border:1px solid rgba(255,60,60,0.3);border-radius:4px;color:var(--danger);font-size:11px;cursor:pointer;font-family:var(--font-hud);letter-spacing:1px">CLEAR CONTEXT</button>
            </div>
        </div>
    `,
    memory: () => {
        const s = MEM.stats();
        const notes = MEM.recall("notes");
        return `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">MEMORY CORE</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
            ${[
                [s.interactions,"INTERACTIONS"],
                [s.conversations,"CONVERSATIONS"],
                [s.commands,"COMMANDS"],
                [s.notes,"NOTES"]
            ].map(([v,k])=>`<div style="padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(0,212,255,0.1);border-radius:6px;text-align:center"><div style="font-family:var(--font-hud);font-size:24px;color:var(--arc)">${v}</div><div style="font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-top:4px">${k}</div></div>`).join("")}
        </div>
        <h4 style="color:var(--green);font-family:var(--font-hud);font-size:10px;letter-spacing:2px;margin-bottom:10px">SAVED NOTES</h4>
        <div class="notes-list" id="notesList">
            ${notes.length === 0
                ? `<div style="color:var(--text-dim);font-size:13px;padding:10px">No notes saved yet. Say "Remember that..." to save.</div>`
                : notes.map((n,i)=>`
                    <div class="note-item">
                        ${escHtml(n.text)}
                        <div class="note-time">${new Date(n.ts).toLocaleString()}</div>
                        <button class="note-del" onclick="deleteNote(${i})">✕</button>
                    </div>
                `).join("")
            }
        </div>
        <button onclick="if(confirm('Clear ALL memory?')){MEM.clear();updateStats();showToast('Memory cleared','success');closeDrawer()}" style="margin-top:16px;width:100%;padding:10px;background:rgba(255,60,60,0.08);border:1px solid rgba(255,60,60,0.3);border-radius:6px;color:var(--danger);font-family:var(--font-hud);font-size:10px;letter-spacing:2px;cursor:pointer">WIPE MEMORY CORE</button>
        `;
    },
    calc: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">MATH ENGINE</h3>
        <div style="margin-bottom:16px">
            <input id="calcInput" type="text" placeholder="e.g. 125 times 8 or sqrt 144" style="width:100%;padding:10px 14px;background:rgba(0,0,0,0.4);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none" onkeydown="if(event.key==='Enter')calcDrawer()"/>
        </div>
        <button onclick="calcDrawer()" style="width:100%;padding:10px;background:rgba(0,212,255,0.1);border:1px solid var(--arc);border-radius:6px;color:var(--arc);font-family:var(--font-hud);font-size:11px;letter-spacing:2px;cursor:pointer;margin-bottom:16px">CALCULATE ▷</button>
        <div id="calcResult" style="min-height:60px;padding:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(0,212,255,0.1);border-radius:6px;font-family:var(--font-mono);font-size:18px;color:var(--arc);text-align:center"></div>
        <div style="margin-top:16px;font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:8px">QUICK EXAMPLES</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${["25 times 4","sqrt 196","15% of 250","2^10","1000 divided by 7"].map(ex=>`
            <div onclick="$('calcInput').value='${ex}';calcDrawer()" style="padding:5px 10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:4px;font-family:var(--font-mono);font-size:11px;cursor:pointer;color:var(--text-dim)">${ex}</div>
            `).join("")}
        </div>
    `,
    notes: () => {
        const notes = MEM.recall("notes");
        return `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">NOTES VAULT</h3>
        <div style="display:flex;gap:8px;margin-bottom:16px">
            <input id="noteInput" type="text" placeholder="Type a note to save..." style="flex:1;padding:10px 14px;background:rgba(0,0,0,0.4);border:1px solid rgba(0,255,136,0.3);border-radius:6px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none" onkeydown="if(event.key==='Enter')quickNote()"/>
            <button onclick="quickNote()" style="padding:10px 16px;background:rgba(0,255,136,0.1);border:1px solid var(--green);border-radius:6px;color:var(--green);font-family:var(--font-hud);font-size:10px;letter-spacing:1px;cursor:pointer">SAVE</button>
        </div>
        <div class="notes-list" id="notesList">
            ${notes.length === 0
                ? `<div style="color:var(--text-dim);font-size:13px;padding:10px">No notes saved yet.</div>`
                : notes.slice().reverse().map((n,i)=>`
                    <div class="note-item">
                        ${escHtml(n.text)}
                        <div class="note-time">${new Date(n.ts).toLocaleString()}</div>
                        <button class="note-del" onclick="deleteNote(${notes.length-1-i});showModule('notes')">✕</button>
                    </div>
                `).join("")
            }
        </div>
        `;
    },

    // ── CURRENCY CONVERTER ───────────────────────────────────────
    currency: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">💱 CURRENCY CONVERTER</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div>
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">AMOUNT</div>
                <input id="currAmount" type="number" value="1" min="0" step="any"
                    style="width:100%;padding:10px;background:rgba(0,0,0,0.4);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:var(--text);font-family:var(--font-mono);font-size:16px;outline:none"
                    onkeydown="if(event.key==='Enter')currConvert()"/>
            </div>
            <div>
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">FROM</div>
                <select id="currFrom" style="width:100%;padding:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(0,212,255,0.25);border-radius:6px;color:var(--text);font-size:13px;outline:none">
                    ${["USD","EUR","GBP","INR","JPY","AUD","CAD","CHF","CNY","SGD","AED","SAR","HKD","KRW","MXN","BRL","RUB","TRY","ZAR","SEK","NOK","DKK","NZD","THB","MYR","IDR","PHP","PKR","BDT","NGN"].map(c=>`<option value="${c}"${c==="USD"?" selected":""}>${c}</option>`).join("")}
                </select>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            <div>
                <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">TO</div>
                <select id="currTo" style="width:100%;padding:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(0,212,255,0.25);border-radius:6px;color:var(--text);font-size:13px;outline:none">
                    ${["USD","EUR","GBP","INR","JPY","AUD","CAD","CHF","CNY","SGD","AED","SAR","HKD","KRW","MXN","BRL","RUB","TRY","ZAR","SEK","NOK","DKK","NZD","THB","MYR","IDR","PHP","PKR","BDT","NGN"].map(c=>`<option value="${c}"${c==="INR"?" selected":""}>${c}</option>`).join("")}
                </select>
            </div>
            <div style="display:flex;align-items:flex-end">
                <button onclick="swapCurrencies()" style="width:100%;padding:10px;background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.25);border-radius:6px;color:var(--arc);font-size:18px;cursor:pointer" title="Swap">⇄</button>
            </div>
        </div>
        <button onclick="currConvert()" style="width:100%;padding:11px;background:rgba(0,212,255,0.12);border:1px solid var(--arc);border-radius:6px;color:var(--arc);font-family:var(--font-hud);font-size:11px;letter-spacing:2px;cursor:pointer;margin-bottom:14px">CONVERT ▷</button>
        <div id="currResult" style="min-height:70px;padding:16px;background:rgba(0,0,0,0.35);border:1px solid rgba(0,212,255,0.1);border-radius:6px;text-align:center;font-family:var(--font-mono)">
            <span style="color:var(--text-dim);font-size:12px">Enter amount and press CONVERT</span>
        </div>
        <div style="margin-top:12px;font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">QUICK PAIRS</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${[["USD","INR"],["EUR","INR"],["GBP","INR"],["USD","EUR"],["USD","JPY"],["BTC","USD"]].map(([f,t])=>`
            <div onclick="document.getElementById('currFrom').value='${f}';document.getElementById('currTo').value='${t}';currConvert()"
                 style="padding:5px 10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:4px;font-size:11px;cursor:pointer;color:var(--text-dim)">${f}→${t}</div>
            `).join("")}
        </div>
    `,

    // ── WIKIPEDIA SEARCH ─────────────────────────────────────────
    wiki: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">📖 WIKIPEDIA SEARCH</h3>
        <div style="display:flex;gap:8px;margin-bottom:12px">
            <input id="wikiQuery" type="text" placeholder="Search Wikipedia..."
                style="flex:1;padding:10px 14px;background:rgba(0,0,0,0.4);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none"
                onkeydown="if(event.key==='Enter')wikiSearch()"/>
            <button onclick="wikiSearch()" style="padding:10px 16px;background:rgba(0,212,255,0.1);border:1px solid var(--arc);border-radius:6px;color:var(--arc);font-family:var(--font-hud);font-size:10px;letter-spacing:1px;cursor:pointer">SEARCH</button>
        </div>
        <div id="wikiResult" style="min-height:80px;padding:14px;background:rgba(0,0,0,0.35);border:1px solid rgba(0,212,255,0.1);border-radius:6px;font-size:13px;line-height:1.6;color:var(--text)">
            <span style="color:var(--text-dim)">Search for any topic...</span>
        </div>
        <div id="wikiLink" style="margin-top:10px;display:none">
            <a id="wikiOpenLink" href="#" target="_blank" style="color:var(--arc);font-family:var(--font-hud);font-size:10px;letter-spacing:1px;text-decoration:none">
                ↗ OPEN FULL ARTICLE
            </a>
        </div>
        <div style="margin-top:14px;font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:8px">TRENDING SEARCHES</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${["Artificial Intelligence","Iron Man","Quantum Computing","Black Hole","Indian Space Program","Machine Learning","Tony Stark"].map(q=>`
            <div onclick="document.getElementById('wikiQuery').value='${q}';wikiSearch()"
                 style="padding:5px 10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:4px;font-size:11px;cursor:pointer;color:var(--text-dim)">${q}</div>
            `).join("")}
        </div>
    `,

    // ── WEATHER ──────────────────────────────────────────────────
    weather: () => `
        <h3 style="color:var(--arc);font-family:var(--font-hud);font-size:12px;letter-spacing:3px;margin-bottom:16px">🌤 WEATHER INTELLIGENCE</h3>
        <div style="display:flex;gap:8px;margin-bottom:12px">
            <input id="weatherCity" type="text" placeholder="City name (e.g. Mumbai, London)..."
                style="flex:1;padding:10px 14px;background:rgba(0,0,0,0.4);border:1px solid rgba(0,212,255,0.3);border-radius:6px;color:var(--text);font-family:var(--font-body);font-size:14px;outline:none"
                onkeydown="if(event.key==='Enter')fetchWeather()"/>
            <button onclick="fetchWeather()" style="padding:10px 14px;background:rgba(0,212,255,0.1);border:1px solid var(--arc);border-radius:6px;color:var(--arc);font-family:var(--font-hud);font-size:10px;letter-spacing:1px;cursor:pointer">SCAN ▷</button>
        </div>
        <div id="weatherResult" style="min-height:120px;padding:16px;background:rgba(0,0,0,0.35);border:1px solid rgba(0,212,255,0.1);border-radius:6px">
            <span style="color:var(--text-dim);font-size:12px">Enter a city to get live weather data</span>
        </div>
        <div style="margin-top:14px;font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:8px">QUICK CITIES</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${["Kanpur","Delhi","Mumbai","Bangalore","London","New York","Tokyo","Dubai","Sydney","Singapore"].map(city=>`
            <div onclick="document.getElementById('weatherCity').value='${city}';fetchWeather()"
                 style="padding:5px 10px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:4px;font-size:11px;cursor:pointer;color:var(--text-dim)">${city}</div>
            `).join("")}
        </div>
    `
};

function showModule(key) {
    drawerTitle.textContent = key.toUpperCase() + " MODULE";
    drawerContent.innerHTML = moduleContent[key] ? moduleContent[key]() : "<p>Module not found</p>";
    moduleDrawer.classList.add("open");
    drawerOverlay.classList.add("open");
}
window.showModule = showModule;
window.closeDrawer = function() {
    moduleDrawer.classList.remove("open");
    drawerOverlay.classList.remove("open");
};
window.deleteNote = function(i) {
    MEM.deleteNote(i);
    updateStats();
};

// Calc drawer helper
window.calcDrawer = function() {
    const inp = $("calcInput");
    if (!inp) return;
    const val = inp.value.trim();
    const res = parseMath(val.toLowerCase());
    const out = $("calcResult");
    if (res !== null) {
        out.innerHTML = `<span style="color:var(--text-dim);font-size:12px">${escHtml(val)}</span><br><span style="color:var(--arc);font-size:28px;font-weight:700">${res}</span>`;
        out.style.borderColor = "rgba(0,212,255,0.4)";
    } else {
        out.innerHTML = `<span style="color:var(--danger)">Cannot parse expression</span>`;
        out.style.borderColor = "rgba(255,60,60,0.3)";
    }
};

// Quick note from drawer
window.quickNote = function() {
    const inp = $("noteInput");
    if (!inp || !inp.value.trim()) return;
    MEM.remember("note", inp.value.trim());
    showToast("Note saved", "success");
    inp.value = "";
    showModule("notes");
    updateStats();
};

// ============================================================
//  CURRENCY CONVERTER
// ============================================================
window.swapCurrencies = function() {
    const f = $("currFrom"), t = $("currTo");
    if (!f || !t) return;
    [f.value, t.value] = [t.value, f.value];
    currConvert();
};

window.currConvert = async function() {
    const amount = parseFloat($("currAmount")?.value) || 1;
    const from   = $("currFrom")?.value || "USD";
    const to     = $("currTo")?.value   || "INR";
    const out    = $("currResult");
    if (!out) return;

    out.innerHTML = `<span style="color:var(--text-dim);font-size:12px;animation:pulse 1s infinite">⟳ Fetching live rate...</span>`;

    try {
        // Free no-key API
        const res  = await fetch(`https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`);
        if (!res.ok) throw new Error("API " + res.status);
        const data = await res.json();
        const rate    = data.rates[to];
        const perUnit = (data.rates[to] / amount).toFixed(6);

        out.innerHTML = `
            <div style="color:var(--text-dim);font-size:11px;font-family:var(--font-hud);letter-spacing:1px;margin-bottom:6px">${amount} ${from} =</div>
            <div style="color:var(--arc);font-size:30px;font-weight:700;font-family:var(--font-mono);margin-bottom:6px">${rate.toLocaleString("en-US", {maximumFractionDigits:4})} ${to}</div>
            <div style="color:var(--text-dim);font-size:11px">1 ${from} = ${perUnit} ${to}</div>
            <div style="color:var(--text-dim);font-size:10px;margin-top:4px;font-family:var(--font-hud);letter-spacing:1px">SOURCE: FRANKFURTER · ${new Date().toLocaleTimeString()}</div>
        `;
        out.style.borderColor = "rgba(0,212,255,0.35)";

        // Also speak it
        const spoken = `${amount} ${from} equals ${rate.toLocaleString()} ${to}, ${userName}.`;
        speak(spoken);
        addMsg("jarvis", `💱 **Currency:** ${spoken}`);
        MEM.remember("command", `currency ${from} to ${to}`);

    } catch(e) {
        // Fallback: static approximate rates (no network needed)
        const RATES = {
            USD:{INR:83.5,EUR:0.92,GBP:0.79,JPY:149.5,AUD:1.53,CAD:1.36,CHF:0.88,CNY:7.24,SGD:1.34,AED:3.67,SAR:3.75},
            EUR:{INR:90.8,USD:1.09,GBP:0.86,JPY:162.7},
            GBP:{INR:105.6,USD:1.27,EUR:1.16,JPY:189.2},
            INR:{USD:0.012,EUR:0.011,GBP:0.0095,JPY:1.79,AED:0.044,SAR:0.045}
        };
        const rate = RATES[from]?.[to];
        if (rate) {
            const result = (amount * rate).toFixed(4);
            out.innerHTML = `
                <div style="color:var(--text-dim);font-size:11px;font-family:var(--font-hud);letter-spacing:1px;margin-bottom:6px">${amount} ${from} ≈</div>
                <div style="color:var(--arc);font-size:30px;font-weight:700;font-family:var(--font-mono);margin-bottom:6px">${parseFloat(result).toLocaleString()} ${to}</div>
                <div style="color:#ffa500;font-size:10px;font-family:var(--font-hud);letter-spacing:1px">⚠ OFFLINE RATE · May be outdated</div>
            `;
        } else {
            out.innerHTML = `<span style="color:var(--danger)">⚠ Network error & no offline rate for ${from}→${to}.<br>Check internet connection.</span>`;
        }
        out.style.borderColor = "rgba(255,165,0,0.3)";
        log("Currency error:", e.message);
    }
};

// ============================================================
//  WIKIPEDIA SEARCH
// ============================================================
window.wikiSearch = async function(query) {
    const inp  = $("wikiQuery");
    const term = query || inp?.value?.trim();
    if (!term) { showToast("Enter a search term", "warn"); return; }
    if (inp) inp.value = term;

    const out  = $("wikiResult");
    const link = $("wikiLink");
    const aEl  = $("wikiOpenLink");
    if (!out) return;

    out.innerHTML = `<span style="color:var(--text-dim);font-size:12px">⟳ Searching Wikipedia...</span>`;
    if (link) link.style.display = "none";

    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status === 404 ? "not_found" : "api_error");
        const data = await res.json();

        const extract = data.extract || "No summary available.";
        const title   = data.title   || term;
        const pageUrl = data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`;
        const thumb   = data.thumbnail?.source || null;

        out.innerHTML = `
            ${thumb ? `<img src="${thumb}" style="float:right;max-width:90px;max-height:90px;object-fit:cover;border-radius:4px;margin:0 0 8px 10px;border:1px solid rgba(0,212,255,0.2)" onerror="this.remove()"/>` : ""}
            <div style="font-family:var(--font-hud);font-size:11px;letter-spacing:2px;color:var(--arc);margin-bottom:8px">${escHtml(title)}</div>
            <div style="font-size:13px;line-height:1.7;color:var(--text)">${escHtml(extract.slice(0, 600))}${extract.length > 600 ? "…" : ""}</div>
        `;
        out.style.borderColor = "rgba(0,212,255,0.3)";

        if (link && aEl) { link.style.display = "block"; aEl.href = pageUrl; }

        // Speak summary
        const spoken = extract.slice(0, 200);
        speak(spoken);
        addMsg("jarvis", `📖 **${title}:** ${spoken}${extract.length > 200 ? "…" : ""}`);
        MEM.remember("command", `wikipedia: ${term}`);

    } catch(e) {
        if (e.message === "not_found") {
            // Try search API as fallback
            try {
                const sRes  = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=5&format=json&origin=*`);
                const sData = await sRes.json();
                const titles = sData[1];
                if (titles.length > 0) {
                    out.innerHTML = `
                        <div style="color:var(--text-dim);font-size:12px;margin-bottom:10px">No exact match. Did you mean:</div>
                        ${titles.map(t=>`
                            <div onclick="document.getElementById('wikiQuery').value='${t.replace(/'/g,"\\'")}';wikiSearch()"
                                 style="padding:8px 10px;margin-bottom:5px;background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.15);border-radius:5px;cursor:pointer;font-size:13px;color:var(--arc)">${escHtml(t)}</div>
                        `).join("")}
                    `;
                } else {
                    out.innerHTML = `<span style="color:var(--danger)">No results found for "${escHtml(term)}"</span>`;
                }
            } catch { out.innerHTML = `<span style="color:var(--danger)">Wikipedia search failed. Check connection.</span>`; }
        } else {
            out.innerHTML = `<span style="color:var(--danger)">Error: ${escHtml(e.message)}</span>`;
        }
        log("Wiki error:", e.message);
    }
};

// ============================================================
//  WEATHER
// ============================================================
const WEATHER_ICONS = {
    0:"☀️",1:"🌤",2:"⛅",3:"☁️",45:"🌫",48:"🌫",
    51:"🌦",53:"🌦",55:"🌧",61:"🌧",63:"🌧",65:"🌧",
    71:"❄️",73:"❄️",75:"❄️",80:"🌦",81:"🌧",82:"⛈",
    85:"❄️",86:"❄️",95:"⛈",96:"⛈",99:"⛈"
};
const WEATHER_DESC = {
    0:"Clear sky",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",
    45:"Foggy",48:"Icy fog",51:"Light drizzle",53:"Drizzle",55:"Heavy drizzle",
    61:"Light rain",63:"Moderate rain",65:"Heavy rain",71:"Light snow",
    73:"Moderate snow",75:"Heavy snow",80:"Slight showers",81:"Showers",
    82:"Violent showers",85:"Snow showers",86:"Heavy snow showers",
    95:"Thunderstorm",96:"Thunderstorm+hail",99:"Thunderstorm+heavy hail"
};

window.fetchWeather = async function(cityName) {
    const inp  = $("weatherCity");
    const city = cityName || inp?.value?.trim();
    if (!city) { showToast("Enter a city name", "warn"); return; }
    if (inp) inp.value = city;

    const out = $("weatherResult");
    if (!out) return;
    out.innerHTML = `<span style="color:var(--text-dim);font-size:12px">⟳ Fetching weather for ${escHtml(city)}...</span>`;

    try {
        // Step 1: Geocode city → lat/lon (Open-Meteo geocoding, no key needed)
        const geoRes  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        const geoData = await geoRes.json();
        if (!geoData.results?.length) throw new Error("city_not_found");

        const { latitude: lat, longitude: lon, name, country, timezone } = geoData.results[0];

        // Step 2: Fetch weather (Open-Meteo, no key needed)
        const wRes  = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
            `&timezone=${encodeURIComponent(timezone)}&forecast_days=4`
        );
        const wData = await wRes.json();
        const c = wData.current;
        const d = wData.daily;

        const icon    = WEATHER_ICONS[c.weather_code] || "🌡";
        const desc    = WEATHER_DESC[c.weather_code]  || "Unknown";
        const windDir = ["N","NE","E","SE","S","SW","W","NW"][Math.round(c.wind_direction_10m/45)%8];

        // 4-day forecast rows
        const days = ["Today","Tomorrow","Day 3","Day 4"];
        const forecastHTML = d.time.slice(0,4).map((date, i) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:rgba(0,212,255,0.04);border-radius:4px;margin-bottom:4px">
                <span style="font-size:11px;color:var(--text-dim);min-width:55px">${days[i]}</span>
                <span style="font-size:15px">${WEATHER_ICONS[d.weather_code[i]]||"🌡"}</span>
                <span style="font-size:12px;color:var(--arc)">${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</span>
                <span style="font-size:10px;color:var(--text-dim)">${d.precipitation_sum[i].toFixed(1)}mm</span>
            </div>
        `).join("");

        out.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
                <div style="font-size:48px;line-height:1">${icon}</div>
                <div>
                    <div style="font-family:var(--font-hud);font-size:11px;letter-spacing:2px;color:var(--arc)">${escHtml(name)}, ${escHtml(country)}</div>
                    <div style="font-size:32px;font-weight:700;font-family:var(--font-mono);color:var(--text)">${Math.round(c.temperature_2m)}°C</div>
                    <div style="font-size:12px;color:var(--text-dim)">${desc}</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
                <div style="padding:8px;background:rgba(0,212,255,0.05);border-radius:5px;text-align:center">
                    <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-hud);letter-spacing:1px">FEELS LIKE</div>
                    <div style="font-size:16px;color:var(--arc)">${Math.round(c.apparent_temperature)}°C</div>
                </div>
                <div style="padding:8px;background:rgba(0,212,255,0.05);border-radius:5px;text-align:center">
                    <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-hud);letter-spacing:1px">HUMIDITY</div>
                    <div style="font-size:16px;color:var(--arc)">${c.relative_humidity_2m}%</div>
                </div>
                <div style="padding:8px;background:rgba(0,212,255,0.05);border-radius:5px;text-align:center">
                    <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-hud);letter-spacing:1px">WIND</div>
                    <div style="font-size:16px;color:var(--arc)">${Math.round(c.wind_speed_10m)}<span style="font-size:11px">km/h ${windDir}</span></div>
                </div>
            </div>
            <div style="font-family:var(--font-hud);font-size:9px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px">4-DAY FORECAST</div>
            ${forecastHTML}
            <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-hud);letter-spacing:1px;margin-top:8px">SOURCE: OPEN-METEO · ${new Date().toLocaleTimeString()}</div>
        `;
        out.style.borderColor = "rgba(0,212,255,0.3)";

        const spoken = `Weather in ${name}: ${Math.round(c.temperature_2m)} degrees Celsius, ${desc}. Humidity ${c.relative_humidity_2m} percent. Wind speed ${Math.round(c.wind_speed_10m)} km/h.`;
        speak(spoken);
        addMsg("jarvis", `🌤 **${name} Weather:** ${spoken}`);
        MEM.remember("command", `weather: ${city}`);

    } catch(e) {
        if (e.message === "city_not_found") {
            out.innerHTML = `<span style="color:var(--danger)">City "${escHtml(city)}" not found. Try a different spelling.</span>`;
        } else {
            out.innerHTML = `<span style="color:var(--danger)">Weather fetch failed: ${escHtml(e.message)}<br><span style="font-size:11px">Check internet connection.</span></span>`;
        }
        log("Weather error:", e.message);
    }
};

// ============================================================
//  SETTINGS PANEL TOGGLE
// ============================================================
window.toggleSettings = function() {
    const open = settingsBody.style.display !== "none";
    settingsBody.style.display = open ? "none" : "block";
    settingsArrow.className = "toggle-arrow" + (open ? "" : " open");
};
// Start collapsed
settingsBody.style.display = "none";

// ============================================================
//  SAVE SETTINGS
// ============================================================
saveSettingsBtn.addEventListener("click", () => {
    const name = userNameInput.value.trim();
    const key  = apiKeyInput.value.trim();

    if (name) {
        userName = name;
        localStorage.setItem("jarvisUserName", userName);
        MEM.remember("preference", { key: "userName", value: userName });
    }
    if (key && key.length > 10) {
        apiKey = key;
        localStorage.setItem("jarvisApiKey", apiKey);
        aiStatusEl.textContent = "ONLINE";
        aiStatusEl.className   = "sv";
        $("aiModStatus").textContent = "●";
        $("aiModStatus").classList.add("active");
        showToast("API key saved — AI enabled!", "success");
    }
    if (modelSelect) {
        localStorage.setItem("jarvisModel", modelSelect.value);
        CONFIG.AI_MODEL = modelSelect.value;
    }
    if (personalityModeEl) {
        personality = personalityModeEl.value;
        localStorage.setItem("jarvisPersonality", personality);
    }

    easyMode   = easyModeInput.checked;
    debugMode  = debugModeInput.checked;
    autoListen = autoListenInput.checked;
    soundFx    = soundFxInput.checked;
    localStorage.setItem("jarvisEasyMode",   easyMode);
    localStorage.setItem("jarvisDebug",      debugMode);
    localStorage.setItem("jarvisAutoListen", autoListen);
    localStorage.setItem("jarvisSoundFx",    soundFx);

    CONFIG.DEBUG = debugMode;
    showToast("Configuration saved", "success");
});

// Voice type
document.querySelectorAll('input[name="voice"]').forEach(r => {
    if (r.value === voiceType) r.checked = true;
    r.addEventListener("change", e => {
        voiceType = e.target.value;
        localStorage.setItem("jarvisVoice", voiceType);
        MEM.remember("preference", { key: "voiceType", value: voiceType });
    });
});

// ============================================================
//  LOAD SAVED SETTINGS INTO UI
// ============================================================
// Load voice language dropdown
const _vlSel = document.getElementById("voiceLangSelect");
if (_vlSel) _vlSel.value = localStorage.getItem("jarvisLang") || "en-US";

if (userName !== "sir") userNameInput.value = userName;
if (apiKey)             apiKeyInput.value   = apiKey;
if (modelSelect)        modelSelect.value   = localStorage.getItem("jarvisModel") || CONFIG.AI_MODEL;
if (personalityModeEl)  personalityModeEl.value = personality;
easyModeInput.checked  = easyMode;
debugModeInput.checked = debugMode;
autoListenInput.checked = autoListen;
soundFxInput.checked    = soundFx;

if (apiKey && apiKey.length > 10) {
    aiStatusEl.textContent = "ONLINE";
    aiStatusEl.className   = "sv";
    $("aiModStatus").textContent = "●";
    $("aiModStatus").classList.add("active");
}

// ============================================================
//  TEXT INPUT
// ============================================================
sendTextBtn.addEventListener("click", () => {
    const val = textInput.value.trim();
    if (!val) return;
    textInput.value = "";
    addMsg("user", val);

    if (!jarvisActive && /jarvis/i.test(val.toLowerCase())) {
        activateJarvis("text"); return;
    }
    if (jarvisActive) {
        handleCommand(val);
    } else {
        const r = `Say or type "Hey Jarvis" to activate me, ${userName}.`;
        addMsg("jarvis", r); speak(r);
    }
});
textInput.addEventListener("keydown", e => {
    if (e.key === "Enter") sendTextBtn.click();
});

// ============================================================
//  CLEAR / EXPORT CHAT
// ============================================================
clearChatBtn.addEventListener("click", () => {
    if (confirm("Clear conversation?")) {
        conversation.innerHTML = "";
        showToast("Conversation cleared", "success");
    }
});
exportChatBtn.addEventListener("click", () => {
    const msgs = [...conversation.querySelectorAll(".msg")];
    const text = msgs.map(m => {
        const sender  = m.querySelector(".msg-header span:first-child")?.textContent || "";
        const content = m.querySelector(".msg-bubble")?.innerText || "";
        const time    = m.querySelector(".msg-time")?.textContent || "";
        return `[${time}] ${sender}:\n${content}\n`;
    }).join("\n---\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jarvis-chat-${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
    showToast("Chat exported", "success");
});

// ============================================================
//  KEY VISIBILITY TOGGLE
// ============================================================
window.toggleKeyVisibility = function() {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
};

// ============================================================
//  CAMERA BTN
// ============================================================
startCameraBtn.addEventListener("click", () => {
    if (isCameraActive) stopCamera(); else startCamera();
});
trainFaceBtn.addEventListener("click", trainFace);
clearFaceBtn.addEventListener("click", clearFaceData);

// ============================================================
//  VOICE BTNS
// ============================================================
startVoiceBtn.addEventListener("click", startVoice);
stopVoiceBtn.addEventListener("click", stopVoice);

// ============================================================
//  ACTIVATION OVERLAY
// ============================================================
function showActivationOverlay() {
    const o = $("activationOverlay");
    o.style.display = "flex";
    setTimeout(() => { o.style.display = "none"; }, 1600);
}

// ============================================================
//  TOAST SYSTEM
// ============================================================
const toastStack = $("toastStack");
window.showToast = function(msg, type = "info") {
    const t = document.createElement("div");
    t.className = "toast" + (type !== "info" ? " " + type : "");
    t.textContent = msg;
    toastStack.appendChild(t);
    setTimeout(() => t.remove(), 3500);
};
window.sendToServer = sendToServer;
window.MEM = MEM;

// ============================================================
//  STATS UPDATE
// ============================================================
function updateStats() {
    const s = MEM.stats();
    totalIntEl.textContent   = s.interactions;
    totalConvEl.textContent  = s.conversations;
    totalNotesEl.textContent = s.notes;
    totalCmdsEl.textContent  = s.commands;
    lastSeenValEl.textContent = s.lastSeen
        ? new Date(s.lastSeen).toLocaleString()
        : "FIRST SESSION";
}
setInterval(updateStats, 5000);

// ============================================================
//  SYSTEM STATUS
// ============================================================
function setSystemOnline() {
    sysLabel.textContent = "ONLINE";
    sysDot.style.background = "#00ff88";
    sysDot.style.boxShadow = "0 0 8px #00ff88";
}

// ============================================================
//  BEEP SOUND EFFECT
// ============================================================
function playBeep() {
    if (!soundFx) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    } catch(e) { /* audio not supported */ }
}

// ============================================================
//  HELPERS
// ============================================================
function getGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12)  return "Good morning";
    if (h >= 12 && h < 17) return "Good afternoon";
    if (h >= 17 && h < 21) return "Good evening";
    return "Good night";
}
function getTimeContext() {
    const h = new Date().getHours();
    if (h < 7)  return "You're up early today.";
    if (h < 12) return "The morning is well underway.";
    if (h < 14) return "Midday — optimal performance window.";
    if (h < 17) return "The afternoon is in full swing.";
    if (h < 21) return "Evening session initiated.";
    return "Burning the midnight oil, I see.";
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(...args) { if (debugMode) console.log("[JARVIS]", ...args); }

// ============================================================
//  MIC PERMISSION HELPERS
// ============================================================
async function checkMicPermission() {
    try {
        const r = await navigator.permissions.query({ name: "microphone" });
        return r.state; // "granted" | "denied" | "prompt"
    } catch { return "unknown"; }
}

async function requestMicAccess() {
    try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        s.getTracks().forEach(t => t.stop());
        return true;
    } catch { return false; }
}

// ============================================================
//  BOOT SEQUENCE
// ============================================================
async function boot() {
    updateStats();
    setSystemOnline();

    // Greeting
    const s = MEM.stats();
    const lastSeen = MEM.data.lastSeen;
    let greeting;
    if (lastSeen) {
        const h   = Math.floor((Date.now() - lastSeen) / 3600000);
        const d   = Math.floor(h / 24);
        const ago = d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : "recently";
        greeting  = `${getGreeting()}, ${userName}. Systems online. Last session: ${ago}. ${s.interactions} total interactions logged.`;
    } else {
        greeting = `${getGreeting()}. J.A.R.V.I.S. Mark VII online. First session initialized.`;
    }
    addMsg("jarvis", greeting);

    // ── Step 1: Check protocol ────────────────────────────────
    if (location.protocol === "file:") {
        addMsg("jarvis",
            "🔴 **Voice BLOCKED — running on file://**\n\n" +
            "Chrome does not allow microphone on file://. Fix:\n\n" +
            "Open CMD/PowerShell in your JARVIS folder and run:\n" +
            "```\npython -m http.server 8080\n```\n" +
            "Then open Chrome → **http://localhost:8080**\n\n" +
            "Text input below works fine in the meantime."
        );
        showToast("Open via localhost — not file://", "error");

    } else {
        // ── Step 2: Check mic permission ─────────────────────
        const perm = await checkMicPermission();

        if (perm === "denied") {
            addMsg("jarvis",
                "🔴 **Microphone is BLOCKED in Chrome**\n\n" +
                "To fix it:\n" +
                "1. Click the 🔒 **lock icon** in Chrome's address bar\n" +
                "2. Set **Microphone → Allow**\n" +
                "3. Press **F5** to refresh\n\n" +
                "Then click **START LISTENING**."
            );
            showToast("Mic blocked — see chat for fix", "error");
            voiceStatusEl.textContent = "BLOCKED";
            voiceStatusEl.className   = "sv offline";

        } else if (perm === "prompt") {
            // Proactively ask for mic so Chrome shows the popup NOW
            addMsg("jarvis",
                "🎤 Requesting microphone access — please click **Allow** in the Chrome popup that appears."
            );
            const ok = await requestMicAccess();
            if (ok) {
                addMsg("jarvis",
                    "✅ **Microphone granted!**\n\n" +
                    "Click **START LISTENING** then say **\"Hey Jarvis\"** to activate."
                );
                showToast("Mic ready! Click Start Listening ▶", "success");
            } else {
                addMsg("jarvis",
                    "❌ Microphone was denied.\n\n" +
                    "Click the 🔒 lock in Chrome's address bar → **Microphone → Allow** → refresh."
                );
                showToast("Mic denied — allow it in address bar", "error");
                voiceStatusEl.textContent = "BLOCKED";
                voiceStatusEl.className   = "sv offline";
            }

        } else {
            // granted or unknown — all good
            addMsg("jarvis",
                `✅ Mic ready on **${location.origin}**\n\n` +
                `Click **START LISTENING** → say **"Hey Jarvis"** to activate.\n` +
                `You can also type any command in the text box below.`
            );
            showToast("Mic ready — click Start Listening", "success");
        }
    }

    // ── AI key status ─────────────────────────────────────────
    if (apiKey && apiKey.length > 10) {
        aiStatusEl.textContent = "ONLINE";
        aiStatusEl.className   = "sv";
        $("aiModStatus").textContent = "●";
        $("aiModStatus").classList.add("active");
    }

    // ── Auto-start camera if face trained ────────────────────
    if (faceData && !easyMode) {
        setTimeout(() => startCamera(), 1000);
    }

    showToast("J.A.R.V.I.S. Mark VII — Online", "success");
    log("Boot complete. Memory:", MEM.stats());
}



// ============================================================
//  THEME SYSTEM — CSS body class based
// ============================================================
const THEME_NAMES = {
    default  : "JARVIS Default",
    avengers : "⚡ Avengers",
    cyberpunk: "🟣 Cyberpunk",
    ocean    : "🌊 Ocean Blue"
};

let currentTheme = localStorage.getItem("jarvisTheme") || "default";

function applyTheme(themeName) {
    if (!THEME_NAMES[themeName]) return;

    // Remove all theme classes from body
    document.body.classList.remove("theme-avengers","theme-cyberpunk","theme-ocean");

    // Add new theme class
    if (themeName !== "default") {
        document.body.classList.add("theme-" + themeName);
    }

    // Force CSS variable update by reading computed style and reapplying
    const COLORS = {
        default  : { arc:"#00d4ff", bg:"#020a14", panel:"rgba(0,20,40,0.7)", border:"rgba(0,180,255,0.18)", text:"#c8e8ff", glow:"0 0 20px rgba(0,212,255,0.4)" },
        avengers : { arc:"#FFD700", bg:"#080004", panel:"rgba(40,0,10,0.75)", border:"rgba(255,215,0,0.2)",  text:"#fff5e0", glow:"0 0 25px rgba(255,215,0,0.45)" },
        cyberpunk: { arc:"#bf00ff", bg:"#05000e", panel:"rgba(20,0,40,0.75)", border:"rgba(191,0,255,0.22)", text:"#f0d0ff", glow:"0 0 25px rgba(191,0,255,0.5)" },
        ocean    : { arc:"#00cfff", bg:"#000d1a", panel:"rgba(0,20,50,0.75)", border:"rgba(0,200,255,0.18)", text:"#d0f0ff", glow:"0 0 25px rgba(0,180,255,0.45)" }
    };

    const c = COLORS[themeName] || COLORS.default;
    const root = document.documentElement;
    root.style.setProperty("--arc", c.arc);
    root.style.setProperty("--bg",  c.bg);
    root.style.setProperty("--panel", c.panel);
    root.style.setProperty("--panel-border", c.border);
    root.style.setProperty("--text", c.text);
    root.style.setProperty("--glow", c.glow);

    // Force body background
    document.body.style.background = c.bg;
    document.body.style.transition = "background 0.5s";

    currentTheme = themeName;
    localStorage.setItem("jarvisTheme", themeName);

    // Update dot active states
    document.querySelectorAll(".theme-dot").forEach(dot => {
        dot.classList.toggle("active", dot.dataset.theme === themeName);
    });

    showToast("🎨 Theme: " + THEME_NAMES[themeName], "success");
    if (typeof addMsg === "function") {
        addMsg("jarvis", "🎨 **" + THEME_NAMES[themeName] + "** theme activated, " + userName + "!");
    }
}
window.applyTheme = applyTheme;

// Voice theme commands handler
function handleThemeCommand(cmd) {
    if (/avengers|iron man|tony stark|gold theme/i.test(cmd)) {
        applyTheme("avengers"); return true;
    }
    if (/cyberpunk|purple|neon|violet/i.test(cmd)) {
        applyTheme("cyberpunk"); return true;
    }
    if (/ocean|ocean blue|blue theme/i.test(cmd)) {
        applyTheme("ocean"); return true;
    }
    if (/default|jarvis theme|original|reset theme/i.test(cmd)) {
        applyTheme("default"); return true;
    }
    return false;
}

// Apply saved theme on load
window.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme);
});
if (document.readyState !== "loading") {
    setTimeout(() => applyTheme(currentTheme), 300);
}


// ============================================================
//  VOICE LANGUAGE SWITCHER
// ============================================================
window.setVoiceLang = function(lang) {
    localStorage.setItem("jarvisLang", lang);
    if (recognition) {
        const wasListening = isListening;
        if (wasListening) stopVoice();
        recognition.lang = lang;
        if (wasListening) setTimeout(() => startVoice(), 600);
    }
    const names = { "en-US":"🇺🇸 English US", "en-GB":"🇬🇧 English UK", "hi-IN":"🇮🇳 Hindi" };
    showToast("Language: " + (names[lang] || lang), "success");
    addMsg("jarvis", `🌐 Voice language set to **${names[lang]||lang}**, ${userName}!`);
};


boot();
