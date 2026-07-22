<?php
/**
 * Conekta reconciler: heals WooCommerce<->Conekta desyncs without relying on
 * webhooks. Many of the "paid in Conekta but nothing in WooCommerce" reports
 * come from stores whose webhook URL is broken, blocked or never configured —
 * this Action Scheduler job polls the Conekta API directly, so the desync
 * gets fixed even when no webhook ever arrives.
 *
 * Every ~15 minutes it takes the recent WC orders that are still waiting for
 * a payment resolution (pending / failed / checkout-draft) AND are linked to
 * a Conekta order (conekta-order-id meta, stamped pre-charge by the
 * order-first flow and by the Blocks draft linker), asks Conekta for their
 * real payment status, and:
 *   - paid    -> completes the WC order (mark_order_paid handles the
 *                checkout-draft promotion)
 *   - expired/canceled -> cancels the WC order
 *   - pending -> leaves it alone (customer may still be mid-payment)
 */

if (!defined('ABSPATH')) {
    exit;
}

class WC_Conekta_Reconciler {

    const HOOK           = 'conekta_reconcile_pending_orders';
    const GROUP          = 'conekta';
    const INTERVAL       = 15 * MINUTE_IN_SECONDS;
    const LOOKBACK_HOURS = 48;
    const BATCH_LIMIT    = 25;

    public static function init(): void {
        add_action('init', [self::class, 'schedule']);
        add_action(self::HOOK, [self::class, 'run']);
    }

    /**
     * Idempotent scheduling: Action Scheduler ships with WooCommerce, and
     * as_next_scheduled_action() lets us avoid stacking duplicates.
     */
    public static function schedule(): void {
        if (!function_exists('as_schedule_recurring_action') || !function_exists('as_next_scheduled_action')) {
            return;
        }
        if (false === as_next_scheduled_action(self::HOOK)) {
            as_schedule_recurring_action(time() + self::INTERVAL, self::INTERVAL, self::HOOK, [], self::GROUP);
        }
    }

    public static function run(): void {
        $gateway = self::get_gateway();
        if (!$gateway || empty($gateway->settings['cards_api_key'])) {
            return;
        }

        $orders = wc_get_orders([
            'status'        => ['pending', 'failed', 'checkout-draft'],
            'meta_key'      => 'conekta-order-id',
            'meta_compare'  => 'EXISTS',
            'date_modified' => '>' . (time() - self::LOOKBACK_HOURS * HOUR_IN_SECONDS),
            'limit'         => self::BATCH_LIMIT,
        ]);

        foreach ($orders as $order) {
            self::reconcile_order($gateway, $order);
        }
    }

    /**
     * @param WC_Conekta_Gateway $gateway
     * @param WC_Order           $order
     */
    public static function reconcile_order($gateway, $order): void {
        $conekta_order_id = (string) $order->get_meta('conekta-order-id');
        if ($conekta_order_id === '') {
            return;
        }

        try {
            $api           = $gateway->get_api_instance($gateway->settings['cards_api_key'], $gateway->version);
            $conekta_order = $api->getOrderById($conekta_order_id, 'es', null, WC_Conekta_Plugin::API_CLIENT);
            $status        = $conekta_order->getPaymentStatus();

            if ($status === 'paid') {
                // One Conekta payment must never complete two WC orders: a
                // cart-changed retry can leave an older pending order carrying
                // the same conekta-order-id as the order that actually got
                // paid. If the payment already landed elsewhere, cancel this
                // leftover instead of completing it.
                $winner = wc_get_orders([
                    'meta_key'   => 'conekta-order-id',
                    'meta_value' => $conekta_order_id,
                    'exclude'    => [$order->get_id()],
                    'status'     => ['processing', 'completed'],
                    'limit'      => 1,
                ]);
                if (!empty($winner)) {
                    $order->update_status('cancelled', sprintf(
                        'Conekta (reconciliador): pago %s ya aplicado al pedido #%d — se cancela este duplicado.',
                        $conekta_order_id,
                        $winner[0]->get_id()
                    ));
                    return;
                }

                $expected_amount = (int) round($order->get_total() * 100);
                $actual_amount   = (int) $conekta_order->getAmount();
                if ($expected_amount !== $actual_amount) {
                    error_log(sprintf(
                        'Conekta - reconciler: AMOUNT MISMATCH — WC order #%d expects %d cents, Conekta order %s paid %d cents; leaving for manual review',
                        $order->get_id(),
                        $expected_amount,
                        $conekta_order_id,
                        $actual_amount
                    ));
                    $order->add_order_note(sprintf(
                        'Conekta (reconciliador): la orden %s está pagada pero el monto no coincide (esperado %d, pagado %d centavos). Revisar manualmente.',
                        $conekta_order_id,
                        $expected_amount,
                        $actual_amount
                    ));
                    return;
                }

                WC_Conekta_Plugin::mark_order_paid($order, $conekta_order_id, sprintf(
                    'Pago confirmado por el reconciliador de Conekta (orden %s) — el webhook o la confirmación en línea no llegaron.',
                    $conekta_order_id
                ));
                return;
            }

            if (in_array($status, ['expired', 'canceled'], true)
                && !in_array($order->get_status(), ['processing', 'completed', 'cancelled'], true)
            ) {
                $order->update_status('cancelled', sprintf(
                    'Conekta (reconciliador): la orden %s expiró o fue cancelada en Conekta.',
                    $conekta_order_id
                ));
            }
        } catch (\Throwable $e) {
            error_log(sprintf(
                'Conekta - reconciler: failed for WC order #%d (Conekta order %s): %s',
                $order->get_id(),
                $conekta_order_id,
                $e->getMessage()
            ));
        }
    }

    /**
     * @return WC_Conekta_Gateway|null
     */
    private static function get_gateway() {
        if (!function_exists('WC') || !WC()->payment_gateways) {
            return null;
        }
        $gateways = WC()->payment_gateways->payment_gateways();
        return $gateways['conekta'] ?? null;
    }
}

WC_Conekta_Reconciler::init();
