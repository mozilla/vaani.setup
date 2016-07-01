var wifi = require('./wifi.js');
var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs');
var Handlebars = require('handlebars');
var Evernote = require('evernote').Evernote;
var evernoteConfig = require('./evernoteConfig.json');

// Start running the server, then determine whether we need to
// to start a private AP so the user can connect
startServer();
wifi.getStatus().then(status => {
  // If we don't have a wifi connection, broadcast our own wifi network.
  // If we don't do that, no one will be able to connect to the server!
  console.log('wifi status:', status);
  if (status !== 'COMPLETED') {
    wifi.startAP();
    console.log('Started private wifi network VaaniSetup');
  }
})

function startServer(wifiStatus) {
  // Now start up the express server
  var server = express();

  // When we get POSTs, handle the body like this
  server.use(bodyParser.urlencoded({extended:false}));

  // Define the handler methods for the various URLs we handle
  server.get('/', handleRoot);
  server.get('/wifiSetup', handleWifiSetup);
  server.post('/connecting', handleConnecting);
  server.get('/oauthSetup', handleOauthSetup);
  server.get('/oauth', handleOauth);
  server.get('/oauth_callback', handleOauthCallback);
  server.get('/status', handleStatus);

  // And start listening for connections
  // XXX: note that we are HTTP only... is this a security issue?
  server.listen(80);
  console.log('HTTP server listening on port 80');
}

function getTemplate(filename) {
  return Handlebars.compile(fs.readFileSync(filename, 'utf8'));
}

var wifiSetupTemplate = getTemplate('./templates/wifiSetup.hbs');
var oauthSetupTemplate = getTemplate('./templates/oauthSetup.hbs');
var connectingTemplate = getTemplate('./templates/connecting.hbs');
var statusTemplate = getTemplate('./templates/status.hbs');

// When the client issues a GET request for the list of wifi networks
// scan and return them

// This function handles requests for the root URL '/'.
// We display a different page depending on what stage of setup we're at
function handleRoot(request, response) {
  console.log('handleRoot');
  wifi.getStatus().then(status => {
    console.log("wifi status", status);

    // If we don't have a wifi connection yet, display the wifi setup page
    if (status !== 'COMPLETED') {
      console.log("redirecting to wifiSetup");
      response.redirect('/wifiSetup');
    }
    else {
      // Otherwise, look to see if we have an oauth token yet
      var oauthToken
      try {
        oauthToken = JSON.parse(fs.readFileSync('oauthToken.json', 'utf8'));
      }
      catch(e) {
        oauthToken = null;
      }

      console.log(oauthToken);
      if (!oauthToken || !oauthToken.oauthAccessToken) {
        console.log("oauth setup");
        // if we don't, display the oauth setup page
        response.redirect('/oauthSetup');
      }
      else {
        console.log("good to go");
        // If we get here, then both wifi and oauth are set up, so
        // just display our current status
        response.redirect('/status');
      }
    }
  });
}

function handleWifiSetup(request, response) {
  wifi.scan().then(results => {
     response.send(wifiSetupTemplate({ networks: results }));
  });
}

function handleConnecting(request, response) {
  var ssid = request.body.ssid.trim();
  var password = request.body.password.trim();
  response.send(connectingTemplate({ssid: ssid}));

  // XXX: another problem. I think I need to wait a bit after sending the
  // response to be sure it gets through. Now that I'm calling stopAP first
  // the network went down before I received the response in my browser.

  // XXX I've got a problem here. This brings up the new network, and
  // we can connect to the device over local wifi. But the device
  // still thinks it is 10.0.0.1 instead of using the IP address
  // assigned by dhcp and somehow that means that it can't get out to
  // the internet.  (At least when I'm testing from home where
  // 10.0.0.1 is my router) Rebooting fixes things, but I somehow need
  // stopAP() to relinquish 10.0.0.1 and get the right address.  XXX
  // Maybe calling stopAP first before defining the network would
  // help? No, that doesn't seem to help with the ip address problem
  wifi.stopAP().then(out => wifi.defineNetwork(ssid, password));
}

function handleOauthSetup(request, response) {
  response.send(oauthSetupTemplate({}));
}

// We hold our oauth state here. If this was a server that ever had
// multiple clients, we'd have to use session state. But since we expect
// only one client, we just use globak state
var oauthState = {};

function handleOauth(request, response) {
  var client = new Evernote.Client(evernoteConfig);
  var callbackURL = request.protocol + "://" + request.headers.host +
      '/oauth_callback';
  console.log(callbackURL);
  client.getRequestToken(callbackURL, gotRequestToken);

  function gotRequestToken(error, oauthToken, oauthTokenSecret, results) {
    if (error) {
      console.error('Error getting request token: ', error);
      oauthState.error = JSON.stringify(error);
      response.redirect('/');
      return;
    }

    // Remember the results of this first step
    oauthState.oauthToken = oauthToken;
    oauthState.oauthTokenSecret = oauthTokenSecret;
    console.log("Got oauth request token", oauthState);

    // And now redirect to Evernote to let the user authorize
    response.redirect(client.getAuthorizeUrl(oauthToken));
  }
}

function handleOauthCallback(request, response) {
  var client = new Evernote.Client(evernoteConfig);
  client.getAccessToken(oauthState.oauthToken,
                        oauthState.oauthTokenSecret,
                        request.query['oauth_verifier'],
                        gotAccessToken);

  function gotAccessToken(error, oauthAccessToken,
                          oauthAccessTokenSecret, results) {
    if (error) {
      if (error.statusCode === 401) {
        console.error('Unauthorized');
      }
      else {
        console.error('Error getting access token:', error);
      }
      require('fs').writeFileSync('oauthToken.json', '{}');
      response.redirect('/');
      return;
    }

    var token = JSON.stringify({
      oauthAccessToken: oauthAccessToken,
      oauthAccessTokenSecret: oauthAccessTokenSecret,
      results: results
    });

    console.log("got oauth access token:", token);
    require('fs').writeFileSync('oauthToken.json', token);
    response.redirect('/');
  }
}

function handleStatus(request, response) {
  response.send(statusTemplate())
}
