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
  token. 

The code is Linux-specific and has so far only been tested on a
Raspberry Pi 3. It also requires hostapd and udhcpd to be installed
and properly configured. Here are the steps I followed to get my
Raspberry Pi set up to run this server:


## Step 1
Install software we need to host an access point, but
make sure it does not run by default each time we boot

```
$ sudo apt-get install hostapd
$ sudo apt-get install udhcpd
$ sudo systemctl disable hostapd
$ sudo systemctl disable udhcpd
```
## Step 2
Next, configure the software:

- Edit /etc/default/hostapd to add the line:

```
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

- Copy `config/hostapd.conf` to `/etc/hostapd/hostapd.conf`

- Edit the file `/etc/default/udhcpd` and comment out the line:

```
DHCPD_ENABLED="no"
```

- Copy `config/udhcpd.conf` to `/etc/udhcp.conf`

## Step 3

Finally, set up your system to run this server each time it boots up
Do this by editing `/etc/rc.local` to add this line, editing the path
as appropriate to refer to the start.sh script in this repo.

```
/home/pi/vaani.setup/start.sh &
```

See `config/rc.local` for a startup script that work for me.
