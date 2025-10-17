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
