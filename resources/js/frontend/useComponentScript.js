
export const useComponentScript = () => {
  const loadScript = (publicKey, conektaSubmitFunction, tokenEmitter)=>{
    const script = document.createElement('script');
        script.src = "https://pay.stg.conekta.io/v1.0/js/conekta-checkout.min.js";
        script.async = true;
        script.onload = () => {
            const config = {
                targetIFrame: "#conektaIframeContainer",
                publicKey,
                locale: 'es',
                useExternalSubmit: true,
            };
            const callbacks = {
                onCreateTokenSucceeded: function (token) {
                    tokenEmitter.setToken(token.id);
                },
                onCreateTokenError: function (error) {
                    console.log(error);
                },
                onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
                    conektaSubmitFunction.current = async () => {
                        console.log("Conekta submit function called");
                        try {
                            const result = await triggerSubmitFromExternalFunction();
                            return result;
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
                    callbacks,
                    allowTokenization: true,
                });
            }
        };

        return script;
  }
  return {loadScript}
}
