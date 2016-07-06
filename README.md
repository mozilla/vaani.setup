# vaani.setup

This repo is an Express server that runs on the Vaani device and
handles the first-time setup required to get the device working:

- since the device is not on the local wifi network when it is first
  turned on, the device broadcasts its own wifi access point and runs
  the server on that. The user then connects their phone or laptop to
  that wifi network and uses a web browser (not a native app!) to
  connect to the device at the URL `vaani.local`. The user can select
  then their home wifi network and enter the password on a web page
  and transfer it to the web server running on the device. At this
  point, the device can turn off its private network and connect to
  the internet using the credentials the user provided.

- after re-connecting to their home wifi, the user can reload the
  `vaani.local` page and handle the second part of setup, which is to
  perform OAuth authentication with Evernote to obtain an access
  token. (The server saves the token and related values, such as the
  expiration date, in a file named `oauthToken.json`.)

The code is Linux-specific, depends on systemd, and has so far only
been tested on a Raspberry Pi 3. It requires hostapd and udhcpd to be
installed and properly configured. Here are the steps I followed to
configure and run this server. Note that the steps include
instructions for Raspberry Pi and Edison, but that I have not yet been
able to successfully run on Edison

### Step 0
On Edison, update your node and npm with commands like these:

```
# curl https://nodejs.org/dist/v4.4.7/node-v4.4.7-linux-x86.tar.xz | zcat | tar xf - -C /usr/local
# cat <<EOF >> ~/.profile
export PATH=/usr/local/node-v4.4.7-linux-x86/bin:$PATH
EOF
# source ~/.profile
# node --version
v4.4.7
```

Next, on Raspberry Pi and Edison, clone this repo and download its
dependencies from npm.

```
$ git clone https://github.com/mozilla/vaani.setup.git
$ cd vaani.setup
$ npm install
```

### Step 1
Install software we need to host an access point, but
make sure it does not run by default each time we boot. For Raspberry
Pi, we need to do:

```
$ sudo apt-get install hostapd
$ sudo apt-get install udhcpd
$ sudo systemctl disable hostapd
$ sudo systemctl disable udhcpd
```

On my Edison device, hostapd and udhcpd are already installed (and
disabled) so these steps are not necessary. Note that on Edison, the
udhcpd service is named `udhcpd-for-hostapd`.

### Step 2
Next, configure the software:

- On Raspberry Pi, edit /etc/default/hostapd to add the line:

```
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```
this step is not necessary on Edison.

- Copy `config/hostapd.conf` to `/etc/hostapd/hostapd.conf`.  This
  config file defines the access point name "VaaniSetup". Edit it if
  you want to use a different name. On Edison
  `/etc/hostapd/hostapd.conf` alread exists. You may want to rename
  the existing file rather than overwriting it.

- On Raspberry Pi (but not Edison) edit the file `/etc/default/udhcpd`
  and comment out the line:

```
DHCPD_ENABLED="no"
```

- On Edison (but not Raspberry Pi) edit the file
  `/lib/systemd/system/udhcpd-for-hostapd.service` and modify this
  line:

```
ExecStartPre=/sbin/ifconfig wlan0 192.168.42.1 up
```
changing `192.168.42.1` to `10.0.0.1`. This is necessary because
`config/udhcpd.conf` and `wifi.js` use 10.0.0.1 as the local IP
address when we're broadcasting an access point.

- On Raspberry Pi, copy `config/udhcpd.conf` to `/etc/udhcp.conf`.
On Edison, rename `/etc/hostapd/udhcp-for-hostapd.conf` to
`/etc/hostapd/udhcp-for-hostapd.conf.orig`, and then copy
`config/udhcpd.conf` to `/etc/hostapd/udhcp-for-hostapd.conf`.

If you have a keyboard and monitor hooked up to your device, or have a
serial connection to the device, then you can try out the server at
this point:

```
sudo node index.js
```

### Step 3

If you want to run the server on a device that has no network
connection and no keyboard or monitor, you probably want to set it up
to run automatically when the device boots up. The right way to do
this is with a systemd service. But for now, we'll do it the
old-fashioned way. On Raspberry Pi, edit
`/etc/rc.local` to add a line like this:

```
/home/pi/vaani.setup/start.sh &
```

Note that you may need to use a different path, depending on where you
cloned the repo. See `config/rc.local` for a startup script that works
for me.

On Edison, do something like this:

```
cd /etc/init.d
touch vaani.sh
chmod +x vaani.sh
cat <<EOF > vaani.sh
#!/bin/sh
/home/root/vaani.setup/start.sh &
exit 0
EOF
```

Depending on where you installed Node, you may now need to edit
`/home/root/vaani.setup/start.sh` to modify `/usr/local/bin/node` to
the correct path to node
