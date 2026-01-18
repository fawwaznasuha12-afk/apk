// database/ControlApps.js
module.exports = {
    // ==================== TOKENS & CREDENTIALS ====================
    tokens: "7970383191:AAGxjyWnYGCLlcEFe6vs2tYtpztAIVtdsh4", // Bot Telegram Token
    
    // ==================== OWNER CONFIGURATION ====================
    Developer: "7464121207", // Owner ID Telegram
    owner: ["7464121207"], // Array owner IDs
    
    // ==================== SERVER CONFIGURATION ====================
    port: 2000, // Port untuk Express server
    ipvps: "http://localhost:2000", // IP VPS Anda (GANTI INI!)
    
    // ==================== DATABASE CONFIG ====================
    db: {
        host: "localhost",
        user: "root",
        password: "",
        database: "war_crash_db"
    },
    
    // ==================== WHATSAPP CONFIG ====================
    wa: {
        max_sessions: 5, // Maksimal session WhatsApp
        auto_reconnect: true
    },
    
    // ==================== SECURITY CONFIG ====================
    security: {
        cookie_secret: "war_crash_secret_key_2024",
        session_timeout: 86400 // 24 jam dalam detik
    },
    
    // ==================== API KEYS ====================
    apis: {
        tiktok: "https://www.tikwm.com/api/",
        youtube: "https://api.siputzx.my.id/api/s/youtube",
        pinterest: "https://vinztyty.my.id/download/pinterest",
        nik_checker: "https://api.siputzx.my.id/api/tools/nik-checker"
    },
    
    // ==================== LOGGING ====================
    logging: {
        level: "info",
        telegram_notifications: true
    }
};