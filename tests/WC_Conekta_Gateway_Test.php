<?php

use Conekta\Configuration;
use PHPUnit\Framework\TestCase;

class WC_Conekta_Gateway_Test extends TestCase
{
    private static string $conektaHost;
    private static bool $conektaAvailable = false;

    public static function setUpBeforeClass(): void
    {
        self::$conektaHost = getenv('CONEKTA_HOST') ?: 'http://localhost:3000';

        // Check if Mockoon is reachable
        $ch = curl_init(self::$conektaHost . '/ping');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 2,
            CURLOPT_CONNECTTIMEOUT => 2,
        ]);
        curl_exec($ch);
        $errno = curl_errno($ch);
        curl_close($ch);

        self::$conektaAvailable = ($errno === 0);
    }

    protected function setUp(): void
    {
        parent::setUp();
        WC()->cart = null;
        Configuration::getDefaultConfiguration()
            ->setHost(self::$conektaHost)
            ->setAccessToken('key_test_123');
    }

    protected function tearDown(): void
    {
        global $test_product_registry, $test_order_registry, $test_prices_include_tax;
        WC()->cart = null;
        $test_product_registry = [];
        $test_order_registry = null;
        $test_prices_include_tax = false;
        parent::tearDown();
    }

    /**
     * Register a product in the global registry so both `new WC_Product($id)`
     * and `wc_get_product($id)` return the configured data.
     */
    private function registerProduct(int $id, float $regular_price, float $price = 0, string $name = '', bool $taxable = true): void
    {
        global $test_product_registry;
        $test_product_registry[$id] = [
            'regular_price' => $regular_price,
            'price'         => $price ?: $regular_price,
            'name'          => $name ?: "Test Product {$id}",
            'taxable'       => $taxable,
        ];
    }

    private function requireMockoon(): void
    {
        if (!self::$conektaAvailable) {
            $this->markTestSkipped('Conekta mock server not available at ' . self::$conektaHost);
        }
    }

    /**
     * Returns a gateway instance with settings pre-populated (skips constructor).
     */
    private function createConfiguredGateway(array $overrides = []): WC_Conekta_Gateway
    {
        $gateway = $this->createPartialMock(WC_Conekta_Gateway::class, []);

        $defaults = [
            'enabled'              => 'yes',
            'title'                => 'Tarjeta',
            'description'          => 'Paga con tarjeta',
            'cards_api_key'        => 'key_test_123',
            'cards_public_api_key' => 'key_public_test_123',
            'webhook_url'          => 'http://localhost/?wc-api=wc_conekta',
            'alternate_imageurl'   => '',
            'order_expiration'     => 1,
        ];

        $settings = array_merge($defaults, $overrides);

        $gateway->id = 'conekta';
        $gateway->title = $settings['title'];
        $gateway->description = $settings['description'];
        $gateway->api_key = $settings['cards_api_key'];
        $gateway->public_api_key = $settings['cards_public_api_key'];
        $gateway->webhook_url = $settings['webhook_url'];
        $gateway->has_fields = true;
        $gateway->method_title = 'Conekta Tarjetas';

        $ref = new ReflectionClass($gateway);
        $prop = $ref->getProperty('settings');
        $prop->setAccessible(true);
        $prop->setValue($gateway, $settings);

        return $gateway;
    }

    // -------------------------------------------------------
    // Constructor tests (no Mockoon needed)
    // -------------------------------------------------------

    public function test_constructor_without_api_key_does_not_fatal()
    {
        $gateway = new WC_Conekta_Gateway();

        $this->assertEmpty($gateway->api_key);
    }

    // -------------------------------------------------------
    // Webhook validation (no Mockoon needed)
    // -------------------------------------------------------

    public function test_validate_reference_id_with_valid_data()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => '100'],
        ]);
        $this->assertTrue($result);
    }

    public function test_validate_reference_id_with_missing_metadata()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([]);
        $this->assertFalse($result);
    }

    public function test_validate_reference_id_with_empty_string()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => ''],
        ]);
        $this->assertFalse($result, 'Empty string reference_id should be invalid');
    }

    public function test_validate_reference_id_with_zero()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => '0'],
        ]);
        $this->assertFalse($result, 'Zero reference_id should be invalid');
    }

    public function test_validate_reference_id_with_non_numeric()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => 'abc'],
        ]);
        $this->assertFalse($result, 'Non-numeric reference_id should be invalid');
    }

    public function test_validate_reference_id_with_negative()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => '-1'],
        ]);
        $this->assertFalse($result, 'Negative reference_id should be invalid');
    }

    public function test_validate_reference_id_with_integer()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => 1285],
        ]);
        $this->assertTrue($result, 'Integer reference_id should be valid');
    }

    public function test_validate_reference_id_with_null()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['reference_id' => null],
        ]);
        $this->assertFalse($result, 'Null reference_id should be invalid');
    }

    public function test_validate_reference_id_accepts_integration_payload_without_reference_id()
    {
        // Integration component creates the Conekta order before the WC
        // order exists, so metadata.reference_id is absent. As long as the
        // Conekta order id is present we can resolve via the
        // `conekta-order-id` meta lookup downstream.
        $result = WC_Conekta_Plugin::validate_reference_id([
            'id'       => 'ord_2znsJ8YNbNoDDsN3p',
            'metadata' => ['plugin' => 'woocommerce'],
        ]);
        $this->assertTrue($result, 'Payload with conekta id but no reference_id should be valid');
    }

    public function test_validate_reference_id_falls_back_to_conekta_id_when_reference_id_invalid()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'id'       => 'ord_xyz',
            'metadata' => ['reference_id' => 'not-a-number'],
        ]);
        $this->assertTrue($result, 'Bogus reference_id with valid Conekta id should still validate');
    }

    public function test_validate_reference_id_rejects_payload_without_id_or_reference()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'metadata' => ['plugin' => 'woocommerce'],
        ]);
        $this->assertFalse($result, 'Payload with neither id nor reference_id should be invalid');
    }

    public function test_validate_reference_id_rejects_empty_id()
    {
        $result = WC_Conekta_Plugin::validate_reference_id([
            'id'       => '',
            'metadata' => [],
        ]);
        $this->assertFalse($result, 'Empty Conekta id with no reference_id should be invalid');
    }

    // -------------------------------------------------------
    // Webhook order lookup — find_order_for_webhook()
    // -------------------------------------------------------

    /**
     * When reference_id points to a valid order, return it directly.
     */
    public function test_find_order_for_webhook_by_reference_id()
    {
        global $test_order_registry;
        $order = new WC_Order(1308);
        $test_order_registry[1308] = $order;

        $conekta_order = [
            'id' => 'ord_abc123',
            'metadata' => ['reference_id' => '1308'],
        ];

        $found = WC_Conekta_Plugin::find_order_for_webhook($conekta_order);
        $this->assertNotFalse($found);
        $this->assertEquals(1308, $found->get_id());
    }

    /**
     * When reference_id points to a deleted temp order but a real order
     * holds the conekta-order-id meta, the fallback should find it.
     */
    public function test_find_order_for_webhook_fallback_by_conekta_meta()
    {
        global $test_order_registry;

        // Real order 1308 has the conekta-order-id meta
        $real_order = new WC_Order(1308);
        $real_order->update_meta_data('conekta-order-id', 'ord_abc123');
        $test_order_registry[1308] = $real_order;

        // Temp order 1309 was deleted — NOT in registry

        $conekta_order = [
            'id' => 'ord_abc123',
            'metadata' => ['reference_id' => '1309'],
        ];

        $found = WC_Conekta_Plugin::find_order_for_webhook($conekta_order);
        $this->assertNotFalse($found, 'Should find order by conekta-order-id meta when reference_id order is deleted');
        $this->assertEquals(1308, $found->get_id());
    }

    /**
     * When neither reference_id nor conekta-order-id meta match, return false.
     */
    public function test_find_order_for_webhook_returns_false_when_not_found()
    {
        global $test_order_registry;
        // Registry is empty — no orders at all
        $test_order_registry = [];

        $conekta_order = [
            'id' => 'ord_ghost',
            'metadata' => ['reference_id' => '9999'],
        ];

        $found = WC_Conekta_Plugin::find_order_for_webhook($conekta_order);
        $this->assertFalse($found);
    }

    /**
     * When reference_id arrives as integer (observed in production),
     * lookup should still work.
     */
    public function test_find_order_for_webhook_with_integer_reference_id()
    {
        global $test_order_registry;
        $order = new WC_Order(1285);
        $test_order_registry[1285] = $order;

        $conekta_order = [
            'id' => 'ord_int123',
            'metadata' => ['reference_id' => 1285],
        ];

        $found = WC_Conekta_Plugin::find_order_for_webhook($conekta_order);
        $this->assertNotFalse($found);
        $this->assertEquals(1285, $found->get_id());
    }

    // -------------------------------------------------------
    // get_blocks_draft_order_id — the blocks-only WC order id
    // written into the Conekta order metadata as reference_id.
    // -------------------------------------------------------

    public function test_get_blocks_draft_order_id_returns_id_for_checkout_draft()
    {
        global $test_order_registry;
        $order = new WC_Order(4567);
        $order->set_status('checkout-draft');
        $test_order_registry[4567] = $order;
        WC()->session->set('store_api_draft_order', 4567);

        $this->assertSame(4567, WC_Conekta_REST_API::get_blocks_draft_order_id());

        WC()->session->__unset('store_api_draft_order');
    }

    public function test_get_blocks_draft_order_id_null_when_session_key_absent()
    {
        WC()->session->__unset('store_api_draft_order');

        // Classic checkout never sets the blocks draft key.
        $this->assertNull(WC_Conekta_REST_API::get_blocks_draft_order_id());
    }

    public function test_get_blocks_draft_order_id_null_when_order_deleted()
    {
        global $test_order_registry;
        // Registry active but the referenced order is gone (wc_get_order -> false).
        $test_order_registry = [];
        WC()->session->set('store_api_draft_order', 9999);

        $this->assertNull(WC_Conekta_REST_API::get_blocks_draft_order_id());

        WC()->session->__unset('store_api_draft_order');
    }

    public function test_get_blocks_draft_order_id_null_when_order_not_draft()
    {
        global $test_order_registry;
        // A stale id pointing at an already-finalized order must NOT be reused:
        // returning it would graft last checkout's id onto a new Conekta order.
        $order = new WC_Order(4567);
        $order->set_status('processing');
        $test_order_registry[4567] = $order;
        WC()->session->set('store_api_draft_order', 4567);

        $this->assertNull(WC_Conekta_REST_API::get_blocks_draft_order_id());

        WC()->session->__unset('store_api_draft_order');
    }

    // -------------------------------------------------------
    // update_conekta_order_meta — writes to WC_Order meta
    // -------------------------------------------------------

    public function test_update_conekta_order_meta_stores_value_in_order_meta()
    {
        $order = new WC_Order(500);
        WC_Conekta_Plugin::update_conekta_order_meta($order, 'ord_abc123', 'conekta-order-id');

        $this->assertEquals('ord_abc123', $order->get_meta('conekta-order-id'));
    }

    public function test_update_conekta_order_meta_paid_at()
    {
        $order = new WC_Order(501);
        $paid_at = date("Y-m-d", 1712700000);
        WC_Conekta_Plugin::update_conekta_order_meta($order, $paid_at, 'conekta-paid-at');

        $this->assertEquals($paid_at, $order->get_meta('conekta-paid-at'));
    }

    public function test_update_conekta_order_meta_overwrites_previous_value()
    {
        $order = new WC_Order(502);
        WC_Conekta_Plugin::update_conekta_order_meta($order, 'old_value', 'conekta-order-id');
        WC_Conekta_Plugin::update_conekta_order_meta($order, 'new_value', 'conekta-order-id');

        $this->assertEquals('new_value', $order->get_meta('conekta-order-id'));
    }

    // -------------------------------------------------------
    // Currency validation (no Mockoon needed)
    // -------------------------------------------------------

    public function test_validate_currency_mxn()
    {
        $gateway = $this->createConfiguredGateway();
        $this->assertTrue($gateway->ckpg_validate_currency());
    }

    // -------------------------------------------------------
    // API tests (require Mockoon)
    // -------------------------------------------------------

    /**
     * @group mockoon
     */
    public function test_get_order_by_id()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        $order = $api->getOrderById('ord_2znsJ8YNbNoDDsN3p');
        $this->assertNotNull($order);
        $this->assertNotEmpty($order->getId());
        $this->assertEquals('MXN', $order->getCurrency());
        $this->assertEquals('paid', $order->getPaymentStatus());
        $this->assertGreaterThan(0, $order->getAmount());
        $this->assertNotNull($order->getCustomerInfo());
        $this->assertNotEmpty($order->getCustomerInfo()->getEmail());
        $this->assertNotNull($order->getCharges());
        $this->assertTrue($order->getIsRefundable());
        $this->assertNotEmpty($order->getLineItems());

        // Validate charge is card type
        $charge = $order->getCharges()->getData()[0];
        $this->assertEquals('card_payment', $charge->getPaymentMethod()->getObject());
        $this->assertNotEmpty($charge->getPaymentMethod()->getAuthCode());
    }

    /**
     * @group mockoon
     */
    public function test_capture_order()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        $captured = $api->ordersCreateCapture('ord_test_123');
        $this->assertNotNull($captured);
        $this->assertEquals('paid', $captured->getPaymentStatus());
    }

    public function test_gateway_disabled_without_api_key()
    {
        $gateway = new WC_Conekta_Gateway();

        $this->assertFalse($gateway->enabled);
    }

    // -------------------------------------------------------
    // process_payment — Classic Checkout (no Mockoon needed for some)
    // -------------------------------------------------------

    public function test_process_payment_fails_without_token_and_order_id()
    {
        $gateway = $this->createConfiguredGateway();

        $_POST = [];

        $result = $gateway->process_payment(100);

        $this->assertEquals('failure', $result['result']);
    }

    /**
     * @group mockoon
     */
    public function test_process_payment_3ds_failed_order_returns_failure()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();

        // ord_2znsJ8YNbNoDDsNes returns expired — payment cannot be processed
        $_POST = [
            'conekta_token' => 'tok_test_visa_4242',
            'conekta_order_id' => 'ord_2znsJ8YNbNoDDsNes',
            'conekta_3ds_completed' => 'false',
            'conekta_payment_status' => '',
        ];

        $result = $gateway->process_payment(302);

        $this->assertEquals('failure', $result['result']);
        $this->assertArrayNotHasKey('redirect', $result);
    }

    public function test_process_payment_returns_failure_on_empty_post()
    {
        $gateway = $this->createConfiguredGateway();

        $_POST = [
            'conekta_token' => '',
            'conekta_order_id' => '',
        ];

        $result = $gateway->process_payment(400);

        $this->assertEquals('failure', $result['result']);
    }

    // -------------------------------------------------------
    // Duplicate conekta-order-id guard (1 Conekta order -> N WC orders)
    // No Mockoon: the guard short-circuits before any Conekta API call.
    // -------------------------------------------------------

    /**
     * find_existing_order_for_conekta_id returns another WC order that already
     * holds the same conekta-order-id meta, and excludes the current order.
     */
    public function test_find_existing_order_for_conekta_id_detects_duplicate()
    {
        global $test_order_registry;
        $test_order_registry = [];

        $paid = new WC_Order(1308);
        $paid->update_meta_data('conekta-order-id', 'ord_dup123');
        $test_order_registry[1308] = $paid;

        $gateway = $this->createConfiguredGateway();
        $method = new ReflectionMethod($gateway, 'find_existing_order_for_conekta_id');
        $method->setAccessible(true);

        // Looking up from a different order id (1309) finds the paid one.
        $found = $method->invoke($gateway, 'ord_dup123', 1309);
        $this->assertNotFalse($found);
        $this->assertEquals(1308, $found->get_id());

        // Excluding the order that holds the meta returns false (no duplicate).
        $this->assertFalse($method->invoke($gateway, 'ord_dup123', 1308));

        // Unknown conekta order id -> no duplicate.
        $this->assertFalse($method->invoke($gateway, 'ord_other', 1309));
    }

    /**
     * Classic checkout: a resubmission creates a second WC order while the
     * hidden conekta_order_id stays the same. The guard must NOT mark the
     * second order paid; it redirects the customer to the already-paid order.
     */
    public function test_process_payment_does_not_double_complete_on_resubmission()
    {
        global $test_order_registry;
        $test_order_registry = [];

        // Order 1308 was already paid with this Conekta order.
        $paid = new WC_Order(1308);
        $paid->update_meta_data('conekta-order-id', 'ord_dup123');
        $paid->update_status('processing');
        $test_order_registry[1308] = $paid;

        // Order 1309 is the duplicate WC order created by the resubmission.
        $dup = new WC_Order(1309);
        $test_order_registry[1309] = $dup;

        $gateway = $this->createConfiguredGateway();
        $_POST = ['conekta_order_id' => 'ord_dup123'];

        $result = $gateway->process_payment(1309);

        // Customer is sent to a success page (the already-paid order)...
        $this->assertEquals('success', $result['result']);
        $this->assertArrayHasKey('redirect', $result);
        // ...the duplicate order 1309 is NOT marked paid...
        $this->assertNotEquals('completed', $dup->get_status());
        $this->assertNotEquals('processing', $dup->get_status());
        // ...and it's cancelled so it doesn't linger as pending.
        $this->assertEquals('cancelled', $dup->get_status());
    }

    /**
     * Blocks checkout (Store API): same resubmission scenario as classic.
     * process_payment_api must not mark the duplicate WC order paid; it sets
     * the result to success and redirects to the already-paid order.
     */
    public function test_process_payment_api_does_not_double_complete_on_resubmission()
    {
        global $test_order_registry;
        $test_order_registry = [];

        // Order 1308 was already paid with this Conekta order.
        $paid = new WC_Order(1308);
        $paid->update_meta_data('conekta-order-id', 'ord_dup123');
        $paid->update_status('processing');
        $test_order_registry[1308] = $paid;

        // Order 1309 is the duplicate WC order created by the resubmission.
        $dup = new WC_Order(1309);
        $test_order_registry[1309] = $dup;

        $gateway = $this->createConfiguredGateway();

        // Minimal stand-ins for the Store API PaymentContext / PaymentResult.
        $context = new class($dup) {
            public $order;
            public $payment_method = 'conekta';
            public $payment_data;
            public function __construct($order) {
                $this->order = $order;
                $this->payment_data = ['conekta_order_id' => 'ord_dup123'];
            }
        };
        $result = new class {
            public $status;
            public $redirect_url;
            public $payment_details = [];
            public function set_status($s) { $this->status = $s; }
            public function set_redirect_url($u) { $this->redirect_url = $u; }
            public function set_payment_details($d) { $this->payment_details = $d; }
        };

        $gateway->process_payment_api($context, $result);

        // Result is success with a redirect (to the already-paid order)...
        $this->assertEquals('success', $result->status);
        $this->assertNotEmpty($result->redirect_url);
        // ...the duplicate order 1309 is NOT marked paid...
        $this->assertNotEquals('completed', $dup->get_status());
        $this->assertNotEquals('processing', $dup->get_status());
        // ...and it's cancelled so it doesn't linger as pending.
        $this->assertEquals('cancelled', $dup->get_status());
    }

    // -------------------------------------------------------
    // check_order_status (via Mockoon)
    // -------------------------------------------------------

    // -------------------------------------------------------
    // Webhook order.paid reconfirmation (case 4)
    // -------------------------------------------------------

    /**
     * @group mockoon
     */
    public function test_webhook_reconfirm_order_paid()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        // Simulates webhook flow: Conekta sends order.paid, plugin reconfirms via API
        $result = WC_Conekta_Plugin::check_order_status($api, 'ord_2znsJ8YNbNoDDsN3p', ['paid']);
        $this->assertTrue($result);
    }

    /**
     * @group mockoon
     */
    public function test_webhook_reconfirm_order_status_mismatch()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        // Webhook says paid but API returns a different status — should reject
        $result = WC_Conekta_Plugin::check_order_status($api, 'ord_2znsJ8YNbNoDDsN3p', ['expired']);
        $this->assertFalse($result);
    }

    /**
     * @group mockoon
     */
    public function test_webhook_reconfirm_order_expired()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        $result = WC_Conekta_Plugin::check_order_status($api, 'ord_2znsJ8YNbNoDDsNes', ['expired', 'canceled']);
        $this->assertTrue($result);
    }

    /**
     * @group mockoon
     */
    public function test_webhook_reconfirm_expired_rejects_paid()
    {
        $this->requireMockoon();

        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        // Order is expired but we check for paid — should reject
        $result = WC_Conekta_Plugin::check_order_status($api, 'ord_2znsJ8YNbNoDDsNes', ['paid']);
        $this->assertFalse($result);
    }

    // -------------------------------------------------------
    // check_if_payment_payment_method_webhook
    // -------------------------------------------------------

    public function test_webhook_payment_method_matches()
    {
        $event = [
            'data' => [
                'object' => [
                    'metadata' => [
                        'payment_method' => 'WC_Conekta_Gateway',
                    ],
                ],
            ],
        ];

        // Should not exit — payment method matches
        // If it doesn't match, the method calls exit() which would kill the test
        // So we just verify no exception is thrown
        WC_Conekta_Plugin::check_if_payment_payment_method_webhook('WC_Conekta_Gateway', $event);
        $this->assertTrue(true);
    }

    // -------------------------------------------------------
    // Discount / Coupon handling
    // -------------------------------------------------------

    public function test_discount_lines_built_from_coupons()
    {
        $order = new WC_Order(500);
        $order->set_coupons([
            ['name' => 'VERANO20', 'type' => 'percent', 'discount_amount' => 50.00],
            ['name' => 'ENVIOGRATIS', 'type' => 'fixed_cart', 'discount_amount' => 100.00],
        ]);

        $data = ckpg_get_request_data($order);

        $this->assertNotEmpty($data['discount_lines']);
        $this->assertCount(2, $data['discount_lines']);

        $this->assertEquals('VERANO20', $data['discount_lines'][0]['code']);
        $this->assertEquals(5000, $data['discount_lines'][0]['amount']);

        $this->assertEquals('ENVIOGRATIS', $data['discount_lines'][1]['code']);
        $this->assertEquals(10000, $data['discount_lines'][1]['amount']);
    }

    public function test_discount_lines_empty_without_coupons()
    {
        $order = new WC_Order(501);
        $data = ckpg_get_request_data($order);

        $discounts = $data['discount_lines'] ?? [];
        $this->assertEmpty($discounts);
    }

    public function test_order_request_includes_discount_lines()
    {
        $order = new WC_Order(502);
        $order->set_coupons([
            ['name' => 'DESC10', 'type' => 'percent', 'discount_amount' => 10.00],
            ['name' => 'PROMO50', 'type' => 'fixed_cart', 'discount_amount' => 50.00],
        ]);

        // Build the request data exactly as process_conekta_payment_for_order does
        $data = ckpg_get_request_data($order);
        $fees_formatted = ckpg_build_get_fees($order->get_fees());
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $fees_formatted['discounts']);

        $rq = new \Conekta\Model\OrderRequest([
            'currency' => $data['currency'],
            'discount_lines' => $discount_lines,
            'line_items' => [],
            'shipping_lines' => ckpg_build_shipping_lines($data),
            'tax_lines' => [],
            'customer_info' => ckpg_build_customer_info($data),
        ]);

        // Validate the OrderRequest has the discount lines
        $requestBody = json_decode($rq->__toString(), true);

        $this->assertNotEmpty($requestBody['discount_lines']);
        $this->assertCount(2, $requestBody['discount_lines']);

        $this->assertEquals('DESC10', $requestBody['discount_lines'][0]['code']);
        $this->assertEquals(1000, $requestBody['discount_lines'][0]['amount']);
        $this->assertEquals('coupon', $requestBody['discount_lines'][0]['type']);

        $this->assertEquals('PROMO50', $requestBody['discount_lines'][1]['code']);
        $this->assertEquals(5000, $requestBody['discount_lines'][1]['amount']);
        $this->assertEquals('coupon', $requestBody['discount_lines'][1]['type']);
    }

    // -------------------------------------------------------
    // ckpg_build_line_items — price-level discount via &$price_level_discount
    // -------------------------------------------------------

    public function test_build_line_items_no_discount_when_regular_price_unset()
    {
        $items = [[
            'line_subtotal' => 800.00,
            'qty'           => 2,
            'product_id'    => 99,
            'name'          => 'No Regular Price',
            'variation_id'  => 0,
        ]];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        $this->assertEquals(0, $discount);
        $this->assertEquals(40000, $line_items[0]['unit_price']); // 800/2 * 100
    }

    public function test_build_line_items_uses_effective_price_no_dynamic_pricing()
    {
        // A product on sale (regular 500, effective 400) must be sent at the
        // EFFECTIVE price with NO dynamic_pricing discount synthesized.
        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 800.00, // effective: 400 each × 2
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Discounted Product',
            'variation_id'  => 0,
        ]];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        // unit_price = effective price (800/2 = 400 → 40000), NOT the regular.
        $this->assertEquals(40000, $line_items[0]['unit_price']);
        // No price-level discount is produced anymore.
        $this->assertEquals(0, $discount);
    }

    public function test_build_line_items_mixed_products_all_at_effective_price()
    {
        $this->registerProduct(10, 500.00); // regular=500, effective=400
        $this->registerProduct(20, 300.00); // regular=300, effective=300

        $items = [
            [
                'line_subtotal' => 800.00, // 400 × 2
                'qty'           => 2,
                'product_id'    => 10,
                'name'          => 'Discounted',
                'variation_id'  => 0,
            ],
            [
                'line_subtotal' => 300.00, // 300 × 1 (no discount)
                'qty'           => 1,
                'product_id'    => 20,
                'name'          => 'Full Price',
                'variation_id'  => 0,
            ],
        ];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        $this->assertCount(2, $line_items);
        $this->assertEquals(40000, $line_items[0]['unit_price']); // effective, not regular
        $this->assertEquals(30000, $line_items[1]['unit_price']); // unchanged
        $this->assertEquals(0, $discount); // no dynamic_pricing produced
    }

    public function test_build_line_items_backward_compatible_without_third_param()
    {
        $items = [[
            'line_subtotal' => 500.00,
            'qty'           => 1,
            'product_id'    => 99,
            'name'          => 'Simple',
            'variation_id'  => 0,
        ]];

        // Called WITHOUT the third parameter (old callers)
        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertCount(1, $line_items);
        $this->assertEquals(50000, $line_items[0]['unit_price']);
    }

    // -------------------------------------------------------
    // ckpg_build_line_items — line items always carry the EFFECTIVE net
    // price and never synthesize a dynamic_pricing discount (BE-924).
    // The original bug (tax reported as a discount) is gone simply because
    // no price-level discount line is produced at all; tax stays in tax_lines.
    // -------------------------------------------------------

    public function test_build_line_items_tax_inclusive_no_false_discount()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = true;

        // Regular price entered tax-inclusive: 2610 gross = 2250 net @ 16% IVA.
        $this->registerProduct(10, 2610.00);

        $items = [[
            'line_subtotal' => 2250.00, // WooCommerce stores the NET subtotal
            'qty'           => 1,
            'product_id'    => 10,
            'name'          => 'Tax Inclusive Product',
            'variation_id'  => 0,
        ]];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        // The IVA is NOT a discount; no dynamic_pricing produced.
        $this->assertEquals(0, $discount);
        // unit_price is the net line subtotal: 2250 * 100.
        $this->assertEquals(225000, $line_items[0]['unit_price']);
    }

    public function test_build_line_items_tax_inclusive_sale_uses_effective_price()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = true;

        // Regular gross 2610. Sold for net 2000 (a real sale).
        $this->registerProduct(10, 2610.00);

        $items = [[
            'line_subtotal' => 2000.00, // net effective price
            'qty'           => 1,
            'product_id'    => 10,
            'name'          => 'Tax Inclusive Discounted',
            'variation_id'  => 0,
        ]];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        // unit_price = effective net price (2000), NOT the regular; no discount.
        $this->assertEquals(200000, $line_items[0]['unit_price']);
        $this->assertEquals(0, $discount);
    }

    public function test_build_line_items_tax_exclusive_sale_uses_effective_price()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = false; // explicit: prices entered net

        // Net regular 500, effective 400.
        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 800.00, // 400 each x 2
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Tax Exclusive Discounted',
            'variation_id'  => 0,
        ]];

        $discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $discount);

        // unit_price = effective price (400), no dynamic_pricing produced.
        $this->assertEquals(40000, $line_items[0]['unit_price']);
        $this->assertEquals(0, $discount);
    }

    // -------------------------------------------------------
    // ckpg_build_line_items — tax_included metadata flag
    // -------------------------------------------------------

    public function test_build_line_items_metadata_tax_included_true_when_inclusive()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = true;

        $this->registerProduct(10, 2610.00); // taxable by default

        $items = [[
            'line_subtotal' => 2250.00,
            'qty'           => 1,
            'product_id'    => 10,
            'name'          => 'Tax Inclusive Product',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertTrue($line_items[0]['metadata']['tax_included']);
    }

    public function test_build_line_items_metadata_tax_included_false_when_exclusive()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = false;

        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 500.00,
            'qty'           => 1,
            'product_id'    => 10,
            'name'          => 'Tax Exclusive Product',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertFalse($line_items[0]['metadata']['tax_included']);
    }

    public function test_build_line_items_metadata_tax_included_false_for_exempt_product()
    {
        global $test_prices_include_tax;
        $test_prices_include_tax = true; // store is inclusive...

        // ...but this product is tax-exempt, so its price carries no tax.
        $this->registerProduct(10, 500.00, 0, '', false);

        $items = [[
            'line_subtotal' => 500.00,
            'qty'           => 1,
            'product_id'    => 10,
            'name'          => 'Tax Exempt Product',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertFalse($line_items[0]['metadata']['tax_included']);
    }

    // -------------------------------------------------------
    // ckpg_item_tax_included — store + product taxability matrix
    // -------------------------------------------------------

    public function test_item_tax_included_matrix()
    {
        global $test_prices_include_tax;
        $taxable = new WC_Product(0); // stub is taxable by default

        $test_prices_include_tax = true;
        $this->assertTrue(ckpg_item_tax_included($taxable));

        $test_prices_include_tax = false;
        $this->assertFalse(ckpg_item_tax_included($taxable));
    }

    // -------------------------------------------------------
    // ckpg_build_get_fees — negative fees as discount lines
    // -------------------------------------------------------

    public function test_build_get_fees_separates_positive_and_negative_fees()
    {
        $fees = [
            new class {
                public function get_total() { return -150.00; }
                public function get_name() { return 'Dynamic Pricing Discount'; }
            },
            new class {
                public function get_total() { return 50.00; }
                public function get_name() { return 'Service Fee'; }
            },
            new class {
                public function get_total() { return -25.00; }
                public function get_name() { return 'Loyalty Discount'; }
            },
        ];

        $result = ckpg_build_get_fees($fees);

        // Negative fees → discounts
        $this->assertCount(2, $result['discounts']);
        $this->assertEquals('Dynamic Pricing Discount', $result['discounts'][0]['code']);
        $this->assertEquals(15000, $result['discounts'][0]['amount']);
        $this->assertEquals('campaign', $result['discounts'][0]['type']);
        $this->assertEquals('Loyalty Discount', $result['discounts'][1]['code']);
        $this->assertEquals(2500, $result['discounts'][1]['amount']);

        // Positive fees → fees (tax_lines in Conekta)
        $this->assertCount(1, $result['fees']);
        $this->assertEquals('Service Fee', $result['fees'][0]['description']);
        $this->assertEquals(5000, $result['fees'][0]['amount']);
    }

    public function test_build_get_fees_empty_input()
    {
        $result = ckpg_build_get_fees([]);

        $this->assertEmpty($result['discounts']);
        $this->assertEmpty($result['fees']);
    }

    public function test_build_get_fees_zero_amount_classified_as_positive()
    {
        $fees = [
            new class {
                public function get_total() { return 0; }
                public function get_name() { return 'Zero Fee'; }
            },
        ];

        $result = ckpg_build_get_fees($fees);

        // 0 >= 0 → positive side, but with amount 0
        $this->assertEmpty($result['discounts']);
        $this->assertCount(1, $result['fees']);
        $this->assertEquals(0, $result['fees'][0]['amount']);
    }

    public function test_build_get_fees_only_negative()
    {
        $fees = [
            new class {
                public function get_total() { return -200.00; }
                public function get_name() { return 'Big Discount'; }
            },
        ];

        $result = ckpg_build_get_fees($fees);

        $this->assertCount(1, $result['discounts']);
        $this->assertEquals(20000, $result['discounts'][0]['amount']);
        $this->assertEmpty($result['fees']);
    }

    // -------------------------------------------------------
    // ckpg_check_balance — verify balance equation with discount_lines
    // -------------------------------------------------------

    public function test_check_balance_with_discount_lines()
    {
        // Setup: items=50000, shipping=5000, discount=10000, tax=0
        // Expected total = 50000 + 5000 - 10000 = 45000
        $order = [
            'line_items'     => [['unit_price' => 50000, 'quantity' => 1]],
            'shipping_lines' => [['amount' => 5000]],
            'discount_lines' => [['amount' => 10000]],
            'tax_lines'      => [['amount' => 0, 'description' => 'Tax']],
        ];
        $total = 45000;

        $result = ckpg_check_balance($order, $total);

        // Balance should match — no adjustment needed
        $this->assertEquals(0, $result['tax_lines'][0]['amount']);
    }

    public function test_check_balance_adjusts_when_off()
    {
        // items=50000, shipping=5000, discount=10000, tax=1500
        // sum = 50000 + 5000 - 10000 + 1500 = 46500
        // total = 46600 → off by 100
        $order = [
            'line_items'     => [['unit_price' => 50000, 'quantity' => 1]],
            'shipping_lines' => [['amount' => 5000]],
            'discount_lines' => [['amount' => 10000]],
            'tax_lines'      => [['amount' => 1500, 'description' => 'IVA']],
        ];
        $total = 46600;

        $result = ckpg_check_balance($order, $total);

        // Tax should be adjusted by +100 to balance
        $this->assertEquals(1600, $result['tax_lines'][0]['amount']);
    }

    public function test_check_balance_with_dynamic_pricing_discount_line()
    {
        // Real scenario: regular_price=500*2=100000, discount=20000, shipping=5000
        // Net = 100000 + 5000 - 20000 = 85000
        $order = [
            'line_items'     => [['unit_price' => 50000, 'quantity' => 2]],
            'shipping_lines' => [['amount' => 5000]],
            'discount_lines' => [['amount' => 20000]],
            'tax_lines'      => [['amount' => 0, 'description' => 'Tax']],
        ];
        $total = 85000;

        $result = ckpg_check_balance($order, $total);

        // Should balance perfectly
        $this->assertEquals(0, $result['tax_lines'][0]['amount']);
    }

    // -------------------------------------------------------
    // ckpg_check_balance — rounding reconciliation border cases.
    // Semantics: undercount (charging too little) -> add to TAX;
    //            overcount  (charging too much)   -> round_adjustment DISCOUNT.
    // The reported tax is never reduced, and the order total always matches
    // $total exactly so the rounding error never reaches Conekta.
    // -------------------------------------------------------

    /**
     * Exact overcount scenario observed in staging (WC #7344): unit_price
     * 25991 * 3 = 77973 (+1¢ from line_subtotal/qty rounding) and tax 14889
     * (+1¢), so the lines sum to 107943 but the WooCommerce total is 107941.
     * The 2¢ overcount becomes a round_adjustment discount; tax is untouched.
     */
    public function test_check_balance_overcount_becomes_discount()
    {
        $order = [
            'line_items'     => [['unit_price' => 25991, 'quantity' => 3]], // 77973
            'shipping_lines' => [['amount' => 15081]],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 14889, 'description' => 'IVA GENERAL']],
        ];
        // Lines sum = 77973 + 15081 + 14889 = 107943; WC total = 107941.
        $result = ckpg_check_balance($order, 107941);

        // Tax keeps its true value; the 2¢ excess becomes a discount.
        $this->assertEquals(14889, $result['tax_lines'][0]['amount']);
        $this->assertCount(1, $result['discount_lines']);
        $this->assertEquals('round_adjustment', $result['discount_lines'][0]['code']);
        $this->assertEquals('campaign', $result['discount_lines'][0]['type']);
        $this->assertEquals(2, $result['discount_lines'][0]['amount']);
        $this->assertEquals(107941, $this->sumOrder($result));
    }

    public function test_check_balance_overcount_with_no_tax_line()
    {
        // Tax-exclusive cart with no tax, items overcount by 1¢.
        $order = [
            'line_items'     => [['unit_price' => 9734, 'quantity' => 3]], // 29202
            'shipping_lines' => [],
            'discount_lines' => [],
            'tax_lines'      => [],
        ];
        // Lines sum = 29202; WC total = 29201 (1¢ too much).
        $result = ckpg_check_balance($order, 29201);

        $this->assertEmpty($result['tax_lines']);
        $this->assertCount(1, $result['discount_lines']);
        $this->assertEquals('round_adjustment', $result['discount_lines'][0]['code']);
        $this->assertEquals(1, $result['discount_lines'][0]['amount']);
        $this->assertEquals(29201, $this->sumOrder($result));
    }

    public function test_check_balance_overcount_preserves_existing_discounts()
    {
        // A real coupon is already present; the round_adjustment is appended.
        $order = [
            'line_items'     => [['unit_price' => 25991, 'quantity' => 3]], // 77973
            'shipping_lines' => [],
            'discount_lines' => [['code' => 'VERANO', 'amount' => 5000, 'type' => 'coupon']],
            'tax_lines'      => [['amount' => 12476, 'description' => 'IVA']],
        ];
        // Lines sum = 77973 - 5000 + 12476 = 85449; WC total = 85447 (2¢ too much).
        $result = ckpg_check_balance($order, 85447);

        $this->assertCount(2, $result['discount_lines']);
        $this->assertEquals('VERANO', $result['discount_lines'][0]['code']); // untouched
        $this->assertEquals('round_adjustment', $result['discount_lines'][1]['code']);
        $this->assertEquals(2, $result['discount_lines'][1]['amount']);
        $this->assertEquals(12476, $result['tax_lines'][0]['amount']); // tax untouched
        $this->assertEquals(85447, $this->sumOrder($result));
    }

    public function test_check_balance_undercount_adds_to_tax()
    {
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 1]],
            'shipping_lines' => [],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 1600, 'description' => 'IVA']],
        ];
        // Lines sum = 11600; WC total = 11603 (we under-counted by 3¢).
        $result = ckpg_check_balance($order, 11603);

        $this->assertEquals(1603, $result['tax_lines'][0]['amount']);
        $this->assertEmpty($result['discount_lines']); // no discount on undercount
        $this->assertEquals(11603, $this->sumOrder($result));
    }

    public function test_check_balance_undercount_adds_tax_line_when_missing()
    {
        $order = [
            'line_items'     => [['unit_price' => 33333, 'quantity' => 3]], // 99999
            'shipping_lines' => [],
            'discount_lines' => [],
            'tax_lines'      => [],
        ];
        // Lines sum = 99999; WC total = 100000 (1¢ short, no tax line yet).
        $result = ckpg_check_balance($order, 100000);

        $this->assertCount(1, $result['tax_lines']);
        $this->assertEquals(1, $result['tax_lines'][0]['amount']);
        $this->assertEquals('Round Adjustment', $result['tax_lines'][0]['description']);
        $this->assertEquals(100000, $this->sumOrder($result));
    }

    public function test_check_balance_exact_total_no_adjustment()
    {
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 2]], // 20000
            'shipping_lines' => [['amount' => 5000]],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 4000, 'description' => 'IVA']],
        ];
        // Lines sum = 29000 == WC total → nothing to reconcile.
        $result = ckpg_check_balance($order, 29000);

        $this->assertEquals(4000, $result['tax_lines'][0]['amount']);
        $this->assertEmpty($result['discount_lines']);
        $this->assertEquals(29000, $this->sumOrder($result));
    }

    /** Recompute an order's net total the same way Conekta does. */
    private function sumOrder(array $order): int
    {
        $amount = 0;
        foreach ($order['line_items'] as $li)     { $amount += $li['unit_price'] * $li['quantity']; }
        foreach ($order['shipping_lines'] as $sl) { $amount += $sl['amount']; }
        foreach (($order['discount_lines'] ?? []) as $dl) { $amount -= $dl['amount']; }
        foreach ($order['tax_lines'] as $tl)      { $amount += $tl['amount']; }
        return $amount;
    }

    // =========================================================
    // conekta_gateway_helper.php — comprehensive function tests
    // =========================================================

    // -------------------------------------------------------
    // amount_validation
    // -------------------------------------------------------

    public function test_amount_validation_normal()
    {
        $this->assertEquals(10000, amount_validation(100.00));
        $this->assertEquals(50050, amount_validation(500.50));
    }

    public function test_amount_validation_rounds_correctly()
    {
        // 199.99 * 100 = 19999.0 → 19999
        $this->assertEquals(19999, amount_validation(199.99));
        // Float imprecision: 99.99 * 100 can be 9998.999...96 → round → 9999
        $this->assertEquals(9999, amount_validation(99.99));
        // 0.1 + 0.2 style edge: 33.33 * 100 = 3333.0 → 3333
        $this->assertEquals(3333, amount_validation(33.33));
    }

    public function test_amount_validation_zero()
    {
        $this->assertEquals(0, amount_validation(0));
        $this->assertEquals(0, amount_validation(0.00));
    }

    public function test_amount_validation_negative()
    {
        $this->assertEquals(-5000, amount_validation(-50.00));
    }

    public function test_amount_validation_small_decimals()
    {
        $this->assertEquals(1, amount_validation(0.01));
        $this->assertEquals(99, amount_validation(0.99));
    }

    public function test_amount_validation_large_amount()
    {
        $this->assertEquals(9999999, amount_validation(99999.99));
    }

    // -------------------------------------------------------
    // validate_total
    // -------------------------------------------------------

    public function test_validate_total_numeric_string()
    {
        $this->assertEquals(10000.0, validate_total('100.00'));
        $this->assertEquals(5000.0, validate_total('50'));
    }

    public function test_validate_total_integer()
    {
        $this->assertEquals(10000.0, validate_total(100));
    }

    public function test_validate_total_non_numeric_returns_as_is()
    {
        $this->assertEquals('abc', validate_total('abc'));
        $this->assertEquals('', validate_total(''));
    }

    public function test_validate_total_zero()
    {
        $this->assertEquals(0.0, validate_total('0'));
        $this->assertEquals(0.0, validate_total(0));
    }

    // -------------------------------------------------------
    // item_name_validation
    // -------------------------------------------------------

    public function test_item_name_validation_normal()
    {
        $this->assertEquals('Producto de prueba', item_name_validation('Producto de prueba'));
    }

    public function test_item_name_validation_empty()
    {
        $this->assertEquals('', item_name_validation(''));
    }

    public function test_item_name_validation_default()
    {
        $this->assertEquals('', item_name_validation());
    }

    public function test_item_name_validation_passes_through_sanitize()
    {
        // sanitize_text_field in real WP strips tags; stub is pass-through.
        // This test verifies the function delegates to sanitize_text_field.
        $result = item_name_validation('Product <Special>');
        $this->assertIsString($result);
        $this->assertNotEmpty($result);
    }

    // -------------------------------------------------------
    // post_code_validation
    // -------------------------------------------------------

    public function test_post_code_validation_five_chars()
    {
        $this->assertEquals('06600', post_code_validation('06600'));
    }

    public function test_post_code_validation_truncates_long()
    {
        $this->assertEquals('06600', post_code_validation('066001'));
        $this->assertEquals('11010', post_code_validation('11010999'));
    }

    public function test_post_code_validation_short_unchanged()
    {
        $this->assertEquals('123', post_code_validation('123'));
        $this->assertEquals('1', post_code_validation('1'));
    }

    public function test_post_code_validation_empty()
    {
        $this->assertEquals('', post_code_validation(''));
        $this->assertEquals('', post_code_validation());
    }

    // -------------------------------------------------------
    // int_validation
    // -------------------------------------------------------

    public function test_int_validation_numeric_string()
    {
        $this->assertEquals(123, int_validation('123'));
    }

    public function test_int_validation_integer()
    {
        $this->assertEquals(456, int_validation(456));
    }

    public function test_int_validation_float_truncates()
    {
        $this->assertEquals(12, int_validation('12.9'));
    }

    public function test_int_validation_non_numeric_returns_as_is()
    {
        $this->assertEquals('abc', int_validation('abc'));
        $this->assertEquals('', int_validation(''));
    }

    public function test_int_validation_zero()
    {
        $this->assertEquals(0, int_validation('0'));
        $this->assertEquals(0, int_validation(0));
    }

    // -------------------------------------------------------
    // get_expired_at / get_expired_at_minutes
    // -------------------------------------------------------

    public function test_get_expired_at_future_timestamp()
    {
        $now = time();
        $result = get_expired_at(1);

        // Should be roughly 1 day ahead (allow ±2 hours for timezone)
        $this->assertGreaterThan($now, $result);
        $this->assertLessThan($now + 86400 + 7200, $result);
    }

    public function test_get_expired_at_30_days()
    {
        $now = time();
        $result = get_expired_at(30);

        $this->assertGreaterThan($now + (29 * 86400), $result);
        $this->assertLessThan($now + (31 * 86400), $result);
    }

    public function test_get_expired_at_minutes_10()
    {
        $now = time();
        $result = get_expired_at_minutes(10);

        // Should be 10 minutes ahead (±10 seconds tolerance)
        $expected = $now + 600;
        $this->assertGreaterThanOrEqual($expected - 10, $result);
        $this->assertLessThanOrEqual($expected + 10, $result);
    }

    public function test_get_expired_at_minutes_1440()
    {
        $now = time();
        $result = get_expired_at_minutes(1440);

        $expected = $now + 86400;
        $this->assertGreaterThanOrEqual($expected - 10, $result);
        $this->assertLessThanOrEqual($expected + 10, $result);
    }

    // -------------------------------------------------------
    // ckpg_build_order_metadata
    // -------------------------------------------------------

    public function test_build_order_metadata_basic()
    {
        $data = [
            'order_id'               => 123,
            'plugin_conekta_version' => '5.4.12',
            'woocommerce_version'    => '9.0.0',
            'payment_method'         => 'WC_Conekta_Gateway',
        ];

        $result = ckpg_build_order_metadata($data);

        $this->assertEquals(123, $result['reference_id']);
        $this->assertEquals('5.4.12', $result['plugin_conekta_version']);
        $this->assertEquals('woocommerce', $result['plugin']);
        $this->assertEquals('9.0.0', $result['woocommerce_version']);
        $this->assertEquals('WC_Conekta_Gateway', $result['payment_method']);
        $this->assertArrayNotHasKey('customer_message', $result);
    }

    public function test_build_order_metadata_with_customer_message()
    {
        $data = [
            'order_id'               => 456,
            'plugin_conekta_version' => '5.4.12',
            'woocommerce_version'    => '9.0.0',
            'payment_method'         => 'WC_Conekta_Gateway',
            'customer_message'       => 'Entregar por la tarde',
        ];

        $result = ckpg_build_order_metadata($data);

        $this->assertArrayHasKey('customer_message', $result);
        $this->assertEquals('Entregar por la tarde', $result['customer_message']);
    }

    public function test_build_order_metadata_empty_customer_message_excluded()
    {
        $data = [
            'order_id'               => 789,
            'plugin_conekta_version' => '5.4.12',
            'woocommerce_version'    => '9.0.0',
            'payment_method'         => 'WC_Conekta_Gateway',
            'customer_message'       => '',
        ];

        $result = ckpg_build_order_metadata($data);

        $this->assertArrayNotHasKey('customer_message', $result);
    }

    // -------------------------------------------------------
    // ckpg_build_tax_lines
    // -------------------------------------------------------

    public function test_build_tax_lines_single_tax()
    {
        $taxes = [
            ['tax_amount' => 16.00, 'label' => 'IVA'],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
    }

    public function test_build_tax_lines_with_shipping_tax()
    {
        $taxes = [
            ['tax_amount' => 16.00, 'label' => 'IVA', 'shipping_tax_amount' => 2.40],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(2, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
        $this->assertEquals('Shipping tax', $result[1]['description']);
        $this->assertEquals(240, $result[1]['amount']);
    }

    public function test_build_tax_lines_empty()
    {
        $this->assertEmpty(ckpg_build_tax_lines([]));
    }

    public function test_build_tax_lines_multiple()
    {
        $taxes = [
            ['tax_amount' => 16.00, 'label' => 'IVA'],
            ['tax_amount' => 3.00, 'label' => 'IEPS'],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(2, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals('IEPS', $result[1]['description']);
        $this->assertEquals(300, $result[1]['amount']);
    }

    public function test_build_tax_lines_zero_amount_is_omitted()
    {
        // Zero-amount taxes should NOT be sent to Conekta.
        $taxes = [
            ['tax_amount' => 0, 'label' => 'Exempt'],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertEmpty($result, 'Zero-amount tax should be omitted from tax_lines');
    }

    public function test_build_tax_lines_zero_items_with_nonzero_shipping_emits_only_shipping()
    {
        $taxes = [
            new WC_Order_Item_Tax([
                'label'              => 'IVA',
                'tax_total'          => 0,
                'shipping_tax_total' => 2.40,
            ]),
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result);
        $this->assertEquals('Shipping tax', $result[0]['description']);
        $this->assertEquals(240, $result[0]['amount']);
    }

    // -------------------------------------------------------
    // BE-839: ckpg_build_tax_lines must accept real WC_Order_Item_Tax objects
    // -------------------------------------------------------

    /**
     * Real WooCommerce >= 3.0 returns WC_Order_Item_Tax objects from
     * $order->get_taxes(). Those objects expose `tax_total`/`shipping_tax_total`
     * via ArrayAccess — NOT the legacy `tax_amount`/`shipping_tax_amount` keys.
     */
    public function test_build_tax_lines_reads_tax_total_from_wc_order_item_tax()
    {
        $taxes = [
            new WC_Order_Item_Tax([
                'label'     => 'IVA',
                'tax_total' => 16.00,
            ]),
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount'], 'IVA over items must be 1600 cents, not 0');
    }

    public function test_build_tax_lines_reads_shipping_tax_total_from_wc_order_item_tax()
    {
        $taxes = [
            new WC_Order_Item_Tax([
                'label'              => 'IVA',
                'tax_total'          => 16.00,
                'shipping_tax_total' => 2.40,
            ]),
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(2, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
        $this->assertEquals('Shipping tax', $result[1]['description']);
        $this->assertEquals(240, $result[1]['amount'], 'Shipping IVA must be 240 cents, not 0');
    }

    public function test_build_tax_lines_omits_zero_shipping_tax_from_object()
    {
        // A WC_Order_Item_Tax always exposes shipping_tax_total (defaults to 0).
        // We should NOT emit a "Shipping tax" line when the value is 0.
        $taxes = [
            new WC_Order_Item_Tax([
                'label'              => 'IVA',
                'tax_total'          => 16.00,
                'shipping_tax_total' => 0,
            ]),
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result, 'Zero shipping_tax_total should not produce a Shipping tax line');
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
    }

    public function test_build_tax_lines_multiple_real_objects()
    {
        $taxes = [
            new WC_Order_Item_Tax([
                'label'              => 'IVA',
                'tax_total'          => 16.00,
                'shipping_tax_total' => 2.40,
            ]),
            new WC_Order_Item_Tax([
                'label'     => 'IEPS',
                'tax_total' => 3.00,
            ]),
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(3, $result); // IVA + Shipping tax + IEPS
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
        $this->assertEquals('Shipping tax', $result[1]['description']);
        $this->assertEquals(240, $result[1]['amount']);
        $this->assertEquals('IEPS', $result[2]['description']);
        $this->assertEquals(300, $result[2]['amount']);
    }

    /**
     * End-to-end: $order->get_taxes() returns WC_Order_Item_Tax objects and the
     * resulting tax_lines must carry the correct IVA amount, NOT 0.
     */
    public function test_order_taxes_pipeline_reports_iva_for_items_and_shipping()
    {
        $order = new WC_Order(700);
        $order->set_taxes([
            new WC_Order_Item_Tax([
                'label'              => 'IVA',
                'tax_total'          => 80.00,   // IVA over items
                'shipping_tax_total' => 16.00,   // IVA over shipping
            ]),
        ]);

        $tax_lines = ckpg_build_tax_lines($order->get_taxes());

        $this->assertCount(2, $tax_lines);
        $this->assertEquals('IVA', $tax_lines[0]['description']);
        $this->assertEquals(8000, $tax_lines[0]['amount']);
        $this->assertEquals('Shipping tax', $tax_lines[1]['description']);
        $this->assertEquals(1600, $tax_lines[1]['amount']);
    }

    public function test_build_tax_lines_with_zero_shipping_tax()
    {
        // shipping_tax_amount === 0 should NOT emit a "Shipping tax" line.
        $taxes = [
            ['tax_amount' => 16.00, 'label' => 'IVA', 'shipping_tax_amount' => 0],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result);
        $this->assertEquals('IVA', $result[0]['description']);
    }

    // -------------------------------------------------------
    // ckpg_build_tax_lines_from_cart
    // -------------------------------------------------------

    public function test_build_tax_lines_from_cart_single_rate()
    {
        $cart = WC_Cart_Test_Helper::create()
            ->withTaxTotal('iva-16', 'IVA', 16.00);

        $result = ckpg_build_tax_lines_from_cart($cart);

        $this->assertCount(1, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
    }

    public function test_build_tax_lines_from_cart_multi_rate()
    {
        $cart = WC_Cart_Test_Helper::create()
            ->withTaxTotal('iva-16', 'IVA', 16.00)
            ->withTaxTotal('ieps', 'IEPS', 3.00);

        $result = ckpg_build_tax_lines_from_cart($cart);

        $this->assertCount(2, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
        $this->assertEquals('IEPS', $result[1]['description']);
        $this->assertEquals(300, $result[1]['amount']);
    }

    public function test_build_tax_lines_from_cart_with_shipping_tax()
    {
        $cart = WC_Cart_Test_Helper::create()
            ->withTaxTotal('iva-16', 'IVA', 16.00, 2.40);

        $result = ckpg_build_tax_lines_from_cart($cart);

        $this->assertCount(2, $result);
        $this->assertEquals('IVA', $result[0]['description']);
        $this->assertEquals(1600, $result[0]['amount']);
        $this->assertEquals('Shipping tax', $result[1]['description']);
        $this->assertEquals(240, $result[1]['amount']);
    }

    public function test_build_tax_lines_from_cart_zero_shipping_tax_guarded()
    {
        $cart = WC_Cart_Test_Helper::create()
            ->withTaxTotal('iva-16', 'IVA', 16.00, 0.0);

        $result = ckpg_build_tax_lines_from_cart($cart);

        $this->assertCount(1, $result);
        $this->assertEquals('IVA', $result[0]['description']);
    }

    public function test_build_tax_lines_from_cart_empty_returns_empty()
    {
        $cart = WC_Cart_Test_Helper::create();

        $this->assertEmpty(ckpg_build_tax_lines_from_cart($cart));
    }

    public function test_build_tax_lines_from_cart_null_cart_returns_empty()
    {
        $this->assertEmpty(ckpg_build_tax_lines_from_cart(null));
    }

    // -------------------------------------------------------
    // ckpg_build_shipping_lines
    // -------------------------------------------------------

    public function test_build_shipping_lines_with_data()
    {
        $data = [
            'shipping_lines' => [
                ['amount' => 5000, 'carrier' => 'DHL', 'method' => 'express'],
            ],
        ];

        $result = ckpg_build_shipping_lines($data);

        $this->assertCount(1, $result);
        $this->assertEquals(5000, $result[0]['amount']);
        $this->assertEquals('DHL', $result[0]['carrier']);
    }

    public function test_build_shipping_lines_empty()
    {
        $this->assertEmpty(ckpg_build_shipping_lines([]));
        $this->assertEmpty(ckpg_build_shipping_lines(['shipping_lines' => []]));
    }

    // -------------------------------------------------------
    // ckpg_build_shipping_contact
    // -------------------------------------------------------

    public function test_build_shipping_contact_with_data()
    {
        $data = [
            'shipping_contact' => [
                'phone'    => '5555555555',
                'receiver' => 'John Doe',
                'address'  => ['street1' => 'Calle 1'],
            ],
        ];

        $result = ckpg_build_shipping_contact($data);

        $this->assertEquals('John Doe', $result['receiver']);
        $this->assertTrue($result['metadata']['soft_validations']);
    }

    public function test_build_shipping_contact_empty()
    {
        $this->assertEmpty(ckpg_build_shipping_contact([]));
        $this->assertEmpty(ckpg_build_shipping_contact(['other' => 'data']));
    }

    // -------------------------------------------------------
    // ckpg_build_customer_info
    // -------------------------------------------------------

    public function test_build_customer_info_adds_metadata()
    {
        $data = [
            'customer_info' => [
                'name'  => 'John Doe',
                'phone' => '5555555555',
                'email' => 'john@example.com',
            ],
        ];

        $result = ckpg_build_customer_info($data);

        $this->assertEquals('John Doe', $result['name']);
        $this->assertEquals('john@example.com', $result['email']);
        $this->assertTrue($result['metadata']['soft_validations']);
    }

    // -------------------------------------------------------
    // ckpg_build_discount_lines (the helper function, not the cart one)
    // -------------------------------------------------------

    public function test_build_discount_lines_from_data()
    {
        $data = [
            'discount_lines' => [
                ['code' => 'PROMO', 'amount' => 5000],
                ['code' => 'VIP', 'amount' => 2000],
            ],
        ];

        $result = ckpg_build_discount_lines($data);

        $this->assertCount(2, $result);
        $this->assertEquals('PROMO', $result[0]['code']);
        $this->assertEquals(5000, $result[0]['amount']);
        $this->assertEquals('coupon', $result[0]['type']);
        $this->assertEquals('VIP', $result[1]['code']);
    }

    public function test_build_discount_lines_empty_data()
    {
        $this->assertEmpty(ckpg_build_discount_lines([]));
        $this->assertEmpty(ckpg_build_discount_lines(['discount_lines' => []]));
    }

    public function test_build_discount_lines_preserves_type()
    {
        $data = [
            'discount_lines' => [
                ['code' => 'CUPON10', 'amount' => 1000, 'type' => 'coupon'],
                ['code' => 'dynamic_pricing', 'amount' => 5000, 'type' => 'campaign'],
            ],
        ];

        $result = ckpg_build_discount_lines($data);

        $this->assertEquals('coupon', $result[0]['type']);
        $this->assertEquals('campaign', $result[1]['type'], 'campaign type must not be overridden to coupon');
    }

    public function test_build_discount_lines_defaults_to_coupon_when_type_missing()
    {
        $data = [
            'discount_lines' => [
                ['code' => 'OLD_FORMAT', 'amount' => 2000],
            ],
        ];

        $result = ckpg_build_discount_lines($data);

        $this->assertEquals('coupon', $result[0]['type']);
    }

    // -------------------------------------------------------
    // ckpg_build_line_items — unit_price calculation
    // -------------------------------------------------------

    public function test_build_line_items_unit_price_calculation()
    {
        // line_subtotal=1000, qty=2 → per unit = 1000/2 = 500
        // unit_price = (500 * 1000) / 10 = 50000 ... wait
        // Actually: sub_total = 1000 * 1000 = 1000000; / 2 = 500000; / 10 = 50000
        $items = [[
            'line_subtotal' => 1000.00,
            'qty'           => 2,
            'product_id'    => 99,
            'name'          => 'Widget',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertEquals(50000, $line_items[0]['unit_price']); // 500 MXN in cents
        $this->assertEquals(2, $line_items[0]['quantity']);
        $this->assertEquals('Widget', $line_items[0]['name']);
    }

    public function test_build_line_items_single_quantity()
    {
        $items = [[
            'line_subtotal' => 299.99,
            'qty'           => 1,
            'product_id'    => 99,
            'name'          => 'Single',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        // 299.99 * 1000 / 1 / 10 = 29999
        $this->assertEquals(29999, $line_items[0]['unit_price']);
    }

    public function test_build_line_items_includes_tags_and_metadata()
    {
        $items = [[
            'line_subtotal' => 100.00,
            'qty'           => 1,
            'product_id'    => 99,
            'name'          => 'Tagged',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        $this->assertContains('WooCommerce', $line_items[0]['tags']);
        $this->assertContains('Conekta 5.4.12', $line_items[0]['tags']);
        $this->assertTrue($line_items[0]['metadata']['soft_validations']);
    }

    public function test_build_line_items_empty_items()
    {
        $this->assertEmpty(ckpg_build_line_items([], '5.4.12'));
    }

    public function test_build_line_items_description_fallback()
    {
        $items = [[
            'line_subtotal' => 100.00,
            'qty'           => 1,
            'product_id'    => 99,
            'name'          => 'No Desc',
            'variation_id'  => 0,
        ]];

        $line_items = ckpg_build_line_items($items, '5.4.12');

        // WC_Product stub returns '' for description → fallback 'no description'
        $this->assertEquals('no description', $line_items[0]['description']);
    }

    // -------------------------------------------------------
    // ckpg_get_request_data — edge cases
    // -------------------------------------------------------

    public function test_get_request_data_null_order_returns_false()
    {
        $this->assertFalse(ckpg_get_request_data(null));
    }

    public function test_get_request_data_basic_order()
    {
        $order = new WC_Order(100);

        $data = ckpg_get_request_data($order);

        $this->assertEquals(100, $data['order_id']);
        $this->assertEquals(10000.0, $data['amount']); // 100.00 * 100
        $this->assertEquals('MXN', $data['currency']);
        $this->assertEquals('John Doe', $data['customer_info']['name']);
        $this->assertEquals('john@example.com', $data['customer_info']['email']);
        $this->assertEquals('+5215555555555', $data['customer_info']['phone']);
    }

    public function test_get_request_data_has_shipping_lines()
    {
        $order = new WC_Order(101);
        $data = ckpg_get_request_data($order);

        // WC_Order stub returns 'flat_rate' as shipping method
        $this->assertNotEmpty($data['shipping_lines']);
        $this->assertEquals('flat_rate', $data['shipping_lines'][0]['carrier']);
    }

    public function test_get_request_data_has_shipping_contact()
    {
        $order = new WC_Order(102);
        $data = ckpg_get_request_data($order);

        // Stub has address_1 and postcode, so shipping_contact should be present
        $this->assertArrayHasKey('shipping_contact', $data);
        $this->assertEquals('John Doe', $data['shipping_contact']['receiver']);
        $this->assertEquals('CDMX', $data['shipping_contact']['address']['city']);
    }

    public function test_get_request_data_with_coupons()
    {
        $order = new WC_Order(103);
        $order->set_coupons([
            ['name' => 'TEST10', 'type' => 'percent', 'discount_amount' => 10.00],
        ]);

        $data = ckpg_get_request_data($order);

        $this->assertArrayHasKey('discount_lines', $data);
        $this->assertCount(1, $data['discount_lines']);
        $this->assertEquals('TEST10', $data['discount_lines'][0]['code']);
        $this->assertEquals(1000, $data['discount_lines'][0]['amount']);
    }

    public function test_get_request_data_without_coupons_no_discount_key()
    {
        $order = new WC_Order(104);

        $data = ckpg_get_request_data($order);

        $this->assertArrayNotHasKey('discount_lines', $data);
    }

    public function test_get_request_data_description_contains_email()
    {
        $order = new WC_Order(105);
        $data = ckpg_get_request_data($order);

        $this->assertStringContainsString('john@example.com', $data['description']);
    }

    // -------------------------------------------------------
    // ckpg_check_balance — additional edge cases
    // -------------------------------------------------------

    public function test_check_balance_exact_no_adjustment()
    {
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 1]],
            'shipping_lines' => [['amount' => 0]],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 1600, 'description' => 'IVA']],
        ];

        $result = ckpg_check_balance($order, 11600);

        $this->assertEquals(1600, $result['tax_lines'][0]['amount']);
    }

    public function test_check_balance_multiple_items()
    {
        $order = [
            'line_items'     => [
                ['unit_price' => 10000, 'quantity' => 2],
                ['unit_price' => 5000, 'quantity' => 1],
            ],
            'shipping_lines' => [['amount' => 3000]],
            'discount_lines' => [['amount' => 2000]],
            'tax_lines'      => [['amount' => 0, 'description' => 'Tax']],
        ];
        // 20000 + 5000 + 3000 - 2000 + 0 = 26000
        $result = ckpg_check_balance($order, 26000);

        $this->assertEquals(0, $result['tax_lines'][0]['amount']);
    }

    public function test_check_balance_adds_round_adjustment_description()
    {
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 1]],
            'shipping_lines' => [['amount' => 0]],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 0, 'description' => '']], // empty description
        ];

        // total=10001 but sum=10000 → adjustment=1, description should be set
        $result = ckpg_check_balance($order, 10001);

        $this->assertEquals(1, $result['tax_lines'][0]['amount']);
        $this->assertEquals('Round Adjustment', $result['tax_lines'][0]['description']);
    }

    public function test_check_balance_preserves_existing_description()
    {
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 1]],
            'shipping_lines' => [['amount' => 0]],
            'discount_lines' => [],
            'tax_lines'      => [['amount' => 1500, 'description' => 'IVA']],
        ];

        $result = ckpg_check_balance($order, 11600);

        // Adjusted by 100, but description 'IVA' should remain
        $this->assertEquals(1600, $result['tax_lines'][0]['amount']);
        $this->assertEquals('IVA', $result['tax_lines'][0]['description']);
    }

    public function test_check_balance_appends_when_tax_lines_empty()
    {
        // sum = 10000, total = 10001 → synthesize a tax_line for the 1-cent diff.
        $order = [
            'line_items'     => [['unit_price' => 10000, 'quantity' => 1]],
            'shipping_lines' => [],
            'discount_lines' => [],
            'tax_lines'      => [],
        ];

        $result = ckpg_check_balance($order, 10001);

        $this->assertCount(1, $result['tax_lines']);
        $this->assertEquals(1, $result['tax_lines'][0]['amount']);
        $this->assertEquals('Round Adjustment', $result['tax_lines'][0]['description']);
    }

    // -------------------------------------------------------
    // Critical #1: Double-counting test — full REST API discount pipeline
    // -------------------------------------------------------

    /**
     * A product on sale no longer produces a dynamic_pricing discount line:
     * the line item carries the effective price and discount_lines stays empty.
     */
    public function test_rest_api_pipeline_sale_produces_no_dynamic_pricing()
    {
        // Setup: product with regular_price=500, effective=400
        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 800.00, // 400 * 2
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Discounted Product',
            'variation_id'  => 0,
        ]];

        // No coupons, no fees.
        $data = ['discount_lines' => []];
        $fees = [];

        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $discounts_data);

        $price_level_discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $price_level_discount);
        ckpg_add_price_level_discount($discount_lines, $price_level_discount);

        // No dynamic_pricing is generated; the line item carries the effective price.
        $this->assertEquals(0, $price_level_discount);
        $dynamic_entries = array_filter($discount_lines, fn($d) => ($d['code'] ?? '') === 'dynamic_pricing');
        $this->assertCount(0, $dynamic_entries, 'No dynamic_pricing discount should be produced');
        $this->assertEmpty($discount_lines);
        $this->assertEquals(40000, $line_items[0]['unit_price']); // effective 400
    }

    /**
     * A negative fee (real cart-level discount) still becomes a discount_line.
     * Price-level markdowns no longer add a separate dynamic_pricing entry.
     */
    public function test_rest_api_pipeline_negative_fee_still_discounted()
    {
        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 800.00,
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Product',
            'variation_id'  => 0,
        ]];

        $data = ['discount_lines' => []];

        // Negative fee (e.g. a cart discount) — a real discount, kept.
        $fees = [
            new class {
                public function get_total() { return -50.00; }
                public function get_name() { return 'Cart Discount'; }
            },
        ];

        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $discounts_data);

        $price_level_discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $price_level_discount);
        ckpg_add_price_level_discount($discount_lines, $price_level_discount);

        // Only the fee discount appears — no dynamic_pricing.
        $this->assertCount(1, $discount_lines);
        $this->assertEquals('Cart Discount', $discount_lines[0]['code']);
        $this->assertEquals(5000, $discount_lines[0]['amount']);
        $this->assertEquals(0, $price_level_discount);
    }

    /**
     * Worst-case scenario: $data['discount_lines'] already contains a
     * 'dynamic_pricing' entry AND ckpg_build_line_items detects the same.
     * The guard in ckpg_add_price_level_discount() must prevent duplication.
     */
    public function test_rest_api_pipeline_guard_prevents_double_counting()
    {
        $this->registerProduct(10, 500.00);

        $items = [[
            'line_subtotal' => 800.00,
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Product',
            'variation_id'  => 0,
        ]];

        // $data already has dynamic_pricing (e.g. from another code path)
        $data = [
            'discount_lines' => [
                ['code' => 'dynamic_pricing', 'amount' => 20000, 'type' => 'campaign'],
            ],
        ];

        $fees = [];

        // === REST API pipeline (now using the guard) ===
        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $discounts_data);

        $price_level_discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $price_level_discount);
        ckpg_add_price_level_discount($discount_lines, $price_level_discount);

        // Guard must prevent the second entry
        $dynamic_entries = array_filter($discount_lines, fn($d) => $d['code'] === 'dynamic_pricing');
        $this->assertCount(1, $dynamic_entries, 'Guard should prevent duplicate dynamic_pricing');
        $this->assertEquals(20000, array_values($dynamic_entries)[0]['amount']);
    }

    // -------------------------------------------------------
    // wallets_enabled → allowed_payment_methods
    // -------------------------------------------------------

    /**
     * @return object stand-in for a WC_Payment_Gateway with custom settings
     */
    private function gatewayWithSettings(array $settings)
    {
        return new class($settings) {
            public $settings;
            public function __construct(array $settings) { $this->settings = $settings; }
        };
    }

    public function test_build_allowed_payment_methods_includes_wallets_when_enabled()
    {
        $gateway = $this->gatewayWithSettings(['wallets_enabled' => 'yes']);
        $methods = WC_Conekta_REST_API::build_allowed_payment_methods($gateway);
        $this->assertEquals(['card', 'apple', 'google'], $methods);
    }

    public function test_build_allowed_payment_methods_excludes_wallets_when_disabled()
    {
        $gateway = $this->gatewayWithSettings(['wallets_enabled' => 'no']);
        $methods = WC_Conekta_REST_API::build_allowed_payment_methods($gateway);
        $this->assertEquals(['card'], $methods);
    }

    public function test_build_allowed_payment_methods_defaults_to_enabled_for_legacy_settings()
    {
        // Merchants who upgrade without re-saving settings have no
        // wallets_enabled key — must keep wallets ON by default so existing
        // checkouts don't lose Apple/Google Pay silently.
        $gateway = $this->gatewayWithSettings([]);
        $methods = WC_Conekta_REST_API::build_allowed_payment_methods($gateway);
        $this->assertContains('apple', $methods);
        $this->assertContains('google', $methods);
        $this->assertContains('card', $methods);
    }

    public function test_build_allowed_payment_methods_uses_sdk_constant_for_card()
    {
        $gateway = $this->gatewayWithSettings(['wallets_enabled' => 'no']);
        $methods = WC_Conekta_REST_API::build_allowed_payment_methods($gateway);
        $this->assertEquals(\Conekta\Model\OrderCheckoutRequest::ALLOWED_PAYMENT_METHODS_CARD, $methods[0]);
    }

    // -------------------------------------------------------
    // resolve_address_source — block-level shipping/billing choice
    // for the Conekta shipping_contact. Shipping wins only when the
    // customer actually filled it (keyed on shipping_address_1).
    // -------------------------------------------------------

    /**
     * Build a customer-like stub exposing get_{shipping,billing}_* getters.
     */
    private function makeAddressCustomer(array $shipping, array $billing)
    {
        // Real getter methods (not __call): resolve_address_source guards with
        // method_exists(), which does NOT see __call-handled methods — and the
        // real WC_Customer exposes these as concrete methods anyway.
        return new class($shipping, $billing) {
            private $shipping;
            private $billing;
            public function __construct($shipping, $billing) {
                $this->shipping = $shipping;
                $this->billing  = $billing;
            }
            private function s($k) { return $this->shipping[$k] ?? ''; }
            private function b($k) { return $this->billing[$k] ?? ''; }
            public function get_shipping_first_name() { return $this->s('first_name'); }
            public function get_shipping_last_name()  { return $this->s('last_name'); }
            public function get_shipping_address_1()  { return $this->s('address_1'); }
            public function get_shipping_city()       { return $this->s('city'); }
            public function get_shipping_state()      { return $this->s('state'); }
            public function get_shipping_country()    { return $this->s('country'); }
            public function get_shipping_postcode()   { return $this->s('postcode'); }
            public function get_shipping_phone()      { return $this->s('phone'); }
            public function get_billing_first_name()  { return $this->b('first_name'); }
            public function get_billing_last_name()   { return $this->b('last_name'); }
            public function get_billing_address_1()   { return $this->b('address_1'); }
            public function get_billing_city()        { return $this->b('city'); }
            public function get_billing_state()       { return $this->b('state'); }
            public function get_billing_country()     { return $this->b('country'); }
            public function get_billing_postcode()    { return $this->b('postcode'); }
            public function get_billing_phone()       { return $this->b('phone'); }
        };
    }

    /**
     * The reported bug: address typed in billing, shipping carries only the
     * theme-prefilled state/country. Must use the billing block as a whole,
     * NOT mix the billing street with the shipping state.
     */
    public function test_resolve_address_source_uses_billing_when_shipping_empty()
    {
        $customer = $this->makeAddressCustomer(
            // shipping: only state/country pre-filled, no street, no phone
            ['state' => 'DF', 'country' => 'MX'],
            [
                'first_name' => 'fran', 'last_name' => 'carero',
                'address_1' => 'av siempre viva', 'city' => 'cdmx',
                'state' => 'DF', 'country' => 'MX', 'postcode' => '11011',
                'phone' => '3143159054',
            ]
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);

        $this->assertEquals('av siempre viva', $addr['address_1']);
        $this->assertEquals('cdmx', $addr['city']);
        $this->assertEquals('11011', $addr['postcode']);
        $this->assertEquals('fran', $addr['first_name']);
        $this->assertEquals('carero', $addr['last_name']);
        // phone follows the billing block (the one with data)
        $this->assertEquals('3143159054', $addr['phone']);
    }

    /**
     * Regression for the "customer object shows Cliente / 0000000000" bug:
     * the shopper filled ONLY the shipping block (billing empty) — the common
     * WC Blocks case. resolve_address_source feeds BOTH customer_info and
     * shipping_contact, so it must return the real shipping name + phone here;
     * otherwise customer_info falls back to the 'Cliente' / 0000000000 defaults.
     */
    public function test_resolve_address_source_customer_name_from_shipping_when_billing_empty()
    {
        $customer = $this->makeAddressCustomer(
            [
                'first_name' => 'blocks', 'last_name' => 'User',
                'address_1' => 'Calle Test lisa', 'city' => 'CDMX',
                'state' => 'DF', 'country' => 'MX', 'postcode' => '11010',
                'phone' => '3143159054',
            ],
            [] // billing completely empty — the exact bug scenario
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);
        $name = trim($addr['first_name'] . ' ' . $addr['last_name']);

        // These are exactly what build_snapshot puts into customer_info.name /
        // customer_info.phone — non-empty, so it won't fall back to defaults.
        $this->assertEquals('blocks User', $name, 'customer name must come from shipping, not default to Cliente');
        $this->assertEquals('3143159054', $addr['phone'], 'customer phone must come from shipping, not default to 0000000000');
        $this->assertNotSame('', $name);
        $this->assertNotSame('', $addr['phone']);
    }

    /**
     * When shipping is actually filled, use the shipping block as a whole.
     */
    public function test_resolve_address_source_uses_shipping_when_present()
    {
        $customer = $this->makeAddressCustomer(
            [
                'first_name' => 'envio', 'last_name' => 'destino',
                'address_1' => 'calle envio 99', 'city' => 'Monterrey',
                'state' => 'NL', 'country' => 'MX', 'postcode' => '64000',
                'phone' => '8111111111',
            ],
            [
                'first_name' => 'fact', 'last_name' => 'uracion',
                'address_1' => 'calle billing 1', 'city' => 'CDMX',
                'state' => 'DF', 'country' => 'MX', 'postcode' => '11011',
                'phone' => '5522222222',
            ]
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);

        $this->assertEquals('calle envio 99', $addr['address_1']);
        $this->assertEquals('Monterrey', $addr['city']);
        $this->assertEquals('NL', $addr['state']);
        $this->assertEquals('64000', $addr['postcode']);
        $this->assertEquals('envio', $addr['first_name']);
        // phone follows the shipping block (the one in use)
        $this->assertEquals('8111111111', $addr['phone']);
    }

    /**
     * Shipping address present but its name empty: address comes from shipping,
     * receiver name falls back to billing so it is never blank.
     */
    public function test_resolve_address_source_name_falls_back_to_billing()
    {
        $customer = $this->makeAddressCustomer(
            [
                'address_1' => 'calle envio 99', 'city' => 'Monterrey',
                'state' => 'NL', 'country' => 'MX', 'postcode' => '64000',
            ],
            ['first_name' => 'fran', 'last_name' => 'carero']
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);

        $this->assertEquals('calle envio 99', $addr['address_1']);
        $this->assertEquals('fran', $addr['first_name']);
        $this->assertEquals('carero', $addr['last_name']);
    }

    /**
     * Whitespace-only shipping street counts as empty -> falls back to billing.
     */
    public function test_resolve_address_source_treats_whitespace_shipping_as_empty()
    {
        $customer = $this->makeAddressCustomer(
            ['address_1' => '   ', 'state' => 'DF', 'country' => 'MX'],
            [
                'first_name' => 'fran', 'address_1' => 'av billing 5',
                'city' => 'cdmx', 'state' => 'DF', 'country' => 'MX',
                'postcode' => '11011',
            ]
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);

        $this->assertEquals('av billing 5', $addr['address_1']);
        $this->assertEquals('11011', $addr['postcode']);
    }

    /**
     * Shipping block is in use but has no phone: the contact phone falls back
     * to the billing phone so the shipping_contact phone is never empty.
     */
    public function test_resolve_address_source_phone_falls_back_to_other_block()
    {
        $customer = $this->makeAddressCustomer(
            [
                'first_name' => 'envio', 'address_1' => 'calle envio 99',
                'city' => 'Monterrey', 'state' => 'NL', 'country' => 'MX',
                'postcode' => '64000',
                // no shipping phone
            ],
            ['phone' => '5522222222']
        );

        $addr = WC_Conekta_REST_API::resolve_address_source($customer);

        $this->assertEquals('calle envio 99', $addr['address_1']);
        $this->assertEquals('5522222222', $addr['phone']);
    }

    // -------------------------------------------------------
    // shipping_contact_hash — detects address changes across
    // checkout-request POSTs so the placeholder "Pendiente" gets
    // replaced once the customer types the real address.
    // -------------------------------------------------------

    public function test_shipping_contact_hash_empty_returns_empty_string()
    {
        // First POST before the customer types the address: the snapshot
        // returns shipping_contact=[] and the stored hash must be the empty
        // string so a later real address compares as "changed".
        $this->assertSame('', WC_Conekta_REST_API::shipping_contact_hash([]));
    }

    public function test_shipping_contact_hash_is_stable_for_same_input()
    {
        $contact = [
            'phone'    => '5555555555',
            'receiver' => 'Test User',
            'address'  => [
                'street1'     => 'Av Test 123',
                'city'        => 'CDMX',
                'state'       => 'DF',
                'country'     => 'MX',
                'postal_code' => '11010',
            ],
        ];

        $this->assertSame(
            WC_Conekta_REST_API::shipping_contact_hash($contact),
            WC_Conekta_REST_API::shipping_contact_hash($contact)
        );
    }

    public function test_shipping_contact_hash_changes_when_address_changes()
    {
        $a = [
            'phone'    => '5555555555',
            'receiver' => 'Test User',
            'address'  => ['street1' => 'Av Test 123', 'postal_code' => '11010', 'country' => 'MX'],
        ];
        $b = $a;
        $b['address']['street1'] = 'Calle Otra 456';

        $this->assertNotSame(
            WC_Conekta_REST_API::shipping_contact_hash($a),
            WC_Conekta_REST_API::shipping_contact_hash($b)
        );
    }

    public function test_shipping_contact_hash_placeholder_differs_from_real_address()
    {
        // The 'Pendiente' placeholder is the seeded value the create path
        // injects when the snapshot is still empty. Once the customer types
        // a real address, the hash MUST differ so the unchanged short-circuit
        // does not skip the update that would overwrite the placeholder.
        $placeholder = [
            'phone'    => '0000000000',
            'receiver' => 'Cliente',
            'address'  => [
                'street1'     => 'Pendiente',
                'postal_code' => '00000',
                'city'        => 'Pendiente',
                'state'       => 'Pendiente',
                'country'     => 'MX',
            ],
        ];
        $real = [
            'phone'    => '5555555555',
            'receiver' => 'Test User',
            'address'  => [
                'street1'     => 'Av Test 123',
                'postal_code' => '11010',
                'city'        => 'CDMX',
                'state'       => 'DF',
                'country'     => 'MX',
            ],
        ];

        $this->assertNotSame(
            WC_Conekta_REST_API::shipping_contact_hash($placeholder),
            WC_Conekta_REST_API::shipping_contact_hash($real)
        );
    }

    public function test_shipping_contact_hash_is_sensitive_to_key_order_in_address()
    {
        // md5(json_encode(...)) hashes the serialized form, which preserves
        // PHP array order. This is acceptable because build_snapshot always
        // emits the same key order — the test pins that contract so a future
        // refactor that reorders keys doesn't silently break the cache hit.
        $a = ['address' => ['street1' => 'Av 1', 'postal_code' => '11010']];
        $b = ['address' => ['postal_code' => '11010', 'street1' => 'Av 1']];

        $this->assertNotSame(
            WC_Conekta_REST_API::shipping_contact_hash($a),
            WC_Conekta_REST_API::shipping_contact_hash($b)
        );
    }

    // -------------------------------------------------------
    // clear_session
    // -------------------------------------------------------

    public function test_clear_session_removes_all_four_session_keys()
    {
        WC()->session->set(WC_Conekta_REST_API::SESSION_ORDER_ID, 'ord_123');
        WC()->session->set(WC_Conekta_REST_API::SESSION_CHECKOUT_REQUEST_ID, 'cr_123');
        WC()->session->set(WC_Conekta_REST_API::SESSION_LAST_AMOUNT, 12345);
        WC()->session->set(WC_Conekta_REST_API::SESSION_LAST_SHIPPING_HASH, 'abc123');

        WC_Conekta_REST_API::clear_session();

        $this->assertNull(WC()->session->get(WC_Conekta_REST_API::SESSION_ORDER_ID));
        $this->assertNull(WC()->session->get(WC_Conekta_REST_API::SESSION_CHECKOUT_REQUEST_ID));
        $this->assertNull(WC()->session->get(WC_Conekta_REST_API::SESSION_LAST_AMOUNT));
        $this->assertNull(WC()->session->get(WC_Conekta_REST_API::SESSION_LAST_SHIPPING_HASH));
    }

    public function test_session_last_shipping_hash_constant_exists()
    {
        // Regression: the unchanged short-circuit in handle_checkout_request
        // reads this constant. Renaming it without also updating the read
        // sites would silently downgrade the cache to amount-only and let
        // the 'Pendiente' placeholder survive.
        $this->assertSame(
            'conekta_checkout_last_shipping_hash',
            WC_Conekta_REST_API::SESSION_LAST_SHIPPING_HASH
        );
    }

    // -------------------------------------------------------
    // OrderUpdate customer_info regression — pin the SDK
    // contract that lets the update path push a fresh
    // customer_info.phone to Conekta. Without this support
    // a stale phone left over from the create call would
    // never be replaced and the merchant dashboard / Conekta
    // antifraud would see the wrong number.
    // -------------------------------------------------------

    public function test_order_update_accepts_customer_info_via_sdk()
    {
        // Locks the conekta-php >= 7.1.0 contract: OrderUpdate must accept
        // customer_info with phone. If the SDK is rolled back to a version
        // that doesn't expose this setter (early 7.0.x lacked it on the
        // PUT model) the test fails BEFORE the silent regression — phone
        // stuck at the create-time value — ships to production.
        $update = new \Conekta\Model\OrderUpdate();
        $update->setCustomerInfo(new \Conekta\Model\OrderUpdateCustomerInfo([
            'name'  => 'Test User',
            'phone' => '3143159054',
        ]));
        $info = $update->getCustomerInfo();
        $this->assertNotNull($info, 'OrderUpdate must hold the customer_info we set');
        $this->assertSame('3143159054', $info->getPhone());
        $this->assertSame('Test User',  $info->getName());
    }

    public function test_order_update_accepts_shipping_contact_via_sdk()
    {
        // Same contract pin for the shipping_contact path — without it the
        // 'Pendiente' placeholder never gets replaced on PUT.
        $update = new \Conekta\Model\OrderUpdate();
        $update->setShippingContact(new \Conekta\Model\CustomerShippingContactsRequest([
            'phone'    => '3143159054',
            'receiver' => 'Test User',
            'address'  => [
                'street1'     => 'Calle Test 123',
                'postal_code' => '11010',
                'country'     => 'MX',
            ],
        ]));
        $contact = $update->getShippingContact();
        $this->assertNotNull($contact);
        $this->assertSame('3143159054', $contact->getPhone());
    }

    // -------------------------------------------------------
    // customer_became_real — gates the placeholder->real recreate
    // of the Conekta order (created early with 'Cliente').
    // -------------------------------------------------------

    public function test_customer_became_real_from_empty_to_real()
    {
        // Order created before the name was typed (empty) -> now real: recreate.
        $this->assertTrue(WC_Conekta_REST_API::customer_became_real('', 'Carolina Rivera'));
    }

    public function test_customer_became_real_from_placeholder_to_real()
    {
        // Created with the 'Cliente' placeholder -> real name: recreate.
        $this->assertTrue(WC_Conekta_REST_API::customer_became_real('Cliente', 'Carolina Rivera'));
    }

    public function test_customer_became_real_false_when_already_real()
    {
        // Already had a real name -> don't recreate (avoids churn / extra orders).
        $this->assertFalse(WC_Conekta_REST_API::customer_became_real('Carolina Rivera', 'Carolina Rivera'));
    }

    public function test_customer_became_real_false_when_still_placeholder()
    {
        $this->assertFalse(WC_Conekta_REST_API::customer_became_real('', ''));
        $this->assertFalse(WC_Conekta_REST_API::customer_became_real('Cliente', 'Cliente'));
        $this->assertFalse(WC_Conekta_REST_API::customer_became_real('Cliente', ''));
    }

    public function test_customer_became_real_uses_the_default_name_constant()
    {
        // The placeholder is the centralized DEFAULT_CUSTOMER_NAME, not a literal.
        $this->assertFalse(WC_Conekta_REST_API::customer_became_real(
            WC_Conekta_REST_API::DEFAULT_CUSTOMER_NAME,
            WC_Conekta_REST_API::DEFAULT_CUSTOMER_NAME
        ));
        $this->assertTrue(WC_Conekta_REST_API::customer_became_real(
            WC_Conekta_REST_API::DEFAULT_CUSTOMER_NAME,
            'Diego Flores'
        ));
    }

    // -------------------------------------------------------
    // apply_address_from_body — closes the race where WC Blocks
    // debounces its own `update-customer` REST call AFTER our
    // /checkout-request POST has already hit the server. Without
    // this helper, build_snapshot would read a stale
    // WC()->customer and the cache-key would match the previous
    // hash, returning mode=unchanged and leaving the Conekta
    // order with the old shipping address.
    // -------------------------------------------------------

    private function freshCustomer()
    {
        // Lightweight stand-in. Setters are declared explicitly because
        // apply_address_from_body() uses method_exists() to gate writes,
        // and method_exists() ignores PHP's __call magic.
        return new class {
            public string $billing_first_name = '';
            public string $billing_last_name = '';
            public string $billing_address_1 = '';
            public string $billing_city = '';
            public string $billing_state = '';
            public string $billing_postcode = '';
            public string $billing_country = '';
            public string $billing_phone = '';
            public string $shipping_first_name = '';
            public string $shipping_last_name = '';
            public string $shipping_address_1 = '';
            public string $shipping_city = '';
            public string $shipping_state = '';
            public string $shipping_postcode = '';
            public string $shipping_country = '';
            public string $shipping_phone = '';
            public function set_billing_first_name($v)  { $this->billing_first_name  = $v; }
            public function set_billing_last_name($v)   { $this->billing_last_name   = $v; }
            public function set_billing_address_1($v)   { $this->billing_address_1   = $v; }
            public function set_billing_city($v)        { $this->billing_city        = $v; }
            public function set_billing_state($v)       { $this->billing_state       = $v; }
            public function set_billing_postcode($v)    { $this->billing_postcode    = $v; }
            public function set_billing_country($v)     { $this->billing_country     = $v; }
            public function set_billing_phone($v)       { $this->billing_phone       = $v; }
            public function set_shipping_first_name($v) { $this->shipping_first_name = $v; }
            public function set_shipping_last_name($v)  { $this->shipping_last_name  = $v; }
            public function set_shipping_address_1($v)  { $this->shipping_address_1  = $v; }
            public function set_shipping_city($v)       { $this->shipping_city       = $v; }
            public function set_shipping_state($v)      { $this->shipping_state      = $v; }
            public function set_shipping_postcode($v)   { $this->shipping_postcode   = $v; }
            public function set_shipping_country($v)    { $this->shipping_country    = $v; }
            public function set_shipping_phone($v)      { $this->shipping_phone      = $v; }
        };
    }

    public function test_apply_address_from_body_writes_only_non_empty_fields()
    {
        $customer = $this->freshCustomer();
        $written = WC_Conekta_REST_API::apply_address_from_body($customer, 'shipping', [
            'first_name' => 'Test',
            'address_1'  => 'Calle Test chavito',
            'city'       => '',   // empty — should be skipped
            'phone'      => '3143159054',
        ]);

        $this->assertSame(['first_name', 'address_1', 'phone'], $written);
        $this->assertSame('Test',                $customer->shipping_first_name);
        $this->assertSame('Calle Test chavito',  $customer->shipping_address_1);
        $this->assertSame('3143159054',          $customer->shipping_phone);
    }

    public function test_apply_address_from_body_overrides_stale_value_in_customer()
    {
        // Exact scenario from the merchant: WC()->customer had the old
        // address "lisa" because Blocks hadn't synced yet, the user typed
        // "chavito", and our POST landed first. The body override must win.
        $customer = $this->freshCustomer();
        $customer->shipping_address_1 = 'Calle Test lisa'; // stale
        WC_Conekta_REST_API::apply_address_from_body($customer, 'shipping', [
            'address_1' => 'Calle Test chavito',
        ]);
        $this->assertSame('Calle Test chavito', $customer->shipping_address_1);
    }

    public function test_apply_address_from_body_writes_separate_billing_and_shipping_setters()
    {
        // The helper must use set_billing_<field> vs set_shipping_<field>
        // — sending billing values into shipping slots would silently
        // duplicate the address and break checkouts where the user has
        // distinct billing and shipping.
        $customer = $this->freshCustomer();
        WC_Conekta_REST_API::apply_address_from_body($customer, 'billing',  ['address_1' => 'Calle Bill 1']);
        WC_Conekta_REST_API::apply_address_from_body($customer, 'shipping', ['address_1' => 'Calle Ship 1']);
        $this->assertSame('Calle Bill 1', $customer->billing_address_1);
        $this->assertSame('Calle Ship 1', $customer->shipping_address_1);
    }

    public function test_apply_address_from_body_no_op_for_empty_or_invalid_input()
    {
        $customer = $this->freshCustomer();
        $customer->shipping_address_1 = 'Calle Test lisa'; // existing value must survive

        $this->assertSame([], WC_Conekta_REST_API::apply_address_from_body($customer, 'shipping', []));
        $this->assertSame([], WC_Conekta_REST_API::apply_address_from_body($customer, 'shipping', null));
        $this->assertSame([], WC_Conekta_REST_API::apply_address_from_body($customer, 'invalid_type', ['address_1' => 'X']));
        $this->assertSame([], WC_Conekta_REST_API::apply_address_from_body(null,      'shipping', ['address_1' => 'X']));

        $this->assertSame('Calle Test lisa', $customer->shipping_address_1);
    }

    public function test_apply_address_from_body_ignores_fields_outside_allowlist()
    {
        // Defense-in-depth: a malicious client can't write arbitrary
        // setters via this endpoint (e.g. set_billing_email). Only the
        // known address fields go through — the returned list reflects
        // exactly what was applied, so non-allowlisted keys are absent.
        $customer = $this->freshCustomer();
        $written = WC_Conekta_REST_API::apply_address_from_body($customer, 'billing', [
            'first_name' => 'A',
            'email'      => 'evil@example.com',
            'admin'      => true,
            'role'       => 'administrator',
        ]);
        $this->assertSame(['first_name'], $written);
        $this->assertSame('A', $customer->billing_first_name);
    }

    // -------------------------------------------------------
    // tag_card_charges_with_wc_order (reverse trace via updateCharge)
    // No Mockoon: the ChargesApi is injected as a mock.
    // -------------------------------------------------------

    /**
     * Build a fake OrderResponse-like object exposing getCharges()->getData(),
     * where each charge has getId() and getPaymentMethod()->getObject().
     *
     * @param array<array{id:string,object:string}> $charges
     */
    private function fakeConektaOrderWithCharges(array $charges)
    {
        $charge_objects = array_map(function (array $c) {
            return new class($c['id'], $c['object']) {
                private $id;
                private $object;
                public function __construct($id, $object) { $this->id = $id; $this->object = $object; }
                public function getId() { return $this->id; }
                public function getPaymentMethod() {
                    return new class($this->object) {
                        private $object;
                        public function __construct($object) { $this->object = $object; }
                        public function getObject() { return $this->object; }
                    };
                }
            };
        }, $charges);

        return new class($charge_objects) {
            private $charges;
            public function __construct($charges) { $this->charges = $charges; }
            public function getCharges() {
                return new class($this->charges) {
                    private $data;
                    public function __construct($data) { $this->data = $data; }
                    public function getData() { return $this->data; }
                };
            }
        };
    }

    /**
     * Build a taggable gateway whose get_charges_api_instance() returns the
     * given ChargesApi mock, with settings/version populated.
     */
    private function createTaggableGateway($chargesApiMock): WC_Conekta_Gateway
    {
        TaggableConektaGateway::$stubChargesApi = $chargesApiMock;
        $gateway = $this->createPartialMock(TaggableConektaGateway::class, []);

        $ref  = new ReflectionClass($gateway);
        $prop = $ref->getProperty('settings');
        $prop->setAccessible(true);
        $prop->setValue($gateway, ['cards_api_key' => 'key_test_123']);

        return $gateway;
    }

    public function test_tag_card_charges_stamps_wc_order_id_on_card_payment_charge()
    {
        $captured = null;
        $api = $this->createMock(\Conekta\Api\ChargesApi::class);
        $api->expects($this->once())
            ->method('updateCharge')
            ->with(
                $this->equalTo('charge_card_1'),
                $this->callback(function ($req) use (&$captured) {
                    $captured = $req;
                    return $req instanceof \Conekta\Model\ChargeUpdateRequest;
                })
            );

        $gateway = $this->createTaggableGateway($api);
        $order   = new WC_Order(1309);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => 'charge_card_1', 'object' => 'card_payment'],
        ]);

        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);

        $this->assertSame('1309', $captured->getReferenceId());
    }

    public function test_tag_card_charges_skips_non_card_payment_charges()
    {
        $api = $this->createMock(\Conekta\Api\ChargesApi::class);
        // Only the card_payment charge is tagged; cash/oxxo charges are skipped.
        $api->expects($this->once())
            ->method('updateCharge')
            ->with($this->equalTo('charge_card_1'), $this->anything());

        $gateway = $this->createTaggableGateway($api);
        $order   = new WC_Order(1310);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => 'charge_cash_1', 'object' => 'cash_payment'],
            ['id' => 'charge_card_1', 'object' => 'card_payment'],
        ]);

        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
    }

    public function test_tag_card_charges_tags_every_card_payment_charge()
    {
        $api = $this->createMock(\Conekta\Api\ChargesApi::class);
        $api->expects($this->exactly(2))->method('updateCharge');

        $gateway = $this->createTaggableGateway($api);
        $order   = new WC_Order(1311);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => 'charge_card_1', 'object' => 'card_payment'],
            ['id' => 'charge_card_2', 'object' => 'card_payment'],
        ]);

        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
    }

    public function test_tag_card_charges_swallows_updatecharge_exception()
    {
        $api = $this->createMock(\Conekta\Api\ChargesApi::class);
        $api->method('updateCharge')->willThrowException(new \Exception('boom'));

        $gateway = $this->createTaggableGateway($api);
        $order   = new WC_Order(1312);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => 'charge_card_1', 'object' => 'card_payment'],
        ]);

        // Best-effort: a failing updateCharge must NOT propagate.
        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
        $this->assertTrue(true);
    }

    public function test_tag_card_charges_noop_when_no_charges()
    {
        $api = $this->createMock(\Conekta\Api\ChargesApi::class);
        $api->expects($this->never())->method('updateCharge');

        $gateway = $this->createTaggableGateway($api);
        $order   = new WC_Order(1313);
        $conekta_order = $this->fakeConektaOrderWithCharges([]);

        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
    }

    /**
     * Integration: drive the method against the REAL ChargesApi pointed at the
     * Conekta mock server (no injected mock). Proves the full wiring end-to-end:
     * get_charges_api_instance builds a usable client, the ChargeUpdateRequest
     * serializes, the PUT /charges/{id} is sent and the 200 response is parsed
     * without error. Charge id 6524722f28c7ba0016a5b17d is the one the official
     * mock answers 200 for.
     *
     * @group mockoon
     * @doesNotPerformAssertions
     */
    public function test_tag_card_charges_tags_via_mock_server()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();
        $order   = new WC_Order(1314);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => '6524722f28c7ba0016a5b17d', 'object' => 'card_payment'],
        ]);

        // Must complete without throwing against the real mock 200 response.
        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
    }

    /**
     * Integration: a charge id the mock answers 500 for must be swallowed —
     * a charge-tagging failure never breaks the completion flow.
     *
     * @group mockoon
     * @doesNotPerformAssertions
     */
    public function test_tag_card_charges_swallows_real_api_error_against_mock_server()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();
        $order   = new WC_Order(1315);
        $conekta_order = $this->fakeConektaOrderWithCharges([
            ['id' => '6a3027a19ef944001b17a789', 'object' => 'card_payment'],
        ]);

        // Mock returns 500 for this charge id; method must swallow it, not throw.
        $this->invokeMethod($gateway, 'tag_card_charges_with_wc_order', [$order, $conekta_order]);
    }

    // -------------------------------------------------------
    // Helpers
    // -------------------------------------------------------

    private function invokeMethod($object, string $method, array $args = [])
    {
        $ref = new ReflectionMethod($object, $method);
        $ref->setAccessible(true);
        return $ref->invokeArgs($object, $args);
    }
}

/**
 * Test seam: overrides get_charges_api_instance() so tag_card_charges_with_wc_order
 * uses an injected ChargesApi mock instead of building a real Guzzle-backed client.
 */
class TaggableConektaGateway extends WC_Conekta_Gateway
{
    public static $stubChargesApi;

    public static function get_charges_api_instance(string $api_key, string $version): \Conekta\Api\ChargesApi
    {
        return self::$stubChargesApi;
    }
}
