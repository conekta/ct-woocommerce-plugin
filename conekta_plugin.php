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
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Client;

class WC_Conekta_Plugin extends WC_Payment_Gateway
{
	public $version  = "5.1.0";
	public $name = "WooCommerce 2";
	public $description = "Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.";
	public $plugin_name = "Conekta Payment Gateway for Woocommerce";
	public $plugin_URI = "https://wordpress.org/plugins/conekta-payment-gateway/";
	public $author = "Conekta.io";
	public $author_URI = "https://www.conekta.io";

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
        $order_id = $conekta_order['metadata']['reference_id'];

        if (!self::check_order_status($ordersApi, $conekta_order['id'], array('paid'))) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status', 'order_id' => $order_id]);
            exit;
        }

        $order = new WC_Order($order_id);
        $charge = $conekta_order['charges']['data'][0];
        $paid_at = date("Y-m-d", $charge['paid_at']);
        update_post_meta($order->get_id(), 'conekta-paid-at', $paid_at);
        $order->payment_complete();
        $order->add_order_note("Payment completed in Conekta and notification of payment received");

        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK', 'order_id' => $order_id]);
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
        $order_id = $conekta_order['metadata']['reference_id'];
        if (!self::check_order_status($ordersApi, $conekta_order['id'], array('expired', 'canceled'))) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Invalid order status', 'order_id' => $order_id]);
            exit;
        }
        $order = new WC_Order($order_id);
        $order->update_status('cancelled', 'Order expired/cancelled in Conekta.');
        header('Content-Type: application/json');
        echo json_encode(['cancelled' => 'OK', 'order_id' => $order_id]);
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
        return isset($conekta_order['metadata']) && array_key_exists('reference_id', $conekta_order['metadata']);
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
        $ip_keys = [
            'HTTP_X_FORWARDED_FOR',   // Load Balancer / Proxies
            'HTTP_CF_CONNECTING_IP',  // Cloudflare
            'HTTP_X_REAL_IP',         // Nginx
            'HTTP_CLIENT_IP',         // Proxy
            'REMOTE_ADDR'             // Último recurso
        ];
    
        foreach ($ip_keys as $key) {
            if (!empty($_SERVER[$key])) {
                $ip_list = explode(',', $_SERVER[$key]);
                $ip_list = array_map('trim', $ip_list);

                foreach (array_reverse($ip_list) as $ip) {
                    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                        return $ip;
                    }
                }
            }
        }
    
        return '0.0.0.0';
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
        return  new OrdersApi($client, Configuration::getDefaultConfiguration()->setAccessToken($api_key)->setHost("https://api.stg.conekta.io"));
    }
}
