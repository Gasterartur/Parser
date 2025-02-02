require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const cron = require("node-cron");
const fs = require("fs-extra");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// 📂 Загружаем подписки из файла
const SUBSCRIPTIONS_FILE = "subscriptions.json";
let subscriptions = fs.existsSync(SUBSCRIPTIONS_FILE) ? fs.readJsonSync(SUBSCRIPTIONS_FILE) : [];

// 🔍 Функции парсинга для разных сайтов
const scrapers = {
    wildberries: async (url) => {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });

        try {
            await page.waitForSelector(".price-block__final-price");
            const priceText = await page.$eval(".price-block__final-price", el => el.innerText);
            const price = parseInt(priceText.replace(/\D/g, ""), 10);
            await browser.close();
            return price;
        } catch (error) {
            console.error("Ошибка парсинга Wildberries:", error);
            await browser.close();
            return null;
        }
    },

    ozon: async (url) => {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });

        try {
            await page.waitForSelector("[data-widget='webPrice'] span");
            const priceText = await page.$eval("[data-widget='webPrice'] span", el => el.innerText);
            const price = parseInt(priceText.replace(/\D/g, ""), 10);
            await browser.close();
            return price;
        } catch (error) {
            console.error("Ошибка парсинга Ozon:", error);
            await browser.close();
            return null;
        }
    },

    aliexpress: async (url) => {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });

        try {
            await page.waitForSelector(".product-price-current");
            const priceText = await page.$eval(".product-price-current", el => el.innerText);
            const price = parseInt(priceText.replace(/\D/g, ""), 10);
            await browser.close();
            return price;
        } catch (error) {
            console.error("Ошибка парсинга AliExpress:", error);
            await browser.close();
            return null;
        }
    }
};

// 🔔 Проверка цен и отправка уведомлений
async function checkPrices() {
    for (const sub of subscriptions) {
        if (!scrapers[sub.site]) continue;

        const currentPrice = await scrapers[sub.site](sub.url);
        if (currentPrice && currentPrice <= sub.targetPrice) {
            bot.sendMessage(sub.chatId, `🔥 Цена на *${sub.name}* упала до ${currentPrice}₽!\n🔗 [Купить](${sub.url})`, { parse_mode: "Markdown" });
        }
    }
}

// ⏳ Автопроверка каждые 5 минут
cron.schedule("*/5 * * * *", async () => {
    console.log("🔄 Проверка цен...");
    await checkPrices();
});

// 📲 Подписка на товар
bot.onText(/\/subscribe (.+) (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const site = match[1];
    const url = match[2];
    const targetPrice = parseInt(match[3]);

    if (!scrapers[site]) {
        return bot.sendMessage(chatId, "❌ Поддерживаются только: wildberries, ozon, aliexpress");
    }

    const productName = url.split("/").slice(-1)[0]; // Имя товара (примерное)
    subscriptions.push({ chatId, site, url, targetPrice, name: productName });

    fs.writeJsonSync(SUBSCRIPTIONS_FILE, subscriptions);
    bot.sendMessage(chatId, `✅ Вы подписались на *${productName}* по цене ${targetPrice}₽`);
});

// 📊 Просмотр подписок
bot.onText(/\/subscriptions/, (msg) => {
    const chatId = msg.chat.id;
    const userSubs = subscriptions.filter(sub => sub.chatId === chatId);

    if (userSubs.length === 0) return bot.sendMessage(chatId, "ℹ️ У вас нет подписок.");

    let message = "📌 Ваши подписки:\n\n";
    userSubs.forEach((sub, index) => {
        message += `*${index + 1}.* ${sub.name} — цель: ${sub.targetPrice}₽\n🔗 [Ссылка](${sub.url})\n\n`;
    });

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

// 🗑 Отписка
bot.onText(/\/unsubscribe (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const index = parseInt(match[1]) - 1;
    const userSubs = subscriptions.filter(sub => sub.chatId === chatId);

    if (!userSubs[index]) return bot.sendMessage(chatId, "❌ Неверный номер подписки.");

    const subToRemove = userSubs[index];
    subscriptions = subscriptions.filter(sub => !(sub.chatId === chatId && sub.url === subToRemove.url));

    fs.writeJsonSync(SUBSCRIPTIONS_FILE, subscriptions);
    bot.sendMessage(chatId, `❌ Подписка на *${subToRemove.name}* удалена.`);
});

// 🚀 Запуск бота
console.log("✅ Бот запущен!");
