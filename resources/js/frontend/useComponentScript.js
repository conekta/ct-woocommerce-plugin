
export const useComponentScript = () => {
  const loadScript = (publicKey, locale, conekta_checkout_request_id, conektaSubmitFunction, tokenEmitter)=>{
    const script = document.createElement('script');
        script.src = "https://pay.stg.conekta.io/v1.0/js/conekta-checkout.min.js";
        script.async = true;
        script.onload = () => {
            const config = {
                targetIFrame: "#conektaIframeContainer",
                locale,
                publicKey,
                useExternalSubmit: true,
                checkoutRequestId: conekta_checkout_request_id
            };
            const callbacks = {
                onCreateTokenError: function (error) {
                    tokenEmitter.setError(error);
                },
                onFormError: function (error) {
                    tokenEmitter.setError({...error, isFormError: true});
                },
                onFinalizePayment: function (order) {
                    tokenEmitter.setToken(order.id);
                  },
                  onErrorPayment: function (error) {
                    tokenEmitter.setError(error);
                  },
                onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
                    conektaSubmitFunction.current = async () => {
                        try {
                            await triggerSubmitFromExternalFunction();
                        } catch (error) {
                            console.error("Error in submit function:", error);
                            throw error;
                        }
                    };
                },
            };
            if (window.ConektaCheckoutComponents) {
                window.ConektaCheckoutComponents.Integration({
                    config,
                    callbacks,
                    allowTokenization: true,
                });
            }
        };

        return script;
  }
  return {loadScript}
}
