var Express = require('express');
var Handlebars = require('handlebars');
var Evernote = require('evernote').Evernote;
var Wakeword = require('wakeword');
var bodyParser = require('body-parser');
var fs = require('fs');
var cp = require('child_process');
var wifi = require('./wifi.js');
var wait = require('./wait.js');
var evernoteConfig = require('./evernoteConfig.json');

// Our local copy of all the data we get back from the oauth process
var OAUTH_TOKEN_FILE = 'oauthToken.json'
// Just the token value itself, saved as an environment variable
// that is used when the vaani client is launched
var OAUTH_ENV_FILE = '/lib/systemd/system/vaani.service.d/evernote.conf';

// The Edison device can't scan for wifi networks while in AP mode, so
// we've got to scan before we enter AP mode and save the results
var preliminaryScanResults;

// The parsed contents of the OAUTH_TOKEN_FILE, or null if we have no token
var oauthToken = readToken();

// We'll set this true if we enter AP mode and guide the user through
// setup with voice
var talkOnFirstPage = false;


// Start running the server.
startServer();

// Wait until we have a working wifi connection. Retry every 3 seconds up
// to 10 times. If we are connected, then start the Vaani client.
// If we never get a wifi connection, go into AP mode.
waitForWifi(10, 3000)
  .then(() => {
    // XXX: we should check that the token is still valid and prompt
    // the user to renew it if it is expired or will expire soon
    if (oauthToken) {
      startVaani();
    }
    else {
      // If we get here it means we've got a wifi connection but
      // don't have an oauth token. Tell the user to finish setup
      play('audio/finish.wav');
    }
  })
  .catch(startAP);

// Return a promise, then check every interval ms for a wifi connection.
// Resolve the promise when we're connected. Or, if we aren't connected
// after maxAttempts attempts, then reject the promise
function waitForWifi(maxAttempts, interval) {
  return new Promise(function(resolve, reject) {
    var attempts = 0;
    check();

    function check() {
      attempts++;
      console.log('check', attempts);
      wifi.getStatus()
        .then(status => {
          console.log(status);
          if (status === 'COMPLETED') {
            console.log('Wifi connection found');
            resolve();
          }
          else {
            console.log('No wifi connection on attempt', attempts);
            retryOrGiveUp()
          }
        })
        .catch(err => {
          console.error('Error checking wifi on attempt', attempts, ':', err);
          retryOrGiveUp();
        });
    }

    function retryOrGiveUp() {
      if (attempts >= maxAttempts) {
        console.error('Giving up. No wifi available.');
        reject();
      }
      else {
        setTimeout(check, interval);
      }
    }
  });
}

function startAP() {
  console.log("startAP");
  try{
  // If we can't get on wifi, then discard any existing oauth
  // credentials we have. If the Vaani box is in a new home then
  // the user should have to authenticate again.
  if (oauthToken !== null) {
    oauthToken = null;
    saveToken(null);
  }

  // Scan for wifi networks now because we can't always scan once
  // the AP is being broadcast
  wifi.scan(10)   // retry up to 10 times
    .then(ssids => preliminaryScanResults = ssids) // remember the networks
    .then(() => wifi.startAP())                    // start AP mode
    .then(() => {
      console.log('No wifi found; entering AP mode')
      talkOnFirstPage = true; // continue talking to the user when they connect
      play('audio/help-me-connect.wav')
        .then(() => waitForSpeech('okay'))
        .then(() => play('audio/wifi-settings.wav'))
        .then(() => waitForSpeech('okay'))
        .then(() => play('audio/enter-url.wav'))
    });
  }catch(e){console.error(e);}
}

function startServer(wifiStatus) {
  // Now start up the express server
  var server = Express();

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
  // XXX: for first-time this is on an open access point.
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
  wifi.getStatus().then(status => {
    // If we don't have a wifi connection yet, display the wifi setup page
    if (status !== 'COMPLETED') {
      console.log("no wifi connection; redirecting to wifiSetup");
      response.redirect('/wifiSetup');
    }
    else {
      // Otherwise, look to see if we have an oauth token yet
      if (!oauthToken) {
        // if we don't, display the oauth setup page
        console.log("wifi connnected; redirecting to /oauthSetup");
        response.redirect('/oauthSetup');
      }
      else {
        // If we get here, then both wifi and oauth are set up, so
        // just display our current status
        console.log("wifi and oauth setup complete; redirecting /status");
        response.redirect('/status');
      }
    }
  })
  .catch(e => {
    console.error(e);
  });
}

function handleWifiSetup(request, response) {
  if (talkOnFirstPage) {
    talkOnFirstPage = false;
    play('audio/connected.wav');
  }

  wifi.scan().then(results => {
    // On Edison, scanning will fail since we're in AP mode at this point
    // So we'll use the preliminary scan instead
    if (results.length === 0) {
      results = preliminaryScanResults;
    }

    // XXX
    // To handle the case where the user entered a bad password and we are
    // not connected, we should show the networks we know about, and modify
    // the template to explain that if the user is seeing it, it means
    // that the network is down or password is bad. This allows the user
    // to re-enter a network.  Hopefully wpa_supplicant is smart enough
    // to do the right thing if there are two entries for the same ssid.
    // If not, we could modify wifi.defineNetwork() to overwrite rather than
    // just adding.

    response.send(wifiSetupTemplate({ networks: results }));
  });
}

function handleConnecting(request, response) {
  var ssid = request.body.ssid.trim();
  var password = request.body.password.trim();

  // XXX
  // We can come back here from the status page if the user defines
  // more than one network. We always need to call defineNetwork(), but
  // only need to call stopAP() if we're actually in ap mode.
  //
  // Also, if we're not in AP mode, then we should just redirect to
  // /status instead of sending the connecting template.
  //

  response.send(connectingTemplate({ssid: ssid}));

  // Wait before switching networks to make sure the response gets through.
  // And also wait to be sure that the access point is fully down before
  // defining the new network. If I only wait two seconds here, it seems
  // like the Edison takes a really long time to bring up the new network
  // but a 5 second wait seems to work better.
  wait(2000)
    .then(() => wifi.stopAP())
    .then(() => wait(5000))
    .then(() => wifi.defineNetwork(ssid, password))
    .then(() => waitForWifi(20, 3000))
    .then(() => {
      play('audio/continue.wav');
    })
    .catch(() => {
      play('audio/error.wav');
    });
}

function handleOauthSetup(request, response) {
  response.send(oauthSetupTemplate());
}

// We hold our oauth state here. If this was a server that ever had
// multiple clients, we'd have to use session state. But since we expect
// only one client, we just use globak state
var oauthState = {};

function handleOauth(request, response) {
  var client = new Evernote.Client(evernoteConfig);
  var callbackURL = request.protocol + "://" + request.headers.host +
      '/oauth_callback';
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
      oauthToken = null;
      saveToken(null);   // Erase any previously saved token.
      stopVaani();
      response.redirect('/');
      return;
    }

    // Store the oauth results in a global variable
    oauthToken = {
      oauthAccessToken: oauthAccessToken,
      oauthAccessTokenSecret: oauthAccessTokenSecret,
      results: results
    };

    console.log("saving oauth access token to", OAUTH_ENV_FILE);
    console.log("saving oauth results to", OAUTH_TOKEN_FILE);
    saveToken(oauthToken)

    // Start or restart the Vaani client now
    restartVaani();
    response.redirect('/');
  }
}

function handleStatus(request, response) {
  wifi.getConnectedNetwork().then(ssid => {
    var until = '';
    if (oauthToken.results &&
        oauthToken.results.edam_expires &&
        parseInt(oauthToken.results.edam_expires)) {
      until = new Date(parseInt(oauthToken.results.edam_expires)).toString();
    }

    response.send(statusTemplate({
      ssid: ssid,
      until: until
    }));
  });
}

function saveToken(token) {
  // And in the local file
  fs.writeFileSync(OAUTH_TOKEN_FILE, JSON.stringify(token));

  // And in the environment variable config file for the Vaani client
  var confFile = `[Service]
Environment="EVERNOTE_OAUTH_TOKEN=${token.oauthAccessToken || ''}"
`
  fs.writeFileSync(OAUTH_ENV_FILE, confFile);
}

function readToken() {
  try {
    var oauthToken = JSON.parse(fs.readFileSync(OAUTH_TOKEN_FILE, 'utf8'));
    if (oauthToken && oauthToken.oauthAccessToken) {
      return oauthToken
    }
    else {
      return null;
    }
  }
  catch(e) {
    return null;
  }
}

function startVaani() {
  cp.execFile('systemctl', ['start', 'vaani'], function(error, stdout, stderr) {
    if (error) {
      console.error('Error starting Vaani:', error);
    }
    else {
      console.log('Vaani started', stdout, stderr);
    }
  });
}

function stopVaani() {
  cp.execFile('systemctl', ['stop', 'vaani'], function(error, stdout, stderr) {
    if (error) {
      console.error('Error stopping Vaani:', error);
    }
    else {
      console.log('Vaani stopped', stdout, stderr);
    }
  });
}

function restartVaani() {
  cp.execFile('systemctl', ['restart', 'vaani'], function(error,stdout,stderr) {
    if (error) {
      console.error('Error restarting Vaani:', error);
    }
    else {
      console.log('Vaani re/started', stdout, stderr);
    }
  });
}

function play(filename) {
  return new Promise(function(resolve, reject) {
    cp.exec('play ' + filename, function(error, stdout, stderr) {
      if (error) {
        reject(error);
      }
      else {
        resolve();
      }
    });
  });
}

function waitForSpeech(word) {
  return new Promise(function(resolve, reject) {
    Wakeword.listen([word], 0.85, function(data, word) {
      Wakeword.stop();
      resolve();
    }, function onready() {
      /* For now, assume PS will be ready before the user is */
    });
  });
}
