# jarvis
🤖 J.A.R.V.I.S — AI-powered voice assistant with face recognition, PC control, and OpenRouter AI integration


# 🤖 J.A.R.V.I.S — Iron Intelligence

> Just A Rather Very Intelligent System — Inspired by Tony Stark's AI from Iron Man

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)

## 🌐 Live Demo
**[Try it here → abhhishek2433365.github.io/jarvis](https://abhhishek2433365.github.io/jarvis/)**

---

## ✨ Features

### 🎤 Voice Control
- Say **"Hey Jarvis"** to activate
- Natural language commands
- Auto-resumes listening after speaking
- Text input fallback

### 🎥 Face Recognition
- AI-powered face detection using TensorFlow.js + BlazeFace
- Train your face in 5 seconds
- Auto-activates JARVIS when your face is detected
- Easy mode toggle

### 🧠 AI Conversation
- Powered by **OpenRouter API** (free models available)
- Multiple AI models: GPT, Llama, Gemini, DeepSeek, Claude
- Persistent conversation memory
- Multiple personality modes: JARVIS, FRIDAY, HAL-9000

### 💻 PC Control (requires server.py)
- 50+ voice commands
- Power: Shutdown, Restart, Sleep, Lock, Log Off
- Volume: Up, Down, Mute, Max, 50%
- Media: Play, Pause, Next, Previous
- Apps: Chrome, VS Code, Notepad, Spotify, Teams, and 20+ more
- System Info: Battery, IP Address, Disk Space, CPU/RAM
- Window: Minimize All, Maximize, Close, Alt+Tab, Fullscreen
- Brightness control

### 💾 Memory System
- Remembers notes, conversations, and preferences
- Persistent across sessions via localStorage
- Save notes by voice: *"Remember that meeting at 3pm"*
- Recall: *"What do you remember?"*

### ⚡ More Features
- Holographic HUD UI design
- Calculator with voice math
- Quick web navigation (50+ sites)
- Google search by voice
- Chat export
- Real-time system metrics
- Particle background animation

---

## 🚀 Quick Start

### Online (Voice + AI + Face Recognition)
Just open the live demo link above in **Chrome or Edge**

### Local (Full PC Control)
\```bash
# Clone the repo
git clone https://github.com/abhhishek2433365/jarvis
cd jarvis

# Install server dependencies
pip install flask flask-cors

# Start PC control server
python server.py

# Start web server (new terminal)
python -m http.server 8080
\```
Then open Chrome → `http://localhost:8080`

---

## 🔑 API Key Setup
1. Go to [openrouter.ai/keys](https://openrouter.ai/keys) — free account
2. Open JARVIS → Settings panel → paste your key → Save
3. Free models like **Llama 3.3 70B** and **Gemini 2.0 Flash** work great

---

## 🗣️ Voice Commands

| Say This | Action |
|----------|--------|
| `Hey Jarvis` | Activate |
| `Open YouTube` | Open website |
| `Search for Python tutorials` | Google search |
| `What time is it` | Current time |
| `Calculate 25 times 4` | Math |
| `Remember that meeting at 3pm` | Save note |
| `What do you remember` | Recall notes |
| `Battery status` | Check battery |
| `System info` | CPU, RAM, OS info |
| `Open VS Code` | Launch app |
| `Next song` | Media control |
| `Show desktop` | Minimize all |
| `Screenshot` | Capture screen |
| `Stop Jarvis` | Deactivate |

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| HTML / CSS / JS | Frontend UI |
| TensorFlow.js | Face detection |
| BlazeFace | Face model |
| Web Speech API | Voice recognition & synthesis |
| OpenRouter API | AI conversation |
| Python Flask | Local PC control server |
| Windows ctypes | PC command execution |
| localStorage | Persistent memory |

---

## 📁 Project Structure
\```
jarvis/
├── index.html      # Main UI
├── style.css       # Holographic HUD styles
├── script.js       # All frontend logic
└── server.py       # Local PC control server
\```

---

## ⚠️ Notes
- Voice recognition requires **Chrome or Edge**
- PC commands require `server.py` running locally
- AI features require a free OpenRouter API key
- Face recognition works best in good lighting

---

## 👨‍💻 Made with ❤️ — Inspired by Iron Man
