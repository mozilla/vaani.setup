module.exports = {
  platform: 'vaani',

  startVaani: 'systemctl start vaani-client',
  stopVaani: 'systemctl stop vaani-client',
  restartVaani: 'systemctl restart vaani-client',

  // Like the Intel Edison BSP, we set up hostapd to also set the IP and start
  // a DHCP server.
  startAP: 'systemctl start hostapd',
  // Without toggling wifi on/off, scanning remains broken.
  stopAP: 'systemctl stop hostapd && connmanctl disable wifi && connmanctl enable wifi',

  // Rather than using wpa_supplicant, use connman (which works more reliably)
  scan: `connmanctl scan wifi && connmanctl services | sed -e 's/^[*A-z]* *\\(.*\\) *wifi.*$/\\1/' | grep .+*`,
  getKnownNetworks: `connmanctl services | grep '^[^ ]*A' | sed -e 's/^[A-z]* *\\(.*\\) *wifi.*$/\\1/' | grep .+*`,
  defineNetwork: `cat << EOF > /var/lib/connman/wifi.config
[service_vaani]
Type = wifi
Security = wpa2
Name = $SSID
Passphrase = $PSK
EOF`,
  defineOpenNetwork: `cat << EOF > /var/lib/connman/wifi.config
[service_vaani]
Type = wifi
Name = $SSID
EOF`
}
