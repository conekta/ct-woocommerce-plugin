<div style="text-align:center;">

# Conekta Woocommerce v.4.0.0
[![Made with PHP](https://img.shields.io/badge/made%20with-php-red.svg?style=for-the-badge&colorA=ED4040&colorB=C12C2D)](http://php.net) 
[![By Conekta](https://img.shields.io/badge/by-conekta-red.svg?style=for-the-badge&colorA=ee6130&colorB=00a4ac)](https://conekta.com)
</div>

WooCommerce Payment Gateway for Conekta.io

This is a Open Source and Free plugin. It bundles functionality to process credit cards and cash payments securely as well as send email notifications to your customers when they complete a successful purchase.


Features
--------
Current version features:

* Uses Conekta.js      - No PCI Compliance Issues ( Requires an SSL Certificate)
* Credit and Debit Card implemented
* Cash payments implemented

![alt tag](https://raw.github.com/conekta/ct-woocommerce-plugin/master/readme_files/admin_card.png)

* Sandbox testing capability.
* Automatic order status management
* Email notifications on successful purchase
* Email notifications on successful in cash payment

![alt tag](https://raw.github.com/conekta/ct-woocommerce-plugin/master/readme_files/email.png)



Version Compatibility
---------------------
This plugin has been tested on WordPress 6.2  WooCommerce 7.6.0

Installation
-----------
Method 1:
* Clone the module using git clone --recursive git@github.com:conekta/conekta-woocommerce.git
* Upload the plugin zip file in Plugins > Add New and then click "Install Now"
* Once installed, activate the plugin.

Method 2:
* Search the plugin in Plugins > Add New
* In the search bar type Conekta Payment and the click "Install Now"

* Add your API keys in Woocommerce > Settings > Checkout from your Conekta account (admin.conekta.io) in https://admin.conekta.io#developers.keys

![alt tag](https://raw.github.com/conekta/ct-woocommerce-plugin/master/readme_files/form.png)

* To manage orders for offline payments so that the status changes dynamically, you will need to add the following url as a webhook in your Conekta account:
http://tusitio.com/wc-api/WC_Conekta_Cash_Gateway

![alt tag](https://raw.github.com/conekta/ct-woocommerce-plugin/master/readme_files/webhook.png)

Replace to **tusitio.com** with your domain name

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
