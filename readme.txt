=== Conekta Payment Gateway ===
Contributors: conekta, interfacesconekta
Tags: free, cash, conekta, mexico, payment gateway
Requires at least: 6.1
Tested up to: 6.7.1
Requires PHP: 7.4
Stable tag: 5.4.0
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html


WooCommerce Payment Gateway for Conekta.io

This bundles functionality to process credit cards and cash payments securely as well as send email notifications to your customers when they complete a successful purchase.

== Description ==

Current version features:

* Unified API Key Integration: Streamlines the integration procedure for all existing payment modalities under one cohesive set of API Keys.
* Refined Checkout Workflow: Enhances the user experience by consolidating checkout stages. Incorporates a robust checkpoint system to streamline transactions
* Enhanced Security with Conekta's PCI-Certified Component: Elevate transaction protection using our secure, PCI-certified Conekta Component, designed to ensure a safe checkout experience
* 3D Secure Version 2 Support: Ensures compatibility with the latest 3DS v2 specification, aligning with current security norms and enhancing fraud prevention measures
* Automatic order status management
* Email notifications on successful purchase

== Installation ==
Before initiating the installation process, please ensure that your WooCommerce version is 3.x, and if necessary, download an older version to match your requirements. Additionally, confirm that your server runs PHP Version 7.4 or above, as the Conekta PHP library mandates this version.
Follow these steps for a seamless installation

* WordPress Dashboard Login, Log in to your WordPress Dashboard.
* Navigate to Plugins, Access the plugins menu from the dashboard.
* Search and Locate, Click on "Add New" and enter "Conekta Payment Gateway" in the search field. Hit the "Search Plugins" button to find the desired plugin.
* Plugin Details, Explore the Conekta plugin details to gather additional information before proceeding.
* Installation, Install the plugin effortlessly by clicking on the "Install Now" button.
* API Key Configuration, Head to Woocommerce > Settings > Checkout in your WordPress Dashboard. Create your API keys from your Conekta account at panel.conekta.com , Enter the API keys in the designated fields to link your Conekta account with WooCommerce.
* Webhook Configuration, To dynamically manage order statuses for offline payments, set up a webhook in your Conekta account, Add the following URL as a webhook in your Conekta account: http://tusitio.com/?wc-api=wc_conekta, Replace to tusitio.com with your domain name

By following these steps, you'll successfully install and configure the Conekta Payment Gateway plugin, ensuring a smooth integration with your WooCommerce store.

== Screenshots ==
1. Integrate Conekta to your Online store and start accepting all the payment methods with a single integration. We are a payments company with more than 10 years within the Mexican market.
`/assets/screenshot-1.png`
2. With a single API key, integrate and accept all payment methods.
`/assets/screenshot-3.png`
3. There is no need to worry about PCI certifications. Starting from version 4.0.0, all cards transactions are redirected to Conekta’s checkout. Accept online payments in a secure and friendly way.
`/assets/screenshot-2.png`

== Changelog ==
= 5.4.0 =
* Added 3D Secure (3DS) v2 support for enhanced payment security
* Improved fraud prevention measures with latest 3DS authentication
* Better compatibility with modern payment security standards
= 5.3.0 =
* Removes klarna image and adds aplazo image.
= 5.2.6 =
* Handle bank transfer payment method
= 5.2.5 =
* Removes useless alert in error handling
= 5.2.4 =
* Fix issue with tokenizer container unmount
= 5.2.3 =
* Fix hardcoded url in classic checkout
= 5.2.2 =
* support card payment integration with Conekta Component was recovered, support for classic-checkout was added
= 5.2.1 =
* Revert support card payment integration with Conekta Component
= 5.2.0 =
* support card payment integration with Conekta Component
= 5.1.0 =
* Added bnpl payment method
= 5.0.9 =
* Added support for custom rates and discounts
= 5.0.8 =
* Upgrade Wordpress version
= 5.0.7 =
* Test on Wordpress 6.7.1
= 5.0.6 =
* Fix instructions environment
= 5.0.5 =
* Fix webhook functionality
* add missing fields such as instructions,icons 
* add field account_owner
= 5.0.4 =
* Fix change version release
= 5.0.3 =
* Fix Available compatibility mode, dont show clabe for SPEI/cash
= 5.0.2 =
* Fix webhook for paid orders
* Automatically config webhook in the plugin settings
= 5.0.1 =
* Fix unauthorized Client
= 5.0.0 =
* Revert all payment methods in one, Now you can choose which methods you want to use separately

= 4.0.4 =
* Fix error in coupon amount when coupon type is percentage
* Render icons in the checkout page depending on the plugin settings
* Set logic for canMakePayment in the checkout page

= 4.0.3 =
* Fix status orders, new orders are created with status "pending payment" and not "on-hold"

= 4.0.2 =
* Fix error when creating order with empty shipping contact

= 4.0.1 =
* Fix installing plugin in php 7.4

= 4.0.0 =
* Update conekta-php library
* Checkout Blocks compatibility.
* Updated to the new redirected checkout process: Conekta Component.
* Simplified integration process using one API key for all payment methods.

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