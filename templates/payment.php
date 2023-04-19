<?php
/*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Cristina Randall
 * Url     : https://www.conekta.io/es/docs/plugins/woocommerce
 */
?>
<div class="clear"></div>
<span style="width: 100%; float: left; color: red;" class='payment-errors required'></span>
<div class="form-row form-row-wide">
  <label for="conekta-card-number"><?php echo esc_html($this->lang_options["card_number"]); ?><span class="required">*</span></label>
  <input id="conekta-card-number" class="input-text" type="text" data-conekta="card[number]" maxlength=16 onKeypress="if (event.keyCode < 48 || event.keyCode > 57) event.returnValue = false;" />
</div>

<div class="form-row form-row-wide">
  <label for="conekta-card-name"> <?php echo esc_html($this->lang_options["card_name"]); ?><span class="required">*</span></label>
  <input id="conekta-card-name" type="text" data-conekta="card[name]" class="input-text" />
</div>

<div class="clear"></div>

<p class="form-row form-row-first">
    <label for="card_expiration"><?php echo esc_html($this->lang_options["month_options"]) ?> <span class="required">*</span></label>
    <select id="card_expiration" data-conekta="card[exp_month]" class="month" autocomplete="off">
             <option selected="selected" value=""><?php echo esc_html($this->lang_options["month"]) ?></option>
             <?php foreach($this->lang_options["card_expiration"] as $month => $description): ?>
              <option value="<?php echo esc_attr($month); ?>"><?php echo esc_html($description); ?></option>
             <?php endforeach; ?>
    </select>
</p>
<p class="form-row form-row-last">
    <label><?php echo esc_html($this->lang_options["year_options"]) ?><span class="required">*</span></label>
    <select id="card_expiration_yr" data-conekta="card[exp_year]" class="year" autocomplete="off">
              <option selected="selected" value=""> <?php echo esc_html($this->lang_options["year"]) ?></option>
              <?php
              $start_year = (integer) gmdate("Y");
              $end_year = (integer) gmdate("Y", strtotime("+10 years"));
              for($i = $start_year; $i <= $end_year; $i++): ?>
                <option value="<?php echo esc_attr($i); ?>"><?php echo esc_html($i); ?></option>
              <?php endfor; ?>
    </select>
</p>

<!--<div class="form-row form-row-wide">
  <label for="conekta-card-expiration"><?php echo esc_html($this->lang_options["card_expiration"]); ?> (MM/YY) <span class="required">*</span></label>
  <input id="conekta-card-expiration" data-conekta="card[expiration]" class="input-text" type="text" autocomplete="off" placeholder="MM / YY" />
</div>-->

<div class="clear"></div>

<p class="form-row form-row-first">
    <label for="conekta-card-cvc">CVC <span class="required">*</span></label>
    <input id="conekta-card-cvc" class="input-text" type="text" maxlength="4" data-conekta="card[cvc]" value=""  style="border-radius:6px"/>
</p>

<?php if ($this->enable_meses): ?>
<p class="form-row form-row-last">
  <label><?php echo esc_html($this->lang_options["payment_type"]) ?><span class="required">*</span></label>
  <select id="monthly_installments" name="monthly_installments" autocomplete="off">
    <option selected="selected" value="1"><?php echo esc_html($this->lang_options["single_payment"]) ?></option>
    <?php foreach($this->lang_options["monthly_installments"] AS $months => $description): ?>
      <option value="<?php echo esc_attr($months); ?>"><?php echo esc_html($description); ?></option>
    <?php endforeach; ?>
  </select>
</p>

<?php endif; ?>
<div class="clear"></div>
