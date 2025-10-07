<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Franklin Carrero
 * Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/


require_once(__DIR__ . '/vendor/autoload.php');

use Conekta\Api\OrdersApi;
use Conekta\ApiException;
use Conekta\Configuration;
use Conekta\Model\OrderRequest;
use Conekta\Model\CustomerShippingContacts;
use Conekta\Model\EventTypes;

class WC_Conekta_Pay_By_Bank_Gateway extends WC_Conekta_Plugin
{
    protected $GATEWAY_NAME = "WC_Conekta_Pay_By_Bank_Gateway";
    protected $order = null;
    protected $currencies = array('MXN', 'USD');

    public $id;
    public $method_title;
    public $has_fields;
    public $title;
    public $description;
    public $api_key;
    public $webhook_url;

    /**
     * @throws ApiException
     * @throws Exception
     */
    public function __construct()
    {
        $this->id = 'conekta_pay_by_bank';
        $this->method_title = __('Conekta Pago Directo', 'Conekta pay by bank');
        $this->has_fields = true;
        $this->ckpg_init_form_fields();
        $this->init_settings();
        $this->title = $this->settings['title'];
        $this->description = $this->settings['description'];
        $this->icon        = $this->settings['alternate_imageurl'] ?
                                                $this->settings['alternate_imageurl'] :
                                                WP_PLUGIN_URL . "/" . plugin_basename( dirname(__FILE__))
                                                . '/images/bbva.png';
        $this->api_key = $this->settings['api_key'];
        $this->webhook_url = $this->settings['webhook_url'];

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        add_action('woocommerce_thankyou_' . $this->id, array($this, 'ckpg_thankyou_page'));
        add_action('woocommerce_api_wc_conekta_pay_by_bank', [$this, 'check_for_webhook']);
        add_action('woocommerce_email_before_order_table', array($this, 'ckpg_email_instructions'));
        add_action('woocommerce_email_before_order_table', array($this, 'ckpg_email_reference'));

        if (!$this->ckpg_validate_currency()) {
            $this->enabled = false;
        }

        if (empty($this->api_key)) {
            $this->enabled = false;
        }
        if (!empty($this->api_key)) {
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'configure_webhook'));
        }
    }

    public function configure_webhook()
    {
        $this->create_webhook($this->settings['api_key'], $this->settings['webhook_url']);
    }
    /**
     * @throws ApiException
     */
    public function check_for_webhook()
    {
        if (!isset($_SERVER['REQUEST_METHOD'])
            || ('POST' !== $_SERVER['REQUEST_METHOD'])
            || !isset($_GET['wc-api'])
            || ('wc_conekta_pay_by_bank' !== $_GET['wc-api'])
        ) {
            return;
        }

        $body = @file_get_contents('php://input');
        $event = json_decode($body, true);

        switch ($event['type']) {
            case EventTypes::WEBHOOK_PING:
                self::handleWebhookPing();
                break;

            case EventTypes::ORDER_PAID:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderPaid($this->get_api_instance($this->settings['api_key'], $this->version), $event);
                break;

            case EventTypes::ORDER_EXPIRED:
            case EventTypes::ORDER_CANCELED:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderExpiredOrCanceled($this->get_api_instance($this->settings['api_key'], $this->version), $event);
                break;
            default:
                break;
        }
    }

    /**
     * Output for the order received page.
     * @param string $order_id
     * @throws ApiException
     */
    function ckpg_thankyou_page($order_id)
    {
        $order = new WC_Order($order_id);
        $reference = get_post_meta($order->get_id(), 'conekta-reference', true);
        $redirectUrl = get_post_meta($order->get_id(), 'conekta-redirect-url', true);
        $deepLink = get_post_meta($order->get_id(), 'conekta-deep-link', true);

        if (!empty($reference)) {
            $isMobile = wp_is_mobile();
            $paymentUrl = $isMobile ? $deepLink : $redirectUrl;
            
            echo '<div class="woocommerce-info" style="margin-bottom: 20px;" id="bbva-payment-info">';
            echo '<p style="font-size: 16px; margin-bottom: 10px;"><strong>' . __('¡Estás a un paso de completar tu compra!', 'woothemes') . '</strong></p>';
            echo '<p id="bbva-redirect-message">' . __('Debes completar tu pago en la ventana de BBVA que se abrió automáticamente.', 'woothemes') . '</p>';
            
            if (!empty($paymentUrl)) {
                echo '<div id="bbva-manual-redirect" style="display: none;">';
                echo '<p>' . __('Si la ventana no se abrió, haz clic en el botón de abajo:', 'woothemes') . '</p>';
                echo '<p style="text-align: center; margin-top: 15px;">';
                echo '<a href="' . esc_url($paymentUrl) . '" target="_blank" rel="noopener noreferrer" class="button" style="font-size: 16px; padding: 12px 24px;" id="bbva-pay-button">';
                echo __('Ir a BBVA para Pagar', 'woothemes');
                echo '</a>';
                echo '</p>';
                echo '</div>';
                
                echo '<script type="text/javascript">
                    (function() {
                        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        var redirectUrl = ' . json_encode($redirectUrl) . ';
                        var deepLink = ' . json_encode($deepLink) . ';
                        var paymentUrl = isMobile ? deepLink : redirectUrl;
                        
                        if (paymentUrl) {
                            setTimeout(function() {
                                var newWindow = window.open(paymentUrl, "_blank", "noopener,noreferrer");
                                
                                if (!isMobile && (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined")) {
                                    var manualRedirect = document.getElementById("bbva-manual-redirect");
                                    var redirectMessage = document.getElementById("bbva-redirect-message");
                                    
                                    if (manualRedirect) {
                                        manualRedirect.style.display = "block";
                                        if (redirectMessage) {
                                            redirectMessage.style.display = "none";
                                        }
                                    }
                                }
                            }, 500);
                        }
                    })();
                </script>';
            }
            
            echo '<hr style="margin: 20px 0;">';
            echo '<p><strong>' . __('Referencia de Pago', 'woothemes') . ':</strong> ' . esc_html($reference) . '</p>';
            echo '</div>';
        }
    }


    public function ckpg_init_form_fields()
    {
        $this->form_fields = array(
            'enabled' => array(
                'type' => 'checkbox',
                'title' => __('Habilitar/Deshabilitar', 'woothemes'),
                'label' => __('Habilitar Conekta', 'woothemes'),
                'default' => 'yes'
            ),
            'title' => array(
                'type' => 'text',
                'title' => __('Título', 'woothemes'),
                'description' => __('', 'woothemes'),
                'default' => __('Pago Directo BBVA', 'woothemes'),
                'required' => true
            ),
            'description' => array(
                'type' => 'text',
                'title' => __('Descripción', 'woothemes'),
                'description' => __('', 'woothemes'),
                'default' => __('Paga desde la App BBVA al instante con tu cuenta, sin compartir datos bancarios. Para continuar, te llevaremos a un sitio seguro de BBVA.', 'woothemes'),
                'required' => true
            ),
            'api_key' => array(
                'type' => 'password',
                'title' => __('Conekta API key', 'woothemes'),
                'description' => __('API Key Producción (Tokens/Llaves Privadas)', 'woothemes'),
                'default' => __('', 'woothemes'),
                'required' => true
            ),
            'order_expiration' => array(
                'type' => 'number',
                'title' => __('Vencimiento de las órdenes de pago (Minutos)', 'woothemes'),
                'description' => __('La cantidad de minutos configurados en esta opción, corresponde al tiempo en el que la orden estará activa para ser pagada por el cliente desde el momento de su creación.', 'woothemes'),
                'default' => __(10),
                'custom_attributes' => array(
                    'min' => 10,
                    'max' => 1440,
                    'step' => 1
                ),
            ),
            'webhook_url' => array(
                'type' => 'text',
                'title' => __('URL webhook', 'woothemes'),
                'description' => __('URL webhook)', 'woothemes'),
                'default' => __(get_site_url() . '/?wc-api=wc_conekta_pay_by_bank'),
                'required' => true
            ),
            'alternate_imageurl' => array(
                'type'        => 'text',
                'title'       => __('Imagen alternativa para mostrar en el momento del pago, utilice una URL completa y envíela a través de https', 'woothemes'),
                'default'     => __('', 'woothemes')
            ),
            'instructions' => array(
                'title' => __( 'Instructions', 'woocommerce' ),
                'type' => 'textarea',
                'description' => __( 'Instructions that will be added to the thank you page and emails.', 'woocommerce' ),
                'default' =>__( 'Serás redirigido a BBVA para completar tu pago de forma segura.', 'woocommerce' ),
                'desc_tip' => true,
            ),
        );

    }
    /**
         * Add content to the WC emails.
         *
         * @access public
         * @param WC_Order $order
         * @param bool $sent_to_admin
         * @param bool $plain_text
         */
    public function ckpg_email_instructions( $order, $sent_to_admin = false, $plain_text = false ) {
        $instructions = $this->form_fields['instructions'];
        if ( $instructions && 'pending' === $order->get_status() ) {
            echo wpautop( wptexturize( esc_html($this->settings['instructions']) ) ) . PHP_EOL;
        }
    }
      /**
     * Add content to the WC emails.
     *
     * @access public
     * @param WC_Order $order
     */
    function ckpg_email_reference($order) {
        $reference = get_post_meta( $order->get_id(), 'conekta-reference', true );

        if (!empty($reference)) {
            echo '<p><h4><strong>'.esc_html(__('Referencia de Pago')).':</strong> ' . esc_html($reference) . '</h4></p>';
            echo '<p>'.esc_html(__('Tu pago ha sido procesado a través de BBVA Pago Directo.')).'</p>';
        }
    }

    public function ckpg_admin_options()
    {
        include_once('templates/pay_by_bank_admin.php');
    }

    public function payment_fields()
    {
        include_once('templates/pay_by_bank.php');
    }

    protected function ckpg_mark_as_failed_payment($order)
    {
        $order->add_order_note(
            sprintf(
                "%s conekta Payment Failed",
                $this->GATEWAY_NAME,
            )
        );
    }

    /**
     * @throws Exception
     */
    public function process_payment($order_id)
    {
        global $woocommerce;
        $order = new WC_Order($order_id);
        $data = ckpg_get_request_data($order);
        $items = $order->get_items();
        $taxes = $order->get_taxes();
        $fees = $order->get_fees();
        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];
        $fees_data = $fees_formatted['fees'];
        $tax_lines = ckpg_build_tax_lines($taxes);
        $tax_lines = array_merge($tax_lines, $fees_data);
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $discounts_data);
        $line_items = ckpg_build_line_items($items, parent::ckpg_get_version());
        $shipping_lines = ckpg_build_shipping_lines($data);
        $shipping_contact = ckpg_build_shipping_contact($data);
        $customer_info = ckpg_build_customer_info($data);
        $order_metadata = ckpg_build_order_metadata($data + array(
                'plugin_conekta_version' => $this->version,
                'woocommerce_version' => $woocommerce->version,
                'payment_method' => $this->GATEWAY_NAME,
            )
        );
        $orderData = [
            'line_items' => $line_items,
            'currency' => $data['currency'],
            'customer_info' => $customer_info,
            'metadata' => $order_metadata,
            'charges' => [
                [
                    'payment_method' => [
                        'type' => 'pay_by_bank',
                        'product_type' => 'bbva_pay_by_bank',
                        'expires_at' => get_expired_at_minutes($this->settings['order_expiration']),
                    ]
                ]
            ]
        ];
        
        if (!empty($shipping_contact)) {
            $orderData['shipping_contact'] = $shipping_contact;
        }
        
        if (!empty($shipping_lines)) {
            $orderData['shipping_lines'] = $shipping_lines;
        }
        
        if (!empty($discount_lines)) {
            $orderData['discount_lines'] = $discount_lines;
        }
        
        if (!empty($tax_lines)) {
            $orderData['tax_lines'] = $tax_lines;
        }
        
        $rq = new OrderRequest($orderData);
        try {
            $orderCreated = $this->get_api_instance($this->settings['api_key'], $this->version)->createOrder($rq);
            $order->update_status('pending', __('Awaiting BBVA payment authorization', 'woocommerce'));
            self::update_conekta_order_meta( $order, $orderCreated->getId(), 'conekta-order-id');
            
            $paymentMethod = $orderCreated->getCharges()->getData()[0]->getPaymentMethod();
            $redirectUrl = $paymentMethod->getRedirectUrl();
            $deepLink = $paymentMethod->getDeepLink();
            
            self::update_conekta_order_meta( $order, $redirectUrl, 'conekta-redirect-url');
            self::update_conekta_order_meta( $order, $deepLink, 'conekta-deep-link');
            self::update_conekta_order_meta( $order, $paymentMethod->getReference(), 'conekta-reference');
            
            // Add BBVA URLs as query parameters for JavaScript to intercept
            $thankYouUrl = add_query_arg(
                array(
                    'bbva_redirect_url' => urlencode($redirectUrl),
                    'bbva_deep_link' => urlencode($deepLink),
                    'auto_redirect' => '1'
                ),
                $this->get_return_url($order)
            );
            
            return array(
                'result' => 'success',
                'redirect' => $thankYouUrl
            );
        } catch (Exception $e) {
            $description = $e->getMessage();
            wc_add_notice(__('Error: ', 'woothemes') . $description, 'error');
            $this->ckpg_mark_as_failed_payment($order);
            return array(
                'result' => 'failure',
                'redirect' => ''
            );
        }

    }

    /**
     * Checks if woocommerce has enabled available currencies for plugin
     *
     * @access public
     * @return bool
     */
    public function ckpg_validate_currency(): bool
    {
        return in_array(get_woocommerce_currency(), $this->currencies);
    }
}

function ckpg_conekta_pay_by_bank_add_gateway($methods)
{
    $methods[] = 'WC_Conekta_Pay_By_Bank_Gateway';
    return $methods;
}

add_filter('woocommerce_payment_gateways', 'ckpg_conekta_pay_by_bank_add_gateway');

add_action('woocommerce_blocks_loaded', 'woocommerce_gateway_conekta_pay_by_bank_woocommerce_block_support');
function woocommerce_gateway_conekta_pay_by_bank_woocommerce_block_support()
{
    if (class_exists('Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType')) {
        require_once 'includes/blocks/class-wc-conekta-pay_by_bank-payments-blocks.php';
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function (Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry) {
                $payment_method_registry->register(new WC_Gateway_Conekta_Pay_By_Bank_Blocks_Support());
            }
        );
    }
}
