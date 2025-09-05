<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Franklin Carrero
 * Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/


require_once(__DIR__ . '/vendor/autoload.php');

use Conekta\ApiException;
use Conekta\Model\ChargeRequest;
use Conekta\Model\ChargeRequestPaymentMethod;
use Conekta\Model\OrderRequest;
use Conekta\Model\EventTypes;
use Conekta\Model\CustomerShippingContacts;
use GuzzleHttp\Client;

class WC_Conekta_Gateway extends WC_Conekta_Plugin
{
    protected $GATEWAY_NAME = "WC_Conekta_Gateway";
    protected $order = null;
    protected $currencies = array('MXN', 'USD');

    public $id;
    public $method_title;
    public $has_fields;
    public $title;
    public $description;
    public $api_key;
    public $public_api_key;
    public $webhook_url;
    public $three_ds_enabled;
    public $three_ds_mode;

    /**
     * @throws ApiException|Exception
     */
    public function __construct()
    {
        $this->id = 'conekta';
        $this->method_title = __('Conekta Tarjetas', 'Conekta');
        $this->has_fields = true;
        $this->ckpg_init_form_fields();
        $this->init_settings();
        $this->title = $this->settings['title'];
        $this->description = $this->settings['description'];
        $this->icon        = $this->settings['alternate_imageurl'] ?
                                                $this->settings['alternate_imageurl'] :
                                                WP_PLUGIN_URL . "/" . plugin_basename( dirname(__FILE__))
                                                . '/images/credits.png';
        $this->api_key = $this->settings['cards_api_key'];
        $this->public_api_key = $this->settings['cards_public_api_key'];
        $this->webhook_url = $this->settings['webhook_url'];

        $this->three_ds_enabled = false;
        $this->three_ds_mode    = '';

        try {
            $request = $this->get_companies_api_instance($this->api_key, $this->version)->getCompanyRequest('current', $this->get_user_locale());
            $client = new Client();
            $response = $client->send($request);
            $body = (string) $response->getBody();
            $company = json_decode($body);		
            $this->three_ds_enabled = $company->three_ds_enabled;
            $this->three_ds_mode = $company->three_ds_mode;
        } catch (\Exception $e) {}

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        add_action('woocommerce_api_wc_conekta', [$this, 'check_for_webhook']);

        if (!$this->ckpg_validate_currency()) {
            $this->enabled = false;
        }

        if (empty($this->api_key)) {
            $this->enabled = false;
        }
        if (!empty($this->api_key)) {
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'configure_webhook'));
        }
        add_action('woocommerce_rest_checkout_process_payment_with_context', [$this, 'process_payment_api'], 10, 2);
    }

    /**
     * @throws Exception
     */
    public function configure_webhook()
    {
        $this->create_webhook($this->settings['cards_api_key'], $this->settings['webhook_url']);
    }
    public function process_admin_options()
    {
        parent::process_admin_options();

        if (empty($this->get_option('cards_public_api_key'))) {
            WC_Admin_Settings::add_error(__('Error: La clave pública de Conekta es obligatoria.', 'woothemes'));
        }
        if (empty($this->get_option('cards_api_key'))) {
            WC_Admin_Settings::add_error(__('Error: La clave privada de Conekta es obligatoria.', 'woothemes'));
        }
    }
    /**
     * @throws ApiException
     */
    public function check_for_webhook()
    {
        if (!isset($_SERVER['REQUEST_METHOD'])
            || ('POST' !== $_SERVER['REQUEST_METHOD'])
            || !isset($_GET['wc-api'])
            || ('wc_conekta' !== $_GET['wc-api'])
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
                self::handleOrderPaid($this->get_api_instance($this->settings['cards_api_key'], $this->version), $event);
                break;

            case EventTypes::ORDER_EXPIRED:
            case EventTypes::ORDER_CANCELED:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderExpiredOrCanceled($this->get_api_instance($this->settings['cards_api_key'], $this->version), $event);
                break;
            default:
                break;
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
                'default' => __('Tarjeta', 'woothemes'),
                'required' => true
            ),
            'description' => array(
                'type' => 'text',
                'title' => __('Descripción', 'woothemes'),
                'description' => __('', 'woothemes'),
                'default' => __('Paga con tarjetas de débito, crédito y vales', 'woothemes'),
                'required' => true
            ),
            'cards_api_key' => array(
                'type'        => 'password',
                'title'       => __('Conekta API key', 'woothemes'),
                'description' => __('API Key Producción (Tokens/Llave Privada). Consulta más información en <a href="https://developers.conekta.com/docs/api-keys-producci%C3%B3n" target="_blank">la documentación oficial</a>.', 'woothemes'),
                'default'     => __('', 'woothemes'),
                'required'    => true
            ),
            'cards_public_api_key' => array(
                'type'        => 'password',
                'title'       => __('Conekta public API key', 'woothemes'),
                'description' => __('Public API Key Producción (Tokens/Llave Pública). Consulta más información en <a href="https://developers.conekta.com/docs/api-keys-pruebas" target="_blank">la documentación oficial</a>.', 'woothemes'),
                'required'    => true
            ),
            'order_expiration' => array(
                'type' => 'number',
                'title' => __('Vencimiento de las órdenes de pago (Días)', 'woothemes'),
                'description' => __('La cantidad de dīas configuradas en esta opción, corresponde al tiempo en el que la orden estará activa para ser pagada por el cliente desde el momento de su creación.', 'woothemes'),
                'default' => __(1),
                'custom_attributes' => array(
                    'min' => 1,
                    'max' => 30,
                    'step' => 1
                ),
            ),
            'is_msi_enabled' => array(
                'type' => 'checkbox',
                'title' => __('Meses sin Intereses', 'woothemes'),
                'label' => __('Habilitar Meses sin Intereses', 'woothemes'),
                'default' => 'no'
            ),
            'months' => array(
                'type' => 'multiselect',
                'title' => __('Meses sin intereses', 'woothemes'),
                'options' => array(
                    '3' => __('3', 'woothemes'),
                    '6' => __('6', 'woothemes'),
                    '9' => __('9', 'woothemes'),
                    '12' => __('12', 'woothemes'),
                    '18' => __('18', 'woothemes'),
                    '24' => __('24', 'woothemes'),
                ),
                'default' => array(),
                'class' => 'wc-enhanced-select',
                'css' => 'width: 400px;',
                'custom_attributes' => array(
                    'data-placeholder' => __('Seleccione opciones', 'woothemes'),
                    'multiple' => 'multiple'
                ),
            ),
            'webhook_url' => array(
                'type' => 'text',
                'title' => __('URL webhook', 'woothemes'),
                'description' => __('URL webhook)', 'woothemes'),
                'default' => __(get_site_url() . '/?wc-api=wc_conekta'),
                'required' => true
            ),
            'alternate_imageurl' => array(
                'type'        => 'text',
                'title'       => __('Imagen alternativa para mostrar en el momento del pago, utilice una URL completa y envíela a través de https', 'woothemes'),
                'default'     => __('', 'woothemes')
            )
        );

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

    public function payment_fields() {
        if (!empty($this->description)) {
            echo wpautop(wp_kses_post($this->description));
        }
        echo '<div id="conektaITokenizerframeContainer"></div>';
        echo '<input type="hidden" name="conekta_token" />';
        echo '<input type="hidden" name="conekta_msi_option" value="1" />';
    }

    /**
     * @throws Exception
     */
    public function process_payment_api($context, $result) {
        global $woocommerce;
        $order = $context->order;
        if ($context->payment_method !== $this->id) {
            return;
        }

        $token_id = $context->payment_data['conekta_token'];
        $msi_option = $context->payment_data['conekta_msi_option'];
        
        // Check if we have 3DS data
        $conekta_order_id = isset($context->payment_data['conekta_order_id']) ? $context->payment_data['conekta_order_id'] : null;
        $conekta_woo_order_id = isset($context->payment_data['conekta_woo_order_id']) ? $context->payment_data['conekta_woo_order_id'] : null;
        $is_3ds_completed = isset($context->payment_data['conekta_3ds_completed']) && $context->payment_data['conekta_3ds_completed'];
        
        if (empty($token_id)) {
            throw new Exception('Token de pago no recibido.');
        }
        
        $error_message = null;
        $success = false;
        
        // If we have a Conekta order ID from 3DS process, we need to check its status
        if (!empty($conekta_order_id)) {
            try {
                $conekta_api = $this->get_api_instance($this->settings['cards_api_key'], $this->version);
                $conekta_order = $conekta_api->getOrderById($conekta_order_id);
                
                // If there's a temporary order from 3DS, use that order's information
                if (!empty($conekta_woo_order_id) && $conekta_woo_order_id != $order->get_id()) {
                    $temp_order = wc_get_order($conekta_woo_order_id);
                    if ($temp_order) {
                        // Transfer data from temporary order to current order if needed
                        $conekta_order_meta = $temp_order->get_meta('conekta-order-id');
                        if ($conekta_order_meta) {
                            self::update_conekta_order_meta($order, $conekta_order_meta, 'conekta-order-id');
                        }

                        $temp_order->delete(true);
                    }
                } else {
                    // Update order meta in current order
                    self::update_conekta_order_meta($order, $conekta_order_id, 'conekta-order-id');
                }
                
                if ($conekta_order->getPaymentStatus() === 'paid') {
                    // Order is already paid, just update the status
                    $order->update_status('processing', __('Pago procesado con Conekta (3DS)', 'woocommerce'));
                    $success = true;
                } else if ($is_3ds_completed && $conekta_order->getPaymentStatus() === 'pending_payment') {
                    // Order needs to be captured
                    $conekta_api->ordersCreateCapture($conekta_order_id);
                    $order->update_status('processing', __('Pago capturado con Conekta (3DS)', 'woocommerce'));
                    $success = true;
                } else {
                    $error_message = 'El pago no pudo ser procesado. Estado: ' . $conekta_order->getPaymentStatus();
                    $success = false;
                }
            } catch (\Exception $e) {
                $error_message = $e->getMessage();
                $success = false;
            }
        } else {
            // Standard payment flow without 3DS
            $success = $this->process_conekta_payment_for_order($order, $token_id, $msi_option, $error_message);
        }

        if ($success) {
            $result->set_status('success');
            $result->set_redirect_url($this->get_return_url($order));
        } else {
            wc_add_notice(__('Error: ', 'woothemes') . $error_message);
            WC()->session->reload_checkout = true;

            $result->set_status('failure');
            $result->set_payment_details(array_merge(
                $result->payment_details,
                [
                    'error' => $error_message,
                ]
            ));
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

    protected function process_conekta_payment_for_order($order, $token_id, $msi_option, &$error_message = null) {
        try {
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
                'woocommerce_version' => WC()->version,
                'payment_method' => $this->GATEWAY_NAME,
                ));

            $rq = new OrderRequest([
                'currency' => $data['currency'],
                'shipping_lines' => $shipping_lines,
                'discount_lines' => $discount_lines,
                'tax_lines' => $tax_lines,
                'customer_info' => $customer_info,
                'line_items' => $line_items,
                'metadata' => $order_metadata
            ]);
        
            if (!empty($shipping_contact)) {
                $rq->setShippingContact(new CustomerShippingContacts($shipping_contact));
            }
        
            $payment_method = new ChargeRequestPaymentMethod([
                'type' => 'card',
                'token_id' => $token_id,
                'expires_at' => get_expired_at($this->settings['order_expiration']),
                'customer_ip_address' => $this->get_user_ip()
            ]);
        
            if ($this->settings['is_msi_enabled'] == 'yes' && (int)$msi_option > 1) {
                $payment_method->setMonthlyInstallments((int)$msi_option);
            }
        
            $charge = new ChargeRequest([
                'payment_method' => $payment_method,
                'reference_id' => strval($order->get_id()),
            ]);
        
            $rq->setCharges([$charge]);
        
            $orderCreated = $this->get_api_instance($this->settings['cards_api_key'], $this->version)->createOrder($rq, $this->get_user_locale());
            $order->update_status('pending', __('Esperando el pago con Conekta', 'woocommerce'));
            self::update_conekta_order_meta($order, $orderCreated->getId(), 'conekta-order-id');
        
            return true;
        } catch (ApiException $e) {
            $this->ckpg_mark_as_failed_payment($order);
            
            $responseBody = json_decode($e->getResponseBody());
            $error_message = "Error al procesar el pago";
            
            $hasErrorDetails = $responseBody && 
                             property_exists($responseBody, 'details') && 
                             is_array($responseBody->details) && 
                             !empty($responseBody->details) &&
                             property_exists($responseBody->details[0], 'message');
            
            if ($hasErrorDetails) {
                $error_message = $responseBody->details[0]->message;
            }
            
            error_log($error_message);
            return false;
        }
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);
        
        $token_id = isset($_POST['conekta_token']) ? sanitize_text_field($_POST['conekta_token']) : null;
        $msi_option = isset($_POST['conekta_msi_option']) ? (int) $_POST['conekta_msi_option'] : 1;
        
        // Check if we have 3DS data from $_POST (modern approach) or session (fallback)
        $conekta_order_id = isset($_POST['conekta_order_id']) ? sanitize_text_field($_POST['conekta_order_id']) : WC()->session->get('conekta_3ds_order_id');
        $conekta_woo_order_id = isset($_POST['conekta_woo_order_id']) ? sanitize_text_field($_POST['conekta_woo_order_id']) : WC()->session->get('conekta_woo_order_id');
        $payment_status = isset($_POST['conekta_payment_status']) ? sanitize_text_field($_POST['conekta_payment_status']) : WC()->session->get('conekta_3ds_payment_status');
        $is_3ds_completed = isset($_POST['conekta_3ds_completed']) && $_POST['conekta_3ds_completed'] === 'true';
        
        // Clear session data
        WC()->session->__unset('conekta_3ds_order_id');
        WC()->session->__unset('conekta_woo_order_id');
        WC()->session->__unset('conekta_3ds_payment_status');
        
        if (!$token_id && !$conekta_order_id) {
            wc_add_notice(__('Error: No se recibió el token de Conekta.', 'woocommerce'), 'error');
            return ['result' => 'failure'];
        }
        
        $error_message = null;
        $success = false;
        
        // If we have a Conekta order ID from 3DS process, we need to check its status
        if (!empty($conekta_order_id)) {
            try {
                info_log("Classic Checkout - Processing 3DS order: {$conekta_order_id}, WooCommerce order: {$order_id}, Payment Status: {$payment_status}, 3DS Completed: " . ($is_3ds_completed ? 'true' : 'false'));
                
                $conekta_api = $this->get_api_instance($this->settings['cards_api_key'], $this->version);
                $conekta_order = $conekta_api->getOrderById($conekta_order_id);
                
                info_log("Classic Checkout - Conekta order status: " . $conekta_order->getPaymentStatus());
                
                // If there's a temporary order from 3DS, use that order's information
                if (!empty($conekta_woo_order_id) && $conekta_woo_order_id != $order_id) {
                    $temp_order = wc_get_order($conekta_woo_order_id);
                    if ($temp_order) {
                        // Transfer data from temporary order to current order
                        $conekta_order_meta = $temp_order->get_meta('conekta-order-id');
                        if ($conekta_order_meta) {
                            self::update_conekta_order_meta($order, $conekta_order_meta, 'conekta-order-id');
                        }

                        $temp_order->delete(true);
                    }
                } else {
                    // Update order meta in current order
                    self::update_conekta_order_meta($order, $conekta_order_id, 'conekta-order-id');
                }
                
                if ($conekta_order->getPaymentStatus() === 'paid') {
                    // Order is already paid, just update the status
                    $order->update_status('processing', __('Pago procesado con Conekta (3DS)', 'woocommerce'));
                    $success = true;
                    info_log("Classic Checkout - Order already paid, marked as processing");
                } else if (($payment_status === 'paid' || $is_3ds_completed) && $conekta_order->getPaymentStatus() === 'pending_payment') {
                    // Order needs to be captured
                    try {
                        info_log("Classic Checkout - Attempting to capture payment for order: {$conekta_order_id}");
                        $conekta_api->ordersCreateCapture($conekta_order_id);
                        $order->update_status('processing', __('Pago capturado con Conekta (3DS)', 'woocommerce'));
                        $success = true;
                        info_log("Classic Checkout - Payment captured successfully");
                    } catch (\Exception $e) {
                        $error_message = 'Error capturing payment: ' . $e->getMessage();
                        $success = false;
                        error_log("Classic Checkout - Error capturing payment: " . $e->getMessage());
                    }
                } else {
                    $error_message = 'El pago no pudo ser procesado. Estado: ' . $conekta_order->getPaymentStatus();
                    $success = false;
                    error_log("Classic Checkout - Payment failed. Conekta status: " . $conekta_order->getPaymentStatus() . ", Payment status: {$payment_status}, 3DS completed: " . ($is_3ds_completed ? 'true' : 'false'));
                }
            } catch (\Exception $e) {
                $error_message = $e->getMessage();
                $success = false;
            }
        } else {
            // Standard payment flow without 3DS
            $success = $this->process_conekta_payment_for_order($order, $token_id, $msi_option, $error_message);
        }

        if ($success) {
            return [
                'result'   => 'success',
                'redirect' => $this->get_return_url($order),
            ];
        } else {
            wc_add_notice(__('Error al procesar el pago con Conekta: ', 'woocommerce') . $error_message, 'error');
            return ['result' => 'failure'];
        }
    }
}

function ckpg_conekta_add_gateway($methods)
{
    $methods[] = 'WC_Conekta_Gateway';
    return $methods;
}

add_filter('woocommerce_payment_gateways', 'ckpg_conekta_add_gateway');
add_action('woocommerce_blocks_loaded', 'woocommerce_gateway_conekta_woocommerce_block_support');

function woocommerce_gateway_conekta_woocommerce_block_support()
{
    if (class_exists('Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType')) {
        require_once 'includes/blocks/class-wc-conekta-payments-blocks.php';
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function (Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry) {
                $payment_method_registry->register(new WC_Gateway_Conekta_Blocks_Support());
            }
        );
    }
}
