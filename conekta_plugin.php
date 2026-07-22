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
use Conekta\Api\ChargesApi;
use Conekta\ApiException;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Client;

// Include REST API endpoints for 3DS
require_once(__DIR__ . '/conekta-rest-api.php');
// Reconciler: polls Conekta for pending/draft orders when webhooks don't arrive
require_once(__DIR__ . '/conekta-reconciler.php');

class WC_Conekta_Plugin extends WC_Payment_Gateway
{
	/**
	 * Sent as the `client` query param on getOrderById (conekta-php >= 7.2.0)
	 * so Conekta can attribute API reads to this integration in its request logs.
	 */
	public const API_CLIENT = 'woocommerce';

	public $version  = "6.1.0";
	public $name = "WooCommerce 2";
	public $description = "Payment Gateway via Conekta.io for WooCommerce: accepts credit and debit cards, monthly installments (MSI) for Mexican cards, cash, bank transfers, buy now pay later (BNPL), and direct bank payments (pay by bank).";
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
        $order_payment_method = $conekta_order["metadata"]["payment_method"] ?? null;
        if ($order_payment_method !== $payment_method){
            header('Content-Type: application/json');
            echo json_encode(['message' => 'OK', 'payment_method'=> $order_payment_method]);
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
            // Paid in Conekta but no WooCommerce order anywhere. Last resort:
            // CREATE the WC order from the Conekta payload so the money and
            // the store never disagree (main remaining source: wallet buttons
            // that charge without going through "Place order"). Only if that
            // fails do we fall back to the diagnostic + 404.
            //
            // Short-lived lock: Conekta retries webhooks aggressively, and two
            // concurrent order.paid deliveries for the same Conekta order must
            // not create two WC orders. A locked retry gets a 503 so Conekta
            // redelivers later, when find_order_for_webhook will find the
            // order created by the first delivery.
            $lock_key = 'conekta_wh_create_' . md5((string) ($conekta_order['id'] ?? ''));
            if (get_transient($lock_key)) {
                http_response_code(503);
                header('Content-Type: application/json');
                echo json_encode(['error' => 'Order creation in progress, retry later']);
                exit;
            }
            set_transient($lock_key, 1, MINUTE_IN_SECONDS);

            $order = self::create_order_from_conekta_payload($conekta_order);
            if ($order) {
                error_log(sprintf(
                    'Conekta - handleOrderPaid: WC order #%d CREATED from webhook payload (Conekta order %s had no WC order)',
                    $order->get_id(),
                    $conekta_order['id'] ?? ''
                ));
            }
        }
        if (!$order) {
            // Make the desync visible on the Conekta side (request logs,
            // tagged to the order id), since this failure never touches the
            // API otherwise.
            self::send_webhook_diagnostic($ordersApi, $conekta_order['id'], 'order_not_found', array_filter([
                'event'        => 'order.paid',
                'reference_id' => isset($conekta_order['metadata']['reference_id']) ? (string) $conekta_order['metadata']['reference_id'] : '',
            ]));
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode([
                'error'        => 'Order not found',
                'reference_id' => $conekta_order['metadata']['reference_id'] ?? null,
                'conekta_id'   => $conekta_order['id'] ?? null,
            ]);
            exit;
        }

        // Idempotency guard: Conekta retries webhooks, and the same event
        // can also arrive after process_payment already marked the order
        // processing. Skip re-running payment_complete + add_order_note so
        // we don't pile up duplicate notes / meta on each retry. Return 200
        // so Conekta marks the webhook delivered and stops retrying.
        if (in_array($order->get_status(), ['processing', 'completed'], true)) {
            header('Content-Type: application/json');
            echo json_encode([
                'message'  => 'OK',
                'order_id' => $order->get_id(),
                'note'     => 'already paid (idempotent retry)',
            ]);
            exit;
        }

        $charge = $conekta_order['charges']['data'][0] ?? null;
        if ($charge && !empty($charge['paid_at'])) {
            $paid_at = date("Y-m-d", $charge['paid_at']);
            self::update_conekta_order_meta($order, $paid_at, 'conekta-paid-at');
        }
        self::mark_order_paid($order, $conekta_order['id'] ?? '', "Payment completed in Conekta and notification of payment received");

        header('Content-Type: application/json');
        echo json_encode(['message' => 'OK', 'order_id' => $order->get_id()]);
        exit;
    }

    /**
     * Last-resort order builder: a paid Conekta order arrived with NO
     * matching WooCommerce order (typically a wallet charge whose post-charge
     * checkout submit never landed). Rebuild the WC order from the Conekta
     * payload so the payment is never orphaned. Products are resolved through
     * the product_id stamped into each line_item's metadata by
     * build_snapshot(); items without it fall back to a named fee line.
     *
     * The order total is forced to the amount Conekta actually charged, and a
     * prominent note asks the merchant to review — this is a recovery path,
     * not the happy path.
     *
     * @return WC_Order|null
     */
    public static function create_order_from_conekta_payload(array $conekta_order)
    {
        if (!function_exists('wc_create_order')) {
            return null;
        }
        try {
            $order = wc_create_order([
                'status'      => 'pending',
                'created_via' => 'conekta_webhook',
            ]);
            if (is_wp_error($order)) {
                error_log('Conekta - create_order_from_conekta_payload: ' . $order->get_error_message());
                return null;
            }

            $currency = strtoupper((string) ($conekta_order['currency'] ?? 'MXN'));
            $order->set_currency($currency);

            foreach (($conekta_order['line_items']['data'] ?? []) as $item) {
                $quantity   = max(1, (int) ($item['quantity'] ?? 1));
                $line_total = ((int) ($item['unit_price'] ?? 0)) * $quantity / 100;
                $product_id = isset($item['metadata']['product_id']) ? absint($item['metadata']['product_id']) : 0;
                $product    = $product_id ? wc_get_product($product_id) : false;

                if ($product) {
                    $order->add_product($product, $quantity, [
                        'subtotal' => $line_total,
                        'total'    => $line_total,
                    ]);
                } else {
                    $fee = new WC_Order_Item_Fee();
                    $fee->set_name((string) ($item['name'] ?? 'Producto'));
                    $fee->set_total((string) $line_total);
                    $order->add_item($fee);
                }
            }

            foreach (($conekta_order['shipping_lines']['data'] ?? []) as $shipping_line) {
                $shipping = new WC_Order_Item_Shipping();
                $shipping->set_method_title((string) ($shipping_line['method'] ?? $shipping_line['carrier'] ?? 'Envío'));
                $shipping->set_total((string) (((int) ($shipping_line['amount'] ?? 0)) / 100));
                $order->add_item($shipping);
            }

            foreach (($conekta_order['discount_lines']['data'] ?? []) as $discount_line) {
                $fee = new WC_Order_Item_Fee();
                $fee->set_name('Descuento: ' . (string) ($discount_line['code'] ?? 'descuento'));
                $fee->set_total((string) (-((int) ($discount_line['amount'] ?? 0)) / 100));
                $order->add_item($fee);
            }

            $customer = $conekta_order['customer_info'] ?? [];
            $contact  = $conekta_order['shipping_contact'] ?? [];
            $address  = $contact['address'] ?? [];

            $full_name  = trim((string) ($customer['name'] ?? ''));
            $name_parts = $full_name !== '' ? explode(' ', $full_name, 2) : ['', ''];
            $order->set_billing_first_name($name_parts[0]);
            $order->set_billing_last_name($name_parts[1] ?? '');
            if (!empty($customer['email'])) {
                $order->set_billing_email(sanitize_email((string) $customer['email']));
            }
            if (!empty($customer['phone'])) {
                $order->set_billing_phone((string) $customer['phone']);
            }
            if (!empty($address)) {
                $receiver       = trim((string) ($contact['receiver'] ?? $full_name));
                $receiver_parts = $receiver !== '' ? explode(' ', $receiver, 2) : ['', ''];
                $order->set_shipping_first_name($receiver_parts[0]);
                $order->set_shipping_last_name($receiver_parts[1] ?? '');
                $order->set_shipping_address_1((string) ($address['street1'] ?? ''));
                $order->set_shipping_address_2((string) ($address['street2'] ?? ''));
                $order->set_shipping_city((string) ($address['city'] ?? ''));
                $order->set_shipping_state((string) ($address['state'] ?? ''));
                $order->set_shipping_postcode((string) ($address['postal_code'] ?? ''));
                $order->set_shipping_country((string) ($address['country'] ?? 'MX'));
                // Billing address doubles as shipping when we only have one.
                $order->set_billing_address_1((string) ($address['street1'] ?? ''));
                $order->set_billing_address_2((string) ($address['street2'] ?? ''));
                $order->set_billing_city((string) ($address['city'] ?? ''));
                $order->set_billing_state((string) ($address['state'] ?? ''));
                $order->set_billing_postcode((string) ($address['postal_code'] ?? ''));
                $order->set_billing_country((string) ($address['country'] ?? 'MX'));
            }

            $order->set_payment_method('conekta');
            // Force the total to what Conekta actually charged — item math may
            // drift (taxes, rounding) and the money already moved.
            $order->set_total(((int) ($conekta_order['amount'] ?? 0)) / 100);
            $order->add_order_note(sprintf(
                'Pedido creado automáticamente desde el webhook order.paid de Conekta (orden %s): el pago existía en Conekta pero no había pedido en WooCommerce. REVISAR datos y stock.',
                (string) ($conekta_order['id'] ?? '')
            ));
            $order->save();

            if (!empty($conekta_order['id'])) {
                self::update_conekta_order_meta($order, (string) $conekta_order['id'], 'conekta-order-id');
            }

            return $order;
        } catch (\Throwable $e) {
            error_log('Conekta - create_order_from_conekta_payload: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Complete a WC order for a payment confirmed on the Conekta side.
     *
     * Handles the Blocks `checkout-draft` case explicitly: that status is NOT
     * in woocommerce_valid_order_statuses_for_payment_complete, so calling
     * payment_complete() directly on a draft is a SILENT NO-OP — the order
     * stays a draft, which WooCommerce hides from the admin order list. That
     * was exactly the reported symptom: paid in Conekta, "no order" in Woo
     * (it existed, but invisible). Promote the draft to pending first, then
     * complete. Idempotent: safe to call again on an already-paid order.
     */
    public static function mark_order_paid($order, string $conekta_order_id, string $note): void
    {
        if (in_array($order->get_status(), ['processing', 'completed'], true)) {
            return;
        }
        if ($order->has_status('checkout-draft')) {
            if (!$order->get_payment_method()) {
                $order->set_payment_method('conekta');
            }
            $order->update_status('pending', 'Conekta: draft de checkout promovido a pendiente para registrar el pago.');
        }
        $order->payment_complete($conekta_order_id);
        $order->add_order_note($note);
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
            self::send_webhook_diagnostic($ordersApi, $conekta_order['id'], 'order_not_found', array_filter([
                'event'        => 'order.expired_or_canceled',
                'reference_id' => isset($conekta_order['metadata']['reference_id']) ? (string) $conekta_order['metadata']['reference_id'] : '',
            ]));
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode([
                'error'        => 'Order not found',
                'reference_id' => $conekta_order['metadata']['reference_id'] ?? null,
                'conekta_id'   => $conekta_order['id'] ?? null,
            ]);
            exit;
        }

        // Stale-order guard: under the order-first flow a WC order can carry
        // reference_id on an OLD Conekta order (checkout reloaded -> the
        // session state was cleared -> a NEW Conekta order was mounted, while
        // WooCommerce reused the same WC order via order_awaiting_payment).
        // When that old Conekta order expires days later, this webhook finds
        // the WC order through reference_id — but the order's current
        // conekta-order-id meta points at the LIVE Conekta order. Cancelling
        // it would kill a checkout in progress (or a soon-to-be-paid order).
        // Only cancel when the event's Conekta id matches the order's current
        // link; orders without the meta (legacy cash/transfer flows) keep the
        // old behavior.
        $linked_conekta_id = (string) $order->get_meta('conekta-order-id');
        if ($linked_conekta_id !== '' && $linked_conekta_id !== (string) ($conekta_order['id'] ?? '')) {
            header('Content-Type: application/json');
            echo json_encode([
                'cancelled' => 'NO',
                'order_id'  => $order->get_id(),
                'note'      => 'stale conekta order, current link is ' . $linked_conekta_id,
            ]);
            exit;
        }

        // Idempotency guard: don't cancel an order that's already paid.
        // This protects against the 3DS temp-order edge case where the
        // temporary Conekta order eventually expires while the real WC
        // order was already charged through the actual conekta-order-id
        // mapping; without this guard we'd cancel a successful order.
        if (in_array($order->get_status(), ['processing', 'completed'], true)) {
            header('Content-Type: application/json');
            echo json_encode([
                'cancelled' => 'NO',
                'order_id'  => $order->get_id(),
                'note'      => 'already paid, ignoring cancel webhook',
            ]);
            exit;
        }
        if ($order->get_status() === 'cancelled') {
            header('Content-Type: application/json');
            echo json_encode([
                'cancelled' => 'OK',
                'order_id'  => $order->get_id(),
                'note'      => 'already cancelled (idempotent retry)',
            ]);
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
        $conekta_order_api = $ordersApi->getorderbyid($conekta_order_id, 'es', null, self::API_CLIENT);

        return in_array($conekta_order_api->getPaymentStatus(), $statuses);
    }
    
    /**
     * Decide whether a webhook payload references a Conekta order we can
     * look up in WooCommerce. Two valid shapes:
     *
     *  - Legacy / cash / bank-transfer flows: metadata.reference_id is the
     *    numeric WC order id (the Conekta order was created from the WC
     *    order, so reference_id was set at creation time).
     *  - Integration component flow (cards / Apple Pay): the Conekta order
     *    is created BEFORE the WC order exists, so metadata.reference_id
     *    is absent — but the Conekta order id is present, and
     *    find_order_for_webhook() can resolve the WC order through the
     *    `conekta-order-id` meta on existing WC orders.
     *
     * Either shape is enough to proceed.
     */
    public static function validate_reference_id(array $conekta_order): bool
    {
        $has_valid_reference = isset($conekta_order['metadata'])
            && array_key_exists('reference_id', $conekta_order['metadata'])
            && is_numeric($conekta_order['metadata']['reference_id'])
            && (int) $conekta_order['metadata']['reference_id'] > 0;
        if ($has_valid_reference) {
            return true;
        }
        return !empty($conekta_order['id']) && is_string($conekta_order['id']);
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
                // Include 'checkout-draft': in Blocks the paid charge can land
                // on an order still in the draft status (process_payment_api
                // never ran — tab closed, network drop). wc_get_orders() omits
                // checkout-draft by default, so without this the webhook can't
                // recover it and returns "Order not found" — paid in Conekta,
                // never completed in WooCommerce.
                'status'     => ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'checkout-draft'],
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
        return new OrdersApi(
            self::build_http_client($version),
            Configuration::getDefaultConfiguration()->setAccessToken($api_key)
        );
    }

    public static function get_charges_api_instance(string $api_key, string $version): ChargesApi
    {
        return new ChargesApi(
            self::build_http_client($version),
            Configuration::getDefaultConfiguration()->setAccessToken($api_key)
        );
    }

    /**
     * @param callable|null $handler test seam — Guzzle handler (e.g. MockHandler)
     *                               so unit tests can capture the outgoing request.
     */
    private static function build_http_client(string $version, ?callable $handler = null): Client
    {
        $stack = $handler !== null ? HandlerStack::create($handler) : HandlerStack::create();
        $stack->push(Middleware::mapRequest(function (Request $request) use ($version) {
            $request = $request->withHeader(
                'X-Conekta-Client-User-Agent',
                json_encode([
                    'plugin_name' => 'woocommerce',
                    'plugin_version' => $version,
                ])
            );

            // Diagnostic beacon (see send_webhook_diagnostic): while a beacon
            // is armed, stamp the error code as a custom header AND as query
            // params. Conekta records both (query_string + request_headers)
            // in its per-request logs, tagged to the order id — so Conekta
            // staff can see WooCommerce-side failures that otherwise never
            // leave the merchant's server.
            if (self::$diagnostic_beacon !== null) {
                $request = $request->withHeader('X-Wc-Error-Code', self::$diagnostic_beacon['code']);
                $query = http_build_query(array_merge(
                    ['wc_error_code' => self::$diagnostic_beacon['code']],
                    self::$diagnostic_beacon['extra']
                ));
                $uri      = $request->getUri();
                $existing = $uri->getQuery();
                $request  = $request->withUri($uri->withQuery($existing !== '' ? $existing . '&' . $query : $query));
            }

            return $request;
        }));
        return new Client([
            'handler' => $stack,
        ]);
    }

    /**
     * When non-null, the next API request carries this diagnostic payload
     * (header + query string). Armed only for the duration of
     * send_webhook_diagnostic().
     *
     * @var array{code: string, extra: array<string, string>}|null
     */
    private static $diagnostic_beacon = null;

    /**
     * Report a WooCommerce-side failure to Conekta WITHOUT mutating anything:
     * re-GET the order with the error code stamped as a custom header
     * (X-Wc-Error-Code) and as query params (wc_error_code=...). The request
     * lands in Conekta's request logs — query string and headers included,
     * searchable by the order id — which is the only channel Conekta can see
     * when the failure never touches the API otherwise (e.g. the order.paid
     * webhook finds no WooCommerce order). Order metadata is NOT an option
     * here: it's frozen once the order is paid (422
     * cannot_be_updated_because_has_charge_paid).
     *
     * Fire-and-forget: a beacon failure must never break the caller, so every
     * exception is swallowed (the failed request still gets logged Conekta-side
     * anyway).
     *
     * @param OrdersApi             $ordersApi        client already authenticated with the merchant key.
     * @param string                $conekta_order_id order to tag the diagnostic onto.
     * @param string                $code             short machine code, e.g. 'order_not_found', 'mismatch_amount'.
     * @param array<string, string> $extra            additional query params (e.g. ['reference_id' => '123']).
     */
    public static function send_webhook_diagnostic(OrdersApi $ordersApi, string $conekta_order_id, string $code, array $extra = []): void
    {
        try {
            self::$diagnostic_beacon = ['code' => $code, 'extra' => $extra];
            $ordersApi->getOrderById($conekta_order_id, 'es', null, self::API_CLIENT);
        } catch (\Throwable $e) {
            error_log('Conekta - diagnostic beacon (' . $code . ') failed: ' . $e->getMessage());
        } finally {
            self::$diagnostic_beacon = null;
        }
    }

}
