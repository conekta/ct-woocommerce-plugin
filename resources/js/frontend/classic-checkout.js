// Constantes
const CONTAINER_SELECTOR = "#conektaIframeContainer";
const FORM_SELECTOR = "form.checkout";
const PAYMENT_METHOD_SELECTOR = 'input[name="payment_method"]:checked';
const MSI_STORAGE_KEY = "conekta_msi_option";
const DEFAULT_MSI = "1";
const POLLING_INTERVAL = 100;
const MAX_WAIT_TIME = 5000;

document.addEventListener("DOMContentLoaded", function () {
  window.initConektaIframe = function () {
    if (!window.ConektaCheckoutComponents) return;
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (!container) return;

    // Si ya hay un iframe y está funcionando, no reinicializamos
    const existingIframe = container.querySelector("iframe");
    if (existingIframe && existingIframe.contentWindow) {
      return;
    }

    // Si hay un iframe pero no está funcionando, lo removemos
    if (existingIframe) {
      existingIframe.remove();
    }

    try {
      ConektaCheckoutComponents.Card({
        config: {
          targetIFrame: CONTAINER_SELECTOR,
          publicKey: conekta_settings.public_key,
          locale: "es",
          useExternalSubmit: true,
        },
        options: {
          autoResize: true,
          amount: Number(conekta_settings.amount),
          enableMsi: conekta_settings.enable_msi === "yes",
          availableMsiOptions: conekta_settings.available_msi_options,
        },
        callbacks: {
          onCreateTokenSucceeded: function (token) {
            const form = document.querySelector(FORM_SELECTOR);
            form.querySelector('[name="conekta_token"]').value = token.id;
            form.querySelector('[name="conekta_msi_option"]').value =
              sessionStorage.getItem(MSI_STORAGE_KEY) || DEFAULT_MSI;

            const formData = new FormData(form);
            formData.append("wc-ajax", "checkout");

            fetch(window.location.origin + "/?wc-ajax=checkout", {
              method: "POST",
              body: formData,
              credentials: "same-origin",
            })
              .then((response) => response.json())
              .then((data) => {
                if (data.result === "success") {
                  window.location.href = data.redirect;
                } else {
                  alert(data.messages || "Error al procesar el pago");
                }
              })
              .catch((error) => {
                console.error("Error:", error);
                alert("Error al procesar el pago");
              });
          },
          onCreateTokenError: function (error) {
            alert("Hubo un error al generar el token: " + error.message);
          },
          onEventListener: function (event) {
            if (event.name === "monthlyInstallmentSelected" && event.value) {
              sessionStorage.setItem(
                MSI_STORAGE_KEY,
                event.value.monthlyInstallments
              );
            }
          },
          onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
            const form = document.querySelector(FORM_SELECTOR);
            form._conektaSubmitFunction = triggerSubmitFromExternalFunction;

            if (!form._conektaSubmitListener) {
              const submitListener = async function (e) {
                const paymentMethod = document.querySelector(
                  PAYMENT_METHOD_SELECTOR
                );
                if (paymentMethod && paymentMethod.value === "conekta") {
                  e.preventDefault();
                  e.stopPropagation();

                  try {
                    await form._conektaSubmitFunction();
                  } catch (error) {
                    console.error("Error en submit function:", error);
                    alert("Hubo un error al procesar el pago: " + error.message);
                  }
                }
              };

              form._conektaSubmitListener = submitListener;
              form.addEventListener("submit", submitListener, true);
            }
          },
        },
      });
    } catch (error) {
      console.warn("Error al inicializar Conekta:", error);
    }
  };

  // Función para inicializar el iframe
  function initializeConektaIframe() {
    const selected = document.querySelector(PAYMENT_METHOD_SELECTOR);
    if (selected && selected.value === "conekta") {
      // Esperar a que el script de Conekta esté cargado y el contenedor exista
      const checkReady = setInterval(() => {
        if (window.ConektaCheckoutComponents && document.querySelector(CONTAINER_SELECTOR)) {
          window.initConektaIframe();
          clearInterval(checkReady);
        }
      }, POLLING_INTERVAL);

      // Limpiar el intervalo después de 5 segundos para evitar bucles infinitos
      setTimeout(() => clearInterval(checkReady), MAX_WAIT_TIME);
    }
  }

  // Observar cambios en el DOM para detectar cuando el contenedor se vuelve a montar
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.id === CONTAINER_SELECTOR.replace('#', '') || 
              (node.querySelector && node.querySelector(CONTAINER_SELECTOR))) {
            initializeConektaIframe();
          }
        });
      }
    });
  });

  // Esperar a que WooCommerce termine de renderizar el checkout
  const checkWooCommerceReady = setInterval(() => {
    const form = document.querySelector(FORM_SELECTOR);
    if (form) {
      clearInterval(checkWooCommerceReady);
      // Inicializar al cargar la página
      initializeConektaIframe();
      // Observar cambios en el formulario
      observer.observe(form, { childList: true, subtree: true });
    }
  }, POLLING_INTERVAL);

  // Limpiar el intervalo después de 5 segundos
  setTimeout(() => clearInterval(checkWooCommerceReady), MAX_WAIT_TIME);

  // Escuchar cambios en el método de pago
  document.addEventListener("change", function (e) {
    if (e.target.name === "payment_method") {
      if (e.target.value === "conekta") {
        setTimeout(initializeConektaIframe, POLLING_INTERVAL);
      }
    }
  });

  // Escuchar actualizaciones del checkout
  document.body.addEventListener("updated_checkout", function () {
    setTimeout(initializeConektaIframe, POLLING_INTERVAL);
  });
});
