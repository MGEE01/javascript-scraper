const { Actor } = require('apify');
const { PlaywrightCrawler, Dataset } = require('crawlee');

const PRICE_KEY = 'LAST_PRICE';
const SCRAPE_INTERVAL = 7200; // 2 hours
const URL = 'https://www.bybit.com/fiat/trade/otc/?actionType=1&token=USDT&fiat=NGN&paymentMethod=';
const MAX_RETRIES = 4;
const INITIAL_TIMEOUT = 60000; // 1 minute



const possibleConfirmSelectors = [
    'button:has-text("Confirm")',
    'button.ant-btn',
    'button.confirm-button',
    'button:has-text("Confirm")',
    'button:has-text("OK")'
];

async function savePrice(price) {
    const data = {
        price: price,
        time: new Date().toISOString()
    };
    await Actor.setValue(PRICE_KEY, data);
}

async function loadPrice() {
    const data = await Actor.getValue(PRICE_KEY);
    if (data) {
        return [data.price, new Date(data.time)];
    }
    return [null, null];
}

async function clickButtonWithMultipleSelectors(page, selectors, timeout) {
    for (const selector of selectors) {
        try {
            const button = await page.waitForSelector(selector, { timeout });
            if (button) {
                await button.click();
                return true;
            }
        } catch (error) {
            console.log(`Selector ${selector} not found, trying next...`);
        }
    }
    throw new Error('No matching selector found');
}

Actor.main(async () => {
    const crawler = new PlaywrightCrawler({
        async requestHandler({ page, request }) {
            let retries = 0;
            let timeout = INITIAL_TIMEOUT;

            while (retries < MAX_RETRIES) {
                try {
                    await page.goto(URL, { timeout: 180000, waitUntil: 'load' });


                    // Click the confirm button
                    await clickButtonWithMultipleSelectors(page, possibleConfirmSelectors, timeout);

                    // Scroll to the bottom of the page
                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

                    // Wait for the pagination button to be visible
                    await page.waitForSelector('.pagination-item.pagination-item-2', { visible: true, timeout: timeout });

                    // Click the pagination button for the second page
                  await page.click('.pagination-item.pagination-item-2');

                    await page.waitForSelector("span.price-amount", { timeout: timeout });

                    const priceElements = await page.$$("span.price-amount");
                    const prices = await Promise.all(
                        priceElements.slice(2, 10).map(async (element) => {
                            const text = await element.innerText();
                            return parseFloat(text.split()[0].replace(',', ''));
                        })
                    );

                    const averagePrice = prices.reduce((a, b) => a + b, 0) / prices.length;

                    await savePrice(averagePrice);

                    const scrapedData = {
                        price: averagePrice,
                        time: new Date().toISOString()
                    };

                    await Dataset.pushData(scrapedData);

                    console.log('Scraped Data:', JSON.stringify(scrapedData, null, 2));

                    const [savedPrice, savedTime] = await loadPrice();
                    console.log(`Last saved price: ${savedPrice} at ${savedTime}`);

                    break; // Exit the retry loop if successful
                } catch (error) {
                    console.log(`Attempt ${retries + 1} failed: ${error.message}`);
                    retries++;
                    timeout *= 2; // Exponential backoff
                    if (retries >= MAX_RETRIES) {
                        console.log(`Max retries reached. Skipping this request.`);
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
                }
            }
        },
        maxRequestRetries: 5,
        requestHandlerTimeoutSecs: 300,
    });

    await crawler.run([URL]);

    const dataset = await Dataset.open();
    const { items } = await dataset.getData();
    console.log('All scraped items:', JSON.stringify(items, null, 2));
});
