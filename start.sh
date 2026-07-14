#!/bin/bash
cd /home/bosidon/projects/lingxiu/site
nohup node app.js > /home/bosidon/projects/lingxiu/site/server.log 2>&1 &
echo $! > /home/bosidon/projects/lingxiu/site/server.pid
echo "Server PID: $(cat /home/bosidon/projects/lingxiu/site/server.pid)"
sleep 2
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3099/
