<?php

/*
Plugin Name: Conekta Payment Gateway
Plugin URI: https://wordpress.org/plugins/conekta-payment-gateway/
Description: Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.
Version: 5.2.0
Requires at least: 6.6.2
Requires PHP: 7.4
Author: Conekta.io
Author URI: https://www.conekta.io
License: GNU General Public License v3.0
License URI: http://www.gnu.org/licenses/gpl-3.0.html
*/

/*
 * Title   : Conekta Payment Extension for WooCommerce
 * Author  : Conekta.io
 * Url     : https://www.conekta.io/es/docs/plugins/woocommerce
 */

function ckpg_conekta_checkout_init_your_gateway()
{
    if (class_exists('WC_Payment_Gateway'))
    {
    
        include_once('conekta_gateway_helper.php');
        include_once('conekta_plugin.php');
        include_once('conekta_block_gateway.php');
        include_once('conekta_cash_block_gateway.php');
        include_once('conekta_bnpl_block_gateway.php');
        include_once('conekta_bank_transfer_block_gateway.php');

    }
}

add_action('plugins_loaded', 'ckpg_conekta_checkout_init_your_gateway', 0);

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'plugin_action_links' );

function plugin_action_links( $links  ): array
{
    $plugin_links = [
        '<a href="admin.php?page=wc-settings&tab=checkout&section=conekta">' . esc_html__( 'Settings', 'WC_Conekta_Gateway' ) . '</a>',
    ];
    return array_merge( $plugin_links, $links );
}

add_action('wp_enqueue_scripts', 'ckpg_enqueue_classic_checkout_script');

function ckpg_enqueue_classic_checkout_script() {
    if (is_checkout() && ! is_wc_endpoint_url()) {
    $available_gateways = WC()->payment_gateways()->get_available_payment_gateways();

    if (isset($available_gateways['conekta'])) {
        wp_enqueue_script(
            'conekta-checkout-classic',
            'https://pay.conekta.com/v1.0/js/conekta-checkout.min.js',
            [],
            null,
            true
        );

        $settings = get_option('woocommerce_conekta_settings');
        wp_localize_script('conekta-checkout-classic', 'conekta_settings', [
            'public_key' => $settings['cards_public_api_key'] ?? '',
            'enable_msi' => $settings['is_msi_enabled'] ?? 'no',
            'available_msi_options' => $settings['months'] ?? [],
            'amount' => WC()->cart->get_total('edit') * 100,
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('conekta_payment_nonce'),
        ]);

        $js = <<<JS
                document.addEventListener('DOMContentLoaded', function () {
                    window.initConektaIframe = function () {
                        if (!window.ConektaCheckoutComponents) return;
                        const container = document.querySelector('#conektaIframeContainer');
                        if (!container || container.querySelector('iframe')) return;

                        ConektaCheckoutComponents.Card({
                        config: {
                            targetIFrame: '#conektaIframeContainer',
                            publicKey: conekta_settings.public_key,
                            locale: 'es',
                            useExternalSubmit: true
                        },
                        options: {
                            autoResize: true,
                            amount: conekta_settings.amount,
                            enableMsi: conekta_settings.enable_msi === 'yes',
                            availableMsiOptions: conekta_settings.available_msi_options
                        },
                        callbacks: {
                            onCreateTokenSucceeded: function (token) {
                                const form = document.querySelector('form.checkout');
                                
                                if (!form.querySelector('[name="conekta_token"]')) {
                                    const input = document.createElement('input');
                                    input.type = 'hidden';
                                    input.name = 'conekta_token';
                                    form.appendChild(input);
                                }
                                form.querySelector('[name="conekta_token"]').value = token.id;

                                const msi = sessionStorage.getItem('conekta_msi_option') || '1';
                                if (!form.querySelector('[name="conekta_msi_option"]')) {
                                    const msiInput = document.createElement('input');
                                    msiInput.type = 'hidden';
                                    msiInput.name = 'conekta_msi_option';
                                    form.appendChild(msiInput);
                                }
                                form.querySelector('[name="conekta_msi_option"]').value = msi;

                                const formData = new FormData(form);
                                formData.append('wc-ajax', 'checkout');

                                fetch(window.location.origin + '/?wc-ajax=checkout', {
                                    method: 'POST',
                                    body: formData,
                                    credentials: 'same-origin'
                                })
                                .then(response => response.json())
                                .then(data => {
                                    if (data.result === 'success') {
                                        window.location.href = data.redirect;
                                    } else {
                                        alert(data.messages || 'Error al procesar el pago');
                                    }
                                })
                                .catch(error => {
                                    console.error('Error:', error);
                                    alert('Error al procesar el pago');
                                });
                            },
                            onCreateTokenError: function (error) {
                                alert('Hubo un error al generar el token: ' + error.message);
                            },
                            onEventListener: function (event) {
                                if (event.name === 'monthlyInstallmentSelected' && event.value) {
                                    sessionStorage.setItem('conekta_msi_option', event.value.monthlyInstallments);
                                }
                            },
                            onUpdateSubmitTrigger: function (triggerSubmitFromExternalFunction) {
                                const form = document.querySelector('form.checkout');
                                form._conektaSubmitFunction = triggerSubmitFromExternalFunction;
                                if (!form._conektaSubmitListener) {
                                    const submitListener = async function(e) {
                                        const paymentMethod = document.querySelector('input[name="payment_method"]:checked');
                                        if (paymentMethod && paymentMethod.value === 'conekta') {
                                            e.preventDefault();
                                            e.stopPropagation();

                                            try {
                                                await form._conektaSubmitFunction();
                                            } catch (error) {
                                                console.error("Error en submit function:", error);
                                                alert('Hubo un error al procesar el pago: ' + error.message);
                                            }
                                        }
                                    };
                                    form._conektaSubmitListener = submitListener;
                                    form.addEventListener('submit', submitListener, true);
                                }
                            }
                        }
                        });
                    };

                    document.addEventListener('change', function (e) {
                        if (e.target.name === 'payment_method') {
                            if (e.target.value === 'conekta') {
                                setTimeout(function () {
                                    window.initConektaIframe && window.initConektaIframe();
                                }, 100);
                            }
                        }
                    });

                    document.body.addEventListener('updated_checkout', function () {
                        const selected = document.querySelector('input[name="payment_method"]:checked');
                        if (selected && selected.value === 'conekta') {
                            setTimeout(function () {
                                window.initConektaIframe && window.initConektaIframe();
                            }, 100);
                        }
                    });
                });
                JS;

        wp_add_inline_script('conekta-checkout-classic', $js);
        }
    }
}