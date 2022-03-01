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
    <p id="conektaBillingFormSpeiErrorMessage"><?php echo ($order_correct) ? $this->lang_options["enter_customer_details"] : $this->lang_options["order_too_little"].parent::MINIMUM_ORDER_AMOUNT.' $'?></p>
<?php if ($order_correct) : ?>
    <div id="conektaIframeBankContainer" style="width: 100%;"></div>
<?php endif ?>
<script>
    let order_btn_spei = document.getElementById("place_order");
    if(order_btn_spei && order_btn_spei.style.display != "none")
        order_btn_spei.style.display = "none";
</script>