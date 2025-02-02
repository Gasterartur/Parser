require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const puppeteer = require("puppeteer");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// 🔹 Создаем Express-сервер и WebSocket
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(express.static("public"));

// 🔹 Инициализация SQLite
const db = new sqlite3.Database("prices.db", (err) => {
    if (err) return console.error("Ошибка SQLite:", err.message);
    console.log("✅ Подключено к базе данных SQLite");
});

// 🔹 Создаем таблицу, если ее нет
db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    url TEXT,
    last_price TEXT
)`);

// 📌 Функция парсинга цены
async function checkPrice(url) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // ❗ Настроить селекторы для разных сайтов
    let price;
    if (url.includes("wildberries.ru")) {
        price = await page.$eval(".price-block__final-price", el => el.textContent.trim());
    } else if (url.includes("ozon.ru")) {
        price = await page.$eval(".e1j9birj0", el => el.textContent.trim());
    } else {
        price = await page.$eval(".price", el => el.textContent.trim());
    }

    await browser.close();
    return price;
}

// 📌 Подписка на товар
bot.onText(/\/subscribe (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1];

    db.run("INSERT INTO subscriptions (chat_id, url, last_price) VALUES (?, ?, ?)", [chatId, url, "0"], (err) => {
        if (err) return bot.sendMessage(chatId, "Ошибка при подписке!");
        bot.sendMessage(chatId, `✅ Ты подписался на ${url}`);
        io.emit("new-subscription", { chatId, url });
    });
});

// 📌 Проверка цен каждые 5 минут
async function checkAllPrices() {
    db.all("SELECT * FROM subscriptions", async (err, rows) => {
        if (err) return console.error("Ошибка SQLite:", err);

        for (const row of rows) {
            try {
                const newPrice = await checkPrice(row.url);

                if (newPrice !== row.last_price) {
                    bot.sendMessage(row.chat_id, `🔥 Цена обновлена! ${row.url} - ${newPrice}`);

                    db.run("UPDATE subscriptions SET last_price = ? WHERE id = ?", [newPrice, row.id]);
                    io.emit("price-update", { url: row.url, price: newPrice });
                }
            } catch (error) {
                console.error("Ошибка парсинга:", error);
            }
        }
    });
}
setInterval(checkAllPrices, 300000); // 5 минут

// 📌 Загрузка списка товаров из удаленной базы (пример)
async function fetchRemoteProducts() {
    try {
        const response = await axios.get("https://your-api.com/products");
        const products = response.data; // Должно быть [{ url: "...", price: "..." }, {...}]
        
        for (const product of products) {
            const newPrice = await checkPrice(product.url);

            if (newPrice !== product.price) {
                console.log(`💰 Цена изменилась: ${product.url} - ${newPrice}`);
                io.emit("price-update", { url: product.url, price: newPrice });
            }
        }
    } catch (error) {
        console.error("Ошибка загрузки удаленных товаров:", error);
    }
}
setInterval(fetchRemoteProducts, 600000); // 10 минут

// 📌 Запуск сервера
const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Сервер работает на http://localhost:${PORT}`));
