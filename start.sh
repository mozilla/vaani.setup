#!/bin/sh
# This script starts the server and is suitable for use from /etc/rc.local
# The script assumes it is run with root privileges
cd `dirname $0`
/usr/local/bin/node index.js &> `date +%F-%H-%M-%S`.log

