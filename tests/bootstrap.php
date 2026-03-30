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
if (!function_exists('wc_get_order')) {
    function wc_get_order($order_id) { return new WC_Order($order_id); }
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
// info_log is defined in conekta_gateway_helper.php — no stub needed

// get_expired_at is defined in conekta_gateway_helper.php — no stub needed

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

// WC() function stub
if (!function_exists('WC')) {
    function WC() {
        return new class {
            public $version = '9.0.0';
            public $session;

            public function __construct() {
                $this->session = new class {
                    private $data = [];
                    public function get($key) { return $this->data[$key] ?? null; }
                    public function set($key, $value) { $this->data[$key] = $value; }
                    public function __unset($key) { unset($this->data[$key]); }
                };
            }
        };
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
