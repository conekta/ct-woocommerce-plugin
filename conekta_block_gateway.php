<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Franklin Carrero
 * Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/


require_once(__DIR__ . '/vendor/autoload.php');

use Conekta\ApiException;
use Conekta\Model\OrderRequest;
use Conekta\Model\EventTypes;
use Conekta\Model\CustomerShippingContacts;

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
                self::handleOrderPaid($this->get_api_instance($this->settings['cards_api_key'],$this->version), $event);
                break;

            case EventTypes::ORDER_EXPIRED:
            case EventTypes::ORDER_CANCELED:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderExpiredOrCanceled($this->get_api_instance($this->settings['cards_api_key'],$this->version),$event);
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


    public function process_payment_api($context, $result) {
        global $woocommerce;
        $order = $context->order;
        if ($context->payment_method !== $this->id) {
            return;
        }

        $token_id = $context->payment_data['conekta_token'];
        if (empty($token_id)) {
            throw new \Exception('Token de pago no recibido.');
        }
        $data = ckpg_get_request_data($order);
        $items = $order->get_items();
        $line_items = ckpg_build_line_items($items, parent::ckpg_get_version());
        $discount_lines = ckpg_build_discount_lines($data);
        $shipping_lines = ckpg_build_shipping_lines($data);
        $shipping_contact = ckpg_build_shipping_contact($data);
        $taxes = $order->get_taxes();
        $tax_lines = ckpg_build_tax_lines($taxes);
        $customer_info = ckpg_build_customer_info($data);
        $order_metadata = ckpg_build_order_metadata($data + array(
                'plugin_conekta_version' => $this->version,
                'woocommerce_version' => $woocommerce->version,
                'payment_method' => $this->GATEWAY_NAME,
            ));
        $rq = new OrderRequest([
            'currency' => $data['currency'],
            'charges' => [
                [
                    'payment_method' => [
                        'type' => 'card',
                        'token_id' => $token_id,
                        'expires_at' => get_expired_at($this->settings['order_expiration']),
                        'customer_ip_address' => $this->get_user_ip(),
                    ],
                    'reference_id' => strval($order->get_id()),
                ]
            ],
            //"three_ds_mode"=> "strict",    // todo if you want to use 3DS
            //"return_url"=> $this->get_return_url( $order ), // todo if you want to use 3DS
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

        try {
            $orderCreated = $this->get_api_instance($this->settings['cards_api_key'],$this->version)->createOrder($rq, $this->get_user_locale());
            $order->update_status('pending', __('Awaiting the conekta payment', 'woocommerce'));
            self::update_conekta_order_meta( $order, $orderCreated->getId(), 'conekta-order-id');
            $result->set_status( 'success' );
            $result->set_redirect_url($this->get_return_url( $order ));
            //$result->set_redirect_url($orderCreated->getNextAction()->getRedirectToUrl()->getUrl()); // todo if you want to use 3DS
        } catch (ApiException $e) {
            $description = $e->getMessage();
            $this->ckpg_mark_as_failed_payment($order);
            WC()->session->reload_checkout = true;
            $result->set_status( 'failure' );
            $result->set_payment_details( array_merge(
                $result->payment_details,
                [
                    'error' => $e->getResponseObject(),
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
