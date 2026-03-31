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
        Configuration::getDefaultConfiguration()
            ->setHost(self::$conektaHost)
            ->setAccessToken('key_test_123');
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
    // Helpers
    // -------------------------------------------------------

    private function invokeMethod($object, string $method, array $args = [])
    {
        $ref = new ReflectionMethod($object, $method);
        $ref->setAccessible(true);
        return $ref->invokeArgs($object, $args);
    }
}
