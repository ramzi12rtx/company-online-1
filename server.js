const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ========== قاعدة بيانات بسيطة (ملف JSON) ==========
const DB_FILE = path.join(__dirname, 'game_data.json');

function loadData() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        players: {},
        rankings: [],
        globalMarketShare: 100,
        events: [],
        day: 1
    };
}

function saveData(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let gameData = loadData();

// حفظ البيانات كل 30 ثانية
setInterval(() => {
    saveData(gameData);
}, 30000);

// ========== توليد معرف فريد ==========
function generateId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========== أحداث عشوائية عالمية ==========
const globalEvents = [
    { msg: '📈 انتعاش اقتصادي عالمي! جميع الشركات تربح 5%', effect: 'profit', value: 0.05 },
    { msg: '📉 ركود اقتصادي! جميع الشركات تخسر 3%', effect: 'loss', value: 0.03 },
    { msg: '🏦 البنك المركزي يخفض الفائدة! فرص استثمارية', effect: 'opportunity', value: 0 },
    { msg: '🌍 أزمة سلاسل توريد عالمية! تكاليف أعلى', effect: 'cost', value: 0.04 },
    { msg: '💡 طفرة تقنية! الشركات التقنية تربح 8%', effect: 'tech_boost', value: 0.08 }
];

// ========== API Routes ==========

// تسجيل لاعب جديد أو إرجاع بياناته
app.post('/api/register', (req, res) => {
    const { playerName, companyName } = req.body;
    const playerId = generateId();

    const newPlayer = {
        id: playerId,
        playerName: playerName || 'لاعب جديد',
        companyName: companyName || 'شركة جديدة',
        cash: 2500000,
        reputation: 75,
        marketShare: 10,
        day: 1,
        stockPrice: 50,
        corruption: 15,
        employees: 3,
        branches: 2,
        taxRate: 20,
        online: true,
        lastSeen: Date.now()
    };

    gameData.players[playerId] = newPlayer;
    updateRankings();
    saveData(gameData);

    res.json({ success: true, playerId, player: newPlayer, gameData: getPublicGameData() });
});

// تحديث بيانات لاعب
app.post('/api/update', (req, res) => {
    const { playerId, updates } = req.body;
    if (!gameData.players[playerId]) {
        return res.json({ success: false, message: 'اللاعب غير موجود' });
    }

    Object.assign(gameData.players[playerId], updates);
    gameData.players[playerId].lastSeen = Date.now();
    updateRankings();
    saveData(gameData);

    // إرسال تحديث لجميع اللاعبين
    io.emit('playerUpdated', {
        playerId,
        player: gameData.players[playerId],
        rankings: gameData.rankings
    });

    res.json({ success: true, player: gameData.players[playerId] });
});

// الحصول على بيانات اللعبة العامة
app.get('/api/game-state', (req, res) => {
    res.json(getPublicGameData());
});

// الحصول على بيانات لاعب محدد
app.get('/api/player/:playerId', (req, res) => {
    const player = gameData.players[req.params.playerId];
    if (!player) return res.json({ success: false });
    res.json({ success: true, player, rankings: gameData.rankings });
});

// ========== WebSocket Events ==========
io.on('connection', (socket) => {
    console.log('👤 لاعب متصل:', socket.id);

    // لاعب ينضم للعبة
    socket.on('join', (data) => {
        const { playerId } = data;
        if (gameData.players[playerId]) {
            gameData.players[playerId].online = true;
            socket.join('game_room');
            
            // إرسال بيانات اللعبة الحالية
            socket.emit('gameState', getPublicGameData());
            
            // إخبار الجميع بانضمام لاعب
            io.to('game_room').emit('playerOnline', {
                playerId,
                playerName: gameData.players[playerId].playerName,
                companyName: gameData.players[playerId].companyName
            });
        }
    });

    // تحديث فوري من لاعب
    socket.on('playerAction', (data) => {
        const { playerId, action } = data;
        io.to('game_room').emit('actionNotification', {
            playerId,
            playerName: gameData.players[playerId]?.playerName,
            action,
            timestamp: Date.now()
        });
    });

    // طلب منافسة (تحدي)
    socket.on('challenge', (data) => {
        const { fromPlayerId, toPlayerId, amount } = data;
        io.to('game_room').emit('challengeSent', {
            from: gameData.players[fromPlayerId]?.companyName,
            to: gameData.players[toPlayerId]?.companyName,
            amount
        });
    });

    socket.on('disconnect', () => {
        console.log('👋 لاعب غادر:', socket.id);
        // تحديث حالة اللاعب للمتصلين الآخرين
        for (let id in gameData.players) {
            if (gameData.players[id].online && Date.now() - gameData.players[id].lastSeen > 60000) {
                gameData.players[id].online = false;
                io.to('game_room').emit('playerOffline', { playerId: id });
            }
        }
    });
});

// ========== وظائف مساعدة ==========
function updateRankings() {
    gameData.rankings = Object.values(gameData.players)
        .sort((a, b) => b.cash - a.cash)
        .map((p, i) => ({
            rank: i + 1,
            playerName: p.playerName,
            companyName: p.companyName,
            cash: p.cash,
            marketShare: p.marketShare,
            reputation: p.reputation,
            online: p.online
        }))
        .slice(0, 20);
}

function getPublicGameData() {
    return {
        players: Object.fromEntries(
            Object.entries(gameData.players).map(([id, p]) => [id, {
                id: p.id,
                playerName: p.playerName,
                companyName: p.companyName,
                cash: p.cash,
                marketShare: p.marketShare,
                reputation: p.reputation,
                stockPrice: p.stockPrice,
                branches: p.branches,
                employees: p.employees,
                online: p.online
            }])
        ),
        rankings: gameData.rankings,
        day: gameData.day,
        globalMarketShare: gameData.globalMarketShare,
        events: gameData.events
    };
}

// ========== تشغيل الخادم ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 خادم تيكو القابضة يعمل على المنفذ ${PORT}`);
    console.log(`👥 متعدد اللاعبين - يمكنك دعوة أصدقائك الآن!`);
});