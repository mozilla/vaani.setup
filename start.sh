#!/bin/sh
cd `dirname $0`
/usr/local/bin/node index.js > stdout.log 2> stderr.log
