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

// 📌 Загружаем наши цены (owner_links)
async function loadOurPrices() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, model_name, price1 FROM owner_links", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
}

// 📌 Загружаем ссылки конкурентов (partners_links)
async function loadCompetitorPrices() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, model_name, url, html_tags1, html_tags2, last_price1 FROM partners_links", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
}

// 📌 Проверяем цену на сайте
async function checkPrice(url, selector1, selector2) {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    try {
        let price = null;

        if (selector1) {
            price = await page.$eval(selector1, el => parseFloat(el.textContent.trim().replace(/\D/g, "")));
        }
        if (!price && selector2) {
            price = await page.$eval(selector2, el => parseFloat(el.textContent.trim().replace(/\D/g, "")));
        }
        if (!price) {
            price = await page.$eval(".price_value", el => parseFloat(el.textContent.trim().replace(/\D/g, "")));
        }

        await browser.close();
        return price;
    } catch (error) {
        await browser.close();
        return null; // Ошибка получения цены
    }
}

// 📌 Основная функция проверки и сравнения цен
async function checkAllPrices() {
    const ourPrices = await loadOurPrices();
    const competitorPrices = await loadCompetitorPrices();
    let messages = [];

    for (const competitor of competitorPrices) {
        const ourProduct = ourPrices.find(p => p.model_name === competitor.model_name);

        if (!ourProduct) continue; // Если у нас нет такого товара — пропускаем

        try {
            const newPrice = await checkPrice(competitor.url, competitor.html_tags1, competitor.html_tags2);
            if (newPrice === null) continue; // Ошибка парсинга цены

            console.log(`🔍 ${competitor.model_name}: ${competitor.last_price1} → ${newPrice}`);

            // Обновляем базу конкурентов, если цена изменилась
            if (newPrice !== competitor.last_price1) {
                db.run(
                    "UPDATE partners_links SET last_price1 = ?, last_update = strftime('%s', 'now') WHERE id = ?",
                    [newPrice, competitor.id]
                );

                // Записываем в историю изменений
                db.run(
                    "INSERT INTO history_prices (owner_links__id, partner_links__id, model_name, time, price1, price2, status) VALUES (?, ?, ?, strftime('%s', 'now'), ?, ?, 'updated')",
                    [ourProduct.id, competitor.id, competitor.model_name, ourProduct.price1, newPrice]
                );

                // Проверяем разницу цен
                if (newPrice < ourProduct.price1) {
                    const diff = ourProduct.price1 - newPrice;
                    messages.push(`⚠️ Конкурент снизил цену: ${competitor.model_name}\n🔹 Их цена: ${newPrice} ₽\n🔹 Наша цена: ${ourProduct.price1} ₽\n🔻 Разница: ${diff} ₽`);
                }
            }

        } catch (error) {
            console.error("Ошибка парсинга:", error);
        }
    }

    // Отправляем уведомление одним сообщением
    if (messages.length > 0) {
        bot.sendMessage(ADMIN_CHAT_ID, messages.join("\n\n"));
    }
}

// 📌 Команда /check для проверки вручную
bot.onText(/\/check/, async msg => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Проверяю цены...");
    await checkAllPrices();
    bot.sendMessage(chatId, "✅ Проверка завершена!");
});

// 📌 Автопроверка каждые 10 минут
setInterval(checkAllPrices, 600000);

// 📌 Запуск
console.log("🚀 Бот запущен!");
