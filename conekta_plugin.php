<?php

/*
* Title   : Conekta Payment extension for WooCommerce
* Author  : Conekta.io
* Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/

use Conekta\Api\WebhooksApi;
use \Conekta\Configuration;
use \Conekta\Model\WebhookRequest;
use Conekta\Api\OrdersApi;
use Conekta\ApiException;
use Conekta\Api\CompaniesApi;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Client;

// Include REST API endpoints for 3DS
require_once(__DIR__ . '/conekta-rest-api.php');

class WC_Conekta_Plugin extends WC_Payment_Gateway
{
	public $version  = "5.4.14";
	public $name = "WooCommerce 2";
	public $description = "Payment Gateway via Conekta.io for WooCommerce: accepts credit, debit, cash, and monthly installments for Mexican credit cards.";
	public $plugin_name = "Conekta Payment Gateway for Woocommerce";
	public $plugin_URI = "https://wordpress.org/plugins/conekta-payment-gateway/";
	public $author = "Conekta.io";
	public $author_URI = "https://www.conekta.com";

	public function ckpg_get_version()
	{
		return $this->version;
	}

    /**
     * Plugin url.
     *
     * @return string
     */
    public static function plugin_url() {
        return untrailingslashit( plugins_url( '/', __FILE__ ) );
    }

    /**
     * Plugin url.
     *
     * @return string
     */
    public static function plugin_abspath() {
        return trailingslashit( plugin_dir_path( __FILE__ ) );
    }

    /**
     * @throws Exception
     */
    public static function create_webhook(?string $apikey, ?string $webhook_url): bool
    {
        if (is_null($webhook_url)){
            return false;
        }
        try {
            $api = new WebhooksApi(null, Configuration::getDefaultConfiguration()->setAccessToken($apikey));
            $webhooks = $api->getWebhooks("es", null,3,null, $webhook_url);
            if (empty($webhooks->getData())) {
                $webhook = new WebhookRequest();
                $webhook->setUrl($webhook_url);
                $api->createWebhook($webhook);
            }
            return true;
        }
        catch (Exception $e) {
            error_log($e->getMessage());
            return false;
        }
    }
    public static function handleWebhookPing()
    {
        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK']);
        exit;
    }
    
    public static function check_if_payment_payment_method_webhook(string $payment_method, array $event){
        $conekta_order = $event['data']['object'];
        if ($conekta_order["metadata"]["payment_method"] !==  $payment_method){
            header('Content-Type: application/json');
            echo json_encode(['message' => 'OK', 'payment_method'=> $conekta_order["metadata"]["payment_method"]]);
            exit;
        }
    }
    
    /**
     * @throws ApiException
     */
    public static function handleOrderPaid(OrdersApi $ordersApi, array $event)
    {
        $conekta_order = $event['data']['object'];
        if (!self::validate_reference_id($conekta_order)) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order id']);
            exit;
        }

        if (!self::check_order_status($ordersApi, $conekta_order['id'], array('paid'))) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status']);
            exit;
        }

        $order = self::find_order_for_webhook($conekta_order);
        if (!$order) {
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Order not found', 'reference_id' => $conekta_order['metadata']['reference_id'], 'conekta_id' => $conekta_order['id']]);
            exit;
        }

        $charge = $conekta_order['charges']['data'][0];
        $paid_at = date("Y-m-d", $charge['paid_at']);
        self::update_conekta_order_meta($order, $paid_at, 'conekta-paid-at');
        $order->payment_complete();
        $order->add_order_note("Payment completed in Conekta and notification of payment received");

        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK', 'order_id' => $order->get_id()]);
        exit;
    }
    
    /**
     * @throws ApiException
     */
    public static function handleOrderExpiredOrCanceled(OrdersApi $ordersApi, $event)
    {
        $conekta_order = $event['data']['object'];
        if (!self::validate_reference_id($conekta_order)) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order id']);
            exit;
        }

        if (!self::check_order_status($ordersApi, $conekta_order['id'], array('expired', 'canceled'))) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status']);
            exit;
        }

        $order = self::find_order_for_webhook($conekta_order);
        if (!$order) {
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Order not found', 'reference_id' => $conekta_order['metadata']['reference_id'], 'conekta_id' => $conekta_order['id']]);
            exit;
        }

        $order->update_status('cancelled', 'Order expired/cancelled in Conekta.');
        header('Content-Type: application/json');
        echo json_encode(['cancelled' => 'OK', 'order_id' => $order->get_id()]);
        exit;
    }
    
    /**
     * @throws ApiException
     */
    public static function check_order_status(OrdersApi $ordersApi, string $conekta_order_id, array $statuses): bool
    {
        $conekta_order_api = $ordersApi->getorderbyid($conekta_order_id);

        return in_array($conekta_order_api->getPaymentStatus(), $statuses);
    }
    
    public static function validate_reference_id(array $conekta_order): bool
    {
        return isset($conekta_order['metadata'])
            && array_key_exists('reference_id', $conekta_order['metadata'])
            && is_numeric($conekta_order['metadata']['reference_id'])
            && (int) $conekta_order['metadata']['reference_id'] > 0;
    }

    /**
     * Finds the WooCommerce order for a Conekta webhook event.
     * First tries metadata.reference_id, then falls back to searching
     * by conekta-order-id meta (covers 3DS temp order scenario).
     *
     * @return WC_Order|false
     */
    public static function find_order_for_webhook(array $conekta_order)
    {
        $order_id = $conekta_order['metadata']['reference_id'] ?? null;

        if ($order_id) {
            $order = wc_get_order($order_id);
            if ($order) {
                return $order;
            }
        }

        // Fallback: temp order was deleted after 3DS transfer,
        // find the real order by conekta-order-id meta.
        $conekta_id = $conekta_order['id'] ?? null;
        if ($conekta_id) {
            $orders = wc_get_orders([
                'meta_key'   => 'conekta-order-id',
                'meta_value' => $conekta_id,
                'limit'      => 1,
            ]);
            if (!empty($orders)) {
                return $orders[0];
            }
        }

        return false;
    }

    /**
     * @throws ApiException
     */
    public static function update_conekta_order_meta( $order, $order_value, string $order_key) {
        update_post_meta($order->get_id(), $order_key, $order_value);
        $order->update_meta_data($order_key, $order_value);
        $order->save();
    }

    public static function get_user_locale() {
        $current_user_id = get_current_user_id();

        if ($current_user_id) {
            $user_locale = get_user_meta($current_user_id, 'locale', true);
    
            if (!empty($user_locale)) {
                return in_array(substr($user_locale, 0, 2), ['es', 'en']) ? substr($user_locale, 0, 2) : 'es';
            }
        }
    
        $site_locale = substr(get_locale(), 0, 2);
    
        return in_array($site_locale, ['es', 'en']) ? $site_locale : 'es';
    }
    
    public static function get_user_ip(): string {
        return \WC_Geolocation::get_ip_address();
    }

    public static function get_api_instance(string  $api_key, string $version): OrdersApi
    {
        $stack = HandlerStack::create();
        $stack->push(Middleware::mapRequest(function (Request $request) use ($version) {
            return $request->withHeader(
                'X-Conekta-Client-User-Agent',
                json_encode([
                    'plugin_name' => 'woocommerce',
                    'plugin_version' => $version,
                ])
            );
        }));
        $client = new Client([
            'handler' => $stack,
        ]);
        return  new OrdersApi($client, Configuration::getDefaultConfiguration()->setAccessToken($api_key));
    }

    public static function get_companies_api_instance(string $api_key, string $version): CompaniesApi
    {
        $stack = HandlerStack::create();
        $stack->push(Middleware::mapRequest(function (Request $request) use ($version) {
            return $request->withHeader(
                'X-Conekta-Client-User-Agent',
                json_encode([
                    'plugin_name'    => 'woocommerce',
                    'plugin_version' => $version,
                ])
            );
        }));
        $client = new Client([
            'handler' => $stack,
        ]);
        return new CompaniesApi($client, Configuration::getDefaultConfiguration()->setAccessToken($api_key));
    }

    public static function handle_conekta_3ds_callback() {
        // Get payment status from query parameters
        $payment_status = isset($_GET['payment_status']) ? sanitize_text_field($_GET['payment_status']) : '';
        $order_id = isset($_GET['order_id']) ? sanitize_text_field($_GET['order_id']) : '';
        $woo_order_id = isset($_GET['woo_order_id']) ? sanitize_text_field($_GET['woo_order_id']) : '';
        
        // Redirect to checkout page with appropriate status
        if (!empty($order_id)) {
            // Store the order ID and status in session to be processed in the checkout
            WC()->session->set('conekta_3ds_order_id', $order_id);
            WC()->session->set('conekta_3ds_payment_status', $payment_status);
            
            // Store WooCommerce order ID if available
            if (!empty($woo_order_id)) {
                WC()->session->set('conekta_woo_order_id', $woo_order_id);
            }
            
            // Redirect to checkout
            wp_safe_redirect(wc_get_checkout_url());
            exit;
        }
        
        // Fallback redirect
        wp_safe_redirect(wc_get_checkout_url());
        exit;
    }
}

add_action('woocommerce_api_conekta_3ds_callback', [ 'WC_Conekta_Plugin', 'handle_conekta_3ds_callback' ]);
