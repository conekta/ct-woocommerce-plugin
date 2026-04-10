<?php

require_once dirname(__DIR__) . '/vendor/autoload.php';

use Brain\Monkey;

// WP constants
if (!defined('WP_PLUGIN_URL')) {
    define('WP_PLUGIN_URL', 'http://localhost/wp-content/plugins');
}
if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__DIR__) . '/');
}

// WP functions
if (!function_exists('__')) {
    function __($text, $domain = 'default') { return $text; }
}
if (!function_exists('get_site_url')) {
    function get_site_url() { return 'http://localhost'; }
}
if (!function_exists('plugin_basename')) {
    function plugin_basename($file) { return basename(dirname($file)) . '/' . basename($file); }
}
if (!function_exists('add_action')) {
    function add_action($hook, $callback, $priority = 10, $args = 1) {}
}
if (!function_exists('add_filter')) {
    function add_filter($hook, $callback, $priority = 10, $args = 1) {}
}
if (!function_exists('get_option')) {
    function get_option($option, $default = false) { return $default; }
}
if (!function_exists('update_post_meta')) {
    function update_post_meta($post_id, $meta_key, $meta_value) { return true; }
}
if (!function_exists('get_woocommerce_currency')) {
    function get_woocommerce_currency() { return 'MXN'; }
}
if (!function_exists('get_current_user_id')) {
    function get_current_user_id() { return 0; }
}
if (!function_exists('get_locale')) {
    function get_locale() { return 'es_MX'; }
}
if (!function_exists('get_user_meta')) {
    function get_user_meta($user_id, $key, $single = false) { return ''; }
}
if (!function_exists('wc_add_notice')) {
    function wc_add_notice($message, $type = 'notice') {}
}
// Global order registry — allows tests to pre-register orders so that
// wc_get_order() can return false for deleted orders and wc_get_orders()
// can search by meta.
global $test_order_registry;
$test_order_registry = null; // null = not active (legacy), array = active registry

if (!function_exists('wc_get_order')) {
    function wc_get_order($order_id) {
        global $test_order_registry;
        if (is_array($test_order_registry)) {
            return $test_order_registry[$order_id] ?? false;
        }
        return new WC_Order($order_id);
    }
}
if (!function_exists('wc_get_orders')) {
    function wc_get_orders($args = []) {
        global $test_order_registry;
        $results = [];
        $meta_key = $args['meta_key'] ?? null;
        $meta_value = $args['meta_value'] ?? null;
        $limit = $args['limit'] ?? -1;

        foreach ($test_order_registry as $order) {
            if ($meta_key && $meta_value && $order->get_meta($meta_key) === $meta_value) {
                $results[] = $order;
            }
            if ($limit > 0 && count($results) >= $limit) {
                break;
            }
        }
        return $results;
    }
}
if (!function_exists('wpautop')) {
    function wpautop($text) { return $text; }
}
if (!function_exists('wp_kses_post')) {
    function wp_kses_post($text) { return $text; }
}
if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field($str) { return $str; }
}
if (!function_exists('esc_html')) {
    function esc_html($text) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
}
if (!function_exists('wp_json_encode')) {
    function wp_json_encode($data, $options = 0, $depth = 512) { return json_encode($data, $options, $depth); }
}
if (!function_exists('wp_get_post_terms')) {
    function wp_get_post_terms($post_id, $taxonomy, $args = []) { return []; }
}
if (!function_exists('wc_get_product')) {
    function wc_get_product($id) {
        return new WC_Product($id); // picks up data from $test_product_registry
    }
}

// info_log is defined in conekta_gateway_helper.php — no stub needed

// get_expired_at is defined in conekta_gateway_helper.php — no stub needed

// Global product registry — allows tests to pre-configure products so that
// both `new WC_Product($id)` and `wc_get_product($id)` return the same data.
global $test_product_registry;
$test_product_registry = [];

// WC_Product stub — picks up pre-registered data from global registry
if (!class_exists('WC_Product')) {
    class WC_Product {
        private $id;
        private $name;
        private $regular_price = 0;
        private $price = 0;
        public function __construct($id = 0) {
            global $test_product_registry;
            $this->id = $id;
            $this->name = 'Test Product ' . $id;
            if (isset($test_product_registry[$id])) {
                $src = $test_product_registry[$id];
                $this->regular_price = $src['regular_price'] ?? 0;
                $this->price         = $src['price'] ?? 0;
                $this->name          = $src['name'] ?? $this->name;
            }
        }
        public function get_id() { return $this->id; }
        public function get_name() { return $this->name; }
        public function set_name($name) { $this->name = $name; return $this; }
        public function get_sku() { return ''; }
        public function get_price() { return $this->price; }
        public function set_price($price) { $this->price = $price; return $this; }
        public function get_regular_price() { return $this->regular_price; }
        public function set_regular_price($price) { $this->regular_price = $price; return $this; }
        public function get_description() { return ''; }
        public function get_gallery_image_ids() { return []; }
    }
}

// WC_Coupon stub
if (!class_exists('WC_Coupon')) {
    class WC_Coupon {
        private $code;
        public function __construct($code = '') { $this->code = $code; }
        public function get_data() { return ['code' => $this->code]; }
        public function is_valid() { return true; }
    }
}

// WC_Payment_Gateway stub
if (!class_exists('WC_Payment_Gateway')) {
    class WC_Payment_Gateway {
        public $id;
        public $method_title;
        public $has_fields;
        public $title;
        public $description;
        public $enabled;
        public $icon;
        public $form_fields = [];
        public $settings = [];

        public function init_settings() {
            $defaults = [];
            foreach ($this->form_fields as $key => $field) {
                $defaults[$key] = $field['default'] ?? '';
            }
            $saved = get_option('woocommerce_' . $this->id . '_settings', []);
            $this->settings = is_array($saved) ? array_merge($defaults, $saved) : $defaults;
        }

        public function get_option($key, $default = '') {
            return $this->settings[$key] ?? $default;
        }

        public function get_return_url($order = null) {
            return 'http://localhost/checkout/order-received/';
        }

        public function process_admin_options() {}
    }
}

// WC_Order stub
if (!class_exists('WC_Order')) {
    class WC_Order {
        private $id;
        private $status = 'pending';
        private $meta = [];
        private $coupons = [];

        public function __construct($id = 0) {
            $this->id = $id;
        }

        public function set_coupons(array $coupons) {
            $this->coupons = $coupons;
        }

        public function get_id() { return $this->id; }
        public function get_status() { return $this->status; }

        // Items
        public function get_items($type = '') {
            if ($type === 'coupon') {
                return $this->coupons;
            }
            return [];
        }
        public function get_taxes() { return []; }
        public function get_fees() { return []; }

        // Totals
        public function get_total() { return '100.00'; }
        public function get_shipping_total() { return '0.00'; }
        public function get_shipping_method() { return 'flat_rate'; }
        public function get_customer_note() { return ''; }

        // Billing
        public function get_billing_first_name() { return 'John'; }
        public function get_billing_last_name() { return 'Doe'; }
        public function get_billing_email() { return 'john@example.com'; }
        public function get_billing_phone() { return '+5215555555555'; }
        public function get_billing_address_1() { return 'Calle Test 123'; }
        public function get_billing_address_2() { return ''; }
        public function get_billing_city() { return 'CDMX'; }
        public function get_billing_state() { return 'DF'; }
        public function get_billing_country() { return 'MX'; }
        public function get_billing_postcode() { return '06600'; }

        // Shipping
        public function get_shipping_first_name() { return 'John'; }
        public function get_shipping_last_name() { return 'Doe'; }
        public function get_shipping_address_1() { return 'Calle Test 123'; }
        public function get_shipping_address_2() { return ''; }
        public function get_shipping_city() { return 'CDMX'; }
        public function get_shipping_state() { return 'DF'; }
        public function get_shipping_country() { return 'MX'; }
        public function get_shipping_postcode() { return '06600'; }

        // Status
        public function update_status($status, $note = '') {
            $this->status = $status;
        }
        public function payment_complete() {
            $this->status = 'completed';
        }
        public function add_order_note($note) {}

        // Meta
        public function get_meta($key) {
            return $this->meta[$key] ?? '';
        }
        public function update_meta_data($key, $value) {
            $this->meta[$key] = $value;
        }

        public function save() {}
        public function delete($force = false) {}
    }
}

// WC_Admin_Settings stub
if (!class_exists('WC_Admin_Settings')) {
    class WC_Admin_Settings {
        public static function add_error($text) {}
    }
}

// WC_Geolocation stub
if (!class_exists('WC_Geolocation')) {
    class WC_Geolocation {
        public static function get_ip_address() { return '127.0.0.1'; }
    }
}

// Configurable cart stub for testing cart/discount functions
if (!class_exists('WC_Cart_Test_Helper')) {
    class WC_Cart_Test_Helper {
        private array $items = [];
        private array $coupons = [];
        private array $coupon_amounts = [];
        private array $coupon_tax_amounts = [];
        private array $fees = [];
        private float $total = 0.0;

        public static function create(): self { return new self(); }

        /**
         * @param float $regular_price  If > 0, sets the product regular_price (for price-level discount detection)
         */
        public function withItem(int $product_id, int $quantity, float $line_subtotal, float $line_total, int $variation_id = 0, float $regular_price = 0): self {
            $product = new WC_Product($product_id);
            if ($regular_price > 0) {
                $product->set_regular_price($regular_price);
            }
            $this->items['item_' . count($this->items)] = [
                'data'           => $product,
                'product_id'     => $product_id,
                'quantity'       => $quantity,
                'line_subtotal'  => $line_subtotal,
                'line_total'     => $line_total,
                'variation_id'   => $variation_id,
            ];
            return $this;
        }

        public function withCoupon(string $code, float $amount, float $tax = 0.0): self {
            $this->coupons[] = $code;
            $this->coupon_amounts[$code] = $amount;
            $this->coupon_tax_amounts[$code] = $tax;
            return $this;
        }

        public function withFee(string $name, float $total, bool $taxable = false): self {
            $this->fees[] = (object) [
                'name'      => $name,
                'total'     => $total,
                'amount'    => $total,
                'tax'       => 0.0,
                'taxable'   => $taxable,
                'tax_class' => '',
            ];
            return $this;
        }

        public function withTotal(float $total): self {
            $this->total = $total;
            return $this;
        }

        // --- WC_Cart interface ---
        public function is_empty(): bool { return empty($this->items); }
        public function get_cart(): array { return $this->items; }
        public function get_applied_coupons(): array { return $this->coupons; }
        public function get_coupon_discount_amount(string $code, bool $ex_tax = true): float {
            return $this->coupon_amounts[$code] ?? 0.0;
        }
        public function get_coupon_discount_tax_amount(string $code): float {
            return $this->coupon_tax_amounts[$code] ?? 0.0;
        }
        public function get_coupon_discount_totals(): array { return $this->coupon_amounts; }
        public function get_fees(): array { return $this->fees; }
        public function get_total(string $context = ''): float { return $this->total; }
        public function get_coupons(): array {
            $result = [];
            foreach ($this->coupons as $code) {
                $result[$code] = new WC_Coupon($code);
            }
            return $result;
        }
        public function calculate_totals(): void { /* no-op in tests */ }
    }
}

// WP_REST_Request stub
if (!class_exists('WP_REST_Request')) {
    class WP_REST_Request {
        private $params = [];
        private $method;

        public function __construct($method = 'GET') {
            $this->method = $method;
        }
        public function get_params() { return $this->params; }
        public function get_param($key) { return $this->params[$key] ?? null; }
        public function set_param($key, $value) { $this->params[$key] = $value; }
        public function set_params(array $params) { $this->params = $params; }
    }
}

// WP_REST_Response stub
if (!class_exists('WP_REST_Response')) {
    class WP_REST_Response {
        private $data;
        private $status;

        public function __construct($data = null, $status = 200) {
            $this->data = $data;
            $this->status = $status;
        }
        public function get_data() { return $this->data; }
        public function get_status() { return $this->status; }
    }
}

// Global gateway instance for WC() stub
global $test_conekta_gateway;
$test_conekta_gateway = null;

// WC() function stub (singleton, like real WooCommerce)
if (!function_exists('WC')) {
    function WC() {
        static $instance = null;
        if (null === $instance) {
            $instance = new class {
                public $version = '9.0.0';
                public $session;
                public $payment_gateways;
                public $cart;

                public function __construct() {
                    $this->session = new class {
                        private $data = [];
                        public function get($key) { return $this->data[$key] ?? null; }
                        public function set($key, $value) { $this->data[$key] = $value; }
                        public function __unset($key) { unset($this->data[$key]); }
                    };
                    $this->cart = null;
                    $this->payment_gateways = new class {
                        public function get_available_payment_gateways() {
                            global $test_conekta_gateway;
                            return $test_conekta_gateway ? ['conekta' => $test_conekta_gateway] : [];
                        }
                    };
                }
            };
        }
        return $instance;
    }
}

// WP REST / AJAX stubs needed by conekta-rest-api.php
if (!function_exists('register_rest_route')) {
    function register_rest_route($namespace, $route, $args = []) {}
}
if (!function_exists('wp_verify_nonce')) {
    function wp_verify_nonce($nonce, $action = -1) { return 1; }
}
if (!function_exists('wp_create_nonce')) {
    function wp_create_nonce($action = -1) { return 'test_nonce'; }
}
if (!function_exists('rest_url')) {
    function rest_url($path = '') { return 'http://localhost/wp-json/' . $path; }
}
if (!function_exists('wp_safe_redirect')) {
    function wp_safe_redirect($location, $status = 302) {}
}
if (!function_exists('wc_get_checkout_url')) {
    function wc_get_checkout_url() { return 'http://localhost/checkout/'; }
}
if (!class_exists('WC_AJAX')) {
    class WC_AJAX {
        public static function get_endpoint($request) { return '/?wc-ajax=' . $request; }
    }
}
if (!function_exists('wp_localize_script')) {
    function wp_localize_script($handle, $name, $data) {}
}

// Load plugin files
require_once dirname(__DIR__) . '/conekta_gateway_helper.php';
require_once dirname(__DIR__) . '/conekta_plugin.php';
require_once dirname(__DIR__) . '/conekta_block_gateway.php';
require_once dirname(__DIR__) . '/conekta_checkout.php';
