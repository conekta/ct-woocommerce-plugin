<?php
/**
 * Conekta REST API endpoints for 3DS integration
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

class WC_Conekta_REST_API {
    
    /**
     * Initialize the REST API endpoints
     */
    public static function init() {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }
    
    /**
     * Register the REST API routes
     */
    public static function register_routes() {
        register_rest_route('conekta/v1', '/create-3ds-order', [
            'methods' => 'POST',
            'callback' => [self::class, 'create_3ds_order'],
            'permission_callback' => '__return_true',
        ]);
    }
    
    /**
     * Create an order with 3DS in Conekta
     * 
     * @param WP_REST_Request $request Request object
     * @return WP_REST_Response
     */
    public static function create_3ds_order($request) {
        try {
            $params = $request->get_params();
            
            // Validate token is required
            if (empty($params['token'])) {
                return new WP_REST_Response([
                    'success' => false,
                    'message' => 'Token is required',
                ], 400);
            }
            
            $token = sanitize_text_field($params['token']);
            $msi_option = isset($params['msi_option']) ? intval($params['msi_option']) : 1;
            
            // Get Conekta gateway
            $gateways = WC()->payment_gateways->get_available_payment_gateways();
            if (!isset($gateways['conekta'])) {
                return new WP_REST_Response([
                    'success' => false,
                    'message' => 'Conekta gateway not found',
                ], 404);
            }
            
            $gateway = $gateways['conekta'];
            
            // Check if we have an order_id
            if (!empty($params['order_id'])) {
                // Use existing WooCommerce order
                try {
                    $order_id = intval($params['order_id']);
                    $order = wc_get_order($order_id);
                    
                    if (!$order) {
                        error_log('Order not found: ' . $order_id);
                        return new WP_REST_Response([
                            'success' => false,
                            'message' => 'Order not found',
                        ], 404);
                    }
                    info_log('Using existing order: ' . $order_id);
                } catch (\Exception $e) {
                    error_log('Error getting order: ' . $e->getMessage());
                    return new WP_REST_Response([
                        'success' => false,
                        'message' => 'Error getting order: ' . $e->getMessage(),
                    ], 500);
                }
            } else {
                // Check if we're in a WooCommerce Blocks context or Classic checkout context
                $is_blocks_context = isset($params['is_blocks_context']) && $params['is_blocks_context'];
                $is_classic_context = isset($params['is_classic_context']) && $params['is_classic_context'];
                $cart_data = isset($params['cart_data']) ? $params['cart_data'] : null;
                $billing_data = isset($params['billing_data']) ? $params['billing_data'] : null;
                $shipping_data = isset($params['shipping_data']) ? $params['shipping_data'] : null;
                $shipping_method = isset($params['shipping_method']) ? $params['shipping_method'] : null;
                
                if (($cart_data || $billing_data) && ($is_blocks_context || $is_classic_context)) {
                    // Create an order from the cart and billing data provided by blocks or classic checkout
                    try {
                        $context = $is_blocks_context ? 'blocks' : 'classic checkout';
                        info_log("Creating order from {$context} with provided data");
                        
                        // Create order
                        $order = wc_create_order();
                        
                        // Set billing info from provided data
                        if ($billing_data) {
                            $order->set_billing_first_name($billing_data['first_name'] ?? 'Guest');
                            $order->set_billing_last_name($billing_data['last_name'] ?? 'Customer');
                            $order->set_billing_company($billing_data['company'] ?? '');
                            $order->set_billing_address_1($billing_data['address_1'] ?? '');
                            $order->set_billing_address_2($billing_data['address_2'] ?? '');
                            $order->set_billing_city($billing_data['city'] ?? '');
                            $order->set_billing_state($billing_data['state'] ?? '');
                            $order->set_billing_postcode($billing_data['postcode'] ?? '');
                            $order->set_billing_country($billing_data['country'] ?? 'MX');
                            $order->set_billing_email($billing_data['email'] ?? 'guest@example.com');
                            $order->set_billing_phone($billing_data['phone'] ?? '');
                        }
                        
                        // Set shipping info from provided data
                        if ($shipping_data) {
                            $order->set_shipping_first_name($shipping_data['first_name'] ?? '');
                            $order->set_shipping_last_name($shipping_data['last_name'] ?? '');
                            $order->set_shipping_company($shipping_data['company'] ?? '');
                            $order->set_shipping_address_1($shipping_data['address_1'] ?? '');
                            $order->set_shipping_address_2($shipping_data['address_2'] ?? '');
                            $order->set_shipping_city($shipping_data['city'] ?? '');
                            $order->set_shipping_state($shipping_data['state'] ?? '');
                            $order->set_shipping_postcode($shipping_data['postcode'] ?? '');
                            $order->set_shipping_country($shipping_data['country'] ?? 'MX');
                        }
                        
                        // Set shipping method from provided data
                        if ($shipping_method) {
                            $shipping_item = new WC_Order_Item_Shipping();
                            $shipping_cost = isset($shipping_method['cost']) ? ($shipping_method['cost'] / 100) : 0;
                            $shipping_item->set_props([
                                'method_title' => $shipping_method['label'] ?? 'Shipping',
                                'method_id' => $shipping_method['id'] ?? 'flat_rate',
                                'total' => $shipping_cost
                            ]);
                            $order->add_item($shipping_item);
                        }
                        
                        // Add items from cart
                        if (isset($cart_data['items']) && is_array($cart_data['items'])) {
                            foreach ($cart_data['items'] as $item) {
                                if (isset($item['id'], $item['quantity'])) {
                                    $product = wc_get_product($item['id']);
                                    if ($product) {
                                        $item_id = $order->add_product(
                                            $product, 
                                            $item['quantity'],
                                            [
                                                'variation' => isset($item['variation_id']) ? wc_get_product($item['variation_id']) : null,
                                                'total' => isset($item['total']) ? $item['total'] / 100 : null
                                            ]
                                        );
                                    }
                                }
                            }
                        } else {
                            // If no items provided, add a placeholder item
                            $item = new WC_Order_Item_Product();
                            $total = isset($cart_data['total']) ? ($cart_data['total'] / 100) : 1.00; // Convert from cents to currency units
                            $item->set_props([
                                'name' => 'Temporary 3DS validation',
                                'quantity' => 1,
                                'total' => $total,
                            ]);
                            $order->add_item($item);
                        }
                        
                        // Set payment method
                        $order->set_payment_method('conekta');
                        
                        // Calculate totals and save
                        $order->calculate_totals();
                        $status_note = $is_blocks_context ? 'Orden creada para verificación 3DS desde Blocks' : 'Orden creada para verificación 3DS desde Classic Checkout';
                        $order->set_status('pending', $status_note);
                        $order->save();
                        
                        info_log("{$context} order created: " . $order->get_id());
                    } catch (\Exception $e) {
                        error_log("Error creating order from {$context} data: " . $e->getMessage());
                        return new WP_REST_Response([
                            'success' => false,
                            'message' => "Error creating order from {$context} data: " . $e->getMessage(),
                        ], 500);
                    }
                } else {
                    // Create a minimal order for 3DS verification
                    try {
                        info_log('Creating minimal order for 3DS verification');
                        
                        // Create simple order
                        $order = wc_create_order();
                        
                        // Add basic product
                        $item = new WC_Order_Item_Product();
                        $item->set_props([
                            'name' => 'Temporary 3DS validation',
                            'quantity' => 1,
                            'total' => 1.00,
                        ]);
                        $order->add_item($item);
                        
                        // Set basic billing info
                        $order->set_billing_email('temp_' . uniqid() . '@example.com');
                        $order->set_billing_first_name('Temporary');
                        $order->set_billing_last_name('Customer');
                        $order->set_billing_country('MX');
                        $order->set_billing_address_1('Test Address');
                        $order->set_billing_city('Ciudad de México');
                        $order->set_billing_state('DF');
                        $order->set_billing_postcode('11000');
                        $order->set_billing_phone('5555555555');
                        
                        // Set payment method
                        $order->set_payment_method('conekta');
                        
                        // Calculate totals and save
                        $order->calculate_totals();
                        $order->set_status('pending', 'Orden creada para verificación 3DS');
                        $order->save();
                        
                        info_log('Minimal 3DS validation order created: ' . $order->get_id());
                    } catch (\Exception $e) {
                        error_log('Error creating minimal order: ' . $e->getMessage());
                        return new WP_REST_Response([
                            'success' => false,
                            'message' => 'Error creating minimal order: ' . $e->getMessage(),
                        ], 500);
                    }
                }
            }
            
            // Build request data
            try {
                info_log('Building request data for order: ' . $order->get_id());
                
                // Build request data from order
                $data = ckpg_get_request_data($order);
                
                // Handle case where order might not have all required fields
                if (empty($data) || !isset($data['customer_info']) || !isset($data['amount'])) {
                    info_log('Order lacks required data, using minimal valid data');
                    
                    // Get minimal required customer info
                    $email = $order->get_billing_email();
                    if (empty($email)) $email = 'temp_' . $order->get_id() . '@example.com';
                    
                    $name = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
                    if (empty($name)) $name = 'Temporary Customer';
                    
                    $phone = $order->get_billing_phone();
                    if (empty($phone)) $phone = '5555555555';
                    
                    // Create minimal valid data
                    $data = [
                        'order_id' => $order->get_id(),
                        'amount' => $order->get_total() * 100 ?: 100, // Use order total or 1.00 if empty
                        'currency' => $order->get_currency() ?: 'MXN',
                        'description' => 'Order #' . $order->get_id(),
                        'customer_info' => [
                            'name' => $name,
                            'phone' => $phone,
                            'email' => $email
                        ],
                    ];
                    
                    // Add shipping lines even for minimal data
                    $amountShipping = amount_validation($order->get_shipping_total());
                    $shipping_method = $order->get_shipping_method();
                    if (!empty($shipping_method)) {
                        $data['shipping_lines'] = [
                            [
                                'amount'  => $amountShipping,
                                'carrier' => $shipping_method,
                                'method'  => $shipping_method
                            ]
                        ];
                    } else {
                        $data['shipping_lines'] = [
                            [
                                'amount'   => $amountShipping,
                                'carrier'  => 'carrier',
                                'method'   => 'pickup'
                            ]
                        ];
                    }
                }
                
                $items = $order->get_items();
                $taxes = $order->get_taxes();
                $fees = $order->get_fees();
                
                // Use existing functions to build data
                $fees_formatted = ckpg_build_get_fees($fees);
                $discounts_data = $fees_formatted['discounts'];
                $fees_data = $fees_formatted['fees'];
                $tax_lines = ckpg_build_tax_lines($taxes);
                $tax_lines = array_merge($tax_lines, $fees_data);
                $discount_lines = ckpg_build_discount_lines($data);
                $discount_lines = array_merge($discount_lines, $discounts_data);
                $line_items = ckpg_build_line_items($items, $gateway->version);
                $shipping_lines = ckpg_build_shipping_lines($data);
                $shipping_contact = ckpg_build_shipping_contact($data);
                $customer_info = isset($data['customer_info']) ? $data['customer_info'] : [];
                
                // Make sure customer_info has required fields with metadata
                if (!empty($customer_info)) {
                    $customer_info = array_merge($customer_info, ['metadata' => ['soft_validations' => true]]);
                }
                
                $order_metadata = ckpg_build_order_metadata($data + array(
                    'plugin_conekta_version' => $gateway->version,
                    'woocommerce_version' => WC()->version,
                    'payment_method' => 'WC_Conekta_Gateway',
                ));
                
                // Ensure line items exist
                if (empty($line_items)) {
                    $line_items = [
                        [
                            'name' => 'Order #' . $order->get_id(),
                            'unit_price' => intval($order->get_total() * 100) ?: 100,
                            'quantity' => 1
                        ]
                    ];
                }
                
            } catch (\Exception $e) {
                error_log('Error building request data: ' . $e->getMessage());
                return new WP_REST_Response([
                    'success' => false,
                    'message' => 'Error building request data: ' . $e->getMessage()
                ], 500);
            }
            
            // Create OrderRequest
            try {
                info_log('Creating OrderRequest');
                
                // Base request with required fields
                $request_data = [
                    'currency' => isset($data['currency']) ? $data['currency'] : 'MXN',
                    'line_items' => $line_items,
                    'metadata' => $order_metadata,
                    'three_ds_mode' => $gateway->three_ds_mode,
                    'return_url' => get_site_url() . '/?wc-api=conekta_3ds_callback&woo_order_id=' . $order->get_id()
                ];
                
                // Add customer_info if available
                if (!empty($customer_info)) {
                    $request_data['customer_info'] = $customer_info;
                }
                
                // Add shipping_lines if available
                if (!empty($shipping_lines)) {
                    $request_data['shipping_lines'] = $shipping_lines;
                }
                
                // Add tax_lines if available
                if (!empty($tax_lines)) {
                    $request_data['tax_lines'] = $tax_lines;
                }
                
                // Add discount_lines if available
                if (!empty($discount_lines)) {
                    $request_data['discount_lines'] = $discount_lines;
                }
                
                // Create OrderRequest
                $rq = new \Conekta\Model\OrderRequest($request_data);
                
                // Add shipping contact if available
                if (!empty($shipping_contact)) {
                    $rq->setShippingContact(new \Conekta\Model\CustomerShippingContacts($shipping_contact));
                }
            } catch (\Exception $e) {
                error_log('Error creating OrderRequest: ' . $e->getMessage());
                return new WP_REST_Response([
                    'success' => false,
                    'message' => 'Error creating OrderRequest: ' . $e->getMessage()
                ], 500);
            }
            
            $payment_method = new \Conekta\Model\ChargeRequestPaymentMethod([
                'type' => 'card',
                'token_id' => $token,
                'expires_at' => get_expired_at($gateway->settings['order_expiration']),
                'customer_ip_address' => \WC_Geolocation::get_ip_address()
            ]);
            
            if ($gateway->settings['is_msi_enabled'] == 'yes' && (int)$msi_option > 1) {
                $payment_method->setMonthlyInstallments((int)$msi_option);
            }
            
            $charge = new \Conekta\Model\ChargeRequest([
                'payment_method' => $payment_method,
                'reference_id' => strval($order->get_id()),
            ]);
            
            $rq->setCharges([$charge]);
            
            // Create order in Conekta
            $conekta_order = $gateway->get_api_instance($gateway->settings['cards_api_key'], $gateway->version)
                ->createOrder($rq, $gateway->get_user_locale());
                
            // Store Conekta order ID in WooCommerce order
            self::update_conekta_order_meta($order, $conekta_order->getId(), 'conekta-order-id');
            
            // Return success response with next_action if present
            $response_data = [
                'success' => true,
                'order_id' => $conekta_order->getId(),
                'woo_order_id' => $order->get_id(),
                'payment_status' => $conekta_order->getPaymentStatus()
            ];
            
            // Check if order has next_action (3DS authentication required)
            if (method_exists($conekta_order, 'getNextAction') && $conekta_order->getNextAction()) {
                $next_action = $conekta_order->getNextAction();
                $response_data['next_action'] = [
                    'type' => $next_action->getType(),
                    'redirect_url' => $next_action->getRedirectToUrl()->getUrl(),
                    'return_url' => $next_action->getRedirectToUrl()->getReturnUrl()
                ];
            }
            
            return new WP_REST_Response($response_data, 200);
            
        } catch (\Exception $e) {
            return new WP_REST_Response([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }
    
    /**
     * Update Conekta order meta in WooCommerce order
     * 
     * @param WC_Order $order WooCommerce order
     * @param string $value Meta value
     * @param string $key Meta key
     */
    private static function update_conekta_order_meta($order, $value, $key) {
        if (is_callable(array($order, 'update_meta_data'))) {
            $order->update_meta_data($key, $value);
            $order->save();
        } else {
            update_post_meta($order->get_id(), $key, $value);
        }
    }
}

// Initialize REST API endpoints
add_action('init', ['WC_Conekta_REST_API', 'init']); 