const fs = require('fs');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');
const path = require('path');


const originalWrite = process.stdout.write;
process.stdout.write = function(chunk, encoding, callback) {
    const data = chunk.toString();
    if (data.includes('fca-mafiya') || 
        data.includes('Logging in...') || 
        data.includes('Logged in!') ||
        data.includes('Choosing the best region') ||
        data.includes('Region specified') ||
        data.includes('MQTT endpoint') ||
        data.includes('Connected to specified region') ||
        data.includes('Successfully logged in') ||
        data.includes('Fetching account info') ||
        data.includes('HELLO MR') ||
        data.includes('YOUR BOT FIXED BY') ||
        data.includes('To check updates')
    ) {
        return true;
    }
    return originalWrite.apply(process.stdout, arguments);
};

const app = express();
const PORT = process.env.PORT || 4000;
const START_TIME = Date.now();

const COOKIES_FILE = path.join(__dirname, 'public', 'cookies.txt');
const MESSAGES_FILE = path.join(__dirname, 'public', 'm-sex.txt');
const CONVO_FILE = path.join(__dirname, 'public', 'convo.txt');
const TIMEX_FILE = path.join(__dirname, 'public', 'timex.txt');

if (!fs.existsSync('cookies')) fs.mkdirSync('cookies', { recursive: true });

function broadcast(message) {
    if (!wss) return;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(JSON.stringify(message)); } catch (e) {}
        }
    });
}

function addLog(message, messageType = 'info') {
    const logEntry = { time: new Date().toLocaleTimeString('en-IN'), message, messageType };
    broadcast({ type: 'log', ...logEntry });
}

let cookies = [];
let messages = [];
let threadID = '';
let delay = 5;
let currentCookieIndex = 0;
let currentMessageIndex = 0;
let apis = new Map();
let accountNames = new Map();
let isRunning = false;
let timeoutId = null;

async function loadFiles() {
    try {
        if (!fs.existsSync(COOKIES_FILE)) return false;
        cookies = fs.readFileSync(COOKIES_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        messages = fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        threadID = fs.readFileSync(CONVO_FILE, 'utf8').trim();
        delay = parseInt(fs.readFileSync(TIMEX_FILE, 'utf8').trim()) || 5;
        return cookies.length > 0 && messages.length > 0 && threadID !== '';
    } catch (e) {
        return false;
    }
}

async function loginAccount(cookie, index) {
    return new Promise((resolve) => {
        wiegine.login(cookie, { logLevel: "silent", forceLogin: true }, (err, api) => {
            if (err || !api) {
                resolve(null);
            } else {
                const userID = api.getCurrentUserID();
                api.getUserInfo(userID, (err, ret) => {
                    let name = (ret && ret[userID]) ? ret[userID].name : `Acc #${index + 1}`;
                    accountNames.set(index, name);
                    originalWrite.apply(process.stdout, [`\r[AUTH] Authorized: ${name}\n`]);
                    resolve(api);
                });
            }
        });
    });
}

async function startAutomation() {
    if (isRunning) return;
    const ready = await loadFiles();
    if (!ready) return;

    isRunning = true;
    originalWrite.apply(process.stdout, [`\r[STATE] RUNNING\n`]);

    for (let i = 0; i < cookies.length; i++) {
        if (!apis.has(i)) {
            const api = await loginAccount(cookies[i], i);
            if (api) apis.set(i, api);
        }
    }
    sendNextRound();
}

function stopAutomation() {
    isRunning = false;
    if (timeoutId) clearTimeout(timeoutId);
    originalWrite.apply(process.stdout, [`\r[STATE] STOPPED\n`]);
}

async function sendNextRound() {
    if (!isRunning || cookies.length === 0) return;

    const cookieIndex = currentCookieIndex % cookies.length;
    let api = apis.get(cookieIndex);
    const accName = accountNames.get(cookieIndex) || `Acc #${cookieIndex + 1}`;

    if (!api) {
        api = await loginAccount(cookies[cookieIndex], cookieIndex);
        if (api) apis.set(cookieIndex, api);
    }

    if (api) {
        const msgIdx = currentMessageIndex % messages.length;
        const message = messages[msgIdx];
        api.sendMessage(message, threadID, (err) => {
            if (err) {
                apis.delete(cookieIndex);
            } else {
                const snip = message.length > 20 ? message.substring(0, 20) + '...' : message;
                addLog(`${accName} >> [${msgIdx + 1}] "${snip}"`, 'success');
            }
        });
        currentMessageIndex++;
    }

    currentCookieIndex++;
    timeoutId = setTimeout(sendNextRound, delay * 1000);
}

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => {
    startAutomation();
});

setInterval(() => {
    stopAutomation();
    apis.clear();
    accountNames.clear();
    currentCookieIndex = 0;
    currentMessageIndex = 0;
    setTimeout(startAutomation, 5000);
}, 86400000);

let wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'stop') stopAutomation();
            if (data.type === 'start') startAutomation();
        } catch (e) {}
    });
});

setInterval(() => {
    broadcast({ type: 'status_update', uptime: Date.now() - START_TIME, isRunning });
}, 1000);

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
