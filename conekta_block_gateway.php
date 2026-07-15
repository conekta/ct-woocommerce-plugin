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

        // Diagnostic: classic checkout charges the card (Conekta SDK) BEFORE
        // posting wc-ajax=checkout, so if WooCommerce rejects that submit during
        // validation the customer ends up paid with no WC order — and today that
        // rejection leaves no trace in the plugin logs. This listener records the
        // validation errors ONLY for the post-charge submit (the hidden
        // conekta_order_id is empty during the pre-charge validate-only call, so
        // this never fires there). PHP_INT_MAX so we observe every other
        // validator's errors.
        add_action('woocommerce_after_checkout_validation', [$this, 'log_post_charge_validation_errors'], PHP_INT_MAX, 2);
    }

    /**
     * Log WooCommerce validation errors that would block the post-charge
     * wc-ajax=checkout submit (classic). Fires only when conekta_order_id is
     * already set in the request — i.e. the card was charged and WC is about to
     * refuse to create the order. Read-only: never alters the errors object.
     *
     * @param array    $data   Posted checkout data (unused).
     * @param WP_Error $errors Accumulated validation errors.
     */
    public function log_post_charge_validation_errors($data, $errors): void {
        if (empty($_POST['conekta_order_id'])) {
            return;
        }
        if (!is_wp_error($errors) || !$errors->has_errors()) {
            return;
        }

        $conekta_order_id = sanitize_text_field((string) $_POST['conekta_order_id']);
        $messages = [];
        foreach ($errors->get_error_codes() as $code) {
            foreach ($errors->get_error_messages($code) as $msg) {
                $messages[] = $code . ': ' . wp_strip_all_tags($msg);
            }
        }

        error_log(sprintf(
            'Conekta - POST-CHARGE checkout validation FAILED (Conekta order %s already paid, WC order will NOT be created): %s',
            $conekta_order_id,
            implode(' | ', $messages)
        ));
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
     * the WooCommerce order. Shared between blocks (process_payment_api) and
     * classic (process_payment).
     *
     * @return array{success:bool,error?:string}
     */
    protected function complete_wc_order_from_conekta(WC_Order $order, string $conekta_order_id): array {
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
     * Look up a WooCommerce order (other than $exclude_order_id) that already
     * holds the given conekta-order-id meta. Used to stop a single paid Conekta
     * order from completing more than one WC order.
     *
     * @return WC_Order|false
     */
    protected function find_existing_order_for_conekta_id(string $conekta_order_id, int $exclude_order_id) {
        $orders = wc_get_orders([
            'meta_key'   => 'conekta-order-id',
            'meta_value' => $conekta_order_id,
            'exclude'    => [$exclude_order_id],
            'limit'      => 1,
        ]);

        return !empty($orders) ? $orders[0] : false;
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

    public function process_payment($order_id) {
        $order = wc_get_order($order_id);

        $conekta_order_id = isset($_POST['conekta_order_id']) ? sanitize_text_field($_POST['conekta_order_id']) : '';

        error_log(sprintf(
            'Conekta - process_payment (classic): WC order #%d, conekta_order_id "%s"',
            $order_id,
            $conekta_order_id
        ));

        if (empty($conekta_order_id)) {
            // The card may already be charged on the Conekta side: the SDK
            // emits onOrder, the JS posts wc-ajax=checkout, and if the hidden
            // conekta_order_id field didn't reach the server the WC order is
            // created but left unpaid. Logged so this surfaces in debug.log.
            error_log(sprintf(
                'Conekta - process_payment (classic): MISSING conekta_order_id on WC order #%d — card may be charged with no linked order',
                $order_id
            ));
            wc_add_notice(__('Error: Falta la orden de Conekta.', 'woocommerce'), 'error');
            return ['result' => 'failure'];
        }

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
            'Conekta - process_payment (classic): FAILED for WC order #%d (Conekta order %s): %s',
            $order_id,
            $conekta_order_id,
            $outcome['error'] ?? 'unknown'
        ));
        wc_add_notice(__('Error al procesar el pago con Conekta: ', 'woocommerce') . ($outcome['error'] ?? 'unknown'), 'error');
        return ['result' => 'failure'];
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
