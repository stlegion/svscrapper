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
        await page.evaluate(() => {
            const stylesheet = document.styleSheets[0];
            stylesheet.insertRule(".fans_fan_img { display: none; }", 1);
            stylesheet.insertRule(".reply_img { display: none; }", 1);
            stylesheet.insertRule(".reply_text { display: none; }", 1);
        });

        const personalPage = await isPersonalPage();
        console.log('scrapping (%s page): %s', (personalPage ? 'personal' : 'group'), url);
        urlResults = await scrapVkActiveUsers(urlResults);
        await page.waitFor(1000);
        if (personalPage) {
            urlResults = await scrapVkFriends(urlResults);
            urlResults = await scrapVkSubscribers(urlResults);
        }
        else {
            urlResults = await scrapVkParticipants(urlResults);
        }
        results[url] = urlResults;
    }

    await fs.writeFile(config.resultFile, JSON.stringify(results), err => {
        if (err) throw err;
        console.log('results file was saved!');
    });
};

const scrapVkActiveUsers = async urlResults => {
    console.log('\tscrapping active users');
    await page.click('.post_link');
    await page.waitForSelector('#wl_post');

    while (true) {
        const postYear = await extractPostYear();
        if (!config.postsYearFilter || postYear != config.postsYearFilter) {
            if (await nextPost()) {
                continue;
            }
            else {
                break;
            }
        }

        await scrollContainerToBottom('#wk_layer_wrap');
        urlResults = await page.evaluate(urlResults => {
            [...document.querySelectorAll('.wk_cont .reply_author > a')]
                .forEach(a => {
                    let userId = a.href.split('/').pop();
                    let user = urlResults[userId];
                    if (!user) {
                        user = urlResults[userId] = {};
                    }
                    user.name = a.text;
                    if (!user.comments) {
                        user.comments = 0;
                    }
                    user.comments++;
                });
            return urlResults;
        }, urlResults);

        const wallId = await page.evaluate(() => new URLSearchParams(new URL(window.location.href).search).get('w'));
        let url = `https://m.vk.com/like?act=members&object=${wallId}`;

        console.log('\t\tscrapping likers');
        urlResults = await scrapVkLikesAndPublishers(urlResults, url, 'liker');
        console.log('\t\tscrapping publishers');
        urlResults = await scrapVkLikesAndPublishers(urlResults, url + '&tab=published', 'publisher');
        await page.waitFor(300);
        if (!await nextPost()) {
            break;
        }
    }
    return urlResults;
};

const scrapVkFriends = async urlResults => {
    console.log('\tscrapping friends');
    await closeFriendsOrSubscribersBox();
    await clickFriendsOrSubscribersButton('friends');
    await scrollContainerToBottom('#box_layer_wrap');
    return await scrapFriendsOrSubscribersData('friend', urlResults, '.fans_fan_lnk');
};

const scrapVkSubscribers = async urlResults => {
    console.log('\tscrapping subscribers');
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

const scrapVkLikesAndPublishers = async (urlResults, url, key) => {
    const currentPage = await browser.newPage();
    await currentPage.goto(url, {waitUntil: 'load'});
    await currentPage.waitFor(100);
    await currentPage.evaluate(() => document.styleSheets[0].insertRule(".ii_body img { display: none; }", 1));
    while (true) {
        urlResults = await currentPage.evaluate((urlResults, key) => {
            [...document.querySelectorAll('a.inline_item')]
                .forEach(a => {
                    let userId = a.href.split('/').pop();
                    let user = urlResults[userId];
                    if (!user) {
                        user = urlResults[userId] = {};
                    }
                    user.name = a.text;
                    user[key] = true;
                });
            return urlResults;
        }, urlResults, key);
        try {
            await currentPage.click('a.pg_link_sel + a.pg_link');
            await currentPage.waitFor(300);
        } catch (ex) {
            break;
        }
    }
    await currentPage.waitFor(2000);
    await currentPage.close();
    return urlResults;
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
    await page.evaluate(() => {
        let followersLink = document.querySelector('#group_followers > a');
        if (!followersLink) {
            followersLink = document.querySelector('#public_followers > a');
        }
        followersLink.click();
    });
    await page.waitFor(500);
    let searchPageUrl = await page.evaluate(() => document.querySelector('a.ui_box_search').href);
    await page.goto(searchPageUrl);
    await page.waitFor(2000);
    await page.evaluate(() => document.styleSheets[0].insertRule(".search_item_img { display: none; }", 1));

    await page.click('#region_filter');
    await page.keyboard.type('Россия', {delay: 100});
    await page.keyboard.press('Enter');
    await page.waitFor(500);

    console.log('\tsrapping participants by cities');
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

const extractPostYear = async () => {
    const postDate = await page.evaluate(() => document.querySelector('#wl_head_wrap .post_date').innerText);
    const yearInd = postDate.search(/\d{4}/);
    return yearInd ? postDate.substr(yearInd, 4) : (new Date()).getFullYear();
};

const nextPost = async () => {
    try {
        await page.click('#wk_right_arrow');
        await page.waitFor(300);
    } catch (ex) {
        return false;
    }
    return true;
};

module.exports.scrap = scrap;