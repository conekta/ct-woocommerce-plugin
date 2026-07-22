## [6.1.0]() - 2026-07-21
- Change: **order-first card checkout (classic)**. The flow is inverted: "Place order" posts `wc-ajax=checkout` FIRST (WooCommerce validates and creates the order as `pending`), then `process_payment` verifies the Conekta order amount, PUTs `metadata.reference_id` + the REAL `customer_info`/`shipping_contact` from the placed order onto the (still unpaid) Conekta order, stamps `conekta-order-id` meta, and returns `conekta_pending_payment` — only then does the JS fire the SDK charge (3DS included). A new `wc_ajax_conekta_confirm_order` endpoint completes the order after `onFinalizePayment` (reusing `complete_wc_order_from_conekta`: paid check, amount check, duplicate guard). Structural guarantee: a card can never be charged for an order WooCommerce refused or failed to create — the two recurring complaints ("paid in Conekta, no order in Woo" and placeholder `Cliente`/`Pendiente` data on paid Conekta orders) become impossible on the card path. Declines/retries reuse the same WC order via WooCommerce's `order_awaiting_payment`; a resubmit whose Conekta order is already paid is completed without recharging. The pre-charge validate-only endpoint, the FormData snapshot machinery and the post-charge validation logger are removed (WC validation now runs naturally before any money moves). The post-charge submit path remains ONLY for wallets (Apple/Google Pay), which charge inside the iframe without a place-order click.
- Fix: `order.paid` webhooks for Blocks orders stuck in `checkout-draft` now complete correctly. `payment_complete()` is a silent no-op for drafts (not in `woocommerce_valid_order_statuses_for_payment_complete`), so the paid order stayed an invisible draft — the new `WC_Conekta_Plugin::mark_order_paid()` promotes the draft to `pending` (setting the payment method if missing) before completing. Blocks also gained a pre-charge gate: `onPaymentSetup` re-POSTs `checkout-request` right before `orderEmitter.submit()` so the draft↔Conekta two-way link and the amount are guaranteed current, refusing to charge against a stale `checkout_request_id`.
- Feature: last-resort order creation. An `order.paid` webhook that finds NO WooCommerce order now creates one from the Conekta payload (status pending → completed via `mark_order_paid`, real products resolved through the new `product_id` metadata stamped on every line item by `build_snapshot`, shipping/discount lines and customer/address carried over, total forced to the charged amount, prominent review note). Replaces the 404 + diagnostic beacon as the first response; the beacon remains as fallback if creation fails.
- Hardening (adversarial design review): (1) guest-creates-account no longer breaks checkout — WooCommerce rotates the session mid-request, orphaning the server-side state, so the JS also posts the mounted Conekta order id as a fallback and `process_payment` branches on the order's REAL paid status (never on how the id arrived); this same branch is what completes wallet payments and resubmits-after-paid without recharging. (2) The duplicate guard (`find_existing_order_for_conekta_id`) now only counts processing/completed orders — under order-first, a pending order sharing the `conekta-order-id` meta is a legitimate retry leftover, not a double payment. (3) `order.expired/canceled` webhooks only cancel a WC order when the event's Conekta id matches the order's CURRENT `conekta-order-id` meta — a stale Conekta order (checkout reloaded, WC order reused) can no longer cancel a live checkout. (4) The Blocks pre-charge gate fails closed on ANY server-side mutation (`mode !== 'unchanged'`), remounting instead of charging against an unverified state. (5) The card gateway is hidden on the order-pay endpoint (pending orders are common now and the iframe only binds to the main checkout form). (6) The webhook's last-resort order creation takes a short lock so concurrent retries can't create two orders, and `charges.data[0]` access is guarded.
- Fix: the card path now sends `shipping_contact.address.street2` (colonia / interior — WooCommerce's address line 2) to Conekta, matching what the cash/SPEI gateways already did. Sent on order create, the sync updates, the pre-charge PUT and rebuilt into orders created from webhooks. Always a string (Conekta accepts `''` but rejects `null`), and sent even when empty so removing the colonia on an address edit actually clears it. address_2 also joined the Blocks/classic change-detection fingerprints so a colonia-only edit re-syncs the Conekta order.
- Tests: new JS suite for the order-first flow (checkout POST precedes the charge, charge only on `conekta_pending_payment`, confirm + redirect, WC validation failure ⇒ never charged, wallet legacy path, confirm-failure keeps the pending order). New PHP tests for `mark_order_paid` (draft promotion, idempotency, payment-method preservation) and the pre-charge payload builders. 67 JS + 204 PHP tests pass. E2e pending: run `npm run test:e2e` after deploying to the staging store.

## [6.0.7]() - 2026-07-03
- Fix: the card checkout no longer 422s with "Invalid format for shipping_contact attribute address attribute city". Two independent causes, both closed: (1) an EMPTY city was being sent — `resolve_address_source` picks the shipping/billing block by its street and only fell back name/phone to the other block, so a chosen block with a street but no city produced `city => ''`, which Conekta rejects; city now falls back to the other block when the chosen one left it blank (state/country intentionally don't, to avoid pairing a real street with a theme-prefilled stale state). (2) a genuinely odd-but-usable city (or other address field) hard-failed strict validation; `build_snapshot` (card path, classic + Blocks) now stamps `metadata.soft_validations => true` on the `shipping_contact` and `customer_info` so Conekta WARNS instead of rejecting — matching the cash, bank transfer, BNPL and pay-by-bank gateways (`ckpg_build_shipping_contact` / `ckpg_build_customer_info`). Previously both the order update and the recreate failed, leaving the shopper unable to pay.
- Tests: city-fallback coverage in `resolve_address_source`, plus an SDK contract pin that `metadata.soft_validations` survives round-tripping through `CustomerShippingContactsRequest`. 181 unit tests pass.

## [6.0.6]() - 2026-06-30
- Change: line items are now sent to Conekta at the EFFECTIVE unit price the customer pays. The plugin no longer reports the regular price plus a synthesized `dynamic_pricing` discount line for sales or dynamic-pricing plugins — that representation confused merchants and, on tax-inclusive stores, caused the IVA to surface as a phantom `dynamic_pricing` "Descuento" (e.g. a $2,610 item showing -$360). Tax is always itemized in `tax_lines`; real coupons and negative fees remain explicit `discount_lines`. Applies to all order-build paths: `build_snapshot` (card, classic + Blocks) and `ckpg_build_line_items` (cash, bank transfer, BNPL, pay by bank).
- Fix: the order total now matches the WooCommerce total to the cent on every path. `unit_price` is `line_subtotal / quantity` rounded to cents, so `unit_price × quantity` (plus tax rounding) could drift a cent or two. `ckpg_check_balance` now reconciles in BOTH directions without distorting the reported tax: an under-count (charging too little) is added to the tax line, while an over-count (charging too much) becomes a small `round_adjustment` discount line. The card request handler now consumes BOTH the reconciled `tax_lines` AND `discount_lines` (it previously kept the raw discount lines, so the `round_adjustment` never reached Conekta), and `ckpg_check_balance` previously only ever added `abs()` to tax, over-charging when the lines already exceeded the total (affecting cash, bank transfer, BNPL and pay by bank).
- Feature: each Conekta line item carries a `tax_included` metadata flag indicating whether the store enters prices tax-inclusive AND the product is taxable (tax-exempt products report `false`). Added to all payment methods.
- Tests: coverage for effective-price line items (no dynamic_pricing for sales), real coupon/fee discounts preserved, the `tax_included` flag across taxable/exempt products, and `ckpg_check_balance` rounding reconciliation in both directions (over-count → round_adjustment discount, under-count → tax). Plus e2e tax-inclusive card checkouts asserting no dynamic_pricing, IVA in tax_lines, and the charged amount matching the WooCommerce total to the cent. 179 unit tests pass.

## [6.0.5]() - 2026-06-17
- Fix: classic checkout now submits the EXACT form data it validated pre-charge. The JS snapshots the checkout `FormData` at validation time and posts that same snapshot to `wc-ajax=checkout` after the SDK charge, instead of re-reading the form. Prevents a third-party plugin firing `updated_checkout` during the charge window (e.g. a postcode→colonia field repopulator) from mutating a required field and making WooCommerce reject the order after the card was already charged (paid, but no order created). Validation and submit now use the identical FormData object, closing even the validation round-trip gap; covers card and wallet (Apple/Google Pay) paths.

## [6.0.4]() - 2026-06-17
- Fix: classic checkout no longer strands a card payment when the WooCommerce order isn't completed. The `conekta-order-id` meta is now written onto the WC order *before* the paid/amount verification (right after the duplicate guard), so the `order.paid` webhook can always recover the order via `find_order_for_webhook()` and finish it — classic gets the same safety net Blocks already has through the order-level `reference_id` (which classic can't set, as it has no order at create time). Previously a transient failure after `getOrderById` (or any step before completion) left no link and the webhook returned `Order not found`.
- Feature: reverse trace from Conekta to WooCommerce. After fetching the Conekta order, the WC order id is stamped as `reference_id` on every `card_payment` charge via `PUT /charges/{id}` (best-effort; never blocks completion). This is the only Conekta→Woo link for classic checkout.
- Diagnostics: targeted `error_log` traces for the silent failure points — post-charge checkout validation rejections (card charged but WC refuses the order), the `NOT PAID` / `AMOUNT MISMATCH` / `DUPLICATE` branches of order completion, and `process_payment` entry / missing `conekta_order_id`.
- Tests: unit coverage for the charge-tagging (injected `ChargesApi` mock) plus Mockoon-backed integration tests; the `WC_Order` stub now mirrors `payment_complete( $transaction_id = '' )`. 166 tests pass.
- Feature: send the WooCommerce order id as `metadata.reference_id` on the Conekta order for the Blocks checkout. Blocks creates a `checkout-draft` WC order during checkout (and it keeps its id once finalized), so the id is read at `checkout-request` time — the only window, since the Conekta order is already paid (metadata frozen) by the time `process_payment` runs. Classic has no order at that point, so it keeps relying on the reverse `conekta-order-id` order meta.
- Fix: `Undefined array key "instructions"` warning during checkout. Gateways read settings via `get_option()` instead of direct `$this->settings[...]` access, so configs saved before the `instructions` field existed fall back to the field default instead of emitting a PHP warning. Affects the cash, bank-transfer and pay-by-bank gateways.

## [6.0.2]() - 2026-06-09
- Fix: prevent a single paid Conekta order from completing more than one WooCommerce order. On classic/blocks checkout a resubmission (double-click, AJAX timeout, retry) could create a second WC order reusing the same `conekta_order_id`; the gateway now detects the duplicate via the unique `conekta-order-id` meta and redirects to the already-paid order instead of marking the duplicate paid.
- Fix: build the Conekta `shipping_contact` from a single address block. Shipping is used only when the customer actually filled it (keyed on `shipping_address_1`); otherwise billing is used as a whole, avoiding a billing street mixed with a theme-prefilled shipping state/country. The contact phone now follows the same block.

## [6.0.1]() - 2026-06-04
- Security: hardened handling of payment method data on the Blocks checkout.

## [6.0.0]() - 2026-04-27
- BREAKING: Card payments migrated from the `Card` tokenizer SDK component to the `Integration` SDK component (`ConektaCheckoutComponents.Integration`). The Conekta order is now pre-created at iframe-mount time via a new server endpoint and updated on every cart change; `process_payment` no longer creates the order, it only validates the already-paid Conekta order against the WooCommerce total.
- Feature: New endpoint `POST /conekta/v1/checkout-request` (also exposed via WC AJAX action `conekta_checkout_request`) that creates the Conekta Integration order on first call in a WC session and PUTs `line_items`/`discount_lines`/`shipping_lines` on every subsequent call. `customer_info` and `currency` are set once at creation and never updated.
- Feature: Amount-mismatch guard in `process_payment` — fetches the Conekta order, requires `payment_status === 'paid'` AND `conekta_order.amount === wc_total*100` before completing the WC order.
- Feature: MSI passed to Conekta via the Integration checkout config (`monthly_installments_enabled` defaults to `false`; when the merchant enables it, `monthly_installments_options` is sent with the configured plazos).
- Removal: All custom 3DS handling is gone — the Integration SDK runs 3DS internally. Removed the `threeDsHandler`, the custom 3DS iframe, the `create_3ds_order` REST endpoint, the `three_ds_enabled`/`three_ds_mode` gateway properties, and the company API helper used to fetch them.
- Removal: JS no longer scrapes the DOM or ships cart/billing/shipping data. The request body to `/checkout-request` is `{ nonce }`; the server reads `WC()->cart` + `WC()->customer` directly (kept in sync by WooCommerce via `update_order_review` in classic and `wc/store/v1/cart/update-customer` in blocks).
- Removal: Fragment system (`#conekta-cart-data`, `ckpg_build_conekta_cart_snapshot`, `woocommerce_update_order_review_fragments` filter) — no longer needed once the server is the source of truth.
- Removal: `assets/styles.css` (only contained 3DS slide-in/out animations) and the dequeue from `conekta_cash_block_gateway.php`.
- Cleanup: `conekta_settings` localized to classic JS reduced from 11 keys to 5 (`public_key`, `locale`, `checkout_url`, `checkout_request_url`, `nonce`). Blocks `conekta_data` similarly trimmed.
- Cleanup: Token + MSI hidden fields in `payment_fields()` replaced by a single `conekta_order_id` hidden field.
- Compat: WooCommerce Blocks checkout migrated to the same flow — `paymentMethodData` is now `{ conekta_order_id }`.
- Tests: PHPUnit suite trimmed of legacy 3DS/MSI/token tests; 105 tests / 226 assertions pass against the Mockoon sandbox. E2E specs reshaped around the Integration flow (cart-change triggers PUT, paid order completes WC order, amount mismatch rejected).
- Net diff vs 5.4.14: ~ -1000 lines.

## [5.4.15]() - 2026-05-25
- Fix: `ckpg_build_tax_lines` now reads `tax_total`/`shipping_tax_total` from `WC_Order_Item_Tax` objects (WooCommerce 3.0+), so IVA over items and shipping is reported correctly to Conekta instead of being collapsed into a "Round Adjustment" line

## [5.4.14]() - 2026-04-10
- Fix: Webhook `order.paid`/`order.expired` now uses `wc_get_order()` with fallback lookup by `conekta-order-id` meta, fixing HPOS compatibility and 3DS temp order mismatch
- Fix: `validate_reference_id` now rejects empty, non-numeric, zero, and negative values
- Enhancement: Optimized WordPress.org SVN deployment — exclude dev files, add `--delete` for clean sync, use `--no-dev` for composer, and shallow SVN checkout to skip historical tags
- Enhancement: Reduced CI log noise with quiet flags on svn, rsync, and apt-get commands

## [5.4.13]() - 2026-04-10
- Enhancement: Optimize WordPress.org SVN deployment — exclude dev files, add `--delete` for clean sync, use `--no-dev` for composer, and shallow SVN checkout to skip historical tags
- Enhancement: Reduce CI log noise with quiet flags on svn, rsync, and apt-get commands

## [5.4.12]() - 2026-04-10
- Feature: Full support for "Advanced Dynamic Pricing and Discount Rules" plugin and similar dynamic pricing plugins
- Feature: Three discount detection sources for Conekta discount_lines: native WC coupons (`coupon`), fee-based discounts (`campaign`), and price-level discounts (`campaign`)
- Feature: Conekta line_items now use the original `regular_price` as `unit_price`, with the dynamic discount sent separately in `discount_lines` for full visibility
- Fix: 3DS classic checkout now recalculates cart via `WC()->cart->calculate_totals()` so dynamic pricing hooks fire before order creation
- Fix: 3DS order creation uses explicit `subtotal`/`total` from the cart instead of catalog prices, preserving all plugin-applied discounts
- Fix: Cart fees (negative fees from dynamic pricing) are now copied to the 3DS WC order
- Enhancement: New fragment system (`woocommerce_update_order_review_fragments`) keeps JS-side `conekta_settings` in sync after every checkout AJAX refresh
- Enhancement: Classic checkout JS now sends `discount_lines` in the 3DS request and updates cart data from fragments on `updated_checkout`
- Enhancement: Price-level discount detection applied consistently across all 6 payment gateways (card, cash, BNPL, bank transfer, pay by bank, 3DS REST API)
- Tests: 40 PHPUnit tests with 127 assertions covering discount detection, cart snapshots, fee handling, balance verification, and edge cases

## [5.4.11]() - 2026-03-30
- Fix: Resolved fatal error when plugin is activated without API key configured by moving 3DS company fetch inside api_key guard

## [5.4.10]() - 2026-03-27
- Security: Added CSRF protection to the WC AJAX 3DS order endpoint via nonce verification
- Security: Nonce is now generated in PHP and passed to Classic and Blocks checkout scripts, then verified server-side before processing

## [5.4.9]() - 2026-03-25
- Fix: Resolved 404 errors on checkout and 3DS endpoints when WordPress is installed in a subdirectory
- Fix: Replaced hardcoded URLs with dynamic WordPress functions (WC_AJAX::get_endpoint and rest_url) for Classic and Blocks checkout

## [5.4.8]() - 2025-11-25
- Fix: Resolved critical issue where discount_lines were not being sent to Conekta in 3DS orders
- Fix: Coupons now correctly apply to orders created during 3DS authentication flow
- Enhancement: Added automatic coupon detection and application from WooCommerce cart for both Classic and Blocks checkout
- Enhancement: Implemented intelligent fallback mechanism to capture discounts when frontend data is unavailable
- Enhancement: Improved discount handling consistency between WooCommerce Blocks and Classic checkout with 3DS enabled

## [5.4.7]() - 2025-11-12
- Fix: Improved shipping method handling in classic checkout by prioritizing conekta_settings
- Fix: Enhanced fallback logic for label and cost extraction in shipping information
- Enhancement: Added shipping information handling in classic checkout script

## [5.4.6]() - 2025-10-17
- Chore: Re-release of the plugin to address deployment configuration

## [5.4.5]() - 2025-10-15
- Feature: Added BBVA Pay by Bank (Pago Directo) payment method support
- Feature: Automatic device detection for payment redirect (desktop uses web URL, mobile uses deep link)
- Feature: Added order expiration configuration in minutes (10-1440 min) for Pay by Bank
- Enhancement: Automatic payment window opening with intelligent fallback for blocked popups
- Enhancement: Improved user experience with seamless BBVA payment flow

## [5.4.4]() - 2025-10-13
- Fix: Resolved issue where classic checkout was not sending product names correctly in 3DS validation
- Fix: Eliminated 'Temporary 3DS validation' placeholder appearing in classic checkout orders
- Enhancement: Classic checkout now sends real cart item data (product names, quantities, totals) to Conekta API
- Enhancement: Improved cart data handling consistency between WooCommerce Blocks and Classic checkout
- Enhancement: Added fallback mechanism to retrieve cart data from WooCommerce session when not provided

## [5.4.3]() - 2025-09-26
- Fix: Resolved shipping_lines amount not being sent correctly for credit card payments
- Fix: Corrected double conversion to cents issue that caused incorrect shipping amounts
- Enhancement: Improved shipping data capture from both WooCommerce Blocks and Classic checkout
- Enhancement: Added comprehensive shipping method support for credit card payment flows
- Enhancement: Better consistency between payment methods for shipping cost handling

## [5.4.2]() - 2024-09-15
- Enhancement: Updated Conekta PHP SDK to v7.0.5 and refactored to use new SDK methods.

## [5.4.1]() - 2024-09-05
- Fix: Classic checkout now properly supports 3D Secure (3DS) functionality

## [5.4.0]() - 2024-08-28
- Feature: Added 3D Secure (3DS) v2 support for enhanced payment security
- Feature: Improved fraud prevention measures with latest 3DS authentication
- Enhancement: Better compatibility with modern payment security standards

## [5.3.0]() - 2025-08-06
- Fix: WooCommerce Blocks now correctly update payment amount when coupons are applied or removed
- Fix: Monthly installments (MSI) now calculate correctly with discounted totals in Blocks checkout

## [4.0.3]() - 2024-02-13
- Fix status orders, new orders are created with status "pending payment" and not "on-hold"

## [4.0.2]() - 2024-01-24
- Fix error when creating order with empty shipping contact

## [4.0.1]() - 2024-01-23
- Fix error when create charge in php 7.4

## [4.0.0]() - 2024-01-23
- Update conekta-php library
- Checkout Blocks compatibility.
- Updated to the new redirected checkout process: Conekta Component.
- Simplified integration process using one API key for all payment methods.

## [3.7.7]() - 2023-12-05
- fix shipping lines amount

## [3.7.6]() - 2023-11-14
- supports order.expired and order.cancelled for changing order status

## [3.7.5]() - 2023-04-28
- Remove tests on lib conekta

## [3.7.3]() - 2023-04-27
- Fix error when create charge in php 7.4

## [3.7.2]() - 2023-04-24
- Update versions

## [3.7.1]() - 2023-04-18
- Update conekta-php library

## [3.7.0]() - 2022-02-15
- Homogenization with WordPress standards

## [3.0.8]() - 2020-06-19
- Fix problem whit amount in discount_lines

## [3.0.7]() - 2020-05-30
- Fix problem whit amount -1
- Fix problem whit reference oxxo pay

## [3.0.6]() - 2020-01-10
- Fix problem with amount -1

## [3.0.5]() - 2019-08-10
- Updated images for Conekta Payments

## [3.0.4](https://github.com/conekta/conekta-woocommerce/releases/tag/v3.0.4) - 2018-04-11
## Fix 
- Fix for error token already used

## [3.0.3](https://github.com/conekta/conekta-woocommerce/releases/tag/v3.0.3) - 2018-01-10
## Changed
- Update PHP Lib compatible with PHP 7+

## [3.0.2](https://github.com/conekta/conekta-woocommerce/releases/tag/v3.0.2) - 2017-11-30
## Feature
- Custom instructions and description for Oxxo and Spei payment

## Fix
- Order info in email templates

## [3.0.1](https://github.com/conekta/conekta-woocommerce/releases/tag/v3.0.1) - 2017-09-09
## Changed
- Bundle CA Root Certificates

## [3.0.0](https://github.com/conekta/conekta-woocommerce/releases/tag/v3.0.0) - 2017-08-21
## Feature
- Compatibility with WooCommerce 3
- Correction in access to order properties

## Notes
If you have WooCommerce 2.x, you can view this branch with the latest stable version [2.0.14](https://github.com/conekta/conekta-woocommerce/tree/feature/woocommerce-2)

## [2.0.14](https://github.com/conekta/conekta-woocommerce/releases/tag/v2.0.14) - 2017-08-03
### Fix
- HotFix include email in order
- Error typo OXOO 

### Changed
- Bundle CA Root Certificates
- Update PHP Library


## [2.0.13](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.13) - 2017-07-13
### Feature
- Name the SPEI account owner in admin input section
- New marketplace review validations

## [2.0.12](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.12) - 2017-04-30
### Fix
- Send only integer values for round adjustment
### Feature
-Send current plugin version for line items tag

## [2.0.11](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.11) - 2017-03-16
###  Fix
-Fix for conflict with other plugins in checkout "`token_id` is required"

## [2.0.10](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.10) - 2017-03-16
### Fix
- Fix monthly installments

## [2.0.9](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.9) - 2017-03-10
### Fix
- Merge pull request #41 from conekta/fix/adjustment-description

## [2.0.8](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.8) - 2017-02-28
### Change
- Change name of translation inside comment

## [2.0.7](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.7) - 2017-02-28
### Fix
- Fix sku less than 0 characters

## [2.0.6](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.6) - 2017-02-28
### Fix
- Fix shipping for card and spei

## [2.0.5](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.5) - 2017-02-28
### Fix
- Merge pull request #36 from conekta/fix/shipping-contact
(fix shipping for virtual products)

## [2.0.4](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.4) - 2017-02-28
### Fix
- Fix shipping contact for non-physical products
- Don't send shipping contact incomplete

## [2.0.3](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.3) - 2017-02-26
### Fix
- Add soft validations in line items to make antifraud_info optional

## [2.0.2](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.2) - 2017-02-24
### Fix
- Adjust round for non-integer cents

## [2.0.1](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.1) - 2017-02-24
### Fix
- Discount coupons are working now
- Webhooks for cash and spei payment are working now

## [2.0.0](https://github.com/conekta/conekta-woocommerce/releases/tag/v.2.0.0) - 2017-02-23
### Fix 
- Fix shipping tax calculation
### Feature
- Add Oxxo Pay
### Remove
- Remove Banorte

## [1.0.1](https://github.com/conekta/conekta-woocommerce/releases/tag/v.1.0.1) - 2017-02-16
### Fix
- Merge pull request #27 from conekta/fix/last-api-update

## [1.0.0](https://github.com/conekta/conekta-woocommerce/releases/tag/v.1.0.0) - 2017-02-11
### Feature
- Add OxxoPay
### Fix
- Merge pull request #24 from conekta/enhancement/hide-methods-without-key
### Change
- Disable methods if no private key is set

## [0.4.4](https://github.com/conekta/conekta-woocommerce/releases/tag/v.1.0.0) - 2017-02-11
### Update
- Update README

## [0.4.3](https://github.com/conekta/conekta-woocommerce/releases/tag/v.0.4.3) - 2016-08-29
### Fix
- Fix email instructions

## [0.4.2](https://github.com/conekta/conekta-woocommerce/releases/tag/v.0.4.2) - 2016-08-15
### Fix
- Merge pull request #11 from conekta/dev
- Fix on webhook handlers

## [0.4.1](https://github.com/conekta/conekta-woocommerce/releases/tag/v.0.4.1) - 2016-08-02
### Feature
- Add translations to v0.4
- Update Readme

## [0.4.0](https://github.com/conekta/conekta-woocommerce/releases/tag/v.0.4.0) - 2016-07-29
### Fix
- Email notifications for offline payment methods
- Support locale option

## [0.3.0]() - 2016-03-31
### Feature
- Added Banorte CEP and SPEI

## [0.2.1]() - 2015-06-15
### Feature
- Added additional parameters required for more robust anti-fraude service for card payments

## [0.2.0]() - 2015-05-11
### Feature
- Added option for differed payments for 3, 6, and 12 months
- Enable or disable differed payments from the admin

## [0.1.1]() - 2014-09-01
### Feature
- Offline payments
- Barcode sent in mail and displayed in order the confirmation page
- Order Status changed dynamically once webhook is added in Conekta.io Account 

## [0.1.0]() - 2014-08-16
### Update
- Online payments
- Sandbox testing capability
- Option to save customer profile
- Card validation at Conekta's servers, so you don't have to be PCI
- Client side validation for credit cards
