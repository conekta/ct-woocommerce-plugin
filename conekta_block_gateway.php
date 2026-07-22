<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Franklin Carrero
 * Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/


require_once(__DIR__ . '/vendor/autoload.php');

use Conekta\ApiException;
use Conekta\Model\EventTypes;
use Conekta\Model\ChargeUpdateRequest;
use Conekta\Model\OrderUpdate;
use Conekta\Model\OrderUpdateCustomerInfo;
use Conekta\Model\CustomerShippingContactsRequest;

class WC_Conekta_Gateway extends WC_Conekta_Plugin
{
    protected $GATEWAY_NAME = "WC_Conekta_Gateway";
    protected $order = null;
    protected $currencies = array('MXN', 'USD');

    public $id;
    public $method_title;
    public $has_fields;
    public $title;
    public $description;
    public $api_key;
    public $public_api_key;
    public $webhook_url;

    /**
     * @throws ApiException|Exception
     */
    public function __construct()
    {
        $this->id = 'conekta';
        $this->method_title = __('Conekta Tarjetas', 'Conekta');
        $this->has_fields = true;
        $this->ckpg_init_form_fields();
        $this->init_settings();
        $this->title = $this->settings['title'];
        $this->description = $this->settings['description'];
        $this->icon        = $this->settings['alternate_imageurl'] ?
                                                $this->settings['alternate_imageurl'] :
                                                WP_PLUGIN_URL . "/" . plugin_basename( dirname(__FILE__))
                                                . '/images/credits.png';
        $this->api_key = $this->settings['cards_api_key'];
        $this->public_api_key = $this->settings['cards_public_api_key'];
        $this->webhook_url = $this->settings['webhook_url'];

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
        add_action('woocommerce_api_wc_conekta', [$this, 'check_for_webhook']);

        if (!$this->ckpg_validate_currency()) {
            $this->enabled = false;
        }

        if (empty($this->api_key)) {
            $this->enabled = false;
        }
        if (!empty($this->api_key)) {
            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'configure_webhook'));
        }
        add_action('woocommerce_rest_checkout_process_payment_with_context', [$this, 'process_payment_api'], 10, 2);
    }

    /**
     * @throws Exception
     */
    public function configure_webhook()
    {
        $this->create_webhook($this->settings['cards_api_key'], $this->settings['webhook_url']);
    }
    public function process_admin_options()
    {
        parent::process_admin_options();

        if (empty($this->get_option('cards_public_api_key'))) {
            WC_Admin_Settings::add_error(__('Error: La clave pública de Conekta es obligatoria.', 'woothemes'));
        }
        if (empty($this->get_option('cards_api_key'))) {
            WC_Admin_Settings::add_error(__('Error: La clave privada de Conekta es obligatoria.', 'woothemes'));
        }
    }

    /**
     * @throws ApiException
     */
    public function check_for_webhook()
    {
        if (!isset($_SERVER['REQUEST_METHOD'])
            || ('POST' !== $_SERVER['REQUEST_METHOD'])
            || !isset($_GET['wc-api'])
            || ('wc_conekta' !== $_GET['wc-api'])
        ) {
            return;
        }

        $body = @file_get_contents('php://input');
        $event = json_decode($body, true);

        switch ($event['type']) {
            case EventTypes::WEBHOOK_PING:
                self::handleWebhookPing();
                break;

            case EventTypes::ORDER_PAID:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderPaid($this->get_api_instance($this->settings['cards_api_key'], $this->version), $event);
                break;

            case EventTypes::ORDER_EXPIRED:
            case EventTypes::ORDER_CANCELED:
                self::check_if_payment_payment_method_webhook($this->GATEWAY_NAME, $event);
                self::handleOrderExpiredOrCanceled($this->get_api_instance($this->settings['cards_api_key'], $this->version), $event);
                break;
            default:
                break;
        }
    }


    public function ckpg_init_form_fields()
    {
        $this->form_fields = array(
            'enabled' => array(
                'type' => 'checkbox',
                'title' => __('Habilitar/Deshabilitar', 'woothemes'),
                'label' => __('Habilitar Conekta', 'woothemes'),
                'default' => 'yes'
            ),
            'title' => array(
                'type' => 'text',
                'title' => __('Título', 'woothemes'),
                'description' => __('', 'woothemes'),
                'default' => __('Tarjeta', 'woothemes'),
                'required' => true
            ),
            'description' => array(
                'type' => 'text',
                'title' => __('Descripción', 'woothemes'),
                'description' => __('', 'woothemes'),
                'default' => __('Paga con tarjetas de débito, crédito y vales', 'woothemes'),
                'required' => true
            ),
            'cards_api_key' => array(
                'type'        => 'password',
                'title'       => __('Conekta API key', 'woothemes'),
                'description' => __('API Key Producción (Tokens/Llave Privada). Consulta más información en <a href="https://developers.conekta.com/docs/api-keys-producci%C3%B3n" target="_blank">la documentación oficial</a>.', 'woothemes'),
                'default'     => __('', 'woothemes'),
                'required'    => true
            ),
            'cards_public_api_key' => array(
                'type'        => 'password',
                'title'       => __('Conekta public API key', 'woothemes'),
                'description' => __('Public API Key Producción (Tokens/Llave Pública). Consulta más información en <a href="https://developers.conekta.com/docs/api-keys-pruebas" target="_blank">la documentación oficial</a>.', 'woothemes'),
                'required'    => true
            ),
            'order_expiration' => array(
                'type' => 'number',
                'title' => __('Vencimiento de las órdenes de pago (Días)', 'woothemes'),
                'description' => __('La cantidad de dīas configuradas en esta opción, corresponde al tiempo en el que la orden estará activa para ser pagada por el cliente desde el momento de su creación.', 'woothemes'),
                'default' => __(1),
                'custom_attributes' => array(
                    'min' => 1,
                    'max' => 30,
                    'step' => 1
                ),
            ),
            'months' => array(
                'type'              => 'multiselect',
                'title'             => __('Meses sin Intereses', 'woothemes'),
                'description'       => __('Selecciona los plazos a habilitar. Déjalo vacío para desactivar MSI.', 'woothemes'),
                'options'           => array(
                    '3'  => __('3', 'woothemes'),
                    '6'  => __('6', 'woothemes'),
                    '9'  => __('9', 'woothemes'),
                    '12' => __('12', 'woothemes'),
                    '18' => __('18', 'woothemes'),
                    '24' => __('24', 'woothemes'),
                ),
                'default'           => array(),
                'class'             => 'wc-enhanced-select',
                'css'               => 'width: 400px;',
                'custom_attributes' => array(
                    'data-placeholder' => __('Selecciona los plazos', 'woothemes'),
                    'multiple'         => 'multiple',
                ),
            ),
            'wallets_enabled' => array(
                'type'        => 'checkbox',
                'title'       => __('Wallets (Apple Pay / Google Pay)', 'woothemes'),
                'label'       => __('Mostrar botones de Apple Pay y Google Pay en el checkout', 'woothemes'),
                'description' => __(
                    'Consulta los pasos de activación: <a href="https://developers.conekta.com/docs/gu%C3%ADa-de-activaci%C3%B3n-apple-pay" target="_blank">Apple Pay</a> · <a href="https://developers.conekta.com/docs/gu%C3%ADa-de-activaci%C3%B3n-google-pay" target="_blank">Google Pay</a>.',
                    'woothemes'
                ),
                'default'     => 'yes',
            ),
            'webhook_url' => array(
                'type' => 'text',
                'title' => __('URL webhook', 'woothemes'),
                'description' => __('URL webhook', 'woothemes'),
                'default' => __(get_site_url() . '/?wc-api=wc_conekta'),
                'required' => true
            ),
            'alternate_imageurl' => array(
                'type'        => 'text',
                'title'       => __('Imagen alternativa para mostrar en el momento del pago, utilice una URL completa y envíela a través de https', 'woothemes'),
                'default'     => __('', 'woothemes')
            )
        );

    }

    protected function ckpg_mark_as_failed_payment($order)
    {
        $order->add_order_note(
            sprintf(
                "%s conekta Payment Failed",
                $this->GATEWAY_NAME,
            )
        );
    }

    public function payment_fields() {
        if (!empty($this->description)) {
            echo wpautop(wp_kses_post($this->description));
        }
        echo '<div id="conektaITokenizerframeContainer" style="height:600px"></div>';
        echo '<input type="hidden" name="conekta_order_id" />';
    }

    /**
     * Validate the Conekta order paid by the Integration component and complete
     * the WooCommerce order. Shared between blocks (process_payment_api), the
     * classic confirm endpoint (WC_Conekta_REST_API::wc_ajax_confirm_order) and
     * the legacy wallet path (process_payment with conekta_order_id in POST).
     *
     * @return array{success:bool,error?:string}
     */
    public function complete_wc_order_from_conekta(WC_Order $order, string $conekta_order_id): array {
        try {
            // Guard against applying the same paid Conekta order to more than
            // one WooCommerce order. On classic checkout the customer can
            // resubmit (double-click on "Place order", AJAX timeout, browser
            // retry) while the hidden conekta_order_id stays the same; WooCommerce
            // then creates a second order. Without this check the single Conekta
            // payment would complete BOTH WC orders (1 Conekta order -> 2 paid
            // WC orders). The conekta-order-id meta is the unique link Conekta
            // webhooks already rely on via find_order_for_webhook().
            $duplicate = $this->find_existing_order_for_conekta_id($conekta_order_id, $order->get_id());
            if ($duplicate) {
                error_log(sprintf(
                    'Conekta - complete_wc_order_from_conekta: DUPLICATE — Conekta order %s already applied to WC order #%d (current WC order #%d)',
                    $conekta_order_id,
                    $duplicate->get_id(),
                    $order->get_id()
                ));
                return [
                    'success'        => false,
                    'duplicate'      => true,
                    'existing_order' => $duplicate,
                    'error'          => sprintf(
                        'La orden de Conekta %s ya fue aplicada al pedido #%d',
                        $conekta_order_id,
                        $duplicate->get_id()
                    ),
                ];
            }

            self::update_conekta_order_meta($order, $conekta_order_id, 'conekta-order-id');

            $api           = $this->get_api_instance($this->settings['cards_api_key'], $this->version);
            $conekta_order = $api->getOrderById($conekta_order_id, 'es', null, self::API_CLIENT);

            // Best-effort reverse trace: stamp the WooCommerce order id onto
            // each card_payment charge (reference_id) so a Conekta charge can be
            // traced back to its WC order from the Conekta dashboard. Classic
            // can't set the order-level reference_id (no WC order exists at
            // create time), so the charge-level one is the only Conekta->Woo
            // link there. Never throws — failure here must not block the
            // completion flow.
            $this->tag_card_charges_with_wc_order($order, $conekta_order);

            if ($conekta_order->getPaymentStatus() !== 'paid') {
                error_log(sprintf(
                    'Conekta - complete_wc_order_from_conekta: NOT PAID — Conekta order %s status "%s" (WC order #%d)',
                    $conekta_order_id,
                    $conekta_order->getPaymentStatus(),
                    $order->get_id()
                ));
                return [
                    'success' => false,
                    'error'   => sprintf('Conekta order is not paid (status: %s)', $conekta_order->getPaymentStatus()),
                ];
            }

            $expected_amount = (int) round($order->get_total() * 100);
            $actual_amount   = (int) $conekta_order->getAmount();
            if ($expected_amount !== $actual_amount) {
                error_log(sprintf(
                    'Conekta - complete_wc_order_from_conekta: AMOUNT MISMATCH — WC order #%d expects %d cents, Conekta order %s charged %d cents',
                    $order->get_id(),
                    $expected_amount,
                    $conekta_order_id,
                    $actual_amount
                ));
                return [
                    'success' => false,
                    'error'   => sprintf(
                        'Amount mismatch: WooCommerce expects %d cents, Conekta charged %d cents',
                        $expected_amount,
                        $actual_amount
                    ),
                ];
            }

            $order->payment_complete($conekta_order_id);
            $order->add_order_note(sprintf(__('Pago confirmado con Conekta (orden %s)', 'woocommerce'), $conekta_order_id));

            WC_Conekta_REST_API::clear_session();

            return ['success' => true];
        } catch (\Exception $e) {
            error_log('Conekta - complete_wc_order_from_conekta: ' . $e->getMessage());
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    /**
     * Stamp the WooCommerce order id as reference_id on every card_payment
     * charge of the Conekta order, via PUT /charges/{id} (updateCharge). Gives
     * the merchant a Conekta->WooCommerce back-reference visible on the Conekta
     * dashboard — the only such link for classic checkout, where the order-level
     * reference_id can't be set at create time.
     *
     * Strictly best-effort: every error is swallowed (logged) so a failed PUT
     * never blocks order completion. The card was already charged; tracing is
     * a nice-to-have, not a gate.
     *
     * @param mixed $conekta_order OrderResponse returned by getOrderById.
     */
    protected function tag_card_charges_with_wc_order(WC_Order $order, $conekta_order): void {
        try {
            $charges = $conekta_order->getCharges();
            $data    = $charges ? $charges->getData() : null;
            if (!is_iterable($data)) {
                return;
            }

            $charges_api = $this->get_charges_api_instance($this->settings['cards_api_key'], $this->version);
            $reference   = (string) $order->get_id();

            foreach ($data as $charge) {
                $payment_method = $charge->getPaymentMethod();
                if (!$payment_method || $payment_method->getObject() !== 'card_payment') {
                    continue;
                }

                $charge_id = $charge->getId();
                if (empty($charge_id)) {
                    continue;
                }

                try {
                    $charges_api->updateCharge($charge_id, new ChargeUpdateRequest(['reference_id' => $reference]));
                } catch (\Throwable $e) {
                    error_log(sprintf(
                        'Conekta - tag_card_charges_with_wc_order: updateCharge failed for charge %s (WC order #%d): %s',
                        $charge_id,
                        $order->get_id(),
                        $e->getMessage()
                    ));
                }
            }
        } catch (\Throwable $e) {
            error_log('Conekta - tag_card_charges_with_wc_order: ' . $e->getMessage());
        }
    }

    /**
     * Look up a PAID WooCommerce order (other than $exclude_order_id) that
     * already holds the given conekta-order-id meta. Used to stop a single
     * paid Conekta order from completing more than one WC order.
     *
     * Only processing/completed orders count as duplicates: under the
     * order-first flow the meta is stamped BEFORE the charge, so a pending
     * order sharing the meta is a normal retry leftover (e.g. the customer
     * changed the cart between attempts), not a double payment.
     *
     * @return WC_Order|false
     */
    protected function find_existing_order_for_conekta_id(string $conekta_order_id, int $exclude_order_id) {
        $orders = wc_get_orders([
            'meta_key'   => 'conekta-order-id',
            'meta_value' => $conekta_order_id,
            'exclude'    => [$exclude_order_id],
            'limit'      => 10,
        ]);

        foreach ($orders as $candidate) {
            if (in_array($candidate->get_status(), ['processing', 'completed'], true)) {
                return $candidate;
            }
        }

        return false;
    }

    /**
     * Cancel the duplicate WC order created by a resubmission. WooCommerce
     * creates the order BEFORE calling the gateway, so we can't stop it from
     * being created — but once the guard confirms the Conekta payment already
     * belongs to another order, we cancel this one so it doesn't linger as
     * "Pending payment" next to the real paid order.
     */
    protected function cancel_duplicate_order(WC_Order $order, WC_Order $existing): void {
        if (in_array($order->get_status(), ['cancelled', 'processing', 'completed'], true)) {
            return;
        }
        $order->update_status(
            'cancelled',
            sprintf(
                __('Pedido duplicado: la orden de Conekta ya se aplicó al pedido #%d.', 'woocommerce'),
                $existing->get_id()
            )
        );
    }

    /**
     * @throws Exception
     */
    public function process_payment_api($context, $result) {
        $order = $context->order;

        // Diagnostic: blocks charges the card (Conekta SDK) BEFORE the Store API
        // /checkout call that reaches this handler, so if we bail here — or never
        // get called at all — the customer can end up paid with the WC order
        // stuck as checkout-draft. Log entry + every early return so the failure
        // reason is visible in debug.log. The ABSENCE of this "entry" line for a
        // paid Conekta order means the Store API /checkout never reached the
        // gateway (customer abandoned after the charge / request never completed).
        $conekta_order_id = isset($context->payment_data['conekta_order_id']) ? sanitize_text_field($context->payment_data['conekta_order_id']) : '';
        error_log(sprintf(
            'Conekta - process_payment_api (blocks): ENTRY WC order #%s, payment_method "%s", conekta_order_id "%s"',
            $order ? $order->get_id() : 'null',
            $context->payment_method,
            $conekta_order_id
        ));

        if ($context->payment_method !== $this->id) {
            error_log(sprintf(
                'Conekta - process_payment_api (blocks): SKIP — payment_method "%s" is not "%s" (WC order #%s)',
                $context->payment_method,
                $this->id,
                $order ? $order->get_id() : 'null'
            ));
            return;
        }

        if (empty($conekta_order_id)) {
            // The card may already be charged: the SDK emitted onFinalizePayment
            // but conekta_order_id never reached payment_data — WC order left unpaid.
            error_log(sprintf(
                'Conekta - process_payment_api (blocks): MISSING conekta_order_id on WC order #%s — card may be charged with no linked order',
                $order ? $order->get_id() : 'null'
            ));
            $result->set_status('failure');
            $result->set_payment_details(array_merge($result->payment_details, [
                'error' => __('Falta la orden de Conekta. Vuelve a intentar el pago.', 'woocommerce'),
            ]));
            wc_add_notice(__('Error: Falta la orden de Conekta.', 'woocommerce'), 'error');
            return;
        }

        $outcome = $this->complete_wc_order_from_conekta($order, $conekta_order_id);

        if ($outcome['success']) {
            $result->set_status('success');
            $result->set_redirect_url($this->get_return_url($order));
        } elseif (!empty($outcome['duplicate']) && !empty($outcome['existing_order'])) {
            // The Conekta payment already completed another WC order; cancel
            // this duplicate so it doesn't linger as pending, and send the
            // customer to the order that was actually paid.
            $this->cancel_duplicate_order($order, $outcome['existing_order']);
            $result->set_status('success');
            $result->set_redirect_url($this->get_return_url($outcome['existing_order']));
        } else {
            error_log(sprintf(
                'Conekta - process_payment_api (blocks): FAILED for WC order #%s (Conekta order %s): %s',
                $order ? $order->get_id() : 'null',
                $conekta_order_id,
                $outcome['error'] ?? 'unknown'
            ));
            wc_add_notice(__('Error: ', 'woothemes') . ($outcome['error'] ?? 'unknown'), 'error');
            WC()->session->reload_checkout = true;

            $result->set_status('failure');
            $result->set_payment_details(array_merge($result->payment_details, [
                'error' => $outcome['error'] ?? 'unknown',
            ]));
        }
    }

    /**
     * Checks if woocommerce has enabled available currencies for plugin
     *
     * @access public
     * @return bool
     */
    public function ckpg_validate_currency(): bool
    {
        return in_array(get_woocommerce_currency(), $this->currencies);
    }

    /**
     * Hide the card gateway on the order-pay endpoint. Under the order-first
     * flow pending orders are common (created before the charge), and My
     * Account shows them a "Pay" button — but the checkout JS/iframe only
     * binds to the main checkout form, so order-pay would render a dead
     * payment box. Customers retry from the normal checkout instead (their
     * cart is only cleared on the thank-you page).
     */
    public function is_available() {
        if (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-pay')) {
            return false;
        }
        return parent::is_available();
    }

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);

        // Order-first flow: the WC order now exists BEFORE any charge. Prepare
        // the Conekta order (real customer data + reference_id), leave the WC
        // order pending and tell the JS to fire the SDK charge. WooCommerce
        // keeps `order_awaiting_payment` in the session, so a retry after a
        // decline reuses this same WC order instead of creating a duplicate.
        //
        // The Conekta order id is resolved from the server-side state first,
        // with the posted hidden field as fallback. The fallback matters:
        // when a guest ticks "create an account" WooCommerce logs them in
        // MID-REQUEST (process_customer), the session customer id changes,
        // and the transient written under the guest key is no longer visible
        // — without the fallback every guest-with-account checkout would die
        // here. The id is never trusted on its own: everything below goes
        // through a live GET against the Conekta API.
        $state            = WC_Conekta_REST_API::state_get();
        $conekta_order_id = isset($state['order_id']) ? (string) $state['order_id'] : '';
        if ($conekta_order_id === '' && !empty($_POST['conekta_order_id'])) {
            $conekta_order_id = sanitize_text_field($_POST['conekta_order_id']);
        }

        error_log(sprintf(
            'Conekta - process_payment (classic, order-first): WC order #%d, conekta_order_id "%s"',
            $order_id,
            $conekta_order_id
        ));

        if (empty($conekta_order_id)) {
            wc_add_notice(__('No se encontró el formulario de pago de Conekta. Recarga la página e intenta de nuevo.', 'woocommerce'), 'error');
            return ['result' => 'failure'];
        }

        // One paid Conekta order must never complete two WC orders. Checked
        // BEFORE any API call so the guard also protects resubmissions when
        // the API is unreachable.
        $duplicate = $this->find_existing_order_for_conekta_id($conekta_order_id, (int) $order_id);
        if ($duplicate) {
            $this->cancel_duplicate_order($order, $duplicate);
            return [
                'result'   => 'success',
                'redirect' => $this->get_return_url($duplicate),
            ];
        }

        try {
            $api           = $this->get_api_instance($this->settings['cards_api_key'], $this->version);
            $conekta_order = $api->getOrderById($conekta_order_id, 'es', null, self::API_CLIENT);

            // Branch on the REAL payment status, not on how the id arrived:
            //  - paid + wallet (Apple/Google Pay charged inside the iframe,
            //    no place-order click) -> complete now, post-charge style.
            //  - paid + resubmit (a previous charge succeeded but the confirm
            //    call never landed) -> same: complete, never charge again.
            //  - unpaid -> order-first: prepare and let the JS fire the charge.
            if ($conekta_order->getPaymentStatus() === 'paid') {
                return $this->finish_post_charge_payment($order, $conekta_order_id);
            }

            // Hard gate: the iframe charges whatever amount the Conekta order
            // holds, so it MUST match the WC order the customer just placed.
            // A mismatch means the cart changed after the last sync (e.g. a
            // coupon in another tab) — refuse and let the JS remount.
            $expected_amount = (int) round($order->get_total() * 100);
            $actual_amount   = (int) $conekta_order->getAmount();
            if ($expected_amount !== $actual_amount) {
                error_log(sprintf(
                    'Conekta - process_payment (classic, order-first): AMOUNT MISMATCH pre-charge — WC order #%d expects %d cents, Conekta order %s holds %d cents',
                    $order_id,
                    $expected_amount,
                    $conekta_order_id,
                    $actual_amount
                ));
                wc_add_notice(__('El total del pedido cambió. Revisa el formulario de pago e intenta de nuevo.', 'woocommerce'), 'error');
                return ['result' => 'failure'];
            }

            // Pre-charge PUT: stamp the WC order id (reference_id) and the REAL
            // customer data from the just-created WC order onto the Conekta
            // order. This is the last moment it's mutable (paid orders reject
            // updates) and it's what kills both recurring complaints: the
            // webhook can always find the WC order, and no paid Conekta order
            // ever keeps the 'Cliente'/'Pendiente' placeholders.
            $update = new OrderUpdate([]);
            $update->setMetadata(WC_Conekta_REST_API::build_conekta_metadata($this, 'classic', $order_id));
            $update->setCustomerInfo(new OrderUpdateCustomerInfo($this->customer_info_from_order($order)));
            $shipping_contact = $this->shipping_contact_from_order($order);
            if (!empty($shipping_contact)) {
                $update->setShippingContact(new CustomerShippingContactsRequest($shipping_contact));
            }
            $api->updateOrder($conekta_order_id, $update, $this->get_user_locale());

            self::update_conekta_order_meta($order, $conekta_order_id, 'conekta-order-id');
            $order->update_status('pending');
            $order->add_order_note(sprintf(__('Pedido creado, esperando el cobro con Conekta (orden %s).', 'woocommerce'), $conekta_order_id));

            return [
                'result'                  => 'success',
                'conekta_pending_payment' => true,
                'conekta_order_id'        => $conekta_order_id,
                'order_key'               => $order->get_order_key(),
                // Fallback for the non-AJAX branch of process_checkout (JS
                // disabled/unavailable): WC would wp_redirect() this. The
                // order-received page then shows the order as pending payment
                // — safe, nothing was charged.
                'redirect'                => $this->get_return_url($order),
            ];
        } catch (\Exception $e) {
            error_log(sprintf(
                'Conekta - process_payment (classic, order-first): FAILED preparing WC order #%d (Conekta order %s): %s',
                $order_id,
                $conekta_order_id,
                $e->getMessage()
            ));
            wc_add_notice(__('Error al preparar el pago con Conekta: ', 'woocommerce') . $e->getMessage(), 'error');
            return ['result' => 'failure'];
        }
    }

    /**
     * Complete a WC order whose Conekta order is ALREADY charged: the wallet
     * path (hidden conekta_order_id in POST) and the resubmit-after-paid
     * recovery. This is the old post-charge process_payment body.
     */
    protected function finish_post_charge_payment(WC_Order $order, string $conekta_order_id): array {
        $outcome = $this->complete_wc_order_from_conekta($order, $conekta_order_id);

        if ($outcome['success']) {
            return [
                'result'   => 'success',
                'redirect' => $this->get_return_url($order),
            ];
        }

        if (!empty($outcome['duplicate']) && !empty($outcome['existing_order'])) {
            // Resubmission created a second WC order for an already-paid Conekta
            // order. Cancel this duplicate so it doesn't linger as pending, and
            // redirect to the order that was actually paid.
            $this->cancel_duplicate_order($order, $outcome['existing_order']);
            return [
                'result'   => 'success',
                'redirect' => $this->get_return_url($outcome['existing_order']),
            ];
        }

        error_log(sprintf(
            'Conekta - process_payment (classic, post-charge): FAILED for WC order #%d (Conekta order %s): %s',
            $order->get_id(),
            $conekta_order_id,
            $outcome['error'] ?? 'unknown'
        ));
        wc_add_notice(__('Error al procesar el pago con Conekta: ', 'woocommerce') . ($outcome['error'] ?? 'unknown'), 'error');
        return ['result' => 'failure'];
    }

    /**
     * customer_info payload built from the placed WC order — the authoritative
     * source of the shopper's real name/phone/email (unlike the early cart
     * snapshot, which may still hold the 'Cliente' placeholders).
     */
    public function customer_info_from_order(WC_Order $order): array {
        $name  = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        $phone = $order->get_billing_phone() ?: $order->get_shipping_phone();

        return [
            'email' => $order->get_billing_email(),
            'name'  => $name !== '' ? $name : WC_Conekta_REST_API::DEFAULT_CUSTOMER_NAME,
            'phone' => $phone ?: WC_Conekta_REST_API::DEFAULT_PHONE,
        ];
    }

    /**
     * shipping_contact payload built from the placed WC order. Shipping block
     * wins when the customer filled it; billing otherwise. Returns [] when the
     * order has no usable address (virtual orders) so callers skip the field.
     */
    public function shipping_contact_from_order(WC_Order $order): array {
        $use_shipping = trim((string) $order->get_shipping_address_1()) !== '';
        $prefix       = $use_shipping ? 'shipping' : 'billing';

        $get = function (string $field) use ($order, $prefix): string {
            $getter = "get_{$prefix}_{$field}";
            return trim((string) $order->{$getter}());
        };

        $address1 = $get('address_1');
        $address2 = $get('address_2');
        $postcode = $get('postcode');
        if ($address1 === '' || $postcode === '') {
            return [];
        }

        $receiver = trim($get('first_name') . ' ' . $get('last_name'));
        if ($receiver === '') {
            $receiver = trim($order->get_billing_first_name() . ' ' . $order->get_billing_last_name());
        }
        $phone = $order->get_billing_phone() ?: $order->get_shipping_phone();

        return [
            'phone'    => $phone ?: WC_Conekta_REST_API::DEFAULT_PHONE,
            'receiver' => $receiver !== '' ? $receiver : WC_Conekta_REST_API::DEFAULT_CUSTOMER_NAME,
            'address'  => [
                'street1'     => ckpg_pad_street1($address1),
                // ALWAYS a string — Conekta accepts '' but rejects null.
                'street2'     => $address2,
                'city'        => ckpg_default_if_blank($get('city') ?: $order->get_billing_city()),
                'state'       => $get('state'),
                'country'     => $get('country') ?: 'MX',
                'postal_code' => $postcode,
            ],
        ];
    }
}

function ckpg_conekta_add_gateway($methods)
{
    $methods[] = 'WC_Conekta_Gateway';
    return $methods;
}

add_filter('woocommerce_payment_gateways', 'ckpg_conekta_add_gateway');
add_action('woocommerce_blocks_loaded', 'woocommerce_gateway_conekta_woocommerce_block_support');

function woocommerce_gateway_conekta_woocommerce_block_support()
{
    if (class_exists('Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType')) {
        require_once 'includes/blocks/class-wc-conekta-payments-blocks.php';
        add_action(
            'woocommerce_blocks_payment_method_type_registration',
            function (Automattic\WooCommerce\Blocks\Payments\PaymentMethodRegistry $payment_method_registry) {
                $payment_method_registry->register(new WC_Gateway_Conekta_Blocks_Support());
            }
        );
    }
}
