/**
 * E2E: Safari mobile (iOS) — the 3DS OTP challenge must be TAPPABLE.
 *
 * Regression for the helitemexico.com.mx report (2026-08): on iOS Safari the
 * classic checkout showed the 3DS challenge washed out under the plugin's
 * white loading overlay, and taps on the OTP input never landed — the customer
 * could not type the verification code.
 *
 * Root cause: the overlay covered form.checkout at z-index:1000 and the
 * Conekta iframe container was raised to z-index:1001 — but any theme ancestor
 * that creates a stacking context (transform / sticky / -webkit-overflow-
 * scrolling, common in mobile theme CSS) traps the container's z-index below
 * the overlay, so the overlay intercepts every tap. The fix makes the overlay
 * click-through (pointer-events:none) and blocks the rest of the form
 * per-element via the `conekta-processing` class instead.
 *
 * This spec runs on Playwright WEBKIT (the Safari engine) with iPhone
 * emulation, and INJECTS a transform on the payment box to reproduce the
 * merchant-theme stacking context deterministically. To guarantee a real
 * challenge (OTP UI) it combines card 4000000000001091 with
 * three_ds_mode='strict' on the Conekta order root — injected per-request by
 * patching the checkout's fetch (see step 0), so no store/gateway config
 * changes and the frictionless specs (2701 card) are unaffected. Flow:
 *
 *   1) Mount the classic checkout on iPhone-emulated WebKit.
 *   2) Inject the stacking-context CSS (simulates the merchant theme).
 *   3) Pay with the challenge card and wait for the OTP input to appear.
 *   4) THE REGRESSION ASSERTIONS, while the challenge is on screen:
 *      - the loading overlay computes pointer-events:none (click-through);
 *      - document.elementFromPoint at the OTP input's center resolves INSIDE
 *        #conektaITokenizerframeContainer — not to the overlay (this is
 *        exactly the hit-test a real tap performs);
 *      - the place-order button stays blocked (disabled + pointer-events:none
 *        from conekta-processing) while the challenge is up.
 *   5) Type the OTP through a REAL tap/click (Playwright's hit-target check
 *      fails if anything intercepts the tap), submit, and complete the order.
 *   6) Verify order-received + the Conekta order is paid.
 */
const h = require('./checkout-helpers');

const CHALLENGE_CARD = { ...h.TEST_CARD, number: '4000000000001091' };

// Same union the shared 3DS helper uses. The type="tel"/"number" catch-alls
// are safe here ONLY because the frame filter below restricts the search to
// 3DS challenge hosts — the Conekta component-frame's card-number input is
// also type=tel and must not be mistaken for the OTP.
const OTP_SELECTOR = [
  'input[placeholder*="ode" i]',
  'input[placeholder*="ódigo" i]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[autocomplete*="one-time"]',
  'input[type="tel"]',
  'input[type="number"]',
].join(', ');

// Hosts that serve the 3DS challenge UI (Conekta's 3DS pages on .com/.io and
// the Cardinal ACS the banks use) — shared with the other 3DS helpers.
const CHALLENGE_HOST_RE = h.CHALLENGE_HOST_RE;

/** Poll the 3DS challenge frames until an OTP-looking input is visible. */
async function waitForChallengeOtp(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      let hostname = '';
      try { hostname = new URL(frame.url()).hostname; } catch (_) { continue; }
      if (!CHALLENGE_HOST_RE.test(hostname)) continue;
      const otp = frame.locator(OTP_SELECTOR).first();
      if (await otp.isVisible({ timeout: 200 }).catch(() => false)) return otp;
    }
    if (page.url().includes('order-received')) {
      throw new Error('reached order-received without a challenge — card 1091 + three_ds_mode=strict were expected to force an OTP');
    }
    await page.waitForTimeout(500);
  }
  throw new Error('3DS challenge OTP input never appeared');
}

h.run('Safari mobile — 3DS OTP challenge is tappable under the loading overlay',
  { checkoutType: 'classic', browserName: 'webkit', device: 'iPhone 13' },
  async ({ page, assert, config, STORE_URL }) => {
    // ---------------------------------------------------------------
    // (0) force a 3DS challenge for THIS spec only: patch the checkout's
    //     fetch so the conekta_checkout_request POST carries
    //     three_ds_mode='strict'. The REST endpoint honors ONLY 'strict'
    //     (upgrade-only) and puts it on the Conekta order root — no store
    //     or gateway config involved, so the frictionless specs (2701 card,
    //     no challenge) are untouched.
    // ---------------------------------------------------------------
    await page.addInitScript(() => {
      const origFetch = window.fetch;
      window.fetch = (input, init) => {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('conekta_checkout_request') && init && typeof init.body === 'string') {
            const body = JSON.parse(init.body);
            body.three_ds_mode = 'strict';
            init = { ...init, body: JSON.stringify(body) };
          }
        } catch (_) { /* fall through with the original request */ }
        return origFetch(input, init);
      };
    });

    // ---------------------------------------------------------------
    // (1) mount the classic checkout on iPhone-emulated WebKit
    // ---------------------------------------------------------------
    console.log('--- (1) mount classic checkout (webkit / iPhone 13, three_ds_mode=strict) ---');
    const conektaOrderId = await h.classicCheckoutCreateOrder();

    // ---------------------------------------------------------------
    // (2) reproduce the merchant theme: a stacking context between the
    //     form and the iframe container. With the old z-index approach
    //     this alone made the overlay swallow every tap on the OTP.
    // ---------------------------------------------------------------
    await page.addStyleTag({
      content: `
        ul.wc_payment_methods li.payment_method_conekta .payment_box {
          transform: translateZ(0);
          -webkit-overflow-scrolling: touch;
        }
      `,
    });
    console.log('--- (2) injected theme-like stacking context on the payment box ---');

    // ---------------------------------------------------------------
    // (3) pay with the challenge card
    // ---------------------------------------------------------------
    console.log('--- (3) pay with 3DS challenge card 1091 ---');
    await h.waitForIntegrationIframe();
    await h.fillIntegrationCard(CHALLENGE_CARD);
    await h.clickPlaceOrder();

    const otp = await waitForChallengeOtp(page, config.timeouts.threeDs * 2);
    assert(true, '3DS challenge appeared (OTP input visible)');
    await otp.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    // ---------------------------------------------------------------
    // (4) regression assertions while the challenge is on screen
    // ---------------------------------------------------------------
    console.log('\n--- (4) overlay must not intercept taps ---');
    const overlayPointerEvents = await page.evaluate(() => {
      const overlay = document.querySelector('.conekta-loading-overlay');
      return overlay ? getComputedStyle(overlay).pointerEvents : 'no-overlay';
    });
    console.log(`  overlay pointer-events = ${overlayPointerEvents}`);
    assert(overlayPointerEvents !== 'auto',
      `loading overlay is click-through (pointer-events=${overlayPointerEvents})`);

    // The exact hit-test a tap performs: the topmost element at the OTP
    // input's center, seen from the top document, must be the Conekta iframe
    // (inside the container) — never the overlay. On the buggy build the
    // injected stacking context makes this return .conekta-loading-overlay.
    const box = await otp.boundingBox();
    assert(!!box, 'OTP input has a bounding box (rendered in the viewport)');
    if (box) {
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return {
          tag: el ? el.tagName : null,
          cls: el ? String(el.className).slice(0, 60) : null,
          isOverlay: !!(el && el.classList && el.classList.contains('conekta-loading-overlay')),
          inContainer: !!(el && el.closest && el.closest('#conektaITokenizerframeContainer')),
        };
      }, [box.x + box.width / 2, box.y + box.height / 2]);
      console.log(`  elementFromPoint(OTP center) = <${hit.tag} class="${hit.cls}">`);
      assert(!hit.isOverlay, 'tap at the OTP center does NOT land on the loading overlay');
      assert(hit.inContainer, 'tap at the OTP center lands inside the Conekta iframe container');
    }

    // The rest of the form must stay blocked while the challenge is up.
    const placeOrder = await page.evaluate(() => {
      const btn = document.querySelector('#place_order') ||
        document.querySelector('form.checkout button[type="submit"]');
      return btn ? { disabled: btn.disabled, pointerEvents: getComputedStyle(btn).pointerEvents } : null;
    });
    console.log(`  place-order state = ${JSON.stringify(placeOrder)}`);
    assert(placeOrder && placeOrder.disabled && placeOrder.pointerEvents === 'none',
      'place-order button stays blocked during the challenge (disabled + pointer-events:none)');

    // ---------------------------------------------------------------
    // (5) type the OTP through a REAL tap — Playwright's hit-target check
    //     fails the click if any element would intercept it
    // ---------------------------------------------------------------
    console.log('\n--- (5) tap + type the OTP for real ---');
    await otp.click({ timeout: 10000 });
    assert(true, 'real tap on the OTP input landed (no interceptor)');
    await otp.fill('').catch(() => {});
    await page.keyboard.type('1234', { delay: 100 });
    const typed = await otp.inputValue().catch(() => '');
    assert(typed.includes('1234') || typed.length >= 4, `OTP typed via keyboard (value="${typed}")`);

    // Submit: Enter first, then any submit-looking button in the same frame.
    await otp.press('Enter').catch(() => {});
    for (const frame of page.frames()) {
      const submit = frame.locator('button, input[type="submit"]')
        .filter({ hasText: /verificar|submit|enviar|confirmar|continuar|pagar/i }).first();
      if (await submit.isVisible({ timeout: 200 }).catch(() => false)) {
        await submit.click({ force: true }).catch(() => {});
        break;
      }
    }

    // The shared helper mops up navigation (and any re-shown challenge).
    await h.waitForOrderReceivedWith3DS();
    assert(page.url().includes('order-received'), 'reached order-received after the challenge');

    // ---------------------------------------------------------------
    // (6) the money actually moved
    // ---------------------------------------------------------------
    console.log('\n--- (6) Conekta order is paid ---');
    const conektaOrder = await h.waitForConektaPaid(conektaOrderId);
    assert(h.conektaOrderPaid(conektaOrder),
      `Conekta order ${conektaOrderId} paid (payment_status=${conektaOrder.payment_status})`);
  }).then(passed => process.exit(passed ? 0 : 1));
