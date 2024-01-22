=== Conekta Payment Gateway ===
Contributors: conekta, fcarrero, interfacesconekta
Tags: free, cash, conekta, mexico, payment gateway
Requires at least: 6.1
Tested up to: 6.4.2
Requires PHP: 7.4
Stable tag: 4.0.0
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html


WooCommerce Payment Gateway for Conekta.io

This bundles functionality to process credit cards and cash payments securely as well as send email notifications to your customers when they complete a successful purchase.

== Description ==

Current version features:

* Uses Conekta.js      - No PCI Compliance Issues ( Requires an SSL Certificate)
* Credit and Debit Card implemented
* Cash payments implemented
* Sandbox testing capability.
* Automatic order status management
* Email notifications on successful purchase

== Installation ==
Please note, v. 4.0.0 requires WooCommerce 3.x.
You can download an older version [here.](https://wordpress.org/plugins/conekta-payment-gateway/advanced/)
Make sure that you have at least PHP Version 7.4 since the Conekta PHP library requires this version.

###Automatic
* Log in to your  WordPress Dashboard, navigate to the plugins menu and click Add New, in the search field type “Conekta Payment Gateway” and click Search Plugins. Once you’ve found our plugin you can view details about it, you can install it by simply clicking “Install Now”.
* Once installed, activate the plugin.
* Add your API keys in Woocommerce > Settings > Checkout from your Conekta account (https://panel.conekta.com/) in https://panel.conekta.com/developers/api-keys
* To manage orders for offline payments so that the status changes dynamically, you will need to add the following url as a webhook in your Conekta account:
http://tusitio.com/?wc-api=wc_conekta

Replace to tusitio.com with your domain name

== Screenshots ==
1. Integrate Conekta to your Online store and start accepting all the payment methods with a single integration. We are a payments company with more than 10 years within the Mexican market.
`/assets/screenshot-1.png`
2. There is no need to worry about PCI certifications. Starting from version 4.0.0, all transactions are redirected to Conekta’s checkout. Accept online payments in a secure and friendly way.
`/assets/screenshot-2.png`
3. With a single API key, integrate and accept all payment methods.
`/assets/screenshot-3.png`

== Changelog ==

= 4.0.0 =
* Update conekta-php library
* Update conekta-woocommerce library
* Woocommerce block supports
* Migrate to Redirect Flow Payments

= 3.7.7 =
* fix shipping line amount

= 3.7.6 =
* supports events listening (order.expired and order.cancelled) for OXXO and SPEI
*  update order status (cancelled and expired)

= 3.7.5 =
* Fix error when create charge in php 7.4

= 3.7.2 =
* Update versions

= 3.7.1 =
* Update conekta-php library

= 3.7.0 =
* Homogenization with WordPress standards

= 3.0.8 =
* Fix problem whit amount in discount_lines

= 3.0.7 =
* Fix problem whit amount -1
* Fix problem whit reference oxxo pay

= 3.0.6 =
* Fix problem with amount -1

= 3.0.5 =
* Updated images for Conekta Payments

= 3.0.4 =
* Fix for error token already used

= 3.0.3 =
* Update PHP Lib compatible with PHP 7+

= 3.0.2 =
* Fix: Order info in email templates
* Feature: Custom instructions and description for Oxxo and Spei payment

= 3.0.1 =
* Fix: Fix library issues.

= 3.0.0 =
* Changed: Access correctly to order properties (Support WooCommerce 3.x).

= 2.0.14 =
* Style: Correction in typo for email

= 2.0.13 =
* name the SPEI account owner in admin input section[NEW FEATURE]
* new marketplace review validations

= 2.0.12 =
* Fixes round adjustment for non-integer values
* sends plugin version in line items tag.

= 2.0.11 =
* Fixes issue of token_id missing.

= 2.0.10 =
* Fix monthly installments

= 2.0.9 =
Fix tax line empty description

= 2.0.8 =
change name of translation inside comment.

= 2.0.7 =
Fix sku less than 0 characters

= 2.0.6 =
Fix shipping for card and spei

= 2.0.5 =
* Fix shipping validations for virtual products
* Fix rounding for non-integer cents
* Add expiration date for oxxo pay
* Fix webhooks for paid orders

= 2.0.0 =
* Added taxes
* Added discounts
* Added shipping
* Added orders
* Oxxo pay
* Fix webhooks for paid orders (previously paid charges)
* Remove Banorte

= 0.3.0 =
* Added additional parameters required for more robust anti-fraude service for card payments

= 0.2.0 =
* Added option for differed payments for 3, 6, and 12 months
* Enable or disable differed payments from the admin

= 0.1.1 =
* Offline payments
* Barcode sent in mail and displayed in order the confirmation page
* Order Status changed dynamically once webhook is added in Conekta.io Account

= 0.1.0 =
* Online payments
* Sandbox testing capability.
* Option to save customer profile.
* Card validation at Conekta's servers so you don't have to be PCI.
* Client side validation for credit cards.