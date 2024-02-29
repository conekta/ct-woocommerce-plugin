<div align="center">

# Conekta Woocommerce v.4.0.4
[![Made with PHP](https://img.shields.io/badge/made%20with-php-red.svg?style=for-the-badge&colorA=ED4040&colorB=C12C2D)](http://php.net) 
[![By Conekta](https://img.shields.io/badge/by-conekta-red.svg?style=for-the-badge&colorA=ee6130&colorB=00a4ac)](https://conekta.com)
</div>

WooCommerce Payment Gateway for Conekta.io

This is an Open Source and Free plugin. It bundles functionality to process credit cards and cash payments securely as well as send email notifications to your customers when they complete a successful purchase.


Features
--------
Current version features:

* Unified API Key Integration: Streamlines the integration procedure for all existing payment modalities under one cohesive set of API Keys.
* Refined Checkout Workflow: Enhances the user experience by consolidating checkout stages. Incorporates a robust checkpoint system to streamline transactions.
* Enhanced Security with Conekta's PCI-Certified Component: Elevate transaction protection using our secure, PCI-certified Conekta Component, designed to ensure a safe checkout experience.
* 3D Secure Version 2 Support: Ensures compatibility with the latest 3DS v2 specification, aligning with current security norms and enhancing fraud prevention measures.
* Automatic order status management
* Email notifications on successful purchase
* Email notifications on successful in all payments

Version Compatibility
---------------------
This plugin has been tested on WordPress 6.4.2  WooCommerce 8.5.0

Installation
-----------
Before initiating the installation process, please ensure that your WooCommerce version is 3.x, and if necessary, download an older version to match your requirements. Additionally, confirm that your server runs PHP Version 7.4 or above, as the Conekta PHP library mandates this version.
Follow these steps for a seamless installation:
* WordPress Dashboard Login:
   * Log in to your WordPress Dashboard.
* Navigate to Plugins:
  * Access the plugins menu from the dashboard.
* Search and Locate:
  * Click on "Add New" and enter "Conekta Payment Gateway" in the search field. Hit the "Search Plugins" button to find the desired plugin.
* Plugin Details:
  * Explore the Conekta plugin details to gather additional information before proceeding.
* Installation:
  * Install the plugin effortlessly by clicking on the "Install Now" button.
* API Key Configuration:
  * Head to Woocommerce > Settings > Checkout in your WordPress Dashboard.
  * Create your API keys from your Conekta account at panel.conekta.com
  * Enter the API keys in the designated fields to link your Conekta account with WooCommerce.
* Webhook Configuration:
  * To dynamically manage order statuses for offline payments, set up a webhook in your Conekta account.
  * Add the following URL as a webhook in your Conekta account: http://tusitio.com/?wc-api=wc_conekta, Replace to tusitio.com with your domain name

## License

Developed in Mexico by [Conekta](https://www.conekta.com) in. Available with [MIT License](LICENSE).

***

## How to contribute to the project

1. Fork the repository
 
2. Clone the repository
```
    git clone git@github.com:yourUserName/ct-woocommerce-plugin.git
```
3. Create a branch
```
    git checkout develop
    git pull origin develop
    # You should choose the name of your branch
    git checkout -b <feature/my_branch>
```    
4. Make necessary changes and commit those changes
```
    git add .
    git commit -m "my changes"
```
5. Push changes to GitHub
```
    git push origin <feature/my_branch>
```
6. Submit your changes for review, create a pull request

   To create a pull request, you need to have made your code changes on a separate branch. This branch should be named like this: **feature/my_feature** or **fix/my_fix**.

   Make sure that, if you add new features to our library, be sure that corresponding **unit tests** are added.

   If you go to your repository on GitHub, you’ll see a Compare & pull request button. Click on that button.
