<?php
/*
 * Title   : Conekta Payment extension for Woo-Commerece
 * Author  : Cristina Randall
 * Url     : http://cristinarandall.com/
 * License : http://cristinarandall.com/
 */
?>

<h3>
    <?php _e('Pago Directo BBVA', 'woothemes'); ?>
</h3>

<p><?php _e('Paga desde la App BBVA al instante con tu cuenta, sin compartir datos bancarios. Para continuar, te llevaremos a un sitio seguro de BBVA.', 'woothemes'); ?></p>

<table class="form-table">
    <?php $this->generate_settings_html(); ?>
</table>

