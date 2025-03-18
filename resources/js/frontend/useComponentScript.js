
export const useComponentScript = () => {
  const loadScript = (publicKey, locale, conektaSubmitFunction, tokenEmitter)=>{
    const script = document.createElement('script');
        script.src = "https://pay.stg.conekta.io/v1.0/js/conekta-checkout.min.js";
        script.async = true;
        script.onload = () => {
            const config = {
                targetIFrame: "#conektaIframeContainer",
                publicKey,
                locale,
                useExternalSubmit: true,
                checkoutRequestId: '3786c62f-c0e7-453a-8a57-f2d095d13528'
            };
            const callbacks = {
                onCreateTokenError: function (error) {
                    tokenEmitter.setError(error);
                },
                onFormError: function (error) {
                    tokenEmitter.setError({...error, isFormError: true});
                },
                onFinalizePayment: function (order) {
                    console.log('success: ', order);
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
