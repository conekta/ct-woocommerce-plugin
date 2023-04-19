<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Cristina Randall
 * Url     : http://cristinarandall.com/
 * License : http://cristinarandall.com/
 */
?>


<span class='payment-errors required'></span>
<?php $order_correct = ((float) WC()->cart->total) >= parent::MINIMUM_ORDER_AMOUNT ?>
    <p id="conektaBillingFormCashErrorMessage"><?php echo ($order_correct) ? $this->lang_options["enter_customer_details"] : $this->lang_options["order_too_little"].parent::MINIMUM_ORDER_AMOUNT.' $'?></p>
<?php if ($order_correct) : ?>
    <div id="conektaIframeCashContainer" style="width: 100%;"></div>
<?php endif ?>
<script>
    let order_btn_cash = document.getElementById("place_order");
    if(order_btn_cash && order_btn_cash.style.display != "none")
        order_btn_cash.style.display = "none";
</script>