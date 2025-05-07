document.addEventListener("DOMContentLoaded", function () {
  window.initConektaIframe = function () {
    if (!window.ConektaCheckoutComponents) return;
    const container = document.querySelector("#conektaIframeContainer");
    if (!container || container.querySelector("iframe")) return;

    ConektaCheckoutComponents.Card({
      config: {
        targetIFrame: "#conektaIframeContainer",
        publicKey: conekta_settings.public_key,
        locale: "es",
        useExternalSubmit: true,
      },
      options: {
        autoResize: true,
        amount: conekta_settings.amount,
        enableMsi: conekta_settings.enable_msi === "yes",
        availableMsiOptions: conekta_settings.available_msi_options,
      },
      callbacks: {
        onCreateTokenSucceeded: function (token) {
          const form = document.querySelector("form.checkout");
          form.querySelector('[name="conekta_token"]').value = token.id;
          form.querySelector('[name="conekta_msi_option"]').value =
            sessionStorage.getItem("conekta_msi_option") || "1";

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
              "conekta_msi_option",
              event.value.monthlyInstallments
            );
          }
        },
        onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
          const form = document.querySelector("form.checkout");
          form._conektaSubmitFunction = triggerSubmitFromExternalFunction;

          if (!form._conektaSubmitListener) {
            const submitListener = async function (e) {
              const paymentMethod = document.querySelector(
                'input[name="payment_method"]:checked'
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
  };

  // Función para inicializar el iframe
  function initializeConektaIframe() {
    const selected = document.querySelector(
      'input[name="payment_method"]:checked'
    );
    if (selected && selected.value === "conekta") {
      // Esperar a que el script de Conekta esté cargado y el contenedor exista
      const checkReady = setInterval(() => {
        if (window.ConektaCheckoutComponents && document.querySelector("#conektaIframeContainer")) {
          window.initConektaIframe();
          clearInterval(checkReady);
        }
      }, 100);

      // Limpiar el intervalo después de 5 segundos para evitar bucles infinitos
      setTimeout(() => clearInterval(checkReady), 5000);
    }
  }

  // Esperar a que WooCommerce termine de renderizar el checkout
  const checkWooCommerceReady = setInterval(() => {
    if (document.querySelector("form.checkout")) {
      clearInterval(checkWooCommerceReady);
      // Inicializar al cargar la página
      initializeConektaIframe();
    }
  }, 100);

  // Limpiar el intervalo después de 5 segundos
  setTimeout(() => clearInterval(checkWooCommerceReady), 5000);

  // Escuchar cambios en el método de pago
  document.addEventListener("change", function (e) {
    if (e.target.name === "payment_method") {
      if (e.target.value === "conekta") {
        setTimeout(initializeConektaIframe, 100);
      }
    }
  });

  // Escuchar actualizaciones del checkout
  document.body.addEventListener("updated_checkout", function () {
    setTimeout(initializeConektaIframe, 100);
  });
});
