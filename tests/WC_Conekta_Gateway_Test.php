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
        global $test_product_registry;
        WC()->cart = null;
        $test_product_registry = [];
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
