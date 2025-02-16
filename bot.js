require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

// 🔹 Настройки
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // ID админа для уведомлений

// 🔹 Подключаем бота
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// 🔹 Подключаем SQLite
const dbFile = "./prices.db";
const dbExists = fs.existsSync(dbFile);
const db = new sqlite3.Database(dbFile);

// 🔹 Если базы нет — создаём таблицу
if (!dbExists) {
    db.serialize(() => {
        db.run(`CREATE TABLE prices (
            url TEXT PRIMARY KEY,
            price TEXT,
            last_update DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// 📌 Читаем ссылки из базы данных
async function loadUrlsFromDB() {
    return new Promise((resolve, reject) => {
        db.all("SELECT url, price FROM prices", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// 📌 Проверяем цену на сайте
async function checkPrice(url) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    try {
        const price = await page.$eval(".price_value", el => el.textContent.trim()); 
        await browser.close();
        return price;
    } catch (error) {
        await browser.close();
        throw new Error("Не удалось получить цену");
    }
}

// 📌 Проверяем все цены и обновляем базу
async function checkAllPrices() {
    const products = await loadUrlsFromDB();

    for (const product of products) {
        try {
            const newPrice = await checkPrice(product.url);
            console.log(`🔍 Проверка: ${product.url} → ${newPrice}`);

            // Сравнение с локальной базой
            db.get("SELECT price FROM prices WHERE url = ?", [product.url], async (err, row) => {
                if (err) {
                    console.error("Ошибка базы данных:", err);
                    return;
                }

                const lastPrice = row ? row.price : null;

                if (newPrice !== lastPrice) {
                    console.log(`💰 Цена изменилась! ${product.url}: ${lastPrice} → ${newPrice}`);
                    bot.sendMessage(ADMIN_CHAT_ID, `🔥 Цена обновлена! ${product.url} - ${newPrice}`);

                    // Обновляем локальную базу SQLite
                    db.run("INSERT INTO prices (url, price, last_update) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(url) DO UPDATE SET price = ?, last_update = CURRENT_TIMESTAMP", 
                           [product.url, newPrice, newPrice]);
                }
            });

        } catch (error) {
            console.error("Ошибка парсинга:", error);
        }
    }
}

// 📌 Команда для проверки цен вручную
bot.onText(/\/check/, async msg => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Проверяю цены...");
    await checkAllPrices();
    bot.sendMessage(chatId, "✅ Проверка завершена!");
});

// 📌 Автоматическая проверка каждые 5 минут
setInterval(checkAllPrices, 300000);

// 📌 Запуск
console.log("🚀 Бот запущен!");
