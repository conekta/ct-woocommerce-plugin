
function ckpg_delete_card(value) {
    var data = {
        'action':'ckpg_checkout_delete_card',
        'value':value
    };
    jQuery('#ckpg_checkout_delete_loader-gif').fadeIn(0);
    jQuery('#delete_payment_card_'+value).fadeOut(0);

    jQuery.post( 
        conekta_checkout_js.ajaxurl, 
        data,
        function(serverResponse) {
            if(serverResponse.response){
                console.log(serverResponse.response)
                jQuery( '#delete_payment_card_' + value ).closest( 'li' ).hide();
                jQuery( '#delete_payment_card_' + value ).prop('checked', false);
            } else {
                jQuery('#delete_payment_card_'+ value).fadeIn(0);
                jQuery('#delete_payment_card_' + value ).closest( 'li' ).show();
            }

        }
        
    ).error(function(e){
        jQuery('#delete_payment_card_'+ value).fadeIn(0);
        jQuery('#ckpg_checkout_delete_loader-gif').fadeOut(0);
    })
    .always(function() {
        jQuery('#ckpg_checkout_delete_loader-gif').fadeOut(0);

    });
}

function ckpg_add_card(){
    jQuery('.customer-payment-sources').hide();
    jQuery('.credit-card-payment').show();  

    var sources = jQuery('.customer-payment-sources')[0]['children'][0]['children'];
    i = 0 ;
    while(i <= sources.length - 2 ){
        var input = sources[i]['children'][0]['children'][2].id;
        jQuery( '#' + input ).prop('checked', false);
        console.log(input);
        
        i++;
    }
}