
export const useComponentScript = () => {
  const loadScript = (publicKey, locale, conektaSubmitFunction, tokenEmitter, enableMsi, availableMsiOptions, amount)=>{
    const script = document.createElement('script');
        script.src = "https://pay.stg.conekta.io/v1.0/js/conekta-checkout.min.js";
        script.async = true;
        script.onload = () => {
            const config = {
                targetIFrame: "#conektaIframeContainer",
                publicKey,
                locale,
                useExternalSubmit: true,
            };
            const options = {
                amount,
                enableMsi,
                availableMsiOptions,
            }
            const callbacks = {
                onCreateTokenSucceeded: function (token) {
                    tokenEmitter.setToken(token.id);
                },
                onCreateTokenError: function (error) {
                    tokenEmitter.setError(error);
                },
                onFormError: function (error) {
                    tokenEmitter.setError({...error, isFormError: true});
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
                window.ConektaCheckoutComponents.Card({
                    config,
                    options,
                    callbacks,
                    allowTokenization: true,
                });
            }
        };

        return script;
  }
  return {loadScript}
}
