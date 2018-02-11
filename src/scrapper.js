const config = require('../config');
const Auth = require('./auth');
const puppeteer = require('puppeteer');
const fs = require('fs');

let browser;
let results = {};
let page;

async function scrap() {
    browser = await puppeteer.launch({headless: config.headless, dumpio: true});
    page = await browser.newPage();
    await page.goto('https://vk.com');
    await page.waitFor(1000);
    await new Auth(page).login();

    await scrapVk();
    await browser.close();
}

const scrapVk = async () => {
    for (let i = 0; i < config.vkUrls.length; i++) {
        let url = config.vkUrls[i];
        let urlResults = {};
        await page.goto(url);
        await page.waitFor(1000);
        await page.evaluate(() => document.styleSheets[0].insertRule(".fans_fan_img { display: none; }", 1));

        if (await isPersonalPage()) {
            urlResults = await scrapVkFriends(urlResults);
            urlResults = await scrapVkSubscribers(urlResults);
        }
        else {
            urlResults = await scrapVkParticipants(urlResults);
        }
        results[url] = urlResults;
    }

    await fs.writeFile(config.resultsFile, JSON.stringify(results), err => {
        if (err) throw err;
        console.log("results file was saved!");
    });
};

const scrapVkFriends = async urlResults => {
    await closeFriendsOrSubscribersBox();
    await clickFriendsOrSubscribersButton('friends');
    await scrollContainerToBottom('#box_layer_wrap');
    return await scrapFriendsOrSubscribersData('friend', urlResults, '.fans_fan_lnk');
};

const scrapVkSubscribers = async urlResults => {
    await closeFriendsOrSubscribersBox();
    await clickFriendsOrSubscribersButton('#');
    await scrollContainerToBottom('#box_layer_wrap');
    return await scrapFriendsOrSubscribersData('subscriber', urlResults);
};

const scrapFriendsOrSubscribersData = async (key, urlResults, selector, city) => {
    return await page.evaluate((key, urlResults, selector, city) => {
        [...document.querySelectorAll(selector)]
            .forEach(a => {
                let userId = a.href.split('/').pop();
                let user = urlResults[userId];
                if (!user) {
                    user = urlResults[userId] = {};
                }
                user.name = a.text;
                user[key] = true;
                if (city) {
                    user.city = city;
                }
            });
        return urlResults;
    }, key, urlResults, selector, city);
};

const clickFriendsOrSubscribersButton = async buttonHrefFragment => {
    await page.evaluate(buttonHrefFragment => {
        [...document.querySelectorAll('.page_counter')]
            .find(a => a.href.includes(buttonHrefFragment))
            .click();
    }, buttonHrefFragment);
    await page.waitFor(400);
};

const closeFriendsOrSubscribersBox = async () => await page.evaluate(() => {
    let closeButton = document.querySelector('.box_x_button');
    if (closeButton) {
        closeButton.click();
    }
});

const scrollContainerToBottom = async (selector) => {
    let lastScroll = 0;
    while (true) {
        await page.keyboard.press('PageDown');
        await page.waitFor(400);
        let currentScroll = await page.evaluate(selector => document.querySelector(selector).scrollTop, selector);
        if (lastScroll === currentScroll) {
            break;
        }
        lastScroll = currentScroll;
    }
};

const scrapVkParticipants = async urlResults => {
    await closeFriendsOrSubscribersBox();

    await page.evaluate(() => document.querySelector('#group_followers > a').click());
    await page.waitFor(500);
    let searchPageUrl = await page.evaluate(() => document.querySelector('a.ui_box_search').href);
    await page.goto(searchPageUrl);
    await page.waitFor(2000);
    await page.evaluate(() => document.styleSheets[0].insertRule(".search_item_img { display: none; }", 1));

    await page.click('#region_filter');
    await page.keyboard.type('Россия', {delay: 100});
    await page.keyboard.press('Enter');
    await page.waitFor(500);

    for (let i = 0; i < config.cities.length; i++) {
        urlResults = await scrapVkParticipantsByCity(config.cities[i], urlResults);
    }

    return urlResults;
};

const scrapVkParticipantsByCity = async (city, urlResults) => {
    await page.click('#container2 input.selector_input');
    await page.keyboard.type(city, {delay: 100});
    await page.waitFor(500);
    await page.keyboard.press('Enter');
    await page.waitFor(300);
    await page.evaluate(() => document.querySelector('#container2 input.selector_input').value = '');
    await scrollContainerToBottom('html');
    return await scrapFriendsOrSubscribersData('participant', urlResults, '.labeled.name > a', city);
};

const isPersonalPage = async () => {
    return 0 !== await page.evaluate(() => document.querySelectorAll('.page_counter').length);
};

module.exports.scrap = scrap;