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

    if (isLoading) {
      if (!form.querySelector('.conekta-loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'conekta-loading-overlay';
        overlay.style.cssText =
          'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.6);z-index:1000;';
        form.style.position = 'relative';
        form.appendChild(overlay);
      }
      if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
        placeOrderBtn.classList.add('conekta-disabled');
      }
    } else {
      const overlay = form.querySelector('.conekta-loading-overlay');
      if (overlay) overlay.remove();
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
  refreshTimer: null,
  inflight: false,
  payingInProgress: false,
};

const formHandler = {
  submitForm: async (formData) => {
    try {
      utils.setLoading(true);
      const response = await fetch(conekta_settings.checkout_url, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));

      if (data.result === "success") {
        window.location.href = data.redirect;
      } else {
        utils.setLoading(false);
        const form = document.querySelector(FORM_SELECTOR);
        if (form) {
          const existing = form.querySelector(".woocommerce-notices-wrapper");
          if (existing) existing.remove();

          const wrapper = document.createElement("div");
          wrapper.className = "woocommerce-notices-wrapper";
          wrapper.innerHTML =
            data.messages ||
            `<div class="woocommerce-error">${utils.getTranslation('form_error')}</div>`;

          form.prepend(wrapper);
          wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } catch (error) {
      utils.setLoading(false);
      utils.showErrorMessage(utils.getTranslation("form_error"));
    }
  }
};

const requestCheckout = async () => {
  const response = await fetch(conekta_settings.checkout_request_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Email is the user's primary input for this request and isn't derivable
    // from WC()->customer when classic checkout fires before WC has run
    // update_order_review. Send it so the server can backfill the customer
    // email before snapshotting the cart for Conekta.
    body: JSON.stringify({
      nonce: conekta_settings.nonce,
      email: utils.getBillingEmail(),
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
      const hidden = form.querySelector('[name="conekta_order_id"]');
      if (hidden) hidden.value = (order && order.id) || "";

      // Discriminate the source: payingInProgress is set by submitInterceptor
      // when the user clicked "Realizar el pedido" (card path). If it's still
      // false here, the charge came from a wallet button inside the iframe
      // (Apple Pay / Google Pay) that bypassed our submitInterceptor — and
      // therefore bypassed the server-side validation gate. In that case we
      // must validate now or wc-ajax=checkout will silently reject the
      // form behind the SDK's success card.
      const cameFromWalletButton = !state.payingInProgress;
      if (cameFromWalletButton) {
        utils.setLoading(true);
        try {
          const errors = await submitInterceptor.fetchValidation(form);
          if (errors && errors.length) {
            submitInterceptor.renderValidationErrors(errors);
            utils.setLoading(false);
            mounter.wireOrderListeners();
            return;
          }
        } catch (_) {
          // Validation endpoint unreachable — fall through and submit anyway.
          // The customer has already been charged; better to attempt the WC
          // order than to strand them with a successful Conekta payment.
        }
      }

      const formData = new FormData(form);
      formData.append("wc-ajax", "checkout");
      formHandler.submitForm(formData).finally(() => {
        state.payingInProgress = false;
      });
      // OrderEmitter wipes listeners after each event; rebind for the next round.
      mounter.wireOrderListeners();
    });

    orderEmitter.onError((error) => {
      state.payingInProgress = false;
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
// intercept the place-order click. The filter fires BEFORE WC's server-side
// validation, so we re-run that validation explicitly via /checkout-request
// (validate mode) and only trigger the SDK charge when WC would let the
// order through. Without this gate the iframe could charge against a form
// WC was about to reject, leaving the customer paid for an order WC never
// created.
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
      // without paying for the validation roundtrip.
      const form = document.querySelector(FORM_SELECTOR);
      if (form && typeof form.checkValidity === 'function' && !form.checkValidity()) {
        if (typeof form.reportValidity === 'function') form.reportValidity();
        return false;
      }

      // From here we always halt WC's native submission and drive the rest
      // ourselves: server-side validation, then SDK charge, then formHandler
      // posts to wc-ajax=checkout to create the actual WC order.
      state.payingInProgress = true;
      utils.setLoading(true);
      submitInterceptor.runValidationAndCharge(form);
      return false;
    });
  },

  runValidationAndCharge: async (form) => {
    try {
      const errors = await submitInterceptor.fetchValidation(form);
      if (errors && errors.length) {
        submitInterceptor.renderValidationErrors(errors);
        state.payingInProgress = false;
        utils.setLoading(false);
        return;
      }
      orderEmitter.submit();
    } catch (err) {
      state.payingInProgress = false;
      utils.setLoading(false);
      utils.showErrorMessage(err.message || utils.getTranslation('form_error'));
    }
  },

  fetchValidation: async (form) => {
    const formData = {};
    if (form) {
      const fd = new FormData(form);
      fd.forEach((value, key) => { formData[key] = value; });
    }
    const res = await fetch(conekta_settings.checkout_request_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: conekta_settings.nonce,
        validate: 1,
        form_data: formData,
      }),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (data && Array.isArray(data.errors)) return data.errors;
    if (!res.ok) throw new Error((data && data.message) || `HTTP ${res.status}`);
    return [];
  },

  renderValidationErrors: (errors) => {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form) return;
    const existing = form.querySelector('.woocommerce-notices-wrapper');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'woocommerce-notices-wrapper';
    const list = document.createElement('ul');
    list.className = 'woocommerce-error';
    list.setAttribute('role', 'alert');
    errors.forEach((e) => {
      const li = document.createElement('li');
      li.textContent = (e && e.message) || '';
      list.appendChild(li);
    });
    wrapper.appendChild(list);
    form.prepend(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
};

const orchestrator = {
  refresh: async () => {
    if (!utils.isConektaSelected()) return;
    if (!utils.isValidEmail(utils.getBillingEmail())) {
      utils.showPlaceholder();
      return;
    }
    if (state.inflight) return;

    state.inflight = true;
    utils.setLoading(true);

    try {
      const data = await requestCheckout();
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
