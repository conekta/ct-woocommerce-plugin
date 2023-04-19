<?php
 /*
 * Title   : Conekta Payment extension for WooCommerce
 * Author  : Cristina Randall
 * Url     : https://www.conekta.io/es/docs/plugins/woocommerce
 */
?>
<div class="clear"></div>
<span style="width: 100%; float: left; color: red;" class='payment-errors required'></span>
<?php 
$customer_id = parent::ckpg_get_conekta_metadata(get_current_user_id(), parent::CONEKTA_CUSTOMER_ID);
$sources = parent::ckpg_get_conekta_metadata(get_current_user_id(), parent::CONEKTA_PAYMENT_SOURCES_ID);
if(!empty($customer_id)){
    $customer = \Conekta\Customer::find($customer_id); 
} 
if(!empty( $sources )){
    $sources = explode(',',$sources);
}
?>
    <div class="credit-card-payment" style="<?php echo (empty( $customer_id ) || empty($sources))? '': 'display:none'?>"> 
    
    <div class="form-row form-row-wide">
        <label for="conekta-card-number"><?php echo esc_html($this->lang_options["card_number"]); ?><span class="required">*</span></label>
        <input id="conekta-card-number" class="input-text" type="text" data-conekta="card[number]" />
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
            <?php foreach ($this->lang_options["card_expiration"] as $month => $description) : ?>
            <option value="<?php echo esc_html($month); ?>"><?php echo esc_html($description); ?></option>
            <?php endforeach; ?>
        </select>
    </p>
    <p class="form-row form-row-last">
        <label><?php echo esc_html($this->lang_options["year_options"]) ?><span class="required">*</span></label>
        <select id="card_expiration_yr" data-conekta="card[exp_year]" class="year" autocomplete="off">
            <option selected="selected" value=""> <?php echo esc_html($this->lang_options["year"]) ?></option>
            <?php
            $start_year = (integer)date("Y");
            $end_year = (integer)date("Y", strtotime("+10 years"));
            for ($i = $start_year; $i <= $end_year; $i++) : ?>
            <option value="<?php echo $i; ?>"><?php echo $i; ?></option>
            <?php endfor; ?>
        </select>
    </p>

    <div class="clear"></div>

    <p class="form-row form-row-first">
        <label for="conekta-card-cvc">CVC <span class="required">*</span></label>
        <input id="conekta-card-cvc" class="input-text" type="text" maxlength="4" data-conekta="card[cvc]" value="" style="border-radius:6px" />
    </p>

    <?php if ($this->enable_meses) : ?>
    <p class="form-row form-row-last">
        <label><?php echo esc_html($this->lang_options["payment_type"]) ?><span class="required">*</span></label>
        <select id="monthly_installments" name="monthly_installments" autocomplete="off">
            <option selected="selected" value="1"><?php echo esc_html($this->lang_options["single_payment"]) ?></option>
            <?php foreach ($this->lang_options["monthly_installments"] as $months => $description) : ?>
            <option value="<?php echo esc_html($months); ?>"><?php echo esc_html($description); ?></option>
            <?php endforeach; ?>
        </select>
    </p>
    <?php endif; ?>
    <?php if (isset($this->enable_save_card ) && $this->enable_save_card != "no") : ?>
        <p class="form-row form-row-wide">
        <label for="conekta-card-save"></label>
        <input id="conekta-card-save"  type="checkbox" value="<?php echo ($this->enable_save_card)? '1': '0' ?>" name="conekta-card-save" <?php echo ($this->enable_save_card)? 'checked': '' ?>> <?php echo esc_html($this->lang_options["enable_save_card"]); ?></input>
    </p>
    <?php endif; ?>
    </div>
<?php
?>
<div class = "customer-payment-sources" style="<?php echo ( !empty( $customer ) || !empty($sources))? '': 'display:none'?>" >
    <ul class="">
        <?php if(!empty($customer)) :

            foreach( $customer->payment_sources as $info_card): ?>
                <?php if(in_array($info_card->id, $sources)) :?>
                <li class="payment_sources_card">
                    <div class="info_card">
                        <a class="conekta_delete_card" id=<?php echo "delete_payment_card_" .$info_card->id ?> value="<?php echo $info_card->id ?>"><img src="<?php echo plugin_dir_url(__DIR__) . 'images/icons/trash-alt-solid.svg' ?>" alt="X" onclick="ckpg_delete_card('<?php echo $info_card->id ?>')"/></a>
                        <span class="spinner is-active" id="ckpg_checkout_delete_loader-gif"><img src="/wp-admin/images/spinner.gif" alt="delete..."></span>
                        <input id="<?php echo "radio_input_" . $info_card->id ?>" type="radio" class="radio_payment_source" name="payment_card" value="<?php echo $info_card->id ?>" <?php echo ( $customer->default_payment_source_id == $info_card->id )? "checked" : "" ?>>
                        <label for="<?php echo esc_html("radio_input_" . $info_card->id) ?>"><strong><?php echo esc_html($info_card->customer['name'])?></strong></label>
                        <p class="card_details"><img src="<?php echo esc_html( plugin_dir_url(__DIR__) .'images/icons/' . $info_card->brand .'.svg')?>" alt="<?php echo esc_html( $info_card->brand )?>"><?php echo esc_html( $this->lang_options["card_termination"]) ?> <strong>**** <?php echo esc_html($info_card->last4) ?></strong> </p>
                    </div>
                </li> 
                <?php endif; ?>
            <?php endforeach ?>
        <?php endif; ?>
    </ul>
    <?php if( !empty( $customer_id ) && !empty( $sources ) ) : ?>
    <div class="content_new_card">
        <a id="new_payment_card" onclick="ckpg_add_card()"><strong><?php echo esc_html( $this->lang_options["enter_card_details"]) ?></strong></a>
    </div>
    <?php endif; ?>
</div>
<div class="clear"></div> 