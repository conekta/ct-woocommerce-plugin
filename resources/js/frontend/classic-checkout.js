import { OrderEmitter } from './OrderEmitter';
import { loadConektaScript } from './loadConektaScript';

const CONTAINER_SELECTOR = "#conektaITokenizerframeContainer";
const FORM_SELECTOR = "form.checkout";
const PAYMENT_METHOD_SELECTOR = 'input[name="payment_method"]:checked';
const EMAIL_FIELD_SELECTOR = '#billing_email';
const POLLING_INTERVAL = 100;
const MAX_WAIT_TIME = 5000;
const REFRESH_DEBOUNCE_MS = 500;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const utils = {
  getSelectedPaymentMethod: () =>
    document.querySelector(PAYMENT_METHOD_SELECTOR),
  isConektaSelected: () => {
    const selected = utils.getSelectedPaymentMethod();
    return selected && selected.value === "conekta";
  },
  getTranslation: (key) => {
    const locale = conekta_settings.locale || "es";
    return (
      (window.CONEKTA_TRANSLATIONS &&
        window.CONEKTA_TRANSLATIONS[locale] &&
        window.CONEKTA_TRANSLATIONS[locale][key]) ||
      (window.CONEKTA_TRANSLATIONS &&
        window.CONEKTA_TRANSLATIONS.es &&
        window.CONEKTA_TRANSLATIONS.es[key]) ||
      key
    );
  },
  setLoading: (isLoading) => {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form) return;

    const placeOrderBtn =
      form.querySelector('#place_order') ||
      form.querySelector('button[type="submit"]');

    // The Conekta iframe must stay ABOVE the loading overlay: during the charge
    // the SDK can show a 3DS challenge (OTP modal) inside the iframe, and the
    // overlay (z-index 1000, covering the whole form) would otherwise intercept
    // every click/keystroke so the customer can't type the OTP. We raise the
    // iframe container above the overlay while keeping the rest of the form
    // greyed-out and the place-order button disabled.
    const container = document.querySelector(CONTAINER_SELECTOR);

    if (isLoading) {
      if (!form.querySelector('.conekta-loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'conekta-loading-overlay';
        overlay.style.cssText =
          'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.6);z-index:1000;';
        form.style.position = 'relative';
        form.appendChild(overlay);
      }
      if (container) {
        container.style.position = 'relative';
        container.style.zIndex = '1001';
      }
      if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
        placeOrderBtn.classList.add('conekta-disabled');
      }
    } else {
      const overlay = form.querySelector('.conekta-loading-overlay');
      if (overlay) overlay.remove();
      if (container) {
        container.style.zIndex = '';
      }
      if (placeOrderBtn) {
        placeOrderBtn.disabled = false;
        placeOrderBtn.classList.remove('conekta-disabled');
      }
    }
  },
  showErrorMessage: (message) => {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form) return;

    const existing = form.querySelector(".woocommerce-notices-wrapper");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "woocommerce-notices-wrapper";
    wrapper.innerHTML = `<div class="woocommerce-error">${message}</div>`;

    form.prepend(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  getBillingEmail: () => {
    const input = document.querySelector(EMAIL_FIELD_SELECTOR);
    return input ? input.value.trim() : "";
  },
  isValidEmail: (value) => EMAIL_REGEX.test(value || ""),
  showPlaceholder: () => {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;
    const message =
      utils.getTranslation('email_required') ||
      'Completa tu correo para ver el formulario de pago';
    container.innerHTML = `<div class="conekta-iframe-placeholder" style="padding:16px;color:#555;">${message}</div>`;
  },
  clearContainer: () => {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (container) container.innerHTML = "";
  }
};

const orderEmitter = new OrderEmitter();

const state = {
  currentScriptEl: null,
  currentCheckoutRequestId: null,
  // Conekta order id backing the mounted iframe (from checkout-request).
  // Sent as the hidden conekta_order_id on the checkout POST so the server
  // can resolve it even when its session state is unreachable — e.g. a guest
  // creating an account mid-checkout rotates the WC session and orphans the
  // transient. The server never trusts it blindly (live GET + amount check).
  currentConektaOrderId: null,
  refreshTimer: null,
  inflight: false,
  payingInProgress: false,
  // Conekta order id we've already submitted/confirmed. The SDK can emit the
  // finalized-order event more than once (a re-fired 3DS/finalize callback);
  // we act on each Conekta order only ONCE so a single payment never
  // completes two WC orders.
  submittedOrderId: null,
  // Set when wc-ajax=checkout came back with conekta_pending_payment: the WC
  // order now exists (pending) and the SDK charge is about to run. onOrder
  // uses this to confirm THAT order via the confirm endpoint.
  pendingConfirm: null, // { orderId, orderKey }
};

const renderCheckoutMessages = (html) => {
  const form = document.querySelector(FORM_SELECTOR);
  if (!form) return;
  const existing = form.querySelector(".woocommerce-notices-wrapper");
  if (existing) existing.remove();

  const wrapper = document.createElement("div");
  wrapper.className = "woocommerce-notices-wrapper";
  wrapper.innerHTML =
    html || `<div class="woocommerce-error">${utils.getTranslation('form_error')}</div>`;

  form.prepend(wrapper);
  wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const formHandler = {
  // Order-first flow: this POST creates (or reuses) the WC order BEFORE any
  // charge. Three outcomes:
  //  - success + conekta_pending_payment: WC order created and linked; fire
  //    the SDK charge (3DS included) and let onOrder confirm it.
  //  - success + redirect (no flag): nothing left to charge — either the
  //    legacy wallet path or a resubmit whose Conekta order was already paid
  //    (process_payment completed it server-side). Just navigate.
  //  - failure: WC validation/stock/etc. rejected the checkout. No charge
  //    ever happened. Render WC's own messages and let the customer fix it.
  submitForm: async (formData) => {
    try {
      utils.setLoading(true);
      const response = await fetch(conekta_settings.checkout_url, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));

      if (data.result === "success" && data.conekta_pending_payment) {
        state.pendingConfirm = {
          orderId: data.order_id,
          orderKey: data.order_key,
        };
        // Keep the loading overlay up: the iframe stays interactive above it
        // (see setLoading) so the customer can complete a 3DS challenge.
        orderEmitter.submit();
        return;
      }

      if (data.result === "success") {
        window.location.href = data.redirect;
        return;
      }

      // The WC submit failed. Clear the dedup guard so a wallet retry can
      // resubmit with the same already-paid Conekta order.
      state.submittedOrderId = null;
      state.payingInProgress = false;
      utils.setLoading(false);
      renderCheckoutMessages(data.messages);
    } catch (error) {
      // Network/parse failure — clear guards so a retry can resubmit.
      state.submittedOrderId = null;
      state.payingInProgress = false;
      utils.setLoading(false);
      utils.showErrorMessage(utils.getTranslation("form_error"));
    }
  },

  // Final step of the order-first flow: the SDK charged the card, ask the
  // server to verify it against Conekta (paid + amount) and complete the WC
  // order created before the charge. Server-side it's idempotent, so a
  // repeated onOrder or a JS retry can call it again safely.
  confirmOrder: async (conektaOrderId) => {
    const pending = state.pendingConfirm;
    try {
      const response = await fetch(conekta_settings.confirm_url, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: conekta_settings.nonce,
          order_id: pending ? pending.orderId : 0,
          order_key: pending ? pending.orderKey : '',
          conekta_order_id: conektaOrderId,
        }),
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));

      if (data.success && data.redirect) {
        window.location.href = data.redirect;
        return;
      }

      // The charge went through but the confirm was rejected/failed. The WC
      // order exists (pending) and the webhook/reconciler will complete it —
      // tell the customer their payment was received so they don't pay twice.
      state.payingInProgress = false;
      utils.setLoading(false);
      utils.showErrorMessage(
        (data && data.message) || utils.getTranslation('form_error')
      );
    } catch (error) {
      // Network failure after a successful charge: allow a retry — clicking
      // "Place order" again reuses the same WC order, and process_payment
      // detects the Conekta order is already paid and completes it.
      state.submittedOrderId = null;
      state.payingInProgress = false;
      utils.setLoading(false);
      utils.showErrorMessage(utils.getTranslation("form_error"));
    }
  },
};

// Pull a billing/shipping address from the checkout form via FormData (the
// form's own field names) — no per-field DOM querying. WooCommerce doesn't
// sync the billing NAME to WC()->customer, so the server can't read it on its
// own; we send it so the Conekta order is (re)created with the real customer
// pre-payment (a paid order can't be updated afterwards).
const addressFromForm = (prefix) => {
  const form = document.querySelector(FORM_SELECTOR);
  if (!form) return {};
  const fd = new FormData(form);
  const out = {};
  ['first_name', 'last_name', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'].forEach((field) => {
    const value = fd.get(`${prefix}_${field}`);
    if (value) out[field] = String(value).trim();
  });
  return out;
};

const requestCheckout = async () => {
  const response = await fetch(conekta_settings.checkout_request_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce: conekta_settings.nonce,
      email: utils.getBillingEmail(),
      billing: addressFromForm('billing'),
      shipping: addressFromForm('shipping'),
      woocommerce_checkout_type: 'classic',
    }),
    credentials: 'same-origin',
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!response.ok || !data || data.success === false) {
    const err = new Error((data && data.message) || `HTTP ${response.status}`);
    err.code = data && data.code;
    throw err;
  }

  return data;
};

const mounter = {
  wireOrderListeners: () => {
    orderEmitter.onOrder(async (order) => {
      const form = document.querySelector(FORM_SELECTOR);
      if (!form) return;

      const orderId = (order && order.id) || "";
      // Ignore a repeated finalize event for an order we already handled —
      // the SDK can emit onOrder more than once, and acting twice could
      // apply a single Conekta payment to two WC orders.
      if (orderId && orderId === state.submittedOrderId) {
        mounter.wireOrderListeners();
        return;
      }
      state.submittedOrderId = orderId;

      // Card path (order-first): the WC order was already created by the
      // wc-ajax=checkout POST before the charge — pendingConfirm holds its
      // id/key. Just ask the server to verify with Conekta and complete it.
      if (state.payingInProgress && state.pendingConfirm) {
        formHandler.confirmOrder(orderId);
        mounter.wireOrderListeners();
        return;
      }

      // Wallet path (Apple Pay / Google Pay): the charge started inside the
      // iframe without going through "Place order", so no WC order exists
      // yet. Legacy flow: post the checkout now with the hidden
      // conekta_order_id; process_payment completes it server-side. If WC
      // rejects the submit, the order.paid webhook creates the order from
      // the Conekta payload (last-resort).
      const hidden = form.querySelector('[name="conekta_order_id"]');
      if (hidden) hidden.value = orderId;
      utils.setLoading(true);
      const formData = new FormData(form);
      formData.set("conekta_order_id", orderId);
      formData.append("wc-ajax", "checkout");
      formHandler.submitForm(formData);
      // OrderEmitter wipes listeners after each event; rebind for the next round.
      mounter.wireOrderListeners();
    });

    orderEmitter.onError((error) => {
      // Charge declined or SDK error. In the order-first flow the WC order
      // already exists as pending — a retry click re-posts the checkout and
      // WooCommerce reuses that same order (order_awaiting_payment).
      state.payingInProgress = false;
      state.pendingConfirm = null;
      utils.setLoading(false);
      utils.showErrorMessage(
        (error && error.message) || utils.getTranslation("form_error")
      );
      mounter.wireOrderListeners();
    });
  },

  mount: (checkoutRequestId) => {
    if (state.currentScriptEl && state.currentScriptEl.parentNode) {
      state.currentScriptEl.parentNode.removeChild(state.currentScriptEl);
      state.currentScriptEl = null;
    }
    utils.clearContainer();

    state.currentCheckoutRequestId = checkoutRequestId;
    const scriptEl = loadConektaScript(
      conekta_settings.public_key,
      checkoutRequestId,
      conekta_settings.locale || 'es',
      orderEmitter,
      (error) => {
        console.warn('Conekta script failed to load:', error);
        utils.showErrorMessage(utils.getTranslation('form_error'));
      },
      CONTAINER_SELECTOR
    );
    state.currentScriptEl = scriptEl;
    document.body.appendChild(scriptEl);

    mounter.wireOrderListeners();
  },

  unmount: () => {
    if (state.currentScriptEl && state.currentScriptEl.parentNode) {
      state.currentScriptEl.parentNode.removeChild(state.currentScriptEl);
    }
    state.currentScriptEl = null;
    state.currentCheckoutRequestId = null;
    orderEmitter.clearSubmit();
    utils.clearContainer();
  }
};

// Hook into WC classic's `checkout_place_order_<method>` jQuery filter to
// intercept the place-order click. Order-first flow: we post the real
// wc-ajax=checkout FIRST — WooCommerce runs its full validation and CREATES
// the order (pending) before any money moves. Only when that succeeds does
// formHandler.submitForm fire the SDK charge (conekta_pending_payment), and
// onOrder then confirms the already-existing WC order. A card can never be
// charged for an order WooCommerce refused to create.
const submitInterceptor = {
  attach: () => {
    if (!window.jQuery || submitInterceptor._attached) return;
    submitInterceptor._attached = true;

    const $ = window.jQuery;
    const $form = $(FORM_SELECTOR);

    $form.on('checkout_place_order_conekta', function () {
      if (!utils.isConektaSelected()) return true;
      if (state.payingInProgress) return false;
      if (!state.currentCheckoutRequestId) {
        utils.showErrorMessage(utils.getTranslation('form_error'));
        return false;
      }

      // HTML5 native gate: short-circuits empty required / bad pattern fields
      // without paying for the checkout roundtrip.
      const form = document.querySelector(FORM_SELECTOR);
      if (form && typeof form.checkValidity === 'function' && !form.checkValidity()) {
        if (typeof form.reportValidity === 'function') form.reportValidity();
        return false;
      }

      // Halt WC's native submission and drive the flow ourselves: create the
      // WC order first, then charge, then confirm.
      state.payingInProgress = true;
      state.pendingConfirm = null;
      utils.setLoading(true);

      // Send the Conekta order id along: the server prefers its own session
      // state but needs this fallback when the WC session rotates mid-request
      // (guest creating an account). See state.currentConektaOrderId.
      const hidden = form.querySelector('[name="conekta_order_id"]');
      if (hidden && state.currentConektaOrderId) {
        hidden.value = state.currentConektaOrderId;
      }

      const formData = new FormData(form);
      formData.append("wc-ajax", "checkout");
      formHandler.submitForm(formData);
      return false;
    });
  },
};

const orchestrator = {
  refresh: async () => {
    if (!utils.isConektaSelected()) return;
    // Never refresh/remount while a charge is in progress. A late
    // `updated_checkout` (a trailing update_order_review settling after the
    // customer hit "Realizar el pedido") would otherwise call mounter.mount(),
    // tear down + reload the iframe, and destroy an in-progress 3DS challenge
    // (the OTP modal disappears mid-authentication and the order never
    // completes). Confirmed via manual testing: with this guard the challenge
    // modal stays put through the whole 3DS flow.
    if (state.payingInProgress) return;
    if (!utils.isValidEmail(utils.getBillingEmail())) {
      utils.showPlaceholder();
      return;
    }
    if (state.inflight) return;

    state.inflight = true;
    utils.setLoading(true);

    try {
      const data = await requestCheckout();
      if (data.conekta_order_id) {
        state.currentConektaOrderId = data.conekta_order_id;
      }
      if (data.checkout_request_id) {
        // Remount when the amount changed OR when WC has wiped our iframe out
        // of the DOM (which it does on coupon apply, shipping change, etc. —
        // those re-render the entire checkout review block).
        const container = document.querySelector(CONTAINER_SELECTOR);
        const containerEmpty = !container || !container.querySelector('iframe');
        if (data.mode !== 'unchanged' || !state.currentCheckoutRequestId || containerEmpty) {
          mounter.mount(data.checkout_request_id);
        }
      }
    } catch (error) {
      if (error.code === 'missing_customer_email') {
        utils.showPlaceholder();
      } else {
        utils.showErrorMessage(error.message || utils.getTranslation('form_error'));
      }
    } finally {
      state.inflight = false;
      utils.setLoading(false);
    }
  },

  scheduleRefresh: () => {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      orchestrator.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const checkWooCommerceReady = setInterval(() => {
    const form = document.querySelector(FORM_SELECTOR);
    if (form) {
      clearInterval(checkWooCommerceReady);
      submitInterceptor.attach();
      orchestrator.refresh();
    }
  }, POLLING_INTERVAL);

  setTimeout(() => clearInterval(checkWooCommerceReady), MAX_WAIT_TIME);

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "payment_method") {
      if (e.target.value === "conekta") {
        setTimeout(orchestrator.refresh, POLLING_INTERVAL);
      } else {
        mounter.unmount();
      }
    }
  });

  // The email field can be replaced by WC AJAX renders, so delegate from document.
  const onEmailFieldChange = () => {
    if (!utils.isConektaSelected()) return;
    if (utils.isValidEmail(utils.getBillingEmail())) {
      if (!state.currentCheckoutRequestId) orchestrator.refresh();
    } else {
      mounter.unmount();
      utils.showPlaceholder();
    }
  };
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === 'billing_email') onEmailFieldChange();
  });
  document.addEventListener("blur", (e) => {
    if (e.target && e.target.id === 'billing_email') onEmailFieldChange();
  }, true);

  // WC fires `updated_checkout` via jQuery .trigger(), which doesn't always
  // dispatch a native event for custom names — listen on both paths so we
  // catch the cart refresh regardless of how it's emitted.
  if (window.jQuery) {
    window.jQuery(document.body).on('updated_checkout', orchestrator.scheduleRefresh);
  }
  document.body.addEventListener("updated_checkout", orchestrator.scheduleRefresh);
});
