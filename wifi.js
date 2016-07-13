var child_process = require('child_process');

// Are we running on Yocto (an Edison device, we presume) or something else?
var isYocto = child_process
    .execFileSync('uname', ['-r'], { encoding:'utf8' })
    .includes('yocto');

exports.getStatus = getStatus;
exports.getConnectedNetwork = getConnectedNetwork;
exports.scan = scan;
exports.startAP = startAP;
exports.stopAP = stopAP;
exports.defineNetwork = defineNetwork;
exports.getKnownNetworks = getKnownNetworks;

// These are the shell commands that provide the network querying and
// modification primitives used by this module. We export this commands
// object so that these default commands can be modified for other
// systems where the defaults do not work

var commands = exports.commands = {
  // A shell command that outputs the string "COMPLETED" if we are
  // connected to a wifi network and outputs something else otherwise
  getStatus:
    "wpa_cli -iwlan0 status | sed -n -e '/^wpa_state=/{s/wpa_state=//;p;q}'",

  // A shell command that outputs the SSID of the current wifi network
  // or outputs nothing if we are not connected to wifi
  getConnectedNetwork:
    "wpa_cli -iwlan0 status | sed -n -e '/^ssid=/{s/ssid=//;p;q}'",

  // A shell command that scans for wifi networks and outputs the ssids in
  // order from best signal to worst signal, omitting hidden networks
  scan: `iwlist wlan0 scan |\
sed -n -e '
  /Quality=/,/ESSID:/H
  /ESSID:/{
    g
    s/^.*Quality=\\([0-9]\\+\\).*ESSID:"\\([^"]*\\)".*$/\\1\t\\2/
    p
    s/.*//
    x
  }' |\
sort -nr |\
cut -f 2 |\
sed -e '/^$/d;/\\x00/d'`,

  // A shell command that lists the names of known wifi networks, one
  // to a line.
  getKnownNetworks: "wpa_cli -iwlan0 list_networks | sed -e '1d' | cut -f 2",

  // Start broadcasting an access point.
  // The name of the AP is defined in a config file elsewhere
  // Note that we use different commands on Yocto systems than
  // we do on Raspbian systems
  startAP: isYocto
    ? 'systemctl start hostapd'
    : 'ifconfig wlan0 10.0.0.1 && systemctl start hostapd && systemctl start udhcpd',

  // Stop broadcasting an AP and attempt to reconnect to local wifi
  stopAP: isYocto
    //? 'systemctl stop hostapd && systemctl restart wpa_supplicant'
    ? 'systemctl stop hostapd'
    : 'systemctl stop udhcpd && systemctl stop hostapd && ifconfig wlan0 0.0.0.0',

  // Define a new wifi network. Expects the network name and password
  // in the environment variables SSID and PSK.
  defineNetwork: 'ID=`wpa_cli -iwlan0 add_network` && wpa_cli -iwlan0 set_network $ID ssid \\"$SSID\\" && wpa_cli -iwlan0 set_network $ID psk \\"$PSK\\" && wpa_cli -iwlan0 enable_network $ID && wpa_cli -iwlan0 save_config',

  // Define a new open wifi network. Expects the network name
  // in the environment variable SSID.
  defineOpenNetwork: 'ID=`wpa_cli -iwlan0 add_network` && wpa_cli -iwlan0 set_network $ID ssid \\"$SSID\\" && wpa_cli -iwlan0 set_network $ID key_mgmt NONE && wpa_cli -iwlan0 enable_network $ID && wpa_cli -iwlan0 save_config',
}

// A Promise-based version of child_process.exec(). It rejects the
// promise if there is an error or if there is any output to stderr.
// Otherwise it resolves the promise to the text that was printed to
// stdout (with any leading and trailing whitespace removed).
function exec(command, environment) {
  return new Promise(function(resolve, reject) {
    console.log("Running command:", command);
    var options = {};
    if (environment) {
      options.env = environment;
    }
    child_process.exec(command, options, function(error, stdout, stderr) {
      if (error) {
        reject(error);
      }
      else if (stderr && stderr.length > 0) {
        reject(new Error(command + ' output to stderr: ' + stderr));
      }
      else {
        resolve(stdout.trim())
      }
    });
  });
}


/*
 * Determine whether we have a wifi connection with the `wpa_cli
 * status` command. This function returns a Promise that resolves to a
 * string.  On my Rasberry Pi, the string is "DISCONNECTED" or
 * "INACTIVE" when there is no connection and is "COMPLETED" when
 * there is a connection. There are other possible string values when
 * a connection is being established
 */
function getStatus() {
  return exec(commands.getStatus);
}

/*
 * Determine the ssid of the wifi network we are connected to.
 * This function returns a Promise that resolves to a string. 
 * The string will be empty if not connected.
 */
function getConnectedNetwork() {
  return exec(commands.getConnectedNetwork);
}

/*
 * Scan for available wifi networks using `iwlist wlan0 scan`.
 * Returns a Promise that resolves to an array of strings. Each string
 * is the ssid of a wifi network. They are sorted by signal strength from
 * strongest to weakest. On a Raspberry Pi, a scan seems to require root
 * privileges.
 *
 * On a Raspberry Pi 3, this function works when the device is in AP mode.
 * The Intel Edison, however, cannot scan while in AP mode: iwlist fails
 * with an error. iwlist sometimes also fails with an error when the
 * hardware is busy, so this function will try multiple times if you
 * pass a number. If all attempts fail, the promise is resolved to
 * an empty array.
 */
function scan(numAttempts) {
  numAttempts = numAttempts || 1;
  return new Promise(function(resolve, reject) {
    var attempts = 0;

    function tryScan() {
      attempts++;

      _scan()
        .then(out => { resolve(out.length ? out.split('\n') : []);})
        .catch(err => {
          console.error('Scan attempt', attempts, 'failed:', err.message||err);

          if (attempts >= numAttempts) {
            console.error('Giving up. No scan results available.');
            resolve([]);
            return;
          }
          else {
            console.error('Will try again in 3 seconds.');
            setTimeout(tryScan, 3000);
          }
        });
    }

    tryScan();
  });

  function _scan() {
    return exec(commands.scan)
  }
}

/*
 * Enable an access point that users can connect to to configure the device.
 *
 * This command runs different commands on Raspbery Pi Rasbian and Edison Yocto.
 *
 * It requires that hostapd and udhcpd are installed on the system but not
 * enabled, so that they do not automatically run when the device boots up.
 * It also requires that hostapd and udhcpd have appropriate config files
 * that define the ssid for the wifi network to be created, for example.
 * Also, the udhcpd config file should be set up to work with 10.0.0.1 as
 * the IP address of the device.
 *
 * XXX
 * It would probably be better if the IP address, SSID and password were
 * options to this function rather than being hardcoded in system config
 * files. (Each device ought to be able to add a random number to its
 * SSID, for example, so that when you've got multiple devices they don't
 * all try to create the same network).
 *
 * This function returns a Promise that resolves when the necessary
 * commands have been run.  This does not necessarily mean that the AP
 * will be functional, however. The setup process might take a few
 * seconds to complete before the user will be able to see and connect
 * to the network.
 */
function startAP() {
  return exec(commands.startAP);
}

/*
 * Like startAP(), but take the access point down, using platform-dependent
 * commands.
 *
 * Returns a promise that resolves when the commands have been run. At
 * this point, the AP should be in the process of stopping but may not
 * yet be completely down.
 */
function stopAP() {
  return exec(commands.stopAP);
}

/*
 * This function uses wpa_cli to add the specified network ssid and password
 * to the wpa_supplicant.conf file. This assumes that wpa_supplicant is
 * configured to run automatically at boot time and is configured to work
 * with wpa_cli.
 *
 * If the system is not connected to a wifi network, calling this
 * command with a valid ssid and password should cause it to connect.
 */
function defineNetwork(ssid, password) {
  return exec(password ? commands.defineNetwork : commands.defineOpenNetwork, {
    SSID: ssid,
    PSK: password
  });
}

/*
 * Return a Promise that resolves to an array of known wifi network names
 */
function getKnownNetworks() {
  return exec(commands.getKnownNetworks)
    .then(out => out.length ? out.split('\n') : []);
}
