// Constants
const CONTAINER_SELECTOR = "#conektaIframeContainer";
const FORM_SELECTOR = "form.checkout";
const PAYMENT_METHOD_SELECTOR = 'input[name="payment_method"]:checked';
const MSI_STORAGE_KEY = "conekta_msi_option";
const DEFAULT_MSI = "1";
const POLLING_INTERVAL = 100;
const MAX_WAIT_TIME = 5000;

// Utilities
const utils = {
  getSelectedPaymentMethod: () =>
    document.querySelector(PAYMENT_METHOD_SELECTOR),
  isConektaSelected: () => {
    const selected = utils.getSelectedPaymentMethod();
    return selected && selected.value === "conekta";
  },
  waitForElement: (selector, callback, maxWaitTime = MAX_WAIT_TIME) => {
    const startTime = Date.now();
    const checkElement = setInterval(() => {
      if (document.querySelector(selector)) {
        clearInterval(checkElement);
        callback();
      } else if (Date.now() - startTime > maxWaitTime) {
        clearInterval(checkElement);
        console.warn(`Timeout waiting for element: ${selector}`);
      }
    }, POLLING_INTERVAL);
  },
  getTranslation: (key) => {
    const locale = conekta_settings.locale || "es";
    return (
      window.CONEKTA_TRANSLATIONS?.[locale]?.[key] ||
      window.CONEKTA_TRANSLATIONS?.es?.[key] ||
      key
    );
  },
  setLoading: (isLoading) => {
    const form = document.querySelector(FORM_SELECTOR);
    if (!form || typeof jQuery === "undefined") return;

    const $form = jQuery(form);

    if (isLoading) {
      $form.block({
        message: null,
        overlayCSS: {
          background: "#fff",
          opacity: 0.6,
        },
      });
    } else {
      $form.unblock();
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
  }
};

// Form handling
const formHandler = {
  submitForm: async (formData) => {
    try {
      utils.setLoading(true);
      const response = await fetch(
        window.location.origin + wc_checkout_params.checkout_url,
        {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        }
      );
      const data = await response.json();

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
          wrapper.innerHTML = data.messages;

          form.prepend(wrapper);
          wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } catch (error) {
      utils.setLoading(false);
      utils.showErrorMessage(utils.getTranslation("form_error"));
    }
  },

  setupSubmitListener: (form, triggerSubmitFunction) => {
    if (form._conektaSubmitListener) {
      form.removeEventListener("submit", form._conektaSubmitListener, true);
    }

    const submitListener = async (e) => {
      if (!utils.isConektaSelected()) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        utils.setLoading(true);
        await triggerSubmitFunction();
      } catch (error) {
        console.error("Error in submit function:", error);
        utils.setLoading(false);
        if (error.message !== 'Can not send postrobot_method. Target window is closed') {
          utils.showErrorMessage(utils.getTranslation("form_error"));
        }
      }
    };

    form._conektaSubmitListener = submitListener;
    form.addEventListener("submit", submitListener, true);
  },
};

// Conekta configuration
const conektaConfig = {
  getConfig: () => ({
    targetIFrame: CONTAINER_SELECTOR,
    publicKey: conekta_settings.public_key,
    locale: conekta_settings.locale || "es",
    useExternalSubmit: true,
  }),

  getOptions: () => ({
    autoResize: true,
    amount: Number(conekta_settings.amount),
    enableMsi: conekta_settings.enable_msi === "yes",
    availableMsiOptions: conekta_settings.available_msi_options,
  }),

  getCallbacks: () => ({
    onCreateTokenSucceeded: (token) => {
      const form = document.querySelector(FORM_SELECTOR);
      form.querySelector('[name="conekta_token"]').value = token.id;
      form.querySelector('[name="conekta_msi_option"]').value =
        sessionStorage.getItem(MSI_STORAGE_KEY) || DEFAULT_MSI;

      const formData = new FormData(form);
      formData.append("wc-ajax", "checkout");
      formHandler.submitForm(formData);
    },

    onCreateTokenError: (error) => {
      utils.setLoading(false);
      utils.showErrorMessage(utils.getTranslation("token_error") + ": " + error.message);
    },

    onEventListener: (event) => {
      if (event.name === "monthlyInstallmentSelected" && event.value) {
        sessionStorage.setItem(
          MSI_STORAGE_KEY,
          event.value.monthlyInstallments
        );
      }
    },
    onFormError: () => {
      utils.setLoading(false);
    },
    onUpdateSubmitTrigger: (triggerSubmitFunction) => {
      const form = document.querySelector(FORM_SELECTOR);
      form._conektaSubmitFunction = triggerSubmitFunction;
      formHandler.setupSubmitListener(form, triggerSubmitFunction);
    },
  }),
};

// Conekta initialization
const conektaInitializer = {
  initConektaIframe: () => {
    if (!window.ConektaCheckoutComponents) return;
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    // If there's an existing iframe and it's working, don't reinitialize
    const existingIframe = container.querySelector("iframe");
    if (existingIframe && existingIframe.contentWindow) {
      return;
    }

    // If there's an iframe but it's not working, remove it
    if (existingIframe) {
      existingIframe.remove();
    }

    try {
      console.log("Initializing Conekta iframe...");
      ConektaCheckoutComponents.Card({
        config: conektaConfig.getConfig(),
        options: conektaConfig.getOptions(),
        callbacks: conektaConfig.getCallbacks(),
      });
    } catch (error) {
      console.warn("Error initializing Conekta:", error);
    }
  },

  initialize: () => {
    if (!utils.isConektaSelected()) return;

    const checkReady = setInterval(() => {
      if (
        window.ConektaCheckoutComponents &&
        document.querySelector(CONTAINER_SELECTOR)
      ) {
        conektaInitializer.initConektaIframe();
        clearInterval(checkReady);
      }
    }, POLLING_INTERVAL);

    setTimeout(() => clearInterval(checkReady), MAX_WAIT_TIME);
  },
};

// DOM observer
const domObserver = {
  observer: new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.removedNodes.forEach((node) => {
          if (
            node.id === CONTAINER_SELECTOR.replace("#", "") ||
            (node.querySelector && node.querySelector(CONTAINER_SELECTOR))
          ) {
            const form = document.querySelector(FORM_SELECTOR);
            if (form) {
              form._conektaSubmitFunction = null;
            }
          }
        });

        mutation.addedNodes.forEach((node) => {
          if (
            node.id === CONTAINER_SELECTOR.replace("#", "") ||
            (node.querySelector && node.querySelector(CONTAINER_SELECTOR))
          ) {
            conektaInitializer.initialize();
          }
        });
      }
    });
  }),

  start: (form) => {
    domObserver.observer.observe(form, { childList: true, subtree: true });
  },
};

// Main initialization
document.addEventListener("DOMContentLoaded", () => {
  // Wait for WooCommerce to finish rendering the checkout
  const checkWooCommerceReady = setInterval(() => {
    const form = document.querySelector(FORM_SELECTOR);
    if (form) {
      clearInterval(checkWooCommerceReady);
      conektaInitializer.initialize();
      domObserver.start(form);
    }
  }, POLLING_INTERVAL);

  setTimeout(() => clearInterval(checkWooCommerceReady), MAX_WAIT_TIME);

  // Event Listeners
  document.addEventListener("change", (e) => {
    if (e.target.name === "payment_method" && e.target.value === "conekta") {
      setTimeout(conektaInitializer.initialize, POLLING_INTERVAL);
    }
  });

  document.body.addEventListener("updated_checkout", () => {
    setTimeout(conektaInitializer.initialize, POLLING_INTERVAL);
  });
});
