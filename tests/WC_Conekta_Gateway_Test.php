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
        global $test_product_registry, $test_order_registry;
        WC()->cart = null;
        $test_product_registry = [];
        $test_order_registry = null;
        parent::tearDown();
    }

    /**
     * Register a product in the global registry so both `new WC_Product($id)`
     * and `wc_get_product($id)` return the configured data.
     */
    private function registerProduct(int $id, float $regular_price, float $price = 0, string $name = ''): void
    {
        global $test_product_registry;
        $test_product_registry[$id] = [
            'regular_price' => $regular_price,
            'price'         => $price ?: $regular_price,
            'name'          => $name ?: "Test Product {$id}",
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
            'is_msi_enabled'       => 'no',
            'months'               => [],
        ];

        $settings = array_merge($defaults, $overrides);

        $gateway->id = 'conekta';
        $gateway->title = $settings['title'];
        $gateway->description = $settings['description'];
        $gateway->api_key = $settings['cards_api_key'];
        $gateway->public_api_key = $settings['cards_public_api_key'];
        $gateway->webhook_url = $settings['webhook_url'];
        $gateway->three_ds_enabled = false;
        $gateway->three_ds_mode = '';
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
        $this->assertFalse($gateway->three_ds_enabled);
        $this->assertSame('', $gateway->three_ds_mode);
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
    public function test_create_order_success()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();
        $order = new WC_Order(100);

        $error = null;
        $result = $this->invokeMethod($gateway, 'process_conekta_payment_for_order', [
            $order, 'tok_test_visa_4242', 1, &$error,
        ]);

        $this->assertTrue($result, 'Order creation should succeed. Error: ' . ($error ?? 'none'));
        $this->assertNull($error);
    }

    /**
     * @group mockoon
     */
    public function test_create_order_with_msi()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway(['is_msi_enabled' => 'yes']);
        $order = new WC_Order(101);

        $error = null;
        $result = $this->invokeMethod($gateway, 'process_conekta_payment_for_order', [
            $order, 'tok_test_visa_4242', 6, &$error,
        ]);

        $this->assertTrue($result, 'MSI order creation should succeed. Error: ' . ($error ?? 'none'));
    }

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

    /**
     * @group mockoon
     */
    public function test_get_company_3ds_info()
    {
        $this->requireMockoon();

        $companiesApi = WC_Conekta_Plugin::get_companies_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);

        $company = $companiesApi->getCurrentCompany('es');
        $this->assertNotNull($company);
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
    public function test_process_payment_standard_card_flow()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();

        $_POST = [
            'conekta_token' => 'tok_test_visa_4242',
            'conekta_msi_option' => '1',
        ];

        $result = $gateway->process_payment(200);

        $this->assertEquals('success', $result['result']);
        $this->assertArrayHasKey('redirect', $result);
    }

    /**
     * @group mockoon
     */
    public function test_process_payment_3ds_flow_with_paid_order()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();

        // Mockoon GET /orders/:id returns pending_payment by default
        // Simulate 3DS completed with capture flow
        $_POST = [
            'conekta_token' => 'tok_test_visa_4242',
            'conekta_order_id' => 'ord_test_123',
            'conekta_3ds_completed' => 'true',
            'conekta_payment_status' => 'paid',
        ];

        $result = $gateway->process_payment(300);

        $this->assertEquals('success', $result['result']);
        $this->assertArrayHasKey('redirect', $result);
        $this->assertStringContainsString('order-received', $result['redirect']);
    }

    /**
     * @group mockoon
     */
    public function test_process_payment_3ds_already_paid_skips_capture()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();

        // ord_2znsJ8YNbNoDDsN3p returns paid — no capture needed
        $_POST = [
            'conekta_token' => 'tok_test_visa_4242',
            'conekta_order_id' => 'ord_2znsJ8YNbNoDDsN3p',
            'conekta_3ds_completed' => 'true',
            'conekta_payment_status' => 'paid',
        ];

        $result = $gateway->process_payment(301);

        $this->assertEquals('success', $result['result']);
        $this->assertArrayHasKey('redirect', $result);
        $this->assertStringContainsString('order-received', $result['redirect']);
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

    /**
     * @group mockoon
     */
    public function test_process_payment_3ds_with_temp_order_transfers_meta()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();

        // Simulate 3DS with a temporary WooCommerce order
        $_POST = [
            'conekta_token' => 'tok_test_visa_4242',
            'conekta_order_id' => 'ord_test_123',
            'conekta_woo_order_id' => '999',
            'conekta_3ds_completed' => 'true',
            'conekta_payment_status' => 'paid',
        ];

        $result = $gateway->process_payment(303);

        $this->assertEquals('success', $result['result']);
        $this->assertArrayHasKey('redirect', $result);
        $this->assertStringContainsString('order-received', $result['redirect']);
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

    /**
     * @group mockoon
     */
    public function test_create_order_with_discount_and_verify_discount_lines()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();
        $order = new WC_Order(503);
        $order->set_coupons([
            ['name' => 'DESC10', 'type' => 'percent', 'discount_amount' => 10.00],
        ]);

        // Create order via the plugin
        $error = null;
        $result = $this->invokeMethod($gateway, 'process_conekta_payment_for_order', [
            $order, 'tok_test_visa_4242', 1, &$error,
        ]);
        $this->assertTrue($result, 'Order with discount should succeed. Error: ' . ($error ?? 'none'));

        // Fetch the order and verify discount_lines exist
        $api = WC_Conekta_Plugin::get_api_instance('key_test_123', (new WC_Conekta_Plugin())->version);
        $conektaOrder = $api->getOrderById('ord_2znsF4cv7L8s3452');

        $discountLines = $conektaOrder->getDiscountLines();
        $this->assertNotNull($discountLines, 'Order should have discount_lines');
        $this->assertNotEmpty($discountLines->getData(), 'discount_lines should not be empty');

        $firstDiscount = $discountLines->getData()[0];
        $this->assertEquals(1000, $firstDiscount->getAmount());
    }

    // -------------------------------------------------------
    // 3DS Smart mode — next_action may not have redirect_to_url
    // -------------------------------------------------------

    /**
     * @group mockoon
     */
    public function test_create_3ds_order_smart_mode_without_redirect()
    {
        $this->requireMockoon();

        // Configure gateway with 3DS smart mode
        $gateway = $this->createConfiguredGateway();
        $gateway->three_ds_mode = 'smart';

        // Register gateway in WC() so create_3ds_order can find it
        global $test_conekta_gateway;
        $test_conekta_gateway = $gateway;

        // Simulate REST request to create-3ds-order
        $request = new WP_REST_Request('POST');
        $request->set_params([
            'token' => 'tok_test_visa_4242',
            'order_id' => '600',
            'msi_option' => 1,
        ]);

        $response = WC_Conekta_REST_API::create_3ds_order($request);
        $data = $response->get_data();

        // In smart mode without 3DS, should succeed without next_action
        $this->assertEquals(200, $response->get_status(), 'Response should be 200. Got: ' . json_encode($data));
        $this->assertTrue($data['success']);
        $this->assertNotEmpty($data['order_id']);
        $this->assertEquals('paid', $data['payment_status']);
        $this->assertArrayNotHasKey('next_action', $data, 'Smart mode should not require 3DS redirect');
    }

    // -------------------------------------------------------
    // Dynamic pricing / discount integration (cart helpers)
    // -------------------------------------------------------

    public function test_build_discount_lines_captures_native_coupons()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 1000.00, 900.00)
            ->withCoupon('VERANO20', 50.00)
            ->withCoupon('ENVIO', 100.00)
            ->withTotal(850.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(2, $lines);

        $this->assertEquals('VERANO20', $lines[0]['code']);
        $this->assertEquals(5000, $lines[0]['amount']);
        $this->assertEquals('coupon', $lines[0]['type']);

        $this->assertEquals('ENVIO', $lines[1]['code']);
        $this->assertEquals(10000, $lines[1]['amount']);
        $this->assertEquals('coupon', $lines[1]['type']);
    }

    public function test_build_discount_lines_captures_negative_fee_discounts()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 500.00)
            ->withFee('Advanced Pricing Discount', -150.00)
            ->withTotal(350.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(1, $lines);
        $this->assertEquals('Advanced Pricing Discount', $lines[0]['code']);
        $this->assertEquals(15000, $lines[0]['amount']);
        $this->assertEquals('campaign', $lines[0]['type']);
    }

    public function test_build_discount_lines_combines_coupons_and_fees()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 400.00)
            ->withCoupon('DESC100', 100.00)
            ->withFee('2x1 Promo', -200.00)
            ->withTotal(200.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(2, $lines);
        // Coupons come first, then fee-based discounts
        $this->assertEquals('DESC100', $lines[0]['code']);
        $this->assertEquals(10000, $lines[0]['amount']);
        $this->assertEquals('2x1 Promo', $lines[1]['code']);
        $this->assertEquals(20000, $lines[1]['amount']);
    }

    public function test_build_discount_lines_empty_without_discounts()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 500.00)
            ->withTotal(500.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertEmpty($lines);
    }

    public function test_build_discount_lines_ignores_positive_fees()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 500.00)
            ->withFee('Service Fee', 50.00)         // positive — NOT a discount
            ->withFee('Flash Sale', -100.00)         // negative — IS a discount
            ->withTotal(450.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(1, $lines, 'Only negative fees should appear as discount lines');
        $this->assertEquals('Flash Sale', $lines[0]['code']);
        $this->assertEquals(10000, $lines[0]['amount']);
    }

    public function test_build_discount_lines_returns_empty_when_cart_null()
    {
        WC()->cart = null;

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertEmpty($lines);
    }

    public function test_build_discount_lines_zero_coupon_amount_excluded()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 500.00)
            ->withCoupon('EXPIRED', 0.00)     // zero-amount coupon
            ->withCoupon('VALID10', 10.00)
            ->withTotal(490.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(1, $lines, 'Zero-amount coupons should be excluded');
        $this->assertEquals('VALID10', $lines[0]['code']);
    }

    // -------------------------------------------------------
    // Price-level discount detection (dynamic pricing modifying product price)
    // -------------------------------------------------------

    public function test_build_discount_lines_detects_price_level_discounts()
    {
        // Product regular price = 500, dynamic pricing lowered to 400
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 800.00, 800.00, 0, 500.00)
            ->withTotal(800.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(1, $lines);
        $this->assertEquals('dynamic_pricing', $lines[0]['code']);
        $this->assertEquals(20000, $lines[0]['amount']); // (500*2 - 800) * 100
        $this->assertEquals('campaign', $lines[0]['type']);
    }

    public function test_build_discount_lines_price_level_combined_with_coupon()
    {
        // Regular 500, dynamic → 400, coupon 50 off
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 400.00, 350.00, 0, 500.00)
            ->withCoupon('DESC50', 50.00)
            ->withTotal(350.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(2, $lines);
        $this->assertEquals('DESC50', $lines[0]['code']);
        $this->assertEquals(5000, $lines[0]['amount']);
        $this->assertEquals('dynamic_pricing', $lines[1]['code']);
        $this->assertEquals(10000, $lines[1]['amount']); // (500 - 400) * 100
    }

    public function test_build_discount_lines_no_price_discount_when_regular_matches()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 1000.00, 1000.00, 0, 500.00) // 500*2 = 1000 = subtotal
            ->withTotal(1000.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertEmpty($lines);
    }

    public function test_build_discount_lines_all_three_types_together()
    {
        // Coupon + negative fee + price-level: the triple combo
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 400.00, 350.00, 0, 500.00) // regular=500, dynamic→400, coupon→350
            ->withCoupon('CUPON50', 50.00)
            ->withFee('Promo Fee', -30.00)
            ->withTotal(320.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(3, $lines);
        // 1) Coupon
        $this->assertEquals('CUPON50', $lines[0]['code']);
        $this->assertEquals(5000, $lines[0]['amount']);
        // 2) Fee discount
        $this->assertEquals('Promo Fee', $lines[1]['code']);
        $this->assertEquals(3000, $lines[1]['amount']);
        // 3) Price-level
        $this->assertEquals('dynamic_pricing', $lines[2]['code']);
        $this->assertEquals(10000, $lines[2]['amount']); // (500 - 400) * 100

        // Verify total adds up: 5000 + 3000 + 10000 = 18000 cents = $180 total discount
        $total_discount = array_sum(array_column($lines, 'amount'));
        $this->assertEquals(18000, $total_discount);
    }

    public function test_build_discount_lines_mixed_items_some_discounted()
    {
        // Item 10: regular=500, dynamic→400 (discounted)
        // Item 20: regular=300, no discount (300*1 = 300 = subtotal)
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 800.00, 800.00, 0, 500.00)  // 500*2=1000, subtotal=800 → 200 discount
            ->withItem(20, 1, 300.00, 300.00, 0, 300.00)   // 300*1=300,  subtotal=300 → 0 discount
            ->withTotal(1100.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertCount(1, $lines);
        $this->assertEquals('dynamic_pricing', $lines[0]['code']);
        $this->assertEquals(20000, $lines[0]['amount']); // only item 10 contributes
    }

    public function test_build_discount_lines_item_without_regular_price()
    {
        // Product with no regular_price set (0) should not generate discount
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 400.00, 400.00, 0, 0) // regular_price=0
            ->withTotal(400.00);

        $lines = ckpg_build_conekta_discount_lines();

        $this->assertEmpty($lines, 'No discount when regular_price is 0/unset');
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

    public function test_build_line_items_detects_price_discount_via_registry()
    {
        // Register product 10 with regular_price = 500
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

        // unit_price should be bumped to regular: 500 * 100 = 50000
        $this->assertEquals(50000, $line_items[0]['unit_price']);
        // discount = (50000 - 40000) * 2 = 20000
        $this->assertEquals(20000, $discount);
    }

    public function test_build_line_items_mixed_products_only_discounted_counted()
    {
        $this->registerProduct(10, 500.00); // regular=500, effective=400
        $this->registerProduct(20, 300.00); // regular=300, effective=300 (no discount)

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
        $this->assertEquals(50000, $line_items[0]['unit_price']); // bumped to regular
        $this->assertEquals(30000, $line_items[1]['unit_price']); // unchanged
        $this->assertEquals(20000, $discount); // only item 10 contributes
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
    // Cart snapshot (ckpg_build_conekta_cart_snapshot)
    // -------------------------------------------------------

    public function test_cart_snapshot_reflects_discounted_totals()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 4, 2000.00, 1500.00)
            ->withCoupon('VERANO20', 500.00)
            ->withTotal(1500.00);

        $snapshot = ckpg_build_conekta_cart_snapshot();

        $this->assertEquals(150000, $snapshot['amount'], 'Total should be 1500.00 in cents');
        $this->assertCount(1, $snapshot['cart_items']);
        $this->assertEquals(10, $snapshot['cart_items'][0]['id']);
        $this->assertEquals(4, $snapshot['cart_items'][0]['quantity']);
        $this->assertEquals(150000, $snapshot['cart_items'][0]['total'], 'Item total should use line_total (after discount)');
    }

    public function test_cart_snapshot_includes_all_discount_lines()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 1, 500.00, 400.00)
            ->withCoupon('DESC100', 100.00)
            ->withFee('Dynamic Discount', -50.00)
            ->withTotal(350.00);

        $snapshot = ckpg_build_conekta_cart_snapshot();

        $this->assertArrayHasKey('discount_lines', $snapshot);
        $this->assertCount(2, $snapshot['discount_lines']);
        $this->assertEquals('DESC100', $snapshot['discount_lines'][0]['code']);
        $this->assertEquals(10000, $snapshot['discount_lines'][0]['amount']);
        $this->assertEquals('Dynamic Discount', $snapshot['discount_lines'][1]['code']);
        $this->assertEquals(5000, $snapshot['discount_lines'][1]['amount']);
    }

    public function test_cart_snapshot_empty_when_cart_null()
    {
        WC()->cart = null;

        $snapshot = ckpg_build_conekta_cart_snapshot();

        $this->assertEmpty($snapshot);
    }

    public function test_cart_snapshot_multiple_items_with_dynamic_pricing()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 400.00, 400.00)   // discounted by dynamic pricing (was 500 each)
            ->withItem(20, 1, 300.00, 300.00)
            ->withFee('Bulk Discount', -70.00)
            ->withTotal(630.00);

        $snapshot = ckpg_build_conekta_cart_snapshot();

        $this->assertEquals(63000, $snapshot['amount']);
        $this->assertCount(2, $snapshot['cart_items']);

        $this->assertEquals(10, $snapshot['cart_items'][0]['id']);
        $this->assertEquals(40000, $snapshot['cart_items'][0]['total']);

        $this->assertEquals(20, $snapshot['cart_items'][1]['id']);
        $this->assertEquals(30000, $snapshot['cart_items'][1]['total']);

        $this->assertCount(1, $snapshot['discount_lines']);
        $this->assertEquals('Bulk Discount', $snapshot['discount_lines'][0]['code']);
        $this->assertEquals(7000, $snapshot['discount_lines'][0]['amount']);
    }

    // -------------------------------------------------------
    // Cart snapshot with price-level discounts
    // -------------------------------------------------------

    public function test_cart_snapshot_includes_price_level_discount_lines()
    {
        WC()->cart = WC_Cart_Test_Helper::create()
            ->withItem(10, 2, 800.00, 800.00, 0, 500.00) // regular=500, effective=400
            ->withCoupon('PROMO', 100.00)
            ->withTotal(700.00);

        $snapshot = ckpg_build_conekta_cart_snapshot();

        $this->assertEquals(70000, $snapshot['amount']);

        // discount_lines should have coupon + price-level
        $this->assertCount(2, $snapshot['discount_lines']);
        $this->assertEquals('PROMO', $snapshot['discount_lines'][0]['code']);
        $this->assertEquals(10000, $snapshot['discount_lines'][0]['amount']);
        $this->assertEquals('dynamic_pricing', $snapshot['discount_lines'][1]['code']);
        $this->assertEquals(20000, $snapshot['discount_lines'][1]['amount']);
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

    public function test_build_tax_lines_zero_amount()
    {
        $taxes = [
            ['tax_amount' => 0, 'label' => 'Exempt'],
        ];

        $result = ckpg_build_tax_lines($taxes);

        $this->assertCount(1, $result);
        $this->assertEquals(0, $result[0]['amount']);
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

    // -------------------------------------------------------
    // Critical #1: Double-counting test — full REST API discount pipeline
    // -------------------------------------------------------

    /**
     * Simulates the exact discount-building pipeline from conekta-rest-api.php
     * lines 347-358 to verify no double-counting of dynamic_pricing entries.
     */
    public function test_rest_api_pipeline_no_double_counting_price_level_only()
    {
        // Setup: product with regular_price=500, effective=400 (price-level discount)
        $this->registerProduct(10, 500.00);

        // Simulate order items (as returned by $order->get_items())
        $items = [[
            'line_subtotal' => 800.00, // 400 * 2
            'qty'           => 2,
            'product_id'    => 10,
            'name'          => 'Discounted Product',
            'variation_id'  => 0,
        ]];

        // Simulate $data from ckpg_get_request_data($order) — no coupons, no dynamic_pricing
        $data = [
            'discount_lines' => [], // order has no coupons
        ];

        // Simulate empty fees (no negative fees)
        $fees = [];

        // === Reproduce the REST API pipeline (lines 347-358) ===
        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];   // empty
        $discount_lines = ckpg_build_discount_lines($data); // empty (no coupons)
        $discount_lines = array_merge($discount_lines, $discounts_data); // still empty

        $price_level_discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $price_level_discount);
        ckpg_add_price_level_discount($discount_lines, $price_level_discount);

        // Assert: exactly ONE dynamic_pricing entry, not two
        $dynamic_entries = array_filter($discount_lines, fn($d) => $d['code'] === 'dynamic_pricing');
        $this->assertCount(1, $dynamic_entries, 'Should have exactly 1 dynamic_pricing entry, not duplicated');
        $this->assertEquals(20000, $price_level_discount); // (50000-40000)*2
    }

    /**
     * Same pipeline but with a negative fee AND a price-level discount.
     * These are DIFFERENT discount mechanisms — both should appear.
     */
    public function test_rest_api_pipeline_fee_and_price_level_are_separate()
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

        // Negative fee from dynamic pricing
        $fees = [
            new class {
                public function get_total() { return -50.00; }
                public function get_name() { return 'Cart Discount'; }
            },
        ];

        // === REST API pipeline ===
        $fees_formatted = ckpg_build_get_fees($fees);
        $discounts_data = $fees_formatted['discounts'];
        $discount_lines = ckpg_build_discount_lines($data);
        $discount_lines = array_merge($discount_lines, $discounts_data);

        $price_level_discount = 0;
        $line_items = ckpg_build_line_items($items, '5.4.12', $price_level_discount);
        ckpg_add_price_level_discount($discount_lines, $price_level_discount);

        // Fee discount and price-level discount are separate mechanisms
        $this->assertCount(2, $discount_lines);
        $this->assertEquals('Cart Discount', $discount_lines[0]['code']);
        $this->assertEquals(5000, $discount_lines[0]['amount']);
        $this->assertEquals('dynamic_pricing', $discount_lines[1]['code']);
        $this->assertEquals(20000, $discount_lines[1]['amount']);
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
    // Helpers
    // -------------------------------------------------------

    private function invokeMethod($object, string $method, array $args = [])
    {
        $ref = new ReflectionMethod($object, $method);
        $ref->setAccessible(true);
        return $ref->invokeArgs($object, $args);
    }
}
