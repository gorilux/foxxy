'use strict';
const request = require('@arangodb/request');
const params = module.context.argv[0];

request({
  method: "POST",
  url: "https://api:"+ settings.mailgun_apikey +"@api.mailgun.net/v3/"+ settings.mailgun_domain +"/messages",
  form: {
    from: settings.mailgun_from,
    to: params.to,
    subject: "Lost password",
    text: `Hi,

You asked to change your password. Please follow instruction on link below :
http://${module.context.configuration.domain}/login#change_password/${params.uuid}

Best,
Foxxy App`
  }
})

