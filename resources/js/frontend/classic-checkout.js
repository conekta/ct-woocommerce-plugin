// Constants
const CONTAINER_SELECTOR = "#conektaITokenizerframeContainer";
const THREE_DS_TIMEOUT = 60 * 1000; // igual que blocks
const FORM_SELECTOR = "form.checkout";
const PAYMENT_METHOD_SELECTOR = 'input[name="payment_method"]:checked';
const MSI_STORAGE_KEY = "conekta_msi_option";
const DEFAULT_MSI = "1";
const POLLING_INTERVAL = 100;
const MAX_WAIT_TIME = 5000;

// 3DS configuration
const is3dsEnabled = conekta_settings.three_ds_enabled === true || conekta_settings.three_ds_enabled === "yes" || conekta_settings.three_ds_enabled === "1";

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
        },
      });
      form.classList.add('three-ds-process');
    } else {
      $form.unblock();
      form.classList.remove('three-ds-process');
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

// 3DS handling
const threeDsHandler = {
  create3dsOrder: async (token, msiOption) => {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add nonce if available
      if (conekta_settings.wpApiNonce) {
        headers['X-WP-Nonce'] = conekta_settings.wpApiNonce;
      }
      
      // Get order_id from the checkout form if available
      const form = document.querySelector(FORM_SELECTOR);
      const orderId = form.querySelector('#order_id')?.value;
      
      const requestData = {
        token,
        msi_option: msiOption
      };
      
      // Add order_id if available
      if (orderId) {
        requestData.order_id = orderId;
      } else {
        // Extract billing data from checkout form for classic checkout
        const getBillingDataFromForm = () => {
          const billingData = {};
          
          // Get billing fields from form
          const billingFields = [
            'billing_first_name', 'billing_last_name', 'billing_company',
            'billing_address_1', 'billing_address_2', 'billing_city', 
            'billing_state', 'billing_postcode', 'billing_country',
            'billing_email', 'billing_phone'
          ];
          
          billingFields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input) {
              // Remove 'billing_' prefix for consistency with blocks
              const key = field.replace('billing_', '');
              billingData[key] = input.value || '';
            }
          });
          
          return billingData;
        };
        
        // Add classic checkout context data
        requestData.is_blocks_context = false; // This is classic checkout
        requestData.is_classic_context = true;
        
        // Get billing data from form
        const billingData = getBillingDataFromForm();
        if (Object.keys(billingData).length > 0) {
          requestData.billing_data = billingData;
        }

        // Get shipping data from form
        const getShippingDataFromForm = () => {
          const shippingData = {};
          
          // Get shipping fields from form
          const shippingFields = [
            'shipping_first_name', 'shipping_last_name', 'shipping_company',
            'shipping_address_1', 'shipping_address_2', 'shipping_city', 
            'shipping_state', 'shipping_postcode', 'shipping_country'
          ];
          
          shippingFields.forEach(field => {
            const input = form.querySelector(`[name="${field}"]`);
            if (input) {
              // Remove 'shipping_' prefix for consistency with blocks
              const key = field.replace('shipping_', '');
              shippingData[key] = input.value || '';
            }
          });
          
          return shippingData;
        };
        
        const shippingData = getShippingDataFromForm();
        if (Object.keys(shippingData).length > 0) {
          requestData.shipping_data = shippingData;
        }

        // Get shipping method from form
        const shippingMethodInput = form.querySelector('input[name^="shipping_method"]:checked');
        if (shippingMethodInput) {
          const methodValue = shippingMethodInput.value;
          let methodLabel = methodValue;
          let methodCost = 0;
          
          // Try to get label and cost from various sources
          const methodRow = shippingMethodInput.closest('tr, li, .wc-shipping-row');
          if (methodRow) {
            // Try to find label in the row
            const labelElement = methodRow.querySelector('label, .shipping-method-label, .shipping-name');
            if (labelElement) {
              methodLabel = labelElement.textContent.trim();
            }
            
            // Try to find cost in the row
            const costElement = methodRow.querySelector('.amount, .woocommerce-Price-amount, .shipping-cost');
            if (costElement) {
              const costText = costElement.textContent.replace(/[^\d.,]/g, '');
              methodCost = parseFloat(costText.replace(',', '.')) || 0;
            }
          }
          
          // If we still don't have cost, try to extract from label
          if (methodCost === 0 && methodLabel) {
            const costMatch = methodLabel.match(/(\d+[.,]\d+|\d+)/);
            if (costMatch) {
              methodCost = parseFloat(costMatch[1].replace(',', '.')) || 0;
            }
          }
          
          requestData.shipping_method = {
            id: methodValue,
            label: methodLabel,
            cost: methodCost
          };
        }

        // Add cart data from available settings
        if (conekta_settings.amount) {
          requestData.cart_data = {
            total: Number(conekta_settings.amount), // Convert to cents for Conekta API
            currency: conekta_settings.currency || 'MXN'
          };  
        }
      }
      
      const response = await fetch('/wp-json/conekta/v1/create-3ds-order', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData),
        credentials: 'same-origin'
      });
      
      if (!response.ok) {
        throw new Error(`Error creating 3DS order: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error creating 3DS order:', error);
      throw error;
    }
  },
  
  show3dsIframe: (url) => {
    return new Promise((resolve, reject) => {
      // Remove any existing iframe
      const existingIframe = document.getElementById('conekta3dsIframe');
      if (existingIframe) {
        existingIframe.parentNode.removeChild(existingIframe);
      }
      
      // Create modal container
      const conekta3dsContainer = document.createElement('div');
      conekta3dsContainer.id = 'conekta3dsContainer';
      conekta3dsContainer.classList.add('conekta-slide-in');
      const parentContainer = document.querySelector(CONTAINER_SELECTOR);
      if (!parentContainer) {
        console.error('Target container for 3DS not found');
        reject(new Error('No se encontró el contenedor para 3DS'));
        return;
      }

      if (getComputedStyle(parentContainer).position === 'static') {
        parentContainer.style.position = 'relative';
        parentContainer.style.zIndex = '9999';
      }

      conekta3dsContainer.style.position = 'absolute';
      conekta3dsContainer.style.top = '0';
      conekta3dsContainer.style.left = '0';
      conekta3dsContainer.style.right = '0';
      conekta3dsContainer.style.bottom = '0';
      conekta3dsContainer.style.display = 'flex';
      conekta3dsContainer.style.justifyContent = 'center';
      conekta3dsContainer.style.alignItems = 'center';
      conekta3dsContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
      conekta3dsContainer.style.zIndex = '999';
      
      // Create iframe
      const iframe = document.createElement('iframe');
      iframe.id = 'conekta3dsIframe';
      iframe.src = `${url}?source=embedded`;
      iframe.style.width = '95%';
      iframe.style.maxWidth = '600px';
      iframe.style.height = '650px';
      iframe.style.maxHeight = '95%';
      iframe.style.border = 'none';
      iframe.style.backgroundColor = 'white';
      iframe.style.borderRadius = '8px';
      
      conekta3dsContainer.appendChild(iframe);
      parentContainer.appendChild(conekta3dsContainer);
      
      // Listen for message event from iframe
      const messageHandler = (event) => {
        // Check that the origin is from Conekta
        if (event.origin === 'https://3ds-pay.conekta.com') {
          window.removeEventListener('message', messageHandler);
          conekta3dsContainer.classList.remove('conekta-slide-in');
          conekta3dsContainer.classList.add('conekta-slide-out');
          setTimeout(()=>{
            conekta3dsContainer.remove();
          },300);
          
          if (event.data.error || event.data.payment_status !== 'paid') {
            reject(new Error('3DS authentication failed'));
          } else {
            resolve({
              order_id: event.data.order_id,
              payment_status: event.data.payment_status
            });
          }
        }
      };
      
      window.addEventListener('message', messageHandler);
    });
  },
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
    onCreateTokenSucceeded: async (token) => {
      const form = document.querySelector(FORM_SELECTOR);
      const msiOption = sessionStorage.getItem(MSI_STORAGE_KEY) || DEFAULT_MSI;
      
      // Set token and MSI option in the form
      form.querySelector('[name="conekta_token"]').value = token.id;
      form.querySelector('[name="conekta_msi_option"]').value = msiOption;
      
      // If 3DS is enabled, create order with 3DS
      if (is3dsEnabled) {
        try {
          const orderResponse = await threeDsHandler.create3dsOrder(token.id, msiOption);
          
          // If next_action is present, authentication is required
          if (orderResponse.next_action) {
            // Show 3DS iframe
            const redirectUrl = orderResponse.next_action.redirect_url;
            
            try {
              // Show 3DS iframe and wait for result
              const authResult = await threeDsHandler.show3dsIframe(redirectUrl);
              
              // After successful 3DS authentication, add order data to form
              const formData = new FormData(form);
              formData.append("wc-ajax", "checkout");
              
              // Add 3DS order data to the form submission
              if (orderResponse.order_id) {
                formData.append("conekta_order_id", String(orderResponse.order_id));
              }
              if (orderResponse.woo_order_id) {
                formData.append("conekta_woo_order_id", String(orderResponse.woo_order_id));
              }
              if (authResult.payment_status) {
                formData.append("conekta_payment_status", String(authResult.payment_status));
              }
              formData.append("conekta_3ds_completed", "true");
              
              formHandler.submitForm(formData);
            } catch (error) {
              utils.setLoading(false);
              utils.showErrorMessage(utils.getTranslation("3ds_error") || "3D Secure authentication failed");
            }
          } else {
            // No 3DS authentication required, but add order data if available
            const formData = new FormData(form);
            formData.append("wc-ajax", "checkout");
            
            // Add order data to form submission
            if (orderResponse.order_id) {
              formData.append("conekta_order_id", String(orderResponse.order_id));
            }
            if (orderResponse.woo_order_id) {
              formData.append("conekta_woo_order_id", String(orderResponse.woo_order_id));
            }
            if (orderResponse.payment_status) {
              formData.append("conekta_payment_status", String(orderResponse.payment_status));
            }
            
            formHandler.submitForm(formData);
          }
        } catch (error) {
          utils.setLoading(false);
          utils.showErrorMessage(error.message || utils.getTranslation("token_error"));
        }
      } else {
        // Standard non-3DS flow
        const formData = new FormData(form);
        formData.append("wc-ajax", "checkout");
        formHandler.submitForm(formData);
      }
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

// Add 3DS translation if not exists
if (window.CONEKTA_TRANSLATIONS) {
  const locales = Object.keys(window.CONEKTA_TRANSLATIONS);
  locales.forEach(locale => {
    if (!window.CONEKTA_TRANSLATIONS[locale]['3ds_error']) {
      window.CONEKTA_TRANSLATIONS[locale]['3ds_error'] = 'Autenticación 3D Secure fallida';
    }
  });
}

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
