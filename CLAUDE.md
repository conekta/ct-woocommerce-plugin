# CLAUDE.md

## Project Overview
WooCommerce payment gateway plugin for Conekta. Supports Classic Checkout and WooCommerce Blocks.

## URL Handling Rules
WordPress installations may live in a subdirectory (e.g. `https://example.com/tienda/`).
Never hardcode URLs like `/wp-json/...` or concatenate with `window.location.origin`.

### PHP
- REST API URLs: use `rest_url('conekta/v1/')` — it respects the subdirectory and permalink structure.
- WooCommerce AJAX endpoints: use `\WC_AJAX::get_endpoint('checkout')`.
- Site URLs: use `get_site_url()` instead of hardcoding the domain.

### JavaScript
- All URLs must come from PHP via `wp_localize_script` or `getSetting()` (blocks).
- Classic checkout uses `conekta_settings.rest_url` and `conekta_settings.checkout_url`.
- Blocks checkout uses `settings.rest_url` (from `get_payment_method_data()` in the blocks class).
- Never build URLs with string concatenation from `window.location.origin`.

## Key Files
- `conekta_checkout.php` — Classic checkout settings via `wp_localize_script`.
- `includes/blocks/class-wc-conekta-payments-blocks.php` — Blocks checkout settings via `get_payment_method_data()`.
- `resources/js/frontend/classic-checkout.js` — Classic checkout JS.
- `resources/js/frontend/index.js` — Blocks checkout JS (React).
- `conekta-rest-api.php` — REST API endpoints for 3DS.

## Build
- `npm run build` — Builds the JS assets.
