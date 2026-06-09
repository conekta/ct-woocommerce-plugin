/**
 * Shared helpers for E2E checkout tests (classic + blocks).
 */
const { chromium } = require('playwright');
const { mkdirSync, readFileSync } = require('fs');
const { join } = require('path');
const config = require('./e2e.config');

const EXPECTED_VERSION = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')
).version;

mkdirSync(config.video.dir, { recursive: true });
mkdirSync(config.screenshot.dir, { recursive: true });

const STORE_URL = process.env.STORE_URL || 'http://localhost';
const CONEKTA_API_KEY = process.env.CONEKTA_API_KEY;
const WP_USER = process.env.WP_USER || 'user';
const WP_PASS = process.env.WP_PASS || 'bitnami';

const REGULAR_PRICE = (Math.random() * 900 + 100).toFixed(2);
const DISCOUNT_AMOUNT = (parseFloat(REGULAR_PRICE) / 2).toFixed(2);
const COUPON_AMOUNT = '50';
// Random line-item quantity (1–5) so the cart total varies per run on top of
// the already-random price. Picked once at module load so it's stable across a
// single spec (the payment and any resubmission use the same cart).
const QUANTITY = Math.floor(Math.random() * 5) + 1;
// Conekta sandbox: 4000 0000 0000 2701 = Smart/Strict 3DS with frictionless
// auth approved (no OTP challenge UI). Other cards force a Cardinal challenge
// that does not render reliably in headless Chromium.
// Randomize the shopper name per run so orders aren't all "Test User". Picked
// once at module load, so it stays stable across a single spec (the payment and
// the resubmission share the same name); each spec runs in its own process via
// run.js, so they get independent names.
const FIRST_NAMES = ['Mauricio', 'Sofía', 'Diego', 'Valentina', 'Carlos', 'Fernanda', 'Alejandro', 'Regina', 'Ricardo', 'Gabriela'];
const LAST_NAMES = ['Hernández', 'García', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Torres'];
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const FIRST_NAME = pickRandom(FIRST_NAMES);
const LAST_NAME = pickRandom(LAST_NAMES);

const TEST_CARD = {
  number: '4000000000002701',
  name: `${FIRST_NAME} ${LAST_NAME}`,
  expMonth: '12',
  expYear: '30',
  cvc: '123',
};
const BILLING = {
  first_name: FIRST_NAME,
  last_name: LAST_NAME,
  address_1: 'Calle Test 123',
  city: 'CDMX',
  state: 'DF',
  postcode: '11010',
  phone: '5555555555',
  email: 'test-e2e@example.com',
};

// -------------------------------------------------------
// Test runner state
// -------------------------------------------------------

let browser, page, productId, couponId, couponCode;
const counters = { passed: 0, failed: 0 };

const STATUS = { true: '\x1b[32m✓\x1b[0m', false: '\x1b[31m✗\x1b[0m' };
const COUNTER = { true: 'passed', false: 'failed' };

function assert(condition, label) {
  const key = Boolean(condition);
  console.log(`  ${STATUS[key]} ${label}`);
  counters[COUNTER[key]]++;
}

function getPage() { return page; }
function getCounters() { return counters; }

// -------------------------------------------------------
// WC REST API
// -------------------------------------------------------

async function wcApi(method, endpoint, body) {
  const currentUrl = page.url();
  const isAdmin = currentUrl.includes('/wp-admin');
  await (isAdmin ? Promise.resolve() : page.goto(`${STORE_URL}/wp-admin/`).then(() => page.waitForLoadState('networkidle')));

  return page.evaluate(async ({ baseUrl, method, endpoint, body }) => {
    const nonce = await (await fetch('/wp-admin/admin-ajax.php?action=rest-nonce')).text();
    const opts = { method, headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/wp-json/${endpoint}`, opts);
    return res.json();
  }, { baseUrl: STORE_URL, method, endpoint, body });
}

// -------------------------------------------------------
// Checkout page switcher
// -------------------------------------------------------

const CHECKOUT_CONTENT = {
  classic: '<!-- wp:shortcode -->\n[woocommerce_checkout]\n<!-- /wp:shortcode -->',
  blocks: '<!-- wp:woocommerce/checkout {"align":"wide"} -->\n<div data-block-name="woocommerce/checkout" class="wp-block-woocommerce-checkout alignwide wc-block-checkout is-loading">\n<!-- wp:woocommerce/checkout-fields-block -->\n<div data-block-name="woocommerce/checkout-fields-block" class="wp-block-woocommerce-checkout-fields-block">\n<!-- wp:woocommerce/checkout-express-payment-block --><div data-block-name="woocommerce/checkout-express-payment-block" class="wp-block-woocommerce-checkout-express-payment-block"></div><!-- /wp:woocommerce/checkout-express-payment-block -->\n<!-- wp:woocommerce/checkout-contact-information-block --><div data-block-name="woocommerce/checkout-contact-information-block" class="wp-block-woocommerce-checkout-contact-information-block"></div><!-- /wp:woocommerce/checkout-contact-information-block -->\n<!-- wp:woocommerce/checkout-shipping-address-block --><div data-block-name="woocommerce/checkout-shipping-address-block" class="wp-block-woocommerce-checkout-shipping-address-block"></div><!-- /wp:woocommerce/checkout-shipping-address-block -->\n<!-- wp:woocommerce/checkout-billing-address-block --><div data-block-name="woocommerce/checkout-billing-address-block" class="wp-block-woocommerce-checkout-billing-address-block"></div><!-- /wp:woocommerce/checkout-billing-address-block -->\n<!-- wp:woocommerce/checkout-shipping-methods-block --><div data-block-name="woocommerce/checkout-shipping-methods-block" class="wp-block-woocommerce-checkout-shipping-methods-block"></div><!-- /wp:woocommerce/checkout-shipping-methods-block -->\n<!-- wp:woocommerce/checkout-payment-block --><div data-block-name="woocommerce/checkout-payment-block" class="wp-block-woocommerce-checkout-payment-block"></div><!-- /wp:woocommerce/checkout-payment-block -->\n<!-- wp:woocommerce/checkout-order-note-block --><div data-block-name="woocommerce/checkout-order-note-block" class="wp-block-woocommerce-checkout-order-note-block"></div><!-- /wp:woocommerce/checkout-order-note-block -->\n<!-- wp:woocommerce/checkout-actions-block --><div data-block-name="woocommerce/checkout-actions-block" class="wp-block-woocommerce-checkout-actions-block"></div><!-- /wp:woocommerce/checkout-actions-block -->\n</div>\n<!-- /wp:woocommerce/checkout-fields-block -->\n<!-- wp:woocommerce/checkout-totals-block -->\n<div data-block-name="woocommerce/checkout-totals-block" class="wp-block-woocommerce-checkout-totals-block">\n<!-- wp:woocommerce/checkout-order-summary-block --><div data-block-name="woocommerce/checkout-order-summary-block" class="wp-block-woocommerce-checkout-order-summary-block"></div><!-- /wp:woocommerce/checkout-order-summary-block -->\n</div>\n<!-- /wp:woocommerce/checkout-totals-block -->\n</div>\n<!-- /wp:woocommerce/checkout -->',
};

async function loginAsAdmin() {
  await page.goto(`${STORE_URL}/wp-login.php`);
  await page.waitForSelector('#user_login', { state: 'visible' });
  await page.fill('#user_login', WP_USER);
  await page.fill('#user_pass', WP_PASS);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');
}

async function setCheckoutType(type) {
  // Must be called while authenticated as admin (wcApi() needs the admin REST
  // nonce). setup() invokes this before clearCookies(), so by the time the
  // spec body runs, the page is already in the right layout.
  const settings = await wcApi('GET', 'wc/v3/settings/advanced/woocommerce_checkout_page_id');
  const pageId = settings.value;
  const result = await wcApi('PUT', `wp/v2/pages/${pageId}`, { content: CHECKOUT_CONTENT[type] });
  if (!result?.id) {
    console.log(`  [setCheckoutType ${type}] PUT response: ${JSON.stringify(result).slice(0, 400)}`);
    throw new Error(`setCheckoutType('${type}') failed: PUT did not return a page id`);
  }
}

// -------------------------------------------------------
// Setup & Teardown
// -------------------------------------------------------

async function setup(options = {}) {
  const { checkoutType } = options;
  browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({ recordVideo: config.video });
  page = await context.newPage();

  // Surface page errors and console warnings/errors so we can see SDK failures.
  page.on('pageerror', (err) => console.log(`  [page-error] ${err.message}`));
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      console.log(`  [console-${t}] ${msg.text().slice(0, 300)}`);
    }
  });

  console.log('Setup: Login...');
  await page.goto(`${STORE_URL}/wp-login.php`);
  await page.waitForSelector('#user_login', { state: 'visible' });
  await page.fill('#user_login', WP_USER);
  await page.fill('#user_pass', WP_PASS);
  await page.click('#wp-submit');
  await page.waitForLoadState('networkidle');

  await page.goto(`${STORE_URL}/wp-admin/`);
  await page.waitForLoadState('domcontentloaded');

  // Version gate: ensure the staging store runs the same plugin version as this branch.
  // Uses wp/v2/plugins (cheap WP core endpoint) instead of wc/v3/system_status, which
  // is heavy and intermittently returns without active_plugins on staging. Retries
  // because the rest-nonce can come back invalid (403 rest_cookie_invalid_nonce)
  // right after login — when that happens we re-login to get a fresh session;
  // otherwise we just reload wp-admin in case the response was simply truncated.
  let storeVersion, lastResponse;
  for (let attempt = 1; attempt <= 4; attempt++) {
    lastResponse = await wcApi('GET', 'wp/v2/plugins');
    const conektaPlugin = Array.isArray(lastResponse)
      ? lastResponse.find(p => p.name === 'Conekta Payment Gateway')
      : null;
    storeVersion = conektaPlugin?.version;
    if (storeVersion) break;
    const nonceFailed = lastResponse?.code === 'rest_cookie_invalid_nonce';
    if (nonceFailed) {
      await loginAsAdmin();
    } else {
      await page.goto(`${STORE_URL}/wp-admin/`);
      await page.waitForLoadState('domcontentloaded');
    }
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
  if (storeVersion !== EXPECTED_VERSION) {
    const summary = Array.isArray(lastResponse)
      ? `array(${lastResponse.length}) plugins=[${lastResponse.map(p => p.name).join(', ')}]`
      : `non-array: ${JSON.stringify(lastResponse).slice(0, 300)}`;
    throw new Error(
      `Plugin version mismatch: store has ${storeVersion || 'NOT FOUND'}, expected ${EXPECTED_VERSION}. Last response: ${summary}`
    );
  }
  console.log(`Setup: plugin version OK (${storeVersion})`);

  // Cleanup orphaned e2e resources from previous crashed runs
  const staleProducts = await wcApi('GET', 'wc/v3/products?search=E2E+Discount+Test&per_page=50');
  const staleCoupons = await wcApi('GET', 'wc/v3/coupons?search=e2e_&per_page=50');
  await Promise.all([
    ...staleProducts.map(p => wcApi('DELETE', `wc/v3/products/${p.id}?force=true`)),
    ...staleCoupons.map(c => wcApi('DELETE', `wc/v3/coupons/${c.id}?force=true`)),
  ]);
  const cleaned = staleProducts.length + staleCoupons.length;
  console.log(`Setup: cleaned ${cleaned} orphaned e2e resources`);

  console.log(`Setup: regular_price=$${REGULAR_PRICE}, discount=$${DISCOUNT_AMOUNT}, quantity=${QUANTITY}`);

  const product = await wcApi('POST', 'wc/v3/products', {
    name: 'E2E Discount Test',
    type: 'simple',
    regular_price: REGULAR_PRICE,
    sale_price: DISCOUNT_AMOUNT,
    status: 'publish',
  });
  productId = product.id;
  console.log(`Setup: Product created (ID: ${productId})${product.id ? '' : ' ERROR: ' + JSON.stringify(product).substring(0, 200)}`);

  couponCode = 'e2e_' + Date.now();
  const coupon = await wcApi('POST', 'wc/v3/coupons', {
    code: couponCode,
    discount_type: 'fixed_product',
    amount: COUPON_AMOUNT,
    product_ids: [productId],
  });
  couponId = coupon.id;
  console.log(`Setup: Coupon created (${couponCode})`);

  if (checkoutType) {
    await setCheckoutType(checkoutType);
    console.log(`Setup: checkout page set to ${checkoutType}`);
  }

  // Drop ALL cookies to log out of admin and start as a fresh guest. WC keeps
  // session data tied to user_id in the DB for logged-in users, so admin runs
  // would reuse a long-lived conekta_checkout_order_id from a prior session.
  // A guest session is cookie-only and fresh on every run.
  await page.context().clearCookies();

  await page.goto(`${STORE_URL}/?add-to-cart=${productId}&quantity=${QUANTITY}`);
  await page.waitForLoadState('networkidle');
}

async function clearWCSession() {
  const cookies = await page.context().cookies();
  for (const c of cookies) {
    if (c.name.startsWith('wp_woocommerce_session_') ||
        c.name === 'woocommerce_cart_hash' ||
        c.name === 'woocommerce_items_in_cart') {
      await page.context().clearCookies({ name: c.name, domain: c.domain });
    }
  }
}

/**
 * Apply a coupon on the classic checkout page using the native WC coupon form.
 * This avoids Store API session-sync race conditions because the coupon is
 * applied in the same PHP session context as the checkout page itself.
 */
async function applyCheckoutCoupon(code) {
  // Show the coupon form (hidden by default on classic checkout)
  const toggle = await page.$('.woocommerce-form-coupon-toggle .showcoupon');
  if (toggle) await toggle.click();

  await page.waitForSelector('.checkout_coupon #coupon_code', { state: 'visible', timeout: 5000 });
  await page.fill('.checkout_coupon #coupon_code', code);

  // Set up listeners BEFORE clicking so we catch both AJAX responses:
  // 1) apply_coupon — applies the coupon to the cart
  // 2) update_order_review — WC rebuilds fragments (includes discount_lines)
  const applyDone = page.waitForResponse(
    r => r.url().includes('wc-ajax=apply_coupon'), { timeout: 10000 }
  );
  const updateDone = page.waitForResponse(
    r => r.url().includes('wc-ajax=update_order_review'), { timeout: 15000 }
  );

  await page.click('.checkout_coupon button[name="apply_coupon"]');
  await applyDone;
  await updateDone;
  await page.waitForTimeout(500); // Let the updated_checkout JS event propagate
}

/**
 * Apply a coupon on the blocks checkout by driving the actual UI. This is the
 * only path that reliably propagates the cart change to React state — direct
 * Store API fetches and wp.data.dispatch calls have either nonce or store-key
 * mismatches across blocks versions.
 */
async function applyBlocksCoupon(code) {
  // Modern WC Blocks renders the coupon panel as a collapsed accordion in the
  // order summary. Open it via its accessible name first.
  const toggle = page.getByRole('button', { name: /add coupons|agregar cupones/i }).first();
  await toggle.waitFor({ state: 'visible', timeout: 5000 });
  await toggle.click();

  const input = page.locator('input.wc-block-components-totals-coupon__input, input[id^="wc-block-components-totals-coupon__input"]').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(code);

  const applyBtn = page.locator('.wc-block-components-totals-coupon__button').first();
  await applyBtn.click();

  // Let blocks propagate the cart change and our debounced useEffect fire.
  await page.waitForTimeout(2500);
}

async function teardown() {
  console.log('\nTeardown...');
  try { await wcApi('DELETE', `wc/v3/coupons/${couponId}?force=true`); console.log(`  Deleted coupon ${couponCode}`); } catch (_) {}
  try { await wcApi('DELETE', `wc/v3/products/${productId}?force=true`); console.log(`  Deleted product ${productId}`); } catch (_) {}
  try { await browser.close(); } catch (_) {}
}

// -------------------------------------------------------
// Shared test: verify order status + Conekta API
// -------------------------------------------------------

async function testOrderStatus(conektaOrderId) {
  console.log('\n--- Order status ---');
  const currentUrl = page.url();
  assert(currentUrl.includes('order-received'), 'redirected to order-received page');

  const orderIdMatch = currentUrl.match(/order-received\/(\d+)/);
  assert(orderIdMatch !== null, 'order ID in URL');

  // Verify the Conekta order is paid via API (works for guest sessions).
  if (conektaOrderId) {
    console.log('--- Conekta order verification ---');
    const conektaOrder = await page.evaluate(async ({ url, key }) => {
      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/vnd.conekta-v2.2.0+json' },
      });
      return res.json();
    }, { url: `https://api.conekta.io/orders/${conektaOrderId}`, key: CONEKTA_API_KEY });

    assert(conektaOrder.payment_status === 'paid', `Conekta payment_status = ${conektaOrder.payment_status}`);
  }
}

function getProductId() { return productId; }

/**
 * Find every WooCommerce order that carries the given conekta-order-id meta.
 * Re-authenticates as admin first (the checkout flow runs as a guest, so the
 * REST nonce from the guest session can't read orders). Returns the matching
 * order objects (with status + meta_data) so callers can assert how many of
 * them are in a paid state.
 *
 * This is the invariant that proves the duplicate-order guard: a single
 * Conekta order must map to AT MOST ONE paid WooCommerce order.
 */
async function findOrdersByConektaOrderId(conektaOrderId, { perPage = 50 } = {}) {
  await loginAsAdmin();
  const orders = await wcApi('GET', `wc/v3/orders?per_page=${perPage}&orderby=date&order=desc&status=any`);
  if (!Array.isArray(orders)) return [];
  return orders.filter(o =>
    Array.isArray(o.meta_data) &&
    o.meta_data.some(m => m.key === 'conekta-order-id' && String(m.value) === String(conektaOrderId))
  );
}

const PAID_STATUSES = ['processing', 'completed', 'on-hold'];

/**
 * Submit the classic checkout form directly to the WC AJAX endpoint, forcing a
 * specific conekta_order_id. This reproduces a resubmission (double-click /
 * timeout / retry) where a second WC order is created while the hidden
 * conekta_order_id stays the same — the exact condition behind the duplicate
 * paid orders observed in staging (e.g. WC #6360 & #6361 sharing one Conekta
 * order). Returns the WC AJAX JSON ({ result, redirect, messages, ... }).
 */
async function submitClassicCheckoutRaw(conektaOrderId) {
  return page.evaluate(async (id) => {
    const form = document.querySelector('form.checkout');
    if (!form) throw new Error('form.checkout not found — not on the classic checkout page');
    const fd = new FormData(form);
    fd.set('payment_method', 'conekta');
    fd.set('conekta_order_id', id);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) params.append(k, v);
    const res = await fetch('/?wc-ajax=checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }, conektaOrderId);
}

/**
 * Submit the Blocks (Store API) checkout directly, forcing a specific
 * conekta_order_id on payment_data. This is the Blocks analogue of
 * submitClassicCheckoutRaw: it reproduces a resubmission that reaches
 * process_payment_api with an already-used Conekta order.
 *
 * Blocks does NOT post form.checkout — it hits /wc/store/v1/checkout with a
 * JSON body and a Store API `Nonce` + guest `Cart-Token` header. We first GET
 * the cart to capture those headers and select a shipping rate (the checkout
 * is rejected before reaching the gateway if shipping is required but unset),
 * then POST the checkout with conekta_order_id in payment_data — the same
 * shape the Blocks frontend sends on finalize.
 *
 * Returns { status, json } where json is the Store API checkout response.
 */
async function submitBlocksCheckoutRaw(conektaOrderId, billing) {
  return page.evaluate(async ({ id, b }) => {
    const base = '/wp-json/wc/store/v1';

    // 1) Read the cart to grab the Store API nonce + guest cart token and the
    //    available shipping rates.
    const cartRes = await fetch(`${base}/cart`, { headers: { Accept: 'application/json' } });
    const nonce = cartRes.headers.get('Nonce') || cartRes.headers.get('X-WC-Store-API-Nonce');
    const cartToken = cartRes.headers.get('Cart-Token');
    const cart = await cartRes.json();

    const headers = { 'Content-Type': 'application/json' };
    if (nonce) headers['Nonce'] = nonce;
    if (cartToken) headers['Cart-Token'] = cartToken;

    // 2) Ensure a shipping rate is selected when the cart needs shipping.
    if (cart && cart.needs_shipping && Array.isArray(cart.shipping_rates)) {
      for (const pkg of cart.shipping_rates) {
        const rates = pkg.shipping_rates || [];
        if (rates.length && !rates.some(r => r.selected)) {
          await fetch(`${base}/cart/select-shipping-rate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ package_id: pkg.package_id, rate_id: rates[0].rate_id }),
          });
        }
      }
    }

    // 3) Submit the checkout, reusing the conekta_order_id.
    const address = {
      first_name: b.first_name, last_name: b.last_name,
      address_1: b.address_1, address_2: '',
      city: b.city, state: b.state, postcode: b.postcode,
      country: 'MX', email: b.email, phone: b.phone,
    };
    const res = await fetch(`${base}/checkout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_address: address,
        shipping_address: address,
        payment_method: 'conekta',
        payment_data: [{ key: 'conekta_order_id', value: id }],
      }),
    });
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }, { id: conektaOrderId, b: billing });
}

// -------------------------------------------------------
// Shared helper: wait for the Integration iframe to mount
// -------------------------------------------------------

const INTEGRATION_CONTAINER = '#conektaITokenizerframeContainer';

async function waitForIntegrationIframe() {
  await page.waitForSelector(`${INTEGRATION_CONTAINER} iframe`, { timeout: config.timeouts.threeDs });
  // The element mounts before the SDK finishes navigating + initializing the
  // tokenizer UI. Wait for the iframe to be a real Conekta-hosted document so
  // downstream selectors don't race the SDK boot.
  const iframeReady = async () => {
    for (const frame of page.frames()) {
      let hostname;
      try { hostname = new URL(frame.url()).hostname; } catch (_) { continue; }
      if (hostname.endsWith('.conekta.com') || hostname === 'conekta.com') return true;
    }
    return false;
  };
  const deadline = Date.now() + config.timeouts.threeDs;
  while (Date.now() < deadline) {
    if (await iframeReady()) return;
    await page.waitForTimeout(500);
  }
}

/**
 * Fill the test card inside the Conekta Integration iframe.
 *
 * The card form may live in the outer Conekta iframe or in a nested one,
 * depending on SDK version and on whether the iframe just remounted (after a
 * cart-change PUT). We poll every frame on the page until the card-number
 * field appears, then fill the four fields in whatever frame held it.
 */
async function fillIntegrationCard(card, timeoutMs = 60000) {
  // Conekta Integration uses these stable input ids in both layouts (tile picker
  // and accordion). Targeting them directly avoids false positives from billing
  // or coupon fields that share the broader autocomplete/placeholder regexes.
  const cardNumberSel = '#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"]';
  const nameSel = '#cardholderName, input[name="cardholderName"], input[autocomplete="cc-name"]';
  const expSel = '#cardExpMonthYear, input[name="cardExpMonthYear"], input[autocomplete="cc-exp"]';
  const cvcSel = '#cardVerificationValue, input[name="cardVerificationValue"], input[autocomplete="cc-csc"]';
  // The Conekta iframe shows a multi-method picker (Tarjeta, BBVA, Coppel, etc.)
  // that renders in two layouts (horizontal tiles or vertical radio accordion).
  // Both wrap the "Card" method in a container with data-testid="payment-method-Card",
  // so we click that element to expand the card form regardless of layout. Skip
  // mainFrame because WC's own "Tarjeta" payment radio shares the text but is
  // unrelated. Fall back to role/label selectors for older SDK versions that
  // don't expose the test-id yet.
  const mainFrame = page.mainFrame();
  const pickerDeadline = Date.now() + 15000;
  let pickerClicked = false;
  let pickerSelectorUsed = null;
  while (!pickerClicked && Date.now() < pickerDeadline) {
    for (const frame of page.frames()) {
      if (frame === mainFrame) continue;
      let hostname;
      try { hostname = new URL(frame.url()).hostname; } catch (_) { continue; }
      if (!hostname.endsWith('.conekta.com') && hostname !== 'conekta.com') continue;
      try {
        // The Card method element exposes a stable test-id in both layouts:
        // "payment-method-Card" for the tile layout and "accordion-item-Card"
        // for the radio-accordion layout. The radio-accordion variant wraps
        // a visually-hidden <input type=radio> (clip-rect:0) inside a Chakra
        // <label> AND a Mantine <Accordion>. Two independent state machines
        // need to flip together — Chakra's controlled radio AND Mantine's
        // accordion-active. Calling the input's native HTMLElement.click()
        // is the only path that triggers BOTH (it runs the default action,
        // which flips `checked`, fires `input`/`change`, AND propagates a
        // real `click` event up the tree where Mantine's onClick listens).
        // Programmatic property assignment + synthetic Event dispatch only
        // satisfies one of the two halves.
        const inputSel = '[data-testid="accordion-item-Card"] input[type="radio"]';
        const inputEl = frame.locator(inputSel).first();
        if ((await inputEl.count().catch(() => 0)) > 0) {
          await inputEl.evaluate((node) => node.click()).catch(() => {});
          await page.waitForTimeout(1500);
          pickerClicked = true;
          pickerSelectorUsed = inputSel;
          break;
        }

        // Tile layout: the whole card is the click target — works fine
        // because the SDK listens on the card's onClick.
        const tile = frame.locator('[data-testid="payment-method-Card"]').first();
        if ((await tile.count().catch(() => 0)) > 0) {
          await tile.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
          pickerClicked = true;
          pickerSelectorUsed = '[data-testid="payment-method-Card"]';
          break;
        }

        // Last resort for SDK versions without test-ids.
        const label = frame.locator('label', { hasText: 'Tarjeta' }).first();
        if (await label.isVisible({ timeout: 1000 }).catch(() => false)) {
          await label.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
          pickerClicked = true;
          pickerSelectorUsed = 'label:has-text("Tarjeta")';
          break;
        }
      } catch (_) { /* skip frame */ }
    }
    if (!pickerClicked) await page.waitForTimeout(1000);
  }

  const start = Date.now();
  let cardForm = null;
  let lastReclickAt = Date.now();

  // Sometimes the first picker click lands while the SDK's React tree is
  // still mounting (Mantine accordion + Chakra radio wire up asynchronously
  // off an XHR), so the click is observed but ignored. Re-click periodically
  // until the card form appears — that's what a real user would do.
  const reclickPicker = async () => {
    for (const frame of page.frames()) {
      let hostname;
      try { hostname = new URL(frame.url()).hostname; } catch (_) { continue; }
      if (!hostname.endsWith('.conekta.com') && hostname !== 'conekta.com') continue;
      const inputEl = frame.locator('[data-testid="accordion-item-Card"] input[type="radio"]').first();
      if ((await inputEl.count().catch(() => 0)) > 0) {
        await inputEl.evaluate((node) => node.click()).catch(() => {});
        return;
      }
      const tile = frame.locator('[data-testid="payment-method-Card"]').first();
      if ((await tile.count().catch(() => 0)) > 0) {
        await tile.click({ force: true }).catch(() => {});
        return;
      }
    }
  };

  while (Date.now() - start < timeoutMs && !cardForm) {
    for (const frame of page.frames()) {
      try {
        const numberField = frame.locator(cardNumberSel).first();
        if (await numberField.isVisible({ timeout: 1000 }).catch(() => false)) {
          cardForm = frame;
          break;
        }
      } catch (_) { /* skip frame */ }
    }
    if (!cardForm) {
      if (Date.now() - lastReclickAt > 3000) {
        await reclickPicker();
        lastReclickAt = Date.now();
      }
      await page.waitForTimeout(1000);
    }
  }

  if (!cardForm) {
    // Diagnostic dump: capture screenshot + per-frame state + picker click
    // outcome so we can see exactly which step broke when the card form
    // never appeared (selector miss vs click no-op vs SDK error).
    const shotPath = join(config.screenshot.dir, `card-iframe-fail-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
    console.log(`  [diag] screenshot: ${shotPath}`);
    console.log(`  [diag] pickerClicked=${pickerClicked} selectorUsed=${pickerSelectorUsed || 'none'}`);
    for (const frame of page.frames()) {
      let host = 'unknown';
      try { host = new URL(frame.url()).hostname; } catch (_) {}
      const inputCount = await frame.locator('input').count().catch(() => -1);
      const tarjetaVisible = await frame.getByText('Tarjeta', { exact: true }).first()
        .isVisible({ timeout: 200 }).catch(() => false);
      const testIds = await frame.locator('[data-testid]').evaluateAll(els =>
        els.map(e => e.getAttribute('data-testid')).filter(t => t && (/Card|card|payment|accordion/.test(t)))
      ).catch(() => []);
      const radioStates = await frame.locator('input[type="radio"]').evaluateAll(els =>
        els.map(e => ({ id: e.id, checked: e.checked, dataChecked: e.getAttribute('data-checked') }))
      ).catch(() => []);
      const sample = await frame.locator('input').evaluateAll(els =>
        els.slice(0, 8).map(e => ({ id: e.id, name: e.name, placeholder: e.placeholder, type: e.type, visible: !!e.offsetParent }))
      ).catch(() => []);
      console.log(`  [diag] frame host=${host} inputs=${inputCount} tarjeta=${tarjetaVisible} testIds=${JSON.stringify(testIds)} radios=${JSON.stringify(radioStates)} sample=${JSON.stringify(sample)}`);
    }
    throw new Error('Conekta card-number input never became visible');
  }

  await cardForm.locator(cardNumberSel).first().fill(card.number);

  const name = cardForm.locator(nameSel).first();
  if (await name.isVisible({ timeout: 1000 }).catch(() => false)) {
    await name.fill(card.name);
  }
  await cardForm.locator(expSel).first().fill(`${card.expMonth}/${card.expYear}`);
  await cardForm.locator(cvcSel).first().fill(card.cvc);
}

/**
 * Wait until the checkout is STABLE before charging: no `conekta_checkout_request`
 * POST has fired for `quietMs`. Both checkouts debounce a refresh on every
 * address/cart change that can remount the Integration iframe or (in Blocks)
 * flip `refreshing=true`. Clicking "Place order" while that refresh is in
 * flight makes the SDK never charge (classic resets to the card form; Blocks'
 * onPaymentSetup rejects with "Actualizando importe"). Waiting for the network
 * to go quiet removes that race deterministically — no retry needed.
 */
async function waitForCheckoutStable(quietMs = 2500, timeoutMs = 25000) {
  let lastRequestAt = Date.now();
  const handler = (response) => {
    if (response.url().includes('conekta_checkout_request') && response.request().method() === 'POST') {
      lastRequestAt = Date.now();
    }
  };
  page.on('response', handler);
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      if (Date.now() - lastRequestAt >= quietMs) return;
      await page.waitForTimeout(200);
    }
    console.log('  [waitForCheckoutStable] timed out waiting for quiet — proceeding anyway');
  } finally {
    page.off('response', handler);
  }
}

/**
 * Click the WC "Place Order" button, whichever variant is rendered (blocks
 * vs classic). Waits for the checkout to settle first so the charge isn't
 * fired while a debounced iframe refresh is still in flight.
 */
async function clickPlaceOrder() {
  await waitForCheckoutStable();
  const btn = page.locator(
    'button.wc-block-components-checkout-place-order-button, button:has-text("Realizar el pedido"), button:has-text("Place order"), #place_order'
  ).first();
  await btn.click();
}

/**
/**
 * Dump everything we can see about the checkout's payment state — used to
 * diagnose why a charge never fires (e.g. Blocks onPaymentSetup returning an
 * error before calling the SDK). Reads visible notices, the WC Blocks
 * validation/payment stores, the place-order button state, and the Conekta
 * component iframe's visible text.
 */
async function dumpCheckoutDiagnostics(tag) {
  try {
    const info = await page.evaluate(() => {
      const txt = (sel) => Array.from(document.querySelectorAll(sel))
        .map((e) => (e.innerText || e.textContent || '').trim()).filter(Boolean);
      const notices = Array.from(new Set([
        ...txt('.wc-block-components-notice-banner'),
        ...txt('.wc-block-components-validation-error'),
        ...txt('.woocommerce-error'),
        ...txt('.woocommerce-message'),
        ...txt('.wc-block-store-notice'),
        ...txt('[role="alert"]'),
      ])).map((s) => s.slice(0, 200));
      let validationErrors = null, payment = null;
      try {
        const v = window.wp?.data?.select?.('wc/store/validation');
        validationErrors = v?.getValidationErrors ? v.getValidationErrors() : 'no-store';
      } catch (e) { validationErrors = 'err:' + e.message; }
      try {
        const p = window.wp?.data?.select?.('wc/store/payment');
        payment = p ? {
          status: p.getCurrentStatus ? p.getCurrentStatus() : null,
          active: p.getActivePaymentMethod ? p.getActivePaymentMethod() : null,
        } : 'no-store';
      } catch (e) { payment = 'err:' + e.message; }
      const btnEl = document.querySelector('button.wc-block-components-checkout-place-order-button, #place_order');
      const btn = btnEl ? { text: (btnEl.innerText || '').slice(0, 40), disabled: !!btnEl.disabled } : null;
      const cont = document.querySelector('#conektaITokenizerframeContainer');
      return {
        notices,
        validationErrors,
        payment,
        btn,
        hasIframe: !!(cont && cont.querySelector('iframe')),
        url: location.href,
      };
    });
    console.log(`  [diag ${tag}] url=${info.url}`);
    console.log(`  [diag ${tag}] notices=${JSON.stringify(info.notices)}`);
    console.log(`  [diag ${tag}] validationErrors=${JSON.stringify(info.validationErrors)}`);
    console.log(`  [diag ${tag}] payment=${JSON.stringify(info.payment)} placeBtn=${JSON.stringify(info.btn)} hasIframe=${info.hasIframe}`);
    // Try to read the Conekta component iframe's visible text (may be cross-origin).
    for (const f of page.frames()) {
      let host = ''; try { host = new URL(f.url()).hostname; } catch (_) {}
      if (/pay\.conekta\.com/.test(host) && /component-frame/.test(f.url())) {
        try {
          const t = await f.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
          console.log(`  [diag ${tag}] component-frame text="${t}"`);
        } catch (e) { console.log(`  [diag ${tag}] component-frame unreadable: ${e.message}`); }
      }
    }
  } catch (e) {
    console.log(`  [diag ${tag}] failed: ${e.message}`);
  }
}

/**
 * Wait for the order-received navigation while continuously dismissing any
 * 3DS challenge that appears. Conekta's sandbox renders the challenge in a
 * nested iframe with a hard-coded OTP=1234. The 3DS modal can take 5–30s to
 * appear after Place Order, so we can't rely on a one-shot handler — we poll
 * for the URL change and submit OTP whenever it surfaces.
 *
 * Timeout: a healthy payment (frictionless or with OTP) reaches order-received
 * in well under a minute. The sandbox intermittently fails to finalize the
 * frictionless 3DS — the order stays unpaid and we never navigate. When that
 * happens we want to FAIL FAST (so run.js retries the spec on a fresh payment)
 * instead of hanging for minutes. Default 120s; override with E2E_NAV_TIMEOUT.
 */
async function waitForOrderReceivedWith3DS(timeoutMs = Number(process.env.E2E_NAV_TIMEOUT) || 120000) {
  // Diagnostic: log every Conekta API response so we can see what the SDK
  // is doing after Place Order (charges, 3DS challenge URL, errors, etc.).
  const conektaLog = [];
  const responseHandler = async (response) => {
    const url = response.url();
    const isConekta = /(api\.conekta|pay\.conekta|checkout\.conekta)/i.test(url);
    // Also capture the Store API checkout + the checkout-request endpoint and
    // ANY non-2xx response on our store — that's where a "charge never fired"
    // failure surfaces (validation rejects, process_payment_api errors).
    const isStoreCheckout = /\/wc\/store\/v1\/checkout|conekta_checkout_request|wc-ajax=checkout/i.test(url);
    const isStoreError = /woocommerce\.stg\.conekta\.io/i.test(url) && response.status() >= 400;
    if (!isConekta && !isStoreCheckout && !isStoreError) return;
    let bodyPreview = '';
    try { bodyPreview = (await response.text()).slice(0, 600); } catch (_) {}
    conektaLog.push(`${response.status()} ${response.request().method()} ${url}\n      → ${bodyPreview}`);
  };
  page.on('response', responseHandler);

  // Capture EVERY console message during the payment window (the SDK and our
  // frontend log here) so we can see why the charge didn't fire.
  const consoleLog = [];
  const consoleHandler = (msg) => {
    try { consoleLog.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`); } catch (_) {}
  };
  page.on('console', consoleHandler);
  const dumpLog = () => {
    if (conektaLog.length === 0) {
      console.log('  [no conekta API calls observed]');
    } else {
      console.log('  [conekta API trail]');
      conektaLog.forEach((l) => console.log('  ' + l));
    }
  };

  // Broad OTP selector — Conekta sandbox has used different shapes over time.
  // Match any plausible single text/tel/number/password input the user types
  // 1234 into. We additionally bias toward inputs inside the 3DS challenge
  // frame (3ds-pay.conekta.com) below.
  const otpSelector = 'input[placeholder*="ode" i], input[placeholder*="ódigo" i], input[name*="otp" i], input[id*="otp" i], input[name*="code" i], input[id*="code" i], input[type="tel"], input[type="number"], input[autocomplete*="one-time"]';

  const start = Date.now();
  let last3dsFrame = null;
  let last3dsBodyHash = '';
  let lastScreenshotAt = 0;
  let lastDiagAt = 0;
  while (Date.now() - start < timeoutMs) {
    if (page.url().includes('order-received')) {
      page.off('response', responseHandler);
      page.off('console', consoleHandler);
      return true;
    }

    // Periodic screenshots (every 3s) so we can diff what the user would see.
    if (Date.now() - lastScreenshotAt > 3000) {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      try {
        await page.screenshot({
          path: `${config.screenshot.dir}3ds-poll-${elapsed}s.png`,
          fullPage: true,
        });
      } catch (_) { /* skip */ }
      lastScreenshotAt = Date.now();
    }

    // Periodic checkout diagnostics (every 8s) so we can see WHEN/WHAT error
    // the checkout surfaces — the charge-never-fired case shows up here.
    if (Date.now() - lastDiagAt > 8000) {
      await dumpCheckoutDiagnostics(`+${Math.floor((Date.now() - start) / 1000)}s`);
      lastDiagAt = Date.now();
    }

    // Iterate ALL frames including descendants — page.frames() already returns
    // the flattened tree, but only frames the test main process knows about.
    for (const frame of page.frames()) {
      try {
        let hostname;
        try { hostname = new URL(frame.url()).hostname; } catch (_) { hostname = ''; }
        if (hostname === '3ds-pay.conekta.com' || hostname === '3ds-acs.conekta.com') {
          last3dsFrame = frame;
          // Dump the 3DS DOM whenever its body changes. Catches the brief
          // window where the challenge UI is mounted before being detached.
          try {
            const snapshot = await frame.evaluate(() => ({
              bodyText: (document.body?.innerText || '').slice(0, 500),
              bodyHtml: (document.body?.innerHTML || '').slice(0, 1200),
              frameCount: document.querySelectorAll('iframe').length,
              inputs: Array.from(document.querySelectorAll('input,button,a')).map(el => ({
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                name: el.name || '',
                id: el.id || '',
                cls: (el.className || '').toString().slice(0, 60),
                placeholder: el.placeholder || '',
                text: (el.innerText || '').slice(0, 40),
              })),
            }));
            const hash = snapshot.bodyText + '|' + snapshot.frameCount + '|' + snapshot.inputs.length;
            if (hash !== last3dsBodyHash) {
              const elapsed = Math.floor((Date.now() - start) / 1000);
              console.log(`  [3DS frame change at +${elapsed}s] url=${frame.url().slice(0, 100)}`);
              console.log('    bodyText: ' + snapshot.bodyText);
              console.log('    bodyHtml: ' + snapshot.bodyHtml);
              console.log('    iframeCount: ' + snapshot.frameCount);
              snapshot.inputs.slice(0, 20).forEach(i => console.log('    ' + JSON.stringify(i)));
              last3dsBodyHash = hash;
            }
          } catch (_) { /* not yet ready or detached */ }
        }
        const otp = frame.locator(otpSelector).first();
        if (!(await otp.isVisible({ timeout: 200 }).catch(() => false))) continue;
        const value = await otp.inputValue().catch(() => '');
        if (!value) await otp.fill('1234').catch(() => {});
        await page.waitForTimeout(300);

        // Try Enter on the input first — most reliable for native form submit
        // dispatched by 3DS challenge UIs.
        await otp.press('Enter').catch(() => {});
        await page.waitForTimeout(800);

        // Backup: click any submit-like button.
        const submit = frame.locator('button').filter({ hasText: /submit|enviar|confirmar|continuar|pagar/i }).first();
        if (await submit.isVisible({ timeout: 200 }).catch(() => false)) {
          for (const strategy of ['click-force', 'dispatch', 'js-click']) {
            try {
              if (strategy === 'click-force') await submit.click({ force: true, timeout: 1500 });
              else if (strategy === 'dispatch') await submit.dispatchEvent('click');
              else if (strategy === 'js-click') await submit.evaluate((el) => el.click());
              break;
            } catch (_) { /* try next */ }
          }
        }
        await page.waitForTimeout(1500);
      } catch (_) { /* skip frame */ }
    }

    await page.waitForTimeout(500);
  }
  page.off('response', responseHandler);
  page.off('console', consoleHandler);
  dumpLog();

  // Full diagnostics at timeout: checkout state + console trail + frames.
  await dumpCheckoutDiagnostics('TIMEOUT');
  if (consoleLog.length) {
    console.log('  [console trail during payment]');
    consoleLog.slice(-40).forEach((l) => console.log('    ' + l));
  } else {
    console.log('  [no console messages captured]');
  }

  // Diagnostic: dump every frame URL and the inputs inside the 3DS challenge.
  console.log('  [frames at timeout]');
  for (const f of page.frames()) console.log('    - ' + f.url().slice(0, 200));
  if (last3dsFrame) {
    try {
      const inputs = await last3dsFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('input,button')).map(el => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          text: (el.innerText || '').slice(0, 40),
          visible: !!(el.offsetParent || el.getClientRects().length),
        }));
      });
      console.log('  [3DS frame DOM dump]');
      inputs.forEach(i => console.log('    ' + JSON.stringify(i)));
    } catch (e) {
      console.log('  [3DS frame DOM dump failed]: ' + e.message);
    }
  } else {
    console.log('  [no 3ds-pay.conekta.com frame ever observed]');
  }

  throw new Error('Timeout waiting for order-received navigation');
}

/**
 * Dispatch a synthetic "payment finalized" signal into the page so the
 * frontend writes conekta_order_id and submits to WooCommerce, without
 * depending on the real Integration iframe.
 *
 * Classic: writes the hidden field on form.checkout and submits the form.
 * Blocks:  exposes the value on window so the test can pass it through
 *          paymentMethodData by other means (the blocks spec mocks the
 *          create response and triggers the SDK callback directly).
 */
async function simulateFinalizePaymentClassic(conektaOrderId) {
  await page.evaluate((id) => {
    const form = document.querySelector('form.checkout');
    let hidden = form.querySelector('input[name="conekta_order_id"]');
    if (!hidden) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'conekta_order_id';
      form.appendChild(hidden);
    }
    hidden.value = id;
  }, conektaOrderId);
}

// -------------------------------------------------------
// Runner
// -------------------------------------------------------

async function run(label, optionsOrFn, maybeFn) {
  // Two call shapes: run(label, fn) and run(label, options, fn).
  const testFn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
  const options = typeof optionsOrFn === 'function' ? {} : (optionsOrFn || {});
  console.log(`=== E2E: ${label} ===\n`);

  try {
    await setup(options);
    console.log('Setup: Ready\n');
    await testFn({ page, assert, counters, config, couponCode, STORE_URL, BILLING, TEST_CARD });
  } catch (error) {
    counters.failed++;
    console.error(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    const screenshotPath = `${config.screenshot.dir}${config.screenshot.prefix}${label.toLowerCase().replace(/\s+/g, '-')}-error.png`;
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`Screenshot: ${screenshotPath}`); } catch (_) {}
  } finally {
    await teardown();
  }

  const RESULT = { true: '\x1b[32mAll passed!\x1b[0m', false: '\x1b[31mFailed!\x1b[0m' };
  const EXIT = { true: 0, false: 1 };
  const passed = counters.failed === 0;

  console.log(`\n=== ${counters.passed} passed, ${counters.failed} failed ===`);
  console.log(RESULT[passed]);
  return passed;
}

module.exports = {
  STORE_URL, CONEKTA_API_KEY, REGULAR_PRICE, DISCOUNT_AMOUNT, COUPON_AMOUNT, QUANTITY,
  TEST_CARD, BILLING,
  assert, getPage, getCounters, wcApi, setCheckoutType, loginAsAdmin,
  applyCheckoutCoupon, applyBlocksCoupon,
  setup, teardown, testOrderStatus, run,
  getProductId, findOrdersByConektaOrderId, submitClassicCheckoutRaw, submitBlocksCheckoutRaw, PAID_STATUSES,
  INTEGRATION_CONTAINER, waitForIntegrationIframe, simulateFinalizePaymentClassic,
  fillIntegrationCard, clickPlaceOrder, waitForCheckoutStable, waitForOrderReceivedWith3DS,
};
