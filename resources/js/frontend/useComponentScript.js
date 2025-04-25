
export const DEFAULT_MSI_OPTION = 1;
export const CONEKTA_MSI_OPTION_KEY = "conekta_msi_option";

export const useComponentScript = () => {
    const loadScript = (publicKey, locale, conektaSubmitFunction, tokenEmitter, enableMsi, amount) => {
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
            }
            const callbacks = {
                onCreateTokenSucceeded: function (token) {
                    tokenEmitter.setToken(token.id);
                },
                onCreateTokenError: function (error) {
                    tokenEmitter.setError(error);
                },
                onFormError: function (error) {
                    tokenEmitter.setError({ ...error, isFormError: true });
                },
                onGetInfoSuccess: function () {
                    sessionStorage.setItem(CONEKTA_MSI_OPTION_KEY, DEFAULT_MSI_OPTION);
                },
                onEventListener: function (event) {
                    if (event.name === "monthlyInstallmentSelected") {
                        sessionStorage.setItem(CONEKTA_MSI_OPTION_KEY, event.value.monthlyInstallments);
                    }
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
    return { loadScript }
}
