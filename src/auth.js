const fs = require('fs');

function Auth(page) {
    const VK_COOKIES_FILE = 'vk_cookies.json';
    const AWAIT_LOGIN_TIMEOUT = 60000 * 5;//5 min

    this.page = page;

    this.login = async () => {
        if (!fs.existsSync(VK_COOKIES_FILE)) {
            await page.goto('https://vk.com');
            await page.waitFor(1000);
            await page.waitForSelector('#l_pr', {timeout: AWAIT_LOGIN_TIMEOUT});
            this.saveCookies(await page.cookies());
        }
        else{
            await this.loadCookies();
            await page.waitFor(1000);
            await page.goto('https://vk.com');
            await page.waitFor(1000);
        }
    };

    this.saveCookies = cookies => {
        fs.writeFile(VK_COOKIES_FILE, JSON.stringify(cookies), err => {
            if (err) throw err;
        });
    };

    this.loadCookies = async () => {
        await fs.readFile(VK_COOKIES_FILE, async (err, cookies) => {
            if (err) {
                console.log(err);
            } else {
                    await page.setCookie(...JSON.parse(cookies));
            }
        });
    };


}

module.exports = Auth;