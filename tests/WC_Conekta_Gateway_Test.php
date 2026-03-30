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

        $gateway = $this->createConfiguredGateway();
        $api = $gateway->get_api_instance('key_test_123', '5.4.11');

        $order = $api->getOrderById('ord_test_123');
        $this->assertNotNull($order);
        $this->assertNotEmpty($order->getId());
    }

    /**
     * @group mockoon
     */
    public function test_capture_order()
    {
        $this->requireMockoon();

        $gateway = $this->createConfiguredGateway();
        $api = $gateway->get_api_instance('key_test_123', '5.4.11');

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

        $gateway = $this->createConfiguredGateway();
        $companiesApi = $gateway->get_companies_api_instance('key_test_123', '5.4.11');

        $company = $companiesApi->getCurrentCompany('es');
        $this->assertNotNull($company);
    }

    public function test_gateway_disabled_without_api_key()
    {
        $gateway = new WC_Conekta_Gateway();

        $this->assertFalse($gateway->enabled);
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
