var wifi = require('./wifi.js');
var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs');
var Handlebars = require('handlebars');

var app = express();

var indexPageTemplate = Handlebars.compile(fs.readFileSync('./index.hbs', 
                                                           'utf8'));

// Serve static files in the public/ directory
// app.use(express.static('public'));

// When we get POSTs, handle the body like this
app.use(bodyParser.urlencoded({extended:false}));


// When the client issues a GET request for the list of wifi networks
// scan and return them

app.get('/', (request, response) => {
  Promise.all([wifi.getConnectedNetwork(), wifi.scan()])
    .then(results => {
      var connected = results[0] || 'DISCONNECTED';
      var scanResults = results[1].filter(n => n !== '');
      response.send(indexPageTemplate({
        connectionState: connected,
        networks: scanResults
      }));
    });
});

app.post('/addNetwork', (request, response) => {
  var ssid = request.body.ssid.trim();
  var password = request.body.password.trim();
  response.send(`The device will now connect to the ${ssid} wifi network.`);
  wifi.defineNetwork(ssid, password);
});

app.listen(80);

// If we don't have a wifi connection, set up our own access point
wifi.getStatus().then(status => {
  if (status !== 'COMPLETED') {
    wifi.startAP();
    console.log("No wifi connection. Setting up private wifi net");
    console.log("Connect and point your browser to 10.0.0.1");
  }
  else {
    console.log("Wifi is already connected");
    // XXX: should we just quit here and not run the server at all?
  }
});
