<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Franklin Carrero
 * Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/


require_once(__DIR__ . '/vendor/autoload.php');

use Conekta\Api\OrdersApi;
use \Conekta\Configuration;
use Conekta\Model\OrderRequest;
use Conekta\Model\EventTypes;
class WC_Conekta_Gateway extends WC_Conekta_Plugin
{
    protected $GATEWAY_NAME              = "WC_Conekta_Gateway";
    protected $order                     = null;
    protected $currencies                = array('MXN', 'USD');
    private const TIME_ZONE              = 'America/Mexico_City';

    public $id;
    public $method_title;
    public $has_fields;
    public $title;
    public $description;
    public $api_key;
    protected static OrdersApi $apiInstance;

    public function __construct() {
        $this->id = 'conekta';
        $this->method_title = __('Conekta', 'Conekta');
        $this->has_fields = true;
        $this->ckpg_init_form_fields();
        $this->init_settings();
        $this->title       = $this->settings['title'];
        $this->description = 'Paga con tarjeta de crédito, débito, efectivo o transferencia bancaria.';
        $this->api_key     = $this->settings['api_key'];
     
        add_action( 'woocommerce_update_options_payment_gateways_'.$this->id,array($this, 'process_admin_options'));
        add_action( 'woocommerce_thankyou_' . $this->id, array( $this, 'ckpg_thankyou_page'));
        add_action( 'woocommerce_api_wc_conekta', [ $this, 'check_for_webhook' ] );
        if (!$this->ckpg_validate_currency()) {
            $this->enabled = false;
        }

        if(empty($this->api_key)) {
          $this->enabled = false;
        }

        // Configure Bearer authorization: bearerAuth
        $config = Configuration::getDefaultConfiguration()->setAccessToken($this->api_key);
        self::$apiInstance = new OrdersApi(null, $config);
    }

    public function check_for_webhook() {
		if ( ! isset( $_SERVER['REQUEST_METHOD'] )
			|| ( 'POST' !== $_SERVER['REQUEST_METHOD'] )
			|| ! isset( $_GET['wc-api'] )
			|| ( 'wc_conekta' !== $_GET['wc-api'] )
		) {
			return;
		}

        $body          = @file_get_contents('php://input');
        $event         = json_decode($body, true);
        
        switch ($event['type']) {
            case EventTypes::WEBHOOK_PING:
                $this->handleWebhookPing();
                break;

            case EventTypes::ORDER_PAID:
                $this->handleOrderPaid($event);
                break;

            case EventTypes::ORDER_EXPIRED:
            case EventTypes::ORDER_CANCELED:
                $this->handleOrderExpiredOrCanceled($event);
                break;

            default:
                break;
        }
    }
    private function handleOrderExpiredOrCanceled($event) {
        $conekta_order = $event['data']['object'];
        if (!$this->validate_reference_id($conekta_order)) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order id']);
            exit;
        }
        $order_id      = $conekta_order['metadata']['reference_id'];
        if (!$this->check_order_status($conekta_order['id'], array('expired', 'cancelled'))){
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status', 'conekta_order_id' => $order_id]);
            exit;
        }
        $order         = new WC_Order($order_id);
        $order->update_status('cancelled', 'Order expired in Conekta.');
        header('Content-Type: application/json');
        echo json_encode(['cancelled' => 'OK' , 'conekta_order_id' => $order_id]);
        exit;
    }

    private function handleOrderPaid($event) {
        $conekta_order = $event['data']['object'];
        if (!$this->validate_reference_id($conekta_order)) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order id']);
            exit;
        }
        $order_id      = $conekta_order['metadata']['reference_id'];

        if (!$this->check_order_status($conekta_order['id'], array('paid'))){
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status', 'conekta_order_id' => $order_id]);
            exit;
        }

        $order         = new WC_Order($order_id);
        $charge        = $conekta_order['charges']['data'][0];
        $paid_at       = date("Y-m-d", $charge['paid_at']);
        update_post_meta( $order->get_id(), 'conekta-paid-at', $paid_at);
        $order->payment_complete();
        $order->add_order_note("Payment completed in Conekta and notification of payment received");

        parent::ckpg_offline_payment_notification($order_id, $conekta_order['customer_info']['name']);

        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK']);
        exit;
    }
    private function validate_reference_id(array $conekta_order): bool {
        return isset($conekta_order['metadata']) && array_key_exists('reference_id', $conekta_order['metadata']);
    }
    private function handleWebhookPing() {
        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK']);
        exit;
    }

    private function check_order_status(string $conekta_order_id ,array $statuses): bool{
        $conekta_order_api = self::$apiInstance->getorderbyid($conekta_order_id);

        return in_array($conekta_order_api->getPaymentStatus(), $statuses);
    }
 
      /**
     * Output for the order received page.
     * @param string $order_id
     */
    function ckpg_thankyou_page($order_id) {
        $order = new WC_Order( $order_id );
        $conekta_order_id = get_post_meta( $order->get_id(), 'conekta-order-id', true );

        if (empty($conekta_order_id)) {
            return;
        }
        $conekta_order = self::$apiInstance->getorderbyid($conekta_order_id);

        foreach($conekta_order->getCharges()->getData() as $charge) {
            $payment_method = $charge->getPaymentMethod()->getObject();
            if ($payment_method == 'bank_transfer_payment') {
                $clabe = $charge->getPaymentMethod()->getClabe();
                $account_owner = $charge->getPaymentMethod()->getReceivingAccountNumber();
                echo '<p><h4><strong>'.__('Clabe').':</strong> ' .$clabe. '</h4></p>';
                echo '<p><h4><strong>'.esc_html(__('Beneficiario')).':</strong> '.esc_html($account_owner).'</h4></p>';
                echo '<p><h4><strong>'.esc_html(__('Banco Receptor')).':</strong>  Sistema de Transferencias y Pagos (STP)<h4></p>';
            }else if ($payment_method == 'cash_payment') {
                $reference = $charge->getPaymentMethod()->getReference();
                $barcode_url = $charge->getPaymentMethod()->getBarcodeUrl();
                echo '<p style="font-size: 30px"><strong>'.__('Referencia').':</strong> ' . $reference. '</p>';
                echo '<p><img src="'. esc_url($barcode_url) .'" alt="Código QR" style="border: 2px solid #000; margin: 10px; box-shadow: 3px 3px 10px rgba(0, 0, 0, 0.2);"></p>';
                echo '<p>Se cobrará una comisión adicional al momento de realizar el pago.</p>';
            }
        }
    }

    public function ckpg_init_form_fields()
    {
        $this->form_fields = array(
         'enabled' => array(
          'type'        => 'checkbox',
          'title'       => __('Habilitar/Deshabilitar', 'woothemes'),
          'label'       => __('Habilitar Conekta', 'woothemes'),
          'default'     => 'yes'
          ),
         'title' => array(
            'type'        => 'text',
            'title'       => __('Título', 'woothemes'),
            'description' => __('', 'woothemes'),
            'default'     => __('Paga con Conekta', 'woothemes'),
            'required'    => true
            ),
         'api_key' => array(
             'type'        => 'password',
             'title'       => __('Conekta API key', 'woothemes'),
             'description' => __('API Key Producción (Tokens/Llaves Privadas)', 'woothemes'),
             'default'     => __('', 'woothemes'),
             'required'    => true
        ),
         'order_expiration' => array(
            'type'        => 'number',
            'title'       => __('Vencimiento de las órdenes de pago (Días)', 'woothemes'),
            'description' => __('La cantidad de dīas configuradas en esta opción, corresponde al tiempo en el que la orden estará activa para ser pagada por el cliente desde el momento de su creación.', 'woothemes'),
            'default'     => __(1),
            'custom_attributes' => array(
                'min' => 1,
                'max' => 365,
                'step' => 1
            ),
        ),
        'is_cash_enabled' => array(
            'type'        => 'checkbox',
            'title'       => __('Efectivo', 'woothemes'),
            'label'       => __(' '),
            'default'     => 'no'
        ),
        'is_bank_transfer_enabled' => array(
            'type'        => 'checkbox',
            'title'       => __('Transferencia interbancaria', 'woothemes'),
            'label'       => __(' '),
            'default'     => 'no'
        ),
        'is_card_enabled' => array(
            'type'        => 'checkbox',
            'title'       => __('Tarjetas de crédito y débito', 'woothemes'),
            'label'       => __(' '),
            'default'     => 'no'
        ),
         'is_msi_enabled' => array(
            'type'        => 'checkbox',
            'title'       => __('Meses sin Intereses', 'woothemes'),
            'label'       => __('Habilitar Meses sin Intereses', 'woothemes'),
            'default'     => 'no'
         ),
         'months' => array(
            'type'        => 'multiselect',
            'title'       => __('Meses sin intereses', 'woothemes'),
            'options'     => array(
                '3' => __('3', 'woothemes'),
                '6' => __('6', 'woothemes'),
                '9' => __('9', 'woothemes'),
                '12' => __('12', 'woothemes'),
                '18' => __('18', 'woothemes'),
            ),
            'default'     => array(),
            'class'       => 'wc-enhanced-select',
            'css'         => 'width: 400px;',
            'custom_attributes' => array(
                'data-placeholder' => __('Seleccione opciones', 'woothemes'),
                'multiple' => 'multiple'
            ),
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

    protected function get_allowed_payment_methods(){
        $allowed_payment_methods = array();
        if (strcmp($this->settings['is_cash_enabled'], 'yes') == 0) {
            array_push($allowed_payment_methods, 'cash');
        }
        if (strcmp($this->settings['is_bank_transfer_enabled'], 'yes') == 0) {
            array_push($allowed_payment_methods, 'bank_transfer');
        }
        if (strcmp($this->settings['is_card_enabled'], 'yes') == 0) {
            array_push($allowed_payment_methods, 'card');
        }
        return $allowed_payment_methods;
    }

    protected function get_expired_at(){
        $timeZone = new DateTimeZone(self::TIME_ZONE);
        $currentDate = new DateTime('now', $timeZone);
        $daysToAdd = $this->settings['order_expiration'];
        $currentDate->add(new DateInterval("P{$daysToAdd}D"));
        return $currentDate->getTimestamp();
    }
    public function process_payment($order_id)
    {
        global $woocommerce;
        $order            = new WC_Order($order_id);
        $data             = ckpg_get_request_data($order);
        $redirect_url     = $this->get_return_url($order);
        $items            = $order->get_items();
        $line_items       = ckpg_build_line_items($items, parent::ckpg_get_version());
        $discount_lines   = ckpg_build_discount_lines($data);
        $shipping_lines   = ckpg_build_shipping_lines($data);
        $shipping_contact = ckpg_build_shipping_contact($data);
        $taxes            = $order->get_taxes();
        $tax_lines        = ckpg_build_tax_lines($taxes);
        $customer_info    = ckpg_build_customer_info($data);
        $order_metadata   = ckpg_build_order_metadata($data + array(
            'plugin_conekta_version' => $this->version,
            'woocommerce_version'   => $woocommerce->version
            )
        );
        $rq = new OrderRequest([
            'currency' =>$data['currency'],
            'checkout' => [
                'allowed_payment_methods'=> $this->get_allowed_payment_methods(),
                'success_url'=> $redirect_url,
                'failure_url'=> $redirect_url,
                'monthly_installments_enabled' => filter_var($this->settings['is_msi_enabled'], FILTER_VALIDATE_BOOLEAN),
                'monthly_installments_options' =>  array_map('intval', is_array($this->settings['months']) ? $this->settings['months'] : array()),
                'name' =>  sprintf('Compra de %s',  $customer_info['name']),
                'type' =>  'HostedPayment',
                'redirection_time' => 10,
                'expires_at' =>  $this->get_expired_at(),
            ],
            'shipping_lines'   => $shipping_lines,
            'discount_lines'   => $discount_lines,
            'shipping_contact' => $shipping_contact,
            'tax_lines'        => $tax_lines,
            'customer_info'    => $customer_info,
            'line_items'       => $line_items,
            'metadata'         => $order_metadata
        ]);
        try{
            $orderCreated = self::$apiInstance->createOrder($rq);
            update_post_meta($order->get_id(), 'conekta-order-id', $orderCreated->getId());
            $order->update_status('on-hold', __( 'Awaiting the conekta payment', 'woocommerce' ));
            return array(
                'result' => 'success',
                'redirect' => $orderCreated->getCheckout()->getUrl()
                );
        }
        catch(Exception $e){
            $description = $e->getMessage();
            wc_add_notice(__('Error: ', 'woothemes') . $description , $notice_type = 'error');
            $this->ckpg_mark_as_failed_payment($order);
            WC()->session->reload_checkout = true;
        }
       
    }

    /**
     * Checks if woocommerce has enabled available currencies for plugin
     *
     * @access public
     * @return bool
     */
    public function ckpg_validate_currency() {
        return in_array(get_woocommerce_currency(), $this->currencies);
    }
}

function ckpg_conekta_add_gateway($methods) {
    array_push($methods, 'WC_Conekta_Gateway');
    return $methods;
}

add_filter('woocommerce_payment_gateways', 'ckpg_conekta_add_gateway');

add_action( 'woocommerce_blocks_loaded',  'woocommerce_gateway_conekta_woocommerce_block_support' ) ;
function woocommerce_gateway_conekta_woocommerce_block_support() {
    if ( class_exists( 'Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType' ) ) {
        require_once 'includes/blocks/class-wc-conekta-payments-blocks.php';
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function( Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry ) {
                $payment_method_registry->register( new WC_Gateway_Conekta_Blocks_Support() );
            }
        );
    }
}