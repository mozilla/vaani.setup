module.exports = {
  platform: 'edison',
  // On our edison devices, this is how we talk to the microphone
  microphoneDevice: 'plughw:2,0', 

  playAudio: 'aplay -q -D plughw:3,0 $AUDIO',

  // The edison is configured so that starting hostapd automatically
  // starts udhcpd and does the ifconfig as well
  startAP: 'systemctl start hostapd',
  // The edison is configured so that stopping hostapd automatically
  // stops udhcpd and does the ifconfig as well
  stopAP: 'systemctl stop hostapd',
}
